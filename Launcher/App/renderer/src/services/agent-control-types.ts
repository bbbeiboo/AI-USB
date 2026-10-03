/**
 * Agent 控制服务类型定义（UI v2 · stub 优先）。
 * ---------------------------------------------------------------------------
 * 类型风格对齐 types/launcher.d.ts 的 UsageDashboardResult 一脉：
 * 全部 Promise 返回、字段可注释溯源、绝不让 UI 拿到歧义形状。
 * 本文件只放类型（零运行时代码），可被 Node strip-types 的单测安全引用。
 */

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
}

export interface SessionMeta {
  id: string
  agentId: string
  title: string
  createdAt: number
  updatedAt: number
  /** 会话级置顶（13.16 对标 Cherry Studio/LobeChat：置顶会话排在列表最前） */
  pinned: boolean
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

  onStatusChange(cb: StatusChangeHandler): () => void
  onOutput(cb: OutputHandler): () => void
}
