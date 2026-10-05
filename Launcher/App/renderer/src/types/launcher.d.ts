/**
 * window.launcher 的完整类型声明（对应 Launcher/App/preload.js）。
 * ---------------------------------------------------------------------------
 * preload.js 通过 contextBridge 暴露了 40 个方法；这份声明是渲染层的唯一事实来源，
 * 任何新增/修改 IPC 都必须同步更新这里，否则 services/ 下的封装会失去类型保护。
 *
 * 命名约定：与 preload.js 里的方法名逐字一致（不在这里做语义化改名），
 * 语义化的别名放到 services/agent-client.ts 里。
 */

// --- manifest / probe -------------------------------------------------------

/** Build/Config/agents.json 里的一条 Agent 定义 */
export interface AgentManifestEntry {
  id: string
  name: string
  enabled: boolean
  expectedVersion?: string
  launcher?: string
  checker?: string
  versionArgs?: string[]
  exePath?: string
  exeArgs?: string[]
  isolatedEnv?: Record<string, string>
  workspace?: string
  configPath?: string | null
  configAdapter?: string
  desktopAdapter?: string
  processToken?: string
}

export interface ManifestResult {
  ok: boolean
  launcherVersion?: string
  root?: string
  logPath?: string
  logReadOnly?: boolean
  agents?: AgentManifestEntry[]
  error?: string
}

/** agents:probe 的单条结果；status 为 READY / DISABLED / 其他探测结论 */
export interface AgentProbeEntry {
  id: string
  name: string
  status: string
  version: string
  error: string
}

export interface ProbeAgentsResult {
  ok: boolean
  results?: AgentProbeEntry[]
  error?: string
}

// --- Agent 运行时状态 -------------------------------------------------------

/** agent-process-manager.js 里定义的取值域（不要在这里新增取值） */
export type AgentRuntimeStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'ERROR'

/** pm.getAgentStatus() 的返回；进程已消失时 pid 会被置为 null */
export interface AgentStatusRecord {
  agentId: string
  status: AgentRuntimeStatus
  pid: number | null
  startedAt?: number | null
  error?: string
}

export interface AgentStatusesResult {
  ok: boolean
  statuses?: Record<string, AgentStatusRecord>
  error?: string
}

export interface AgentStatusResult {
  ok: boolean
  status?: AgentStatusRecord
  error?: string
}

/** agent:status 推送事件的载荷（由 agent-process-manager 的 statusHook 发出） */
export interface AgentStatusEvent {
  id: string
  status: AgentRuntimeStatus
  pid: number | null
  startedAt: number | null
}

/** agent:launch / agent:stop / agent:restart 的结果；只声明我们真正会读的字段 */
export interface AgentActionResult {
  ok: boolean
  reason?: string
  error?: string
  pid?: number | null
  agentId?: string
  alreadyRunning?: boolean
}

export interface StartAllResult {
  ok: boolean
  results?: AgentActionResult[]
  error?: string
}

export interface StopAllResult {
  ok: boolean
  error?: string
}

// --- 配置（api-config:* / provider:*） --------------------------------------

/**
 * api-config:get 返回的单条配置。
 * 注意：provider 存的是协议类型（protocolKind，如 openai-compatible），不是预设 id；
 * 密钥只回掩码（如 ••••9b9d），明文永远不出主进程。
 */
export interface ApiConfigEntry {
  configured: boolean
  provider: string
  baseUrl: string
  model: string
  enabled: boolean
  maskedKey: string
}

export interface ApiConfigResult {
  ok: boolean
  agents?: Record<string, ApiConfigEntry>
  error?: string
}

/** api-config:save 的入参；id 必须是 CONFIG_IDS 之一（见 services/agent-client.ts） */
export interface SaveApiConfigPayload {
  id: string
  provider: string
  baseUrl: string
  model: string
  apiKey: string
  enabled: boolean
}

export interface SaveApiConfigResult {
  ok: boolean
  configured?: boolean
  maskedKey?: string
  reason?: string
  errors?: string[]
}

/** api-config:validate 的入参（纯本地校验，不发网络请求） */
export interface ValidateApiConfigFields {
  provider: string
  baseUrl: string
  model: string
  apiKey?: string
}

/** errors 的取值：provider / baseUrl / model / apiKeyTooShort */
export interface ValidateApiConfigResult {
  ok: boolean
  errors?: string[]
  valid?: boolean
  error?: string
}

/** provider:presets 返回的一条预设（authHeader 等内部字段已被主进程过滤掉） */
export interface ProviderPreset {
  label: string
  protocolKind: string
  baseUrl: string
  keyPlaceholder: string
  modelsEndpoint: string
  responsesEndpoint: string
}

export interface ProviderPresetsResult {
  ok: boolean
  presets?: Record<string, ProviderPreset>
  error?: string
}

/**
 * provider:test 的返回。
 * 陷阱：main.js 里写的是 ok: true, id, ...result, message，而 result 自带 ok，
 * 对象展开会把外层的 ok 覆盖掉 —— 所以这里的 ok 表示「连接测试本身是否成功」，
 * 而不是「IPC 是否成功」。
 */
export interface TestConnectionResult {
  ok: boolean
  id?: string
  status?: number
  latencyMs?: number
  /** ok=成功 / http=拿到非 2xx / timeout=10s 超时 / network=网络不可达 / blocked=该协议类型不自动测试 */
  kind?: string
  /** 详细原因（可能是较长的中文句子） */
  reason?: string
  /** 面向用户的中文归因，由后端 statusMessage() 生成 */
  message?: string
}

export interface FetchModelsPayload {
  id?: string
  providerId: string
  baseUrl: string
  apiKey?: string
}

export interface FetchModelsResult {
  ok: boolean
  status?: number
  latencyMs?: number
  models?: string[]
  count?: number
  cached?: boolean
  error?: string
  hint?: string
}

export interface ModelCachePayload {
  providerId: string
  baseUrl: string
}

export interface ModelCacheResult {
  ok: boolean
  models?: string[]
  cached?: boolean
  fetchedAt?: number
  ageMs?: number
  expired?: boolean
  error?: string
}

export interface TestProviderConnectionPayload {
  id?: string
  providerId: string
  baseUrl: string
  model: string
  apiKey?: string
}

export interface TestProviderConnectionResult {
  ok: boolean
  status?: number
  latencyMs?: number
  apiKeySource?: string
  error?: string
  hint?: string
}

// --- 登录层（auth:*，第 2 步） ----------------------------------------------

export interface AuthUser {
  id?: number
  username?: string
  createdAt?: string
}

export interface AuthResult {
  ok: boolean
  user?: AuthUser
  token?: string
  expiresAt?: number
  revoked?: boolean
  reason?: string
  error?: string
}

export interface AuthStatusResult {
  ok: boolean
  ready?: boolean
  hasUsers?: boolean
  dbFile?: string | null
  reason?: string
}

// --- 用量 / 计价（usage:* / pricing:*） --------------------------------------

/** dashboard 的分桶统计；byAgent / byProvider / byModel 里每一项都是这个形状 */
export interface UsageBucket {
  requests: number
  success: number
  fail: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  reasoningTokens: number
  totalTokens: number
  pricedRequests: number
  unpricedRequests: number
  cost: number
}

/** 分桶行：多一个 key（agent id / provider / "provider / model"） */
export type UsageBucketRow = UsageBucket & {
  key: string
  provider?: string
  model?: string
  currency?: string
}

export interface UsageDashboardResult {
  ok: boolean
  days?: number
  observedRequests?: number
  requests?: number
  success?: number
  fail?: number
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  /** 全部记录都没价格时为 null（后端不伪造 0） */
  cost?: number | null
  costStatus?: string
  pricedRequests?: number
  unpricedRequests?: number
  currency?: string
  byAgent?: UsageBucketRow[]
  byProvider?: UsageBucketRow[]
  byModel?: UsageBucketRow[]
  writable?: boolean
  error?: string
}

export interface UsageSummaryResult {
  ok: boolean
  days?: number
  requests?: number
  successfulRequests?: number
  failedRequests?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimatedCost?: number | null
  estimatedCostStatus?: string
  pricedRequests?: number
  unpricedRequests?: number
  currency?: string
  byAgent?: Array<{
    agentId: string
    requests: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cost: number
  }>
  writable?: boolean
  error?: string
}

/** 一条原始用量记录（JSONL 里的一行） */
export interface UsageRecord {
  id?: string
  timestamp?: string
  agentId?: string
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  durationMs?: number | null
  success?: boolean
  statusCode?: number | null
  cost?: number | null
  costStatus?: string
  currency?: string
}

export interface UsageListResult {
  ok: boolean
  records?: UsageRecord[]
  error?: string
}

/** usage:export 的返回：主进程已经写盘并调用了 shell.showItemInFolder */
export interface UsageExportResult {
  ok: boolean
  path?: string
  count?: number
  error?: string
}

/** 计价表里的一条模型价格 */
export interface PricingModelEntry {
  input_per_1m: number
  output_per_1m: number
  cached_per_1m?: number | null
  reasoning_per_1m?: number | null
  effective_from?: string
  source: string
  verified?: boolean
}

export interface PricingFile {
  version?: number
  currency?: string
  providers?: Record<string, { label?: string; models?: Record<string, PricingModelEntry> }>
}

export interface PricingGetResult {
  ok: boolean
  pricing?: PricingFile
  error?: string
}

/** pricing:set 的入参；source 必填，缺失会被主进程直接拒绝 */
export interface PricingSetPayload {
  provider: string
  model: string
  input_per_1m: number
  output_per_1m: number
  cached_per_1m?: number | null
  reasoning_per_1m?: number | null
  effective_from?: string
  source: string
}

export interface PricingSetResult {
  ok: boolean
  pricing?: PricingFile
  reason?: string
  error?: string
}

// --- 本地用量代理（proxy:*，Phase 13） ---------------------------------------

export interface ProxyStatusResult {
  ok: boolean
  running?: boolean
  port?: number | null
  baseUrl?: string
  perAgent?: Record<string, string>
  error?: string
}

// --- 暴露到 window 的接口 ---------------------------------------------------

/** preload.js 的 contextBridge 暴露面，方法名与顺序均与 preload.js 一致 */
export interface LauncherApi {
  // manifest / probe
  getManifest: () => Promise<ManifestResult>
  probeAgents: () => Promise<ProbeAgentsResult>
  // Agent 运行时控制（入参是 agent id，不是 config id）
  launch: (id: string) => Promise<AgentActionResult>
  selfQuit: () => Promise<void>
  quit: () => Promise<void>
  getAgentStatuses: () => Promise<AgentStatusesResult>
  getAgentStatus: (id: string) => Promise<AgentStatusResult>
  stopAgent: (id: string) => Promise<AgentActionResult>
  restartAgent: (id: string) => Promise<AgentActionResult>
  startAllAgents: () => Promise<StartAllResult>
  stopAllAgents: () => Promise<StopAllResult>
  // 事件订阅（preload 没有提供取消订阅的接口，见 services/agent-client.ts 的说明）
  onAgentStatus: (cb: (payload: AgentStatusEvent) => void) => void
  onTrayQuit: (cb: () => void) => void
  onAgentResync: (cb: () => void) => void
  requestQuit: (opts: unknown) => Promise<unknown>
  openLogs: () => Promise<unknown>
  // API 配置
  getApiConfig: () => Promise<ApiConfigResult>
  saveApiConfig: (payload: SaveApiConfigPayload) => Promise<SaveApiConfigResult>
  clearApiKey: (id: string) => Promise<{ ok: boolean; configured?: boolean; reason?: string }>
  validateApiConfig: (fields: ValidateApiConfigFields) => Promise<ValidateApiConfigResult>
  testConnection: (cfgId: string) => Promise<TestConnectionResult>
  getProviderPresets: () => Promise<ProviderPresetsResult>
  fetchModels: (payload: FetchModelsPayload) => Promise<FetchModelsResult>
  getModelCache: (payload: ModelCachePayload) => Promise<ModelCacheResult>
  testProviderConnection: (payload: TestProviderConnectionPayload) => Promise<TestProviderConnectionResult>
  // 登录层
  authRegister: (payload: { username: string; password: string }) => Promise<AuthResult>
  authLogin: (payload: { username: string; password: string; ua?: string }) => Promise<AuthResult>
  authVerify: (payload: { token: string }) => Promise<AuthResult>
  authLogout: (payload: { token: string }) => Promise<AuthResult>
  authStatus: () => Promise<AuthStatusResult>
  // 用量 / 计价
  usageSummary: (days: number) => Promise<UsageSummaryResult>
  usageList: () => Promise<UsageListResult>
  usageClear: () => Promise<{ ok: boolean; error?: string }>
  pricingGet: () => Promise<PricingGetResult>
  pricingSet: (entry: PricingSetPayload) => Promise<PricingSetResult>
  usageDashboard: (days: number) => Promise<UsageDashboardResult>
  usageExport: (format: 'csv' | 'json') => Promise<UsageExportResult>
  // 本地用量代理
  proxyStart: () => Promise<ProxyStatusResult>
  proxyStop: () => Promise<ProxyStatusResult>
  proxyStatus: () => Promise<ProxyStatusResult>
  // 13.22: Hermes 真实会话桥（官方 ACP 通道；原生会话=真源，聚合器只持索引）
  hermesSessionList: () => Promise<HermesSessionListResult>
  hermesSessionCreate: (params?: { title?: string }) => Promise<HermesSessionResult>
  hermesSessionOpen: (nativeSessionId: string) => Promise<HermesOpenResult>
  hermesSessionSend: (payload: { nativeSessionId: string; text: string }) => Promise<{ ok: boolean; error?: string; code?: string }>
  hermesSessionStop: (nativeSessionId: string) => Promise<{ ok: boolean; error?: string; code?: string }>
  hermesSessionDelete: (nativeSessionId: string) => Promise<{ ok: boolean; error?: string; code?: string }>
  hermesIndexUpdate: (payload: { nativeSessionId: string; patch: Record<string, unknown> }) => Promise<{ ok: boolean; error?: string }>
  hermesIndexRemove: (nativeSessionId: string) => Promise<{ ok: boolean; error?: string }>
  onHermesSessionEvent: (cb: (payload: { nativeSessionId: string; event: unknown }) => void) => void
  // 13.23: 四 Agent 统一会话桥（openclaw/codex/claude-code；hermes 老通道保留不动）
  agentSessionList: (agentId: string) => Promise<AgentSessionListResult>
  agentSessionCreate: (agentId: string, params?: { title?: string }) => Promise<AgentSessionResult>
  agentSessionOpen: (agentId: string, nativeSessionId: string) => Promise<AgentOpenResult>
  agentSessionSend: (payload: { agentId: string; nativeSessionId: string; text: string }) => Promise<{ ok: boolean; error?: string; code?: string }>
  agentSessionStop: (agentId: string, nativeSessionId: string) => Promise<{ ok: boolean; error?: string; code?: string }>
  agentSessionDelete: (agentId: string, nativeSessionId: string) => Promise<{ ok: boolean; error?: string; code?: string }>
  agentSessionRename: (payload: { agentId: string; nativeSessionId: string; title: string }) => Promise<{ ok: boolean; indexOnly?: boolean; error?: string; code?: string }>
  agentSessionArchive: (payload: { agentId: string; nativeSessionId: string; archived: boolean }) => Promise<{ ok: boolean; indexOnly?: boolean; error?: string; code?: string }>
  agentIndexUpdate: (payload: { agentId: string; nativeSessionId: string; patch: Record<string, unknown> }) => Promise<{ ok: boolean; error?: string }>
  agentIndexRemove: (agentId: string, nativeSessionId: string) => Promise<{ ok: boolean; error?: string }>
  onAgentSessionEvent: (cb: (payload: { agentId: string; nativeSessionId: string; event: unknown }) => void) => void
}

export interface HermesIndexEntry {
  agentId: string
  nativeSessionId: string
  title: string
  pinned: boolean
  archived: boolean
  orphaned: boolean
  lastMessagePreview: string
  lastSeen: number
  sortOrder: number
}

export interface HermesSessionListResult {
  ok: boolean
  sessions?: HermesIndexEntry[]
  error?: string
  code?: string
}

export interface HermesSessionResult {
  ok: boolean
  session?: { agentId: string; nativeSessionId: string; title: string; status: string }
  error?: string
  code?: string
}

export interface HermesOpenResult {
  ok: boolean
  session?: { agentId: string; nativeSessionId: string; title: string; status: string }
  history?: unknown[]
  error?: string
  code?: string
}

// --- 13.23: 四 Agent 统一会话桥结果（openclaw/codex/claude-code）-------------
/** agents:session:list 行 = 聚合器索引条目（形状与 HermesIndexEntry 一致） */
export type AgentIndexEntry = HermesIndexEntry

export interface AgentSessionListResult {
  ok: boolean
  sessions?: AgentIndexEntry[]
  /** false = 该 Agent 无官方列表（claude-code），sessions 仅索引条目 */
  nativeSync?: boolean
  error?: string
  code?: string
}

export interface AgentSessionResult {
  ok: boolean
  session?: { agentId: string; nativeSessionId: string; title: string; status: string }
  error?: string
  code?: string
}

export interface AgentOpenResult {
  ok: boolean
  session?: { agentId: string; nativeSessionId: string; title: string; status: string; historyNote?: string }
  history?: unknown[]
  historyNote?: string
  error?: string
  code?: string
}

declare global {
  interface Window {
    /** 由 preload.js 注入；用浏览器直接打开 renderer 时为 undefined */
    launcher?: LauncherApi
  }
}
