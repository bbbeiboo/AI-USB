/**
 * 工作台（规范 §7 主区）：头部（大头像+名称+徽标+生命周期组）→ 输出工具条 →
 * 输出流（stub 驱动，含流式条目）→ 底部输入行。
 */
import { useEffect, useRef, useState } from 'react'
import { Copy, Download, Eraser, FileText, Pin, PinOff, Play, RotateCcw, SendHorizontal, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentLogo } from '@/components/ui/agent-logo'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Workbench } from '@/hooks/use-workbench'
import type { OutputEntry } from '@/services/agent-control-types'
import { cn } from 'cn'

function OutputLine({ e }: { e: OutputEntry }) {
  if (e.kind === 'system') {
    return (
      <div id={`output-entry-${e.id}`} className="animate-in fade-in text-center text-[11px] text-muted-foreground">
        {e.text}
      </div>
    )
  }
  const isUser = e.kind === 'user'
  return (
    <div className={cn('flex animate-in fade-in', isUser ? 'justify-end' : 'justify-start')}>
      <div
        id={`output-entry-${e.id}`}
        className={cn(
          'max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed',
          isUser
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md border border-border/60 bg-card shadow-apple',
          e.streaming ? 'opacity-80' : '',
        )}
      >
        {e.text}
        {e.streaming ? <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-current align-middle" /> : null}
      </div>
    </div>
  )
}

export default function Workbench({ wb }: { wb: Workbench }) {
  const agent = wb.current
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 新输出自动滚底（流式分片也在内）
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [wb.output])

  if (!agent) {
    return (
      <section id="workbench" className="flex min-w-0 flex-1 items-center justify-center bg-background">
        <div className="text-[13px] text-muted-foreground">正在加载 Agent…</div>
      </section>
    )
  }

  const running = agent.status === 'RUNNING' || agent.status === 'STARTING'
  const stopping = agent.status === 'STOPPING' || wb.busy === 'stop' || wb.busy === 'restart'
  const starting = wb.busy === 'start'
  const lifecycleBusy = wb.busy !== null

  return (
    <section id="workbench" className="flex min-w-0 flex-1 flex-col bg-background">
      {/* ===== 头部：当前 Agent 展示（13.15：切换只走顶栏 logo，此处回归纯展示）===== */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border/70 px-4 py-2.5">
        <div id="workbench-agent" className="flex min-w-0 items-center gap-2.5" title={agent.name}>
          <AgentLogo agentId={agent.id} short={agent.short} size="lg" />
          <span className="truncate text-[17px] font-semibold leading-tight">{agent.name}</span>
        </div>
        <StatusBadge id="status-badge" status={agent.status} />
        <div className="ml-auto flex shrink-0 items-center gap-1.5" id="lifecycle-bar">
          {running || stopping ? (
            <Button
              id="agent-ctrl-stop"
              variant="secondary"
              size="sm"
              disabled={wb.busy !== null || agent.status === 'STOPPING'}
              title={wb.busy ? `正在执行 ${wb.busy}…` : '停止当前 Agent'}
              onClick={() => void wb.stop()}
            >
              <Square className="size-4" strokeWidth={1.5} aria-hidden />
              {stopping ? '停止中…' : '停止'}
            </Button>
          ) : (
            <Button
              id="agent-ctrl-start"
              variant="default"
              size="sm"
              disabled={starting}
              title={starting ? '正在启动…' : '启动当前 Agent'}
              onClick={() => void wb.start()}
            >
              <Play className="size-4" strokeWidth={1.5} aria-hidden />
              {starting ? '启动中…' : '启动'}
            </Button>
          )}
          <Button
            id="agent-ctrl-restart"
            variant="outline"
            size="sm"
            disabled={lifecycleBusy || agent.status !== 'RUNNING'}
            title={agent.status !== 'RUNNING' ? '仅运行中的 Agent 可重启' : '重启当前 Agent'}
            onClick={() => void wb.restart()}
          >
            <RotateCcw className="size-4" strokeWidth={1.5} aria-hidden />
            重启
          </Button>
          <Button
            id="agent-ctrl-logs"
            variant="ghost"
            size="icon-sm"
            aria-label="打开日志"
            title="复制日志路径（stub）"
            onClick={() => void wb.openLogs()}
          >
            <FileText className="size-4" strokeWidth={1.5} />
          </Button>
          <Button
            id="agent-ctrl-pin"
            variant="ghost"
            size="icon-sm"
            aria-pressed={agent.pinned}
            aria-label={agent.pinned ? '取消置顶' : '置顶'}
            title={agent.pinned ? '取消置顶' : '置顶该 Agent'}
            onClick={() => void wb.togglePin()}
          >
            {agent.pinned ? <PinOff className="size-4" strokeWidth={1.5} /> : <Pin className="size-4" strokeWidth={1.5} />}
          </Button>
        </div>
      </header>

      {/* ===== 输出工具条 ===== */}
      <div id="output-toolbar" className="flex shrink-0 items-center gap-2 border-b border-border/70 px-4 py-1.5">
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">{wb.sessionTitle}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button id="agent-ctrl-clear" variant="ghost" size="icon-xs" aria-label="清空输出" title="清空输出（5s 内可撤销）" onClick={() => void wb.clear()}>
            <Eraser className="size-3.5" strokeWidth={1.5} />
          </Button>
          <Button id="agent-ctrl-copy" variant="ghost" size="icon-xs" aria-label="复制输出" title="复制输出内容" onClick={() => void wb.copy()}>
            <Copy className="size-3.5" strokeWidth={1.5} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id="agent-ctrl-export" variant="ghost" size="icon-xs" aria-label="导出会话" title="导出会话（md/json）">
                <Download className="size-3.5" strokeWidth={1.5} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem id="agent-ctrl-export-md" onClick={() => void wb.exportSession('md')}>
                导出为 Markdown
              </DropdownMenuItem>
              <DropdownMenuItem id="agent-ctrl-export-json" onClick={() => void wb.exportSession('json')}>
                导出为 JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ===== 输出流 ===== */}
      <div ref={scrollRef} id="output-area" className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {wb.output.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <div className="text-[28px] font-semibold tracking-tight">准备好了</div>
            <div className="text-[13px] text-muted-foreground">发送一条消息开始这个会话</div>
          </div>
        ) : (
          wb.output.map((e) => <OutputLine key={e.id} e={e} />)
        )}
      </div>

      {/* ===== 输入行 ===== */}
      <footer className="flex shrink-0 items-end gap-2 border-t border-border/70 p-3">
        <textarea
          id="input-box"
          rows={1}
          value={draft}
          placeholder={`向 ${agent.name} 发送消息（Enter 发送，Shift+Enter 换行）`}
          aria-label={`向 ${agent.name} 发送消息`}
          className="min-h-[38px] flex-1 resize-none rounded-xl border border-border bg-card px-3 py-2 text-[15px] outline-none transition-all duration-150 ease-out placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault()
              const text = draft
              setDraft('')
              void wb.send(text)
            }
          }}
        />
        <Button
          id="agent-ctrl-send"
          variant="default"
          size="icon"
          className="size-[38px] rounded-xl"
          disabled={draft.trim().length === 0}
          title={draft.trim() ? '发送' : '输入内容后可发送'}
          aria-label="发送"
          onClick={() => {
            const text = draft
            setDraft('')
            void wb.send(text)
          }}
        >
          <SendHorizontal className="size-4" strokeWidth={1.5} />
        </Button>
      </footer>
    </section>
  )
}
