/**
 * 13.23 真机验收探测（非自动化测试；人工运行 node real-machine-probe.cjs）。
 * ---------------------------------------------------------------------------
 * 经真实桥（openclaw-gateway / codex-appserver / claude-cli-bridge）向三个 Agent
 * 各发一条真实消息，验证真实 API 证据（流式文本 / 会话 ID / 工具事件）。
 * 密钥零接触：provider env 复用 main.js 既有注入链（buildBundledProviderEnv），
 * 本脚本不读、不显示任何密钥；OpenClaw 凭据归其自身 state，本脚本不读。
 * 若某 Agent 因凭据缺失无法完成真实 API 调用 → 如实输出 NOT TESTABLE WITHOUT
 * CREDENTIALS（不把 mock 结果报告为 REAL）。
 */
const Module = require('node:module')
const origLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') {
    return {
      app: {
        requestSingleInstanceLock: () => true,
        whenReady: () => new Promise(() => {}), // 不启动 UI
        on: () => {},
        quit: () => {},
        getPath: () => process.cwd(),
      },
      BrowserWindow: class { getAllWindows() { return [] } },
      ipcMain: { handle() {}, on() {} },
      Tray: class {}, Menu: { buildFromTemplate() { return {} }, setApplicationMenu() {} },
      shell: { openExternal() {}, showItemInFolder() {}, openPath() {} },
      nativeImage: { createEmpty() { return {} } },
      dialog: {}, clipboard: {}, globalShortcut: { register() {} }, net: {},
      Notification: class { show() {} },
    }
  }
  return origLoad.apply(this, arguments)
}

const main = require('./main.js')
const { ROOT, buildBundledProviderEnv, syncCodexModelConfig, safe } = main
const path = require('node:path')
const { createOpenClawGateway } = require('./openclaw-gateway')
const { createCodexAppServer } = require('./codex-appserver')
const { createClaudeCliBridge } = require('./claude-cli-bridge')

const PROMPT = '请只回复两个字：OK'
const TIMEOUT_MS = 150000

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true, label }), TIMEOUT_MS)),
  ])
}

function envInfo(env) {
  // 只报告 env 键名（密钥零接触：绝不输出值）
  return Object.keys(env || {}).sort().join(',')
}

async function probeOpenClaw() {
  const out = { agent: 'openclaw' }
  const gw = createOpenClawGateway({
    nodeExe: path.join(ROOT, 'Runtime', 'Node', 'node.exe'),
    openclawEntry: path.join(ROOT, 'Agents', 'OpenClaw', 'App', 'node_modules', 'openclaw', 'openclaw.mjs'),
    openclawAppDir: path.join(ROOT, 'Agents', 'OpenClaw', 'App'),
    stateDir: path.join(ROOT, 'Agents', 'OpenClaw', 'Data'),
    configPath: path.join(ROOT, 'Agents', 'OpenClaw', 'Config', 'config.yaml'),
    deviceFile: path.join(ROOT, 'Launcher', 'Data', 'openclaw-device.json'),
    gatewayTokenFile: path.join(ROOT, 'Launcher', 'Data', 'openclaw-gateway-token.json'),
    env: {},
    log: () => {},
    startupTimeoutMs: 90000,
  })
  try {
    const natives = await withTimeout(gw.listSessions(), 'openclaw listSessions')
    if (natives.timeout) { out.error = `listSessions 超时`; return out }
    out.listSessions = { ok: true, count: natives.length, sample: natives[0] ? { key: natives[0].nativeSessionId, title: natives[0].title } : null }
    const created = await withTimeout(gw.createSession({}), 'openclaw createSession')
    if (created.timeout) { out.error = 'createSession 超时'; return out }
    out.createdKey = created.nativeSessionId
    const events = []
    const send = (async () => {
      for await (const ev of gw.streamMessage(created.nativeSessionId, PROMPT)) {
        events.push(ev)
        if (events.length > 200) break
      }
    })()
    const r = await withTimeout(send, 'openclaw chat.send 回合')
    if (r && r.timeout) { out.error = 'chat.send 回合超时（150s）'; out.eventTypes = events.map((e) => e.type); return out }
    const text = events.filter((e) => e.type === 'text_replace' || e.type === 'text_delta').map((e) => e.text).join('||')
    const errs = events.filter((e) => e.type === 'error')
    out.turn = { eventCount: events.length, textSample: String(text).slice(-120), error: errs[0] ? `${errs[0].code}: ${errs[0].message}` : undefined }
    if (errs.length && /credential|api key|provider|auth/i.test(errs[0].message || '')) {
      out.verdict = 'REAL_GATEWAY_BUT_NOT_TESTABLE_WITHOUT_CREDENTIALS（Gateway 链路 REAL；模型凭据缺失）'
    } else if (text) {
      out.verdict = 'REAL'
    } else {
      out.verdict = 'PARTIAL（无文本事件，见 eventCount）'
    }
    return out
  } catch (e) {
    out.error = safe(e)
    out.code = e.code
    return out
  } finally {
    try { gw.close() } catch (_) {}
  }
}

async function probeCodex() {
  const out = { agent: 'codex' }
  const bundled = buildBundledProviderEnv('codex')
  out.envKeys = bundled ? envInfo(bundled.env) : '（无 bundled env）'
  // 生产同款链路：sessionAgentEnv 在 bundled 命中时同步 config.toml provider 块
  if (bundled && bundled.model && bundled.model.baseUrl && bundled.model.model) {
    try { syncCodexModelConfig(bundled.model.baseUrl, bundled.model.model); out.configSynced = true } catch (e) { out.configSyncError = safe(e) }
  }
  const srv = createCodexAppServer({
    nodeExe: path.join(ROOT, 'Runtime', 'Node', 'node.exe'),
    codexEntry: path.join(ROOT, 'Agents', 'Codex', 'App', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    codexHome: path.join(ROOT, 'Agents', 'Codex'),
    env: bundled ? bundled.env : {},
    log: () => {},
  })
  try {
    const natives = await withTimeout(srv.listSessions(), 'codex thread/list')
    if (natives.timeout) { out.error = 'thread/list 超时'; return out }
    out.threadList = { ok: true, count: natives.length, sample: natives[0] ? natives[0].nativeSessionId : null }
    const created = await withTimeout(srv.createSession({}), 'codex thread/start')
    if (created.timeout) { out.error = 'thread/start 超时'; return out }
    out.threadId = created.nativeSessionId
    const events = []
    const send = (async () => {
      for await (const ev of srv.streamMessage(created.nativeSessionId, PROMPT)) {
        events.push(ev)
        if (events.length > 300) break
      }
    })()
    const r = await withTimeout(send, 'codex turn/start 回合')
    if (r && r.timeout) { out.error = 'turn/start 回合超时（150s）'; out.eventTypes = events.map((e) => e.type); return out }
    const text = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('')
    const errs = events.filter((e) => e.type === 'error')
    out.turn = { eventCount: events.length, textSample: String(text).slice(-120), error: errs[0] ? `${errs[0].code}: ${errs[0].message}` : undefined }
    if (text) out.verdict = 'REAL'
    else if (errs.length && /api key|credential|unauthorized/i.test(errs[0].message || '')) out.verdict = 'NOT_TESTABLE_WITHOUT_CREDENTIALS'
    else out.verdict = 'PARTIAL'
    return out
  } catch (e) {
    out.error = safe(e)
    out.code = e.code
    return out
  } finally {
    try { srv.close() } catch (_) {}
  }
}

async function probeClaude() {
  const out = { agent: 'claude-code' }
  const bundled = buildBundledProviderEnv('claudeCode')
  out.envKeys = bundled ? envInfo(bundled.env) : '（无 bundled env）'
  const bridge = createClaudeCliBridge({
    // 安装器已把 wrapper 包 bin/claude.exe 改名为 .old（真身在 win32-x64 包）
    command: path.join(ROOT, 'Agents', 'ClaudeCode', 'App', 'node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'claude.exe'),
    wrapperEntry: path.join(ROOT, 'Agents', 'ClaudeCode', 'App', 'node_modules', '@anthropic-ai', 'claude-code', 'cli-wrapper.cjs'),
    nodeExe: path.join(ROOT, 'Runtime', 'Node', 'node.exe'),
    configDir: path.join(ROOT, 'Agents', 'ClaudeCode'),
    workspace: path.join(ROOT, 'Agents', 'ClaudeCode'),
    env: bundled ? bundled.env : {},
    log: () => {},
    initTimeoutMs: 60000,
  })
  try {
    const created = await bridge.createSession({})
    out.sessionId = created.nativeSessionId
    const events = []
    let nativeSession = null
    bridge.onEvent((kind, info) => { if (kind === 'init' && info && info.native) nativeSession = info.native })
    const send = (async () => {
      for await (const ev of bridge.streamMessage(created.nativeSessionId, PROMPT)) {
        events.push(ev)
        if (events.length > 300) break
      }
    })()
    const r = await withTimeout(send, 'claude stream-json 回合')
    if (r && r.timeout) { out.error = 'claude 回合超时（150s）'; out.eventTypes = events.map((e) => e.type); return out }
    const text = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('')
    const errs = events.filter((e) => e.type === 'error')
    out.nativeSessionIdFromInit = nativeSession
    out.turn = { eventCount: events.length, textSample: String(text).slice(-120), error: errs[0] ? `${errs[0].code}: ${errs[0].message}` : undefined }
    if (text) out.verdict = 'REAL'
    else if (errs.length && /api key|credit|unauthorized/i.test(errs[0].message || '')) out.verdict = 'NOT_TESTABLE_WITHOUT_CREDENTIALS'
    else out.verdict = 'PARTIAL'
    return out
  } catch (e) {
    out.error = safe(e)
    out.code = e.code
    return out
  } finally {
    try { bridge.close() } catch (_) {}
  }
}

async function mainProbe() {
  console.log('=== 13.23 真机验收探测（真实 API 证据）===')
  console.log('[1/3] OpenClaw Gateway…')
  console.log(JSON.stringify(await probeOpenClaw(), null, 2))
  console.log('[2/3] Codex app-server…')
  console.log(JSON.stringify(await probeCodex(), null, 2))
  console.log('[3/3] Claude Code CLI…')
  console.log(JSON.stringify(await probeClaude(), null, 2))
  process.exit(0)
}

mainProbe().catch((e) => { console.error('probe failed:', safe(e)); process.exit(1) })
