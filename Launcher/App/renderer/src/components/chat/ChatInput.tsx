/**
 * ChatInput（13.17 任务书 §十三~§十六）：整个软件最重要的交互区域。
 * ---------------------------------------------------------------------------
 * 结构（任务书定死的布局）：
 *   ┌─────────────────────────────────────────────┐
 *   │ 输入任务……                                   │
 *   │ ＋  📎                        [Model ▼]  ↑  │
 *   └─────────────────────────────────────────────┘
 * - ＋ 菜单：上传文件/上传文件夹/添加图片/添加代码（本阶段 stub 反馈，不真正上传）
 * - 📎 与拖拽：预留 dragenter/dragover/drop 接口，drop 的文件登记为内存附件 chips
 *   （stub：不读取内容、不落盘；真实文件管线接线轮接入）
 * - 模型切换：位于输入框右下角（13.17 从工具条迁入）
 * - 发送 ↑ ⇄ 停止 ■：生成中变为停止按钮（任务书 §十六）
 */
import { useRef, useState } from 'react'
import {
  ArrowUp, ChevronDown, Code, FolderUp, Image as ImageIcon, Paperclip, Plus, Square, Upload, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { cn } from 'cn'

/** 内存附件（stub：只登记名字与大小，不读取内容） */
interface Attachment {
  id: string
  name: string
  sizeBytes: number
}

interface Props {
  agentName: string
  model: string
  models: string[]
  generating: boolean
  onSwitchModel: (m: string) => void
  onSend: (text: string) => void
  onStop: () => void
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${bytes} B`
}

let attachSeq = 0

export default function ChatInput({ agentName, model, models, generating, onSwitchModel, onSend, onStop }: Props) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  /** drop / 菜单的统一入口：登记为内存附件（stub，不读内容不落盘） */
  function addFiles(list: Array<{ name: string; size: number }>) {
    if (list.length === 0) return
    setAttachments((prev) => [
      ...prev,
      ...list.map((f) => ({ id: `att-${Date.now().toString(36)}-${attachSeq++}`, name: f.name, sizeBytes: f.size })),
    ])
  }

  function submit() {
    const text = draft.trim()
    if (!text || generating) return
    const n = attachments.length
    setDraft('')
    setAttachments([])
    onSend(text)
    if (n > 0) toast(`已附加 ${n} 个文件（stub：真实上传在接线轮随消息发送）`)
  }

  const plusItems: Array<[string, string, typeof Upload]> = [
    ['上传文件', 'chat-add-file', Upload],
    ['上传文件夹', 'chat-add-folder', FolderUp],
    ['添加图片', 'chat-add-image', ImageIcon],
    ['添加代码', 'chat-add-code', Code],
  ]

  return (
    <footer className="shrink-0 p-3">
      <div
        className={cn(
          'rounded-2xl border border-border bg-card shadow-apple transition-all duration-150 ease-out focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
          dragOver && 'border-ring bg-accent/40 ring-[3px] ring-ring/50',
        )}
        onDragOver={(ev) => {
          // 任务书 §十四：dragenter/dragover/drop 接口预留
          ev.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(ev) => {
          ev.preventDefault()
          setDragOver(false)
          const picked = Array.from(ev.dataTransfer.files ?? []).map((f) => ({ name: f.name, size: f.size }))
          addFiles(picked)
        }}
      >
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachments.map((a) => (
              <span
                key={a.id}
                id={`attachment-chip-${a.id}`}
                className="flex items-center gap-1 rounded-md border border-border/60 bg-accent/60 px-1.5 py-0.5 text-[11px]"
              >
                <Paperclip className="size-3 shrink-0 opacity-60" strokeWidth={1.5} aria-hidden />
                <span className="max-w-[160px] truncate">{a.name}</span>
                <span className="text-muted-foreground">{fmtSize(a.sizeBytes)}</span>
                <button
                  aria-label={`移除附件 ${a.name}`}
                  className="rounded p-0.5 transition-colors duration-150 ease-out hover:bg-accent"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                >
                  <X className="size-3" strokeWidth={1.5} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          id="input-box"
          ref={inputRef}
          rows={1}
          value={draft}
          placeholder="输入任务……"
          aria-label={`向 ${agentName} 发送任务`}
          className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3.5 py-2.5 text-[15px] outline-none placeholder:text-muted-foreground/70"
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault()
              submit()
            }
          }}
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5">
          {/* ＋：操作菜单（任务书 §十四） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id="chat-add" variant="ghost" size="icon-sm" aria-label="添加内容" title="上传文件 / 图片 / 代码">
                <Plus className="size-4" strokeWidth={1.5} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-36">
              {plusItems.map(([label, aid, Icon]) => (
                <DropdownMenuItem
                  key={label}
                  id={aid}
                  onClick={() => toast(`${label}（stub：真实文件选择在接线轮接入）`)}
                >
                  <Icon className="size-3.5" strokeWidth={1.5} aria-hidden />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* 📎：文件选择入口（stub 反馈；拖拽已可用） */}
          <Button
            id="chat-attach"
            variant="ghost"
            size="icon-sm"
            aria-label="附加文件"
            title="附加文件（也可直接拖入）"
            onClick={() => toast('附加文件（stub：拖拽文件到输入框可演示登记）')}
          >
            <Paperclip className="size-4" strokeWidth={1.5} />
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            {/* 模型切换：输入框右下角（任务书 §十五） */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  id="model-selector"
                  className="flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent"
                  title="切换模型（stub 演示清单）"
                  aria-label={`当前模型：${model}，点击切换`}
                >
                  <span className="max-w-[160px] truncate">{model}</span>
                  <ChevronDown className="size-3 shrink-0 opacity-60" strokeWidth={1.5} aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                {models.map((m) => (
                  <DropdownMenuItem
                    key={m}
                    id={`model-selector-item-${m}`}
                    className={cn('text-[12px]', m === model && 'bg-accent/70 font-medium')}
                    onClick={() => onSwitchModel(m)}
                  >
                    {m}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* 发送 ↑ ⇄ 停止 ■（任务书 §十六） */}
            {generating ? (
              <Button
                id="agent-ctrl-stop"
                variant="default"
                size="icon"
                className="size-[34px] rounded-xl"
                aria-label="停止生成"
                title="停止生成"
                onClick={onStop}
              >
                <Square className="size-3.5 fill-current" strokeWidth={1.5} />
              </Button>
            ) : (
              <Button
                id="agent-ctrl-send"
                variant="default"
                size="icon"
                className="size-[34px] rounded-xl"
                disabled={draft.trim().length === 0}
                title={draft.trim() ? '发送' : '输入内容后可发送'}
                aria-label="发送"
                onClick={submit}
              >
                <ArrowUp className="size-4" strokeWidth={1.5} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </footer>
  )
}
