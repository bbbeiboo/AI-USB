/**
 * 混合服务（13.22）：stub 全量体验 + Hermes 真实会话链路。
 * ---------------------------------------------------------------------------
 * 架构裁决：Hermes 原生会话（state.db）= Source of Truth。本服务只做三件事：
 *   1. hermes 的会话操作经官方 ACP 通道（preload → 主进程网关）驱动真实 Agent；
 *   2. 把原生 AgentEvent 流翻译为既有 OutputEntry 渲染（UI 零改动）；
 *   3. 其余 Agent / 其余能力全部回落 inner（stub），绝不伪造「已接线」。
 *
 * 真实错误原样上抛（AgentError 语义）；真实失败不产生假回复。
 * 索引（pinned/展示名/归档/orphaned）来自主进程 session-index.json（任务书 §二）。
 */
import type {
  AgentControlService,
  AgentEvent,
  ArchivedSession,
  OutputEntry,
  SessionMeta,
} from './agent-control-types.ts'
import type { LauncherApi } from '@/types/launcher.d.ts'

const HERMES = 'hermes'

function hsError(code: string, message: string): Error {
  const e = new Error(message) as Error & { code: string; agentId: string }
  e.code = code
  e.agentId = HERMES
  return e
}

function toHsError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)
  const m = /provider.*credentials|api key|authentication|401/i.test(msg) ? 'provider-auth'
    : /not found|unknown session/i.test(msg) ? 'session-not-found'
    : /ECONNREFUSED|ENOENT|spawn|cannot find/i.test(msg) ? 'offline'
    : /timeout|timed out/i.test(msg) ? 'timeout'
    : 'protocol'
  return hsError(m, msg)
}

/** 事件→条目的流式条目 id 前缀（同 id 原位增长 = 打字机） */
interface HermesTurnState {
  /** 正在流式生长的条目（按 messageId 分组；text/thinking 各一条） */
  textEntryId: string | null
  thinkEntryId: string | null
}

export function createHybridAgentControlService(
  inner: AgentControlService,
  bridge: LauncherApi,
): AgentControlService {
  /** 会话元数据缓存（nativeSessionId → SessionMeta；listSessions 时重建） */
  const metas = new Map<string, SessionMeta>()
  /** 转录缓存（nativeSessionId → 条目；本应用运行期 + load 重放历史） */
  const transcripts = new Map<string, OutputEntry[]>()
  const currentSession = new Map<string, string>()
  const turns = new Map<string, HermesTurnState>()
  let entrySeq = 0
  const nextId = () => `hs-${Date.now().toString(36)}-${(entrySeq++).toString(36)}`
  /** 事件订阅回调集（复用 AgentControlService.onOutput 的语义） */
  const outputCbs = new Set<(id: string, entry: OutputEntry) => void>()

  function transcriptOf(nativeSessionId: string): OutputEntry[] {
    let t = transcripts.get(nativeSessionId)
    if (!t) {
      t = []
      transcripts.set(nativeSessionId, t)
    }
    return t
  }

  function pushEntry(nativeSessionId: string, entry: OutputEntry) {
    transcriptOf(nativeSessionId).push(entry)
    for (const cb of outputCbs) {
      try { cb(HERMES, entry) } catch (_) { /* 单监听器异常不扩散 */ }
    }
  }

  /** 流式条目按 id 原位更新后重发（与 stub updateEntry 同语义） */
  function updateEntry(nativeSessionId: string, entry: OutputEntry) {
    const arr = transcriptOf(nativeSessionId)
    const i = arr.findIndex((x) => x.id === entry.id)
    if (i >= 0) arr[i] = entry
    else arr.push(entry)
    for (const cb of outputCbs) {
      try { cb(HERMES, entry) } catch (_) {}
    }
  }

  function metaToSessionMeta(row: {
    nativeSessionId: string
    title?: string
    pinned?: boolean
    orphaned?: boolean
    lastSeen?: number
  }): SessionMeta {
    const ts = row.lastSeen ?? Date.now()
    return {
      id: row.nativeSessionId,
      agentId: HERMES,
      title: row.title || '（未命名）',
      createdAt: ts,
      updatedAt: ts,
      pinned: !!row.pinned,
      nativeSessionId: row.nativeSessionId,
      orphaned: row.orphaned || undefined,
    }
  }

  // —— 原生事件 → OutputEntry（UI 零改动的关键翻译层；订阅与历史重放共用）——
  bridge.onHermesSessionEvent(({ nativeSessionId, event }) => {
    handleNativeEvent(nativeSessionId, event as AgentEvent)
  })

  function handleNativeEvent(nativeSessionId: string, ev: AgentEvent) {
    const turn = turns.get(nativeSessionId) ?? { textEntryId: null, thinkEntryId: null }
    turns.set(nativeSessionId, turn)
    switch (ev.type) {
      case 'message_start':
        turn.textEntryId = null
        break
      case 'text_delta': {
        if (!turn.textEntryId) {
          turn.textEntryId = nextId()
          pushEntry(nativeSessionId, { id: turn.textEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'agent', text: ev.text, streaming: true })
        } else {
          const arr = transcriptOf(nativeSessionId)
          const cur = arr.find((x) => x.id === turn.textEntryId)
          updateEntry(nativeSessionId, { id: turn.textEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'agent', text: (cur?.text ?? '') + ev.text, streaming: true })
        }
        break
      }
      case 'thinking': {
        if (!turn.thinkEntryId) {
          turn.thinkEntryId = nextId()
          pushEntry(nativeSessionId, { id: turn.thinkEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `💭 ${ev.text}`, streaming: true })
        } else {
          const arr = transcriptOf(nativeSessionId)
          const cur = arr.find((x) => x.id === turn.thinkEntryId)
          updateEntry(nativeSessionId, { id: turn.thinkEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `💭 ${(cur?.text ?? '').replace(/^💭 /, '')}${ev.text}`, streaming: true })
        }
        break
      }
      case 'tool_start':
        pushEntry(nativeSessionId, { id: nextId(), sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `🔧 工具调用：${ev.name}` })
        break
      case 'tool_result':
        pushEntry(nativeSessionId, { id: nextId(), sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `🔧 工具完成：${ev.name}${ev.summary ? `（${ev.summary}）` : ''}` })
        break
      case 'user_message':
        // 历史重放专用（session/load）
        pushEntry(nativeSessionId, { id: nextId(), sessionId: nativeSessionId, ts: Date.now(), kind: 'user', text: ev.text })
        break
      case 'session_info':
        bridge.hermesIndexUpdate({ nativeSessionId, patch: { title: ev.title } }).catch(() => {})
        {
          const m = metas.get(nativeSessionId)
          if (m && ev.title) {
            m.title = ev.title
            metas.set(nativeSessionId, m)
          }
        }
        break
      case 'error':
        // 回合内真实错误：终止流式条目 + 显式错误条目（禁止假完成）
        if (turn.textEntryId) {
          updateEntry(nativeSessionId, { id: turn.textEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'agent', text: transcriptOf(nativeSessionId).find((x) => x.id === turn.textEntryId)?.text ?? '', streaming: false })
          turn.textEntryId = null
        }
        pushEntry(nativeSessionId, { id: nextId(), sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `⚠ 出错（${ev.code ?? 'protocol'}）：${ev.message}` })
        break
      case 'message_end':
        if (turn.textEntryId) {
          updateEntry(nativeSessionId, { id: turn.textEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'agent', text: transcriptOf(nativeSessionId).find((x) => x.id === turn.textEntryId)?.text ?? '', streaming: false })
        }
        if (ev.stopReason === 'cancelled') {
          pushEntry(nativeSessionId, { id: nextId(), sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: '（已停止生成）' })
        }
        turns.delete(nativeSessionId)
        break
      default:
        break
    }
  }

  // —— hermes 覆盖方法（真实链路）———————————————————————————————————
  async function listSessions(id: string): Promise<SessionMeta[]> {
    if (id !== HERMES) return inner.listSessions(id)
    const r = await bridge.hermesSessionList()
    if (!r.ok) throw toHsError(new Error(r.error || 'hermes session list failed'))
    const rows = r.sessions ?? []
    const metasList = rows.map(metaToSessionMeta)
    for (const m of metasList) metas.set(m.nativeSessionId!, m)
    // 置顶优先（与 stub 排序语义一致）
    return metasList.filter((m) => m.pinned).concat(metasList.filter((m) => !m.pinned))
  }

  async function newSession(id: string): Promise<SessionMeta> {
    if (id !== HERMES) return inner.newSession(id)
    const r = await bridge.hermesSessionCreate({})
    if (!r.ok || !r.session) throw toHsError(new Error(r.error || 'hermes session create failed'))
    const rs = r.session as { agentId: string; nativeSessionId: string; title?: string }
    const meta: SessionMeta = {
      id: rs.nativeSessionId,
      agentId: HERMES,
      title: rs.title || '新会话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      nativeSessionId: rs.nativeSessionId,
    }
    metas.set(rs.nativeSessionId, meta)
    transcripts.set(rs.nativeSessionId, [])
    currentSession.set(HERMES, rs.nativeSessionId)
    return meta
  }

  async function switchSession(id: string, sessionId: string): Promise<SessionMeta> {
    if (id !== HERMES) return inner.switchSession(id, sessionId)
    currentSession.set(HERMES, sessionId)
    // 打开会话：官方 session/load 重放历史（异步回填转录缓存）
    bridge.hermesSessionOpen(sessionId)
      .then((r) => {
        if (!r.ok) {
          pushEntry(sessionId, { id: nextId(), sessionId, ts: Date.now(), kind: 'system', text: `⚠ 打开会话失败：${r.error ?? ''}` })
          return
        }
        const arr = transcripts.get(sessionId)
        if (!arr || arr.length === 0) {
          transcripts.set(sessionId, [])
          for (const ev of (r.history ?? []) as AgentEvent[]) {
            handleNativeEvent(sessionId, ev)
          }
        }
      })
      .catch((e) => {
        pushEntry(sessionId, { id: nextId(), sessionId, ts: Date.now(), kind: 'system', text: `⚠ 打开会话失败：${e instanceof Error ? e.message : String(e)}` })
      })
    const known = metas.get(sessionId)
    return known ?? { id: sessionId, agentId: HERMES, title: '（未命名）', createdAt: Date.now(), updatedAt: Date.now(), pinned: false, nativeSessionId: sessionId }
  }

  async function getOutput(id: string): Promise<OutputEntry[]> {
    if (id !== HERMES) return inner.getOutput(id)
    const csid = currentSession.get(HERMES)
    return [...transcriptOf(csid ?? '')]
  }

  async function sendInput(id: string, text: string): Promise<void> {
    if (id !== HERMES) return inner.sendInput(id, text)
    const csid = currentSession.get(HERMES)
    if (!csid) throw hsError('session-not-found', 'hybrid: hermes 无当前会话（先新建/选择会话）')
    pushEntry(csid, { id: nextId(), sessionId: csid, ts: Date.now(), kind: 'user', text })
    // fire-and-forget：事件经 onHermesSessionEvent 推送；结果（终态/错误）由事件与该 Promise 兜底
    bridge.hermesSessionSend({ nativeSessionId: csid, text })
      .then((r) => {
        if (!r.ok) {
          // 主进程已在错误时推送 error 事件（UI 已显示）；此处仅为兜底日志面
          void r
        }
      })
      .catch((e) => {
        pushEntry(csid, { id: nextId(), sessionId: csid, ts: Date.now(), kind: 'system', text: `⚠ 发送失败：${e instanceof Error ? e.message : String(e)}` })
      })
  }

  async function stopGeneration(id: string): Promise<void> {
    if (id !== HERMES) return inner.stopGeneration(id)
    const csid = currentSession.get(HERMES)
    if (!csid) return
    await bridge.hermesSessionStop(csid)
  }

  async function renameSession(id: string, sessionId: string, title: string): Promise<SessionMeta> {
    if (id !== HERMES) return inner.renameSession(id, sessionId, title)
    const clean = title.trim()
    const r = await bridge.hermesIndexUpdate({ nativeSessionId: sessionId, patch: clean ? { title: clean, titleSource: 'user' } : {} })
    if (!r.ok) throw toHsError(new Error(r.error || 'hermes index update failed'))
    const meta = metas.get(sessionId) ?? { id: sessionId, agentId: HERMES, title: clean, createdAt: Date.now(), updatedAt: Date.now(), pinned: false, nativeSessionId: sessionId }
    if (clean) {
      meta.title = clean
      metas.set(sessionId, meta)
    }
    return meta
  }

  async function deleteSession(id: string, sessionId: string): Promise<void> {
    if (id !== HERMES) return inner.deleteSession(id, sessionId)
    // 真实删除：官方 CLI（hermes sessions delete --yes，state.db 官方删除途径）
    const r = await bridge.hermesSessionDelete(sessionId)
    if (!r.ok) throw toHsError(new Error(r.error || 'hermes session delete failed'))
    transcripts.delete(sessionId)
    metas.delete(sessionId)
    if (currentSession.get(HERMES) === sessionId) {
      const rest = [...metas.values()].filter((m) => !m.orphaned)
      if (rest.length > 0) currentSession.set(HERMES, rest[0].id)
      else currentSession.delete(HERMES)
    }
  }

  async function pinSession(id: string, sessionId: string, pinned: boolean): Promise<void> {
    if (id !== HERMES) return inner.pinSession(id, sessionId, pinned)
    const r = await bridge.hermesIndexUpdate({ nativeSessionId: sessionId, patch: { pinned } })
    if (!r.ok) throw toHsError(new Error(r.error || 'hermes index update failed'))
    const m = metas.get(sessionId)
    if (m) {
      m.pinned = pinned
      metas.set(sessionId, m)
    }
  }

  async function archiveSession(id: string, sessionId: string): Promise<void> {
    if (id !== HERMES) return inner.archiveSession(id, sessionId)
    // 归档=聚合器索引语义（aggregatorArchiveState；不动原生数据，任务书 §三）
    const r = await bridge.hermesIndexUpdate({ nativeSessionId: sessionId, patch: { archived: true } })
    if (!r.ok) throw toHsError(new Error(r.error || 'hermes index update failed'))
    transcripts.delete(sessionId)
    metas.delete(sessionId)
    if (currentSession.get(HERMES) === sessionId) {
      const rest = [...metas.values()].filter((m) => !m.orphaned)
      if (rest.length > 0) currentSession.set(HERMES, rest[0].id)
      else currentSession.delete(HERMES)
    }
  }

  async function listArchivedSessions(): Promise<ArchivedSession[]> {
    const demo = await inner.listArchivedSessions()
    const r = await bridge.hermesSessionList()
    if (!r.ok) return demo // 真实桥不可用时回落演示清单（错误在会话操作面已如实上抛）
    const real = (r.sessions ?? [])
      .filter((row) => row.archived)
      .map((row) => ({ id: row.nativeSessionId, agentId: HERMES, title: row.title || '（未命名）', archivedAt: row.lastSeen ?? Date.now() }))
    return [...real, ...demo]
  }

  async function restoreArchivedSession(nativeSessionId: string): Promise<void> {
    const inIndex = (await bridge.hermesSessionList()).sessions?.some((s) => s.nativeSessionId === nativeSessionId)
    if (!inIndex) return inner.restoreArchivedSession(nativeSessionId)
    const r = await bridge.hermesIndexUpdate({ nativeSessionId, patch: { archived: false } })
    if (!r.ok) throw toHsError(new Error(r.error || 'hermes index update failed'))
  }

  async function deleteArchivedSessionForever(nativeSessionId: string): Promise<void> {
    // 永久删除=真实删除原生会话（官方 CLI）；非索引条目（stub 演示行）回落 inner
    const inIndex = (await bridge.hermesSessionList()).sessions?.some((s) => s.nativeSessionId === nativeSessionId)
    if (!inIndex) return inner.deleteArchivedSessionForever(nativeSessionId)
    const r = await bridge.hermesSessionDelete(nativeSessionId)
    if (!r.ok) throw toHsError(new Error(r.error || 'hermes session delete failed'))
  }

  // —— 组装：hermes 走真实，其余回落 inner —————————————————————————————
  return {
    ...inner,
    listSessions,
    newSession,
    switchSession,
    getOutput,
    sendInput,
    stopGeneration,
    renameSession,
    deleteSession,
    pinSession,
    archiveSession,
    listArchivedSessions,
    restoreArchivedSession,
    deleteArchivedSessionForever,
    onOutput(cb) {
      outputCbs.add(cb)
      // inner 的输出（其余 agent 的 stub 流）也要继续到达 UI
      const off = inner.onOutput(cb)
      return () => {
        outputCbs.delete(cb)
        off()
      }
    },
  }
}
