/**
 * 状态栏（规范 §7）：Agent 状态 + baseUrl 摘要 + 右侧模式标识。
 */
import { STATUS_META } from '@/components/ui/status-badge'
import type { AgentSummary } from '@/services/agent-control-types'

export default function StatusBar({ agent }: { agent: AgentSummary | null }) {
  return (
    <footer id="status-bar" className="glass flex h-7 shrink-0 items-center gap-3 border-t border-border/70 px-4 text-[11px] text-muted-foreground">
      <span id="status-bar-agent">
        {agent ? `${agent.name} · ${STATUS_META[agent.status].label}` : '未选择 Agent'}
      </span>
      <span id="status-bar-url" className="min-w-0 truncate">
        {agent ? agent.baseUrl : ''}
      </span>
      <span className="ml-auto shrink-0">stub 演示模式</span>
    </footer>
  )
}
