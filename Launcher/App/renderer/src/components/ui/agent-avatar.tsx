/**
 * Agent 字母头像（规范 §4）：中性灰渐变，彩色只给状态点。
 * short 取自 AgentSummary.short（O/H/C/CC）。三档尺寸对应三处使用位。
 */
import { cn } from 'cn'

const SIZES = {
  xs: 'size-5 rounded-md text-[10px]',
  md: 'size-8 rounded-lg text-[13px]',
  lg: 'size-12 rounded-xl text-[20px]',
} as const

export function AgentAvatar({
  short,
  size = 'md',
  id,
  className,
}: {
  short: string
  size?: keyof typeof SIZES
  id?: string
  className?: string
}) {
  return (
    <span
      id={id}
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center border border-black/5 bg-gradient-to-b from-[#f0f0f3] to-[#e2e2e7] font-semibold text-foreground/80 shadow-apple',
        SIZES[size],
        className,
      )}
    >
      {short}
    </span>
  )
}
