/**
 * 左侧栏（规范 §7）：半透明灰底；Agent 列表（置顶优先）+ 当前 Agent 的会话列表。
 */
import { Pin, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { StatusDot } from '@/components/ui/status-badge'
import type { AgentSummary, SessionMeta } from '@/services/agent-control-types'
import { cn } from 'cn'

interface Props {
  agents: AgentSummary[]
  currentId: string | null
  sessions: SessionMeta[]
  sessionId: string | null
  onSwitchAgent: (id: string) => void
  onNewSession: () => void
  onSwitchSession: (id: string) => void
}

export default function SideBar({ agents, currentId, sessions, sessionId, onSwitchAgent, onNewSession, onSwitchSession }: Props) {
  return (
    <aside id="sidebar" className="flex w-[260px] shrink-0 flex-col border-r border-border/70 bg-sidebar">
      <div className="p-2.5">
        <Button id="agent-ctrl-new-session" variant="secondary" className="w-full justify-start gap-2 rounded-lg" onClick={() => void onNewSession()}>
          <Plus className="size-4" strokeWidth={1.5} aria-hidden />
          新建会话
        </Button>
      </div>

      <div id="agent-list" className="space-y-0.5 px-2">
        {agents.map((a) => (
          <button
            key={a.id}
            id={`agent-list-item-${a.id}`}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-accent/70',
              a.id === currentId && 'bg-card shadow-apple',
            )}
            onClick={() => void onSwitchAgent(a.id)}
          >
            <AgentAvatar short={a.short} size="xs" />
            <span className="truncate text-[13px]">{a.name}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {a.pinned ? <Pin id={`agent-list-pin-${a.id}`} className="size-3 text-muted-foreground" strokeWidth={1.5} aria-label="已置顶" /> : null}
              <StatusDot status={a.status} />
            </span>
          </button>
        ))}
      </div>

      <div className="px-3.5 pb-1 pt-3 text-[11px] text-muted-foreground">会话</div>
      <div id="session-list" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-muted-foreground">暂无会话，点上方新建</div>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              id={`session-item-${s.id}`}
              className={cn(
                'flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors duration-150 ease-out hover:bg-accent/70',
                s.id === sessionId && 'bg-accent font-medium',
              )}
              onClick={() => void onSwitchSession(s.id)}
            >
              <span className="truncate">{s.title}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
