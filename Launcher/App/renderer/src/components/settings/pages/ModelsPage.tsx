/**
 * 模型页（13.18 任务书 §3.1，本轮唯一全量实现的设置页）：
 *   说明文字 → 提供方/模型/推理 + 「应用」→ 辅助模型区块（8 行 + 全部重置）→ Mixture of Agents。
 * 双层隔离（任务书 §3.1.4）：「应用」写 settings 层 stub，不影响输入框内对话级切换器（setModel）。
 * 辅助「更改」下拉与主模型同源 = 当前主提供方的模型清单。
 */
import { useEffect, useState } from 'react'
import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { getAgentControlService } from '@/services/agent-control'
import type { AuxModelBinding, MainModelConfig, ReasoningLevel, SettingsProvider } from '@/services/agent-control-types'
import { cn } from 'cn'

const REASONING_LABEL: Record<ReasoningLevel, string> = { low: '低', medium: '中', high: '高' }

const MOA_PRESETS = ['default', 'deep', 'fast']

interface Props {
  /** 搜索命中辅助任务时高亮该行（2s，由 SettingsDialog 计时清除） */
  highlightTaskId: string | null
}

export default function ModelsPage({ highlightTaskId }: Props) {
  const svc = getAgentControlService()
  const [providers, setProviders] = useState<SettingsProvider[]>([])
  const [config, setConfig] = useState<MainModelConfig | null>(null)
  // 草稿态：应用前可随意改，关闭弹窗不丢（stub 内存态本身会话内持久）
  const [draft, setDraft] = useState<MainModelConfig | null>(null)
  const [aux, setAux] = useState<AuxModelBinding[]>([])
  const [moa, setMoa] = useState('default')

  useEffect(() => {
    let alive = true
    void (async () => {
      const [ps, cfg, ax] = await Promise.all([svc.listSettingsProviders(), svc.getMainModelConfig(), svc.listAuxModels()])
      if (!alive) return
      setProviders(ps)
      setConfig(cfg)
      setDraft(cfg)
      setAux(ax)
    })().catch(() => {})
    return () => { alive = false }
  }, [svc])

  if (!config || !draft) {
    return <div className="p-4 text-[13px] text-muted-foreground">加载中…</div>
  }

  // 收窄进局部常量：后续闭包内不再碰可空 state
  const saved = config
  const d = draft
  const provider = providers.find((p) => p.id === d.providerId)
  const mainProvider = providers.find((p) => p.id === saved.providerId) ?? providers[0]

  function pickProvider(id: string) {
    const p = providers.find((x) => x.id === id)
    if (!p) return
    setDraft({ ...d, providerId: id, model: p.models[0] ?? '' })
  }

  async function apply() {
    await svc.setMainModelConfig(d)
    setConfig({ ...d })
    toast('已应用：新会话默认模型已更新（stub，不影响当前对话的临时切换）')
  }

  async function changeAux(taskId: string, model: string | null) {
    await svc.setAuxModel(taskId, model)
    setAux(await svc.listAuxModels())
    toast(model ? `已指定辅助模型：${model}（stub）` : '已重置为主模型（stub）')
  }

  async function resetAllAux() {
    await svc.resetAllAuxModels()
    setAux(await svc.listAuxModels())
    toast('已全部重置为主模型（stub）')
  }

  return (
    <div className="space-y-6 p-5">
      <div className="text-[12px] text-muted-foreground">应用于新会话。可在输入框的模型选择器中临时切换当前对话。</div>

      {/* ===== 提供方 / 模型 / 推理 + 应用 ===== */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[13px] text-muted-foreground">提供方</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                id="settings-provider-select"
                className="flex h-8 min-w-[220px] items-center justify-between gap-2 rounded-lg border border-border/60 bg-card px-2.5 text-[13px] transition-colors duration-150 ease-out hover:bg-accent"
                aria-label="选择提供方"
              >
                <span className="truncate">{provider?.name ?? d.providerId}</span>
                <ChevronDown className="size-3.5 shrink-0 opacity-60" strokeWidth={1.5} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[220px]">
              {providers.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  id={`settings-provider-item-${p.id}`}
                  className={cn('text-[13px]', p.id === d.providerId && 'bg-accent/70 font-medium')}
                  onClick={() => pickProvider(p.id)}
                >
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[13px] text-muted-foreground">模型</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                id="settings-model-select"
                className="flex h-8 min-w-[220px] items-center justify-between gap-2 rounded-lg border border-border/60 bg-card px-2.5 text-[13px] transition-colors duration-150 ease-out hover:bg-accent"
                aria-label="选择模型"
              >
                <span className="truncate">{d.model || '—'}</span>
                <ChevronDown className="size-3.5 shrink-0 opacity-60" strokeWidth={1.5} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[220px]">
              {(provider?.models ?? []).map((m) => (
                <DropdownMenuItem
                  key={m}
                  id={`settings-model-item-${m}`}
                  className={cn('text-[13px]', m === d.model && 'bg-accent/70 font-medium')}
                  onClick={() => setDraft({ ...d, model: m })}
                >
                  {m}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button id="settings-apply" size="sm" className="h-8 rounded-lg px-4 text-[13px]" onClick={() => void apply()}>
            应用
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[13px] text-muted-foreground">默认值 推理</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                id="settings-reasoning-select"
                className="flex h-8 items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 text-[13px] transition-colors duration-150 ease-out hover:bg-accent"
                aria-label="选择推理力度"
              >
                {REASONING_LABEL[d.reasoningLevel]}
                <ChevronDown className="size-3.5 shrink-0 opacity-60" strokeWidth={1.5} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-24">
              {(Object.keys(REASONING_LABEL) as ReasoningLevel[]).map((lv) => (
                <DropdownMenuItem
                  key={lv}
                  id={`settings-reasoning-item-${lv}`}
                  className={cn('text-[13px]', lv === d.reasoningLevel && 'bg-accent/70 font-medium')}
                  onClick={() => setDraft({ ...d, reasoningLevel: lv })}
                >
                  {REASONING_LABEL[lv]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ===== 辅助模型（8 行） ===== */}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold">辅助模型</h3>
          <button
            id="aux-reset-all"
            className="text-[12px] text-primary transition-opacity duration-150 ease-out hover:opacity-80"
            onClick={() => void resetAllAux()}
          >
            全部重置为主模型
          </button>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">辅助任务默认使用主模型。你可以为任意任务指定专用模型。</p>
        <div className="mt-2 divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-card">
          {aux.map((b) => {
            const bound = b.boundModel !== null
            return (
              <div
                key={b.taskId}
                id={`aux-row-${b.taskId}`}
                className={cn(
                  'flex items-center gap-3 px-3.5 py-2.5 transition-colors duration-150 ease-out',
                  highlightTaskId === b.taskId && 'bg-accent ring-2 ring-ring/60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">{b.label}</span>
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">{b.hint}</span>
                  </div>
                  <div id={`aux-status-${b.taskId}`} className="mt-0.5 text-[11px] text-muted-foreground">
                    {bound ? `已指定 · ${b.boundModel}` : '自动 · 使用主模型'}
                  </div>
                </div>
                {bound ? (
                  <button
                    id={`aux-reset-${b.taskId}`}
                    className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-foreground"
                    onClick={() => void changeAux(b.taskId, null)}
                  >
                    <RotateCcw className="size-3" strokeWidth={1.5} aria-hidden />
                    设为主模型
                  </button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      id={`aux-change-${b.taskId}`}
                      className="shrink-0 rounded-md px-1.5 py-1 text-[12px] text-primary transition-colors duration-150 ease-out hover:bg-accent"
                    >
                      更改
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[200px]">
                    {(mainProvider?.models ?? []).map((m) => (
                      <DropdownMenuItem
                        key={m}
                        id={`aux-model-${b.taskId}-${m}`}
                        className="text-[13px]"
                        onClick={() => void changeAux(b.taskId, m)}
                      >
                        <Check className={cn('size-3.5', b.boundModel === m ? 'opacity-100' : 'opacity-0')} strokeWidth={2} aria-hidden />
                        {m}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })}
        </div>
      </div>

      {/* ===== Mixture of Agents ===== */}
      <div>
        <h3 className="text-[14px] font-semibold">Mixture of Agents</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">Run multiple models in parallel and merge their answers for better results.</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[13px] text-muted-foreground">预设</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                id="moa-preset-select"
                className="flex h-8 items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 text-[13px] transition-colors duration-150 ease-out hover:bg-accent"
                aria-label="选择 MoA 预设"
              >
                {moa}
                <ChevronDown className="size-3.5 shrink-0 opacity-60" strokeWidth={1.5} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-28">
              {MOA_PRESETS.map((p) => (
                <DropdownMenuItem
                  key={p}
                  id={`moa-preset-item-${p}`}
                  className={cn('text-[13px]', p === moa && 'bg-accent/70 font-medium')}
                  onClick={() => setMoa(p)}
                >
                  {p}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="text-[11px] text-muted-foreground">（stub 演示，接线轮接入真实并行策略）</span>
        </div>
      </div>
    </div>
  )
}
