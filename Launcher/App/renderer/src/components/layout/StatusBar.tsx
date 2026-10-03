/**
 * 状态栏（规范 §7，13.16 更新）：Agent 状态 + baseUrl 摘要 + 右侧日志入口 + 模式标识。
 * 工作台头部启停栏删除后，日志路径复制（原 agent-ctrl-logs）迁移至此（应用级工具）。
 */
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { STATUS_META } from '@/components/ui/status-badge'
import type { AgentSummary } from '@/services/agent-control-types'

interface Props {
  agent: AgentSummary | null
  onOpenLogs: () => void
}

export default function StatusBar({ agent, onOpenLogs }: Props) {
  return (
    <footer id="status-bar" className="glass flex h-7 shrink-0 items-center gap-3 border-t border-border/70 px-4 text-[11px] text-muted-foreground">
      <span id="status-bar-agent">
        {agent ? `${agent.name} · ${STATUS_META[agent.status].label}` : '未选择 Agent'}
      </span>
      <span id="status-bar-url" className="min-w-0 truncate">
        {agent ? agent.baseUrl : ''}
      </span>
      <span className="ml-auto shrink-0">stub 演示模式</span>
      <Button id="app-open-logs" variant="ghost" size="icon-xs" aria-label="打开日志" title="复制日志路径（stub）" onClick={() => void onOpenLogs()}>
        <FileText className="size-3" strokeWidth={1.5} />
      </Button>
    </footer>
  )
}
