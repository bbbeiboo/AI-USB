/**
 * Agent 官方 logo 组件（13.14 用户裁决：使用哪个 Agent 就显示哪个 Agent 的官方 logo）。
 * ---------------------------------------------------------------------------
 * 资产在 public/logos/（各官方站点/官方仓库获取，来源与商标归属见 STEP3-NOTES 13.14）。
 * 加载失败或未知 id 时回退到字母头像（AgentAvatar），演示/离线环境不断图。
 */
import { useState } from 'react'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { cn } from 'cn'

const LOGO_SRC: Record<string, string> = {
  openclaw: 'logos/openclaw.svg',
  hermes: 'logos/hermes.png',
  codex: 'logos/codex.svg',
  'claude-code': 'logos/claude-code.ico',
}

const SIZES = {
  xs: 'size-5 rounded-md',
  md: 'size-8 rounded-lg',
  lg: 'size-12 rounded-xl',
} as const

export function AgentLogo({
  agentId,
  short,
  size = 'md',
  className,
}: {
  agentId: string
  short: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const src = LOGO_SRC[agentId]
  if (!src || failed) {
    return <AgentAvatar short={short} size={size} className={className} />
  }
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden border border-black/5 bg-white shadow-apple',
        SIZES[size],
        className,
      )}
    >
      <img src={src} alt="" draggable={false} className="size-full object-contain p-[12%]" onError={() => setFailed(true)} />
    </span>
  )
}
