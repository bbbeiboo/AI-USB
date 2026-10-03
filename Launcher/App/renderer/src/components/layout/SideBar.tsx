/**
 * 左侧栏（规范 §7，13.15 更新）：会话列表 + 左下角个人用户卡。
 * Agent 列表已整体删除——切换只走顶栏 logo 一个按钮（用户裁决：只用这一个按钮切换 Agent）。
 * 用户卡为展示态：真实身份来自登录接线轮（13.6 第 1 条），stub 阶段不伪造个人中心弹窗。
 */
import { Settings, User, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SessionMeta } from '@/services/agent-control-types'
import { cn } from 'cn'

interface Props {
  sessions: SessionMeta[]
  sessionId: string | null
  onNewSession: () => void
  onSwitchSession: (id: string) => void
  onOpenSettings: () => void
}

export default function SideBar({ sessions, sessionId, onNewSession, onSwitchSession, onOpenSettings }: Props) {
  return (
    <aside id="sidebar" className="flex w-[260px] shrink-0 flex-col border-r border-border/70 bg-sidebar">
      <div className="p-2.5">
        <Button id="agent-ctrl-new-session" variant="secondary" className="w-full justify-start gap-2 rounded-lg" onClick={() => void onNewSession()}>
          <Plus className="size-4" strokeWidth={1.5} aria-hidden />
          新建会话
        </Button>
      </div>

      <div className="px-3.5 pb-1 pt-1 text-[11px] text-muted-foreground">会话</div>
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

      {/* ===== 个人用户卡（13.15）：左下角身份展示 + 设置齿轮 ===== */}
      <div id="user-card" className="flex shrink-0 items-center gap-2.5 border-t border-border/70 p-2.5">
        <div
          id="user-avatar"
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-accent text-muted-foreground"
        >
          <User className="size-4" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div id="user-name" className="truncate text-[13px] font-medium">本地用户</div>
          <div className="truncate text-[11px] text-muted-foreground">stub 演示账户</div>
        </div>
        <Button id="app-settings" variant="ghost" size="icon-sm" aria-label="设置" title="设置" onClick={onOpenSettings}>
          <Settings className="size-[18px]" strokeWidth={1.5} />
        </Button>
      </div>
    </aside>
  )
}
