import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  onSend: (text: string) => void
  disabled?: boolean
}

/** 底部输入区：多行自适应 textarea + 发送按钮，Enter 发送 / Shift+Enter 换行 */
export default function ChatInput({ onSend, disabled = false }: Props) {
  const [value, setValue] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  // 多行自适应高度：先把高度归零以便 scrollHeight 反映真实内容，再撑开（上限 160px）
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])

  function submit() {
    const text = value.trim()
    if (!text || disabled) return
    onSend(text)
    setValue('')
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
      <textarea
        id="chat-input"
        ref={taRef}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Enter 发送、Shift+Enter 换行；
          // isComposing 为真表示正处于输入法组词状态（中文候选），此时不发送
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="输入消息，Enter 发送，Shift+Enter 换行"
        className={cn(
          'max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm',
          'outline-none placeholder:text-muted-foreground',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        )}
      />
      <Button
        id="send-btn"
        onClick={submit}
        disabled={disabled || value.trim().length === 0}
        className="h-11 gap-1.5 px-4"
      >
        <Send className="size-4" />
        发送
      </Button>
    </div>
  )
}
