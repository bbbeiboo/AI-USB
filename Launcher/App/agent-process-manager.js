// Phase 16.1B — Agent Process Manager
//
// Launches each agent's REAL executable directly and tracks it by its own PID.
// Spawn form (verified empirically on this machine, see _pm_test/probe-console2.cjs):
//
//   spawn('cmd.exe', ['/c', exePath, ...exeArgs],
//         { detached: true, windowsHide: false, stdio: 'ignore', cwd, env })
//
// `detached: true` makes Windows create a NEW console for the child, which is
// what the agent TUIs (hermes / codex / claude / openclaw) require — with
// `detached: false` they inherit the parent console, and since the Launcher is a
// GUI process with no console, they die within seconds (measured: hermes.exe
// survives with detached:true, dies with detached:false).
//
// `cmd /c <target>` keeps cmd.exe alive for as long as the agent runs, so
// child.pid is a stable root for tree-kill. Deliberately NOT used:
//   - `cmd /c start "" ...` -> cmd exits immediately and the PID is lost
//   - `cmd /k ...`          -> leaves an empty console after the agent exits
//   - powershell -NoExit    -> leaves an empty shell as the "tracked" process
//
// Runtime status lives here (STOPPED/STARTING/RUNNING/STOPPING/ERROR) and is
// mirrored into a small persistent store so a restarted Launcher can re-adopt
// agents that are still alive.

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const kill = require('tree-kill');
const { readJsonSafe } = require('./json-util.js');

const records = new Map(); // agentId -> record
// Every PID we have ever tracked for an agent.
// getAgentStatus() zeroes rootPid/pid (and drops the persisted copy) the moment
// the process is gone, so `records.get(agentId)` alone can still say "was
// started" but no longer knows the PID — and the stop wording needs that PID.
const lastTrackedPid = new Map(); // agentId -> pid
let statusHook = null;
function setStatusHook(fn) { statusHook = typeof fn === 'function' ? fn : null; }
function notify(rec) {
  if (statusHook && rec && rec.agentId) {
    try { statusHook({ id: rec.agentId, status: rec.status, pid: rec.rootPid || null, startedAt: rec.startedAt || null }); } catch (_) {}
  }
}

function setRec(agentId, patch) {
  const cur = records.get(agentId) || {};
  const next = { ...cur, ...patch, agentId };
  records.set(agentId, next);
  if (next.rootPid) lastTrackedPid.set(agentId, next.rootPid);
  notify(next);
  return next;
}

// --- Portable root + persistent state ---------------------------------------
let PORTABLE_ROOT = null;
let store = null;
let adopted = false;

// Called once by main.js with the resolved project root. Until then the manager
// still works from process.cwd(), which is what the standalone smoke test uses.
function configure(opts) {
  const root = opts && opts.root;
  if (root && typeof root === 'string') PORTABLE_ROOT = path.resolve(root);
  if (!adopted) { adopted = true; adoptSavedRecords(); }
  return { root: PORTABLE_ROOT };
}

function rootDir() { return PORTABLE_ROOT || process.cwd(); }

// Dotted-path JSON store used when electron-store is unavailable (plain node:
// the smoke test) or cannot be constructed (no Electron app object).
function createJsonFileStore(file) {
  let cache = null;
  function load() {
    if (cache) return cache;
    // BOM-tolerant read (see json-util.js): a BOM written by a Windows editor is
    // stripped instead of making the whole state file look empty.
    cache = readJsonSafe(file, { defaultValue: {} });
    if (!cache || typeof cache !== 'object') cache = {};
    return cache;
  }
  function save() {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(load(), null, 2)); } catch (_) {}
  }
  function walk(key, make) {
    const parts = String(key).split('.');
    let node = load();
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) {
        if (!make) return { parent: null, leaf: parts[parts.length - 1] };
        node[parts[i]] = {};
      }
      node = node[parts[i]];
    }
    return { parent: node, leaf: parts[parts.length - 1] };
  }
  return {
    get(key, def) {
      const { parent, leaf } = walk(key, false);
      if (!parent) return def;
      return parent[leaf] === undefined ? def : parent[leaf];
    },
    set(key, value) { const { parent, leaf } = walk(key, true); if (parent) { parent[leaf] = value; save(); } },
    delete(key) { const { parent, leaf } = walk(key, false); if (parent && leaf) { delete parent[leaf]; save(); } },
  };
}

function getStore() {
  if (store) return store;
  // electron-store v11 is ESM-only and needs the Electron app object, so it is
  // required defensively: `require()` returns the module namespace (use
  // .default) and construction throws outside Electron.
  try {
    const mod = require('electron-store');
    const Store = mod && (mod.default || mod);
    if (typeof Store === 'function') {
      const s = new Store({ name: 'agent-state', cwd: path.join(rootDir(), 'Launcher', 'Data') });
      s.set('__probe', 1); s.delete('__probe'); // force a real read/write, prove usability
      store = s;
      return store;
    }
  } catch (_) { /* fall through to the JSON store */ }
  store = createJsonFileStore(PORTABLE_ROOT
    ? path.join(PORTABLE_ROOT, 'Launcher', 'Data', 'agent-state.json')
    : path.join(os.tmpdir(), 'ai-usb-agent-state.json'));
  return store;
}

function persist(agentId, rec) { try { getStore().set('agents.' + agentId, rec); } catch (_) {} }
function forget(agentId) { try { getStore().delete('agents.' + agentId); } catch (_) {} }

function isPidAlive(pid) {
  const n = parseInt(pid, 10);
  if (!n || n <= 0) return false;
  try { process.kill(n, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; }
}

// Re-adopt agents that are still running from a previous Launcher session.
function adoptSavedRecords() {
  let saved = {};
  try { saved = getStore().get('agents', {}) || {}; } catch (_) { saved = {}; }
  for (const [agentId, rec] of Object.entries(saved)) {
    const pid = rec && rec.pid;
    if (pid && isPidAlive(pid)) {
      setRec(agentId, {
        rootPid: pid, pid, status: 'RUNNING',
        startedAt: (rec && rec.startedAt) || null, exe: (rec && rec.exe) || null,
        adopted: true,
      });
    } else {
      forget(agentId);
    }
  }
}

function isRunning(agentId) {
  const r = records.get(agentId);
  if (!r) return false;
  if (r.status !== 'RUNNING' && r.status !== 'STARTING') return false;
  return isPidAlive(r.rootPid);
}

function getAgentStatus(agentId) {
  const r = records.get(agentId);
  if (!r) return { agentId, status: 'STOPPED', pid: null };
  // A record whose process has vanished must not keep reporting RUNNING.
  if ((r.status === 'RUNNING' || r.status === 'STARTING') && !isPidAlive(r.rootPid)) {
    setRec(agentId, { status: 'STOPPED', rootPid: null, pid: null, startedAt: null });
    forget(agentId);
    const gone = records.get(agentId);
    return { agentId, status: gone.status, pid: null, startedAt: null };
  }
  return {
    agentId,
    status: r.status || 'STOPPED',
    pid: r.rootPid || null,
    startedAt: r.startedAt || null,
    exitCode: r.exitCode,
  };
}

function getAllStatuses() {
  const out = {};
  for (const id of records.keys()) out[id] = getAgentStatus(id);
  return out;
}

// --- Portable environment (mirrors Build/Scripts/portable-env.ps1) ----------
// Kept in JS so the launch path no longer depends on PowerShell. Anything the
// PowerShell version set, this sets, with the same values.
const PORTABLE_PATH_DIRS = [
  ['Runtime', 'Node'],
  ['Runtime', 'Python'],
  ['Runtime', 'Python', 'Scripts'],
  ['Runtime', 'Git', 'cmd'],
  ['Runtime', 'Git', 'bin'],
  ['Runtime', 'Git-LFS'],
  ['Runtime', 'Tools'],
];
const NEUTRALIZED_ENV = ['PYTHONPATH', 'PYTHONHOME', 'NODE_PATH', 'VIRTUAL_ENV', 'PYTHONSTARTUP'];

// Windows environment blocks are case-insensitive, but a JS object is not: the
// real key is usually `Path`, so writing `env.PATH` would add a SECOND variable
// and the child could resolve against the wrong one (this dropped
// C:\Windows\System32 and made `spawn cmd.exe` fail with ENOENT). Always read
// and write through the casing that is actually present.
function envKey(env, name) {
  const lower = name.toLowerCase();
  for (const k of Object.keys(env)) { if (k.toLowerCase() === lower) return k; }
  return name;
}
function envDelete(env, name) {
  const k = envKey(env, name);
  if (k in env) delete env[k];
}
function envGet(env, name) {
  const k = envKey(env, name);
  return k in env ? env[k] : undefined;
}
function envSet(env, name, value) {
  env[envKey(env, name)] = value;
}

function absFromRoot(rel) {
  if (typeof rel !== 'string' || !rel) return '';
  return path.isAbsolute(rel) ? rel : path.join(rootDir(), rel.split('/').join(path.sep));
}

function buildPortableEnv(agent, extraEnv) {
  const root = rootDir();
  const env = { ...process.env };

  // A customer machine normally has these unset; on a dev machine they would
  // leak host packages or the wrong venv into the agent.
  for (const k of NEUTRALIZED_ENV) envDelete(env, k);

  envSet(env, 'PORTABLE_ROOT', root);

  const prepend = [];
  for (const seg of PORTABLE_PATH_DIRS) {
    const dir = path.join(root, ...seg);
    try { if (fs.existsSync(dir)) prepend.push(dir); } catch (_) {}
  }
  if (prepend.length) {
    envSet(env, 'PATH', prepend.join(path.delimiter) + path.delimiter + (envGet(env, 'PATH') || ''));
  }

  envSet(env, 'PYTHONNOUSERSITE', '1');
  envSet(env, 'PIP_NO_USER', '1');

  const ud = path.join(root, 'UserData');
  envSet(env, 'HOME', path.join(ud, 'home'));
  envSet(env, 'GIT_CONFIG_GLOBAL', path.join(ud, 'git', 'config'));
  envSet(env, 'XDG_CONFIG_HOME', path.join(ud, 'xdg-config'));
  envSet(env, 'XDG_CACHE_HOME', path.join(ud, 'xcache'));
  envSet(env, 'npm_config_cache', path.join(ud, 'npm-cache'));
  envSet(env, 'npm_config_prefix', path.join(ud, 'npm-global'));
  envSet(env, 'PIP_CACHE_DIR', path.join(ud, 'pip-cache'));
  envSet(env, 'PIP_CONFIG_FILE', path.join(ud, 'pip', 'pip.ini'));

  // Per-agent isolation from the manifest (paths relative to PORTABLE_ROOT).
  const iso = (agent && agent.isolatedEnv) || {};
  for (const [k, v] of Object.entries(iso)) {
    if (typeof v !== 'string' || !v) continue;
    envSet(env, k, absFromRoot(v));
  }

  // Launcher-side provider injection (DPAPI secrets / API base URLs) wins.
  if (extraEnv && typeof extraEnv === 'object') {
    for (const [k, v] of Object.entries(extraEnv)) envSet(env, k, v);
  }

  return env;
}

// --- Launch descriptor ------------------------------------------------------
// cmd.exe quote rule (see `cmd /?`): quotes are preserved only when the command
// line after /c contains EXACTLY two of them; otherwise cmd strips the first and
// the last, which truncates a quoted path at its first space ->
//   'E:\...\AI' is not recognized as an internal or external command
// So the whole command is wrapped in one extra pair of quotes (cmd then removes
// only that outer pair) and passed verbatim, never re-quoted by Node.
function quoteWinArg(a) {
  const s = String(a);
  if (s === '') return '""';
  return /[\s"]/.test(s) ? '"' + s + '"' : s;
}

function cmdLine(file, args) {
  return [file, ...args].map(quoteWinArg).join(' ');
}

function resolveLaunch(agentId, opts) {
  const agent = (opts && opts.agent) || {};

  // Preferred: the agent's real executable, straight from the manifest.
  const exeRel = (opts && opts.exePath) || agent.exePath;
  if (typeof exeRel === 'string' && exeRel.trim()) {
    const abs = absFromRoot(exeRel);
    const args = Array.isArray(opts && opts.exeArgs) ? opts.exeArgs
              : Array.isArray(agent.exeArgs) ? agent.exeArgs : [];
    return {
      kind: 'exe', file: 'cmd.exe', verbatim: true,
      args: ['/c', '"' + cmdLine(abs, args) + '"'],
      exePath: abs,
    };
  }

  // Compatibility fallback: a start script (used by the standalone smoke test,
  // and by any manifest entry that has no exePath yet).
  if (opts && typeof opts.resolveScriptAbs === 'function') {
    const scriptAbs = opts.resolveScriptAbs(agentId);
    if (scriptAbs) {
      return {
        kind: 'script', file: 'cmd.exe', verbatim: true,
        args: ['/c', '"' + cmdLine('powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptAbs]) + '"'],
        scriptAbs,
      };
    }
  }
  return null;
}

function pickCwd(agent, opts) {
  const candidates = [(opts && opts.cwd) || '', (agent && agent.workspace) || ''];
  for (const c of candidates) {
    if (!c) continue;
    const abs = absFromRoot(c);
    try { if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs; } catch (_) {}
  }
  return rootDir();
}

async function startAgent(agentId, opts) {
  opts = opts || {};
  const log = opts.log;
  if (isRunning(agentId)) {
    return { ok: false, reason: 'already-running', pid: records.get(agentId).rootPid };
  }
  // A stale record (process already gone) must not block a fresh launch.
  const stale = records.get(agentId);
  if (stale && stale.rootPid) { forget(agentId); records.delete(agentId); }

  setRec(agentId, { status: 'STARTING', startedAt: Date.now(), exitCode: undefined });
  let launch;
  try {
    const agent = opts.agent || {};
    const extraEnv = typeof opts.buildEnv === 'function' ? await opts.buildEnv(agentId) : null;
    const env = buildPortableEnv(agent, extraEnv);
    launch = resolveLaunch(agentId, opts);
    if (!launch) throw new Error('no launch target (exePath or start script)');
    const cwd = pickCwd(agent, opts);

    const child = spawn(launch.file, launch.args, {
      cwd, detached: true, windowsHide: false, stdio: 'ignore', env,
      windowsVerbatimArguments: !!launch.verbatim,
    });
    // --- Diagnostics only (DEBUG_HERMES_EXIT=1), no behaviour change ---------
    // The TUI agents need their own console window, so stdio is 'ignore': there
    // is no stderr to capture here. This records WHEN and WITH WHICH exit status
    // the process died (and which env var NAMES it was given); the agent's own
    // logs (e.g. HERMES_HOME/logs/agent.log) hold the content side.
    if (process.env.DEBUG_HERMES_EXIT === '1') {
      const t0 = Date.now();
      const redactArg = (a) => /sk-|api[_-]?key|token|secret|password/i.test(String(a)) ? '<redacted>' : String(a);
      const safeArgs = (launch.args || []).map(redactArg);
      const stamp = () => new Date().toISOString();
      // rootDir() is the portable root main.js configured (pm.configure({root})),
      // so this lands next to launcher.log.
      const diagLog = path.join(rootDir(), 'Launcher', 'Logs', 'hermes-exit.log');
      const write = (s) => {
        try { fs.mkdirSync(path.dirname(diagLog), { recursive: true }); fs.appendFileSync(diagLog, s + '\n'); }
        catch (e) { if (log) log(`[pm] diag-write-failed ${String((e && e.message) || e)}`); }
      };
      write(`${stamp()} spawn agent=${agentId} pid=${child.pid} exe=${launch.file} args=${JSON.stringify(safeArgs)}`);
      write(`${stamp()} envkeys agent=${agentId} ${JSON.stringify(Object.keys(env || {}).sort())}`);
      child.on('exit', (code, signal) => {
        const livedMs = Date.now() - t0;
        const line = `exit agent=${agentId} pid=${child.pid} code=${code} signal=${signal} livedMs=${livedMs} livedSec=${(livedMs / 1000).toFixed(1)} stderr=n/a(stdio=ignore)`;
        write(`${stamp()} ${line}`);
        if (log) log(`[pm] ${line}`);
      });
    }
    // Wait for the real 'spawn' event: a failed spawn (ENOENT) reports pid ===
    // undefined AND emits 'error' asynchronously, so checking pid first would
    // leave that event unhandled and crash the main process.
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.on('error', (e) => {
      const r = records.get(agentId);
      if (r && r.rootPid === child.pid) setRec(agentId, { status: 'ERROR', error: String((e && e.message) || e) });
    });
    const rootPid = child.pid;
    if (!rootPid) throw new Error('spawn failed (no pid)');
    child.unref();

    setRec(agentId, {
      rootPid, pid: rootPid, status: 'RUNNING', startedAt: Date.now(),
      exePath: launch.exePath || null, scriptAbs: launch.scriptAbs || null,
      kind: launch.kind, cwd,
    });
    persist(agentId, { pid: rootPid, startedAt: Date.now(), exe: launch.exePath || launch.scriptAbs || null, kind: launch.kind });
    if (log) log(`[pm] start agent=${agentId} rootPid=${rootPid} kind=${launch.kind} cwd=${cwd}`);

    // Agents that die on startup (missing console / credentials) must not be
    // reported as RUNNING. Checked asynchronously so start stays fast.
    setTimeout(() => {
      const r = records.get(agentId);
      if (r && r.rootPid === rootPid && !isPidAlive(rootPid)) {
        setRec(agentId, { status: 'ERROR', error: 'exited shortly after start', rootPid: null, pid: null, startedAt: null });
        forget(agentId);
        if (log) log(`[pm] start-verify agent=${agentId} pid=${rootPid} alive=false -> ERROR`);
      } else if (r && r.rootPid === rootPid && log) {
        log(`[pm] start-verify agent=${agentId} pid=${rootPid} alive=true`);
      }
    }, 1500).unref?.();

    return { ok: true, pid: rootPid };
  } catch (e) {
    setRec(agentId, { status: 'ERROR', error: String((e && e.message) || e) });
    if (log) log(`[pm] start agent=${agentId} FAIL reason=${String((e && e.message) || e)}`);
    return { ok: false, reason: String((e && e.message) || e) };
  }
}

// Stop the process tree rooted at the tracked PID. tree-kill owns the tree walk
// (taskkill /T /F on Windows); taskkill is the explicit fallback.
function stopAgent(agentId, optsOrLog) {
  const log = typeof optsOrLog === 'function' ? optsOrLog : (optsOrLog && optsOrLog.log);
  return new Promise((resolve) => {
    const rec = records.get(agentId);
    // The record answers "is it tracked"; the PID we last tracked answers
    // "was it ever started" even after a status refresh nulled the record's pid.
    const everPid = (rec && rec.rootPid) || lastTrackedPid.get(agentId) || null;
    if (!everPid) {
      setRec(agentId, { status: 'STOPPED', rootPid: null, pid: null, startedAt: null });
      forget(agentId);
      if (log) log(`[pm] stopped=0 reason=never-started agent=${agentId}`);
      return resolve({ stopped: 0, reason: 'never-started' });
    }
    // Tracked once but the process is already gone (typically the user closed
    // the cmd window by hand): there is nothing left to stop.
    if (!isPidAlive(everPid)) {
      setRec(agentId, { status: 'STOPPED', rootPid: null, pid: null, startedAt: null });
      forget(agentId);
      lastTrackedPid.delete(agentId);
      if (log) log(`[pm] stopped=0 reason=already-dead agent=${agentId} pid=${everPid} (window closed by user)`);
      return resolve({ stopped: 0, pid: everPid, reason: 'already-dead' });
    }
    const pid = everPid;
    const startedAt = (rec && rec.startedAt) || null;
    setRec(agentId, { status: 'STOPPING' });
    kill(pid, 'SIGTERM', (err) => {
      let fallback = false;
      if (err) {
        fallback = true;
        try {
          require('child_process').execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
        } catch (_) {}
      }
      const stillAlive = isPidAlive(pid);
      const stopped = stillAlive ? 0 : 1;
      setRec(agentId, {
        status: stillAlive ? 'ERROR' : 'STOPPED',
        rootPid: stillAlive ? pid : null, pid: stillAlive ? pid : null,
        startedAt: stillAlive ? startedAt : null,
        error: stillAlive ? 'still alive after tree-kill' : undefined,
      });
      if (!stillAlive) { forget(agentId); lastTrackedPid.delete(agentId); }
      if (log) log(`[pm] stopped=${stopped} agent=${agentId} pid=${pid}${fallback ? ' fallback=taskkill' : ''}${stillAlive ? ' WARN=still-alive' : ''}`);
      resolve({ stopped, pid, reason: stillAlive ? 'still alive' : undefined });
    });
  });
}

async function restartAgent(agentId, opts) {
  await stopAgent(agentId, opts);
  return startAgent(agentId, opts);
}

// Compatibility wrapper: resolves a legacy process token to the tracked agent
// and stops it by PID. No PowerShell, no command-line matching.
function stopByToken(token, log) {
  const hit = [...records.entries()].find(([, r]) => r && (r.matchToken === token || r.scriptAbs === token || r.exePath === token));
  if (!hit) { if (log) log(`[pm] stopped=0 reason=no-record-for-token`); return Promise.resolve({ stopped: 0, reason: 'no record for token' }); }
  return stopAgent(hit[0], log);
}

module.exports = {
  configure,
  setStatusHook,
  startAgent, stopAgent, restartAgent, stopByToken,
  getAgentStatus, getAllStatuses, isRunning,
  // exported for tests / diagnostics
  isPidAlive, buildPortableEnv,
};
