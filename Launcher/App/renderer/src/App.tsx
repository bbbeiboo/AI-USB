import { useEffect, useRef, useState } from 'react'
import {
  AGENTS,
  MODELS,
  CONVERSATIONS,
  INITIAL_MESSAGES,
  nextId,
  type ChatMessage,
  type Conversation,
} from '@/data/mock-data'
import ConversationList from '@/components/sidebar/ConversationList'
import NewChatButton from '@/components/sidebar/NewChatButton'
import AgentSelector from '@/components/topbar/AgentSelector'
import ModelSelector from '@/components/topbar/ModelSelector'
import SettingsButton from '@/components/topbar/SettingsButton'
import MessageList from '@/components/chat/MessageList'
import ChatInput from '@/components/chat/ChatInput'
import SettingsModal from '@/components/settings/SettingsModal'

/** 假 AI 回复文本：用于演示"逐字追加"的流式效果（不连接任何 IPC） */
function fakeReply(input: string): string {
  return `收到：「${input}」。这是前端假回复（未连接 IPC），用来验证消息区渲染、自动滚动与逐字追加效果。`
}

/**
 * 三栏布局骨架（假数据）：
 *   ┌──────────┬────────────────────────────┐
 *   │ 新建会话  │ Agent ▼  模型 ▼         ⚙  │
 *   │ 会话列表  ├────────────────────────────┤
 *   │          │ 消息区（自动滚动）           │
 *   │ [设置]    ├────────────────────────────┤
 *   │          │ 输入框                [发送] │
 *   └──────────┴────────────────────────────┘
 */
export default function App() {
  // 全部为前端状态；接入 IPC 时只需替换这些状态的来源
  const [agentId, setAgentId] = useState(AGENTS[0].id)
  const [model, setModel] = useState(MODELS[0])
  const [conversations, setConversations] = useState<Conversation[]>(CONVERSATIONS)
  const [selectedConvId, setSelectedConvId] = useState<string | null>(CONVERSATIONS[0]?.id ?? null)
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  /*
   * 设置弹窗开关。
   * 为什么放在 App 根节点：两处入口（顶栏 ⚙ 与侧栏「设置」）分属不同子树，
   * 只有共同祖先能同时驱动它们，避免各挂各的弹窗实例。
   * 初始 false —— 启动阶段不发任何 IPC（约束 7：打开时才拉数据）。
   */
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)

  // 持有流式定时器句柄：组件卸载时必须清理，否则会在已卸载组件上 setState
  const timerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    }
  }, [])

  function stopStream() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  /** 发送：先追加一条用户消息，再逐字追加一条假 AI 回复 */
  function handleSend(text: string) {
    stopStream() // 上一次回复还没流完就直接接管，避免两条回复交错追加
    const assistantId = nextId('a')
    const full = fakeReply(text)
    setMessages((prev) => [
      ...prev,
      { id: nextId('u'), role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '' },
    ])

    let shown = 0
    timerRef.current = window.setInterval(() => {
      shown += 2 // 每帧 2 个字，接近真实流式观感
      const slice = full.slice(0, shown)
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: slice } : m)))
      if (shown >= full.length) stopStream()
    }, 40)
  }

  /** 新建会话：插入一条"今天"分组的假会话并选中 */
  function handleNewChat() {
    const id = nextId('c')
    setConversations((prev) => [{ id, title: `新会话 ${id}`, group: '今天' }, ...prev])
    setSelectedConvId(id)
    setMessages([])
  }

  /** 点击会话：仅切换高亮（假数据阶段不做按会话存储） */
  function handleSelectConversation(id: string) {
    setSelectedConvId(id)
    setMessages(INITIAL_MESSAGES)
  }

  return (
    // 外层 flex 定宽 + h-screen + overflow-hidden：窗口缩放时布局不塌
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* ===== 左侧栏：固定 260px ===== */}
      <aside className="flex h-screen w-[260px] shrink-0 flex-col border-r border-border bg-muted/30">
        <div className="p-3">
          <NewChatButton onClick={handleNewChat} />
        </div>
        {/* min-h-0 必不可少：否则 flex 子项不会收缩，ScrollArea 滚不起来 */}
        <ConversationList
          conversations={conversations}
          selectedId={selectedConvId}
          onSelect={handleSelectConversation}
        />
        <div className="border-t border-border p-3">
          <SettingsButton showLabel onClick={() => setSettingsOpen(true)} />
        </div>
      </aside>

      {/* ===== 右侧主区：顶部栏 + 消息区 + 输入区 ===== */}
      <main className="flex h-screen min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-3">
          <AgentSelector agents={AGENTS} value={agentId} onChange={setAgentId} />
          <ModelSelector models={MODELS} value={model} onChange={setModel} />
          <div className="ml-auto">
            <SettingsButton onClick={() => setSettingsOpen(true)} />
          </div>
        </header>

        {/* flex-1 + min-h-0：让内部 MessageList 的 overflow-y-auto 真正生效 */}
        <section className="min-h-0 flex-1 bg-background">
          <MessageList messages={messages} />
        </section>

        <footer className="shrink-0 border-t border-border p-3">
          <ChatInput onSend={handleSend} />
        </footer>
      </main>

      {/*
        ===== 设置弹窗（4.1.4 接线） =====
        挂在根节点、三栏布局之后：组件内部是 fixed inset-0，完全脱离文档流，
        不参与 aside / main 的 flex 排布（约束 6）。
        根 div 的 overflow-hidden 不会裁剪它 —— overflow 只作用于非 fixed 后代，
        除非祖先自带 transform / filter / contain 建了新的包含块，本层没有这些属性。
        未打开时组件直接 return null，DOM 里不留空壳。
      */}
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
