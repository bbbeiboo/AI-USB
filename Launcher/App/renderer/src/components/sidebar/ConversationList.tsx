import type { Conversation } from '@/data/mock-data'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface Props {
  conversations: Conversation[]
  /** 当前高亮的会话 id */
  selectedId: string | null
  onSelect: (id: string) => void
}

/** 会话历史列表：按 group（今天 / 昨天 / 更早）分组渲染，点击切换高亮 */
export default function ConversationList({ conversations, selectedId, onSelect }: Props) {
  // 保序分组：不能直接用对象，否则分组顺序会随插入顺序漂移
  const groups: string[] = []
  for (const c of conversations) {
    if (!groups.includes(c.group)) groups.push(c.group)
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-2 pb-2">
        {groups.map((g) => (
          <div key={g} className="mb-3">
            {/* 分组标题 */}
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{g}</div>
            <ul>
              {conversations
                .filter((c) => c.group === g)
                .map((c) => {
                  const active = c.id === selectedId
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        className={cn(
                          'w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                          'hover:bg-accent hover:text-accent-foreground',
                          active && 'bg-accent font-medium text-accent-foreground',
                        )}
                        title={c.title}
                      >
                        · {c.title}
                      </button>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
