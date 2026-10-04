/**
 * 占位页（13.18 任务书 §3.2）：其余 14 页统一占位——图标 + 标题 + 一句话。
 * 禁令：不出现假开关/假输入框；导航跳转、选中态由容器保证真实可用。
 */
import type { LucideIcon } from 'lucide-react'

export default function PlaceholderPage({ sectionId, label, icon: Icon }: {
  sectionId: string
  label: string
  icon: LucideIcon
}) {
  return (
    <div id={`settings-placeholder-${sectionId}`} className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <Icon className="size-6" strokeWidth={1.5} />
      </span>
      <div className="text-[15px] font-semibold">{label}</div>
      <div className="text-[12px] text-muted-foreground">本页将在后续版本提供</div>
    </div>
  )
}
