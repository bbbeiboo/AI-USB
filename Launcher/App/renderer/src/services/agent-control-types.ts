/**
 * Agent 控制服务类型定义（UI v2 · stub 优先）。
 * ---------------------------------------------------------------------------
 * 类型风格对齐 types/launcher.d.ts 的 UsageDashboardResult 一脉：
 * 全部 Promise 返回、字段可注释溯源、绝不让 UI 拿到歧义形状。
 * 本文件只放类型（零运行时代码），可被 Node strip-types 的单测安全引用。
 */
import type { AgentCapabilities, AgentSettingsField } from './agent-capability-types.ts'
export type { AgentCapabilities, AgentSettingsField } from './agent-capability-types.ts'

/** Agent 运行状态（与 pm 层五态同名；stub 状态机使用同一取值域） */
export type AgentStatus = 'RUNNING' | 'STOPPED' | 'STARTING' | 'STOPPING' | 'ERROR'

/** 列表/侧栏条目用摘要 */
export interface AgentSummary {
  id: string
  name: string
  /** 头像字母：openclaw→O、hermes→H、codex→C、claude-code→CC */
  short: string
  status: AgentStatus
  pinned: boolean
  /** 状态栏摘要；stub 为演示值，下一轮接线后来自 manifest / user-config */
  baseUrl: string
  version: string
  /** 一句话定位（13.17：切换菜单要求 Logo+名称+简短描述+选中状态）；stub 为演示文案 */
  desc?: string
}

export interface SessionMeta {
  id: string
  agentId: string
  title: string
  createdAt: number
  updatedAt: number
  /** 会话级置顶（13.16 对标 Cherry Studio/LobeChat：置顶会话排在列表最前） */
  pinned: boolean
  /**
   * 13.22：Agent 原生会话 ID（真源键）。stub 会话无此字段；
   * 真实会话（hermes）必填且 = Agent 原生 ID，绝不以聚合器 id 冒充。
   */
  nativeSessionId?: string
  /** 13.22：索引指向的原生会话已不存在（同步时检测，不自动制造假会话） */
  orphaned?: boolean
}

export type OutputKind = 'user' | 'agent' | 'system'

export interface OutputEntry {
  id: string
  sessionId: string
  ts: number
  kind: OutputKind
  text: string
  /**
   * 流式条目：同一 id 的 text 会被后续 onOutput 分片更新（打字机效果）。
   * UI 侧按 id upsert（存在则替换文本，不存在则追加）。
   */
  streaming?: boolean
}

export interface ExportedSession {
  filename: string
  content: string
}

// —— 任务 / 队列 / 文件（13.17 任务书 §三十四 类型清单）———————————————————
/** 任务状态五态（任务书 §二十四）；中文标签由 UI 层映射 */
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'transferred'

export interface TaskItem {
  id: string
  name: string
  agentId: string
  status: TaskStatus
  createdAt: number
  /** 关联会话（可选；用于「打开会话」跳转） */
  sessionId?: string
}

export interface QueueEntry {
  id: string
  taskId: string
  taskName: string
  /** 目标 Agent（任务书 §二十五：目标忙 → 入队 → 空闲自动执行） */
  agentId: string
  position: number
  enqueuedAt: number
}

export interface FileItem {
  id: string
  name: string
  /** 扩展名（不含点），如 pdf / py / xlsx */
  ext: string
  sizeBytes: number
  sourceAgentId: string
  taskName: string
  createdAt: number
}

// —— 转交 / 推荐（任务书 §二十二/§二十三 的结构定死）————————————————————
export interface TransferPayload {
  sourceAgentId: string
  targetAgentId: string
  conversationId?: string
  taskId?: string
  fileIds?: string[]
  includeConversation: boolean
  includeFiles: boolean
  includeTask: boolean
}

export interface TransferResult {
  ok: boolean
  taskId?: string
  /** true = 目标 Agent 忙，已进入等待队列（stub 一律入队演示） */
  queued: boolean
  /** 展示用消息（stub 文案显式带 stub 标识） */
  message: string
}

export interface AgentRecommendation {
  agentId: string
  reason: string
  confidence?: number
}

// —— 通知中心（任务书 §七：任务完成/转交/文件/队列/更新/系统）————————————————
export type NotificationKind = 'task' | 'transfer' | 'file' | 'queue' | 'update' | 'system'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  detail?: string
  ts: number
}

// —— 设置中心（13.18 任务书 §四：先 stub 后接线，全部内存态）——————————————————
/** 18 项导航 id（顺序固定，任务书 §二；UI 导航与搜索都以此为唯一清单） */
export type SettingsSectionId =
  | 'models' | 'chat' | 'appearance' | 'workspace' | 'security' | 'browser' | 'memory'
  | 'voice' | 'advanced' | 'notifications' | 'billing' | 'providers' | 'gateway'
  | 'hotkeys' | 'keys' | 'plugins' | 'archived' | 'about'

/** 推理力度（「默认值 推理」下拉） */
export type ReasoningLevel = 'low' | 'medium' | 'high'

/**
 * 主模型配置（应用于新会话）。与输入框内模型切换器是两层：
 * 对话级临时切换走 setModel/getModel（13.16），这里只存「新会话默认值」，
 * 二者互不影响（任务书 §3.1.4 双层隔离，有单测钉死）。
 */
export interface MainModelConfig {
  providerId: string
  model: string
  reasoningLevel: ReasoningLevel
}

/** 提供方 + 该方模型清单（stub 复用 13.17 已有模型名，避免出现第二套名字） */
export interface SettingsProvider {
  id: string
  name: string
  models: string[]
}

/** 辅助模型绑定：boundModel = null 表示「自动 · 使用主模型」 */
export interface AuxModelBinding {
  taskId: string
  label: string
  hint: string
  boundModel: string | null
}

/** 已归档对话（stub 演示数据；真实归档来源在接线轮确认） */
export interface ArchivedSession {
  id: string
  agentId: string
  title: string
  archivedAt: number
}

// —— 13.20 统一能力层（任务书 §五：统一 Agent Interface）———————————————————
/**
 * Agent 官方身份档案（getInfo）。版本为项目锁定版本，与 AGENT-SOURCES.md 一致；
 * stub 为静态记录（不联网探测），真实探测在接线轮经 manifest:get + agents:probe 落地。
 */
export interface AgentInfo {
  id: string
  name: string
  /** 项目锁定版本（openclaw 2026.9.5 / hermes 0.21.4 / codex 0.156.1 / claude-code 2.1.288） */
  version: string
  repoUrl: string
  docsUrl: string
  /** 本地入口（命令或可执行文件） */
  localEntry: string
  /** 原生配置入口（config 文件） */
  configEntrance: string
  /** 版本差距说明（官方最新 vs 锁定版，静态记录） */
  versionNote: string
}

/** 更新检查结果（stub 不联网：latestVersion=null、upToDate=null，message 显式带 stub） */
export interface UpdateStatus {
  agentId: string
  currentVersion: string
  latestVersion: string | null
  upToDate: boolean | null
  message: string
}

/** Provider 连通性测试（stub 不接真实 API：ok=false + 显式说明，绝不伪造成功） */
export interface ProviderTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}

/** 凭据查询结果——只含配置状态与掩码，永远不含明文（密钥零接触） */
export interface CredentialStatus {
  ref: string
  configured: boolean
  /** 形如 '••••••••'；未配置时为空串 */
  maskedValue: string
}

/** 凭据连通性测试结果（stub 只报「未真实校验」，不伪造成功） */
export interface CredentialTestResult {
  ok: boolean
  message: string
}

/**
 * 凭据服务（13.20 任务书 §十：Secret 与普通设置严格隔离）。
 * API Key / OAuth Token / SSH 私钥 / MCP Secret 一律不进普通 settings JSON：
 * UI 只拿 configured + maskedValue；完整明文只进系统安全存储（真接线轮落地）。
 */
export interface CredentialService {
  hasCredential(ref: string): Promise<boolean>
  /** 只返回 configured + maskedValue；任何实现都不得返回明文 */
  getCredential(ref: string): Promise<CredentialStatus>
  /** 写入凭据（stub 仅内存态；真实实现走系统安全存储） */
  setCredential(ref: string, value: string): Promise<void>
  deleteCredential(ref: string): Promise<void>
  testCredential(ref: string): Promise<CredentialTestResult>
}

/** 设置导入导出（与 exportSession 同形：内容字符串由 UI 决定落盘方式） */
export interface ExportedSettings {
  filename: string
  /** JSON 字符串；仅含非 Secret 字段（secret=true 的项导出时剔除） */
  content: string
}

// —— 13.22 统一会话层（架构裁决：Agent 原生会话数据 = Source of Truth）—————————
/**
 * 架构裁决（13.22 §一/§二）：聚合器不重新实现 Agent 的会话存储——四个 Agent 各自
 * 保留原生 Session/Message/Context/Memory；聚合器只经官方接口（API→SDK→IPC→CLI→文件
 * 的优先级）统一读取/展示/发送/停止/切换/转交，并维护一份**索引**（Session Index）：
 * 只存映射与 UI 元数据，绝不复制完整消息历史作为第二真源。
 */

/** 会话状态（generating/stopping 由聚合器运行时推导；orphaned=索引指向的原生会话已不存在） */
export type AgentSessionStatus = 'active' | 'idle' | 'generating' | 'archived' | 'orphaned' | 'unknown'

/**
 * 统一会话对象。核心原则（任务书 §四）：
 *   nativeSessionId = Agent 原生会话 ID（真源键），不得用聚合器 UUID 代替；
 *   aggregatorId 仅为聚合器内部可选 ID；索引键 = agentId + '/' + nativeSessionId。
 */
export interface AgentSession {
  agentId: string
  aggregatorId?: string
  nativeSessionId: string
  title?: string
  status: AgentSessionStatus
  createdAt?: string
  updatedAt?: string
  // —— 聚合器索引元数据（只存这些，不存消息历史）——
  pinned?: boolean
  /** 最近一条消息预览（截断；仅索引缓存，真源在 Agent 侧） */
  lastMessagePreview?: string
}

/**
 * 统一 Agent 事件流（任务书 §九）。实际事件以各 Agent 原生事件能力为准——
 * Adapter 只翻译存在的事件，不得伪造不存在的类型（如 Hermes 无的事件不得制造）。
 */
export type AgentEvent =
  | { type: 'message_start' }
  | { type: 'text_delta'; text: string }
  /**
   * 13.23 增补（additive）：累积替换式文本（OpenClaw chat delta 帧固定 replace:true，
   * deltaText=累计全量）。渲染层把流式条目整段替换，不与 text_delta 拼接。
   */
  | { type: 'text_replace'; text: string }
  | { type: 'tool_start'; name: string; input?: unknown }
  | { type: 'tool_result'; name: string; summary?: string }
  | { type: 'thinking'; text: string }
  /** 13.23 增补（additive）：思考文本前缀断裂（OpenClaw reasoning 投影替换）时的整段替换 */
  | { type: 'thinking_replace'; text: string }
  | { type: 'file'; path: string; action: string }
  | { type: 'error'; message: string; code?: string }
  | { type: 'message_end'; stopReason?: string }
  /** 会话元信息更新（Hermes session_info_update：自动标题生成后推送） */
  | { type: 'session_info'; title: string }
  /** 历史重放中的用户消息（Hermes session/load 重放 user_message_chunk；仅回放产生） */
  | { type: 'user_message'; text: string }

/** 统一错误（任务书 §十四：真实失败必须原样传递，禁止失败后报「任务完成」） */
export interface AgentError extends Error {
  /** offline | provider-auth | session-not-found | permission | timeout | busy | unsupported | protocol */
  code: 'offline' | 'provider-auth' | 'session-not-found' | 'permission' | 'timeout' | 'busy' | 'unsupported' | 'protocol'
  agentId?: string
}

/**
 * 统一会话 Adapter（任务书 §三：接口按四 Agent 官方能力调整后一次定死）。
 * 每个 Agent 一个实现；官方接口缺失的操作实现必须 throw AgentError(code='unsupported')，
 * 不得伪造成功。Hermes 官方通道 = ACP stdio（hermes-acp.exe，session/list、session/new、
 * session/load、session/prompt、session/cancel 已实测）。
 */
export interface AgentSessionAdapter {
  /** 列出原生会话（含标题/时间戳；聚合器索引据此同步） */
  listSessions(): Promise<AgentSession[]>
  /** 新建原生会话（cwd=工作目录；返回含 nativeSessionId） */
  createSession(input?: { cwd?: string; title?: string }): Promise<AgentSession>
  /** 读取单个原生会话元数据（不复制消息历史） */
  getSession(nativeSessionId: string): Promise<AgentSession>
  /**
   * 加载既有会话为可继续状态（官方 loadSession；不支持则 unsupported）。
   * Hermes 官方语义：加载时经原生事件重放全部历史 → 返回 history 供渲染层重建
   * MessageList（重启后历史显示走官方重放，不解析 Agent 私有存储）。
   */
  loadSession(nativeSessionId: string): Promise<AgentSession & { history?: AgentEvent[] }>
  /** 发送并等整回合结束（返回最终文本；等价于排空 streamMessage） */
  sendMessage(nativeSessionId: string, text: string): Promise<string>
  /** 流式发送：逐事件产出（message_start / text_delta / tool 系列 / error / message_end） */
  streamMessage(nativeSessionId: string, text: string): AsyncIterable<AgentEvent>
  /** 中止当前回合（官方 cancel） */
  stopGeneration(nativeSessionId: string): Promise<void>
  renameSession(nativeSessionId: string, title: string): Promise<void>
  /** 归档为聚合器索引语义（aggregatorArchiveState），不动原生数据 */
  archiveSession(nativeSessionId: string): Promise<void>
  /** 删除原生会话（走官方途径；仅当官方提供时实现，否则 unsupported） */
  deleteSession(nativeSessionId: string): Promise<void>
}

export type StatusChangeHandler = (id: string, status: AgentStatus) => void
export type OutputHandler = (id: string, entry: OutputEntry) => void

/** __calls 的记录形状（仅 stub 提供，验收用） */
export interface CallRecord {
  method: string
  args: unknown[]
  ts: number
}

/**
 * Agent 控制服务全按钮集接口（阶段 2 先定接口再做 UI）。
 * 订阅方法返回真正的退订函数（优于 preload.js 现状的不可退订设计）。
 */
export interface AgentControlService {
  // —— 进程生命周期 ——
  listAgents(): Promise<AgentSummary[]>
  getAgentStatus(id: string): Promise<AgentStatus>
  startAgent(id: string): Promise<AgentStatus>
  stopAgent(id: string): Promise<AgentStatus>
  /** = stop → 间隔 → start（stub 串联两者，全程发事件） */
  restartAgent(id: string): Promise<AgentStatus>

  // —— 会话/输出 ——
  newSession(id: string): Promise<SessionMeta>
  listSessions(id: string): Promise<SessionMeta[]>
  switchSession(id: string, sessionId: string): Promise<SessionMeta>
  /**
   * 会话重命名（13.16 对标 Cherry Studio/LobeChat 会话右键菜单）。
   * 相对任务书接口的补充 #2：行内重命名需要服务层落地标题。
   */
  renameSession(id: string, sessionId: string, title: string): Promise<SessionMeta>
  /** 删除会话（13.16）。删除当前会话后 UI 自行切到剩余第一条。 */
  deleteSession(id: string, sessionId: string): Promise<void>
  /** 会话级置顶（13.16）；listSessions 置顶优先返回。 */
  pinSession(id: string, sessionId: string, pinned: boolean): Promise<void>
  /** 当前会话的输出（stub 内置演示输出流） */
  getOutput(id: string): Promise<OutputEntry[]>
  clearOutput(id: string): Promise<void>
  /**
   * 撤销上一次 clearOutput（5s 撤销窗口由 UI 层计时）。
   * 相对任务书接口的唯一补充：清空输出按钮的「可撤销提示」需要恢复入口，
   * 真接线轮可映射为重新拉取或直接 throw not-wired-yet。
   */
  undoClearOutput(id: string): Promise<OutputEntry[] | null>
  /** 返回可复制文本，剪贴板写入由 UI 负责 */
  copyOutput(id: string): Promise<string>
  /** 生成真实格式的字符串；落盘（下载/剪贴板）由 UI 层触发 */
  exportSession(id: string, sessionId: string, format: 'md' | 'json'): Promise<ExportedSession>
  /** stub：回显 + 模拟响应（经 onOutput 推送，含流式分片） */
  sendInput(id: string, text: string): Promise<void>

  // —— 辅助 ——
  openLogs(id: string): Promise<void>
  /** 置顶偏好（stub 为内存态） */
  pinAgent(id: string, pinned: boolean): Promise<void>

  // —— 模型切换（13.16 对标 Chatbox/Cherry Studio 快速切换模型）———————
  /** 当前 Agent 可选模型清单（stub 为演示清单；接线轮来自 provider 缓存） */
  listModels(id: string): Promise<string[]>
  getModel(id: string): Promise<string>
  /** 切换模型并持久化到服务层状态（stub 内存态） */
  setModel(id: string, model: string): Promise<void>

  // —— 任务 / 队列 / 文件（13.17 任务书 §二十四~§二十六，先 UI 后真实 Agent）———
  /** 任务列表（stub 为演示种子 + 转交产生的任务；接线轮映射 task:list） */
  listTasks(): Promise<TaskItem[]>
  /** 目标 Agent 忙时的等待队列（stub 内存态；接线轮映射 task:queue） */
  listQueue(): Promise<QueueEntry[]>
  /** 文件中心（stub 演示行；接线轮映射 file:list，数据源 = 各 Agent 工作目录） */
  listFiles(): Promise<FileItem[]>

  // —— 转交 / 推荐（13.17 任务书 §十七~§二十三）——————————————————————
  /** 每轮回复后的下一步推荐（stub 为确定性映射；接线轮映射 agent:recommend） */
  getRecommendation(sourceAgentId: string): Promise<AgentRecommendation | null>
  /**
   * 转交任务。stub 校验 目标≠来源（任务书 §二十一），成功后登记为
   * 目标 Agent 队列中的等待任务 + 推一条通知；不向真实 Agent 发送任何内容。
   */
  transferTask(payload: TransferPayload): Promise<TransferResult>

  // —— 通知中心（13.17 任务书 §七，Mock 数据）—————————————————————————
  listNotifications(): Promise<AppNotification[]>

  /** 停止当前生成（输入框 ↑→■；stub 落定流式条目，接线轮映射 agent:input 的 stop） */
  stopGeneration(id: string): Promise<void>

  // —— 设置中心（13.18 任务书 §四；通道映射：settings:get/update、archive:list/restore/delete）——
  /** 18 项导航 id，顺序固定（UI 导航/搜索的唯一清单） */
  listSettingsSections(): Promise<SettingsSectionId[]>
  /** 提供方 + 模型清单（stub 复用 13.17 模型名；接线轮来自 provider 缓存，单一数据源） */
  listSettingsProviders(): Promise<SettingsProvider[]>
  getMainModelConfig(): Promise<MainModelConfig>
  /** 「应用」落点：校验 提供方存在 / 模型属于该方 / 推理枚举；不影响对话级 setModel */
  setMainModelConfig(cfg: MainModelConfig): Promise<void>
  /** 8 行辅助任务绑定（taskId/label/hint 固定，boundModel=null=自动·使用主模型） */
  listAuxModels(): Promise<AuxModelBinding[]>
  /** 指定辅助模型；model=null 重置为「自动 · 使用主模型」。模型取值与主模型下拉同源 */
  setAuxModel(taskId: string, model: string | null): Promise<void>
  /** 「全部重置为主模型」 */
  resetAllAuxModels(): Promise<void>
  listArchivedSessions(): Promise<ArchivedSession[]>
  /** 从归档移除并回到会话列表（stub 仅移除+由 UI toast） */
  restoreArchivedSession(id: string): Promise<void>
  deleteArchivedSessionForever(id: string): Promise<void>

  // —— 统一能力层（13.20 任务书 §五；接口随 Capability Matrix 裁剪，不凑数）———————
  /** 官方身份档案（版本/仓库/文档/本地入口/配置入口；stub 为 AGENT-SOURCES 静态记录） */
  getInfo(id: string): Promise<AgentInfo>
  /** 能力全景（20 组 × 五态；UI 与转交推荐只据此判断，绝不伪造 unsupported 能力） */
  getCapabilities(id: string): Promise<AgentCapabilities>
  /** 会话归档：从会话列表移入归档（13.18 已有恢复/删除，本轮补齐归档入口） */
  archiveSession(id: string, sessionId: string): Promise<void>
  /** 更新检查（stub 不联网：upToDate=null；接线轮映射 update:check） */
  checkUpdate(id: string): Promise<UpdateStatus>
  /** Provider 连通性测试（stub 不发任何真实请求，ok=false + 说明） */
  testProvider(providerId: string): Promise<ProviderTestResult>
  /** 原生设置 Schema（13.20 §七；Hermes 全量映射的 TS 面，其余 Agent 为已知键） */
  getSettingsSchema(agentId: string): Promise<AgentSettingsField[]>
  /** 读取原生设置的内存镜像（stub 不读真实配置文件；真接线轮经 settings:get） */
  getSettings(agentId: string): Promise<Record<string, unknown>>
  /** 写入内存镜像并按 Schema 校验（stub 不落盘；Secret 键拒绝走此通道） */
  setSettings(agentId: string, values: Record<string, unknown>): Promise<void>
  /** 重置为 Schema 默认值（内存镜像层） */
  resetSettings(agentId: string, keys?: string[]): Promise<void>
  /** 导出内存镜像为 JSON（secret=true 的项剔除，明文永不出口） */
  exportSettings(agentId: string): Promise<ExportedSettings>
  /** 导入 JSON 到内存镜像（Schema 校验；返回导入条数） */
  importSettings(agentId: string, json: string): Promise<number>

  onStatusChange(cb: StatusChangeHandler): () => void
  onOutput(cb: OutputHandler): () => void
}
