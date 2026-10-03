import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  onClick?: () => void
  /**
   * 顶部栏用图标按钮（showLabel=false），侧栏底部用"图标 + 文字"的整行按钮（showLabel=true）。
   * 同一个组件覆盖布局图里的 ⚙ 与 [设置] 两处入口。
   */
  showLabel?: boolean
}

/** 设置入口按钮 */
export default function SettingsButton({ onClick, showLabel = false }: Props) {
  return (
    <Button
      id={showLabel ? 'settings-btn-sidebar' : 'settings-btn'}
      variant={showLabel ? 'outline' : 'ghost'}
      size={showLabel ? 'default' : 'icon'}
      className={showLabel ? 'w-full justify-start gap-2' : undefined}
      onClick={onClick}
      title="设置"
    >
      <Settings className="size-4" />
      {showLabel ? '设置' : null}
    </Button>
  )
}
