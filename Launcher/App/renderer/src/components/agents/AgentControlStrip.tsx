/**
 * Agent 控制条（13.12：启停 UI 接线 —— 关闭 13.6 清单第 2/3 条的产品缺口）。
 * ---------------------------------------------------------------------------
 * 顶栏下方 4 张迷你卡片：名称 + 状态徽标 + PID + 启动/停止按钮 + 动作错误行。
 * 展示层级参照 VS Code ps.ts 的思路（MIT，只读参考）：友好名为主、PID 作次级
 * 元数据、命令行不上 UI。数据全部来自 useAgentRuntime()（零新增 IPC 通道）。
 * 浏览器直开 renderer/dist 时优雅降级：徽标 UNKNOWN + 错误行可读文案，不白屏。
 */
import { Loader2, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AGENTS } from '@/data/mock-data'
import { useAgentRuntime, type AgentUiStatus } from '@/hooks/useAgentRuntime'

/** 与 AgentSelector 同源的名单（id 与 agents.json 一致），不引第二份 */
const AGENT_IDS = AGENTS.map((a) => a.id)

/** 徽标文案与配色（pm 五态 + UNKNOWN）；色点装饰、文字承载语义 */
const STATUS_META: Record<AgentUiStatus, { label: string; dot: string; text: string }> = {
  RUNNING: { label: '运行中', dot: 'bg-emerald-500', text: 'text-emerald-600' },
  STARTING: { label: '启动中', dot: 'bg-amber-500', text: 'text-amber-600' },
  STOPPING: { label: '停止中', dot: 'bg-amber-500', text: 'text-amber-600' },
  STOPPED: { label: '已停止', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  ERROR: { label: '异常', dot: 'bg-destructive', text: 'text-destructive' },
  UNKNOWN: { label: '未知', dot: 'bg-muted-foreground/30', text: 'text-muted-foreground/70' },
}

export default function AgentControlStrip() {
  const { states, actions, fetchError, start, stop } = useAgentRuntime(AGENT_IDS)

  return (
    <section id="agent-strip" aria-label="Agent 运行控制" className="flex shrink-0 flex-wrap gap-2 border-b border-border px-3 py-2">
      {fetchError ? (
        <p id="agent-strip-error" className="w-full text-xs text-destructive">
          Agent 状态读取失败：{fetchError}（启动/停止不可用）
        </p>
      ) : null}
      {AGENTS.map((a) => {
        const st = states[a.id]?.status ?? 'UNKNOWN'
        const pid = states[a.id]?.pid ?? null
        const busy = actions[a.id]?.busy ?? null
        const actionError = actions[a.id]?.error ?? null
        const meta = STATUS_META[st]
        const runningLike = st === 'RUNNING' || st === 'STARTING'
        // STOPPING 期间 pm 正在 tree-kill：按钮转「停止中…」禁用态
        const stopping = st === 'STOPPING' || busy === 'stop'
        const starting = busy === 'start'

        return (
          <div
            key={a.id}
            id={`agent-card-${a.id}`}
            className="min-w-[200px] flex-1 rounded-md border border-border bg-muted/20 px-2.5 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{a.name}</span>
              <span id={`agent-badge-${a.id}`} className={`ml-auto inline-flex shrink-0 items-center gap-1 text-xs ${meta.text}`}>
                <span aria-hidden className={`size-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
              </span>
            </div>
            {/* PID 作次级元数据；占位保持三行等高，卡片不因有无 PID 而跳动 */}
            <div className="mt-0.5 text-xs text-muted-foreground">{pid ? `PID ${pid}` : '\u00A0'}</div>
            <div className="mt-1.5 flex items-center gap-1.5">
              {runningLike || stopping ? (
                <Button
                  id={`agent-ctrl-stop-${a.id}`}
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={busy !== null || st === 'STOPPING'}
                  onClick={() => void stop(a.id)}
                >
                  {stopping ? <Loader2 aria-hidden className="size-3 animate-spin" /> : <Square aria-hidden className="size-3" />}
                  {stopping ? '停止中…' : '停止'}
                </Button>
              ) : (
                <Button
                  id={`agent-ctrl-start-${a.id}`}
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={starting}
                  onClick={() => void start(a.id)}
                >
                  {starting ? <Loader2 aria-hidden className="size-3 animate-spin" /> : <Play aria-hidden className="size-3" />}
                  {starting ? '启动中…' : '启动'}
                </Button>
              )}
            </div>
            {(actionError || st === 'ERROR') && (
              <p
                id={`agent-err-${a.id}`}
                title={actionError ?? undefined}
                className="mt-1.5 line-clamp-2 text-xs text-destructive"
              >
                {actionError ?? '进程异常退出，可尝试重新启动'}
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}
