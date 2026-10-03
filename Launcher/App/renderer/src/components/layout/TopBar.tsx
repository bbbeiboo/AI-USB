/**
 * 顶栏（13.15 更新）：左侧「AI Agent」品牌位即 Agent 切换器——logo 显示当前 Agent 官方标，
 * 左键 Popover 选择切换（全应用唯一切换入口）；中当前会话名；右侧留空
 * （设置齿轮 13.15 起移到侧栏左下用户卡，见 SideBar.tsx）。
 */
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { AgentLogo } from '@/components/ui/agent-logo'
import { StatusDot } from '@/components/ui/status-badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { AgentSummary } from '@/services/agent-control-types'
import { cn } from 'cn'

interface Props {
  agents: AgentSummary[]
  current: AgentSummary | null
  sessionTitle: string
  onSwitchAgent: (id: string) => void
}

export default function TopBar({ agents, current, sessionTitle, onSwitchAgent }: Props) {
  // 选中即收起：切换菜单挂在顶栏，切换完成后不应挡住侧栏（13.15 用户交互闭环）
  const [menuOpen, setMenuOpen] = useState<boolean>(false)
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
    </header>
  )
}
