// ============================================================================
// AI Agent U盘版 Launcher - main process (Electron)  v1.0.0
// Portable, cross-platform. Root resolved dynamically. Never hard-codes drive
// letters. Never modifies persistent PATH. No API keys, no login, no shell
// IPC beyond the manifest's own start scripts.
// ============================================================================
'use strict';

const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { UsageStore } = require('./usage.js');
const { UsageProxy } = require('./usage-proxy.js');
const pm = require('./agent-process-manager.js');
const { readJsonSafe, stripBom } = require('./json-util.js');

// --- Resolve project root dynamically -------------------------------------
// Dev: <root>/Launcher/App/main.js. Packaged portable exe:
//   <root>/Launcher/Release/.../AI-Agent.exe runs from resources, but we ship
//   the portable build next to the mother folder; root is still derived from
//   the executable location at runtime (see resolveRoot).
const APP_DIR = __dirname;
const LAUNCHER_DIR = path.resolve(APP_DIR, '..');

// Root resolution:
//  - dev:      __dirname = <root>/Launcher/App  -> root = up two levels.
//  - packaged: exe = <root>/Build/Release/Windows-x64/AI-Agent.exe
//              root = up three levels from the exe directory.
function resolveRoot() {
  if (app.isPackaged) {
    // electron-builder portable sets PORTABLE_EXECUTABLE_DIR to the folder
    // containing the user-facing exe (NOT the temp extraction dir).
    // exe at <root>/Build/Release/Windows-x64 -> root is up three levels.
    const dir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (dir && fs.existsSync(dir)) {
      return path.resolve(dir, '..', '..', '..');
    }
    // Fallback: packaged but not via portable wrapper (e.g. win-unpacked).
    // exe at <root>/Build/Release/Windows-x64/win-unpacked -> up four levels.
    const exeDir = path.dirname(process.execPath);
    return path.resolve(exeDir, '..', '..', '..', '..');
  }
  return path.resolve(LAUNCHER_DIR, '..');
}
const ROOT = resolveRoot();
const AGENTS_JSON = path.join(ROOT, 'Build', 'Config', 'agents.json');
const LOG_DIR = path.join(ROOT, 'Launcher', 'Logs');
const LAUNCHER_VERSION = require(path.join(APP_DIR, 'package.json')).version;

// Tell the process manager where the portable root is, so its persistent agent
// state lives on the USB (Launcher/Data) instead of %APPDATA%, and so it can
// re-adopt agents that are still running from a previous session.
pm.configure({ root: ROOT });

// --- Logging with read-only fallback ----------------------------------------
let activeLogPath = null;
function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const t = path.join(LOG_DIR, '.wtest');
    fs.writeFileSync(t, 'x'); fs.unlinkSync(t);
    activeLogPath = path.join(LOG_DIR, 'launcher.log');
  } catch (_) {
    // Read-only / no write permission -> fall back to temp, but tell UI.
    const tmp = path.join(os.tmpdir(), 'ai-agent-launcher.log');
    activeLogPath = tmp;
  }
}
function log(line) {
  try {
    if (!activeLogPath) ensureLogDir();
    const stamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    fs.appendFileSync(activeLogPath, `${stamp}  ${line}\n`);
  } catch (_) { /* never crash */ }
}
// Called by readJsonSafe() when a JSON config file carried a UTF-8 BOM and it
// was stripped before parsing. A BOM must never be silent: without this line a
// BOM'd user-config.json just looked like an empty configuration.
function logStrippedBom(filePath) {
  log('[config] stripped BOM from ' + path.basename(filePath));
}
function safe(s) {
  if (!s) return 'unknown error';
  let m = (s && s.message) ? s.message : String(s);
  m = m.replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-***')
       .replace(/(eyJ[A-Za-z0-9_\-\.]{10,})/g, '***')
       .replace(/(authorization|cookie|token)[=:]\s*\S+/gi, '$1=***');
  return m.slice(0, 300);
}

// --- API configuration: non-sensitive config + DPAPI-protected secrets --------
const CONFIG_DIR  = path.join(ROOT, 'Launcher', 'Config');
const SECRET_DIR  = path.join(ROOT, 'Launcher', 'Data', 'secrets');
const USER_CONFIG = path.join(CONFIG_DIR, 'user-config.json');
const CONFIG_IDS = ['openclaw', 'hermes', 'codex', 'claudeCode'];
const PROVIDERS = ['openai-compatible', 'anthropic-compatible', 'custom'];

function defaultUserConfig() {
  const agents = {};
  for (const id of CONFIG_IDS) agents[id] = { provider: '', baseUrl: '', model: '', enabled: false };
  return { version: 1, agents };
}
function loadUserConfig() {
  try {
    // BOM tolerance: a UTF-8 BOM (Notepad "UTF-8 with BOM", PowerShell 5.1
    // `Set-Content -Encoding UTF8`) used to make JSON.parse throw here, so the
    // whole config silently became the empty default. readJsonSafe strips it and
    // reports it; strict mode keeps the corrupt/unreadable -> .bak fallback below.
    const c = readJsonSafe(USER_CONFIG, {
      strict: true,
      onStrippedBom: () => log('[config] stripped BOM from user-config.json'),
    });
    if (!c || c.version !== 1 || typeof c.agents !== 'object') throw new Error('bad');
    const out = defaultUserConfig();
    for (const id of CONFIG_IDS) if (c.agents[id]) out.agents[id] = { ...out.agents[id], ...c.agents[id] };
    // Never persist apiKey/token/secret/password here: strip defensively.
    for (const id of CONFIG_IDS) {
      const a = out.agents[id];
      delete a.apiKey; delete a.accessToken; delete a.refreshToken; delete a.secret; delete a.password;
    }
    return out;
  } catch (_) {
    // Corrupt -> keep a .bak, fall back to defaults. Do not delete original.
    try { if (fs.existsSync(USER_CONFIG)) fs.copyFileSync(USER_CONFIG, USER_CONFIG + '.bak'); } catch (_) {}
    return defaultUserConfig();
  }
}
function saveUserConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const safeCfg = { version: 1, agents: {} };
  for (const id of CONFIG_IDS) {
    const a = cfg.agents[id] || {};
    safeCfg.agents[id] = { provider: a.provider || '', baseUrl: a.baseUrl || '', model: a.model || '', enabled: !!a.enabled };
  }
  fs.writeFileSync(USER_CONFIG, JSON.stringify(safeCfg, null, 2), 'utf8');
}
function secretPath(id) { return path.join(SECRET_DIR, id + '.bin'); }
function hasSecret(id) { try { return fs.existsSync(secretPath(id)); } catch (_) { return false; } }
function maskKey(k) { if (!k) return ''; if (k.length <= 4) return '••••'; return '••••' + k.slice(-4); }

// DPAPI (Windows Per-User) via PowerShell. Plaintext travels over stdin (never
// argv) and never reaches logs/renderer. Only win32 supported this phase.
function dpapiProtect(plain) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('DPAPI only on Windows'));
    const ps = "Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); $e=[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'); [Console]::Out.Write([Convert]::ToBase64String($e))";
    const ch = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true });
    let out = '', err = '';
    ch.stdout.on('data', d => out += d); ch.stderr.on('data', d => err += d);
    ch.on('close', c => c === 0 ? resolve(out.trim()) : reject(new Error(err || 'dpapi protect failed')));
    ch.on('error', reject);
    ch.stdin.write(plain); ch.stdin.end();
  });
}
function dpapiUnprotect(b64) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('DPAPI only on Windows'));
    const ps = "Add-Type -AssemblyName System.Security; $e=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $b=[Security.Cryptography.ProtectedData]::Unprotect($e,$null,'CurrentUser'); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))";
    const ch = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true });
    let out = '', err = '';
    ch.stdout.on('data', d => out += d); ch.stderr.on('data', d => err += d);
    ch.on('close', c => c === 0 ? resolve(out) : reject(new Error(err || 'dpapi unprotect failed')));
    ch.on('error', reject);
    ch.stdin.write(b64); ch.stdin.end();
  });
}
// Local validation only (NO network request, NO outbound call).
function validateFields(f) {
  const errors = [];
  if (!PROVIDERS.includes(f.provider)) errors.push('provider');
  if (f.baseUrl) {
    try { const u = new URL(f.baseUrl); if (!/^https?:$/.test(u.protocol)) errors.push('baseUrl'); }
    catch (_) { errors.push('baseUrl'); }
  }
  if (!f.model || !String(f.model).trim()) errors.push('model');
  if (typeof f.apiKey !== 'undefined' && f.apiKey && f.apiKey.length < 8) errors.push('apiKeyTooShort');
  return errors;
}

// --- Phase 9: secret retrieval + connectivity test + env injection ----------
// Read DPAPI-protected key for an agent id. Returns plaintext (memory only) or null.
async function loadSecretPlain(id) {
  try {
    if (!hasSecret(id)) return null;
    return await dpapiUnprotect(fs.readFileSync(secretPath(id), 'utf8'));
  } catch (_) { return null; }
}

// Build the /models URL from user Base URL without doubling /v1.
function modelsUrl(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (/\/models$/.test(base)) return base;
  return base + '/models';
}

// SSRF / URL guard: only http(s), no file/data/js, no query-token.
function assertSafeHttpUrl(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol)) throw new Error('only http(s) allowed');
  if (url.search && /(^|&)(api_?key|token|key)=/i.test(url.search.slice(1))) throw new Error('secret in URL query not allowed');
  return url;
}

// Human-readable Chinese mapping for connectivity failures (no secret leaked).
function statusMessage(kind, status) {
  if (kind === 'timeout') return '连接超时：10 秒内未收到响应，请检查网络或 Base URL。';
  if (kind === 'network') return '网络不可达：无法连接到该地址，请检查网络或 Base URL。';
  if (kind === 'blocked') return '该 Provider 类型暂不自动连接测试。';
  switch (status) {
    case 200: return '连接成功。';
    case 401: return '认证失败（401）：API Key 无效或已过期。';
    case 403: return '权限/欠费（403）：Key 无权限或账户余额不足，请检查账户。';
    case 404: return '接口不存在（404）：请检查 Base URL 是否正确。';
    case 429: return '请求过于频繁（429）：Provider 限流，请稍后再试。';
    default:
      if (status >= 500) return `服务器错误（${status}）：Provider 端临时故障，请稍后再试。`;
      if (status > 0) return `连接失败（HTTP ${status}）。`;
      return '连接失败。';
  }
}

// Minimal, user-triggered connectivity test. 0 retries, 10s timeout, TLS verified.
// openai-compatible: GET {base}/models with Authorization: Bearer <key>.
async function openaiPing(baseUrl, key) {
  const url = assertSafeHttpUrl(modelsUrl(baseUrl));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000); // hard 10s cap
  const started = Date.now();
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' },
      redirect: 'manual', // do not follow redirects automatically
      signal: ac.signal,
    });
    const latencyMs = Date.now() - started;
    // Do NOT read body fully; just status.
    try { await res.arrayBuffer().catch(()=>{}); } catch(_){}
    return { ok: res.ok, status: res.status, latencyMs, kind: res.type === 'opaqueredirect' ? 'redirect-blocked' : 'http' };
  } catch (e) {
    const latencyMs = Date.now() - started;
    if (e && e.name === 'AbortError') return { ok: false, status: 0, latencyMs, kind: 'timeout' };
    return { ok: false, status: 0, latencyMs, kind: 'network', reason: safe(e) };
  } finally { clearTimeout(timer); }
}

// Build child-process env extra for launching an agent. Maps provider type to the
// standard vendor env vars. Key lives only in the child env block (memory).
function buildAgentEnvExtra(provider, baseUrl, key, model) {
  const extra = {};
  if (!key) return extra;
  if (provider === 'openai-compatible') {
    extra.OPENAI_API_KEY = key;
    if (baseUrl) extra.OPENAI_BASE_URL = baseUrl;
  } else if (provider === 'anthropic-compatible') {
    extra.ANTHROPIC_API_KEY = key;
    if (baseUrl) extra.ANTHROPIC_BASE_URL = baseUrl;
  } else if (provider === 'custom') {
    // Custom: pass both standard bundles; user must pick a compatible protocol.
    extra.OPENAI_API_KEY = key;
    if (baseUrl) extra.OPENAI_BASE_URL = baseUrl;
  }
  if (model) { extra.OPENAI_MODEL = model; extra.ANTHROPIC_MODEL = model; }
  return extra;
}

// --- Bundled provider injection (config/providers.json) ----------------------
// The retired start scripts (start-claude-code.ps1) and the agent config
// (Agents/Hermes/config.yaml key_env) source their credentials from
// config/providers.json. The process manager now spawns the agent executables
// directly, so this bundle has to be applied here or the agent starts with no
// endpoint at all — and Hermes in particular rejects every request with
// "key_env HERMES_LAUNCHER_API_KEY is set but the variable is empty/unset".
function bundledProvider() {
  const prov = readJsonSafe(path.join(ROOT, 'config', 'providers.json'), {
    defaultValue: null,
    onStrippedBom: logStrippedBom,
  });
  if (prov && typeof prov === 'object') {
    if (prov.agnes && prov.agnes.enabled && prov.agnes.apiKey) return prov.agnes;
    for (const v of Object.values(prov)) { if (v && v.enabled && v.apiKey) return v; }
  }
  return null;
}

// Returns { env, model? } or null. `model` is only used by Hermes, whose
// base_url/model live in its own config.yaml rather than in the environment.
function buildBundledProviderEnv(cfgId) {
  const p = bundledProvider();
  if (!p) return null;
  if (cfgId === 'claudeCode') {
    const env = {
      ANTHROPIC_API_KEY: p.apiKey,
      // agnes-2.5-flash is not in Claude Code's built-in model catalog; without
      // this flag the TUI enforces an unknown-model context-window check and exits.
      CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1',
    };
    if (p.anthropicBaseUrl) env.ANTHROPIC_BASE_URL = p.anthropicBaseUrl;
    if (p.model) env.ANTHROPIC_MODEL = p.model;
    return { env };
  }
  if (cfgId === 'hermes') {
    // Hermes does not read generic OPENAI_API_KEY: its config sets
    // model.provider="custom" + model.key_env=HERMES_LAUNCHER_API_KEY and resolves
    // the secret from the child-process environment.
    return { env: { HERMES_LAUNCHER_API_KEY: p.apiKey }, model: { baseUrl: p.baseUrl, model: p.model } };
  }
  if (cfgId === 'codex') {
    // Codex reads OPENAI_API_KEY (or the env_key named in config.toml) and, unlike
    // the built-in defaults, the endpoint must come from [model_providers.<id>] —
    // verified: setting only OPENAI_BASE_URL still sent the request to
    // api.openai.com/v1/responses. So the env bundle is paired with
    // syncCodexModelConfig(), which writes that provider block.
    const env = { OPENAI_API_KEY: p.apiKey };
    if (p.baseUrl) env.OPENAI_BASE_URL = p.baseUrl;
    return { env, model: { baseUrl: p.baseUrl, model: p.model } };
  }
  return null;
}

// --- Phase 11: Hermes Provider adapter --------------------------------------
// Hermes does NOT read generic OPENAI_API_KEY. Its official custom OpenAI-compatible
// path reads model.provider="custom" + model.base_url + model.key_env=<ENV>, then
// resolves the key via get_secret_str(<ENV>) which reads the child-process env.
const HERMES_KEY_ENV = 'HERMES_LAUNCHER_API_KEY';
function hermesConfigPath() { return path.join(ROOT, 'Agents', 'Hermes', 'config.yaml'); }
function yamlStr(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function syncHermesModelConfig(baseUrl, model) {
  const cfgPath = hermesConfigPath();
  const raw = fs.readFileSync(cfgPath, 'utf8');
  try { if (!fs.existsSync(cfgPath + '.bak')) fs.writeFileSync(cfgPath + '.bak', raw); } catch (_) {}
  const lines = raw.split(/\r?\n/);
  let start = lines.findIndex(l => /^model:\s*$/.test(l));
  if (start < 0) throw new Error('model block not found in hermes config');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { if (/^[A-Za-z]/.test(lines[i])) { end = i; break; } }
  let sawDefault=false, sawProvider=false, sawBase=false, sawKeyEnv=false;
  for (let i = start + 1; i < end; i++) {
    const l = lines[i];
    if (!sawDefault && /^\s{2}default:\s/.test(l)) { lines[i] = '  default: ' + yamlStr(model); sawDefault = true; }
    else if (!sawProvider && /^\s{2}provider:\s/.test(l)) { lines[i] = '  provider: "custom"'; sawProvider = true; }
    else if (!sawBase && /^\s{2}base_url:\s/.test(l)) { lines[i] = '  base_url: ' + yamlStr(baseUrl); sawBase = true; }
    else if (/^\s{2}key_env:\s/.test(l)) { lines[i] = '  key_env: "' + HERMES_KEY_ENV + '"'; sawKeyEnv = true; }
    else if (/^\s{2}api_key_env:\s/.test(l)) { lines[i] = '  api_key_env: "' + HERMES_KEY_ENV + '"'; }
    else if (/^\s{2}api_key:\s*[^#].*$/.test(l) && !/^\s*#/.test(l)) { lines[i] = '  # api_key: (managed by Launcher via key_env)'; }
  }
  if (sawBase && !sawKeyEnv) {
    for (let i = start + 1; i < end; i++) {
      if (/^\s{2}base_url:\s/.test(lines[i])) { lines.splice(i + 1, 0, '  key_env: "' + HERMES_KEY_ENV + '"'); end++; break; }
    }
  } else if (!sawBase) {
    lines.splice(end, 0, '  provider: "custom"', '  base_url: ' + yamlStr(baseUrl),
      '  key_env: "' + HERMES_KEY_ENV + '"', '  default: ' + yamlStr(model));
  }
  fs.writeFileSync(cfgPath, lines.join('\n'));
  return { baseUrl, model };
}

// --- Phase 11: Codex Provider adapter ---------------------------------------
// Codex's own config is $CODEX_HOME/config.toml. It has no environment variable
// for the endpoint (verified against the shipped binary: only OPENAI_API_KEY and
// OPENAI_BASE_URL exist, and OPENAI_BASE_URL is not consulted for the default
// provider), so the provider has to be declared in the config file. This mirrors
// syncHermesModelConfig: rewrite only the keys we own, keep every other section.
const CODEX_BUNDLED_PROVIDER = 'agnes';
function codexConfigPath() { return path.join(ROOT, 'Agents', 'Codex', 'config.toml'); }
function tomlStr(s) { return JSON.stringify(String(s)); } // JSON strings are valid TOML basic strings
function syncCodexModelConfig(baseUrl, model) {
  const cfgPath = codexConfigPath();
  const provider = CODEX_BUNDLED_PROVIDER;
  let raw = '';
  try { raw = fs.readFileSync(cfgPath, 'utf8'); } catch (_) { raw = ''; }
  try { if (raw && !fs.existsSync(cfgPath + '.bak')) fs.writeFileSync(cfgPath + '.bak', raw); } catch (_) {}

  // Split into: top-level lines before the first section (minus the keys we own),
  // and everything from the first section onward (minus a provider block we wrote
  // earlier). Our provider TABLE must be emitted after all top-level keys, or TOML
  // would absorb them into it — that silently moved e.g. approval_policy into
  // [model_providers.agnes] and then dropped it on the next run.
  const ownSection = new RegExp('^\\[\\s*model_providers\\.' + provider + '\\s*\\]$', 'i');
  const pre = [], rest = [];
  let seenSection = false, droppingSection = false;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (/^\[/.test(t)) {
      seenSection = true;
      droppingSection = ownSection.test(t);
      if (!droppingSection) rest.push(line);
      continue;
    }
    if (droppingSection) continue;
    if (!seenSection) {
      if (/^model\s*=/.test(t) || /^model_provider\s*=/.test(t)) continue;
      pre.push(line);
    } else {
      rest.push(line);
    }
  }
  const trimBlankEdges = (arr) => {
    const out = arr.slice();
    while (out.length && out[0].trim() === '') out.shift();
    while (out.length && out[out.length - 1].trim() === '') out.pop();
    return out;
  };
  const preClean = trimBlankEdges(pre);
  const restClean = trimBlankEdges(rest);
  const parts = [
    `model = ${tomlStr(model)}`,
    `model_provider = ${tomlStr(provider)}`,
  ];
  if (preClean.length) parts.push('', ...preClean);
  parts.push(
    '',
    `[model_providers.${provider}]`,
    'name = "Agnes"',
    `base_url = ${tomlStr(baseUrl)}`,
    'env_key = "OPENAI_API_KEY"',
    // Codex 0.156+ removed the chat wire API ("`wire_api = "chat"` is no longer
    // supported"); the provider must speak the Responses API. agnes serves
    // POST /v1/responses, so this is the supported combination.
    'wire_api = "responses"',
  );
  if (restClean.length) parts.push('', ...restClean);
  fs.writeFileSync(cfgPath, parts.join('\n') + '\n');
  return { baseUrl, model, provider };
}

// --- Manifest validation (security) -----------------------------------------
function isSafeRel(p) {
  return typeof p === 'string' &&
         !/^[a-zA-Z]:[\\/]/.test(p) &&       // no absolute / drive
         !/^\/\//.test(p) &&                  // no UNC
         !p.split(/[\\/]/).includes('..');    // no traversal
}
function loadManifest() {
  let m;
  try {
    m = readJsonSafe(AGENTS_JSON, { strict: true, onStrippedBom: logStrippedBom });
  } catch (e) {
    if (e && e.code === 'EUNREADABLE') throw new Error('manifest unreadable: ' + safe(e.cause || e));
    throw new Error('manifest corrupt: invalid JSON');
  }
  if (!m || m.version !== 1 || !Array.isArray(m.agents)) throw new Error('manifest corrupt: bad structure');
  const ids = new Set();
  for (const a of m.agents) {
    if (!a.id || typeof a.id !== 'string' || !a.name) throw new Error('manifest corrupt: agent missing id/name');
    if (!isSafeRel(a.launcher || '') || !isSafeRel(a.checker || '')) {
      throw new Error('manifest corrupt: unsafe path in ' + a.id);
    }
    if (!a.workspace || typeof a.workspace !== 'string' || !isSafeRel(a.workspace)) {
      throw new Error('manifest corrupt: bad workspace in ' + a.id);
    }
    if (a.configPath !== null && (typeof a.configPath !== 'string' || !isSafeRel(a.configPath))) {
      throw new Error('manifest corrupt: bad configPath in ' + a.id);
    }
    if (!a.configAdapter || typeof a.configAdapter !== 'string') {
      throw new Error('manifest corrupt: missing configAdapter in ' + a.id);
    }
    if (!a.desktopAdapter || typeof a.desktopAdapter !== 'string') {
      throw new Error('manifest corrupt: missing desktopAdapter in ' + a.id);
    }
    if (ids.has(a.id)) throw new Error('manifest corrupt: duplicate id ' + a.id);
    ids.add(a.id);
  }
  return m;
}
function resolveInsideRoot(rel) {
  const abs = path.normalize(path.join(ROOT, rel.split('/').join(path.sep)));
  if (!abs.toLowerCase().startsWith(ROOT.toLowerCase())) throw new Error('path escapes mother folder');
  return abs;
}

// --- Platform-aware launcher command ----------------------------------------
function terminalCommand(scriptAbs) {
  if (process.platform === 'win32') {
    // Open a NEW visible console window via `cmd /c start ""`. The empty title "" makes start
    // treat the very next token as the program (not a title), which is the robust form when the
    // project root contains spaces (e.g. "E:\桌面\AI Agent 母盘"). The earlier version used a
    // real quoted title and start mis-parsed the spaced path, reporting "找不到文件 'Agent'".
    // Directly spawning powershell detached (without start) produced NO visible window for the
    // user, so we keep start but with the empty-title idiom.
    return {
      file: 'cmd.exe',
      args: ['/c', 'start', '', 'powershell.exe',
             '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', scriptAbs],
    };
  }
  throw new Error('Launcher on ' + process.platform + ' not yet implemented (Windows in this phase).');
}

// --- Probe (read-only) -------------------------------------------------------
// 控制台输出解码：优先按严格 UTF-8；字节流不是合法 UTF-8 时回退 GBK。
// 背景：PowerShell 5.1 向重定向管道输出用系统 ANSI 代码页（中文机器 = GBK），
// 按 utf8 解码会把中文路径（如 "E:\桌面\AI Agent 母盘"）撕成 U+FFFD（写入文件即 EF BF BD）。
// TextDecoder('gbk') 是 Node 内置（full-icu），无需新增依赖。
function decodeConsoleOutput(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  if (buf.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk').decode(buf);
  }
}

function probeVersion(agent) {
  return new Promise((resolve) => {
    let scriptAbs;
    try { scriptAbs = resolveInsideRoot(agent.launcher); }
    catch (e) { return resolve({ status: 'ERROR', version: '', error: safe(e) }); }
    if (!fs.existsSync(scriptAbs)) return resolve({ status: 'NOT FOUND', version: '' });
    const verArgs = agent.versionArgs || ['--version'];
    const file = 'powershell.exe';
    // 统一子进程输出编码为 UTF-8：PS 5.1 向重定向管道输出默认用系统 ANSI（GBK），
    // 而其内部调用的 Agent exe 透传 UTF-8 字节，同一管道混流两种编码——
    // 父进程无论按哪种解码都会毁掉另一半（claude-code 中文路径变 U+FFFD / hermes 的 · 变 路）。
    // 因此用 -Command 包装：先设 [Console]::OutputEncoding=UTF8 再调脚本，让整条流统一为 UTF-8；
    // decodeConsoleOutput 的 GBK 兜底仅作非 PS 子进程的保险。
    const scriptArg = scriptAbs.replace(/'/g, "''");
    const cmd = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; & '${scriptArg}' ${verArgs.join(' ')}`;
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd];
    try {
      const child = execFile(file, args, { cwd: ROOT, timeout: 12000, windowsHide: true, maxBuffer: 1 << 20, encoding: 'buffer' },
        (err, stdout) => {
          const out = decodeConsoleOutput(stdout);
          if (err && !out) return resolve({ status: 'ERROR', version: '', error: safe(err) });
          const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          const verLine = lines.find(l => !/^\[/.test(l) && /\d+\.\d+[\.\d]*/.test(l)) || (lines[0] || '');
          resolve({ status: 'READY', version: verLine });
        });
      child.on('error', (e) => resolve({ status: 'ERROR', version: '', error: safe(e) }));
    } catch (e) { resolve({ status: 'ERROR', version: '', error: safe(e) }); }
  });
}

// --- Launch (Phase 16.1B: delegated to AgentProcessManager; env logic reused) --
async function launchAgent(agent) {
  let scriptAbs;
  try { scriptAbs = resolveInsideRoot(agent.launcher); }
  catch (e) { log(`Agent=${agent.id} Action=Launch Result=FAIL reason=${safe(e)}`); return { ok: false, reason: safe(e) }; }
  if (!agent.enabled) return { ok: false, reason: 'disabled in manifest' };
  if (!fs.existsSync(scriptAbs)) {
    log(`Agent=${agent.id} Action=Launch Result=FAIL reason=start-script-not-found`);
    return { ok: false, reason: 'start script not found' };
  }
  const cfgId = agent.id === 'claude-code' ? 'claudeCode' : agent.id;
  // Build child env by REUSING existing DPAPI + provider adapter logic.
  const childEnv = { ...process.env };
  let injected = false, apiKeyPresent = false;

  // 1) Bundled defaults from config/providers.json (lowest priority).
  const bundled = buildBundledProviderEnv(cfgId);
  if (bundled) {
    Object.assign(childEnv, bundled.env);
    injected = true; apiKeyPresent = true;
    if (bundled.model && bundled.model.baseUrl && bundled.model.model) {
      try {
        if (cfgId === 'hermes') {
          syncHermesModelConfig(bundled.model.baseUrl, bundled.model.model);
        } else if (cfgId === 'codex') {
          syncCodexModelConfig(bundled.model.baseUrl, bundled.model.model);
        }
        log(`Agent=${agent.id} Action=SyncConfig Result=SUCCESS source=config/providers.json`);
      } catch (e) { log(`Agent=${agent.id} Action=SyncConfig Result=FAIL reason=` + safe(e)); }
    }
    log(`Agent=${agent.id} Action=ProviderEnv Result=SUCCESS source=config/providers.json`);
  }

  // 2) Explicit per-agent configuration (DPAPI secret) overrides the defaults.
  //    A leftover secret with an empty user-config entry (the state this machine
  //    was in: secrets/hermes.bin + secrets/codex.bin exist, but user-config.json
  //    has no baseUrl/model) used to abort the launch outright; if the bundled
  //    provider can supply the same bundle, fall through to it instead.
  if (hasSecret(cfgId)) {
    const cfg = loadUserConfig();
    const aCfg = cfg.agents[cfgId] || {};
    if (!aCfg.baseUrl || !aCfg.model) {
      if (!bundled) {
        return { ok: false, reason: 'API 配置不完整：API Key 不可用，请重新配置（缺少 Base URL / Model）。' };
      }
      log(`Agent=${agent.id} Action=Env Result=SKIP reason=user-config-incomplete using=config/providers.json`);
    } else {
      try {
        const plain = await loadSecretPlain(cfgId);
        if (plain) {
          const extra = buildAgentEnvExtra(aCfg.provider, aCfg.baseUrl, plain, aCfg.model);
          if (cfgId === 'hermes') {
            try { syncHermesModelConfig(aCfg.baseUrl, aCfg.model); log('Agent=hermes Action=SyncConfig Result=SUCCESS'); }
            catch (e) { log('Agent=hermes Action=SyncConfig Result=FAIL reason=' + safe(e)); }
            extra.HERMES_LAUNCHER_API_KEY = plain;
          }
          // Codex has the same need as Hermes: the endpoint lives in its own
          // config.toml, so a user-configured Base URL has to be written there or
          // Codex would keep using api.openai.com. Only reached when the DPAPI
          // secret decrypted successfully.
          if (cfgId === 'codex') {
            try { syncCodexModelConfig(aCfg.baseUrl, aCfg.model); log('Agent=codex Action=SyncConfig Result=SUCCESS source=user-config'); }
            catch (e) { log('Agent=codex Action=SyncConfig Result=FAIL reason=' + safe(e)); }
          }
          Object.assign(childEnv, extra);
          injected = true; apiKeyPresent = true;
        }
      } catch (e) { log('Agent=' + agent.id + ' Action=Env Result=FAIL reason=' + safe(e)); }
    }
  }
  // Delegate spawning + PID tracking to the Process Manager. The manifest's own
  // exePath is the launch target; the start script stays as a compatibility
  // fallback for entries that have no exePath.
  const r = await pm.startAgent(agent.id, {
    agent,
    exePath: agent.exePath || '',
    exeArgs: Array.isArray(agent.exeArgs) ? agent.exeArgs : [],
    cwd: agent.workspace || '',
    resolveScriptAbs: () => scriptAbs,
    matchToken: agent.processToken || '',
    buildEnv: async () => childEnv,
    log,
  });
  log(`Agent=${agent.id} Action=Launch Result=${r.ok ? 'SUCCESS' : 'FAIL'} injected=${injected} API_KEY_PRESENT=${apiKeyPresent} pid=${r.pid || '-'}`);
  return { ok: r.ok, pid: r.pid, injected };
}

// --- IPC (whitelisted; no arbitrary shell) ----------------------------------
function knownAgentId(id) {
  try { return loadManifest().agents.some(a => a.id === id); } catch (_) { return false; }
}

ipcMain.handle('manifest:get', async () => {
  try {
    const m = loadManifest();
    return { ok: true, launcherVersion: LAUNCHER_VERSION, root: ROOT, logPath: activeLogPath,
             logReadOnly: !fs.existsSync(LOG_DIR), agents: m.agents };
  } catch (e) { return { ok: false, error: safe(e) }; }
});

ipcMain.handle('agents:probe', async () => {
  try {
    const m = loadManifest();
    const out = [];
    for (const a of m.agents) {
      if (!a.enabled) { out.push({ id: a.id, name: a.name, status: 'DISABLED', version: '' }); continue; }
      const r = await probeVersion(a);
      out.push({ id: a.id, name: a.name, status: r.status, version: r.version, error: r.error || '' });
    }
    return { ok: true, results: out };
  } catch (e) { return { ok: false, error: safe(e) }; }
});

ipcMain.handle('agent:launch', async (_e, id) => {
  if (typeof id !== 'string' || !knownAgentId(id)) return { ok: false, reason: 'unknown agent' };
  try {
    const a = loadManifest().agents.find(x => x.id === id);
    return await launchAgent(a);
  } catch (e) { return { ok: false, reason: safe(e) }; }
});

ipcMain.handle('app:selfquit', () => { log('Event=Launcher AutoCloseAfterLaunch'); app.quit(); });
ipcMain.handle('agents:status', () => { try { return { ok: true, statuses: pm.getAllStatuses() }; } catch(e){ return { ok:false, error:safe(e) }; } });
ipcMain.handle('agent:status', (_e, id) => { try { return { ok: true, status: pm.getAgentStatus(id) }; } catch(e){ return { ok:false, error:safe(e) }; } });
ipcMain.handle('agent:stop', async (_e, id) => { try { if (!knownAgentId(id)) return { ok:false, reason:'unknown agent' }; const r = await pm.stopAgent(id, { log }); return { ok:true, ...r }; } catch(e){ return { ok:false, reason:safe(e) }; } });
ipcMain.handle('agents:start-all', async () => { try { const r = await startAllAgents(); return { ok:true, results:r }; } catch(e){ return { ok:false, error:safe(e) }; } });
ipcMain.handle('agents:stop-all', async () => { try { await stopAllAgents(); return { ok:true }; } catch(e){ return { ok:false, error:safe(e) }; } });
ipcMain.handle('app:request-quit', async (_e, choice) => {
  try {
    if (choice === 'keep-agents') { await hardQuit(false); return { ok:true }; }
    if (choice === 'stop-all') { await hardQuit(true); return { ok:true }; }
    return { ok:false, reason:'cancelled' };
  } catch(e){ return { ok:false, error:safe(e) }; }
});// Restart = stop the tracked PID tree first, then launch. Previously this called
// launchAgent() straight away, which left the old process orphaned and made the
// process manager reject the launch with `already-running`.
ipcMain.handle('agent:restart', async (_e, id) => {
  try {
    if (!knownAgentId(id)) return { ok: false, reason: 'unknown agent' };
    const stopped = await pm.stopAgent(id, { log });
    if (stopped && stopped.stopped === 0 && stopped.reason !== 'no pid') {
      return { ok: false, reason: 'stop failed: ' + (stopped.reason || 'unknown') };
    }
    await new Promise((r) => setTimeout(r, 800)); // let the console window be released
    const m = loadManifest().agents.find((a) => a.id === id);
    return await launchAgent(m);
  } catch (e) { return { ok: false, reason: safe(e) }; }
});
ipcMain.handle('app:quit', () => { log('Event=Launcher UserQuit'); app.quit(); });
ipcMain.handle('shell:openLogs', () => { try { shell.openPath(path.dirname(activeLogPath || LOG_DIR)); } catch (_) {} return true; });

// --- API configuration IPC (secrets never returned to renderer) ---------------
ipcMain.handle('api-config:get', async () => {
  try {
    const cfg = loadUserConfig();
    const out = {};
    for (const id of CONFIG_IDS) {
      const a = cfg.agents[id];
      let maskedKey = '';
      if (hasSecret(id)) {
        try {
          const blob = fs.readFileSync(secretPath(id), 'utf8');
          const plain = await dpapiUnprotect(blob);
          maskedKey = maskKey(plain);
        } catch (_) { maskedKey = '••••（无法读取）'; }
      }
      out[id] = { configured: hasSecret(id), provider: a.provider, baseUrl: a.baseUrl, model: a.model, enabled: a.enabled, maskedKey };
    }
    return { ok: true, agents: out };
  } catch (e) { return { ok: false, error: safe(e) }; }
});

ipcMain.handle('api-config:save', async (_e, payload) => {
  try {
    if (!payload || !CONFIG_IDS.includes(payload.id)) return { ok: false, reason: 'unknown agent' };
    const id = payload.id;
    const fields = {
      provider: String(payload.provider || ''),
      baseUrl: String(payload.baseUrl || '').trim(),
      model: String(payload.model || '').trim(),
      enabled: !!payload.enabled,
      apiKey: typeof payload.apiKey === 'string' ? payload.apiKey : '',
    };
    const errors = validateFields(fields);
    if (errors.length) return { ok: false, reason: 'validation', errors };
    // Persist non-sensitive config.
    const cfg = loadUserConfig();
    cfg.agents[id] = { provider: fields.provider, baseUrl: fields.baseUrl, model: fields.model, enabled: fields.enabled };
    saveUserConfig(cfg);
    // If a key was provided (and changed), store it DPAPI-encrypted.
    if (fields.apiKey) {
      const b64 = await dpapiProtect(fields.apiKey);
      fs.mkdirSync(SECRET_DIR, { recursive: true });
      fs.writeFileSync(secretPath(id), b64, 'utf8');
      log(`Event=ApiConfig Saved id=${id} hasKey=true (value redacted)`);
    } else {
      log(`Event=ApiConfig Saved id=${id} hasKey=kept`);
    }
    const masked = hasSecret(id) ? maskKey(await dpapiUnprotect(fs.readFileSync(secretPath(id), 'utf8')).catch(()=>'')) : '';
    return { ok: true, configured: hasSecret(id), maskedKey: fields.apiKey ? maskKey(fields.apiKey) : masked };
  } catch (e) {
    log(`Event=ApiConfig SaveFailed id=${payload && payload.id} reason=${safe(e)}`);
    return { ok: false, reason: safe(e) };
  }
});

ipcMain.handle('api-config:clear-secret', async (_e, id) => {
  try {
    if (!CONFIG_IDS.includes(id)) return { ok: false, reason: 'unknown agent' };
    try { fs.unlinkSync(secretPath(id)); } catch (_) {}
    log(`Event=ApiConfig Cleared id=${id}`);
    return { ok: true, configured: false };
  } catch (e) { return { ok: false, reason: safe(e) }; }
});

ipcMain.handle('api-config:validate', async (_e, fields) => {
  try {
    const errors = validateFields(fields || {});
    return { ok: true, errors, valid: errors.length === 0 };
  } catch (e) { return { ok: false, error: safe(e) }; }
});

// --- Phase 9: user-triggered connectivity test (1 request, no retry) --------
ipcMain.handle('provider:test', async (_e, cfgId) => {
  try {
    if (!CONFIG_IDS.includes(cfgId)) return { ok: false, reason: 'unknown agent' };
    const cfg = loadUserConfig();
    const a = cfg.agents[cfgId];
    const provider = a.provider;
    if (!provider || !a.baseUrl) return { ok: false, reason: '请先配置 Provider 与 Base URL。' };
    const plain = await loadSecretPlain(cfgId);
    if (!plain) return { ok: false, reason: '未配置 API Key。' };
    let result;
    if (provider === 'openai-compatible' || provider === 'custom') {
      result = await openaiPing(a.baseUrl, plain);
    } else if (provider === 'anthropic-compatible') {
      // Anthropic has no cheap public models-list endpoint; do NOT guess POST /messages here.
      result = { ok: false, status: 0, latencyMs: 0, kind: 'blocked', reason: 'anthropic-compatible 连接测试需最小推理请求，本阶段未自动发送以避免费用（NOT TESTED）' };
    } else {
      result = { ok: false, status: 0, latencyMs: 0, kind: 'blocked', reason: 'unknown provider' };
    }
    // Drop plaintext reference.
    const sanitized = (typeof plain === 'string') ? null : null;
    void sanitized;
    log(`Event=ProviderTest id=${cfgId} provider=${provider} httpStatus=${result.status||'-'} latency=${result.latencyMs}ms result=${result.ok?'OK':'FAIL'}`);
    return { ok: true, id: cfgId, ...result, message: statusMessage(result.kind, result.status) };
  } catch (e) {
    log(`Event=ProviderTestFail id=${cfgId} reason=${safe(e)}`);
    return { ok: false, reason: safe(e) };
  }
});

// --- Provider presets / model list / Responses-API connectivity --------------
// Table lives in Launcher/Config/provider-presets.json and is extensible: unknown
// fields are ignored, a missing file falls back to a built-in minimum. The preset
// id is a renderer-side concept only — what gets persisted as the agent's
// `provider` is the preset's `protocolKind` ('openai-compatible' /
// 'anthropic-compatible' / 'custom'), so user-config.json and every existing
// consumer (validateFields / buildAgentEnvExtra / provider:test) stay untouched.
const PROVIDER_PRESETS_FILE = path.join(CONFIG_DIR, 'provider-presets.json');
const MODEL_CACHE_FILE = path.join(CONFIG_DIR, 'model-cache.json');
const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // spec §2.4: cache is valid for 24h

// Kept in sync with the shipped JSON; a safety net, not a second source of truth.
const FALLBACK_PRESETS = {
  openai: { label: 'OpenAI', protocolKind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', modelsEndpoint: '/models', responsesEndpoint: '/responses', authHeader: 'Authorization', authPrefix: 'Bearer ', modelsFormat: 'openai', keyPlaceholder: 'sk-...' },
  anthropic: { label: 'Anthropic', protocolKind: 'anthropic-compatible', baseUrl: 'https://api.anthropic.com/v1', modelsEndpoint: '/models', responsesEndpoint: '/responses', authHeader: 'x-api-key', authPrefix: '', modelsFormat: 'anthropic', keyPlaceholder: 'sk-ant-...', extraHeaders: { 'anthropic-version': '2023-06-01' } },
  custom: { label: '自定义', protocolKind: 'custom', baseUrl: '', modelsEndpoint: '/models', responsesEndpoint: '/responses', authHeader: 'Authorization', authPrefix: 'Bearer ', modelsFormat: 'openai', keyPlaceholder: '••••••••' },
};

function normalizePreset(id, p) {
  const src = (p && typeof p === 'object') ? p : {};
  return {
    id,
    label: String(src.label || id),
    // Guard: an unknown protocolKind would break api-config:save validation.
    protocolKind: PROVIDERS.includes(src.protocolKind) ? src.protocolKind : 'openai-compatible',
    baseUrl: String(src.baseUrl || ''),
    modelsEndpoint: String(src.modelsEndpoint || '/models'),
    responsesEndpoint: String(src.responsesEndpoint || '/responses'),
    authHeader: String(src.authHeader || 'Authorization'),
    authPrefix: typeof src.authPrefix === 'string' ? src.authPrefix : 'Bearer ',
    extraHeaders: (src.extraHeaders && typeof src.extraHeaders === 'object') ? src.extraHeaders : null,
    modelsFormat: src.modelsFormat === 'anthropic' ? 'anthropic' : 'openai',
    keyPlaceholder: String(src.keyPlaceholder || ''),
  };
}

function loadProviderPresets() {
  const raw = readJsonSafe(PROVIDER_PRESETS_FILE, { defaultValue: null, onStrippedBom: logStrippedBom });
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, p] of Object.entries(raw)) {
      if (id.startsWith('_') || !p || typeof p !== 'object') continue;
      out[id] = normalizePreset(id, p);
    }
  }
  if (!Object.keys(out).length) {
    log('Event=ProviderPresets FallbackToBuiltin (file missing or empty)');
    for (const [id, p] of Object.entries(FALLBACK_PRESETS)) out[id] = normalizePreset(id, p);
  }
  return out;
}

// "https://x/v1" + "/models" -> "https://x/v1/models"; never doubles the suffix.
function presetUrl(baseUrl, endpoint) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  const ep = String(endpoint || '/models');
  const withSlash = ep.startsWith('/') ? ep : '/' + ep;
  return base.endsWith(withSlash) ? base : base + withSlash;
}

function presetHeaders(preset, key) {
  const h = { 'Accept': 'application/json' };
  if (key) h[preset.authHeader] = String(preset.authPrefix || '') + key;
  if (preset.extraHeaders) for (const [k, v] of Object.entries(preset.extraHeaders)) h[k] = String(v);
  return h;
}

// The renderer never gets the stored key back, so an empty form field means
// "use the DPAPI one". Both paths return the key only inside the main process.
async function resolveApiKey(payload) {
  const typed = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
  if (typed) return { key: typed, source: 'input' };
  if (payload.id && CONFIG_IDS.includes(payload.id)) {
    const saved = await loadSecretPlain(payload.id);
    if (saved && String(saved).trim()) return { key: String(saved).trim(), source: 'dpapi' };
  }
  return { key: '', source: 'none' };
}

// Defence in depth: a provider error body must never carry the key back out.
function redact(text, key) {
  let s = String(text == null ? '' : text);
  if (key) s = s.split(key).join('***');
  return s;
}
function firstLine(text, max) {
  const s = redact(text, null).replace(/\s+/g, ' ').trim();
  const n = max || 300;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function readModelCache() {
  const raw = readJsonSafe(MODEL_CACHE_FILE, { defaultValue: {}, onStrippedBom: logStrippedBom });
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}
function modelCacheKey(providerId, baseUrl) {
  return String(providerId || 'custom') + '|' + String(baseUrl || '').trim().replace(/\/+$/, '');
}
function writeModelCache(providerId, baseUrl, models) {
  try {
    const all = readModelCache();
    all[modelCacheKey(providerId, baseUrl)] = { models, fetchedAt: Date.now() };
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(MODEL_CACHE_FILE, JSON.stringify(all, null, 2), 'utf8');
  } catch (e) { log(`Event=ModelCache SaveFailed reason=${safe(e)}`); }
}
function extractModelIds(json) {
  const arr = Array.isArray(json) ? json
    : Array.isArray(json && json.data) ? json.data
      : Array.isArray(json && json.models) ? json.models : [];
  const ids = [];
  for (const m of arr) {
    const id = (typeof m === 'string') ? m : (m && (m.id || m.name));
    if (typeof id === 'string' && id.trim() && !ids.includes(id.trim())) ids.push(id.trim());
  }
  return ids;
}

// Same shape as openaiPing's failure mapping (timeout vs network). Node's fetch
// reports every transport failure as a bare "fetch failed", so surface e.cause
// (ENOTFOUND / ECONNREFUSED / certificate errors) instead of swallowing it.
function httpFailure(e, timeoutMs) {
  if (e && e.name === 'AbortError') return { ok: false, error: `请求超时（${Math.round(timeoutMs / 1000)} 秒）`, hint: '检查网络连通性或 Base URL 是否正确' };
  const cause = (e && e.cause) ? String(e.cause.code || e.cause.message || e.cause) : '';
  return {
    ok: false,
    error: cause ? `网络请求失败：${cause}` : safe(e),
    hint: '网络不可达：无法连接到该地址（检查 Base URL 域名与 DNS/代理设置）',
  };
}

// Read-only preset table for the renderer (no secrets, no internal fields).
ipcMain.handle('provider:presets', async () => {
  try {
    const presets = loadProviderPresets();
    const out = {};
    for (const [id, p] of Object.entries(presets)) {
      out[id] = {
        label: p.label, protocolKind: p.protocolKind, baseUrl: p.baseUrl,
        keyPlaceholder: p.keyPlaceholder, modelsEndpoint: p.modelsEndpoint, responsesEndpoint: p.responsesEndpoint,
      };
    }
    return { ok: true, presets: out };
  } catch (e) { return { ok: false, error: safe(e) }; }
});

ipcMain.handle('provider:fetch-models', async (_e, payload) => {
  const p = payload || {};
  const timeoutMs = 10000;
  let key = '', keySource = 'none';
  try {
    const presets = loadProviderPresets();
    const preset = presets[p.providerId] || normalizePreset('custom', { protocolKind: 'custom' });
    const baseUrl = String(p.baseUrl || preset.baseUrl || '').trim();
    if (!baseUrl) return { ok: false, error: '缺少 API Base URL', hint: '请先选择 Provider 或手动填写 Base URL' };
    const url = assertSafeHttpUrl(presetUrl(baseUrl, preset.modelsEndpoint));
    const resolved = await resolveApiKey(p);
    key = resolved.key; keySource = resolved.source;
    if (!key) return { ok: false, error: '未提供 API Key', hint: '请粘贴 API Key，或先在该 Agent 上保存一次密钥' };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(url.toString(), { method: 'GET', headers: presetHeaders(preset, key), redirect: 'manual', signal: ac.signal });
      const latencyMs = Date.now() - started;
      const text = await res.text().catch(() => '');
      let models = [];
      if (res.ok) models = extractModelIds((() => { try { return JSON.parse(text); } catch (_) { return null; } })());
      log(`Event=ProviderModels id=${p.id || '-'} provider=${p.providerId || '-'} httpStatus=${res.status} latency=${latencyMs}ms count=${models.length} API_KEY_PRESENT=${key ? 'true' : 'false'} API_KEY_SOURCE=${resolved.source}`);
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}: ${firstLine(redact(text, key))}`, hint: statusMessage('http', res.status) };
      if (!models.length) return { ok: false, status: res.status, error: '响应里没有可用的模型列表（已返回 200）', hint: '该端点返回的 JSON 结构不是 data[].id' };
      writeModelCache(p.providerId, baseUrl, models); // best-effort, failure is logged only
      return { ok: true, status: res.status, latencyMs, models, count: models.length, cached: false, apiKeySource: resolved.source };
    } finally { clearTimeout(timer); }
  } catch (e) {
    log(`Event=ProviderModelsFailed id=${p.id || '-'} provider=${p.providerId || '-'} API_KEY_PRESENT=${key ? 'true' : 'false'} API_KEY_SOURCE=${keySource} reason=${safe(e)}`);
    return httpFailure(e, timeoutMs);
  }
});

ipcMain.handle('provider:model-cache', async (_e, payload) => {
  try {
    const p = payload || {};
    const hit = readModelCache()[modelCacheKey(p.providerId, p.baseUrl)];
    if (!hit || !Array.isArray(hit.models) || !hit.models.length) return { ok: true, models: [], cached: false };
    const ageMs = Date.now() - (Number(hit.fetchedAt) || 0);
    if (!(ageMs >= 0 && ageMs < MODEL_CACHE_TTL_MS)) return { ok: true, models: [], cached: false, expired: true };
    return { ok: true, models: hit.models, fetchedAt: hit.fetchedAt, ageMs, cached: true };
  } catch (e) { return { ok: false, error: safe(e) }; }
});

// One POST {base}/responses, 0 retries, 15s. 200 = reachable; the status-specific
// hint is best-effort and deliberately does NOT try to reproduce Codex's tool use.
ipcMain.handle('provider:test-connection', async (_e, payload) => {
  const p = payload || {};
  const timeoutMs = 15000;
  let key = '', keySource = 'none';
  try {
    const presets = loadProviderPresets();
    const preset = presets[p.providerId] || normalizePreset('custom', { protocolKind: 'custom' });
    const baseUrl = String(p.baseUrl || preset.baseUrl || '').trim();
    const model = String(p.model || '').trim();
    if (!baseUrl) return { ok: false, error: '缺少 API Base URL', hint: '请先选择 Provider 或手动填写 Base URL' };
    if (!model) return { ok: false, error: '缺少 Model', hint: '请先填写或从模型列表里选择' };
    const url = assertSafeHttpUrl(presetUrl(baseUrl, preset.responsesEndpoint));
    const resolved = await resolveApiKey(p);
    key = resolved.key; keySource = resolved.source;
    if (!key) return { ok: false, error: '未提供 API Key', hint: '请粘贴 API Key，或先在该 Agent 上保存一次密钥' };
    const body = {
      model,
      input: 'ping',
      max_output_tokens: 8,
      tools: [{ type: 'function', name: 'ping', description: 'ping', parameters: { type: 'object', properties: {} } }],
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: Object.assign(presetHeaders(preset, key), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: ac.signal,
      });
      const latencyMs = Date.now() - started;
      const text = (await res.text().catch(() => ''));
      const detail = firstLine(redact(text, key));
      let hint = '';
      if (res.ok) hint = '';
      else if (res.status === 401 || res.status === 403) hint = 'API Key 无效或被拒';
      else if (res.status === 404) hint = `该提供商不支持 Responses API（或 Base URL 路径有误，已请求 ${preset.responsesEndpoint}）`;
      else if (res.status === 400 && /namespace/i.test(text)) hint = '该提供商不兼容 Codex 的 namespace 工具类型，建议换用官方 OpenAI';
      else if (res.status === 400) hint = '该提供商拒绝了该请求（400）：请对照上面的错误原文';
      else if (res.status === 429) hint = '请求过于频繁（429）：稍后再试';
      else if (res.status >= 500) hint = 'Provider 端临时故障，稍后再试';
      log(`Event=ProviderConnTest id=${p.id || '-'} provider=${p.providerId || '-'} model=${model} httpStatus=${res.status} latency=${latencyMs}ms result=${res.ok ? 'OK' : 'FAIL'} API_KEY_PRESENT=${key ? 'true' : 'false'} API_KEY_SOURCE=${resolved.source}${hint ? ' hint=' + hint : ''}`);
      if (res.ok) return { ok: true, status: res.status, latencyMs, apiKeySource: resolved.source };
      return { ok: false, status: res.status, latencyMs, error: `HTTP ${res.status}: ${detail}`, hint, apiKeySource: resolved.source };
    } finally { clearTimeout(timer); }
  } catch (e) {
    log(`Event=ProviderConnTestFailed id=${p.id || '-'} provider=${p.providerId || '-'} API_KEY_PRESENT=${key ? 'true' : 'false'} API_KEY_SOURCE=${keySource} reason=${safe(e)}`);
    return httpFailure(e, timeoutMs);
  }
});

// --- 第 2 步：登录层（SQLite + bcryptjs + JWT） ------------------------------
// 数据库与 JWT 密钥都放在 <ROOT>/Launcher/Data/app.db，随 U 盘走；初始化失败不阻塞
// 启动（auth:login 会返回 auth-unavailable），避免 U 盘只读/占用时整个应用打不开。
const auth = require('./auth-service.js');
const { registerAuthIpc } = require('./ipc-auth.js');
try {
  const authInit = auth.init({ root: ROOT, log });
  if (!authInit.ok) log(`Event=Auth Disabled reason=${authInit.error}`);
  registerAuthIpc({ ipcMain, auth, log });
} catch (e) {
  log(`Event=Auth WiringFailed reason=${safe(e)}`);
}

// --- Phase 12: local usage / cost statistics (no keys, no prompts) ----------
const usageStore = new UsageStore(ROOT);
usageStore.ensure();
// Seed an empty pricing registry if absent.
try {
  if (!fs.existsSync(usageStore.pricingFile)) {
    fs.mkdirSync(path.dirname(usageStore.pricingFile), { recursive: true });
    fs.writeFileSync(usageStore.pricingFile, JSON.stringify({ version: 1, currency: 'USD', providers: {} }, null, 2));
  }
} catch (_) {}

ipcMain.handle('usage:summary', async (_e, days) => {
  try {
    const d = Number.isInteger(days) ? days : 0;
    return { ok: true, ...usageStore.summarize(d), writable: usageStore.writable };
  } catch (e) { return { ok: false, error: safe(e) }; }
});
ipcMain.handle('usage:list', async () => {
  try { return { ok: true, records: usageStore.readAll() }; }
  catch (e) { return { ok: false, error: safe(e) }; }
});
ipcMain.handle('usage:clear', async () => {
  try {
    const r = usageStore.clear();
    log('Event=Usage Cleared all local usage history');
    return { ok: r };
  } catch (e) { return { ok: false, error: safe(e) }; }
});
ipcMain.handle('pricing:get', async () => {
  try { return { ok: true, pricing: usageStore.loadPricing() }; }
  catch (e) { return { ok: false, error: safe(e) }; }
});

// --- Phase 14: rich dashboard (recomputes cost from current pricing) ----------
ipcMain.handle('usage:dashboard', async (_e, days) => {
  try {
    const d = Number.isInteger(days) ? days : 0;
    return { ok: true, ...usageStore.dashboard(d), writable: usageStore.writable };
  } catch (e) { return { ok: false, error: safe(e) }; }
});

// --- Phase 14: sanitized CSV/JSON export (no secrets, no bodies) --------------
ipcMain.handle('usage:export', async (_e, format) => {
  try {
    const fmt = (format === 'csv') ? 'csv' : 'json';
    const r = usageStore.exportRecords(fmt);
    log(`Event=UsageExport format=${fmt} count=${r.count}`);
    shell.showItemInFolder(r.path);
    return { ok: true, path: r.path, count: r.count };
  } catch (e) { return { ok: false, error: safe(e) }; }
});

// --- Phase 14: pricing registry write (provider+model double match; a price entry
//     WITHOUT a source is rejected — never guess prices). -----------------------
ipcMain.handle('pricing:set', async (_e, entry) => {
  try {
    if (!entry || typeof entry !== 'object') return { ok: false, reason: 'bad entry' };
    const provider = String(entry.provider || '').trim().toLowerCase();
    const model = String(entry.model || '').trim();
    const source = String(entry.source || '').trim();
    if (!provider || !model) return { ok: false, reason: '缺少 provider 或 model' };
    if (!source) return { ok: false, reason: '拒绝写入：价格必须填写来源（source），不能凭空定价' };
    const inputPer = Number(entry.input_per_1m);
    const outputPer = Number(entry.output_per_1m);
    if (!isFinite(inputPer) || inputPer < 0 || !isFinite(outputPer) || outputPer < 0) {
      return { ok: false, reason: 'input/output 价格必须是非负数字' };
    }
    const pricing = usageStore.loadPricingRaw();
    pricing.providers = pricing.providers || {};
    const prov = pricing.providers[provider] = pricing.providers[provider] || { label: provider, models: {} };
    prov.models[model] = {
      input_per_1m: inputPer, output_per_1m: outputPer,
      cached_per_1m: (entry.cached_per_1m === '' || entry.cached_per_1m == null) ? null : Number(entry.cached_per_1m),
      reasoning_per_1m: (entry.reasoning_per_1m === '' || entry.reasoning_per_1m == null) ? null : Number(entry.reasoning_per_1m),
      effective_from: String(entry.effective_from || new Date().toISOString().slice(0, 10)),
      source, verified: true,
    };
    const saved = usageStore.savePricing(pricing);
    log(`Event=PricingSet provider=${provider} model=${model} source=present`);
    return { ok: true, pricing: saved };
  } catch (e) { return { ok: false, reason: safe(e) }; }
});

// --- Phase 13: explicit localhost usage proxy (user opt-in) ----------------
let usageProxy = null;
function providerTypeFor(agentId) {
  const cfg = loadUserConfig().agents[agentId] || {};
  return cfg.provider || 'openai-compatible';
}
function registerProxyUpstreams(p) {
  const cfg = loadUserConfig();
  for (const id of CONFIG_IDS) {
    const a = cfg.agents[id];
    if (a && a.baseUrl) { try { p.register(id, a.baseUrl); } catch (_) {} }
  }
}
ipcMain.handle('proxy:start', async () => {
  try {
    if (usageProxy && usageProxy.port) return { ok: true, running: true, port: usageProxy.port, baseUrl: usageProxy.urlBase };
    const p = new UsageProxy({ onRecord: (e) => usageStore.record(e), providerTypeOf: providerTypeFor });
    registerProxyUpstreams(p);
    const port = await p.start();
    usageProxy = p;
    log(`Event=UsageProxy Started port=${port}`);
    const bases = {};
    for (const id of CONFIG_IDS) {
      const a = loadUserConfig().agents[id];
      if (a && a.baseUrl) { try { bases[id] = `http://127.0.0.1:${port}/agent/${id}/v1`; } catch (_) {} }
    }
    return { ok: true, running: true, port, baseUrl: p.urlBase, perAgent: bases };
  } catch (e) { return { ok: false, error: safe(e) }; }
});
ipcMain.handle('proxy:stop', async () => {
  try { if (usageProxy) { await usageProxy.stop(); usageProxy = null; log('Event=UsageProxy Stopped'); } return { ok: true, running: false }; }
  catch (e) { return { ok: false, error: safe(e) }; }
});
ipcMain.handle('proxy:status', async () => {
  return { ok: true, running: !!(usageProxy && usageProxy.port), port: usageProxy ? usageProxy.port : null,
           baseUrl: usageProxy ? usageProxy.urlBase : null };
});

// --- Window ------------------------------------------------------------------
let win = null;

// 解析窗口该加载什么（第 3 步：前端迁到 Vite）：
//   - forceProd：显式 NODE_ENV=production 时强制走生产分支（未打包也能验证 renderer/dist）
//   - isDev：未强制生产，且（未打包 或 显式 NODE_ENV=development）→ 连 Vite 开发服务器
// 【重要】不能写成 NODE_ENV==='development' || !app.isPackaged：
//   那样未打包时 isDev 恒为 true，NODE_ENV=production electron . 永远进不了生产分支。
function resolveLoadTarget() {
  const forceProd = process.env.NODE_ENV === 'production';
  const isDev = !forceProd && (!app.isPackaged || process.env.NODE_ENV === 'development');
  if (isDev) return { dev: true, url: 'http://localhost:5173' };
  // 生产分支优先加载 Vite 产物 renderer/dist/index.html
  const distIndex = path.join(APP_DIR, 'renderer', 'dist', 'index.html');
  if (fs.existsSync(distIndex)) return { dev: false, file: distIndex, fallback: false };
  // 回退：renderer/dist 还没构建（没跑过 build:web）时，退回旧的原生 JS UI，保证不白屏。
  // 旧 index.html 与旧启动流程因此完整保留。
  return { dev: false, file: path.join(APP_DIR, 'index.html'), fallback: true };
}

function createWindow() {
  win = new BrowserWindow({
    // 三栏布局（左侧会话列表 + 右侧消息区/输入区）需要更宽的窗口，旧的 720×560 塞不下
    width: 1280, height: 800,
    // 允许用户调整大小，但限制最小可用尺寸，避免三栏被压垮
    minWidth: 960, minHeight: 600, resizable: true,
    title: 'AI Agent U盘版',
    // v2 亮色 UI（设计规范-v2 §2）：窗口底色换 Apple 灰，避免亮色界面出现前的暗色闪烁
    backgroundColor: '#f5f5f7',
    webPreferences: { preload: path.join(APP_DIR, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);

  const target = resolveLoadTarget();
  if (target.dev) {
    win.loadURL(target.url);
    // 开发期打开独立 DevTools 窗口，便于调试渲染层
    win.webContents.openDevTools({ mode: 'detach' });
    log('Event=Window LoadURL url=' + target.url);
  } else {
    win.loadFile(target.file);
    log('Event=Window LoadFile file=' + target.file + ' fallback=' + target.fallback);
  }
  // 记录 Electron 自己报告的实际窗口尺寸，用于验证尺寸改动是否真的生效
  try { const b = win.getBounds(); log('Event=Window Bounds width=' + b.width + ' height=' + b.height + ' resizable=' + win.isResizable()); } catch (_) {}

  // 页面加载结果落日志：渲染层白屏时能直接从 launcher.log 看出是"没加载完"还是"加载失败"
  win.webContents.on('did-finish-load', () => log('Event=Window DidFinishLoad url=' + win.webContents.getURL()));
  win.webContents.on('did-fail-load', (_ev, code, desc, url) => log('Event=Window DidFailLoad code=' + code + ' desc=' + desc + ' url=' + url));

  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); log('Event=Window Hidden to Tray'); refreshTray(); }
  });
}

const TRAY_ICON_DATAURL_VAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR42mNk+M9Qz0B1yq0hDgEAAAJ7AAL+L5LtRwAAAABJRU5ErkJggg==';
// --- Phase 16.2: Tray + lifecycle -------------------------------------------
let tray = null;
let quitting = false;

function broadcastStatus(payload) {
  try { if (win && !win.isDestroyed()) win.webContents.send('agent:status', payload); } catch (_) {}
}
pm.setStatusHook((p) => broadcastStatus(p));

function buildTrayMenu() {
  const running = Object.values(pm.getAllStatuses()).filter(s => s.status === 'RUNNING' || s.status === 'STARTING').length;
  return Menu.buildFromTemplate([
    { label: 'AI Agent U盘版', enabled: false },
    { type: 'separator' },
    { label: '打开 Launcher', click: showWindow },
    { label: '启动全部 Agent', click: () => startAllAgents() },
    { label: '停止全部 Agent', click: () => stopAllAgents() },
    { type: 'separator' },
    { label: running ? `退出 Launcher（${running} 个 Agent 运行中）` : '退出 Launcher', click: () => requestQuitFromTray() },
  ]);
}
function refreshTray() { if (tray) tray.setContextMenu(buildTrayMenu()); }
function createTray() {
  try {
    const img = nativeImage.createEmpty();
    tray = new Tray(img.isEmpty() ? nativeImage.createFromDataURL(TRAY_ICON_DATAURL_VAR) : img);
    tray.setToolTip('AI Agent U盘版');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', showWindow);
  } catch (e) { log('Event=TrayCreate Result=FAIL reason=' + safe(e)); tray = null; }
}
function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  win.show(); win.focus(); win.restore();
  refreshTray();
}
async function startAllAgents() {
  const m = loadManifest();
  const results = [];
  for (const a of m.agents) {
    try { results.push(await launchAgent(a)); } catch (e) { results.push({ ok: false, reason: safe(e) }); }
  }
  refreshTray();
  return results;
}
async function stopAllAgents() {
  const statuses = pm.getAllStatuses();
  const ids = Object.keys(statuses);
  for (const id of ids) { try { await pm.stopAgent(id, { log }); } catch (_) {} }
  refreshTray();
}
function hasRunningAgents() {
  return Object.values(pm.getAllStatuses()).some(s => s.status === 'RUNNING' || s.status === 'STARTING' || s.status === 'STOPPING');
}
function requestQuitFromTray() {
  // Ask renderer to show confirmation dialog; renderer calls app:request-quit with choice.
  if (win && !win.isDestroyed()) { win.show(); win.focus(); win.webContents.send('tray:request-quit'); }
  else { hardQuit(false); }
}
async function hardQuit(stopAgents) {
  quitting = true;
  try { if (stopAgents) await stopAllAgents(); } catch (_) {}
  try { if (usageProxy) await usageProxy.stop(); } catch (_) {}
  app.quit();
}
// --- Self-test (no GUI) ------------------------------------------------------
async function selftest() {
  try {
    const m = loadManifest();
    const results = [];
    for (const a of m.agents) {
      if (!a.enabled) { results.push({ id: a.id, status: 'DISABLED', version: '' }); continue; }
      const r = await probeVersion(a);
      results.push({ id: a.id, status: r.status, version: r.version, error: r.error || '' });
    }
    console.log('SELFTEST_JSON=' + JSON.stringify({ ok: true, launcherVersion: LAUNCHER_VERSION, results }));
  } catch (e) { console.log('SELFTEST_ERROR=' + safe(e)); }
  app.exit(0);
}

// --- Config self-test (no GUI, uses a FAKE key only) ------------------------
async function selftestConfig() {
  const FAKE = 'sk-test-1234567890';
  try {
    const id = 'openclaw';
    // 1. save non-sensitive + DPAPI key
    saveUserConfig((() => { const c = defaultUserConfig(); c.agents[id] = { provider:'openai-compatible', baseUrl:'https://example.com/v1', model:'m', enabled:true }; return c; })());
    const b64 = await dpapiProtect(FAKE);
    fs.mkdirSync(SECRET_DIR, { recursive: true });
    fs.writeFileSync(secretPath(id), b64, 'utf8');
    // 2. read back + unprotect
    const plain = await dpapiUnprotect(fs.readFileSync(secretPath(id), 'utf8'));
    // 3. scan files for plaintext leakage
    const files = [USER_CONFIG, path.join(ROOT,'Launcher','Logs','launcher.log')];
    let leaked = [];
    for (const f of files) { try { if (fs.existsSync(f) && fs.readFileSync(f,'utf8').includes(FAKE)) leaked.push(path.basename(f)); } catch(_){} }
    const inBlob = b64.includes(FAKE); // encrypted blob must NOT contain plaintext
    const inConfig = (fs.readFileSync(USER_CONFIG,'utf8').includes(FAKE));
    // 4. clear
    fs.unlinkSync(secretPath(id));
    const result = {
      savedPlainMatches: plain === FAKE,
      masked: maskKey(plain),
      keyInUserConfig: inConfig,
      keyInLog: leaked.includes('launcher.log'),
      keyInEncryptedBlob: inBlob,
      configuredAfterClear: !fs.existsSync(secretPath(id)),
    };
    console.log('CONFIG_SELFTEST=' + JSON.stringify(result));
  } catch (e) { console.log('CONFIG_SELFTEST_ERROR=' + safe(e)); }
  app.exit(0);
}

// --- Phase 9 self-test: local mock connectivity + child env injection ------
async function selftestP9() {
  const http = require('http');
  const FAKE = 'sk-test-1234567890';
  const out = {};
  try {
    const server = http.createServer((req, res) => {
      out.mockAuthHeader = (req.headers['authorization'] || '');
      if (/\/models(\?|$)/.test(req.url) && /^Bearer /.test(req.headers['authorization'] || '')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"object":"list","data":[]}');
      } else {
        res.writeHead(401); res.end('{"error":"unauthorized"}');
      }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/v1`;

    // 1. happy path
    const ok = await openaiPing(base, FAKE);
    out.happy = { ok: ok.ok, status: ok.status, headerSeen: out.mockAuthHeader };
    // 2. wrong key -> 401
    const bad = await openaiPing(base, 'sk-wrong-00000000');
    out.badKey = { ok: bad.ok, status: bad.status };
    // 3. URL guard rejects query-token and non-http
    try { assertSafeHttpUrl('http://x.test/?api_key=leak'); out.urlGuardQuery = false; }
    catch (_) { out.urlGuardQuery = true; }
    try { assertSafeHttpUrl('file:///etc/passwd'); out.urlGuardScheme = false; }
    catch (_) { out.urlGuardScheme = true; }
    // 4. child env injection: spawn node with OPENAI_API_KEY in env, print presence only
    const extra = buildAgentEnvExtra('openai-compatible', base, FAKE, 'm');
    const childEnv = { ...process.env, ...extra, ELECTRON_RUN_AS_NODE: '1' };
    const pres = await new Promise((resolveP) => {
      const c = spawn(process.execPath, ['-e', 'process.stdout.write("KEY_PRESENT="+(!!process.env.OPENAI_API_KEY)+" LEN="+((process.env.OPENAI_API_KEY||"").length))'], { env: childEnv, windowsHide: true });
      let o=''; c.stdout.on('data',d=>o+=d); c.on('close',()=>resolveP(o.trim()));
    });
    out.childEnv = { present: pres.includes('KEY_PRESENT=true'), lengthOk: pres.includes('LEN=18') };
    // 5. plaintext must not leak into log file during these calls
    await new Promise(r => setTimeout(r, 200));
    out.keyInLog = fs.existsSync(activeLogPath) && fs.readFileSync(activeLogPath,'utf8').includes(FAKE);
    server.close();
  } catch (e) { out.error = safe(e); }
  console.log('P9_SELFTEST=' + JSON.stringify(out));
  app.exit(0);
}

// --- Diagnostics: resolve + existence for each agent (no window) -------------
// --- Single instance lock -----------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    ensureLogDir();
    if (process.argv.includes('--selftest-config')) return selftestConfig();
    if (process.argv.includes('--selftest-p9')) return selftestP9();
    if (process.argv.includes('--selftest')) return selftest();
    log(`Event=Launcher Started v${LAUNCHER_VERSION} log=${activeLogPath}`);
    createWindow();
    createTray();
    win.on('show', () => { if(win && !win.isDestroyed()) win.webContents.send('agent:resync'); });
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { log('Event=Window All Closed (tray mode, no auto quit)'); /* tray keeps app alive */ });
}

// --- 13.22: Hermes ACP 会话桥（真实会话接线）---------------------------------
// 架构裁决：Hermes 原生会话（state.db）= Source of Truth；聚合器只维护索引
// （Launcher/Data/session-index.json）并经官方 ACP 通道驱动真实会话。
// 通道优先级（任务书 §六）：ACP（官方 API）→ CLI → 数据文件；本桥只用 ACP + 官方 CLI。
const { createHermesAcpGateway } = require('./hermes-acp-gateway');
const { createSessionIndex } = require('./session-index');

const hermesAcpCommand = () => path.join(ROOT, 'Agents', 'Hermes', 'bin', 'hermes-acp.exe');
const hermesHomeDir = () => path.join(ROOT, 'Agents', 'Hermes');
const sessionIndexFile = () => path.join(ROOT, 'Launcher', 'Data', 'session-index.json');
const sessionIndex = createSessionIndex({ filePath: sessionIndexFile(), log: (m) => log('session-index ' + m) });

let hermesGateway = null;
let hermesGatewayEnvBuilt = false;

/**
 * 组装 hermes-acp 子进程环境（复用 launchAgent 的既有注入链；本函数不读密钥值内容，
 * 只把 main 进程已解出的 env 传给子进程——密钥零接触边界不变）。
 * providers.json（bundled）优先，DPAPI 用户配置兜底；两者皆缺 → 空 env，
 * session/new 将以 provider-auth 诚实报错（不伪造成功）。
 */
async function hermesAcpEnv() {
  const env = {};
  const bundled = buildBundledProviderEnv('hermes');
  if (bundled) {
    Object.assign(env, bundled.env);
    if (bundled.model && bundled.model.baseUrl && bundled.model.model) {
      try { syncHermesModelConfig(bundled.model.baseUrl, bundled.model.model); } catch (e) { log('Agent=hermes Action=SyncConfig Result=FAIL source=acp reason=' + safe(e)); }
    }
    return env;
  }
  if (typeof hasSecret === 'function' && hasSecret('hermes')) {
    const cfg = loadUserConfig();
    const aCfg = cfg.agents['hermes'] || {};
    if (aCfg.baseUrl && aCfg.model) {
      try {
        const plain = await loadSecretPlain('hermes');
        if (plain) {
          env.HERMES_LAUNCHER_API_KEY = plain;
          try { syncHermesModelConfig(aCfg.baseUrl, aCfg.model); } catch (e) { log('Agent=hermes Action=SyncConfig Result=FAIL source=acp-user reason=' + safe(e)); }
        }
      } catch (e) { log('Agent=hermes Action=Env Result=FAIL source=acp reason=' + safe(e)); }
    }
  }
  return env;
}

async function getHermesGateway() {
  if (hermesGateway) return hermesGateway;
  const env = hermesGatewayEnvBuilt ? {} : await hermesAcpEnv();
  hermesGatewayEnvBuilt = true;
  hermesGateway = createHermesAcpGateway({
    command: hermesAcpCommand(),
    hermesHome: hermesHomeDir(),
    env,
    log: (m) => log('Agent=hermes Surface=acp ' + m),
  });
  log('Agent=hermes Action=AcpGateway Created envKeys=' + Object.keys(env).join(','));
  return hermesGateway;
}

function pushHermesEvent(payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    try { if (!w.isDestroyed()) w.webContents.send('hermes:session:event', payload); } catch (_) {}
  }
}

// 会话列表：官方 session/list → 索引同步（Native → Index；orphan 检测在索引内）
ipcMain.handle('hermes:session:list', async () => {
  try {
    const gw = await getHermesGateway();
    const natives = await gw.listSessions();
    const rows = sessionIndex.sync('hermes', natives);
    return { ok: true, sessions: rows };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

// 新建会话：官方 session/new → 索引单条登记（不触发 orphan 扫描）
ipcMain.handle('hermes:session:create', async (_e, params) => {
  try {
    const gw = await getHermesGateway();
    const s = await gw.createSession({ cwd: hermesHomeDir() });
    sessionIndex.upsert('hermes', s.nativeSessionId, { title: (params && params.title) || '' });
    return { ok: true, session: s };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

// 打开会话：官方 session/load（历史经原生事件重放返回，不读 state.db）
ipcMain.handle('hermes:session:open', async (_e, nativeSessionId) => {
  try {
    const gw = await getHermesGateway();
    const r = await gw.loadSession(String(nativeSessionId));
    return { ok: true, session: r, history: r.history || [] };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

// 发送：官方 session/prompt（阻塞到回合结束，过程经 session/update 流式推送）
ipcMain.handle('hermes:session:send', async (_e, payload) => {
  const nativeSessionId = String((payload && payload.nativeSessionId) || '');
  const text = String((payload && payload.text) || '');
  try {
    const gw = await getHermesGateway();
    let preview = '';
    for await (const ev of gw.streamMessage(nativeSessionId, text)) {
      pushHermesEvent({ nativeSessionId, event: ev });
      if (ev.type === 'text_delta') preview += ev.text;
      if (ev.type === 'session_info' && ev.title) sessionIndex.update('hermes', nativeSessionId, { title: ev.title });
    }
    if (preview) sessionIndex.update('hermes', nativeSessionId, { lastMessagePreview: preview.slice(-200), orphaned: false });
    return { ok: true };
  } catch (e) {
    // 真实失败必须让 UI 看到回合终止（任务书 §十四：禁止失败后显示「任务完成」）
    pushHermesEvent({ nativeSessionId, event: { type: 'error', message: safe(e), code: e.code || 'protocol' } });
    return { ok: false, error: safe(e), code: e.code || 'protocol' };
  }
});

// 停止：官方 session/cancel（回合已自然结束时 cancel 报错，按「已停止」处理不伪造失败）
ipcMain.handle('hermes:session:stop', async (_e, nativeSessionId) => {
  try {
    const gw = await getHermesGateway();
    await gw.stopGeneration(String(nativeSessionId));
    return { ok: true };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

// 索引元数据（置顶/展示名/归档）——只写索引，不触原生数据
ipcMain.handle('hermes:index:update', (_e, payload) => {
  try {
    const { nativeSessionId, patch } = payload || {};
    const r = sessionIndex.update('hermes', String(nativeSessionId), patch || {});
    return { ok: !!r, entry: r };
  } catch (e) { return { ok: false, error: safe(e) }; }
});
ipcMain.handle('hermes:index:remove', (_e, nativeSessionId) => {
  try { return { ok: sessionIndex.remove('hermes', String(nativeSessionId)) }; }
  catch (e) { return { ok: false, error: safe(e) }; }
});

// 删除原生会话：官方 CLI（hermes sessions delete <id> --yes；state.db 官方删除途径）。
// 破坏性操作，UI 侧已二次确认；成功后同步移除索引条目。
ipcMain.handle('hermes:session:delete', async (_e, nativeSessionId) => {
  const id = String(nativeSessionId || '');
  try {
    const hermesExe = path.join(ROOT, 'Agents', 'Hermes', 'bin', 'hermes.exe');
    await new Promise((resolve, reject) => {
      const { spawn: spawnProc } = require('child_process');
      const p = spawnProc(hermesExe, ['sessions', 'delete', id, '--yes'], {
        cwd: hermesHomeDir(),
        env: { ...process.env, HERMES_HOME: hermesHomeDir() },
        windowsHide: true,
        stdio: 'ignore',
      });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('hermes sessions delete exit=' + code))));
      p.on('error', reject);
    });
    sessionIndex.remove('hermes', id);
    return { ok: true };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

// --- 13.23: 四 Agent 统一会话桥（openclaw / codex / claude-code）--------------
// 架构裁决与 13.22 Hermes 先例一致：Agent 原生会话 = Source of Truth；聚合器只持索引。
// hermes 老通道（hermes:*）保留不动；其余三 Agent 走统一 agents:session:* 通道，
// 事件经统一广播 agents:session:event（载荷带 agentId）。
const { createOpenClawGateway } = require('./openclaw-gateway');
const { createCodexAppServer } = require('./codex-appserver');
const { createClaudeCliBridge } = require('./claude-cli-bridge');

function sessionNodeExe() {
  const bundled = path.join(ROOT, 'Runtime', 'Node', 'node.exe');
  return fs.existsSync(bundled) ? bundled : process.execPath;
}

/**
 * 会话桥 provider env（复用既有注入链；密钥值不出主进程，仅进子进程 env 块）。
 * providers.json（bundled）优先；DPAPI 用户配置兜底。openclaw 无 provider env
 * （凭据归 OpenClaw 自己的 state，密钥零接触不读）。
 */
async function sessionAgentEnv(agentId) {
  if (agentId === 'openclaw') return {};
  const cfgId = agentId === 'claude-code' ? 'claudeCode' : agentId;
  const secretId = agentId === 'claude-code' ? 'claude' : agentId;
  const bundled = buildBundledProviderEnv(cfgId);
  if (bundled) {
    const env = { ...bundled.env };
    if (agentId === 'codex' && bundled.model && bundled.model.baseUrl && bundled.model.model) {
      try { syncCodexModelConfig(bundled.model.baseUrl, bundled.model.model); } catch (e) { log('Agent=codex Action=SyncConfig Result=FAIL source=session-bridge reason=' + safe(e)); }
    }
    return env;
  }
  const env = {};
  if (typeof hasSecret === 'function' && hasSecret(secretId)) {
    try {
      const cfg = loadUserConfig();
      const aCfg = (cfg.agents && (cfg.agents[secretId] || cfg.agents[agentId])) || {};
      if (aCfg.baseUrl && aCfg.model) {
        const plain = await loadSecretPlain(secretId);
        if (plain) {
          if (agentId === 'codex') {
            env.OPENAI_API_KEY = plain;
            if (aCfg.baseUrl) env.OPENAI_BASE_URL = aCfg.baseUrl;
            try { syncCodexModelConfig(aCfg.baseUrl, aCfg.model); } catch (e) { log('Agent=codex Action=SyncConfig Result=FAIL source=session-bridge-user reason=' + safe(e)); }
          } else {
            env.ANTHROPIC_API_KEY = plain;
            if (aCfg.baseUrl) env.ANTHROPIC_BASE_URL = aCfg.baseUrl;
            if (aCfg.model) env.ANTHROPIC_MODEL = aCfg.model;
            env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1';
          }
        }
      }
    } catch (e) { log('Agent=' + agentId + ' Action=Env Result=FAIL source=session-bridge reason=' + safe(e)); }
  }
  return env;
}

let openclawGateway = null;
let codexAppServer = null;
let claudeCliBridge = null;

async function getOpenClawGateway() {
  if (openclawGateway) return openclawGateway;
  openclawGateway = createOpenClawGateway({
    nodeExe: sessionNodeExe(),
    openclawEntry: path.join(ROOT, 'Agents', 'OpenClaw', 'App', 'node_modules', 'openclaw', 'openclaw.mjs'),
    openclawAppDir: path.join(ROOT, 'Agents', 'OpenClaw', 'App'),
    stateDir: path.join(ROOT, 'Agents', 'OpenClaw', 'Data'),
    configPath: path.join(ROOT, 'Agents', 'OpenClaw', 'Config', 'config.yaml'),
    deviceFile: path.join(ROOT, 'Launcher', 'Data', 'openclaw-device.json'),
    gatewayTokenFile: path.join(ROOT, 'Launcher', 'Data', 'openclaw-gateway-token.json'),
    env: await sessionAgentEnv('openclaw'),
    log: (m) => log('Agent=openclaw Surface=gateway ' + m),
  });
  return openclawGateway;
}

async function getCodexAppServer() {
  if (codexAppServer) return codexAppServer;
  codexAppServer = createCodexAppServer({
    nodeExe: sessionNodeExe(),
    codexEntry: path.join(ROOT, 'Agents', 'Codex', 'App', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    codexHome: path.join(ROOT, 'Agents', 'Codex'),
    env: await sessionAgentEnv('codex'),
    log: (m) => log('Agent=codex Surface=app-server ' + m),
  });
  return codexAppServer;
}

async function getClaudeCliBridge() {
  if (claudeCliBridge) return claudeCliBridge;
  claudeCliBridge = createClaudeCliBridge({
    // 安装器把 wrapper 包 bin/claude.exe 改名为 .old；真身在 win32-x64 平台包
    command: path.join(ROOT, 'Agents', 'ClaudeCode', 'App', 'node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'claude.exe'),
    wrapperEntry: path.join(ROOT, 'Agents', 'ClaudeCode', 'App', 'node_modules', '@anthropic-ai', 'claude-code', 'cli-wrapper.cjs'),
    nodeExe: sessionNodeExe(),
    configDir: path.join(ROOT, 'Agents', 'ClaudeCode'),
    workspace: path.join(ROOT, 'Agents', 'ClaudeCode'),
    env: await sessionAgentEnv('claude-code'),
    log: (m) => log('Agent=claude-code Surface=cli ' + m),
  });
  attachClaudeCliBridgeEvents(claudeCliBridge);
  return claudeCliBridge;
}

/** 统一事件广播：载荷带 agentId（hermes 老通道 hermes:session:event 保留不动） */
function pushAgentSessionEvent(agentId, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    try { if (!w.isDestroyed()) w.webContents.send('agents:session:event', { agentId, ...payload }); } catch (_) {}
  }
}

function sessionBridgeFor(agentId) {
  if (agentId === 'openclaw') return getOpenClawGateway();
  if (agentId === 'codex') return getCodexAppServer();
  if (agentId === 'claude-code') return getClaudeCliBridge();
  return null;
}

/** claude-code 无官方会话列表/删除：能力裁决落在主进程，渲染层按 code 渲染 */
const NATIVE_SESSION_SUPPORT = {
  openclaw: { rename: 'native', archive: 'native', delete: 'native' },
  codex: { rename: 'native', archive: 'native', delete: 'native' },
  'claude-code': { rename: 'index', archive: 'index', delete: 'unsupported' },
};

// 会话列表：官方接口（openclaw sessions.list / codex thread/list）→ 索引同步；
// claude-code 无官方列表 → 只回索引条目（nativeSync:false，不伪造原生同步）
ipcMain.handle('agents:session:list', async (_e, agentId) => {
  const id = String(agentId || '');
  try {
    if (id === 'claude-code') {
      return { ok: true, sessions: sessionIndex.all().filter((r) => r.agentId === 'claude-code'), nativeSync: false };
    }
    const bridge = await sessionBridgeFor(id);
    if (!bridge) return { ok: false, error: 'unknown agent: ' + id, code: 'unsupported' };
    const natives = await bridge.listSessions();
    const rows = sessionIndex.sync(id, natives);
    return { ok: true, sessions: rows, nativeSync: true };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

ipcMain.handle('agents:session:create', async (_e, payload) => {
  const { agentId, params } = payload || {};
  const id = String(agentId || '');
  try {
    const bridge = await sessionBridgeFor(id);
    if (!bridge) return { ok: false, error: 'unknown agent: ' + id, code: 'unsupported' };
    const s = await bridge.createSession(params || {});
    sessionIndex.upsert(id, s.nativeSessionId, { title: (params && params.title) || '' });
    return { ok: true, session: s };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

ipcMain.handle('agents:session:open', async (_e, payload) => {
  const { agentId, nativeSessionId } = payload || {};
  const id = String(agentId || '');
  try {
    const bridge = await sessionBridgeFor(id);
    if (!bridge) return { ok: false, error: 'unknown agent: ' + id, code: 'unsupported' };
    const r = await bridge.loadSession(String(nativeSessionId));
    return { ok: true, session: r, history: r.history || [], historyNote: r.historyNote };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

ipcMain.handle('agents:session:send', async (_e, payload) => {
  const { agentId, nativeSessionId, text } = payload || {};
  const id = String(agentId || '');
  const sid = String(nativeSessionId || '');
  try {
    const bridge = await sessionBridgeFor(id);
    if (!bridge) return { ok: false, error: 'unknown agent: ' + id, code: 'unsupported' };
    let preview = '';
    for await (const ev of bridge.streamMessage(sid, String(text ?? ''))) {
      pushAgentSessionEvent(id, { nativeSessionId: sid, event: ev });
      if (ev.type === 'text_replace') preview = ev.text;
      else if (ev.type === 'text_delta') preview += ev.text;
      if (ev.type === 'session_info' && ev.title) sessionIndex.update(id, sid, { title: ev.title });
    }
    if (preview) sessionIndex.update(id, sid, { lastMessagePreview: preview.slice(-200), orphaned: false });
    return { ok: true };
  } catch (e) {
    // 真实失败必须让 UI 看到回合终止（禁止失败后显示「任务完成」）
    pushAgentSessionEvent(id, { nativeSessionId: sid, event: { type: 'error', message: safe(e), code: e.code || 'protocol' } });
    // --resume 失败 = 官方探测到孤儿会话 → 索引标记（不伪造、不自动重建）
    if (id === 'claude-code' && e.code === 'session-not-found') {
      try { sessionIndex.update(id, sid, { orphaned: true }); } catch (_) {}
    }
    return { ok: false, error: safe(e), code: e.code || 'protocol' };
  }
});

ipcMain.handle('agents:session:stop', async (_e, payload) => {
  const { agentId, nativeSessionId } = payload || {};
  try {
    const bridge = await sessionBridgeFor(String(agentId || ''));
    if (!bridge) return { ok: false, error: 'unknown agent', code: 'unsupported' };
    await bridge.stopGeneration(String(nativeSessionId || ''));
    return { ok: true };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

ipcMain.handle('agents:session:delete', async (_e, payload) => {
  const { agentId, nativeSessionId } = payload || {};
  const id = String(agentId || '');
  const sid = String(nativeSessionId || '');
  if ((NATIVE_SESSION_SUPPORT[id] || {}).delete === 'unsupported') {
    return { ok: false, error: `${id} 无官方会话删除接口（能力裁决 UNSUPPORTED）`, code: 'unsupported' };
  }
  try {
    const bridge = await sessionBridgeFor(id);
    if (!bridge) return { ok: false, error: 'unknown agent: ' + id, code: 'unsupported' };
    await bridge.deleteSession(sid);
    sessionIndex.remove(id, sid);
    return { ok: true };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

// 重命名：openclaw/codex=官方原生（sessions.patch label / thread/name/set）+ 索引；
// claude-code=仅聚合器索引语义（无官方途径，与 Hermes rename 同级，返回 indexOnly）
ipcMain.handle('agents:session:rename', async (_e, payload) => {
  const { agentId, nativeSessionId, title } = payload || {};
  const id = String(agentId || '');
  const sid = String(nativeSessionId || '');
  const clean = String(title || '').trim();
  try {
    if ((NATIVE_SESSION_SUPPORT[id] || {}).rename === 'native') {
      const bridge = await sessionBridgeFor(id);
      if (!bridge) return { ok: false, error: 'unknown agent: ' + id, code: 'unsupported' };
      await bridge.renameSession(sid, clean);
    }
    const r = sessionIndex.update(id, sid, clean ? { title: clean, titleSource: 'user' } : {});
    return { ok: !!r, indexOnly: (NATIVE_SESSION_SUPPORT[id] || {}).rename !== 'native' };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

// 归档/恢复：openclaw/codex=官方原生 + 索引；claude-code=仅索引
ipcMain.handle('agents:session:archive', async (_e, payload) => {
  const { agentId, nativeSessionId, archived } = payload || {};
  const id = String(agentId || '');
  const sid = String(nativeSessionId || '');
  try {
    if ((NATIVE_SESSION_SUPPORT[id] || {}).archive === 'native') {
      const bridge = await sessionBridgeFor(id);
      if (!bridge) return { ok: false, error: 'unknown agent: ' + id, code: 'unsupported' };
      await bridge.archiveSession(sid, archived !== false);
    }
    const r = sessionIndex.update(id, sid, { archived: archived !== false });
    return { ok: !!r, indexOnly: (NATIVE_SESSION_SUPPORT[id] || {}).archive !== 'native' };
  } catch (e) { return { ok: false, error: safe(e), code: e.code || 'protocol' }; }
});

// 索引元数据（置顶/展示名/归档）——只写索引，不触原生
ipcMain.handle('agents:index:update', (_e, payload) => {
  try {
    const { agentId, nativeSessionId, patch } = payload || {};
    const r = sessionIndex.update(String(agentId || ''), String(nativeSessionId || ''), patch || {});
    return { ok: !!r, entry: r };
  } catch (e) { return { ok: false, error: safe(e) }; }
});
ipcMain.handle('agents:index:remove', (_e, payload) => {
  try {
    const { agentId, nativeSessionId } = payload || {};
    return { ok: sessionIndex.remove(String(agentId || ''), String(nativeSessionId || '')) };
  } catch (e) { return { ok: false, error: safe(e) }; }
});

// claude-code 官方 init 消息 → 索引登记（原生 session_id 真源键）
let claudeCliBridgeAttached = false;
function attachClaudeCliBridgeEvents(bridge) {
  if (claudeCliBridgeAttached) return;
  claudeCliBridgeAttached = true;
  bridge.onEvent((kind, info) => {
    if (kind === 'init' && info && info.native) {
      try { sessionIndex.upsert('claude-code', String(info.native), {}); } catch (_) {}
    }
  });
}

app.on('before-quit', () => {
  try { if (hermesGateway) { hermesGateway.close(); hermesGateway = null; } } catch (_) {}
  try { if (openclawGateway) { openclawGateway.close(); openclawGateway = null; } } catch (_) {}
  try { if (codexAppServer) { codexAppServer.close(); codexAppServer = null; } } catch (_) {}
  try { if (claudeCliBridge) { claudeCliBridge.close(); claudeCliBridge = null; } } catch (_) {}
});

// --- Exports for the standalone test scripts (Launcher/App/*_test.cjs) -------
// The Electron entry point itself never reads module.exports. Exposing the real
// functions lets the BOM/config tests exercise this exact code (with a stubbed
// `electron` module) instead of duplicating its logic.
module.exports = {
  loadUserConfig, saveUserConfig, defaultUserConfig,
  bundledProvider, buildBundledProviderEnv, loadManifest,
  syncCodexModelConfig,
  readJsonSafe, stripBom, safe,
  ensureLogDir, getLogPath: () => activeLogPath,
  ROOT, USER_CONFIG, AGENTS_JSON, LOG_DIR, CONFIG_IDS,
};
