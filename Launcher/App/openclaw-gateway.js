/**
 * OpenClaw Gateway WS 会话桥（13.23 真实接线·主进程侧）。
 * ---------------------------------------------------------------------------
 * 官方通道：Gateway WebSocket RPC（唯一控制平面，docs/gateway/protocol/*，随包分发）。
 *   帧形：req {type:'req',id,method,params} / res {type:'res',id,ok,payload|error}
 *         / event {type:'event',event,payload,seq?}
 *   握手：首帧 connect；先收 connect.challenge{nonce,ts} 事件 → Ed25519 v3 签名
 *         （buildDeviceAuthPayloadV3：v3|deviceId|clientId|clientMode|role|scopes|
 *          signedAtMs|token|nonce|platform|deviceFamily）→ hello-ok。
 *   免共享 token：回环 + 设备签名走官方 Silent local pairing（pairing.md L225）。
 *
 * 架构裁决（13.22 §一，13.23 沿用）：OpenClaw Gateway = 会话真源（官方 embedding.md：
 * 「Use RPC instead of state files」——不读 sqlite/jsonl/nodes 配对文件）。
 * 本桥只做三件事：
 *   1. 官方 RPC 驱动真实会话（sessions.list/create/patch/delete + chat.send/history/abort）；
 *   2. 把原生 chat/agent 事件翻译为统一 AgentEvent；
 *   3. 真实错误原样上抛（AgentError 8 码语义），禁止伪造成功。
 *
 * 生命周期（官方 embedding.md 宿主配方）：真 Node 宿主（非 Electron execPath）+
 * embedding env；健康探活 /health；exit 78=EX_CONFIG → doctor --fix 重试一次；
 * startup-sidecars → close 1013（可重试）；orderly 关闭前广播 shutdown → close 1012。
 *
 * 纯 Node 模块（零新依赖：WS 用 Node 内置 WebSocket，签名用 node:crypto）。
 * 测试注入缝：wsOverride / spawnOverride / fetchOverride。
 */
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

/** 统一错误（与渲染层 AgentError 同语义） */
function agentError(code, message, agentId = 'openclaw') {
  const err = new Error(message)
  err.code = code
  err.agentId = agentId
  return err
}

/** 把 Gateway/底层错误映射为统一错误码（任务书 §十四） */
function toAgentError(err) {
  const msg = String((err && err.message) || err)
  const code = err && err.code
  if (/invalid device signature|DEVICE_AUTH|pairing required|auth token|unauthorized|401/i.test(msg)) {
    return agentError('permission', msg)
  }
  if (/provider|api key|credentials|model.*unavailable/i.test(msg) && !/ECONNREFUSED/i.test(msg)) {
    return agentError('provider-auth', msg)
  }
  if (/not found|unknown session|no such session/i.test(msg)) return agentError('session-not-found', msg)
  if (/ECONNREFUSED|ENOENT|spawn|cannot find|not running/i.test(msg)) return agentError('offline', msg)
  if (/timeout|timed out/i.test(msg)) return agentError('timeout', msg)
  if (code === 'timeout') return agentError('timeout', msg)
  if (/busy|already running|in progress|queue/i.test(msg)) return agentError('busy', msg)
  return agentError('protocol', msg)
}

function uuid() {
  return crypto.randomUUID()
}

/** 设备身份：launcher 自己的 Ed25519 密钥（自生成、本地存储、永不显示/上报）。
 *  这是设备配对身份，与「Agent API 密钥零接触」是两类东西。 */
function loadOrCreateDeviceIdentity(deviceFile, log) {
  try {
    const raw = JSON.parse(fs.readFileSync(deviceFile, 'utf8'))
    if (raw && raw.deviceId && raw.publicKeyPem && raw.privateKeyPem) return raw
  } catch (_) { /* 不存在则生成 */ }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  // deviceId = sha256(canonical raw 公钥 32B).hex；公钥 = raw base64url（SPKI DER 去 12B 头）
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' })
  const rawPub = spkiDer.subarray(12)
  const deviceId = crypto.createHash('sha256').update(rawPub).digest('hex')
  const identity = { deviceId, publicKeyPem, privateKeyPem }
  fs.mkdirSync(path.dirname(deviceFile), { recursive: true })
  fs.writeFileSync(deviceFile, JSON.stringify(identity, null, 2) + '\n', 'utf8')
  log(`openclaw 设备身份已生成 ${deviceFile}`)
  return identity
}

/** Gateway 本地 IPC token：launcher 生成、经 env 注入自己的 Gateway 子进程，
 *  connect 携带同一 token（官方 OPENCLAW_GATEWAY_TOKEN env 通道）。
 *  这是 launcher↔自身子进程的本地通道凭据，非 Agent API 密钥，不落用户配置。 */
function loadOrCreateGatewayToken(tokenFile, log) {
  try {
    const raw = JSON.parse(fs.readFileSync(tokenFile, 'utf8'))
    if (raw && raw.token) return String(raw.token)
  } catch (_) { /* 不存在则生成 */ }
  const token = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true })
  fs.writeFileSync(tokenFile, JSON.stringify({ token }, null, 2) + '\n', 'utf8')
  log(`openclaw gateway token 已生成 ${tokenFile}`)
  return token
}

/** v3 设备签名（官方 device-auth buildDeviceAuthPayloadV3 逐字段一致） */
function buildDeviceAuthPayloadV3({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce, platform, deviceFamily }) {
  return [
    'v3', deviceId, clientId, clientMode, role, scopes.join(','),
    String(signedAtMs), token ?? '', nonce,
    String(platform).toLowerCase(), String(deviceFamily).toLowerCase(),
  ].join('|')
}

/** OpenClaw Gateway WS 客户端 + 宿主生命周期 */
function createOpenClawGateway(opts = {}) {
  const nodeExe = opts.nodeExe
  const openclawEntry = opts.openclawEntry
  const openclawAppDir = opts.openclawAppDir || (openclawEntry ? path.dirname(path.dirname(path.dirname(openclawEntry))) : undefined)
  const stateDir = opts.stateDir
  const configPath = opts.configPath
  const deviceFile = opts.deviceFile
  const gatewayTokenFile = opts.gatewayTokenFile
  const port = opts.port || 18789
  const healthUrl = opts.healthUrl || `http://127.0.0.1:${port}/health`
  const wsUrl = opts.wsUrl || `ws://127.0.0.1:${port}`
  const extraEnv = opts.env || {}
  const log = opts.log || (() => {})
  const spawnImpl = opts.spawnOverride || spawn
  const fetchImpl = opts.fetchOverride || ((u, o) => fetch(u, o))
  const WSCtor = opts.wsOverride || globalThis.WebSocket
  const connectTimeoutMs = opts.connectTimeoutMs || 20000
  const rpcTimeoutMs = opts.rpcTimeoutMs || 30000
  const startupTimeoutMs = opts.startupTimeoutMs || 90000
  const maxStartupRetries = opts.maxStartupRetries || 6

  if (!nodeExe || !openclawEntry || !stateDir || !configPath || !deviceFile) {
    throw agentError('offline', 'openclaw-gateway 需要 nodeExe/openclawEntry/stateDir/configPath/deviceFile')
  }

  let ws = null
  let helloOk = null
  let deviceToken = '' // hello-ok.auth.deviceToken（官方：配对后持久化，重连复用）
  const gatewayToken = gatewayTokenFile ? loadOrCreateGatewayToken(gatewayTokenFile, log) : ''
  let reqSeq = 0
  let closing = false
  /** id → {resolve,reject,timer} */
  const pending = new Map()
  /** sessionKey → { queue:[], resolve, done, errored, finished, active:boolean } 回合等待器 */
  const turnWaiters = new Map()
  /** runId → cumulative thinking text（delta 前缀投影；agent 事件 text 为累计值） */
  const thinkState = new Map()
  let connectingPromise = null
  let gatewayChild = null
  let eventListeners = []

  function childEnv() {
    return {
      ...process.env,
      ...extraEnv,
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_CONFIG_PATH: configPath,
      ...(gatewayToken ? { OPENCLAW_GATEWAY_TOKEN: gatewayToken } : {}),
      // 官方 embedding preset（Electron 宿主四件套）
      OPENCLAW_DISABLE_BONJOUR: '1',
      OPENCLAW_EXEC_SHELL_SNAPSHOT: '0',
      OPENCLAW_NO_RESPAWN: '1',
      OPENCLAW_SKIP_CHANNELS: '1',
    }
  }

  async function probeHealth(timeoutMs = 1500) {
    try {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), timeoutMs)
      const res = await fetchImpl(healthUrl, { signal: ac.signal })
      clearTimeout(t)
      return res.ok
    } catch (_) { return false }
  }

  /** 官方 doctor --fix（EX_CONFIG 修复路径） */
  function runDoctor() {
    return new Promise((resolve) => {
      const p = spawnImpl(nodeExe, [openclawEntry, 'doctor', '--fix', '--yes', '--non-interactive'], {
        cwd: openclawAppDir,
        env: childEnv(),
        stdio: 'ignore',
        windowsHide: true,
      })
      p.on('exit', (code) => resolve(code === 0))
      p.on('error', () => resolve(false))
    })
  }

  /** 启动 Gateway 宿主（已在跑则不重复 spawn）并等待 /health 就绪 */
  async function ensureGatewayChild() {
    if (gatewayChild) return
    if (await probeHealth()) { log('openclaw gateway 已在运行，直连不重复 spawn'); return }
    const startOnce = () => new Promise((resolve, reject) => {
      const child = spawnImpl(nodeExe, [openclawEntry, 'gateway', 'run', '--allow-unconfigured'], {
        cwd: openclawAppDir,
        env: childEnv(),
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      })
      gatewayChild = child
      let stderrTail = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (d) => {
        stderrTail = (stderrTail + String(d)).slice(-2000)
        log(`openclaw-gw stderr: ${String(d).trim().slice(0, 200)}`)
      })
      child.on('exit', (code) => {
        log(`openclaw-gw 退出 code=${code}`)
        gatewayChild = null
        if (!closing && code === 78) { reject(Object.assign(new Error('EX_CONFIG'), { exitCode: 78, stderrTail })) }
        else if (!closing && code !== null && code !== 0 && code !== 78) {
          reject(Object.assign(new Error(`gateway 退出 code=${code}`), { exitCode: code, stderrTail }))
        }
      })
      child.on('error', (e) => { gatewayChild = null; reject(e) })
      // 就绪等待：官方 embedding.md——以 WS 信号为准，/health 仅作宿主级探活
      const started = Date.now()
      const poll = async () => {
        while (Date.now() - started < startupTimeoutMs) {
          if (gatewayChild !== child) return // 已退出，由 exit 分支裁决
          if (await probeHealth()) { resolve(child); return }
          await new Promise((r) => setTimeout(r, 500))
        }
        reject(new Error(`gateway 启动超时（${startupTimeoutMs}ms）`))
      }
      void poll()
    })
    try {
      await startOnce()
    } catch (e) {
      if (e && e.exitCode === 78) {
        log('openclaw-gw EX_CONFIG（78）→ 官方 doctor --fix 后重试一次')
        const fixed = await runDoctor()
        if (!fixed) throw agentError('protocol', `openclaw doctor --fix 失败：${(e.stderrTail || '').slice(-300)}`)
        await startOnce()
      } else { throw e }
    }
  }

  function handleEvent(event, payload) {
    if (event === 'connect.challenge') return // 由握手流程内部处理
    if (event === 'shutdown') {
      log(`openclaw-gw shutdown 事件 reason=${payload && payload.reason} restartExpectedMs=${payload && payload.restartExpectedMs}`)
      return
    }
    if (event === 'chat') { handleChatEvent(payload); return }
    if (event === 'agent') { handleAgentEvent(payload); return }
    if (event === 'sessions.changed') { for (const fn of eventListeners) { try { fn('sessions.changed', payload) } catch (_) {} } return }
    // 其余事件族（tick/presence/health/...）不翻译，不伪造
  }

  /** chat 事件（run 生命周期 + 累计文本 delta）→ 回合等待器 */
  function handleChatEvent(p) {
    if (!p || !p.sessionKey) return
    const w = turnWaiters.get(p.sessionKey)
    if (!w) return
    if (p.state === 'delta') {
      // 协议 v4：delta 帧固定 replace:true，deltaText=累计全量文本
      if (typeof p.deltaText === 'string' && p.deltaText) {
        w.queue.push({ type: 'text_replace', text: p.deltaText })
        if (w.resolve) { w.resolve(w.queue.shift()); w.resolve = null }
      }
      return
    }
    if (p.state === 'final') {
      w.finished = true
      w.stopReason = p.stopReason || 'end_turn'
      if (w.done) w.done()
      return
    }
    if (p.state === 'aborted') {
      w.finished = true
      w.stopReason = 'cancelled'
      if (w.done) w.done()
      return
    }
    if (p.state === 'error') {
      w.errored = agentError('provider-auth', String(p.errorMessage || 'chat run failed'))
      if (p.errorKind && !/provider|auth|key/i.test(String(p.errorMessage || ''))) {
        w.errored = agentError('protocol', `${p.errorKind}: ${p.errorMessage || ''}`)
      }
      w.finished = true
      if (w.done) w.done()
      return
    }
    if (p.state === 'status') return // 队列/调度状态，不翻译
  }

  /** agent 事件（thinking/tool 流）→ 回合等待器 */
  function handleAgentEvent(p) {
    if (!p || !p.sessionKey) return
    const w = turnWaiters.get(p.sessionKey)
    if (!w) return
    const data = p.data || {}
    if (p.stream === 'thinking') {
      const full = typeof data.text === 'string' ? data.text : ''
      const delta = typeof data.delta === 'string' ? data.delta : ''
      const key = `${p.runId}`
      const prev = thinkState.get(key) ?? ''
      if (!w.thinkKeys) w.thinkKeys = []
      if (!w.thinkKeys.includes(key)) w.thinkKeys.push(key)
      if (delta && (prev === '' || full.startsWith(prev))) {
        thinkState.set(key, full)
        w.queue.push({ type: 'thinking', text: delta })
      } else if (full) {
        // 前缀断裂（重排/替换）→ 整段替换语义，绝不拼接出重复内容
        thinkState.set(key, full)
        w.queue.push({ type: 'thinking_replace', text: full })
      }
      if (w.resolve) { w.resolve(w.queue.shift()); w.resolve = null }
      return
    }
    if (p.stream === 'tool') {
      const phase = data.phase
      const name = data.name || 'tool'
      if (phase === 'start') {
        w.queue.push({ type: 'tool_start', name, input: data.args ?? undefined })
      } else if (phase === 'result' || phase === 'end') {
        const r = data.result
        const summary = typeof r === 'string' ? r.slice(0, 200)
          : r && typeof r === 'object' && typeof r.text === 'string' ? r.text.slice(0, 200)
          : undefined
        w.queue.push({ type: 'tool_result', name, summary })
      }
      // phase 'update'（部分结果）不翻译
      if (w.resolve) { w.resolve(w.queue.shift()); w.resolve = null }
      return
    }
    // assistant 文本走 chat 事件族（避免双投递）；plan/run_status/lifecycle/error 流不翻译
  }

  function handleFrame(raw) {
    let msg
    try { msg = JSON.parse(raw) } catch { log(`openclaw-gw 无法解析的帧: ${String(raw).slice(0, 120)}`); return }
    if (msg.type === 'res') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.ok) p.resolve(msg.payload)
      else {
        const err = new Error((msg.error && msg.error.message) || 'gateway rpc error')
        err.details = msg.error && msg.error.details
        err.errorCode = msg.error && msg.error.code
        p.reject(err)
      }
      return
    }
    if (msg.type === 'event') {
      if (msg.event === 'connect.challenge') {
        // challenge 可能先于握手代码注册 waiter 到达——缓存补投
        if (challengeWaiter) { const fn = challengeWaiter; challengeWaiter = null; fn(msg.payload || {}) }
        else pendingChallenge = msg.payload || {}
        return
      }
      handleEvent(msg.event, msg.payload)
      return
    }
  }

  let challengeWaiter = null
  let pendingChallenge = null

  function sendFrame(obj) {
    if (!ws) throw agentError('offline', 'openclaw-gw WS 未连接')
    ws.send(JSON.stringify(obj))
  }

  function rpc(method, params, timeoutMs = rpcTimeoutMs) {
    // 官方 RequestFrameSchema：id 必须是非空字符串（数字 id 被网关判 invalid request frame）
    const id = `c${++reqSeq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(agentError('timeout', `openclaw ${method} 超时（${timeoutMs}ms）`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try { sendFrame({ type: 'req', id, method, params: params || {} }) }
      catch (e) { pending.delete(id); clearTimeout(timer); reject(toAgentError(e)) }
    })
  }

  /** 握手：connect.challenge → v3 签名 → connect → hello-ok。
   *  startup-sidecars（close 1013 / UNAVAILABLE）按官方 embedding.md 有界重连。 */
  async function connectOnce() {
    pendingChallenge = null // 陈旧连接的缓存先丢弃
    await new Promise((resolve, reject) => {
      const sock = new WSCtor(wsUrl)
      const onErr = () => { try { sock.close() } catch (_) {} reject(agentError('offline', 'openclaw-gw WS 连接失败')) }
      sock.addEventListener('error', onErr, { once: true })
      sock.addEventListener('open', () => {
        sock.removeEventListener('error', onErr)
        ws = sock
        sock.addEventListener('message', (ev) => handleFrame(typeof ev.data === 'string' ? ev.data : String(ev.data)))
        sock.addEventListener('close', (ev) => {
          const code = ev && ev.code
          const reason = (ev && ev.reason) || ''
          const wasHello = !!helloOk
          ws = null
          helloOk = null
          // 掉线：拒绝在途请求 + 终止回合等待器（真实失败，不伪造完成）
          const err = agentError('offline', `openclaw-gw WS 关闭 code=${code} ${reason}`)
          for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err) }
          pending.clear()
          for (const [key, w] of turnWaiters.entries()) {
            if (!w.finished) { w.errored = err; w.finished = true; if (w.done) w.done() }
          }
          thinkState.clear()
          if (!closing && wasHello) scheduleReconnect()
        })
        resolve()
      }, { once: true })
    })
    // challenge（可能已缓存到达）
    const challenge = await new Promise((resolve, reject) => {
      if (pendingChallenge) { const c = pendingChallenge; pendingChallenge = null; resolve(c); return }
      const t = setTimeout(() => reject(agentError('timeout', '等待 connect.challenge 超时')), connectTimeoutMs)
      challengeWaiter = (payload) => { clearTimeout(t); resolve(payload) }
    })
    if (!challenge || !challenge.nonce) throw agentError('protocol', 'connect.challenge 缺少 nonce')
    const identity = loadOrCreateDeviceIdentity(deviceFile, log)
    const spkiDer = crypto.createPublicKey(identity.publicKeyPem).export({ type: 'spki', format: 'der' })
    const publicKeyB64u = spkiDer.subarray(12).toString('base64url')
    const scopes = ['operator.read', 'operator.write']
    // 签名 token 必须与服务端 resolveSignatureToken(auth.token ?? auth.deviceToken ?? …) 一致：
    // 已配对设备优先 stored device token；否则用 launcher 本地 gateway token（env 注入同值）
    const authToken = deviceToken || gatewayToken
    const payload = buildDeviceAuthPayloadV3({
      deviceId: identity.deviceId,
      clientId: 'gateway-client',
      clientMode: 'backend',
      role: 'operator',
      scopes,
      signedAtMs: challenge.ts || Date.now(),
      token: authToken,
      nonce: challenge.nonce,
      platform: process.platform,
      deviceFamily: 'desktop',
    })
    const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), identity.privateKeyPem).toString('base64url')
    const hello = await rpc('connect', {
      minProtocol: 4,
      maxProtocol: 4,
      // 服务端 v3 验签载荷使用 client.platform/client.deviceFamily（node-connect-reconcile
      // resolveDeviceSignaturePayloadVersion）——deviceFamily 必须与签名一致，漏传即签名不匹配
      client: { id: 'gateway-client', displayName: 'AI Agent Launcher', version: '1.0.0', platform: process.platform, mode: 'backend', deviceFamily: 'desktop' },
      role: 'operator',
      scopes,
      device: {
        id: identity.deviceId,
        publicKey: publicKeyB64u,
        signature,
        signedAt: challenge.ts || Date.now(),
        nonce: challenge.nonce,
      },
      auth: deviceToken ? { deviceToken } : (gatewayToken ? { token: gatewayToken } : {}),
    }, connectTimeoutMs)
    helloOk = hello || {}
    const issued = helloOk && helloOk.auth && helloOk.auth.deviceToken
    if (issued && issued !== deviceToken) {
      deviceToken = String(issued)
      log('openclaw-gw device token 已持久化（内存；重连复用）')
    }
    log('openclaw-gw hello-ok scopes=' + JSON.stringify((helloOk.auth && helloOk.auth.scopes) || []))
  }

  let reconnectTimer = null
  let reconnectAttempts = 0
  function scheduleReconnect() {
    if (closing || reconnectTimer || connectingPromise) return
    if (reconnectAttempts >= maxStartupRetries) {
      log(`openclaw-gw 重连放弃（${reconnectAttempts} 次）——后续调用将以 offline 报错`)
      return
    }
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 8000)
    reconnectAttempts += 1
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null
      try {
        await ensureGatewayChild()
        await connectWithRetry()
        reconnectAttempts = 0
      } catch (e) {
        log(`openclaw-gw 重连失败: ${String(e && e.message).slice(0, 160)}`)
        scheduleReconnect()
      }
    }, delay)
  }

  async function connectWithRetry() {
    // startup-sidecars：connect 返回可重试 UNAVAILABLE 后 close 1013 'gateway starting'
    let rotated = false
    for (let i = 0; i < maxStartupRetries; i++) {
      try {
        await connectOnce()
        return
      } catch (e) {
        const msg = String((e && e.message) || e)
        const retryable = (e && e.details && e.details.reason === 'startup-sidecars')
          || /gateway starting/i.test(String((e && e.details) && e.details.reason || ''))
        if (!retryable || i === maxStartupRetries - 1) {
          // 旧设备身份若在先前会话被静默配对但 device token 未持久化，重连会陷入
          // 「gateway token missing」死锁（loopback 首配自动批准只对新设备放行）→
          // 轮换一次设备身份（launcher 自有密钥，重新生成即可，不触 Agent 数据）
          if (!rotated && !deviceToken && /gateway token missing|unauthorized/i.test(msg)) {
            rotated = true
            log('openclaw-gw 设备 token 死锁 → 轮换设备身份后重连（loopback 静默配对）')
            try { fs.rmSync(deviceFile, { force: true }) } catch (_) {}
            i = Math.max(i - 1, -1) // 轮换后重试不消耗重试预算
            continue
          }
          throw e
        }
        const waitMs = Math.min((e.details && e.details.retryAfterMs) || 1500, 5000)
        log(`openclaw-gw startup-sidecars，${waitMs}ms 后重试（${i + 1}/${maxStartupRetries}）`)
        await new Promise((r) => setTimeout(r, waitMs))
      }
    }
  }

  async function ensureConnected() {
    if (closing) throw agentError('offline', 'openclaw-gw 已关闭')
    if (helloOk && ws) return
    if (!connectingPromise) {
      connectingPromise = (async () => {
        await ensureGatewayChild()
        await connectWithRetry()
      })().finally(() => { connectingPromise = null })
    }
    await connectingPromise
  }

  function rowToSession(row) {
    return {
      agentId: 'openclaw',
      nativeSessionId: row.key,
      // 官方行字段：displayName > label > autoLabel/derivedTitle；都缺则空（渲染层兜底「未命名」）
      title: row.displayName || row.label || row.autoLabel || row.derivedTitle || '',
      status: row.hasActiveRun ? 'generating' : (row.archived ? 'archived' : 'idle'),
      archived: !!row.archived,
      preview: row.lastMessagePreview || '',
      updatedAt: row.updatedAt || undefined,
      createdAt: row.createdAt || undefined,
    }
  }

  function extractText(content) {
    if (!content) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('')
    if (typeof content.text === 'string') return content.text
    return ''
  }

  return {
    isAlive() { return !!(ws && helloOk) },
    onSessionsChanged(fn) { eventListeners.push(fn); return () => { eventListeners = eventListeners.filter((x) => x !== fn) } },

    async listSessions() {
      await ensureConnected()
      try {
        const r = await rpc('sessions.list', { limit: 200, includeLastMessage: true })
        const rows = Array.isArray(r && r.sessions) ? r.sessions : []
        return rows.map(rowToSession)
      } catch (e) { throw toAgentError(e) }
    },

    async createSession(_input = {}) {
      await ensureConnected()
      try {
        const r = await rpc('sessions.create', { idempotencyKey: uuid() }, 60000)
        const key = (r && r.key) || ''
        if (!key) throw agentError('protocol', 'sessions.create 未返回 key')
        return { agentId: 'openclaw', nativeSessionId: key, title: '', status: 'idle' }
      } catch (e) { throw toAgentError(e) }
    },

    /** 历史重放：官方 chat.history（display-normalized；不读任何私有存储） */
    async loadSession(nativeSessionId) {
      await ensureConnected()
      try {
        const r = await rpc('chat.history', { sessionKey: nativeSessionId, limit: 200 }, 60000)
        const msgs = Array.isArray(r && r.messages) ? r.messages : []
        const history = []
        for (const m of msgs) {
          const text = extractText(m.content ?? m.text)
          if (!text) continue
          if (m.role === 'user') history.push({ type: 'user_message', text })
          else if (m.role === 'assistant') history.push({ type: 'text_delta', text })
          // 其余角色（tool 等）不伪造为文本流
        }
        return { agentId: 'openclaw', nativeSessionId, title: '', status: 'idle', history }
      } catch (e) {
        if (/not found|unknown session/i.test(String(e && e.message))) throw agentError('session-not-found', String(e.message))
        throw toAgentError(e)
      }
    },

    /** 发送回合：chat.send（idempotencyKey 必填，客户端生成）→ 事件流直到 final/aborted/error */
    streamMessage(nativeSessionId, text) {
      async function* turn() {
        await ensureConnected()
        const w = { queue: [], resolve: null, done: null, errored: null, finished: false, stopReason: null }
        turnWaiters.set(nativeSessionId, w)
        let ack = null
        try {
          yield { type: 'message_start' }
          const sendPromise = rpc('chat.send', {
            sessionKey: nativeSessionId,
            message: text,
            idempotencyKey: uuid(),
          }, 60000).then((r) => { ack = r }).catch((e) => {
            w.errored = toAgentError(e)
            w.finished = true
            if (w.done) w.done()
          })
          // ack 前可能有事件先到（accepted 即开跑）；泵队列直到 finished
          let ended = false
          while (!ended) {
            if (w.queue.length > 0) { yield w.queue.shift(); continue }
            if (w.errored) throw w.errored
            if (w.finished) { while (w.queue.length > 0) yield w.queue.shift(); ended = true; break }
            const ev = await new Promise((resolve) => { w.resolve = resolve; w.done = () => resolve(null) })
            w.resolve = null; w.done = null
            if (ev) yield ev
          }
          await sendPromise
          yield { type: 'message_end', stopReason: w.stopReason || 'end_turn' }
          if (w.errored) throw w.errored
          void ack
        } finally {
          turnWaiters.delete(nativeSessionId)
          for (const rk of (w.thinkKeys || [])) thinkState.delete(rk)
        }
      }
      return turn()
    },

    async stopGeneration(nativeSessionId) {
      if (!this.isAlive()) return
      try {
        await rpc('chat.abort', { sessionKey: nativeSessionId }, 10000)
      } catch (e) {
        // 回合已自然结束时 abort 会报错——视为已停止，不伪造失败
        log(`openclaw chat.abort: ${String(e && e.message).slice(0, 120)}`)
      }
    },

    /** 官方原生重命名：sessions.patch label */
    async renameSession(nativeSessionId, title) {
      await ensureConnected()
      try { await rpc('sessions.patch', { key: nativeSessionId, label: title }) }
      catch (e) { throw toAgentError(e) }
    },

    /** 官方原生归档/恢复：sessions.patch archived */
    async archiveSession(nativeSessionId, archived = true) {
      await ensureConnected()
      try { await rpc('sessions.patch', { key: nativeSessionId, archived: !!archived }) }
      catch (e) { throw toAgentError(e) }
    },

    /** 官方删除：sessions.delete。operator.write 调用者必须 archivedOnly:true；
     *  权限不足时官方降级路径：先 patch archived:true 再删。 */
    async deleteSession(nativeSessionId) {
      await ensureConnected()
      try {
        await rpc('sessions.delete', { key: nativeSessionId, archivedOnly: true }, 60000)
        return
      } catch (e) {
        const msg = String(e && e.message)
        if (!/permission|scope|admin|forbidden/i.test(msg)) throw toAgentError(e)
        log('openclaw sessions.delete 权限不足 → 降级：先归档再删')
      }
      try {
        await rpc('sessions.patch', { key: nativeSessionId, archived: true })
        await rpc('sessions.delete', { key: nativeSessionId, archivedOnly: true }, 60000)
      } catch (e) { throw toAgentError(e) }
    },

    /** 关闭（应用退出/测试收尾）：先 WS 后子进程 */
    close() {
      closing = true
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      try { if (ws) { ws.close(1000, 'client shutdown'); ws = null } } catch (_) {}
      helloOk = null
      if (gatewayChild) {
        const c = gatewayChild
        gatewayChild = null
        setTimeout(() => { try { c.kill() } catch (_) {} }, 1500)
      }
    },
  }
}

module.exports = { createOpenClawGateway, agentError, toAgentError, buildDeviceAuthPayloadV3, loadOrCreateDeviceIdentity }
