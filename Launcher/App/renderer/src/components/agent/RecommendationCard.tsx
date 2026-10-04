/**
 * 下一步推荐卡（13.17 任务书 §十七/§十八）：每一轮 Agent 回复后必须显示。
 * ---------------------------------------------------------------------------
 * 推荐只是推荐（任务书 §二十）——「转交 →」打开 TransferDialog，
 * 用户可自由选择任意其他 Agent；数据来自 svc.getRecommendation（stub 确定性映射）。
 */
import { ArrowRight, Lightbulb, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentLogo } from '@/components/ui/agent-logo'
import type { AgentRecommendation, AgentSummary } from '@/services/agent-control-types'

interface Props {
  recommendation: AgentRecommendation
  target: AgentSummary | undefined
  onOpenTransfer: () => void
}

export default function RecommendationCard({ recommendation, target, onOpenTransfer }: Props) {
  if (!target) return null
  return (
    <div
      id="recommendation-card"
      className="ml-auto w-fit max-w-[82%] rounded-xl border border-border/60 bg-card/70 px-3 py-2 shadow-apple"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Lightbulb className="size-3.5" strokeWidth={1.5} aria-hidden />
        下一步推荐
      </div>
      <div className="mt-1 flex items-center gap-2">
        <AgentLogo agentId={target.id} short={target.short} size="xs" />
        <span className="text-[13px] font-medium">{target.name}</span>
        {typeof recommendation.confidence === 'number' ? (
          <span className="rounded bg-accent px-1 py-0.5 text-[10px] text-muted-foreground">
            匹配度 {Math.round(recommendation.confidence * 100)}%（stub）
          </span>
        ) : null}
      </div>
      <div className="mt-1 max-w-[420px] text-[12px] leading-relaxed text-muted-foreground">{recommendation.reason}</div>
      <Button id="agent-ctrl-transfer" size="sm" className="mt-2 h-7 gap-1.5 rounded-lg px-3 text-[12px]" onClick={onOpenTransfer}>
        <Star className="size-3.5" strokeWidth={1.5} aria-hidden />
        转交
        <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden />
      </Button>
    </div>
  )
}
