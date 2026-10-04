/**
 * 转交任务弹窗（13.17 任务书 §十九~§二十二 + §三十 状态完整性）。
 * ---------------------------------------------------------------------------
 * - ⭐ 推荐目标默认选中；其他 Agent 单选；当前 Agent disabled（任务书 §二十一：禁止转交给自己）
 * - 附带内容：当前对话 / 当前文件 / 当前任务 三个 checkbox（结构 TransferPayload 定死于服务层）
 * - 状态机（任务书 §三十）：idle → submitting（正在转交…）→ success（✓ 已转交）| error（转交失败）
 * - 本阶段只走 stub：不向真实 Agent 发送任何内容
 */
import { useEffect, useState } from 'react'
import { Check, Loader2, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentLogo } from '@/components/ui/agent-logo'
import type { AgentSummary, TransferPayload, TransferResult } from '@/services/agent-control-types'
import { cn } from 'cn'

type Phase = 'idle' | 'submitting' | 'success' | 'error'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  agents: AgentSummary[]
  currentAgent: AgentSummary
  recommendationAgentId: string | null
  conversationId: string | null
  onConfirm: (payload: TransferPayload) => Promise<TransferResult>
}

/** 手写 checkbox 行（零新依赖；Apple 令牌） */
function CheckRow({
  id, label, checked, onToggle, disabled,
}: {
  id: string
  label: string
  checked: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <button
      id={id}
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      className="flex items-center gap-2 text-left text-[13px] transition-opacity duration-150 ease-out disabled:opacity-50"
      onClick={onToggle}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-4 items-center justify-center rounded border transition-colors duration-150 ease-out',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 bg-card',
        )}
      >
        {checked ? <Check className="size-3" strokeWidth={2} /> : null}
      </span>
      {label}
    </button>
  )
}

export default function TransferDialog({
  open, onOpenChange, agents, currentAgent, recommendationAgentId, conversationId, onConfirm,
}: Props) {
  const others = agents.filter((a) => a.id !== currentAgent.id)
  const [targetId, setTargetId] = useState<string>(recommendationAgentId && recommendationAgentId !== currentAgent.id ? recommendationAgentId : others[0]?.id ?? '')
  const [includeConversation, setIncludeConversation] = useState(true)
  const [includeFiles, setIncludeFiles] = useState(true)
  const [includeTask, setIncludeTask] = useState(true)
  const [phase, setPhase] = useState<Phase>('idle')
  const [errMsg, setErrMsg] = useState('')

  // 每次打开重置：目标回到推荐（若有），附带全选，状态归零
  useEffect(() => {
    if (!open) return
    setTargetId(recommendationAgentId && recommendationAgentId !== currentAgent.id ? recommendationAgentId : others[0]?.id ?? '')
    setIncludeConversation(true)
    setIncludeFiles(true)
    setIncludeTask(true)
    setPhase('idle')
    setErrMsg('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recommendationAgentId, currentAgent.id])

  // Escape 关闭（submitting 中不允许）
  useEffect(() => {
    if (!open) return
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape' && phase !== 'submitting') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, phase, onOpenChange])

  if (!open) return null

  async function confirm() {
    if (!targetId || phase === 'submitting') return
    setPhase('submitting')
    setErrMsg('')
    try {
      const r = await onConfirm({
        sourceAgentId: currentAgent.id,
        targetAgentId: targetId,
        conversationId: includeConversation ? (conversationId ?? undefined) : undefined,
        includeConversation,
        includeFiles,
        includeTask,
      })
      if (r.ok) {
        setPhase('success')
        // 成功态展示一拍再关闭（任务书 §三十 success 状态可见）
        setTimeout(() => onOpenChange(false), 900)
      } else {
        setPhase('error')
        setErrMsg(r.message || '转交失败')
      }
    } catch (err) {
      setPhase('error')
      setErrMsg(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div
      id="transfer-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget && phase !== 'submitting') onOpenChange(false)
      }}
    >
      <div
        id="transfer-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="转交任务"
        className="w-[420px] max-w-[90vw] rounded-xl border border-border bg-background p-4 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold">转交任务</h3>
          <Button
            id="transfer-close"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭"
            disabled={phase === 'submitting'}
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" strokeWidth={1.5} />
          </Button>
        </div>

        {/* ⭐ 推荐 */}
        <div className="mt-3 text-[11px] font-medium text-muted-foreground">⭐ 推荐</div>
        <div role="radiogroup" aria-label="转交目标" className="mt-1.5 space-y-1">
          {others.map((a) => {
            const isRec = a.id === recommendationAgentId
            const selected = targetId === a.id
            return (
              <button
                key={a.id}
                id={`transfer-target-${a.id}`}
                role="radio"
                aria-checked={selected}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 ease-out',
                  selected ? 'border-ring bg-accent/70' : 'border-border/60 hover:bg-accent/40',
                )}
                onClick={() => setTargetId(a.id)}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border',
                    selected ? 'border-primary' : 'border-border/70',
                  )}
                >
                  {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <AgentLogo agentId={a.id} short={a.short} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">
                    {a.name}
                    {isRec ? (
                      <span className="flex items-center gap-0.5 rounded bg-accent px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
                        <Star className="size-2.5" strokeWidth={1.5} aria-hidden />
                        推荐
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">{a.desc ?? ''}</span>
                </span>
              </button>
            )
          })}
          {/* 当前 Agent：disabled 展示（任务书 §二十一 允许 disabled 或隐藏，选 disabled 以明示规则） */}
          <div
            id="transfer-target-self"
            aria-disabled
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border/60 px-2.5 py-2 opacity-50"
          >
            <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border/70" />
            <AgentLogo agentId={currentAgent.id} short={currentAgent.short} size="xs" />
            <span className="min-w-0 flex-1 text-[13px] font-medium">{currentAgent.name}</span>
            <span className="text-[10px] text-muted-foreground">当前 Agent，不可选择</span>
          </div>
        </div>

        {/* 附带内容 */}
        <div className="mt-3 text-[11px] font-medium text-muted-foreground">附带内容</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <CheckRow id="transfer-check-conversation" label="当前对话" checked={includeConversation && !!conversationId} disabled={!conversationId} onToggle={() => setIncludeConversation((v) => !v)} />
          <CheckRow id="transfer-check-files" label="当前文件" checked={includeFiles} onToggle={() => setIncludeFiles((v) => !v)} />
          <CheckRow id="transfer-check-task" label="当前任务" checked={includeTask} onToggle={() => setIncludeTask((v) => !v)} />
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">stub 演示：附带内容只做接口预留，不发送真实数据</div>

        {/* 状态区（任务书 §三十） */}
        {phase === 'error' ? (
          <div id="transfer-error" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
            转交失败：{errMsg}
          </div>
        ) : null}
        {phase === 'success' ? (
          <div id="transfer-success" className="mt-3 flex items-center gap-1.5 text-[12px] text-foreground">
            <Check className="size-3.5 text-primary" strokeWidth={2} aria-hidden />
            已转交
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button id="transfer-cancel" variant="outline" size="sm" disabled={phase === 'submitting'} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button id="transfer-confirm" size="sm" disabled={phase === 'submitting' || phase === 'success' || !targetId} onClick={() => void confirm()}>
            {phase === 'submitting' ? (
              <>
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} aria-hidden />
                正在转交…
              </>
            ) : (
              '确认转交'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
