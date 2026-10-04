/**
 * 文件中心（13.17 任务书 §二十六）：文件名/类型/大小/来源 Agent/所属任务/创建时间/操作。
 * 数据来自 svc.listFiles()（stub 演示行）；操作（打开/下载/删除/移动/导出到本地）
 * 全部为 stub 反馈——「本地电脑文件 ↔ Agent 工作目录」的真实管线在接线轮接入。
 */
import { useEffect, useState } from 'react'
import { Download, ExternalLink, FolderInput, MoreHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { getAgentControlService } from '@/services/agent-control'
import type { AgentSummary, FileItem } from '@/services/agent-control-types'

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${bytes} B`
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function FilePanel({ agents }: { agents: AgentSummary[] }) {
  const svc = getAgentControlService()
  const [files, setFiles] = useState<FileItem[] | null>(null)

  useEffect(() => {
    let alive = true
    void svc.listFiles().then((fs) => { if (alive) setFiles(fs) }).catch(() => { if (alive) setFiles([]) })
    return () => { alive = false }
  }, [svc])

  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  const stubAct = (label: string, f: FileItem) => toast(`${label}：${f.name}（stub：真实文件操作在接线轮接入）`)

  return (
    <section id="view-files" className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-baseline justify-between border-b border-border/70 px-4 py-2.5">
        <h2 className="text-[15px] font-semibold">文件</h2>
        <span className="text-[11px] text-muted-foreground">stub 演示数据；本地文件 ↔ Agent 工作目录在接线轮打通</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-apple">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border/60 text-[11px] text-muted-foreground">
                <th className="px-3.5 py-2 font-medium">文件名</th>
                <th className="px-3.5 py-2 font-medium">类型</th>
                <th className="px-3.5 py-2 font-medium">大小</th>
                <th className="px-3.5 py-2 font-medium">来源 Agent</th>
                <th className="px-3.5 py-2 font-medium">所属任务</th>
                <th className="px-3.5 py-2 font-medium">创建时间</th>
                <th className="px-3.5 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {(files ?? []).map((f) => (
                <tr key={f.id} id={`file-row-${f.id}`} className="border-b border-border/40 transition-colors duration-150 ease-out last:border-0 hover:bg-accent/40">
                  <td className="max-w-[200px] truncate px-3.5 py-2.5 font-medium">{f.name}</td>
                  <td className="px-3.5 py-2.5 uppercase text-muted-foreground">{f.ext}</td>
                  <td className="px-3.5 py-2.5 text-muted-foreground">{fmtSize(f.sizeBytes)}</td>
                  <td className="px-3.5 py-2.5 text-muted-foreground">{nameOf(f.sourceAgentId)}</td>
                  <td className="max-w-[160px] truncate px-3.5 py-2.5 text-muted-foreground">{f.taskName}</td>
                  <td className="px-3.5 py-2.5 text-muted-foreground">{fmtTime(f.createdAt)}</td>
                  <td className="px-3.5 py-2.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button id={`file-row-menu-${f.id}`} variant="ghost" size="icon-xs" aria-label={`文件操作 ${f.name}`} title="文件操作">
                          <MoreHorizontal className="size-3.5" strokeWidth={1.5} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-32">
                        <DropdownMenuItem id={`file-act-open-${f.id}`} onClick={() => stubAct('打开', f)}>
                          <ExternalLink className="size-3.5" strokeWidth={1.5} aria-hidden />打开
                        </DropdownMenuItem>
                        <DropdownMenuItem id={`file-act-download-${f.id}`} onClick={() => stubAct('下载', f)}>
                          <Download className="size-3.5" strokeWidth={1.5} aria-hidden />下载
                        </DropdownMenuItem>
                        <DropdownMenuItem id={`file-act-move-${f.id}`} onClick={() => stubAct('移动', f)}>
                          <FolderInput className="size-3.5" strokeWidth={1.5} aria-hidden />移动
                        </DropdownMenuItem>
                        <DropdownMenuItem id={`file-act-export-${f.id}`} onClick={() => stubAct('导出到本地', f)}>
                          <Download className="size-3.5" strokeWidth={1.5} aria-hidden />导出到本地
                        </DropdownMenuItem>
                        <DropdownMenuItem id={`file-act-delete-${f.id}`} className="text-destructive focus:text-destructive" onClick={() => stubAct('删除', f)}>
                          <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden />删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
              {files !== null && files.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3.5 py-6 text-center text-[12px] text-muted-foreground">暂无文件；把文件拖入下方输入框即可登记（stub）</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
