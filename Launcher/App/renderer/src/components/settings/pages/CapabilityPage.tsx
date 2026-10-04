/**
 * 能力与字段只读预览页（13.20 未完成事项落地：14 个占位页升级）。
 * ---------------------------------------------------------------------------
 * 统一裁决（docs/AGENT-CAPABILITY-UI-MAP.md §0）：不支持的能力「显示但明确标记不支持」。
 *   - 能力概览：本页相关能力组 × 四 Agent 聚合徽标（native/adapter/需授权/仅沙箱/不支持）
 *   - 字段只读预览：AGENT_SETTINGS_SCHEMAS 中 page=本页 的字段（UI 名/key/类型/状态徽标/重启标记）
 * 禁令延续（13.18 §3.2）：本页不出现任何可交互控件——无开关、无输入框、无按钮；
 * 字段编辑随对应版本开放（状态徽标注明），Secret 字段只显示「凭据」标记，值永不出现。
 */
import type { LucideIcon } from 'lucide-react'
import type { AgentSettingsField, CapabilityGroupKey, CapabilitySupport } from '@/services/agent-capability-types'
import { AGENT_CAPABILITIES, AGENT_SETTINGS_SCHEMAS, settingsStatusBadge } from '@/services/capabilities/index'
import type { AgentSummary } from '@/services/agent-control-types'
import { cn } from 'cn'

/** 设置页 → 相关能力组（UI-MAP §1；空数组 = 该页无能力组，仅字段/占位） */
const PAGE_CAP_GROUPS: Partial<Record<string, CapabilityGroupKey[]>> = {
  chat: ['conversation'],
  workspace: ['computer'],
  security: ['security'],
  browser: ['browser'],
  memory: ['memory'],
  voice: ['voice'],
  advanced: ['delegation'],
  gateway: ['gateway', 'streaming'],
  keys: ['mcp'],
  plugins: ['skills'],
  providers: ['model'],
  notifications: ['task'],
}

const SUPPORT_LABEL: Record<CapabilitySupport, string> = {
  native: '原生支持',
  adapter: '适配层提供',
  'permission-required': '原生 · 需授权',
  'sandbox-only': '仅沙箱',
  unsupported: '不支持',
}

/** 聚合一个能力组在某 Agent 处的徽标：有非 unsupported → 取最高档；全 unsupported → 不支持 */
function aggregateSupport(agentId: string, groups: CapabilityGroupKey[]): CapabilitySupport {
  const caps = AGENT_CAPABILITIES[agentId]
  const states = groups.flatMap((g) => caps.groups[g].map((c) => c.supported))
  if (states.some((s) => s === 'native')) return 'native'
  if (states.some((s) => s === 'permission-required')) return 'permission-required'
  if (states.some((s) => s === 'adapter')) return 'adapter'
  if (states.some((s) => s === 'sandbox-only')) return 'sandbox-only'
  return 'unsupported'
}

function Badge({ tone, children }: { tone: 'ok' | 'mid' | 'off' | 'info'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] leading-none',
        tone === 'ok' && 'bg-primary/10 text-primary',
        tone === 'mid' && 'bg-accent text-muted-foreground',
        tone === 'off' && 'bg-muted text-muted-foreground/70 line-through',
        tone === 'info' && 'bg-accent text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

function supportTone(s: CapabilitySupport): 'ok' | 'mid' | 'off' {
  if (s === 'native') return 'ok'
  if (s === 'unsupported') return 'off'
  return 'mid'
}

const TYPE_LABEL: Record<AgentSettingsField['type'], string> = {
  string: '文本', number: '数字', boolean: '开关', enum: '枚举', object: '对象', list: '列表',
}

export default function CapabilityPage({ sectionId, label, icon: Icon, agents }: {
  sectionId: string
  label: string
  icon: LucideIcon
  agents: AgentSummary[]
}) {
  const capGroups = PAGE_CAP_GROUPS[sectionId] ?? []
  // 字段只读预览：四 Agent Schema 中 page 落在本页的字段（按 Agent 分组展示）
  const fieldRows = agents
    .map((a) => ({ agent: a, fields: (AGENT_SETTINGS_SCHEMAS[a.id] ?? []).filter((f) => f.page === sectionId) }))
    .filter((r) => r.fields.length > 0)

  if (capGroups.length === 0 && fieldRows.length === 0) {
    return (
      <div id={`settings-placeholder-${sectionId}`} className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <span aria-hidden className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
          <Icon className="size-6" strokeWidth={1.5} />
        </span>
        <div className="text-[15px] font-semibold">{label}</div>
        <div className="text-[12px] text-muted-foreground">本页将在后续版本提供</div>
      </div>
    )
  }

  return (
    <div id={`settings-cap-page-${sectionId}`} className="space-y-5 p-5">
      {/* 头部（沿用占位页的图标+标题语言） */}
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-card text-muted-foreground">
          <Icon className="size-4.5" strokeWidth={1.5} />
        </span>
        <div>
          <div className="text-[15px] font-semibold leading-tight">{label}</div>
          <div className="text-[11px] text-muted-foreground">能力与字段只读预览 · 编辑随对应版本开放（13.20 统一裁决：不支持的能力标记而非隐藏）</div>
        </div>
      </div>

      {/* 能力概览：本页能力组 × 四 Agent */}
      {capGroups.length > 0 ? (
        <section aria-label={`${label}能力概览`}>
          <div className="text-[11px] font-medium text-muted-foreground">能力概览</div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {agents.map((a) => {
              const support = aggregateSupport(a.id, capGroups)
              return (
                <div
                  key={a.id}
                  id={`settings-cap-agent-${a.id}-${sectionId}`}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2"
                >
                  <span className="text-[12px] font-medium">{a.name}</span>
                  <Badge tone={supportTone(support)}>{SUPPORT_LABEL[support]}</Badge>
                </div>
              )
            })}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">判定依据逐条见 docs/AGENT-CAPABILITY-MATRIX.md（官方源码/文档溯源）</div>
        </section>
      ) : null}

      {/* 字段只读预览（按 Agent 分组） */}
      {fieldRows.length > 0 ? (
        <section aria-label={`${label}字段预览`}>
          <div className="text-[11px] font-medium text-muted-foreground">相关设置字段（只读预览）</div>
          <div className="mt-1.5 space-y-3">
            {fieldRows.map(({ agent, fields }) => (
              <div key={agent.id}>
                <div className="text-[11px] text-muted-foreground">{agent.name}</div>
                <div className="mt-1 overflow-hidden rounded-lg border border-border/60">
                  {fields.map((f, i) => (
                    <div
                      key={`${agent.id}-${f.key}`}
                      id={`settings-field-${agent.id}-${sectionId}-${f.key.replace(/[^\w-]+/g, '-')}`}
                      className={cn('flex items-center gap-2 px-3 py-1.5 text-[12px]', i > 0 && 'border-t border-border/50')}
                    >
                      <span className="w-28 shrink-0 truncate font-medium">{f.uiName}</span>
                      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{f.key}</code>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{TYPE_LABEL[f.type]}</span>
                      {f.secret ? <Badge tone="info">凭据</Badge> : null}
                      {f.requiresRestart ? <Badge tone="info">重启生效</Badge> : null}
                      <Badge tone={f.status === 'implemented' ? 'ok' : 'mid'}>{settingsStatusBadge(f.status)}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">凭据字段只显示标记；明文永不经 UI（密钥零接触）。全量映射见 docs/HERMES-SETTINGS-MATRIX.md</div>
        </section>
      ) : null}
    </div>
  )
}
