import type { ChatMessage } from '@/data/mock-data'
import { cn } from '@/lib/utils'

/** 单条消息气泡：用户右对齐（primary 底色），AI 左对齐（muted 底色） */
export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        data-role={message.role}
        className={cn(
          // whitespace-pre-wrap 保留换行；break-words 防止长串撑破气泡
          'max-w-[70%] rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {/* 流式追加时内容可能暂时为空，用一个省略号占位避免气泡塌陷 */}
        {message.content || '…'}
      </div>
    </div>
  )
}
