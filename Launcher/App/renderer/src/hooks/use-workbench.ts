/**
 * useWorkbench —— v2 工作台的编排 Hook（数据全部来自 AgentControlService）。
 * ---------------------------------------------------------------------------
 * UI 不感知 stub/real（factory 唯一切换点）；状态更新走 onStatusChange / onOutput
 * 订阅（真实退订函数，优于 preload 旧设计）。动作全部带 busy 守卫防连点。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAgentControlService } from '@/services/agent-control'
import type { AgentStatus, AgentSummary, OutputEntry, SessionMeta } from '@/services/agent-control-types'
import { toast } from '@/components/ui/toast'
import { copyText } from '@/lib/clipboard'

export type BusyAction = 'start' | 'stop' | 'restart' | null

/** 日志路径的 stub 演示值（真实路径下一轮接线时来自服务层） */
export const STUB_LOG_PATH = '<便携根>/Launcher/Logs/launcher.log（stub 演示）'

export function useWorkbench() {
  const svc = useMemo(() => getAgentControlService(), [])

  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [output, setOutput] = useState<OutputEntry[]>([])
  const [model, setModelState] = useState<string>('')
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState<BusyAction>(null)

  // 订阅回调里用 ref 判断「推送是否属于当前视图」，避免闭包过期
  const currentIdRef = useRef(currentId)
  currentIdRef.current = currentId
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const loadSessions = useCallback(
    async (agentId: string, preferId?: string) => {
      const ss = await svc.listSessions(agentId)
      setSessions(ss)
      const target = preferId && ss.some((s) => s.id === preferId) ? preferId : ss[0]?.id ?? null
      setSessionId(target)
      setOutput(await svc.getOutput(agentId))
      setModelState(await svc.getModel(agentId))
      setModels(await svc.listModels(agentId))
      return target
    },
    [svc],
  )

  // 挂载：拉名单 + 订阅（订阅返回真实退订函数，卸载即清理）
  useEffect(() => {
    let alive = true
    const offStatus = svc.onStatusChange((id, s) => {
      if (!alive) return
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, status: s } : a)))
    })
    const offOutput = svc.onOutput((agentId, entry) => {
      if (!alive) return
      if (agentId !== currentIdRef.current || entry.sessionId !== sessionIdRef.current) return
      setOutput((prev) => {
        const i = prev.findIndex((e) => e.id === entry.id)
        if (i < 0) return [...prev, entry]
        const next = [...prev]
        next[i] = entry
        return next
      })
    })
    void svc.listAgents().then(async (list) => {
      if (!alive || list.length === 0) return
      setAgents(list)
      const first = list[0].id
      setCurrentId(first)
      await loadSessions(first)
      // 13.16 用户裁决：打开软件即开启所有 Agent（stub 走同一 startAgent 调用路径，
      // 真接线轮无需改动本段——服务层切 real 后即真实启动，进程归 pm 管）。
      for (const a of list) void svc.startAgent(a.id).catch(() => {})
    })
    return () => {
      alive = false
      offStatus()
      offOutput()
    }
  }, [svc, loadSessions])

  const current = agents.find((a) => a.id === currentId) ?? null
  const sessionTitle = sessions.find((s) => s.id === sessionId)?.title ?? ''

  // ---- Agent / 会话切换 -----------------------------------------------------
  const switchAgent = useCallback(
    async (id: string) => {
      if (id === currentIdRef.current) return
      setCurrentId(id)
      setOutput([])
      await loadSessions(id)
    },
    [loadSessions],
  )

  const newSession = useCallback(async () => {
    if (!currentId) return
    const meta = await svc.newSession(currentId)
    setSessions((prev) => [meta, ...prev.filter((s) => s.id !== meta.id)])
    setSessionId(meta.id)
    setOutput([])
    toast(`已新建「${meta.title}」`)
  }, [svc, currentId])

  const switchSession = useCallback(
    async (id: string) => {
      if (!currentId || id === sessionIdRef.current) return
      await svc.switchSession(currentId, id)
      setSessionId(id)
      setOutput(await svc.getOutput(currentId))
    },
    [svc, currentId],
  )

  // ---- 会话管理（13.16 对标市面：重命名/置顶/删除） --------------------------
  const renameSession = useCallback(
    async (id: string, title: string) => {
      if (!currentId || !sessionId) return
      const meta = await svc.renameSession(currentId, id, title)
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: meta.title } : s)))
      toast(`已重命名为「${meta.title}」`)
    },
    [svc, currentId, sessionId],
  )

  const deleteSession = useCallback(
    async (id: string) => {
      if (!currentId) return
      await svc.deleteSession(currentId, id)
      const rest = await svc.listSessions(currentId)
      setSessions(rest)
      if (sessionIdRef.current === id) {
        const target = rest[0]?.id ?? null
        setSessionId(target)
        setOutput(target ? await svc.getOutput(currentId) : [])
      }
      toast('已删除会话')
    },
    [svc, currentId],
  )

  const toggleSessionPin = useCallback(
    async (id: string) => {
      if (!currentId) return
      const target = sessions.find((s) => s.id === id)
      if (!target) return
      await svc.pinSession(currentId, id, !target.pinned)
      setSessions(await svc.listSessions(currentId))
      toast(target.pinned ? '已取消置顶' : '已置顶')
    },
    [svc, currentId, sessions],
  )

  // ---- 生命周期（busy 守卫防连点；徽标由 onStatusChange 驱动） ---------------
  const start = useCallback(async () => {
    if (!currentId || busy) return
    setBusy('start')
    try {
      await svc.startAgent(currentId)
    } finally {
      setBusy(null)
    }
  }, [svc, currentId, busy])

  const stop = useCallback(async () => {
    if (!currentId || busy) return
    setBusy('stop')
    try {
      await svc.stopAgent(currentId)
    } finally {
      setBusy(null)
    }
  }, [svc, currentId, busy])

  const restart = useCallback(async () => {
    if (!currentId || busy) return
    setBusy('restart')
    try {
      await svc.restartAgent(currentId)
    } finally {
      setBusy(null)
    }
  }, [svc, currentId, busy])

  const togglePin = useCallback(async () => {
    if (!current) return
    const next = !current.pinned
    await svc.pinAgent(current.id, next)
    setAgents(await svc.listAgents())
  }, [svc, current])

  // ---- 模型切换（13.16）------------------------------------------------------
  const switchModel = useCallback(
    async (m: string) => {
      if (!currentId || m === model) return
      await svc.setModel(currentId, m)
      setModelState(m)
      toast(`已切换到 ${m}（stub）`)
    },
    [svc, currentId, model],
  )

  // ---- 输出工具 -------------------------------------------------------------
  const clear = useCallback(async () => {
    if (!currentId) return
    await svc.clearOutput(currentId)
    setOutput([])
    toast('输出已清空', {
      durationMs: 5000,
      action: {
        label: '撤销',
        onClick: async () => {
          const restored = await svc.undoClearOutput(currentIdRef.current ?? '')
          if (restored) setOutput(restored)
        },
      },
    })
  }, [svc, currentId])

  const copy = useCallback(async () => {
    if (!currentId) return
    const text = await svc.copyOutput(currentId)
    const ok = await copyText(text)
    toast(ok ? '已复制到剪贴板' : '复制失败（剪贴板不可用）')
  }, [svc, currentId])

  const exportSession = useCallback(
    async (format: 'md' | 'json') => {
      if (!currentId || !sessionId) {
        toast('没有可导出的会话')
        return
      }
      const { filename, content } = await svc.exportSession(currentId, sessionId, format)
      const blob = new Blob([content], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      // 实测：1s 后 revoke 会把 Electron 的下载掐死在 .tmp（永不改名）——
      // blob 读取未完成 URL 就失效了。放宽到 30s 保证下载事件走完。
      setTimeout(() => URL.revokeObjectURL(url), 30000)
      toast(`已导出 ${filename}`)
    },
    [svc, currentId, sessionId],
  )

  const openLogs = useCallback(async () => {
    if (!currentId) return
    await svc.openLogs(currentId)
    const ok = await copyText(STUB_LOG_PATH)
    toast(ok ? '日志路径已复制（stub）' : '日志路径复制失败（stub）')
  }, [svc, currentId])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!currentId || !trimmed) return
      // 主流客户端行为：无会话时发消息自动建会话
      let sid = sessionIdRef.current
      if (!sid) {
        const meta = await svc.newSession(currentId)
        setSessions((prev) => [meta, ...prev.filter((s) => s.id !== meta.id)])
        setSessionId(meta.id)
        sid = meta.id
      }
      await svc.sendInput(currentId, trimmed)
    },
    [svc, currentId],
  )

  /** 重新生成（13.16 对标市面）：重发当前会话最后一条用户消息，stub 流式出新回复 */
  const regenerate = useCallback(async () => {
    if (!currentId) return
    const lastUser = [...output].reverse().find((e) => e.kind === 'user')
    if (!lastUser) {
      toast('没有可重新生成的内容')
      return
    }
    await svc.sendInput(currentId, lastUser.text)
  }, [svc, currentId, output])

  return {
    agents, current, sessions, sessionId, sessionTitle, output, busy, model, models,
    switchAgent, newSession, switchSession, renameSession, deleteSession, toggleSessionPin,
    switchModel, regenerate,
    start, stop, restart, togglePin,
    clear, copy, exportSession, openLogs, send,
  }
}

export type Workbench = ReturnType<typeof useWorkbench>
export type { AgentStatus }
