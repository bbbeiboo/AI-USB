/**
 * Agent 运行时状态 Hook（13.12：启停 UI 接线）。
 * ---------------------------------------------------------------------------
 * 数据来源全部是既有通道（零新增 IPC，main.js / preload.js 本轮零改动）：
 *   - 全量对账：getAgentStatuses()（agents:status）
 *   - 增量推送：onAgentStatus()（pm.setStatusHook → agent:status，五态每次跃迁都广播）
 *   - 窗口重新显示：onAgentResync()（main.js win.on('show')）→ 重新全量拉取
 *
 * ⚠️ onAgentStatus / onAgentResync 无法取消订阅（preload 没暴露 removeListener，
 * agent-client.ts 已有书面约定），所以订阅必须模块级只做一次，
 * 回调经由 dispatcher 引用转发给当前挂载的 Hook 实例。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getAgentStatuses,
  onAgentResync,
  onAgentStatus,
  startAgent,
  stopAgent,
} from '@/services/agent-client'
import type { AgentRuntimeStatus, AgentStatusEvent } from '@/types/launcher'

/** 组件层状态视图模型：在 pm 五态之上补一个 UNKNOWN（浏览器直开 / 首拉未完成） */
export type AgentUiStatus = AgentRuntimeStatus | 'UNKNOWN'

export interface AgentRuntimeState {
  status: AgentUiStatus
  pid: number | null
  startedAt: number | null
}

/** 每卡片独立记录动作状态：busy 锁按钮，error 走行内文案（不用 alert） */
export interface AgentActionState {
  busy: 'start' | 'stop' | null
  error: string | null
}

// --- 模块级一次性订阅（StrictMode 双挂载 / 多组件共用都只注册一条监听） --------
let statusSubscribed = false
let resyncSubscribed = false
let statusDispatcher: ((e: AgentStatusEvent) => void) | null = null
let resyncDispatcher: (() => void) | null = null

function ensureSubscriptions() {
  if (!statusSubscribed) {
    statusSubscribed = true
    onAgentStatus((e) => statusDispatcher?.(e))
  }
  if (!resyncSubscribed) {
    resyncSubscribed = true
    onAgentResync(() => resyncDispatcher?.())
  }
}

export function useAgentRuntime(agentIds: readonly string[]) {
  const [states, setStates] = useState<Record<string, AgentRuntimeState>>({})
  const [actions, setActions] = useState<Record<string, AgentActionState>>({})
  const [fetchError, setFetchError] = useState<string | null>(null)

  // agentIds 由调用方传模块级常量；用 ref 兜住，避免 effect 依赖数组身份抖动
  const agentIdsRef = useRef(agentIds)
  agentIdsRef.current = agentIds

  const applyRecord = useCallback(
    (id: string, status: AgentUiStatus, pid: number | null, startedAt: number | null) => {
      setStates((prev) => ({ ...prev, [id]: { status, pid, startedAt } }))
    },
    [],
  )

  /** 全量对账。getAllStatuses 只含被 pm 跟踪过的记录：缺席 = 从未启动 = STOPPED */
  const refresh = useCallback(async () => {
    const r = await getAgentStatuses()
    if (r.ok && r.statuses) {
      setFetchError(null)
      for (const id of agentIdsRef.current) {
        const rec = r.statuses[id]
        applyRecord(id, rec?.status ?? 'STOPPED', rec?.pid ?? null, rec?.startedAt ?? null)
      }
    } else {
      // IPC 不可用（浏览器直开 renderer / preload 未注入）：状态落 UNKNOWN，
      // 失败原因统一在 fetchError 里由控制条呈现（沿用用量页「读取失败」的降级样式）
      setFetchError(r.error || '状态读取失败')
      setStates((prev) => {
        const next = { ...prev }
        for (const id of agentIdsRef.current) next[id] ??= { status: 'UNKNOWN', pid: null, startedAt: null }
        return next
      })
    }
    return r
  }, [applyRecord])

  /** 启动 / 停止：busy 锁按钮 → invoke → 行内错误或清空 → 全量对账补窗口期 */
  const runAction = useCallback(
    async (id: string, kind: 'start' | 'stop') => {
      setActions((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { error: null }), busy: kind } }))
      const r = kind === 'start' ? await startAgent(id) : await stopAgent(id)
      const error = r.ok
        ? null
        : r.reason || r.error || (kind === 'start' ? '启动失败' : '停止失败')
      setActions((prev) => ({ ...prev, [id]: { busy: null, error } }))
      void refresh()
    },
    [refresh],
  )

  // 挂载即拉状态：主界面徽标必须与 agent-state.json 持久化态联动（含 adopt 恢复的 RUNNING）
  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    ensureSubscriptions()
    statusDispatcher = (e) => applyRecord(e.id, e.status, e.pid, e.startedAt)
    resyncDispatcher = () => {
      void refresh()
    }
    // 无法退订（见文件头），卸载只需摘掉转发指针，监听器本身留在模块级
    return () => {
      statusDispatcher = null
      resyncDispatcher = null
    }
  }, [applyRecord, refresh])

  return {
    states,
    actions,
    fetchError,
    refresh,
    start: useCallback((id: string) => runAction(id, 'start'), [runAction]),
    stop: useCallback((id: string) => runAction(id, 'stop'), [runAction]),
  }
}
