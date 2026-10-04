/**
 * 工作台（规范 §7，13.17 任务书 §八/§九 重构）：
 *   顶部 = 会话名 + ⋯（重命名/导出/清空/删除）——不显示 Agent/Model（身份归顶栏 logo，
 *   模型归输入框右下角）；消息区 = MessageList（消息操作 + 下一步推荐卡）；
 *   底部 = ChatInput（＋/📎/拖拽/模型切换/发送↔停止）。
 * 启停栏已删（13.16），底部 StatusBar 已删（13.17）——整个窗口属于工作区。
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Eraser, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import ChatInput from '@/components/chat/ChatInput'
import MessageList from '@/components/chat/MessageList'
import TransferDialog from '@/components/chat/TransferDialog'
import { getAgentControlService } from '@/services/agent-control'
import type { AgentRecommendation, TransferPayload, TransferResult } from '@/services/agent-control-types'
import type { Workbench } from '@/hooks/use-workbench'

export default function Workbench({ wb }: { wb: Workbench }) {
  const agent = wb.current
  const svc = getAgentControlService()
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  const [armedDelete, setArmedDelete] = useState<boolean>(false)
  const [transferOpen, setTransferOpen] = useState<boolean>(false)
  const [rec, setRec] = useState<AgentRecommendation | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)

  // 最后一条 Agent 回复（完成且非生成中）→ 拉推荐卡数据
  const lastAgentEntry = [...wb.output].reverse().find((e) => e.kind === 'agent')
  const lastAgentId = lastAgentEntry?.id ?? null
  const replyDone = !!lastAgentEntry && !lastAgentEntry.streaming && !wb.generating
  const agentId = agent?.id ?? null
  useEffect(() => {
    let alive = true
    if (!agentId || !replyDone) {
      setRec(null)
      return
    }
    void svc.getRecommendation(agentId).then((r) => { if (alive) setRec(r) }).catch(() => {})
    return () => { alive = false }
  }, [agentId, replyDone, lastAgentId, svc])

  useEffect(() => {
    if (editingTitle !== null) titleRef.current?.focus()
  }, [editingTitle])

  if (!agent) {
    return (
      <section id="workbench" className="flex min-w-0 flex-1 items-center justify-center bg-background">
        <div className="text-[13px] text-muted-foreground">正在加载 Agent…</div>
      </section>
    )
  }

  function commitTitle() {
    if (editingTitle !== null && wb.sessionId && editingTitle.trim()) {
      void wb.renameSession(wb.sessionId, editingTitle)
    }
    setEditingTitle(null)
  }

  async function handleConfirmTransfer(payload: TransferPayload): Promise<TransferResult> {
    const r = await wb.transferTask(payload)
    if (r.ok) toast(r.message)
    return r
  }

  const recTarget = rec ? wb.agents.find((a) => a.id === rec.agentId) : undefined

  return (
    <section id="workbench" className="flex min-w-0 flex-1 flex-col bg-background">
      {/* ===== 工具条：只有会话名 + ⋯（任务书 §八/§九） ===== */}
      <div id="output-toolbar" className="flex shrink-0 items-center gap-2 border-b border-border/70 px-4 py-2">
        {editingTitle !== null ? (
          <input
            id="session-title-input"
            ref={titleRef}
            value={editingTitle}
            aria-label="重命名会话"
            className="h-7 w-64 rounded-md border border-ring bg-card px-2 text-[13px] outline-none"
            onChange={(ev) => setEditingTitle(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') commitTitle()
              if (ev.key === 'Escape') setEditingTitle(null)
            }}
            onBlur={commitTitle}
          />
        ) : (
          <span id="session-title" className="min-w-0 shrink text-[13px] font-medium">{wb.sessionTitle || '新会话'}</span>
        )}
        <div className="ml-auto flex shrink-0 items-center">
          <DropdownMenu onOpenChange={(open) => { if (!open) setArmedDelete(false) }}>
            <DropdownMenuTrigger asChild>
              <Button id="workbench-menu" variant="ghost" size="icon-sm" aria-label="会话菜单" title="会话操作">
                <MoreHorizontal className="size-4" strokeWidth={1.5} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem
                id="workbench-menu-rename"
                disabled={!wb.sessionId}
                onClick={() => setEditingTitle(wb.sessionTitle)}
              >
                <Pencil className="size-3.5" strokeWidth={1.5} aria-hidden />
                重命名会话
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger id="agent-ctrl-export" disabled={!wb.sessionId}>
                  <span className="size-3.5" aria-hidden />
                  导出会话
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-40">
                  <DropdownMenuItem id="agent-ctrl-export-md" onClick={() => void wb.exportSession('md')}>导出为 Markdown</DropdownMenuItem>
                  <DropdownMenuItem id="agent-ctrl-export-json" onClick={() => void wb.exportSession('json')}>导出为 JSON</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem id="agent-ctrl-clear" onClick={() => void wb.clear()}>
                <Eraser className="size-3.5" strokeWidth={1.5} aria-hidden />
                清空会话
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                id="workbench-menu-delete"
                className="text-destructive focus:text-destructive"
                disabled={!wb.sessionId}
                onSelect={(ev) => {
                  if (!armedDelete) {
                    ev.preventDefault()
                    setArmedDelete(true)
                  } else {
                    setArmedDelete(false)
                    if (wb.sessionId) void wb.deleteSession(wb.sessionId)
                  }
                }}
              >
                {armedDelete ? <Check className="size-3.5" strokeWidth={1.5} aria-hidden /> : <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden />}
                {armedDelete ? '再点一次确认删除' : '删除会话'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ===== 消息区 ===== */}
      <div id="output-area" className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        <MessageList
          output={wb.output}
          generating={wb.generating}
          recommendation={rec}
          recommendationTarget={recTarget}
          onOpenTransfer={() => setTransferOpen(true)}
          onRegenerate={() => void wb.regenerate()}
        />
      </div>

      {/* ===== 输入区 ===== */}
      <ChatInput
        agentName={agent.name}
        model={wb.model}
        models={wb.models}
        generating={wb.generating}
        onSwitchModel={(m) => void wb.switchModel(m)}
        onSend={(t) => void wb.send(t)}
        onStop={() => void wb.stopGeneration()}
      />

      {/* ===== 转交弹窗 ===== */}
      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        agents={wb.agents}
        currentAgent={agent}
        recommendationAgentId={rec?.agentId ?? null}
        conversationId={wb.sessionId}
        onConfirm={handleConfirmTransfer}
      />
    </section>
  )
}
