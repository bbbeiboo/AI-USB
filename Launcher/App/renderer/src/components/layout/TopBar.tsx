/**
 * 顶栏（13.16 更新）：左 = Agent 切换器（logo 即当前 Agent，左键 Popover 切换，选中即收起）；
 * 中 = 当前会话名；右 = 检查更新 + 帮助（13.16 对标市面客户端的通用应用级按钮，
 * 取代 13.13 的裁剪决定——本轮用户明确要求按市面功能补全）。
 */
import { useState } from 'react'
import { ChevronDown, CircleHelp, RefreshCw } from 'lucide-react'
import { AgentLogo } from '@/components/ui/agent-logo'
import { StatusDot } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/toast'
import type { AgentSummary } from '@/services/agent-control-types'
import { cn } from 'cn'

interface Props {
  agents: AgentSummary[]
  current: AgentSummary | null
  sessionTitle: string
  onSwitchAgent: (id: string) => void
}

const SHORTCUTS: Array<[string, string]> = [
  ['Enter', '发送消息'],
  ['Shift + Enter', '输入换行'],
  ['Ctrl + N', '新建会话'],
  ['Ctrl + K', '搜索会话'],
]

export default function TopBar({ agents, current, sessionTitle, onSwitchAgent }: Props) {
  // 选中即收起：切换菜单挂在顶栏，切换完成后不应挡住侧栏（13.15 用户交互闭环）
  const [menuOpen, setMenuOpen] = useState<boolean>(false)
  const [helpOpen, setHelpOpen] = useState<boolean>(false)
  const [checking, setChecking] = useState<boolean>(false)

  // 检查更新（stub 演示）：可见反馈 = 旋转动画 + 完成提示；不伪造更新内容
  function checkUpdates() {
    if (checking) return
    setChecking(true)
    setTimeout(() => {
      setChecking(false)
      toast('v1.0.0 已是最新（stub 演示，未联网检查）')
    }, 800)
  }

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
          <PopoverContent align="start" className="w-56 p-1.5">
            {agents.map((a) => (
              <button
                key={a.id}
                id={`agent-switcher-item-${a.id}`}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150 ease-out hover:bg-accent',
                  a.id === current.id && 'bg-accent/70',
                )}
                onClick={() => {
                  setMenuOpen(false)
                  onSwitchAgent(a.id)
                }}
              >
                <AgentLogo agentId={a.id} short={a.short} size="xs" />
                <span className="truncate">{a.name}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {a.pinned ? <span className="text-[10px] text-muted-foreground">置顶</span> : null}
                  <StatusDot status={a.status} />
                </span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ) : (
        <div className="shrink-0 text-[15px] font-semibold tracking-tight">AI Agent</div>
      )}
      <div className="min-w-0 flex-1 truncate px-6 text-center text-[13px] text-muted-foreground">
        {sessionTitle}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          id="app-check-updates"
          variant="ghost"
          size="icon-sm"
          aria-label="检查更新"
          title="检查更新"
          disabled={checking}
          onClick={checkUpdates}
        >
          <RefreshCw className={cn('size-4', checking && 'animate-spin')} strokeWidth={1.5} />
        </Button>
        <Popover open={helpOpen} onOpenChange={setHelpOpen}>
          <PopoverTrigger asChild>
            <Button id="app-help" variant="ghost" size="icon-sm" aria-label="帮助" title="帮助与快捷键">
              <CircleHelp className="size-4" strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3">
            <div className="text-[13px] font-semibold">快捷键</div>
            <div className="mt-2 space-y-1.5">
              {SHORTCUTS.map(([k, desc]) => (
                <div key={k} className="flex items-center justify-between text-[12px]">
                  <span className="text-muted-foreground">{desc}</span>
                  <kbd className="rounded border border-border/60 bg-accent px-1.5 py-0.5 font-mono text-[11px]">{k}</kbd>
                </div>
              ))}
            </div>
            <div className="mt-2.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
              更多见 设置 → 关于（左下角齿轮）
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  )
}
