/**
 * 左侧栏（规范 §7，13.16 更新）：会话搜索 + 会话列表（⋯ 菜单：重命名/置顶/删除）+ 左下用户卡。
 * 对标 Cherry Studio / LobeChat / Chatbox 的会话管理（见 STEP3-NOTES 13.16 对标表）。
 * Agent 列表已删（13.15）——切换只走顶栏 logo；本组件新增 Ctrl+K 聚焦搜索。
 */
import { useEffect, useRef, useState } from 'react'
import { Check, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Settings, Trash2, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { SessionMeta } from '@/services/agent-control-types'
import { cn } from 'cn'

interface Props {
  sessions: SessionMeta[]
  sessionId: string | null
  onNewSession: () => void
  onSwitchSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void
  onDeleteSession: (id: string) => void
  onPinSession: (id: string) => void
  onOpenSettings: () => void
}

export default function SideBar({
  sessions, sessionId, onNewSession, onSwitchSession, onRenameSession, onDeleteSession, onPinSession, onOpenSettings,
}: Props) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  // 删除二次确认：第一次点菜单项只武装（保持菜单开），再点才真删
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const editRef = useRef<HTMLInputElement | null>(null)

  // Ctrl+K 聚焦会话搜索（快捷键面板见顶栏帮助）
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.ctrlKey && ev.key.toLowerCase() === 'k') {
        ev.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (editingId) editRef.current?.focus()
  }, [editingId])

  const q = query.trim().toLowerCase()
  const visible = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions

  function commitRename() {
    if (editingId && draftTitle.trim()) void onRenameSession(editingId, draftTitle)
    setEditingId(null)
    setDraftTitle('')
  }

  return (
    <aside id="sidebar" className="flex w-[260px] shrink-0 flex-col border-r border-border/70 bg-sidebar">
      <div className="space-y-2 p-2.5">
        <Button id="agent-ctrl-new-session" variant="secondary" className="w-full justify-start gap-2 rounded-lg" onClick={() => void onNewSession()}>
          <Plus className="size-4" strokeWidth={1.5} aria-hidden />
          新建会话
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <input
            id="session-search"
            ref={searchRef}
            value={query}
            placeholder="搜索会话（Ctrl+K）"
            aria-label="搜索会话"
            className="h-8 w-full rounded-lg border border-border/60 bg-card pl-8 pr-2 text-[12px] outline-none transition-all duration-150 ease-out placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(ev) => setQuery(ev.target.value)}
          />
        </div>
      </div>

      <div className="px-3.5 pb-1 text-[11px] text-muted-foreground">会话</div>
      <div id="session-list" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {visible.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-muted-foreground">
            {q ? '无匹配会话' : '暂无会话，点上方新建'}
          </div>
        ) : (
          visible.map((s) => (
            <div
              key={s.id}
              className={cn(
                'group flex items-center rounded-lg pr-0.5 transition-colors duration-150 ease-out hover:bg-accent/70',
                s.id === sessionId && 'bg-accent',
              )}
            >
              {editingId === s.id ? (
                <input
                  id={`session-rename-input-${s.id}`}
                  ref={editRef}
                  value={draftTitle}
                  aria-label="重命名会话"
                  className="h-7 min-w-0 flex-1 rounded-md border border-ring bg-card px-2 text-[13px] outline-none"
                  onChange={(ev) => setDraftTitle(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') commitRename()
                    if (ev.key === 'Escape') {
                      setEditingId(null)
                      setDraftTitle('')
                    }
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <>
                  <button
                    id={`session-item-${s.id}`}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px]"
                    onClick={() => void onSwitchSession(s.id)}
                  >
                    {s.pinned ? <Pin className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-label="已置顶" /> : null}
                    <span className="truncate">{s.title}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        id={`session-menu-${s.id}`}
                        aria-label="会话操作"
                        title="会话操作"
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-150 ease-out hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <MoreHorizontal className="size-4" strokeWidth={1.5} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-36">
                      <DropdownMenuItem
                        id={`session-menu-rename-${s.id}`}
                        onClick={() => {
                          setEditingId(s.id)
                          setDraftTitle(s.title)
                        }}
                      >
                        <Pencil className="size-3.5" strokeWidth={1.5} aria-hidden />
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuItem id={`session-menu-pin-${s.id}`} onClick={() => void onPinSession(s.id)}>
                        {s.pinned ? <PinOff className="size-3.5" strokeWidth={1.5} aria-hidden /> : <Pin className="size-3.5" strokeWidth={1.5} aria-hidden />}
                        {s.pinned ? '取消置顶' : '置顶'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        id={`session-menu-delete-${s.id}`}
                        className="text-destructive focus:text-destructive"
                        onSelect={(ev) => {
                          if (armedDeleteId !== s.id) {
                            ev.preventDefault()
                            setArmedDeleteId(s.id)
                          } else {
                            setArmedDeleteId(null)
                            void onDeleteSession(s.id)
                          }
                        }}
                      >
                        {armedDeleteId === s.id ? <Check className="size-3.5" strokeWidth={1.5} aria-hidden /> : <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden />}
                        {armedDeleteId === s.id ? '再点一次确认删除' : '删除'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
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
