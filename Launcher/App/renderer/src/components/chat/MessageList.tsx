import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@/data/mock-data'
import MessageBubble from './MessageBubble'

/** 消息列表容器：负责滚动与间距，新消息到达时自动滚到底部 */
export default function MessageList({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // messages 每次变化（含流式逐字追加）都会滚到底部，保证最新内容始终可见
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  return (
    <div id="message-list" className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {/* 滚动锚点 */}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
