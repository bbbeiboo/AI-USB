/**
 * 状态徽标（规范 §4）：8px 圆点 + 11px 文字，颜色走状态语义令牌，
 * 颜色变化 200ms 过渡。AutomationId 由调用方传入（如 status-badge）。
 */
import { cn } from 'cn'
import type { AgentStatus } from '@/services/agent-control-types'

export const STATUS_META: Record<AgentStatus, { label: string; dot: string; text: string }> = {
  RUNNING: { label: '运行中', dot: 'bg-status-running', text: 'text-status-running' },
  STARTING: { label: '启动中', dot: 'bg-status-starting', text: 'text-status-starting' },
  STOPPING: { label: '停止中', dot: 'bg-status-starting', text: 'text-status-starting' },
  STOPPED: { label: '已停止', dot: 'bg-status-stopped', text: 'text-status-stopped' },
  ERROR: { label: '异常', dot: 'bg-status-error', text: 'text-status-error' },
}

/** 仅圆点（侧栏列表/切换器菜单用） */
export function StatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  return (
    <span
      aria-label={STATUS_META[status].label}
      className={cn('size-2 shrink-0 rounded-full transition-colors duration-200', STATUS_META[status].dot, className)}
    />
  )
}

/** 圆点 + 文字（工作台头部用） */
export function StatusBadge({ status, id }: { status: AgentStatus; id?: string }) {
  const meta = STATUS_META[status]
  return (
    <span id={id} className={cn('inline-flex items-center gap-1.5 text-[11px]', meta.text)}>
      <span aria-hidden className={cn('size-2 rounded-full transition-colors duration-200', meta.dot)} />
      {meta.label}
    </span>
  )
}
