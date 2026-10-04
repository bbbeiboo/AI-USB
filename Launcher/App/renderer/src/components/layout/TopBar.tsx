/**
 * 顶栏（13.17 任务书 §四~§七 重构）：
 *   左 = [当前 Agent Logo ▼]（Logo 即 Switcher；菜单项 = Logo+名称+简短描述+选中状态）
 *   右 = 🔍 搜索  🔔 通知  ⋯ 更多（关于/检查更新/快捷键/导入/导出配置/日志）
 * 禁令（任务书 §六/§三十九）：不出现「4 Agents 在线」等任何在线状态；
 * 中部不放会话名（会话名归工作台顶部）。帮助内容合并进「快捷键」子菜单与「关于」。
 */
import { useEffect, useState } from 'react'
import { Bell, Check, ChevronDown, Download, FileText, Info, RefreshCw, Search, Upload } from 'lucide-react'
import { AgentLogo } from '@/components/ui/agent-logo'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { getAgentControlService } from '@/services/agent-control'
import type { AgentSummary, AppNotification, FileItem, SessionMeta, TaskItem } from '@/services/agent-control-types'
import { cn } from 'cn'

interface Props {
  agents: AgentSummary[]
  current: AgentSummary | null
  sessions: SessionMeta[]
  notifications: AppNotification[]
  onSwitchAgent: (id: string) => void
  onOpenSession: (id: string) => void
  onOpenView: (view: 'tasks' | 'queue' | 'files') => void
  onOpenLogs: () => void
  onOpenAbout: () => void
}

const SHORTCUTS: Array<[string, string]> = [
  ['Enter', '发送消息'],
  ['Shift + Enter', '输入换行'],
  ['Ctrl + N', '新建会话'],
  ['Ctrl + K', '搜索会话'],
]

function relTime(ts: number): string {
  const d = Date.now() - ts
  if (d < 60_000) return '刚刚'
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86_400_000) return `${Math.floor(d / 3600_000)} 小时前`
  return `${Math.floor(d / 86_400_000)} 天前`
}

export default function TopBar({
  agents, current, sessions, notifications, onSwitchAgent, onOpenSession, onOpenView, onOpenLogs, onOpenAbout,
}: Props) {
  // 选中即收起：切换菜单挂在顶栏，切换完成后不应挡住侧栏（13.15 用户交互闭环）
  const [menuOpen, setMenuOpen] = useState<boolean>(false)
  const [searchOpen, setSearchOpen] = useState<boolean>(false)
  const [notifOpen, setNotifOpen] = useState<boolean>(false)
  const [checking, setChecking] = useState<boolean>(false)

  const svc = getAgentControlService()
  // 搜索数据：会话来自 props（当前 Agent），任务/文件在打开时拉一次（stub 内存数据）
  const [q, setQ] = useState('')
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  useEffect(() => {
    if (!searchOpen) return
    void svc.listTasks().then(setTasks).catch(() => setTasks([]))
    void svc.listFiles().then(setFiles).catch(() => setFiles([]))
  }, [searchOpen, svc])

  // 检查更新（stub 演示）：可见反馈 = 旋转动画 + 完成提示；不伪造更新内容
  function checkUpdates() {
    if (checking) return
    setChecking(true)
    setTimeout(() => {
      setChecking(false)
      toast('v1.0.0 已是最新（stub 演示，未联网检查）')
    }, 800)
  }

  const query = q.trim().toLowerCase()
  const hitSessions = query ? sessions.filter((s) => s.title.toLowerCase().includes(query)).slice(0, 5) : []
  const hitTasks = query ? tasks.filter((t) => t.name.toLowerCase().includes(query)).slice(0, 5) : []
  const hitFiles = query ? files.filter((f) => f.name.toLowerCase().includes(query)).slice(0, 5) : []
  const noHit = query && hitSessions.length + hitTasks.length + hitFiles.length === 0

  return (
    <header id="topbar" className="glass flex h-12 shrink-0 items-center gap-3 border-b border-border/70 px-4">
      {current ? (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              id="agent-switcher"
              className="-ml-1 flex shrink-0 items-center gap-2 rounded-lg py-1 pl-1 pr-2 text-left transition-colors duration-150 ease-out hover:bg-accent"
              aria-label={`当前 Agent：${current.name}，点击切换`}
              title="点击切换 Agent"
            >
              <AgentLogo agentId={current.id} short={current.short} size="md" />
              <span className="text-[15px] font-semibold tracking-tight">{current.name}</span>
              <ChevronDown className="size-4 shrink-0 opacity-60" strokeWidth={1.5} aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-1.5">
            {agents.map((a) => (
              <button
                key={a.id}
                id={`agent-switcher-item-${a.id}`}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-accent',
                  a.id === current.id && 'bg-accent/70',
                )}
                onClick={() => {
                  setMenuOpen(false)
                  onSwitchAgent(a.id)
                }}
              >
                <AgentLogo agentId={a.id} short={a.short} size="xs" className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium leading-tight">{a.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{a.desc ?? ''}</span>
                </span>
                {a.id === current.id ? (
                  <span id={`agent-switcher-check-${a.id}`} className="mt-0.5 flex items-center gap-0.5 text-[10px] text-primary">
                    <Check className="size-3" strokeWidth={2} aria-hidden />
                    当前
                  </span>
                ) : null}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ) : (
        <div className="shrink-0 text-[15px] font-semibold tracking-tight">AI Agent</div>
      )}

      <div className="min-w-0 flex-1" />

      <div className="flex shrink-0 items-center gap-0.5">
        {/* 🔍 搜索（任务书 §七.1：搜索会话/任务/文件） */}
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button id="app-search" variant="ghost" size="icon-sm" aria-label="搜索" title="搜索会话 / 任务 / 文件">
              <Search className="size-4" strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2">
            <input
              id="app-search-input"
              value={q}
              placeholder="搜索会话、任务与文件…"
              aria-label="全局搜索"
              className="h-8 w-full rounded-lg border border-border/60 bg-card px-2.5 text-[12px] outline-none transition-all duration-150 ease-out placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onChange={(ev) => setQ(ev.target.value)}
            />
            <div id="app-search-results" className="mt-1.5 max-h-72 space-y-1 overflow-y-auto">
              {!query ? (
                <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">输入关键词搜索当前 Agent 的会话与全局任务/文件</div>
              ) : noHit ? (
                <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">无匹配结果</div>
              ) : (
                <>
                  {hitSessions.length > 0 ? (
                    <div>
                      <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium text-muted-foreground">会话</div>
                      {hitSessions.map((s) => (
                        <button
                          key={s.id}
                          id={`search-session-${s.id}`}
                          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors duration-150 ease-out hover:bg-accent"
                          onClick={() => {
                            setSearchOpen(false)
                            setQ('')
                            onOpenSession(s.id)
                          }}
                        >
                          <span className="truncate">{s.title}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {hitTasks.length > 0 ? (
                    <div>
                      <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium text-muted-foreground">任务</div>
                      {hitTasks.map((t) => (
                        <button
                          key={t.id}
                          id={`search-task-${t.id}`}
                          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors duration-150 ease-out hover:bg-accent"
                          onClick={() => {
                            setSearchOpen(false)
                            setQ('')
                            onOpenView('tasks')
                          }}
                        >
                          <span className="truncate">{t.name}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{agents.find((a) => a.id === t.agentId)?.name ?? ''}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {hitFiles.length > 0 ? (
                    <div>
                      <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium text-muted-foreground">文件</div>
                      {hitFiles.map((f) => (
                        <button
                          key={f.id}
                          id={`search-file-${f.id}`}
                          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors duration-150 ease-out hover:bg-accent"
                          onClick={() => {
                            setSearchOpen(false)
                            setQ('')
                            onOpenView('files')
                          }}
                        >
                          <span className="truncate">{f.name}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{f.ext.toUpperCase()}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* 🔔 通知（任务书 §七.2：当前阶段 Mock 数据） */}
        <Popover open={notifOpen} onOpenChange={setNotifOpen}>
          <PopoverTrigger asChild>
            <Button id="app-notifications" variant="ghost" size="icon-sm" aria-label={`通知（${notifications.length} 条）`} title="通知" className="relative">
              <Bell className="size-4" strokeWidth={1.5} />
              {notifications.length > 0 ? (
                <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary ring-2 ring-background/80" />
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2">
            <div id="notification-list" className="max-h-80 space-y-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">暂无通知</div>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} id={`notification-item-${n.id}`} className="rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-accent/60">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12px] font-medium">{n.title}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{relTime(n.ts)}</span>
                    </div>
                    {n.detail ? <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{n.detail}</div> : null}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* ⋯ 更多（任务书 §七.3：关于/检查更新/快捷键/导入导出配置/帮助） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button id="app-more" variant="ghost" size="icon-sm" aria-label="更多" title="更多">
              <span className="text-[16px] leading-none tracking-widest">⋯</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem id="app-check-updates" disabled={checking} onClick={checkUpdates}>
              <RefreshCw className={cn('size-3.5', checking && 'animate-spin')} strokeWidth={1.5} aria-hidden />
              检查更新
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger id="app-shortcuts">
                <span className="size-3.5" aria-hidden />
                快捷键
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-56 p-2">
                {SHORTCUTS.map(([k, desc]) => (
                  <div key={k} className="flex items-center justify-between px-1.5 py-1 text-[12px]">
                    <span className="text-muted-foreground">{desc}</span>
                    <kbd className="rounded border border-border/60 bg-accent px-1.5 py-0.5 font-mono text-[11px]">{k}</kbd>
                  </div>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem id="app-config-import" onClick={() => toast('导入配置（stub：接线轮对接现有后端配置通道）')}>
              <Upload className="size-3.5" strokeWidth={1.5} aria-hidden />
              导入配置
            </DropdownMenuItem>
            <DropdownMenuItem id="app-config-export" onClick={() => toast('导出配置（stub：接线轮对接现有后端配置通道）')}>
              <Download className="size-3.5" strokeWidth={1.5} aria-hidden />
              导出配置
            </DropdownMenuItem>
            <DropdownMenuItem id="app-open-logs" onClick={() => onOpenLogs()}>
              <FileText className="size-3.5" strokeWidth={1.5} aria-hidden />
              打开日志
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem id="app-about" onClick={onOpenAbout}>
              <Info className="size-3.5" strokeWidth={1.5} aria-hidden />
              关于
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
