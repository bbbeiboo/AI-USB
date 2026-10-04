/**
 * 四 Agent 能力注册表 + 转交能力门控（13.20 任务书 §六/§十三）。
 * ---------------------------------------------------------------------------
 * 适配现有 services/ 结构（不重构 agents/ 目录）：每个 Agent 一个数据文件，
 * 这里统一注册。UI / 转交推荐 / 设置页显隐都只能通过本注册表取能力，
 * 数据来源与三态判定见各文件头与 docs/AGENT-CAPABILITY-MATRIX.md。
 */
import type { AgentCapabilities, AgentSettingsField, CapabilityGroupKey } from '../agent-capability-types.ts'
import type { AgentInfo, TransferPayload } from '../agent-control-types.ts'
import { HERMES_CAPABILITIES, HERMES_SETTINGS_SCHEMA } from './hermes.ts'
import { OPENCLAW_CAPABILITIES, OPENCLAW_SETTINGS_SCHEMA } from './openclaw.ts'
import { CODEX_CAPABILITIES, CODEX_SETTINGS_SCHEMA } from './codex.ts'
import { CLAUDE_CODE_CAPABILITIES, CLAUDE_CODE_SETTINGS_SCHEMA } from './claude-code.ts'
import { AGENT_INFO_RECORD } from './info.ts'

/** 20 组固定顺序（任务书 §三 的检查类别顺序；单测钉死） */
export const CAPABILITY_GROUP_KEYS: CapabilityGroupKey[] = [
  'agent', 'model', 'auxiliary', 'conversation', 'generation', 'files', 'computer',
  'browser', 'memory', 'skills', 'mcp', 'delegation', 'security', 'voice', 'streaming',
  'gateway', 'task', 'transfer', 'settings', 'update',
]

export const AGENT_CAPABILITIES: Record<string, AgentCapabilities> = {
  openclaw: OPENCLAW_CAPABILITIES,
  hermes: HERMES_CAPABILITIES,
  codex: CODEX_CAPABILITIES,
  'claude-code': CLAUDE_CODE_CAPABILITIES,
}

export const AGENT_INFO: Record<string, AgentInfo> = AGENT_INFO_RECORD

/** 原生设置 Schema 注册表（getSettingsSchema 数据源；Hermes 全量文档见 docs/HERMES-SETTINGS-MATRIX.md） */
export const AGENT_SETTINGS_SCHEMAS: Record<string, AgentSettingsField[]> = {
  openclaw: OPENCLAW_SETTINGS_SCHEMA,
  hermes: HERMES_SETTINGS_SCHEMA,
  codex: CODEX_SETTINGS_SCHEMA,
  'claude-code': CLAUDE_CODE_SETTINGS_SCHEMA,
}

/** 未知 agent 防呆（与 stub assertAgent 同语义） */
export function assertCapabilityAgent(id: string): void {
  if (!AGENT_CAPABILITIES[id]) throw new Error(`capabilities: unknown agent ${id}`)
}

export interface TransferAcceptance {
  ok: boolean
  /** 不通过时给出「哪个能力不支持」的人话原因（UI 可直接展示） */
  reason: string
}

/**
 * 转交能力门控（13.20 §十三）：推荐/转交前按目标 Agent 能力过滤。
 * 全部通过 → ok；否则 reason 指明缺失能力。目标=来源由服务层另行校验。
 */
export function canAcceptTransfer(
  targetId: string,
  payload: Pick<TransferPayload, 'includeConversation' | 'includeFiles' | 'includeTask'>,
  /** 测试注入用：缺省读注册表（服务层不传） */
  capsOverride?: AgentCapabilities,
): TransferAcceptance {
  assertCapabilityAgent(targetId)
  const caps = capsOverride ?? AGENT_CAPABILITIES[targetId]
  const supportOf = (group: 'transfer', id: string) =>
    caps.groups[group].find((c) => c.id === id)?.supported ?? 'unsupported'
  if (supportOf('transfer', 'transfer.receive') === 'unsupported') {
    return { ok: false, reason: `${targetId} 不支持接收转交任务（transfer.receive=unsupported）` }
  }
  if (payload.includeTask && supportOf('transfer', 'transfer.task') === 'unsupported') {
    return { ok: false, reason: `${targetId} 不支持接收任务条目（transfer.task=unsupported）` }
  }
  if (payload.includeFiles && supportOf('transfer', 'transfer.file') === 'unsupported') {
    return { ok: false, reason: `${targetId} 不支持接收附带文件（transfer.file=unsupported）` }
  }
  if (payload.includeConversation && supportOf('transfer', 'transfer.conversation') === 'unsupported') {
    return { ok: false, reason: `${targetId} 不支持接收会话上下文（transfer.conversation=unsupported）` }
  }
  return { ok: true, reason: '' }
}
