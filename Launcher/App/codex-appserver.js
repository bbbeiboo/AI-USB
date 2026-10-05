/**
 * Codex app-server 会话桥（13.23 真实接线·主进程侧）。
 * ---------------------------------------------------------------------------
 * 官方通道：`codex app-server`（stdio NDJSON JSON-RPC）。协议形状以本机生成的
 * 官方 JSON Schema 为准（build/Config/codex-app-server-schema/，0.156.1）：
 *   请求 {id, method, params}；通知 {method, params}；响应 {id, result} / {id, error}
 *   （schema 无 jsonrpc 字段；RequestId = string | int64）。
 * 版本漂移防护：方法名/参数以该 schema 生成物为准，不凭记忆硬编码。
 *
 * spawn（实测通过）：node bin/codex.js app-server（vendor codex.exe 在非 ASCII 路径
 * 下 spawn ENOENT，经官方 bin 包装器正常；Electron 内需 ELECTRON_RUN_AS_NODE=1）。
 *
 * 架构裁决（13.22 §一，13.23 沿用）：Codex thread = 会话真源
 * （nativeSessionId = thread.id，绝不以聚合器 UUID 冒充）；
 * 不读 rollout JSONL 冒充官方 API（历史走 thread/items/list 官方途径）。
 *
 * 纯 Node 模块（零 Electron 依赖，可被 node --test 直测；spawnOverride 注入缝）。
 */
const { spawn } = require('node:child_process')

/** 统一错误（与渲染层 AgentError 同语义） */
function agentError(code, message, agentId = 'codex') {
  const err = new Error(message)
  err.code = code
  err.agentId = agentId
  return err
}

/** 把底层/协议错误映射为统一错误码（任务书 §十四） */
function toAgentError(err) {
  const msg = String((err && err.message) || err)
  if (/missing environment variable.*openai_api_key|invalid api key|unauthorized|401|incorrect api key/i.test(msg)) {
    return agentError('provider-auth', msg)
  }
  if (/no thread found|not found|unknown thread/i.test(msg)) return agentError('session-not-found', msg)
  if (/ECONNREFUSED|ENOENT|spawn|cannot find/i.test(msg)) return agentError('offline', msg)
  if (/timeout|timed out/i.test(msg)) return agentError('timeout', msg)
  if (/busy|already running|turn in progress/i.test(msg)) return agentError('busy', msg)
  return agentError('protocol', msg)
}

/** 把 turn/completed.failed 的官方错误消息归入 8 码 */
function classifyTurnError(message) {
  const m = String(message || '')
  if (/missing environment variable|api key|unauthorized|401|quota|billing|insufficient/i.test(m)) return 'provider-auth'
  if (/interrupted|aborted|cancelled|canceled/i.test(m)) return 'busy'
  if (/timeout|timed out/i.test(m)) return 'timeout'
  return 'protocol'
}

function extractText(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('')
  if (typeof content.text === 'string') return content.text
  return ''
}

/** Codex app-server stdio 客户端 */
function createCodexAppServer(opts = {}) {
  const nodeExe = opts.nodeExe
  const codexEntry = opts.codexEntry
  const codexHome = opts.codexHome
  const cwd = opts.cwd || codexHome
  const extraEnv = opts.env || {}
  const log = opts.log || (() => {})
  const spawnImpl = opts.spawnOverride || spawn
  const initTimeoutMs = opts.initTimeoutMs || 20000
  const rpcTimeoutMs = opts.rpcTimeoutMs || 30000

  if (!nodeExe || !codexEntry || !codexHome) {
    throw agentError('offline', 'codex-appserver 需要 nodeExe/codexEntry/codexHome')
  }

  let child = null
  let initialized = false
  let reqSeq = 0
  let deathErr = null
  let stdoutBuf = ''
  /** id → {resolve,reject,timer} */
  const pending = new Map()
  /** threadId → { queue:[], resolve, done, errored, finished, stopReason } 回合等待器 */
  const turnWaiters = new Map()
  /** threadId → 当前活跃 turnId（turn/started 更新；interrupt 必填） */
  const activeTurn = new Map()
  /** toolUseId → tool 名（tool_result 归名） */
  const toolNames = new Map()

  function childEnv() {
    const env = { ...process.env, ...extraEnv, CODEX_HOME: codexHome }
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
    return env
  }

  function failAll(err) {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err) }
    pending.clear()
    for (const w of turnWaiters.values()) {
      if (!w.finished) { w.errored = err; w.finished = true; if (w.done) w.done() }
    }
    turnWaiters.clear()
  }

  function ensureChild() {
    if (deathErr) throw deathErr
    if (child) return child
    child = spawnImpl(nodeExe, [codexEntry, 'app-server'], {
      cwd,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    deathErr = null
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk
      let idx
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx)
        stdoutBuf = stdoutBuf.slice(idx + 1)
        handleLine(line)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => log(`codex app-server stderr: ${String(d).trim().slice(0, 300)}`))
    child.on('exit', (code) => {
      log(`codex app-server 退出 code=${code}`)
      const err = agentError('offline', `codex app-server 进程退出（code=${code}）`)
      child = null
      initialized = false
      deathErr = err
      failAll(err)
    })
    child.on('error', (e) => {
      const err = toAgentError(e)
      child = null
      deathErr = err
      failAll(err)
    })
    return child
  }

  function writeLine(obj) {
    const c = ensureChild()
    c.stdin.write(JSON.stringify(obj) + '\n')
  }

  function handleLine(line) {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg
    try { msg = JSON.parse(trimmed) } catch { log(`codex 无法解析的行: ${trimmed.slice(0, 120)}`); return }
    // 响应（schema：{id, result} / {id, error}；无 jsonrpc 字段）
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && msg.method === undefined) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) {
        const e = new Error(msg.error.message || 'codex app-server error')
        e.data = msg.error.data
        e.errorCode = msg.error.code
        p.reject(e)
      } else {
        p.resolve(msg.result)
      }
      return
    }
    // Server→Client 请求（审批等）：按 13.22 安全先例自动拒绝（真实拒绝，不伪造放行）
    if (msg.id !== undefined && msg.method) {
      handleServerRequest(msg)
      return
    }
    if (msg.method) handleNotification(msg)
  }

  function handleServerRequest(msg) {
    const c = child
    if (!c) return
    const denyMessage = `codex 审批请求被聚合器自动拒绝（${msg.method}）；如需放行请在 Agent TUI 中操作`
    try {
      c.stdin.write(JSON.stringify({ id: msg.id, result: { decision: 'denied' } }) + '\n')
      log(`codex server request: ${msg.method} → denied`)
    } catch (e) {
      log(`codex server request 应答失败: ${String(e && e.message).slice(0, 120)}`)
    }
    // 显式事件只推给该审批所属会话（params 携带 threadId；同 Hermes request_permission 先例）
    const threadId = String((msg.params && msg.params.threadId) || '')
    const w = threadId ? turnWaiters.get(threadId) : null
    if (w) {
      w.queue.push({ type: 'tool_result', name: msg.method, summary: denyMessage })
      if (w.resolve) { w.resolve(w.queue.shift()); w.resolve = null }
    }
  }

  function pushEvent(threadId, ev) {
    const w = turnWaiters.get(threadId)
    if (!w) return
    w.queue.push(ev)
    if (w.resolve) { w.resolve(w.queue.shift()); w.resolve = null }
  }

  function handleNotification(msg) {
    const params = msg.params || {}
    const threadId = params.threadId || (params.thread && params.thread.id) || ''
    switch (msg.method) {
      case 'thread/started':
        // thread/start 的结果经此通知返回 thread{id}
        if (threadStartWaiter && params.thread && params.thread.id) {
          const fn = threadStartWaiter
          threadStartWaiter = null
          fn(params.thread.id)
        }
        break
      case 'turn/started':
        if (threadId && params.turn && params.turn.id) activeTurn.set(threadId, params.turn.id)
        break
      case 'item/started': {
        const item = params.item || {}
        if (item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'mcpToolCall' || item.type === 'webSearch') {
          const name = item.command || item.title || item.type
          if (item.id) toolNames.set(item.id, String(name))
          pushEvent(threadId, { type: 'tool_start', name: String(name), input: undefined })
        }
        // userMessage 由渲染层本地回显；agentMessage 走 delta
        break
      }
      case 'item/agentMessage/delta':
        if (typeof params.delta === 'string' && params.delta) pushEvent(threadId, { type: 'text_delta', text: params.delta })
        break
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        if (typeof params.delta === 'string' && params.delta) pushEvent(threadId, { type: 'thinking', text: params.delta })
        break
      case 'item/completed': {
        const item = params.item || {}
        if (item.type !== 'userMessage' && item.type !== 'agentMessage' && item.id && toolNames.has(item.id)) {
          const name = toolNames.get(item.id)
          toolNames.delete(item.id)
          const summary = item.exitCode !== undefined ? `exit ${item.exitCode}` : item.status || undefined
          pushEvent(threadId, { type: 'tool_result', name, summary })
        }
        break
      }
      case 'thread/status/changed':
        // systemError：官方错误传播链第一站（实测：缺 OPENAI_API_KEY 时经此→error→turn failed）
        if (params.status && params.status.type === 'systemError') {
          log(`codex thread systemError: ${JSON.stringify(params.status).slice(0, 200)}`)
        }
        break
      case 'error':
        for (const [, w] of turnWaiters.entries()) {
          const m = (params.error && params.error.message) || params.message || 'codex error'
          w.queue.push({ type: 'error', message: m, code: classifyTurnError(m) })
          if (w.resolve) { w.resolve(w.queue.shift()); w.resolve = null }
        }
        break
      case 'turn/completed': {
        const w = turnWaiters.get(threadId)
        if (!w) break
        const turn = params.turn || {}
        activeTurn.delete(threadId)
        w.finished = true
        w.turnStatus = turn.status || 'completed'
        w.turnError = turn.error && turn.error.message
        if (w.done) w.done()
        break
      }
      case 'thread/name/updated':
      case 'thread/archived':
      case 'thread/unarchived':
      case 'thread/deleted':
        for (const fn of eventListeners) { try { fn(msg.method, params) } catch (_) {} }
        break
      default:
        // item/plan/delta、command outputDelta、tokenUsage 等不翻译（不伪造事件）
        break
    }
  }

  let threadStartWaiter = null
  let eventListeners = []

  function request(method, params, timeoutMs = rpcTimeoutMs) {
    const c = ensureChild()
    const id = ++reqSeq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(agentError('timeout', `codex ${method} 超时（${timeoutMs}ms）`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try { writeLine({ id, method, params: params || {} }) }
      catch (e) { pending.delete(id); clearTimeout(timer); reject(toAgentError(e)) }
    })
  }

  async function ensureInitialized() {
    if (initialized) return
    await request('initialize', { clientInfo: { name: 'ai-agent-launcher', title: 'AI Agent Launcher', version: '1.0.0' } }, initTimeoutMs)
    // 官方握手的客户端通知（ClientNotification 唯一方法）
    try { writeLine({ method: 'initialized', params: {} }) } catch (_) {}
    initialized = true
  }

  return {
    isAlive() { return !!child && initialized },
    onSessionChanged(fn) { eventListeners.push(fn); return () => { eventListeners = eventListeners.filter((x) => x !== fn) } },

    async listSessions() {
      await ensureInitialized()
      try {
        const r = await request('thread/list', { limit: 100 })
        const data = Array.isArray(r && r.data) ? r.data : []
        return data.map((t) => ({
          agentId: 'codex',
          nativeSessionId: String(t.id),
          title: t.name || (t.preview ? String(t.preview).slice(0, 40) : ''),
          status: 'idle',
          preview: t.preview || '',
          updatedAt: t.updatedAt ? t.updatedAt * 1000 : undefined,
          createdAt: t.createdAt ? t.createdAt * 1000 : undefined,
        }))
      } catch (e) { throw toAgentError(e) }
    },

    async createSession(_input = {}) {
      await ensureInitialized()
      try {
        const started = new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(agentError('timeout', '等待 thread/started 超时')), 60000)
          threadStartWaiter = (id) => { clearTimeout(t); resolve(id) }
        })
        await request('thread/start', {}, 60000)
        const threadId = await started
        return { agentId: 'codex', nativeSessionId: threadId, title: '', status: 'idle' }
      } catch (e) { throw e.code ? e : toAgentError(e) }
    },

    /** 历史重放：thread/resume（官方载入）+ thread/items/list（官方转录途径；不读 rollout JSONL） */
    async loadSession(nativeSessionId) {
      await ensureInitialized()
      try {
        await request('thread/resume', { threadId: nativeSessionId }, 60000)
      } catch (e) {
        const msg = String(e && e.message)
        if (/no thread found|not found/i.test(msg)) throw agentError('session-not-found', msg)
        throw toAgentError(e)
      }
      try {
        const r = await request('thread/items/list', { threadId: nativeSessionId, limit: 200 }, 60000)
        const items = Array.isArray(r && r.data) ? r.data : (Array.isArray(r) ? r : [])
        const history = []
        for (const item of items) {
          if (item.type === 'userMessage') {
            const text = extractText(item.content)
            if (text) history.push({ type: 'user_message', text })
          } else if (item.type === 'agentMessage') {
            const text = extractText(item.content ?? item.text)
            if (text) history.push({ type: 'text_delta', text })
          }
          // reasoning/commandExecution 等历史项不伪造为文本流
        }
        return { agentId: 'codex', nativeSessionId, title: '', status: 'idle', history }
      } catch (e) { throw toAgentError(e) }
    },

    /** 发送回合：turn/start → item/* delta 流式 → turn/completed 终态 */
    streamMessage(nativeSessionId, text) {
      async function* turn() {
        await ensureInitialized()
        const w = { queue: [], resolve: null, done: null, errored: null, finished: false, stopReason: null, turnStatus: null, turnError: null }
        turnWaiters.set(nativeSessionId, w)
        try {
          yield { type: 'message_start' }
          const startPromise = request('turn/start', {
            threadId: nativeSessionId,
            input: [{ type: 'text', text }],
          }, 600000).catch((e) => {
            w.errored = toAgentError(e)
            w.finished = true
            if (w.done) w.done()
          })
          let ended = false
          while (!ended) {
            if (w.queue.length > 0) { yield w.queue.shift(); continue }
            if (w.errored) throw w.errored
            if (w.finished) { while (w.queue.length > 0) yield w.queue.shift(); ended = true; break }
            const ev = await new Promise((resolve) => { w.resolve = resolve; w.done = () => resolve(null) })
            w.resolve = null; w.done = null
            if (ev) yield ev
          }
          await startPromise
          // 官方错误传播链：turn/completed status='failed' 必须映射为真实错误（不假完成）
          if (w.turnStatus === 'failed') {
            const msg = w.turnError || 'codex turn failed'
            yield { type: 'error', message: msg, code: classifyTurnError(msg) }
          }
          yield { type: 'message_end', stopReason: w.turnStatus === 'interrupted' ? 'cancelled' : (w.turnStatus === 'failed' ? 'error' : 'end_turn') }
          if (w.turnStatus === 'failed') throw agentError(classifyTurnError(w.turnError || ''), w.turnError || 'codex turn failed')
        } finally {
          turnWaiters.delete(nativeSessionId)
        }
      }
      return turn()
    },

    /** 官方中断：turn/interrupt（threadId+turnId 必填；turnId 来自 turn/started） */
    async stopGeneration(nativeSessionId) {
      if (!this.isAlive()) return
      const turnId = activeTurn.get(nativeSessionId)
      if (!turnId) return // 无活跃回合：视为已停止
      try {
        await request('turn/interrupt', { threadId: nativeSessionId, turnId }, 15000)
      } catch (e) {
        log(`codex turn/interrupt: ${String(e && e.message).slice(0, 120)}`)
      }
    },

    /** 官方原生重命名：thread/name/set */
    async renameSession(nativeSessionId, title) {
      await ensureInitialized()
      try { await request('thread/name/set', { threadId: nativeSessionId, name: title }) }
      catch (e) { throw toAgentError(e) }
    },

    /** 官方原生归档/恢复：thread/archive / thread/unarchive */
    async archiveSession(nativeSessionId, archived = true) {
      await ensureInitialized()
      try {
        await request(archived ? 'thread/archive' : 'thread/unarchive', { threadId: nativeSessionId })
      } catch (e) { throw toAgentError(e) }
    },

    /** 官方删除：thread/delete */
    async deleteSession(nativeSessionId) {
      await ensureInitialized()
      try { await request('thread/delete', { threadId: nativeSessionId }) }
      catch (e) { throw toAgentError(e) }
    },

    close() {
      if (child) {
        const c = child
        child = null
        initialized = false
        try { c.stdin.end() } catch (_) {}
        setTimeout(() => { try { c.kill() } catch (_) {} }, 1500)
      }
    },
  }
}

module.exports = { createCodexAppServer, agentError, toAgentError, classifyTurnError }
