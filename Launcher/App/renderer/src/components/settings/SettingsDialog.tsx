/**
 * 设置中心弹窗（13.18 任务书 §一/§五）：React 覆盖层（非新 BrowserWindow）。
 *   左 = SettingsNav（200px 固定）· 右 = 可滚动内容区；
 *   顶边居中「🔍 搜索 Ctrl K」胶囊（点击/Ctrl+K 展开 SearchOverlay）；
 *   右上 ✕ / Esc / 点遮罩 三种关闭等效；关闭不丢改动（状态在服务层内存态）。
 * 键盘捕获（capture 阶段 + stopPropagation）：弹窗打开时锁定下层快捷键
 *   （Ctrl+K 转为设置内搜索、Ctrl+N 屏蔽，避免触发侧栏会话搜索/新建）。
 */
import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import SettingsNav from './SettingsNav'
import SearchOverlay from './SearchOverlay'
import ModelsPage from './pages/ModelsPage'
import ArchivedPage from './pages/ArchivedPage'
import HotkeysPage from './pages/HotkeysPage'
import AboutPage from './pages/AboutPage'
import PlaceholderPage from './pages/PlaceholderPage'
import { SETTINGS_SECTION_META } from './SettingsNav'
import type { AgentSummary, SettingsSectionId } from '@/services/agent-control-types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 本次打开时落到的页（默认 models；⋯「关于」入口传 about） */
  initialSection: SettingsSectionId
  agents: AgentSummary[]
}

export default function SettingsDialog({ open, onOpenChange, initialSection, agents }: Props) {
  const [section, setSection] = useState<SettingsSectionId>(initialSection)
  const [searchOpen, setSearchOpen] = useState<boolean>(false)
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null)

  // 每次打开：落到指定页、收起搜索、清高亮
  useEffect(() => {
    if (!open) return
    setSection(initialSection)
    setSearchOpen(false)
    setHighlightTaskId(null)
  }, [open, initialSection])

  // 键盘捕获：Ctrl+K=设置内搜索；Ctrl+N 屏蔽；Esc=先收搜索再关弹窗（radix 菜单开着时不动）
  useEffect(() => {
    if (!open) return
    function onKeyDown(ev: KeyboardEvent) {
      const k = ev.key.toLowerCase()
      if (ev.ctrlKey && k === 'k') {
        ev.preventDefault()
        ev.stopPropagation()
        setSearchOpen((v) => !v)
        return
      }
      if (ev.ctrlKey && k === 'n') {
        // 下层交互锁死：弹窗内不新建会话
        ev.preventDefault()
        ev.stopPropagation()
        return
      }
      if (ev.key === 'Escape' && !ev.defaultPrevented) {
        // radix 菜单/弹层开着时，Esc 先归它（其内部会阻止默认/冒泡处理）
        if (document.querySelector('[data-radix-popper-content-wrapper]')) return
        if (searchOpen) {
          setSearchOpen(false)
          return
        }
        onOpenChange(false)
      }
    }
    // capture 阶段注册：抢在 SideBar/App 的 bubble 监听（同挂 window）之前
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions)
  }, [open, searchOpen, onOpenChange])

  // 关闭时不渲染（与既有 SettingsModal 同约定：不在 DOM 里留隐藏态）
  if (!open) return null

  function jumpTo(target: SettingsSectionId, highlight?: string) {
    setSection(target)
    setSearchOpen(false)
    if (highlight) {
      setHighlightTaskId(highlight)
      window.setTimeout(() => setHighlightTaskId(null), 2000)
    }
  }

  const meta = SETTINGS_SECTION_META.find((s) => s.id === section)
  const page = (() => {
    switch (section) {
      case 'models':
        return <ModelsPage highlightTaskId={highlightTaskId} />
      case 'archived':
        return <ArchivedPage agents={agents} />
      case 'hotkeys':
        return <HotkeysPage />
      case 'about':
        return <AboutPage />
      default:
        return <PlaceholderPage sectionId={section} label={meta?.label ?? section} icon={meta?.icon ?? Search} />
    }
  })()

  return (
    <div
      id="settings-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onOpenChange(false)
      }}
    >
      <div
        id="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="relative flex h-[620px] max-h-[90vh] w-[880px] max-w-[92vw] overflow-visible rounded-xl border border-border bg-background shadow-lg"
      >
        {/* 顶边居中搜索胶囊 */}
        <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
          <button
            id="settings-search-trigger"
            className="glass flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-[12px] text-muted-foreground shadow-apple transition-colors duration-150 ease-out hover:bg-accent"
            aria-label="搜索设置（Ctrl+K）"
            onClick={() => setSearchOpen((v) => !v)}
          >
            <Search className="size-3.5" strokeWidth={1.5} aria-hidden />
            搜索
            <kbd className="rounded border border-border/60 bg-accent px-1.5 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
          </button>
        </div>
        {searchOpen ? <SearchOverlay onJump={jumpTo} onClose={() => setSearchOpen(false)} /> : null}

        {/* 标题行（导航上方）+ 关闭 */}
        <div className="flex w-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-border/60 py-2 pl-4 pr-3">
            <h2 className="text-[15px] font-semibold">设置</h2>
            <Button
              id="settings-close"
              variant="ghost"
              size="icon-sm"
              aria-label="关闭设置"
              title="关闭（Esc）"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" strokeWidth={1.5} />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1">
            <SettingsNav active={section} onSelect={(id) => { setSection(id); setSearchOpen(false) }} />
            <div className="min-h-0 flex-1 overflow-y-auto">{page}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
