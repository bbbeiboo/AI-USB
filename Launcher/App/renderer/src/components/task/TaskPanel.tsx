/**
 * 任务面板（13.17 任务书 §二十四）：任务名称/当前 Agent/状态/创建时间/操作。
 * 数据来自 svc.listTasks()（stub 种子 + 转交登记的任务），挂载时拉取。
 */
import { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAgentControlService } from '@/services/agent-control'
import type { AgentSummary, TaskItem, TaskStatus } from '@/services/agent-control-types'
import { cn } from 'cn'

export const TASK_STATUS_META: Record<TaskStatus, { label: string; cls: string; dot: string }> = {
  pending: { label: '等待中', cls: 'text-muted-foreground', dot: 'bg-muted-foreground/50' },
  running: { label: '执行中', cls: 'text-primary', dot: 'bg-primary' },
  done: { label: '已完成', cls: 'text-foreground', dot: 'bg-emerald-500' },
  failed: { label: '失败', cls: 'text-destructive', dot: 'bg-destructive' },
  transferred: { label: '已转交', cls: 'text-foreground', dot: 'bg-amber-500' },
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

interface Props {
  agents: AgentSummary[]
  onOpenTask: (task: TaskItem) => void
}

export default function TaskPanel({ agents, onOpenTask }: Props) {
  const svc = getAgentControlService()
  const [tasks, setTasks] = useState<TaskItem[] | null>(null)

  useEffect(() => {
    let alive = true
    void svc.listTasks().then((ts) => { if (alive) setTasks(ts) }).catch(() => { if (alive) setTasks([]) })
    return () => { alive = false }
  }, [svc])

  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id

  return (
    <section id="view-task" className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-baseline justify-between border-b border-border/70 px-4 py-2.5">
        <h2 className="text-[15px] font-semibold">任务</h2>
        <span className="text-[11px] text-muted-foreground">stub 演示数据，真实任务在接线轮接入</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-apple">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border/60 text-[11px] text-muted-foreground">
                <th className="px-3.5 py-2 font-medium">任务名称</th>
                <th className="px-3.5 py-2 font-medium">当前 Agent</th>
                <th className="px-3.5 py-2 font-medium">状态</th>
                <th className="px-3.5 py-2 font-medium">创建时间</th>
                <th className="px-3.5 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {(tasks ?? []).map((t) => {
                const meta = TASK_STATUS_META[t.status]
                return (
                  <tr key={t.id} id={`task-row-${t.id}`} className="border-b border-border/40 transition-colors duration-150 ease-out last:border-0 hover:bg-accent/40">
                    <td className="px-3.5 py-2.5 font-medium">{t.name}</td>
                    <td className="px-3.5 py-2.5 text-muted-foreground">{nameOf(t.agentId)}</td>
                    <td className="px-3.5 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden className={cn('size-1.5 rounded-full', meta.dot)} />
                        <span className={meta.cls}>{meta.label}</span>
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-muted-foreground">{fmtTime(t.createdAt)}</td>
                    <td className="px-3.5 py-2.5">
                      {t.sessionId ? (
                        <Button
                          id={`task-open-session-${t.id}`}
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 rounded-md px-2 text-[12px]"
                          onClick={() => onOpenTask(t)}
                        >
                          <MessageSquare className="size-3" strokeWidth={1.5} aria-hidden />
                          打开会话
                        </Button>
                      ) : (
                        <span className="text-[12px] text-muted-foreground/60">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {tasks !== null && tasks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3.5 py-6 text-center text-[12px] text-muted-foreground">暂无任务</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
