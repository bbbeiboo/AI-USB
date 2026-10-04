/**
 * 队列面板（13.17 任务书 §二十五）：目标 Agent 忙 → 任务进入 Pending Queue →
 * 空闲自动执行。当前阶段只做队列 UI 与数据结构（svc.listQueue()，stub 内存态）。
 */
import { useEffect, useState } from 'react'
import { getAgentControlService } from '@/services/agent-control'
import type { AgentSummary, QueueEntry } from '@/services/agent-control-types'

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function QueuePanel({ agents }: { agents: AgentSummary[] }) {
  const svc = getAgentControlService()
  const [queue, setQueue] = useState<QueueEntry[] | null>(null)

  useEffect(() => {
    let alive = true
    void svc.listQueue().then((qs) => { if (alive) setQueue(qs) }).catch(() => { if (alive) setQueue([]) })
    return () => { alive = false }
  }, [svc])

  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id

  return (
    <section id="view-queue" className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-baseline justify-between border-b border-border/70 px-4 py-2.5">
        <h2 className="text-[15px] font-semibold">队列</h2>
        <span className="text-[11px] text-muted-foreground">stub 演示数据，排队自动执行在接线轮接入</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-apple">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border/60 text-[11px] text-muted-foreground">
                <th className="px-3.5 py-2 font-medium">任务</th>
                <th className="px-3.5 py-2 font-medium">目标 Agent</th>
                <th className="px-3.5 py-2 font-medium">队列位置</th>
                <th className="px-3.5 py-2 font-medium">进入时间</th>
              </tr>
            </thead>
            <tbody>
              {(queue ?? []).map((q) => (
                <tr key={q.id} id={`queue-row-${q.id}`} className="border-b border-border/40 transition-colors duration-150 ease-out last:border-0 hover:bg-accent/40">
                  <td className="px-3.5 py-2.5 font-medium">{q.taskName}</td>
                  <td className="px-3.5 py-2.5 text-muted-foreground">{nameOf(q.agentId)}</td>
                  <td className="px-3.5 py-2.5">第 {q.position} 位</td>
                  <td className="px-3.5 py-2.5 text-muted-foreground">{fmtTime(q.enqueuedAt)}</td>
                </tr>
              ))}
              {queue !== null && queue.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3.5 py-6 text-center text-[12px] text-muted-foreground">队列空闲</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
          规则：转交时若目标 Agent 正忙，任务进入等待队列；目标空闲后自动执行。
        </p>
      </div>
    </section>
  )
}
