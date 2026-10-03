/**
 * 顶栏（13.14 更新）：左产品名；中当前会话名；右设置齿轮。
 * Agent 切换器已集成到工作台头部 logo 上（见 Workbench.tsx）——顶栏不再放切换按钮。
 */
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  sessionTitle: string
  onOpenSettings: () => void
}

export default function TopBar({ sessionTitle, onOpenSettings }: Props) {
  return (
    <header id="topbar" className="glass flex h-12 shrink-0 items-center gap-3 border-b border-border/70 px-4">
      <div className="shrink-0 text-[15px] font-semibold tracking-tight">AI Agent</div>
      <div className="min-w-0 flex-1 truncate px-6 text-center text-[13px] text-muted-foreground">
        {sessionTitle}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button id="app-settings" variant="ghost" size="icon-sm" aria-label="设置" onClick={onOpenSettings}>
          <Settings className="size-5" strokeWidth={1.5} />
        </Button>
      </div>
    </header>
  )
}
