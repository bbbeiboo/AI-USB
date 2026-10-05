/**
 * Claude Code CLI 会话桥（13.23 真实接线·主进程侧）。
 * ---------------------------------------------------------------------------
 * 官方通道：CLI 流式模式。本机安装的是 wrapper 包（2.1.280，无 sdk.mjs；官方 Agent
 * SDK 在独立的 @anthropic-ai/claude-agent-sdk 包里，未安装）。而官方 SDK 的 query()
 * 本身就是 spawn CLI `--print --output-format stream-json` 的薄封装——
 * 因此走官方 CLI 流式模式 = 零新依赖约束下的等价官方通道：
 *   claude -p --input-format stream-json --output-format stream-json
 *         --include-partial-messages --verbose [--session-id <uuid> | --resume <id>]
 * 会话真源：Claude Code 自己的会话存储（$CLAUDE_CONFIG_DIR/projects/**.jsonl，
 * 由 CLI 自管——本桥绝不读取解析；session_id 经官方 init 消息取回）。
 *
 * 能力裁决（任务书 §四：官方没有的能力明确 UNSUPPORTED，不伪造）：
 *   - 列表：CLI 无官方 sessions list 子命令 → UNSUPPORTED（索引承载本桥见过/建过的会话；
 *     孤儿经 --resume 官方探测：resume 失败 = session-not-found → orphaned 标记）。
 *   - 重命名/归档：CLI 无官方途径 → 仅聚合器索引语义（与 Hermes rename/archive 同级）。
 *   - 删除：UNSUPPORTED。
 *
 * 线格式（官方 streaming JSON 协议；未知形状只记日志，不伪造事件）：
 *   入：{type:'user', message:{role:'user', content:[{type:'text',text}]}}
 *   出：{type:'system', subtype:'init', session_id, ...}
 *       {type:'stream_event', event:{type:'content_block_delta', delta:{type:'text_delta'|'thinking_delta'|...}}}
 *       {type:'assistant', message:{content:[{type:'text'|'thinking'|'tool_use',...}]}}
 *       {type:'user', message:{content:[{type:'tool_result', tool_use_id, ...}]}}
 *       {type:'result', subtype:'success'|..., result, is_error, session_id}
 *   中断：{type:'control_request', request_id, request:{subtype:'interrupt'}}，
 *        应答 {type:'control_response', ...}；无应答兜底 kill 子进程（真实取消）。
 *
 * 纯 Node 模块（零 Electron 依赖，可被 node --test 直测；spawnOverride 注入缝）。
 */
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')

/** 统一错误（与渲染层 AgentError 同语义） */
function agentError(code, message, agentId = 'claude-code') {
  const err = new Error(message)
  err.code = code
  err.agentId = agentId
  return err
}

function toAgentError(err) {
  const msg = String((err && err.message) || err)
  if (/no conversation found|not found|unknown session/i.test(msg)) return agentError('session-not-found', msg)
  if (/api key|authentication|unauthorized|401|credit|billing/i.test(msg)) return agentError('provider-auth', msg)
  if (/ECONNREFUSED|ENOENT|spawn|cannot find/i.test(msg)) return agentError('offline', msg)
  if (/timeout|timed out/i.test(msg)) return agentError('timeout', msg)
  if (/busy|already/i.test(msg)) return agentError('busy', msg)
  return agentError('protocol', msg)
}

function uuid() {
  return crypto.randomUUID()
}

/** 每会话持久子进程桥（官方 streaming input 持久进程模式） */
function createClaudeCliBridge(opts = {}) {
  const command = opts.command
  const configDir = opts.configDir
  const workspace = opts.workspace || configDir
  const extraEnv = opts.env || {}
  const log = opts.log || (() => {})
  const spawnImpl = opts.spawnOverride || spawn
  const initTimeoutMs = opts.initTimeoutMs || 30000
  const interruptGraceMs = opts.interruptGraceMs || 2500
  // ENOENT 回退：官方 cli-wrapper.cjs（node 宿主起原生 exe；非 ASCII 路径直接 spawn 的兜底）
  const wrapperEntry = opts.wrapperEntry
  const wrapperNode = opts.nodeExe || process.execPath

  if (!command || !configDir) throw agentError('offline', 'claude-cli-bridge 需要 command 与 configDir')

  /** sessionId → proc 状态 */
  const procs = new Map()
  /** 全局事件监听（main.js 转发给渲染层） */
  let eventListeners = []

  function childEnv() {
    return { ...process.env, ...extraEnv, CLAUDE_CONFIG_DIR: configDir }
  }

  function cliArgs(sessionId, { fresh }) {
    const args = ['-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose']
    // 首次启动指定官方 --session-id（聚合器生成的 uuid，init 消息回读校验）；
    // 进程死亡后续接官方 --resume。
    args.push(fresh ? '--session-id' : '--resume', sessionId)
    return args
  }

  function spawnProc(sessionId, fresh, mode = 'direct') {
    const args = cliArgs(sessionId, { fresh })
    // 首选直接 spawn 原生 exe；ENOENT（非 ASCII 路径 Windows spawn 坑）回退
    // 官方 cli-wrapper.cjs（node 宿主，wrapper 自行解析平台二进制）
    const child = mode === 'direct'
      ? spawnImpl(command, args, { cwd: workspace, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      : spawnImpl(wrapperNode, [wrapperEntry, ...args], { cwd: workspace, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const st = {
      child,
      sessionId,
      stdoutBuf: '',
      ready: false,
      readyWaiters: [],
      turnWaiter: null, // { queue, resolve, done, errored, finished, stopReason }
      toolByUseId: new Map(),
      exitErr: null,
      exitCode: null,
      exitWaiters: [],
    }
    procs.set(sessionId, st)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      st.stdoutBuf += chunk
      let idx
      while ((idx = st.stdoutBuf.indexOf('\n')) >= 0) {
        const line = st.stdoutBuf.slice(0, idx)
        st.stdoutBuf = st.stdoutBuf.slice(idx + 1)
        handleLine(st, line)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => {
      st.stderrTail = ((st.stderrTail || '') + String(d)).slice(-2000)
      log(`claude stderr: ${String(d).trim().slice(0, 300)}`)
    })
    child.on('exit', (code) => {
      log(`claude 进程退出 code=${code} session=${sessionId}`)
      st.exitCode = code
      // init 前退出 = 启动/resume 失败（官方孤儿探测路径：--resume 不存在的会话
      // CLI 直接退出），必须真实报错，不得当自然回合结束
      if (!st.ready) {
        const tail = (st.stderrTail || '').trim()
        const err = /no conversation found|not found/i.test(tail)
          ? agentError('session-not-found', `claude 会话不存在（官方 --resume 探测失败）：${tail.slice(-200)}`)
          : agentError('offline', `claude 进程启动失败（exit=${code}）${tail ? '：' + tail.slice(-200) : ''}`)
        for (const fn of st.readyWaiters.splice(0)) fn(null, err)
        const wEarly = st.turnWaiter
        if (wEarly && !wEarly.finished) {
          wEarly.errored = err
          wEarly.finished = true
          if (wEarly.done) wEarly.done()
        }
        for (const fn of st.exitWaiters) { try { fn(code) } catch (_) {} }
        return
      }
      const w = st.turnWaiter
      if (w && !w.finished) {
        // 官方 CLI 语义：一次性回合结束后进程自然退出——不算错误
        w.finished = true
        w.stopReason = w.stopReason || (code === 0 ? 'end_turn' : 'process_exit')
        if (w.done) w.done()
      }
      for (const fn of st.exitWaiters) { try { fn(code) } catch (_) {} }
    })
    child.on('error', (e) => {
      if (mode === 'direct' && e && e.code === 'ENOENT' && wrapperEntry) {
        log('claude.exe 直接 spawn ENOENT → 回退官方 cli-wrapper.cjs（node 宿主）')
        procs.delete(sessionId)
        const st2 = spawnProc(sessionId, fresh, 'wrapper')
        st2.readyWaiters.push(...st.readyWaiters.splice(0))
        if (st.turnWaiter) st2.turnWaiter = st.turnWaiter
        return
      }
      st.exitErr = toAgentError(e)
      const w = st.turnWaiter
      if (w && !w.finished) {
        w.errored = st.exitErr
        w.finished = true
        if (w.done) w.done()
      }
      for (const fn of st.exitWaiters) { try { fn(null) } catch (_) {} }
    })
    return st
  }

  function pushEvent(sessionId, ev) {
    for (const fn of eventListeners) { try { fn(sessionId, ev) } catch (_) {} }
    const st = procs.get(sessionId)
    const w = st && st.turnWaiter
    if (w && !w.finished) {
      w.queue.push(ev)
      if (w.resolve) { w.resolve(w.queue.shift()); w.resolve = null }
    }
  }

  function handleLine(st, line) {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg
    try { msg = JSON.parse(trimmed) } catch { log(`claude 无法解析的行: ${trimmed.slice(0, 120)}`); return }
    const sessionId = st.sessionId
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          const native = msg.session_id || sessionId
          st.ready = true
          for (const fn of st.readyWaiters.splice(0)) fn(native)
          // 官方 init 回读的 session_id 即原生会话真源（经 onEvent('init') 交主进程登记索引）
          for (const fn of eventListeners) { try { fn('init', { sessionId, native }) } catch (_) {} }
        }
        break
      case 'stream_event': {
        const ev = msg.event || {}
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) pushEvent(sessionId, { type: 'text_delta', text: ev.delta.text })
          else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) pushEvent(sessionId, { type: 'thinking', text: ev.delta.thinking })
        } else if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'tool_use') {
          const name = ev.content_block.name || 'tool'
          if (ev.content_block.id) st.toolByUseId.set(ev.content_block.id, name)
          pushEvent(sessionId, { type: 'tool_start', name, input: ev.content_block.input ?? undefined })
        }
        break
      }
      case 'assistant': {
        // 完整 assistant 消息：文本/思考已由 stream_event 增量投递，这里只补 tool_use
        const content = (msg.message && msg.message.content) || []
        for (const block of (Array.isArray(content) ? content : [])) {
          if (block.type === 'tool_use') {
            const name = block.name || 'tool'
            if (block.id) st.toolByUseId.set(block.id, name)
            pushEvent(sessionId, { type: 'tool_start', name, input: block.input ?? undefined })
          }
          // text/thinking 块不重复投递（增量已覆盖；无增量模式时也只保真不伪造）
        }
        break
      }
      case 'user': {
        // --replay-user-messages 的用户回显 + tool_result
        const content = (msg.message && msg.message.content) || []
        for (const block of (Array.isArray(content) ? content : [])) {
          if (block.type === 'tool_result') {
            const name = st.toolByUseId.get(block.tool_use_id) || 'tool'
            const summary = typeof block.content === 'string' ? block.content.slice(0, 200) : undefined
            pushEvent(sessionId, { type: 'tool_result', name, summary })
          }
          // live user 回显不投递（渲染层已本地回显；重放场景经索引历史承载）
        }
        break
      }
      case 'result': {
        const w = st.turnWaiter
        const failed = msg.is_error || (msg.subtype && msg.subtype !== 'success')
        if (w) {
          if (failed) {
            const m = String(msg.result || msg.subtype || 'claude turn failed')
            w.queue.push({ type: 'error', message: m, code: /no conversation found|not found/i.test(m) ? 'session-not-found' : (toAgentError(new Error(m)).code) })
            if (w.resolve) { w.resolve(w.queue.shift()); w.resolve = null }
          }
          w.finished = true
          w.stopReason = failed ? 'error' : 'end_turn'
          if (w.done) w.done()
        }
        if (msg.session_id && msg.session_id !== sessionId) {
          for (const fn of eventListeners) { try { fn('result-session', { sessionId, native: msg.session_id }) } catch (_) {} }
        }
        break
      }
      case 'control_response':
        if (controlWaiter) { const fn = controlWaiter; controlWaiter = null; fn(msg) }
        break
      default:
        // 未知形状只记日志（线格式以真机实测为准，不伪造事件）
        log(`claude 未处理的消息类型: ${msg.type}`)
        break
    }
  }

  let controlWaiter = null

  function writeLine(st, obj) {
    try { st.child.stdin.write(JSON.stringify(obj) + '\n'); return true } catch (e) { log(`claude stdin 写入失败: ${String(e && e.message).slice(0, 120)}`); return false }
  }


  function liveProc(sessionId) {
    const st = procs.get(sessionId)
    return st && st.exitCode === null && !st.exitErr ? st : null
  }

  /** 发送回合：官方 streaming input。真机实测：init 消息随首条用户消息之后回流，
   *  故 spawn 后立即写 stdin（管道缓冲），不阻塞等 init。 */
  function turnContext(nativeSessionId) {
    const fresh = !procs.has(nativeSessionId)
    return liveProc(nativeSessionId) || spawnProc(nativeSessionId, fresh)
  }

  return {
    isAlive(sessionId) { return !!liveProc(sessionId) },
    onEvent(fn) { eventListeners.push(fn); return () => { eventListeners = eventListeners.filter((x) => x !== fn) } },

    /** 新会话：聚合器生成 uuid（官方 --session-id 指定）；子进程懒启动 */
    async createSession(_input = {}) {
      const sessionId = uuid()
      return { agentId: 'claude-code', nativeSessionId: sessionId, title: '', status: 'idle' }
    },

    /** 历史重放：CLI 无整段重放官方途径 → 空历史 + 标注（绝不解析原生 jsonl 伪造）。 */
    async loadSession(nativeSessionId) {
      return {
        agentId: 'claude-code',
        nativeSessionId,
        title: '',
        status: 'idle',
        history: [],
        historyNote: 'claude-code 官方流式通道不提供整段历史重放；历史承载于 Agent 原生存储，续接经官方 --resume',
      }
    },

    /** 发送回合：官方 streaming input；进程死亡后官方 --resume 续接 */
    streamMessage(nativeSessionId, text) {
      async function* turn() {
        let st
        try {
          st = turnContext(nativeSessionId)
        } catch (e) {
          // --resume 失败 = 官方探测到孤儿会话（session-not-found），真实上抛
          throw e.code ? e : toAgentError(e)
        }
        const w = { queue: [], resolve: null, done: null, errored: null, finished: false, stopReason: null }
        st.turnWaiter = w
        try {
          yield { type: 'message_start' }
          // 立即写首条用户消息（官方 streaming input；init 随后异步回流）
          const ok = writeLine(st, { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })
          if (!ok) throw agentError('offline', 'claude stdin 已关闭（进程退出）')
          let ended = false
          while (!ended) {
            if (w.queue.length > 0) { yield w.queue.shift(); continue }
            if (w.errored) throw w.errored
            if (w.finished) { while (w.queue.length > 0) yield w.queue.shift(); ended = true; break }
            const ev = await new Promise((resolve) => { w.resolve = resolve; w.done = () => resolve(null) })
            w.resolve = null; w.done = null
            if (ev) yield ev
          }
          yield { type: 'message_end', stopReason: w.stopReason || 'end_turn' }
          if (w.errored) throw w.errored
        } finally {
          st.turnWaiter = null
        }
      }
      return turn()
    },

    /** 真实取消：官方 control_request interrupt（持久进程模式）；无应答兜底 kill */
    async stopGeneration(nativeSessionId) {
      const st = procs.get(nativeSessionId)
      if (!st || st.exitCode !== null || st.exitErr) return
      const reqId = uuid()
      const got = new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), interruptGraceMs)
        controlWaiter = (msg) => {
          clearTimeout(t)
          resolve(String(msg && msg.response && msg.response.request_id) === reqId)
        }
      })
      const sent = writeLine(st, { type: 'control_request', request_id: reqId, request: { subtype: 'interrupt' } })
      if (!sent) return
      const ok = await got
      if (!ok) {
        log('claude interrupt 无应答 → kill 子进程（真实取消兜底）')
        try { st.child.kill() } catch (_) {}
      }
    },

    close() {
      for (const [, st] of procs.entries()) {
        try { st.child.stdin.end() } catch (_) {}
        const c = st.child
        setTimeout(() => { try { c.kill() } catch (_) {} }, 1500)
      }
      procs.clear()
    },
  }
}

module.exports = { createClaudeCliBridge, agentError, toAgentError }
