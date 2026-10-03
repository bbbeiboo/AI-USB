import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** 侧栏顶部的新建会话按钮 */
export default function NewChatButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      id="new-chat-btn"
      variant="default"
      className="w-full justify-start gap-2"
      onClick={onClick}
    >
      <Plus className="size-4" />
      新建会话
    </Button>
  )
}
