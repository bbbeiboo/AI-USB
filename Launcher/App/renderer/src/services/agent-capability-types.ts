/**
 * Agent 能力类型系统（13.20 轮任务书 §四：统一 Capability 类型）。
 * ---------------------------------------------------------------------------
 * 目标不是把四个 Agent 做成一样，而是让聚合器 UI 只根据 Capability 判断
 * 功能是否显示/启用；某 Agent 原生不支持的能力标记 unsupported，绝不伪造。
 *
 * 五态语义（任务书 §三.7 定死，禁止混用）：
 *   native              官方原生支持（官方源码/文档可直接指认）
 *   adapter             Agent 本体不提供，由聚合器适配层实现（必须如实标注）
 *   permission-required 原生支持但需要用户授权/审批才能启用
 *   sandbox-only        仅在沙箱/受限环境中支持（如 Codex 沙箱内执行）
 *   unsupported         不支持——不得制造假按钮、假开关、Stub 假成功
 *
 * 本文件只放类型（零运行时代码），可被 Node strip-types 的单测安全引用。
 */

/** 能力支持五态 */
export type CapabilitySupport =
  | 'native'
  | 'adapter'
  | 'unsupported'
  | 'permission-required'
  | 'sandbox-only'

/** 单条能力 */
export interface AgentCapability {
  /** 形如 'computer.terminal' / 'transfer.receive'（组内唯一，全 Agent 同名同义） */
  id: string
  supported: CapabilitySupport
  /** 一句话事实描述（中文）；unsupported 时说明「不支持什么、由谁补位」 */
  description: string
  requiresPermission?: boolean
  requiresConfiguration?: boolean
  /** 依据：官方源码路径或官方文档 URL（非官方来源禁止作为依据） */
  source: string
}

/** 能力分组键（对齐任务书 §三 的 20 个检查类别，固定顺序） */
export type CapabilityGroupKey =
  | 'agent'        // info/version/health/update/restart/stop
  | 'model'        // providers/models/switch/test/fallback/reasoning/fast_mode/verbosity
  | 'auxiliary'    // vision/compression/title/review/approval/skills/custom
  | 'conversation' // list/create/open/rename/archive/restore/delete/export
  | 'generation'   // send/stream/stop/resume/retry
  | 'files'        // list/read/write/upload/download/delete/export/drag_drop
  | 'computer'     // terminal/filesystem/process/browser/keyboard/mouse/screen/window
  | 'browser'      // open/navigate/click/type/download/upload/screenshot/tabs/cookies/cdp
  | 'memory'       // read/search/write/delete/profile/external_provider
  | 'skills'       // list/load/create/update/delete/approval
  | 'mcp'          // list/add/remove/enable/disable/tools/resources/prompts
  | 'delegation'   // supported/spawn/parallel/max_children/max_depth/orchestrator/worktree
  | 'security'     // permissions/approval/smart_approval/deny_rules/secret_redaction/pii_redaction/website_blocklist
  | 'voice'        // input/output/stt/tts/vad/streaming
  | 'streaming'    // chat/gateway/events
  | 'gateway'      // gateway/telegram/discord/slack/whatsapp
  | 'task'         // create/list/status/cancel/pause/resume/queue/events
  | 'transfer'     // receive/send/file/conversation/task/queue/recommendation
  | 'settings'     // get/set/reset/export/import/schema/reload
  | 'update'       // check/download/install/rollback

/** 某个 Agent 的能力全景（getCapabilities 的返回形状） */
export interface AgentCapabilities {
  agentId: string
  /** 本项目锁定的版本（与 AGENT-SOURCES.md 一致） */
  version: string
  repoUrl: string
  docsUrl: string
  /** 20 组全量；组顺序 = CapabilityGroupKey 定义顺序 */
  groups: Record<CapabilityGroupKey, AgentCapability[]>
}

// —— 原生设置 Schema（13.20 §七：设置映射的类型面）———————————————————————

export type SettingsFieldType = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'list'

/** 设置项在聚合器中的落地状态（任务书 §十一：本轮不要求全部做成 UI） */
export type SettingsEntryStatus = 'implemented' | 'planned' | 'advanced/native-only'

/** 原生配置文件归属（OpenClaw=JSON5 openclaw.json、Codex=config.toml、Claude Code=settings.json、Hermes=config.yaml） */
export type ConfigFileLocation = 'config.yaml' | 'config.toml' | 'settings.json' | 'openclaw.json' | 'env' | 'auth-store' | 'other'

/** 单条原生设置字段（Hermes 全量映射的 TS 面；Secret 只记标记，绝不存值） */
export interface AgentSettingsField {
  /** 官方原始 key（如 model.reasoning_effort） */
  key: string
  /** UI 名称 */
  uiName: string
  type: SettingsFieldType
  defaultValue?: unknown
  /** type='enum' 时必填 */
  enumValues?: string[]
  description: string
  configFile: ConfigFileLocation
  /** Secret 项：值永远不进入本类型实例/内存/JSON（只记标记与归属） */
  secret: boolean
  /** 是否支持运行时热改 */
  runtimeChange: boolean
  /** 是否需要重启 Agent 生效 */
  requiresRestart: boolean
  /** 目标设置页 = 13.18 的 18 项之一，'none' = 暂无落点 */
  page: string
  status: SettingsEntryStatus
  /** 对应能力 id（可空） */
  capability?: string
  /** 依据：官方源码路径或官方文档 URL */
  source: string
}
