import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface Props {
  models: string[]
  /** 当前选中的模型名 */
  value: string
  onChange: (model: string) => void
}

/** 模型下拉选择器（假数据，仅前端状态） */
export default function ModelSelector({ models, value, onChange }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id="model-selector" variant="ghost" size="sm" className="gap-1 font-medium">
          {value}
          <ChevronDown className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {models.map((m) => (
          <DropdownMenuItem
            key={m}
            onSelect={() => onChange(m)}
            className={m === value ? 'font-semibold' : undefined}
          >
            {m}
            {m === value ? <span className="ml-auto text-xs text-muted-foreground">当前</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
