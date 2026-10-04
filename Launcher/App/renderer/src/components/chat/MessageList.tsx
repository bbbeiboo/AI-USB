/**
 * 消息列表（13.17 任务书 §十七）：现代 AI Chat UI 的消息流。
 * ---------------------------------------------------------------------------
 * - 用户消息：右侧主色气泡；Agent 回复：左侧卡片
 * - 最后一条 Agent 回复（生成完成后）下方带操作行：复制 / 重新生成
 *   （任务书 §十七 mockup 的「复制 重新生成 ⋯」——⋯ 无既定条目，不虚构菜单）
 * - 推荐卡（RecommendationCard）挂在最后一条 Agent 回复之后
 */
import { useMemo } from 'react'
import { Copy, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AgentRecommendation, AgentSummary, OutputEntry } from '@/services/agent-control-types'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/components/ui/toast'
import RecommendationCard from '@/components/agent/RecommendationCard'
import { cn } from 'cn'

interface Props {
  output: OutputEntry[]
  generating: boolean
  recommendation: AgentRecommendation | null
  /** 推荐目标的完整摘要（来自 wb.agents；找不到时不渲染推荐卡） */
  recommendationTarget: AgentSummary | undefined
  onOpenTransfer: () => void
  onRegenerate: () => void
}

function lastAgentEntryId(entries: OutputEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].kind === 'agent') return entries[i].id
  }
  return null
}

export default function MessageList({
  output, generating, recommendation, recommendationTarget, onOpenTransfer, onRegenerate,
}: Props) {
  const lastAgentId = useMemo(() => lastAgentEntryId(output), [output])

  if (output.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <div className="text-[28px] font-semibold tracking-tight">准备好了</div>
        <div className="text-[13px] text-muted-foreground">发送一条消息开始这个会话</div>
      </div>
    )
  }

  return (
    <>
      {output.map((e) => {
        if (e.kind === 'system') {
          return (
            <div key={e.id} id={`output-entry-${e.id}`} className="animate-in fade-in text-center text-[11px] text-muted-foreground">
              {e.text}
            </div>
          )
        }
        const isUser = e.kind === 'user'
        const isLastAgent = e.id === lastAgentId && !e.streaming && !generating
        return (
          <div key={e.id} className="space-y-1">
            <div className={cn('flex animate-in fade-in', isUser ? 'justify-end' : 'justify-start')}>
              <div
                id={`output-entry-${e.id}`}
                className={cn(
                  'max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed',
                  isUser
                    ? 'rounded-br-md bg-primary text-primary-foreground'
                    : 'rounded-bl-md border border-border/60 bg-card shadow-apple',
                  e.streaming ? 'opacity-80' : '',
                )}
              >
                {e.text}
                {e.streaming ? <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-current align-middle" /> : null}
              </div>
            </div>
            {isLastAgent && !isUser ? (
              <div className="flex items-center gap-1 pl-1" id={`message-actions-${e.id}`}>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="复制这条回复"
                  title="复制"
                  onClick={async () => {
                    const ok = await copyText(e.text)
                    toast(ok ? '已复制' : '复制失败（剪贴板不可用）')
                  }}
                >
                  <Copy className="size-3.5" strokeWidth={1.5} />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label="重新生成" title="重新生成" onClick={onRegenerate}>
                  <RotateCcw className="size-3.5" strokeWidth={1.5} />
                </Button>
              </div>
            ) : null}
          </div>
        )
      })}
      {recommendation && recommendationTarget && !generating && lastAgentId ? (
        <RecommendationCard
          recommendation={recommendation}
          target={recommendationTarget}
          onOpenTransfer={onOpenTransfer}
        />
      ) : null}
    </>
  )
}
