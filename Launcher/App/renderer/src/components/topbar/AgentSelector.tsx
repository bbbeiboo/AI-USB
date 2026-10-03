import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AgentOption } from '@/data/mock-data'

interface Props {
  agents: AgentOption[]
  /** 当前选中的 agent id */
  value: string
  onChange: (id: string) => void
}

/** Agent 下拉选择器（假数据，仅前端状态） */
export default function AgentSelector({ agents, value, onChange }: Props) {
  const current = agents.find((a) => a.id === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id="agent-selector" variant="ghost" size="sm" className="gap-1 font-medium">
          {current ? current.name : '选择 Agent'}
          <ChevronDown className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        {agents.map((a) => (
          <DropdownMenuItem
            key={a.id}
            onSelect={() => onChange(a.id)}
            // 选中项加粗 + 标记，方便肉眼确认切换生效
            className={a.id === value ? 'font-semibold' : undefined}
          >
            {a.name}
            {a.id === value ? <span className="ml-auto text-xs text-muted-foreground">当前</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
