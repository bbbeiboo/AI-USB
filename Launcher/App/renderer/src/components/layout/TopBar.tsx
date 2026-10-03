/**
 * 顶栏（规范 §7）：毛玻璃、左产品名、中当前会话名、右 Agent 切换器 + 设置齿轮。
 * Agent 选择器收进右上角图标：显示当前 Agent 字母头像，Popover 切换（含状态点）。
 */
import { ChevronDown, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { StatusDot } from '@/components/ui/status-badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { AgentSummary } from '@/services/agent-control-types'
import { cn } from 'cn'

interface Props {
  agents: AgentSummary[]
  current: AgentSummary | null
  sessionTitle: string
  onSwitchAgent: (id: string) => void
  onOpenSettings: () => void
}

export default function TopBar({ agents, current, sessionTitle, onSwitchAgent, onOpenSettings }: Props) {
  return (
    <header id="topbar" className="glass flex h-12 shrink-0 items-center gap-3 border-b border-border/70 px-4">
      <div className="shrink-0 text-[15px] font-semibold tracking-tight">AI Agent</div>
      {/* 当前会话名居中；空会话名时不占视觉焦点 */}
      <div className="min-w-0 flex-1 truncate px-6 text-center text-[13px] text-muted-foreground">
        {sessionTitle}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id="agent-switcher"
              variant="ghost"
              className="gap-1.5 px-1.5"
              aria-label={`当前 Agent：${current?.name ?? '未选择'}，点击切换`}
            >
              <AgentAvatar short={current?.short ?? '?'} size="md" />
              <ChevronDown className="size-4 opacity-60" strokeWidth={1.5} aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1.5">
            {agents.map((a) => (
              <button
                key={a.id}
                id={`agent-switcher-item-${a.id}`}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150 ease-out hover:bg-accent',
                  a.id === current?.id && 'bg-accent/70',
                )}
                onClick={() => onSwitchAgent(a.id)}
              >
                <AgentAvatar short={a.short} size="xs" />
                <span className="truncate">{a.name}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {a.pinned ? <span className="text-[10px] text-muted-foreground">置顶</span> : null}
                  <StatusDot status={a.status} />
                </span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <Button id="app-settings" variant="ghost" size="icon-sm" aria-label="设置" onClick={onOpenSettings}>
          <Settings className="size-5" strokeWidth={1.5} />
        </Button>
      </div>
    </header>
  )
}
