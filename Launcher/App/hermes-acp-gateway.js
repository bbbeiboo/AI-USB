/**
 * Hermes ACP 会话网关（13.22 真实接线·主进程侧）。
 * ---------------------------------------------------------------------------
 * 官方通道：hermes-acp.exe（Hermes 官方 ACP stdio server，v0.21.4 实测支持
 * initialize / session/list / session/new / session/load / session/prompt /
 * session/cancel；agentCapabilities.loadSession=true、sessionCapabilities.list/resume/fork）。
 *
 * 架构裁决（13.22 §一）：Hermes 原生会话数据 = Source of Truth。本网关只做三件事：
 *   1. 用官方 ACP 方法驱动真实会话（新建/列表/加载/发送/流式/停止）；
 *   2. 把原生 session/update 事件翻译为统一 AgentEvent（只翻译存在的事件类型）；
 *   3. 把真实错误原样上抛（AgentError 语义），禁止失败后伪造成功。
 * 本模块不读写 Hermes 的任何数据文件（不解析私有存储）；不接触密钥值
 * （密钥经 env 注入，由调用方——main.js 既有链路——提供）。
 *
 * 纯 Node 模块（零 Electron 依赖），可被 node --test 直测（mock stdio 子进程）。
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/** 统一错误（与渲染层 AgentError 同语义；主进程侧无 TS，按形状构造） */
function agentError(code, message, agentId = 'hermes') {
  const err = new Error(message)
  err.code = code
  err.agentId = agentId
  return err
}

const CODE_MAP = {
  'Session not found': 'session-not-found',
}

/** 把 ACP/底层错误映射为统一错误码（任务书 §十四） */
function toAgentError(err) {
  const msg = String((err && err.message) || err)
  if (/provider.*resolved without credentials|api key|authentication|unauthorized|401/i.test(msg)) {
    return agentError('provider-auth', msg)
  }
  if (/session.*not found|unknown session|no such session/i.test(msg)) return agentError('session-not-found', msg)
  if (/ECONNREFUSED|ENOENT|spawn|cannot find/i.test(msg)) return agentError('offline', msg)
  if (/timeout|timed out/i.test(msg)) return agentError('timeout', msg)
  if (/Method not found|invalid request|parse error/i.test(msg)) return agentError('protocol', msg)
  if (/busy|already running|in progress/i.test(msg)) return agentError('busy', msg)
  for (const [pat, code] of Object.entries(CODE_MAP)) {
    if (msg.includes(pat)) return agentError(code, msg)
  }
  return agentError('protocol', msg)
}

let seqCounter = 0
function nextSeq() { seqCounter += 1; return seqCounter }

/**
 * 创建网关。参数：
 *   command  hermes-acp 可执行文件绝对路径
 *   hermesHome  HERMES_HOME（便携隔离根，agents/Hermes）
 *   workspaceRoot  fs/read_text_file 允许的根（缺省= hermesHome）
 *   env      额外子进程环境（调用方注入的 provider env；本模块不读密钥值，只透传）
 *   log      日志函数（可空）
 *   spawnOverride / writeOverride  测试注入用
 */
function createHermesAcpGateway(opts = {}) {
  const command = opts.command
  const hermesHome = opts.hermesHome
  const workspaceRoot = opts.workspaceRoot || hermesHome
  const extraEnv = opts.env || {}
  const log = opts.log || (() => {})
  const spawnImpl = opts.spawnOverride || spawn

  if (!command || !hermesHome) {
    throw agentError('offline', 'hermes-acp gateway 需要 command 与 hermesHome')
  }

  let child = null
  let initialized = false
  let reqSeq = 0
  /** id → { resolve, reject, timer } */
  const pending = new Map()
  /** sessionId → { queue: AgentEvent[], resolve: fn | null, done: fn | null, errored: Error | null } */
  const turns = new Map()
  let stdoutBuf = ''
  let deathErr = null

  function childEnv() {
    return { ...process.env, ...extraEnv, HERMES_HOME: hermesHome }
  }

  function handleLine(line) {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg
    try { msg = JSON.parse(trimmed) } catch { log(`hermes-acp 无法解析的行: ${trimmed.slice(0, 120)}`); return }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) {
        const e = new Error(msg.error.message || 'ACP error')
        e.data = msg.error.data
        p.reject(e)
      } else {
        p.resolve(msg.result)
      }
      return
    }
    // 通知：session/update 流式事件 → 统一 AgentEvent
    if (msg.method === 'session/update') {
      const sessionId = msg.params && msg.params.sessionId
      const turn = turns.get(sessionId)
      if (!turn) return
      for (const ev of mapUpdate(msg.params)) {
        if (turn.resolve) turn.resolve(ev)
        else turn.queue.push(ev)
      }
      return
    }
    // 客户端侧请求（agent → client）：按 13.22 安全策略应答
    if (msg.id !== undefined && msg.method) {
      handleClientRequest(msg)
      return
    }
    // 其余通知只记录
    if (msg.method) log(`hermes-acp 通知: ${msg.method}`)
  }

  /**
   * 客户端请求应答（13.22 安全边界）：
   *  - session/request_permission：默认选 deny 项（聚合器本轮不做审批 UI；真实拒绝，不伪造放行）
   *  - fs/read_text_file：真实读取（只读；限 workspace 内）
   *  - fs/write_text_file：本轮 unsupported（明示错误，不伪造成功）
   *  - 其余：protocol 错误
   */
  function handleClientRequest(msg) {
    const c = child
    if (!c) return
    const deny = (message) => {
      c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message } }) + '\n')
    }
    const ok = (result) => {
      c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
    }
    try {
      switch (msg.method) {
        case 'session/request_permission': {
          const options = (msg.params && msg.params.options) || []
          const denyOpt = options.find((o) => String(o.kind || '').startsWith('deny')) || options.find((o) => o.kind === 'allow_once')
          // 无 deny 项时退而选 allow_once（单次、最小授权面）；有 deny 项一律拒绝
          const chosen = options.find((o) => String(o.kind || '').startsWith('deny')) || denyOpt || options[0]
          if (!chosen) return deny('no permission options provided')
          ok({ outcome: { outcome: 'selected', optionId: chosen.optionId } })
          log(`hermes-acp 权限请求: ${msg.params?.toolCall?.title || ''} → ${chosen.kind || chosen.optionId}`)
          return
        }
        case 'fs/read_text_file': {
          const p = String(msg.params?.path || '')
          if (!isInsideWorkspace(p)) return deny(`path outside workspace: ${p}`)
          const text = fs.readFileSync(p, 'utf8')
          ok({ content: text })
          return
        }
        case 'fs/write_text_file':
          return deny('fs/write_text_file: 聚合器本轮未开放写入（安全边界）')
        default:
          return deny(`unsupported client method: ${msg.method}`)
      }
    } catch (e) {
      deny(String(e && e.message).slice(0, 200))
    }
  }

  function isInsideWorkspace(p) {
    if (!workspaceRoot) return false
    const rel = path.relative(workspaceRoot, p)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  }

  /** ACP session/update → 统一 AgentEvent 列表（只翻译 Hermes 实际产生的事件；不伪造） */
  function mapUpdate(params) {
    const u = params && params.update
    if (!u) return []
    const out = []
      switch (u.sessionUpdate) {
      case 'user_message_chunk': {
        // 仅历史重放产生（server.py:101-103）；保留用户角色，不与 agent 混流
        const text = extractText(u.content)
        if (text) out.push({ type: 'user_message', text })
        break
      }
      case 'agent_message_chunk': {
        const text = extractText(u.content)
        if (text) out.push({ type: 'text_delta', text })
        break
      }
      case 'agent_thought_chunk': {
        const text = extractText(u.content)
        if (text) out.push({ type: 'thinking', text })
        break
      }
      case 'tool_call':
        out.push({ type: 'tool_start', name: u.title || u.kind || 'tool', input: u.rawInput ?? u.locations ?? undefined })
        break
      case 'tool_call_update':
        out.push({ type: 'tool_result', name: u.title || 'tool', summary: u.status || undefined })
        break
      case 'plan':
        // ACP plan 通知：映射为 thinking 摘要（计划属于思考面）
        if (u.entries?.length) out.push({ type: 'thinking', text: u.entries.map((e) => e.content).join('\n') })
        break
      case 'session_info_update':
        // 自动标题生成（server.py:393,797）→ session_info 事件
        out.push({ type: 'session_info', title: String(u.title || '') })
        break
      default:
        // 未知 update 类型：不伪造事件，只留日志
        log(`hermes-acp 未映射的 update 类型: ${u.sessionUpdate}`)
    }
    return out
  }

  function extractText(content) {
    if (!content) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('')
    if (content.type === 'text' || content.type === 'markdown') return content.text || ''
    return ''
  }

  function ensureChild() {
    if (deathErr) throw deathErr
    if (child) return child
    child = spawnImpl(command, [], {
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
    child.stderr.on('data', (d) => log(`hermes-acp stderr: ${String(d).trim().slice(0, 300)}`))
    child.on('exit', (code) => {
      log(`hermes-acp 退出 code=${code}`)
      const err = agentError('offline', `hermes-acp 进程退出（code=${code}）`)
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err) }
      pending.clear()
      for (const t of turns.values()) {
        t.errored = err
        if (t.done) t.done()
      }
      turns.clear()
      child = null
      initialized = false
      deathErr = err
    })
    child.on('error', (e) => {
      const err = toAgentError(e)
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err) }
      pending.clear()
      child = null
      deathErr = err
    })
    return child
  }

  function request(method, params, timeoutMs = 30000) {
    const c = ensureChild()
    const id = ++reqSeq
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(agentError('timeout', `${method} 超时（${timeoutMs}ms）`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        c.stdin.write(payload + '\n')
      } catch (e) {
        pending.delete(id)
        clearTimeout(timer)
        reject(toAgentError(e))
      }
    })
  }

  async function ensureInitialized() {
    if (initialized) return
    await request('initialize', { protocolVersion: 1, clientCapabilities: {} }, 20000)
    initialized = true
  }

  /** prompt 回合：注册回合队列 → session/prompt → 流式产出直到 done */
  async function* promptTurn(sessionId, text) {
    await ensureInitialized()
    const turn = { queue: [], resolve: null, done: null, errored: null }
    turns.set(sessionId, turn)
    const promptPromise = request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    }, 600000).then((result) => {
      turn.finalStop = result && result.stopReason
    }).catch((e) => {
      turn.errored = toAgentError(e)
    }).finally(() => {
      turn.finished = true
      if (turn.done) turn.done()
    })
    try {
      yield { type: 'message_start' }
      let ended = false
      while (!ended) {
        if (turn.queue.length > 0) {
          yield turn.queue.shift()
          continue
        }
        if (turn.errored) throw turn.errored
        if (turn.finished) {
          while (turn.queue.length > 0) yield turn.queue.shift()
          ended = true
          break
        }
        const ev = await new Promise((resolve) => {
          turn.resolve = resolve
          turn.done = () => resolve(null)
        })
        turn.resolve = null
        turn.done = null
        if (ev) yield ev
      }
      yield { type: 'message_end', stopReason: turn.finalStop }
      if (turn.errored) throw turn.errored
      await promptPromise
    } finally {
      turns.delete(sessionId)
    }
  }

  return {
    /** 进程是否存活（测试/健康检查用） */
    isAlive() { return !!child },
    async listSessions(params = {}) {
      await ensureInitialized()
      try {
        const r = await request('session/list', params)
        const sessions = Array.isArray(r && r.sessions) ? r.sessions : []
        return sessions.map((s) => ({
          agentId: 'hermes',
          nativeSessionId: s.sessionId || s.id,
          title: s.title || s.displayName || '',
          status: 'idle',
          createdAt: s.createdAt || undefined,
          updatedAt: s.updatedAt || undefined,
        }))
      } catch (e) { throw toAgentError(e) }
    },
    async createSession(input = {}) {
      await ensureInitialized()
      try {
        const r = await request('session/new', { cwd: input.cwd || hermesHome, mcpServers: [] }, 60000)
        return {
          agentId: 'hermes',
          nativeSessionId: r.sessionId,
          title: input.title || '',
          status: 'active',
        }
      } catch (e) { throw toAgentError(e) }
    },
    /**
     * 加载既有会话。官方语义（acp_adapter/server.py:572-602）：session/load 会先把
     * 全部历史经 session/update 重放（user/assistant/thought/tool_call）再响应。
     * 因此这里捕获重放事件随会话一起返回，供渲染层重建 MessageList——
     * 重启后历史显示走官方重放，不解析 state.db。
     * 已知官方缺口：load 仅支持 source='acp' 的会话（session.py:428），
     * 非 ACP 会话返回 null → 本网关抛 session-not-found（不静默新建，resume 才有该行为）。
     */
    async loadSession(sessionId) {
      await ensureInitialized()
      const capture = { queue: [], resolve: null, done: null, errored: null }
      turns.set(sessionId, capture)
      try {
        const r = await request('session/load', { cwd: hermesHome, sessionId, mcpServers: [] }, 60000)
        if (r === null || r === undefined) {
          throw agentError('session-not-found', `session ${sessionId} 不存在（或非 ACP 来源，官方 load 不支持）`)
        }
        const history = capture.queue.slice()
        return {
          agentId: 'hermes',
          nativeSessionId: sessionId,
          title: (r && r.title) || '',
          status: 'idle',
          history,
        }
      } catch (e) {
        throw e.code ? e : toAgentError(e)
      } finally {
        turns.delete(sessionId)
      }
    },
    async getSession(sessionId) {
      const list = await this.listSessions()
      const hit = list.find((s) => s.nativeSessionId === sessionId)
      if (!hit) throw agentError('session-not-found', `session ${sessionId} 不存在`)
      return hit
    },
    sendMessage(sessionId, text) {
      async function collect() {
        let final = ''
        for await (const ev of promptTurn(sessionId, text)) {
          if (ev.type === 'text_delta') final += ev.text
          if (ev.type === 'error') throw agentError(ev.code || 'protocol', ev.message)
        }
        return final
      }
      return collect()
    },
    streamMessage(sessionId, text) {
      return promptTurn(sessionId, text)
    },
    async stopGeneration(sessionId) {
      if (!child) return
      try {
        await request('session/cancel', { sessionId }, 10000)
      } catch (e) {
        // cancel 在回合已结束时会报错——视为已停止，不伪造失败
        log(`hermes-acp cancel: ${String(e && e.message).slice(0, 120)}`)
      }
    },
    /** 关闭底层进程（应用退出/测试收尾用） */
    close() {
      if (child) {
        try { child.stdin.end() } catch (_) { /* 已退出 */ }
        const c = child
        setTimeout(() => { try { c.kill() } catch (_) {} }, 1500)
        child = null
        initialized = false
      }
    },
  }
}

module.exports = { createHermesAcpGateway, agentError, toAgentError }
