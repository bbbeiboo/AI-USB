/**
 * stubAgentControlService —— 内存状态机（UI v2 的体验驱动源）。
 * ---------------------------------------------------------------------------
 * 硬边界（任务书 4）：只返回模拟数据与内存状态——不碰真实进程、真实配置、
 * agent-state.json、pm 层、文件系统。所有演示内容显式带「stub」标识，不冒充真数据。
 *
 * 状态流转（可经 onStatusChange 全程观察）：
 *   start:  --800ms-->  STOPPED → STARTING → RUNNING
 *   stop:   --500ms-->  RUNNING → STOPPING → STOPPED
 *   restart = stop → 300ms 间隔 → start（完整 绿→黄→灰→黄→绿）
 *
 * 本文件零运行时依赖（仅 import type），Node strip-types 可直接加载（根 tests/ 单测）。
 */
import type {
  AgentControlService,
  AgentStatus,
  AgentSummary,
  CallRecord,
  OutputEntry,
  OutputHandler,
  SessionMeta,
  StatusChangeHandler,
} from './agent-control-types.ts'

export interface StubOptions {
  startDelayMs?: number
  stopDelayMs?: number
  restartGapMs?: number
  sendDelayMs?: number
}

interface AgentSeed {
  id: string
  name: string
  short: string
  baseUrl: string
  version: string
}

/** 演示名单：id 与 agents.json 一致（下一轮接线直接对上真实清单） */
const AGENT_SEEDS: AgentSeed[] = [
  { id: 'openclaw', name: 'OpenClaw', short: 'O', baseUrl: 'https://demo.local/v1（stub）', version: 'stub 1.0' },
  { id: 'hermes', name: 'Hermes', short: 'H', baseUrl: 'https://demo.local/v1（stub）', version: 'stub 1.0' },
  { id: 'codex', name: 'Codex', short: 'C', baseUrl: 'https://demo.local/v1（stub）', version: 'stub 1.0' },
  { id: 'claude-code', name: 'Claude Code', short: 'CC', baseUrl: 'https://demo.local/v1（stub）', version: 'stub 1.0' },
]

const SEED_SESSION_TITLES = ['初始化体检', '日志走查', '示例任务']

/** 每 Agent 演示模型清单（13.16 模型切换器；stub 内存值，接线轮来自 provider 缓存） */
const STUB_MODELS: Record<string, string[]> = {
  openclaw: ['qwen 3.8 27B', 'glm-5.3', 'deepseek-v4'],
  hermes: ['hermes-4-405b', 'llama-4-maverick', 'qwen 3.8 27B'],
  codex: ['gpt-5.2-codex', 'o4-mini', 'claude-sonnet-4'],
  'claude-code': ['claude-sonnet-4.5', 'claude-opus-4.1', 'claude-haiku-4'],
}

export function createStubAgentControlService(opts: StubOptions = {}): AgentControlService & { __calls: CallRecord[] } {
  const startDelay = opts.startDelayMs ?? 800
  const stopDelay = opts.stopDelayMs ?? 500
  const restartGap = opts.restartGapMs ?? 300
  const sendDelay = opts.sendDelayMs ?? 300
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  const status = new Map<string, AgentStatus>()
  const pinned = new Set<string>()
  const sessions = new Map<string, SessionMeta[]>()
  const currentSession = new Map<string, string>()
  const currentModel = new Map<string, string>()
  const outputs = new Map<string, OutputEntry[]>()
  const clearedBackup = new Map<string, OutputEntry[]>()
  const statusCbs = new Set<StatusChangeHandler>()
  const outputCbs = new Set<OutputHandler>()
  const calls: CallRecord[] = []
  let seq = 0
  const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`

  function record(method: string, ...args: unknown[]) {
    calls.push({ method, args, ts: Date.now() })
  }
  function emitStatus(id: string, s: AgentStatus) {
    status.set(id, s)
    for (const cb of statusCbs) {
      try { cb(id, s) } catch (_) { /* 单个监听器异常不扩散 */ }
    }
  }
  function pushEntry(agentId: string, entry: OutputEntry) {
    const arr = outputs.get(entry.sessionId)
    if (arr) arr.push(entry)
    for (const cb of outputCbs) {
      try { cb(agentId, entry) } catch (_) {}
    }
  }
  /** 流式条目按 id 原位更新后重发（UI upsert 渲染打字机效果） */
  function updateEntry(agentId: string, entry: OutputEntry) {
    const arr = outputs.get(entry.sessionId)
    if (arr) {
      const i = arr.findIndex((x) => x.id === entry.id)
      if (i >= 0) arr[i] = entry
      else arr.push(entry)
    }
    for (const cb of outputCbs) {
      try { cb(agentId, entry) } catch (_) {}
    }
  }

  // ---- 种子数据：每 Agent 3 条历史会话 + 演示输出 ---------------------------
  for (const a of AGENT_SEEDS) {
    currentModel.set(a.id, STUB_MODELS[a.id]?.[0] ?? 'stub-model')
    const list: SessionMeta[] = SEED_SESSION_TITLES.map((title, i) => {
      const createdAt = Date.now() - (i + 1) * 3600_000
      return { id: `seed-${a.id}-${i + 1}`, agentId: a.id, title, createdAt, updatedAt: createdAt, pinned: false }
    })
    sessions.set(a.id, list)
    currentSession.set(a.id, list[0].id)
    for (const s of list) {
      outputs.set(s.id, [
        { id: nextId('e'), sessionId: s.id, ts: s.createdAt, kind: 'system', text: '会话开始（stub 演示数据，不涉及真实进程）' },
        { id: nextId('e'), sessionId: s.id, ts: s.createdAt + 1000, kind: 'user', text: '帮我看下当前环境状态' },
        { id: nextId('e'), sessionId: s.id, ts: s.createdAt + 2000, kind: 'agent', text: `${a.name}（stub）：环境就绪，Runtime/ 与 Agents/ 目录完整，可以开始演示。` },
      ])
    }
  }

  function assertAgent(id: string) {
    if (!AGENT_SEEDS.some((a) => a.id === id)) throw new Error(`stub: unknown agent ${id}`)
  }
  function seed(id: string): AgentSeed {
    return AGENT_SEEDS.find((a) => a.id === id) as AgentSeed
  }

  // ---- 进程生命周期 ---------------------------------------------------------
  async function startAgent(id: string): Promise<AgentStatus> {
    record('startAgent', id)
    assertAgent(id)
    if (status.get(id) === 'RUNNING') return 'RUNNING'
    emitStatus(id, 'STARTING')
    await sleep(startDelay)
    emitStatus(id, 'RUNNING')
    return 'RUNNING'
  }
  async function stopAgent(id: string): Promise<AgentStatus> {
    record('stopAgent', id)
    assertAgent(id)
    if (status.get(id) === 'STOPPED' || status.get(id) === undefined) return 'STOPPED'
    emitStatus(id, 'STOPPING')
    await sleep(stopDelay)
    emitStatus(id, 'STOPPED')
    return 'STOPPED'
  }
  async function restartAgent(id: string): Promise<AgentStatus> {
    record('restartAgent', id)
    assertAgent(id)
    await stopAgent(id)
    await sleep(restartGap)
    return startAgent(id)
  }

  // ---- 会话/输出 ------------------------------------------------------------
  async function newSession(id: string): Promise<SessionMeta> {
    record('newSession', id)
    assertAgent(id)
    const now = Date.now()
    const meta: SessionMeta = { id: nextId(`s-${id}`), agentId: id, title: `新会话 ${new Date(now).toLocaleTimeString('zh-CN', { hour12: false })}`, createdAt: now, updatedAt: now, pinned: false }
    sessions.get(id)?.unshift(meta)
    currentSession.set(id, meta.id)
    outputs.set(meta.id, [])
    return meta
  }
  /** 会话列表：置顶优先（稳定排序），组内按原时间顺序 */
  function sortedSessions(id: string): SessionMeta[] {
    const list = [...(sessions.get(id) ?? [])]
    return list.filter((s) => s.pinned).concat(list.filter((s) => !s.pinned))
  }
  async function listSessions(id: string): Promise<SessionMeta[]> {
    record('listSessions', id)
    assertAgent(id)
    return sortedSessions(id)
  }
  async function renameSession(id: string, sessionId: string, title: string): Promise<SessionMeta> {
    record('renameSession', id, sessionId, title)
    assertAgent(id)
    const meta = sessions.get(id)?.find((s) => s.id === sessionId)
    if (!meta) throw new Error(`stub: session ${sessionId} not found`)
    const clean = title.trim()
    if (clean) {
      meta.title = clean
      meta.updatedAt = Date.now()
    }
    return { ...meta }
  }
  async function deleteSession(id: string, sessionId: string): Promise<void> {
    record('deleteSession', id, sessionId)
    assertAgent(id)
    const list = sessions.get(id)
    if (!list) throw new Error(`stub: session ${sessionId} not found`)
    const i = list.findIndex((s) => s.id === sessionId)
    if (i < 0) throw new Error(`stub: session ${sessionId} not found`)
    list.splice(i, 1)
    outputs.delete(sessionId)
    if (currentSession.get(id) === sessionId) {
      const next = sortedSessions(id)[0]?.id
      if (next) currentSession.set(id, next)
      else currentSession.delete(id)
    }
  }
  async function pinSession(id: string, sessionId: string, pin: boolean): Promise<void> {
    record('pinSession', id, sessionId, pin)
    assertAgent(id)
    const meta = sessions.get(id)?.find((s) => s.id === sessionId)
    if (!meta) throw new Error(`stub: session ${sessionId} not found`)
    meta.pinned = pin
  }
  async function switchSession(id: string, sessionId: string): Promise<SessionMeta> {
    record('switchSession', id, sessionId)
    assertAgent(id)
    const meta = sessions.get(id)?.find((s) => s.id === sessionId)
    if (!meta) throw new Error(`stub: session ${sessionId} not found`)
    currentSession.set(id, sessionId)
    return meta
  }
  async function getOutput(id: string): Promise<OutputEntry[]> {
    record('getOutput', id)
    assertAgent(id)
    const csid = currentSession.get(id)
    return [...(outputs.get(csid ?? '') ?? [])]
  }
  async function clearOutput(id: string): Promise<void> {
    record('clearOutput', id)
    assertAgent(id)
    const csid = currentSession.get(id)
    if (!csid) return
    const arr = outputs.get(csid)
    if (arr && arr.length > 0) clearedBackup.set(csid, [...arr])
    if (arr) arr.length = 0
  }
  async function undoClearOutput(id: string): Promise<OutputEntry[] | null> {
    record('undoClearOutput', id)
    assertAgent(id)
    const csid = currentSession.get(id)
    if (!csid) return null
    const backup = clearedBackup.get(csid)
    if (!backup) return null
    clearedBackup.delete(csid)
    outputs.set(csid, [...backup])
    return [...backup]
  }
  async function copyOutput(id: string): Promise<string> {
    record('copyOutput', id)
    assertAgent(id)
    const csid = currentSession.get(id)
    return (outputs.get(csid ?? '') ?? []).map((e) => e.text).join('\n')
  }
  async function exportSession(id: string, sessionId: string, format: 'md' | 'json'): Promise<{ filename: string; content: string }> {
    record('exportSession', id, sessionId, format)
    assertAgent(id)
    const meta = sessions.get(id)?.find((s) => s.id === sessionId)
    if (!meta) throw new Error(`stub: session ${sessionId} not found`)
    const entries = outputs.get(sessionId) ?? []
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')
    const safeTitle = meta.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    const filename = `${id}-${safeTitle}-${stamp}.${format}`
    const content = format === 'json'
      ? JSON.stringify({ agentId: id, session: meta, entries, exportedBy: 'stub' }, null, 2)
      : [
          `# ${meta.title}`,
          '',
          `- Agent: ${id}`,
          `- 导出时间: ${new Date().toISOString()}`,
          `- 条目数: ${entries.length}`,
          '',
          '## 输出',
          '',
          ...entries.map((e) => `- [${new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false })}] ${e.kind}: ${e.text}`),
          '',
        ].join('\n')
    return { filename, content }
  }
  async function sendInput(id: string, text: string): Promise<void> {
    record('sendInput', id, text)
    assertAgent(id)
    const csid = currentSession.get(id)
    if (!csid) throw new Error('stub: no current session')
    pushEntry(id, { id: nextId('e'), sessionId: csid, ts: Date.now(), kind: 'user', text })
    await sleep(sendDelay)
    const agent = seed(id)
    pushEntry(id, {
      id: nextId('e'), sessionId: csid, ts: Date.now(), kind: 'agent',
      text: `收到：「${String(text).slice(0, 40)}」——${agent.name}（stub 演示响应）`,
    })
    // 打字机行：空 streaming 条目起头，按 id 原位增长
    const streamId = nextId('e')
    const full = `${agent.name}（stub）：这是一条分片推送的模拟回复，用来验证输出区的流式渲染；真实回复将在接线轮由 Agent 本体产生。`
    pushEntry(id, { id: streamId, sessionId: csid, ts: Date.now(), kind: 'agent', text: '', streaming: true })
    const chunks = 4
    for (let i = 1; i <= chunks; i++) {
      await sleep(Math.max(20, Math.round(sendDelay / 2)))
      updateEntry(id, {
        id: streamId, sessionId: csid, ts: Date.now(), kind: 'agent',
        text: full.slice(0, Math.ceil((full.length * i) / chunks)),
        streaming: i < chunks,
      })
    }
    pushEntry(id, { id: nextId('e'), sessionId: csid, ts: Date.now(), kind: 'system', text: '（stub 输出仅演示，不涉及真实进程）' })
  }

  // ---- 辅助 -----------------------------------------------------------------
  async function openLogs(id: string): Promise<void> {
    record('openLogs', id)
  }
  async function pinAgent(id: string, pin: boolean): Promise<void> {
    record('pinAgent', id, pin)
    assertAgent(id)
    if (pin) pinned.add(id)
    else pinned.delete(id)
  }

  // ---- 模型切换（13.16）------------------------------------------------------
  async function listModels(id: string): Promise<string[]> {
    record('listModels', id)
    assertAgent(id)
    return [...(STUB_MODELS[id] ?? [])]
  }
  async function getModel(id: string): Promise<string> {
    record('getModel', id)
    assertAgent(id)
    return currentModel.get(id) ?? STUB_MODELS[id]?.[0] ?? 'stub-model'
  }
  async function setModel(id: string, model: string): Promise<void> {
    record('setModel', id, model)
    assertAgent(id)
    if (!STUB_MODELS[id]?.includes(model)) throw new Error(`stub: unknown model ${model} for ${id}`)
    currentModel.set(id, model)
  }
  function onStatusChange(cb: StatusChangeHandler): () => void {
    statusCbs.add(cb)
    return () => statusCbs.delete(cb)
  }
  function onOutput(cb: OutputHandler): () => void {
    outputCbs.add(cb)
    return () => outputCbs.delete(cb)
  }

  async function listAgents(): Promise<AgentSummary[]> {
    record('listAgents')
    const list = AGENT_SEEDS.map((a) => ({
      id: a.id, name: a.name, short: a.short,
      status: status.get(a.id) ?? 'STOPPED',
      pinned: pinned.has(a.id),
      baseUrl: a.baseUrl, version: a.version,
    }))
    // 置顶优先，组内保持原顺序（排序须稳定）
    return list.filter((a) => a.pinned).concat(list.filter((a) => !a.pinned))
  }
  async function getAgentStatus(id: string): Promise<AgentStatus> {
    record('getAgentStatus', id)
    assertAgent(id)
    return status.get(id) ?? 'STOPPED'
  }

  return {
    listAgents, getAgentStatus, startAgent, stopAgent, restartAgent,
    newSession, listSessions, switchSession, renameSession, deleteSession, pinSession,
    getOutput, clearOutput, undoClearOutput, copyOutput, exportSession, sendInput,
    openLogs, pinAgent, listModels, getModel, setModel,
    onStatusChange, onOutput,
    __calls: calls,
  }
}
