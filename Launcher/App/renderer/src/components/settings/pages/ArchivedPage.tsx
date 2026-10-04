/**
 * 已归档对话页（13.18 任务书 §3.2）：stub 归档列表，每行 = 标题 + 归档时间 + 恢复/删除。
 * 恢复/删除后从列表移除并 toast；真实归档来源（各 Agent 会话归档）在接线轮确认。
 */
import { useEffect, useState } from 'react'
import { Archive, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { getAgentControlService } from '@/services/agent-control'
import type { AgentSummary, ArchivedSession } from '@/services/agent-control-types'

export default function ArchivedPage({ agents }: { agents: AgentSummary[] }) {
  const svc = getAgentControlService()
  const [rows, setRows] = useState<ArchivedSession[] | null>(null)

  useEffect(() => {
    let alive = true
    void svc.listArchivedSessions().then((rs) => { if (alive) setRows(rs) }).catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [svc])

  async function act(id: string, kind: 'restore' | 'delete') {
    if (kind === 'restore') {
      await svc.restoreArchivedSession(id)
      toast('已恢复到会话列表（stub：会话内容在接线轮回流）')
    } else {
      await svc.deleteArchivedSessionForever(id)
      toast('已彻底删除（stub）')
    }
    setRows(await svc.listArchivedSessions())
  }

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id

  return (
    <div className="space-y-3 p-5">
      <h3 className="text-[14px] font-semibold">已归档对话</h3>
      <div className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-card">
        {(rows ?? []).map((s) => (
          <div key={s.id} id={`archived-row-${s.id}`} className="flex items-center gap-3 px-3.5 py-2.5">
            <Archive className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{s.title}</div>
              <div className="text-[11px] text-muted-foreground">
                {agentName(s.agentId)} · 归档于 {new Date(s.archivedAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <Button
              id={`archived-restore-${s.id}`}
              variant="ghost"
              size="sm"
              className="h-7 gap-1 rounded-md px-2 text-[12px]"
              onClick={() => void act(s.id, 'restore')}
            >
              <Undo2 className="size-3" strokeWidth={1.5} aria-hidden />
              恢复
            </Button>
            <Button
              id={`archived-delete-${s.id}`}
              variant="ghost"
              size="sm"
              className="h-7 gap-1 rounded-md px-2 text-[12px] text-destructive hover:text-destructive"
              onClick={() => void act(s.id, 'delete')}
            >
              <Trash2 className="size-3" strokeWidth={1.5} aria-hidden />
              删除
            </Button>
          </div>
        ))}
        {rows !== null && rows.length === 0 ? (
          <div className="px-3.5 py-6 text-center text-[12px] text-muted-foreground">没有已归档的对话</div>
        ) : null}
      </div>
    </div>
  )
}
