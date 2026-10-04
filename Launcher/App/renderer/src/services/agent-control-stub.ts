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
 * 13.17 追加：任务/队列/文件/通知 演示种子 + 确定性推荐映射 + 转交登记（目标≠来源）
 * + 可中断生成（genSeq 代数戳）。全部仍为内存态，不触碰任何真实数据源。
 *
 * 本文件零运行时依赖（仅 import type），Node strip-types 可直接加载（根 tests/ 单测）。
 */
import type {
  AgentControlService,
  AgentRecommendation,
  AgentStatus,
  AgentSummary,
  AppNotification,
  ArchivedSession,
  AuxModelBinding,
  CallRecord,
  FileItem,
  MainModelConfig,
  OutputEntry,
  OutputHandler,
  QueueEntry,
  ReasoningLevel,
  SessionMeta,
  SettingsProvider,
  SettingsSectionId,
  StatusChangeHandler,
  TaskItem,
  TransferPayload,
  TransferResult,
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
  /** 一句话定位（切换菜单描述行，13.17） */
  desc: string
}

/** 演示名单：id 与 agents.json 一致（下一轮接线直接对上真实清单） */
const AGENT_SEEDS: AgentSeed[] = [
  { id: 'openclaw', name: 'OpenClaw', short: 'O', baseUrl: 'https://demo.local/v1（stub）', version: 'stub 1.0', desc: '通用任务执行与文件整理' },
  { id: 'hermes', name: 'Hermes', short: 'H', baseUrl: 'https://demo.local/v1（stub）', version: 'stub 1.0', desc: '资料分析 · 长文本处理' },
  { id: 'codex', name: 'Codex', short: 'C', baseUrl: 'https://demo.local/v1（stub）', version: 'stub 1.0', desc: '程序计算 · 代码验证' },
  { id: 'claude-code', name: 'Claude Code', short: 'CC', baseUrl: 'https://demo.local/v1（stub）', version: 'stub 1.0', desc: '代码工程与实现' },
]

const SEED_SESSION_TITLES = ['初始化体检', '日志走查', '示例任务']

/** 每 Agent 演示模型清单（13.16 模型切换器；stub 内存值，接线轮来自 provider 缓存） */
const STUB_MODELS: Record<string, string[]> = {
  openclaw: ['qwen 3.8 27B', 'glm-5.3', 'deepseek-v4'],
  hermes: ['hermes-4-405b', 'llama-4-maverick', 'qwen 3.8 27B'],
  codex: ['gpt-5.2-codex', 'o4-mini', 'claude-sonnet-4'],
  'claude-code': ['claude-sonnet-4.5', 'claude-opus-4.1', 'claude-haiku-4'],
}

/**
 * 下一步推荐的确定性映射（13.17 任务书 §二十三：当前阶段 Mock 推荐数据）。
 * 推荐只是推荐——UI 允许用户转交给任意其他 Agent。
 */
const STUB_RECOMMENDATIONS: Record<string, { agentId: string; reason: string; confidence: number }> = {
  openclaw: { agentId: 'hermes', reason: '当前任务涉及资料整理与长文本，Hermes 更适合继续处理', confidence: 0.88 },
  hermes: { agentId: 'codex', reason: '当前任务涉及程序计算，Codex 更适合继续处理', confidence: 0.91 },
  codex: { agentId: 'claude-code', reason: '进入工程实现阶段，Claude Code 擅长代码工程', confidence: 0.86 },
  'claude-code': { agentId: 'openclaw', reason: '后续落地执行可交回 OpenClaw 形成闭环', confidence: 0.83 },
}

// ---- 13.18 设置中心种子（全部内存态；模型名复用 STUB_MODELS 已有名，单一数据源）----
const SETTINGS_SECTIONS: SettingsSectionId[] = [
  'models', 'chat', 'appearance', 'workspace', 'security', 'browser', 'memory',
  'voice', 'advanced', 'notifications', 'billing', 'providers', 'gateway',
  'hotkeys', 'keys', 'plugins', 'archived', 'about',
]

/** 提供方清单：模型名全部来自 13.17 的 STUB_MODELS（接线轮统一来自 provider 缓存） */
const SETTINGS_PROVIDERS: SettingsProvider[] = [
  { id: 'sensenova', name: 'SenseNova（stub）', models: ['glm-5.3', 'deepseek-v4', 'qwen 3.8 27B'] },
  { id: 'siliconflow', name: 'SiliconFlow（stub）', models: ['hermes-4-405b', 'llama-4-maverick'] },
  { id: 'openai', name: 'OpenAI（stub）', models: ['gpt-5.2-codex', 'o4-mini'] },
  { id: 'anthropic', name: 'Anthropic（stub）', models: ['claude-sonnet-4.5', 'claude-opus-4.1', 'claude-haiku-4'] },
]

const REASONING_LEVELS: ReasoningLevel[] = ['low', 'medium', 'high']

const AUX_SEEDS: Array<{ taskId: string; label: string; hint: string }> = [
  { taskId: 'vision', label: '视觉', hint: '图片分析' },
  { taskId: 'compaction', label: '压缩', hint: '上下文压缩' },
  { taskId: 'skills', label: '技能中心', hint: '技能搜索' },
  { taskId: 'approvals', label: '审批', hint: '智能自动批准' },
  { taskId: 'mcp', label: 'MCP', hint: 'MCP 工具路由' },
  { taskId: 'title-gen', label: '标题生成', hint: '会话标题' },
  { taskId: 'review', label: '评审', hint: '/review 评审子智能体' },
  { taskId: 'maintainer', label: '维护器', hint: '技能使用审查' },
]

export function createStubAgentControlService(opts: StubOptions = {}): AgentControlService & { __calls: CallRecord[] } {
  const startDelay = opts.startDelayMs ?? 800
  const stopDelay = opts.stopDelayMs ?? 500
  const restartGap = opts.restartGapMs ?? 300
  const sendDelay = opts.sendDelayMs ?? 300
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  /** 可中断 sleep：gen 过期立即返回 false（stopGeneration 的中断机制） */
  async function sleepGen(ms: number, gen: number): Promise<boolean> {
    let waited = 0
    while (waited < ms) {
      if (gen !== genSeq) return false
      const step = Math.min(20, ms - waited)
      await sleep(step)
      waited += step
    }
    return gen === genSeq
  }

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

  // ---- 13.17 任务/队列/文件/通知 演示种子（stub 内存数据，接线轮替换为真实来源）----
  const seedNow = Date.now()
  const tasks: TaskItem[] = [
    { id: 'task-seed-1', name: '毕业设计资料分析', agentId: 'hermes', status: 'done', createdAt: seedNow - 26 * 3600_000, sessionId: 'seed-hermes-1' },
    { id: 'task-seed-2', name: 'Python 数据处理', agentId: 'codex', status: 'running', createdAt: seedNow - 5 * 3600_000 },
    { id: 'task-seed-3', name: '文件整理', agentId: 'openclaw', status: 'pending', createdAt: seedNow - 2 * 3600_000 },
    { id: 'task-seed-4', name: 'C 语言课程作业', agentId: 'claude-code', status: 'failed', createdAt: seedNow - 30 * 3600_000 },
  ]
  const queue: QueueEntry[] = [
    { id: 'q-seed-1', taskId: 'task-seed-3', taskName: '文件整理', agentId: 'openclaw', position: 1, enqueuedAt: seedNow - 2 * 3600_000 },
  ]
  const files: FileItem[] = [
    { id: 'file-seed-1', name: '资料汇总.pdf', ext: 'pdf', sizeBytes: 2_516_582, sourceAgentId: 'hermes', taskName: '毕业设计资料分析', createdAt: seedNow - 26 * 3600_000 },
    { id: 'file-seed-2', name: '计算脚本.py', ext: 'py', sizeBytes: 12_288, sourceAgentId: 'codex', taskName: 'Python 数据处理', createdAt: seedNow - 5 * 3600_000 },
    { id: 'file-seed-3', name: '结果表.xlsx', ext: 'xlsx', sizeBytes: 90_112, sourceAgentId: 'codex', taskName: 'Python 数据处理', createdAt: seedNow - 4 * 3600_000 },
  ]
  let notifications: AppNotification[] = [
    { id: 'n-seed-1', kind: 'system', title: '通知中心已就绪', detail: 'stub 演示数据；任务完成/转交/文件等真实事件在接线轮接入', ts: seedNow - 10 * 60_000 },
    { id: 'n-seed-2', kind: 'update', title: '检查更新', detail: 'v1.0.0 已是最新（stub 演示，未联网检查）', ts: seedNow - 60 * 60_000 },
  ]
  let taskSeq = 0
  /** 生成代数：stopGeneration 自增使进行中的 sendInput 中途退出（stub 单生成流假设） */
  let genSeq = 0

  // ---- 13.18 设置中心内存态（不落盘、不写 providers.json）----
  let mainModelConfig: MainModelConfig = { providerId: 'sensenova', model: 'glm-5.3', reasoningLevel: 'high' }
  let auxBindings: AuxModelBinding[] = AUX_SEEDS.map((s) => ({ ...s, boundModel: null }))
  const archived: ArchivedSession[] = [
    { id: 'arch-seed-1', agentId: 'openclaw', title: '旧版依赖排查', archivedAt: seedNow - 3 * 86_400_000 },
    { id: 'arch-seed-2', agentId: 'hermes', title: '市场竞品速览', archivedAt: seedNow - 7 * 86_400_000 },
    { id: 'arch-seed-3', agentId: 'codex', title: '脚本重构草案', archivedAt: seedNow - 14 * 86_400_000 },
  ]

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
    const gen = ++genSeq
    pushEntry(id, { id: nextId('e'), sessionId: csid, ts: Date.now(), kind: 'user', text })
    if (!(await sleepGen(sendDelay, gen))) return
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
    let lastText = ''
    for (let i = 1; i <= chunks; i++) {
      if (!(await sleepGen(Math.max(20, Math.round(sendDelay / 2)), gen))) {
        // 被 stopGeneration 打断：当前条目落定并标注，不再推送后续分片
        updateEntry(id, {
          id: streamId, sessionId: csid, ts: Date.now(), kind: 'agent',
          text: lastText ? `${lastText}\n（已停止生成（stub））` : '（已停止生成（stub））',
          streaming: false,
        })
        return
      }
      lastText = full.slice(0, Math.ceil((full.length * i) / chunks))
      updateEntry(id, {
        id: streamId, sessionId: csid, ts: Date.now(), kind: 'agent',
        text: lastText,
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

  // ---- 13.17 任务/队列/文件/转交/推荐/通知/停止 ------------------------------
  async function listTasks(): Promise<TaskItem[]> {
    record('listTasks')
    return [...tasks]
  }
  async function listQueue(): Promise<QueueEntry[]> {
    record('listQueue')
    return [...queue]
  }
  async function listFiles(): Promise<FileItem[]> {
    record('listFiles')
    return [...files]
  }
  async function getRecommendation(sourceAgentId: string): Promise<AgentRecommendation | null> {
    record('getRecommendation', sourceAgentId)
    assertAgent(sourceAgentId)
    const rec = STUB_RECOMMENDATIONS[sourceAgentId]
    return rec ? { ...rec } : null
  }
  async function transferTask(payload: TransferPayload): Promise<TransferResult> {
    record('transferTask', payload)
    assertAgent(payload.sourceAgentId)
    assertAgent(payload.targetAgentId)
    // 任务书 §二十一：禁止转交给自己（UI 层已禁用，服务层兜底校验）
    if (payload.targetAgentId === payload.sourceAgentId) {
      throw new Error('stub: cannot transfer to self')
    }
    await sleep(600)
    const source = seed(payload.sourceAgentId)
    const target = seed(payload.targetAgentId)
    const name = `来自 ${source.name} 的转交任务`
    const taskId = `task-xfer-${++taskSeq}`
    tasks.unshift({ id: taskId, name, agentId: payload.targetAgentId, status: 'transferred', createdAt: Date.now() })
    queue.unshift({ id: `q-${taskId}`, taskId, taskName: name, agentId: payload.targetAgentId, position: 1, enqueuedAt: Date.now() })
    queue.forEach((q, i) => { q.position = i + 1 })
    notifications = [
      { id: nextId('n'), kind: 'transfer', title: `已转交给 ${target.name}`, detail: `${name}（stub 演示，未发送真实内容）`, ts: Date.now() },
      ...notifications,
    ]
    return {
      ok: true,
      taskId,
      queued: true,
      message: `已转交给 ${target.name}，进入其等待队列（stub 演示，未发送真实内容）`,
    }
  }
  async function listNotifications(): Promise<AppNotification[]> {
    record('listNotifications')
    return [...notifications]
  }
  async function stopGeneration(id: string): Promise<void> {
    record('stopGeneration', id)
    assertAgent(id)
    // 自增代数即可：进行中的 sendInput 在下一个轮询片发现 gen 过期，自行落定
    genSeq++
  }

  // ---- 13.18 设置中心 --------------------------------------------------------
  async function listSettingsSections(): Promise<SettingsSectionId[]> {
    record('listSettingsSections')
    return [...SETTINGS_SECTIONS]
  }
  async function listSettingsProviders(): Promise<SettingsProvider[]> {
    record('listSettingsProviders')
    return SETTINGS_PROVIDERS.map((p) => ({ ...p, models: [...p.models] }))
  }
  async function getMainModelConfig(): Promise<MainModelConfig> {
    record('getMainModelConfig')
    return { ...mainModelConfig }
  }
  async function setMainModelConfig(cfg: MainModelConfig): Promise<void> {
    record('setMainModelConfig', cfg)
    const provider = SETTINGS_PROVIDERS.find((p) => p.id === cfg.providerId)
    if (!provider) throw new Error(`stub: unknown provider ${cfg.providerId}`)
    if (!provider.models.includes(cfg.model)) throw new Error(`stub: model ${cfg.model} not in provider ${cfg.providerId}`)
    if (!REASONING_LEVELS.includes(cfg.reasoningLevel)) throw new Error(`stub: unknown reasoning level ${cfg.reasoningLevel}`)
    // 只写设置层内存态——绝不触碰对话级 currentModel（双层隔离，单测钉死）
    mainModelConfig = { ...cfg }
  }
  async function listAuxModels(): Promise<AuxModelBinding[]> {
    record('listAuxModels')
    return auxBindings.map((b) => ({ ...b }))
  }
  async function setAuxModel(taskId: string, model: string | null): Promise<void> {
    record('setAuxModel', taskId, model)
    const binding = auxBindings.find((b) => b.taskId === taskId)
    if (!binding) throw new Error(`stub: unknown aux task ${taskId}`)
    if (model !== null) {
      // 「与主模型同源」：取值域 = 当前主提供方的模型清单
      const provider = SETTINGS_PROVIDERS.find((p) => p.id === mainModelConfig.providerId)
      if (!provider?.models.includes(model)) throw new Error(`stub: model ${model} not offered by provider ${mainModelConfig.providerId}`)
    }
    binding.boundModel = model
  }
  async function resetAllAuxModels(): Promise<void> {
    record('resetAllAuxModels')
    for (const b of auxBindings) b.boundModel = null
  }
  async function listArchivedSessions(): Promise<ArchivedSession[]> {
    record('listArchivedSessions')
    return [...archived]
  }
  async function restoreArchivedSession(id: string): Promise<void> {
    record('restoreArchivedSession', id)
    const i = archived.findIndex((s) => s.id === id)
    if (i < 0) throw new Error(`stub: archived session ${id} not found`)
    archived.splice(i, 1)
  }
  async function deleteArchivedSessionForever(id: string): Promise<void> {
    record('deleteArchivedSessionForever', id)
    const i = archived.findIndex((s) => s.id === id)
    if (i < 0) throw new Error(`stub: archived session ${id} not found`)
    archived.splice(i, 1)
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
      desc: a.desc,
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
    listTasks, listQueue, listFiles,
    getRecommendation, transferTask, listNotifications, stopGeneration,
    listSettingsSections, listSettingsProviders, getMainModelConfig, setMainModelConfig,
    listAuxModels, setAuxModel, resetAllAuxModels,
    listArchivedSessions, restoreArchivedSession, deleteArchivedSessionForever,
    onStatusChange, onOutput,
    __calls: calls,
  }
}
