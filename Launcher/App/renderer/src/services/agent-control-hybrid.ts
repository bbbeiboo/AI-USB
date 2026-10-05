/**
 * 混合服务（13.22 建立，13.23 泛化为四 Agent）。
 * ---------------------------------------------------------------------------
 * 架构裁决：各 Agent 原生会话 = Source of Truth。本服务只做三件事：
 *   1. 已接线的 Agent 会话操作经官方通道（preload → 主进程桥）驱动真实 Agent；
 *   2. 把原生 AgentEvent 流翻译为既有 OutputEntry 渲染（UI 零改动）；
 *   3. 未接线的 Agent / 能力全部回落 inner（stub），绝不伪造「已接线」。
 *
 * 通道描述表（13.23）：
 *   - hermes：官方 ACP（老通道 hermes:*，逐字节保留 13.22 行为）
 *   - openclaw / codex / claude-code：统一通道 agents:session:*（主进程三桥）；
 *     每 Agent 原生元数据支持度见 NATIVE_META（rename/archive/delete）。
 *   每个 override 首行经 channelsFor 判定「该 agent 无桥 → 回落 inner」。
 *
 * 真实错误原样上抛（AgentError 语义）；真实失败不产生假回复。
 * 状态隔离：转录/回合/元数据按 (agentId, nativeSessionId) 复合键隔离，
 * 无跨 Agent 串流、无全局单锁（任务书 §十三）。
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
/** 13.23 已接线（有主进程桥）的 Agent 名单 */
const WIRED = ['hermes', 'openclaw', 'codex', 'claude-code'] as const

/** rename/archive 的原生支持级：native=官方原生接口；index=聚合器索引语义 */
const NATIVE_META: Record<string, { rename: 'native' | 'index'; archive: 'native' | 'index'; delete: 'native' | 'unsupported' }> = {
  hermes: { rename: 'index', archive: 'index', delete: 'native' },
  openclaw: { rename: 'native', archive: 'native', delete: 'native' },
  codex: { rename: 'native', archive: 'native', delete: 'native' },
  'claude-code': { rename: 'index', archive: 'index', delete: 'unsupported' },
}

function mkError(code: string, message: string, agentId: string): Error {
  const e = new Error(message) as Error & { code: string; agentId: string }
  e.code = code
  e.agentId = agentId
  return e
}

function toWiredError(err: unknown, agentId: string): Error {
  const msg = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string })?.code
  const m = code && code !== 'protocol' ? code
    : /provider.*credentials|api key|authentication|401/i.test(msg) ? 'provider-auth'
    : /not found|unknown session/i.test(msg) ? 'session-not-found'
    : /ECONNREFUSED|ENOENT|spawn|cannot find/i.test(msg) ? 'offline'
    : /timeout|timed out/i.test(msg) ? 'timeout'
    : 'protocol'
  return mkError(m, msg, agentId)
}

/** 会话操作通道适配：hermes=老通道逐字保留；其余=统一 agents:session:* 通道 */
interface SessionChannels {
  list(): Promise<{ ok: boolean; sessions?: Array<{ agentId: string; nativeSessionId: string; title: string; pinned?: boolean; archived?: boolean; orphaned?: boolean; lastMessagePreview?: string; lastSeen?: number; sortOrder?: number }>; error?: string; code?: string; nativeSync?: boolean }>
  create(params?: { title?: string }): Promise<{ ok: boolean; session?: { agentId: string; nativeSessionId: string; title?: string }; error?: string; code?: string }>
  open(nativeSessionId: string): Promise<{ ok: boolean; session?: unknown; history?: unknown[]; error?: string; code?: string }>
  send(nativeSessionId: string, text: string): Promise<{ ok: boolean; error?: string; code?: string }>
  stop(nativeSessionId: string): Promise<{ ok: boolean; error?: string; code?: string }>
  del(nativeSessionId: string): Promise<{ ok: boolean; error?: string; code?: string }>
  indexUpdate(nativeSessionId: string, patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>
  indexRemove(nativeSessionId: string): Promise<{ ok: boolean; error?: string }>
  /** 官方原生重命名/归档（仅 openclaw/codex 提供；缺省=index 语义） */
  rename?(nativeSessionId: string, title: string): Promise<{ ok: boolean; error?: string; code?: string }>
  archive?(nativeSessionId: string, archived: boolean): Promise<{ ok: boolean; error?: string; code?: string }>
}

function channelsFor(agentId: string, bridge: LauncherApi): SessionChannels | null {
  if (agentId === HERMES) {
    if (typeof bridge.hermesSessionList !== 'function') return null
    return {
      list: () => bridge.hermesSessionList(),
      create: (p) => bridge.hermesSessionCreate(p),
      open: (id) => bridge.hermesSessionOpen(id),
      send: (nativeSessionId, text) => bridge.hermesSessionSend({ nativeSessionId, text }),
      stop: (id) => bridge.hermesSessionStop(id),
      del: (id) => bridge.hermesSessionDelete(id),
      indexUpdate: (id, patch) => bridge.hermesIndexUpdate({ nativeSessionId: id, patch }),
      indexRemove: (id) => bridge.hermesIndexRemove(id),
    }
  }
  if (typeof bridge.agentSessionList !== 'function') return null
  return {
    list: () => bridge.agentSessionList(agentId),
    create: (p) => bridge.agentSessionCreate(agentId, p),
    open: (id) => bridge.agentSessionOpen(agentId, id),
    send: (nativeSessionId, text) => bridge.agentSessionSend({ agentId, nativeSessionId, text }),
    stop: (id) => bridge.agentSessionStop(agentId, id),
    del: (id) => bridge.agentSessionDelete(agentId, id),
    indexUpdate: (id, patch) => bridge.agentIndexUpdate({ agentId, nativeSessionId: id, patch }),
    indexRemove: (id) => bridge.agentIndexRemove(agentId, id),
    rename: (id, title) => bridge.agentSessionRename({ agentId, nativeSessionId: id, title }),
    archive: (id, archived) => bridge.agentSessionArchive({ agentId, nativeSessionId: id, archived }),
  }
}

/** 事件→条目的流式条目 id 前缀（同 id 原位增长 = 打字机） */
interface TurnState {
  /** 正在流式生长的条目（按 messageId 分组；text/thinking 各一条） */
  textEntryId: string | null
  thinkEntryId: string | null
}

export function createHybridAgentControlService(
  inner: AgentControlService,
  bridge: LauncherApi,
): AgentControlService {
  /** 会话元数据缓存（复合键 → SessionMeta；listSessions 时重建） */
  const metas = new Map<string, SessionMeta>()
  /** 转录缓存（复合键 → 条目；本应用运行期 + load 重放历史） */
  const transcripts = new Map<string, OutputEntry[]>()
  const currentSession = new Map<string, string>()
  const turns = new Map<string, TurnState>()
  let entrySeq = 0
  const nextId = () => `hs-${Date.now().toString(36)}-${(entrySeq++).toString(36)}`
  /** 状态键（跨 Agent 隔离：同名 nativeSessionId 不串流） */
  const kOf = (agentId: string, nativeSessionId: string) => `${agentId}\u0000${nativeSessionId}`
  /** 事件订阅回调集（复用 AgentControlService.onOutput 的语义） */
  const outputCbs = new Set<(id: string, entry: OutputEntry) => void>()

  function transcriptOf(key: string): OutputEntry[] {
    let t = transcripts.get(key)
    if (!t) {
      t = []
      transcripts.set(key, t)
    }
    return t
  }

  function pushEntry(key: string, entry: OutputEntry) {
    transcriptOf(key).push(entry)
    for (const cb of outputCbs) {
      try { cb(agentIdOfKey(key), entry) } catch (_) { /* 单监听器异常不扩散 */ }
    }
  }

  /** 流式条目按 id 原位更新后重发（与 stub updateEntry 同语义） */
  function updateEntry(key: string, entry: OutputEntry) {
    const arr = transcriptOf(key)
    const i = arr.findIndex((x) => x.id === entry.id)
    if (i >= 0) arr[i] = entry
    else arr.push(entry)
    for (const cb of outputCbs) {
      try { cb(agentIdOfKey(key), entry) } catch (_) {}
    }
  }

  function agentIdOfKey(key: string): string {
    return key.split('\u0000')[0]
  }

  function metaToSessionMeta(agentId: string, row: {
    nativeSessionId: string
    title?: string
    pinned?: boolean
    orphaned?: boolean
    lastSeen?: number
  }): SessionMeta {
    const ts = row.lastSeen ?? Date.now()
    return {
      id: row.nativeSessionId,
      agentId,
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
    handleNativeEvent(HERMES, nativeSessionId, event as AgentEvent)
  })
  // 13.23：openclaw/codex/claude-code 统一事件通道（载荷带 agentId）
  if (typeof bridge.onAgentSessionEvent === 'function') {
    bridge.onAgentSessionEvent(({ agentId, nativeSessionId, event }) => {
      handleNativeEvent(agentId, nativeSessionId, event as AgentEvent)
    })
  }

  function handleNativeEvent(agentId: string, nativeSessionId: string, ev: AgentEvent) {
    const key = kOf(agentId, nativeSessionId)
    const turn = turns.get(key) ?? { textEntryId: null, thinkEntryId: null }
    turns.set(key, turn)
    switch (ev.type) {
      case 'message_start':
        turn.textEntryId = null
        break
      case 'text_delta': {
        if (!turn.textEntryId) {
          turn.textEntryId = nextId()
          pushEntry(key, { id: turn.textEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'agent', text: ev.text, streaming: true })
        } else {
          const arr = transcriptOf(key)
          const cur = arr.find((x) => x.id === turn.textEntryId)
          updateEntry(key, { id: turn.textEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'agent', text: (cur?.text ?? '') + ev.text, streaming: true })
        }
        break
      }
      case 'text_replace': {
        // 累积替换（OpenClaw chat delta）：整段替换，不与旧文本拼接
        if (!turn.textEntryId) {
          turn.textEntryId = nextId()
          pushEntry(key, { id: turn.textEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'agent', text: ev.text, streaming: true })
        } else {
          updateEntry(key, { id: turn.textEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'agent', text: ev.text, streaming: true })
        }
        break
      }
      case 'thinking': {
        if (!turn.thinkEntryId) {
          turn.thinkEntryId = nextId()
          pushEntry(key, { id: turn.thinkEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `💭 ${ev.text}`, streaming: true })
        } else {
          const arr = transcriptOf(key)
          const cur = arr.find((x) => x.id === turn.thinkEntryId)
          updateEntry(key, { id: turn.thinkEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `💭 ${(cur?.text ?? '').replace(/^💭 /, '')}${ev.text}`, streaming: true })
        }
        break
      }
      case 'thinking_replace': {
        // 思考前缀断裂：整段替换（OpenClaw reasoning 投影）
        if (!turn.thinkEntryId) {
          turn.thinkEntryId = nextId()
          pushEntry(key, { id: turn.thinkEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `💭 ${ev.text}`, streaming: true })
        } else {
          updateEntry(key, { id: turn.thinkEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `💭 ${ev.text}`, streaming: true })
        }
        break
      }
      case 'tool_start':
        pushEntry(key, { id: nextId(), sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `🔧 工具调用：${ev.name}` })
        break
      case 'tool_result':
        pushEntry(key, { id: nextId(), sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `🔧 工具完成：${ev.name}${ev.summary ? `（${ev.summary}）` : ''}` })
        break
      case 'user_message':
        // 历史重放专用（session/load）
        pushEntry(key, { id: nextId(), sessionId: nativeSessionId, ts: Date.now(), kind: 'user', text: ev.text })
        break
      case 'session_info':
        channelsFor(agentId, bridge)?.indexUpdate(nativeSessionId, { title: ev.title }).catch(() => {})
        {
          const m = metas.get(key)
          if (m && ev.title) {
            m.title = ev.title
            metas.set(key, m)
          }
        }
        break
      case 'error':
        // 回合内真实错误：终止流式条目 + 显式错误条目（禁止假完成）
        if (turn.textEntryId) {
          updateEntry(key, { id: turn.textEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'agent', text: transcriptOf(key).find((x) => x.id === turn.textEntryId)?.text ?? '', streaming: false })
          turn.textEntryId = null
        }
        pushEntry(key, { id: nextId(), sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: `⚠ 出错（${ev.code ?? 'protocol'}）：${ev.message}` })
        break
      case 'message_end':
        if (turn.textEntryId) {
          updateEntry(key, { id: turn.textEntryId, sessionId: nativeSessionId, ts: Date.now(), kind: 'agent', text: transcriptOf(key).find((x) => x.id === turn.textEntryId)?.text ?? '', streaming: false })
        }
        if (ev.stopReason === 'cancelled') {
          pushEntry(key, { id: nextId(), sessionId: nativeSessionId, ts: Date.now(), kind: 'system', text: '（已停止生成）' })
        }
        turns.delete(key)
        break
      default:
        break
    }
  }

  // —— 已接线 Agent 的覆盖方法（真实链路）—————————————————————————————
  async function listSessions(id: string): Promise<SessionMeta[]> {
    const ch = channelsFor(id, bridge)
    if (!ch || !(WIRED as readonly string[]).includes(id)) return inner.listSessions(id)
    const r = await ch.list()
    if (!r.ok) throw toWiredError(new Error(r.error || `${id} session list failed`), id)
    const rows = r.sessions ?? []
    const metasList = rows.map((row) => metaToSessionMeta(id, row))
    for (const m of metasList) metas.set(kOf(id, m.nativeSessionId!), m)
    // 置顶优先（与 stub 排序语义一致）
    return metasList.filter((m) => m.pinned).concat(metasList.filter((m) => !m.pinned))
  }

  async function newSession(id: string): Promise<SessionMeta> {
    const ch = channelsFor(id, bridge)
    if (!ch || !(WIRED as readonly string[]).includes(id)) return inner.newSession(id)
    const r = await ch.create({})
    if (!r.ok || !r.session) throw toWiredError(new Error(r.error || `${id} session create failed`), id)
    const rs = r.session as { agentId: string; nativeSessionId: string; title?: string }
    const meta: SessionMeta = {
      id: rs.nativeSessionId,
      agentId: id,
      title: rs.title || '新会话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      nativeSessionId: rs.nativeSessionId,
    }
    metas.set(kOf(id, rs.nativeSessionId), meta)
    transcripts.set(kOf(id, rs.nativeSessionId), [])
    currentSession.set(id, rs.nativeSessionId)
    return meta
  }

  async function switchSession(id: string, sessionId: string): Promise<SessionMeta> {
    const ch = channelsFor(id, bridge)
    if (!ch || !(WIRED as readonly string[]).includes(id)) return inner.switchSession(id, sessionId)
    const key = kOf(id, sessionId)
    currentSession.set(id, sessionId)
    // 打开会话：官方 load 重放历史（异步回填转录缓存）
    ch.open(sessionId)
      .then((r) => {
        if (!r.ok) {
          pushEntry(key, { id: nextId(), sessionId, ts: Date.now(), kind: 'system', text: `⚠ 打开会话失败：${r.error ?? ''}` })
          return
        }
        const arr = transcripts.get(key)
        if (!arr || arr.length === 0) {
          transcripts.set(key, [])
          for (const ev of (r.history ?? []) as AgentEvent[]) {
            handleNativeEvent(id, sessionId, ev)
          }
        }
      })
      .catch((e) => {
        pushEntry(key, { id: nextId(), sessionId, ts: Date.now(), kind: 'system', text: `⚠ 打开会话失败：${e instanceof Error ? e.message : String(e)}` })
      })
    const known = metas.get(key)
    return known ?? { id: sessionId, agentId: id, title: '（未命名）', createdAt: Date.now(), updatedAt: Date.now(), pinned: false, nativeSessionId: sessionId }
  }

  async function getOutput(id: string): Promise<OutputEntry[]> {
    const ch = channelsFor(id, bridge)
    if (!ch || !(WIRED as readonly string[]).includes(id)) return inner.getOutput(id)
    const csid = currentSession.get(id)
    return [...transcriptOf(kOf(id, csid ?? ''))]
  }

  async function sendInput(id: string, text: string): Promise<void> {
    const ch = channelsFor(id, bridge)
    if (!ch || !(WIRED as readonly string[]).includes(id)) return inner.sendInput(id, text)
    const csid = currentSession.get(id)
    if (!csid) throw mkError('session-not-found', `hybrid: ${id} 无当前会话（先新建/选择会话）`, id)
    const key = kOf(id, csid)
    pushEntry(key, { id: nextId(), sessionId: csid, ts: Date.now(), kind: 'user', text })
    // fire-and-forget：事件经统一事件通道推送；结果（终态/错误）由事件与该 Promise 兜底
    ch.send(csid, text)
      .then((r) => {
        if (!r.ok) {
          // 主进程已在错误时推送 error 事件（UI 已显示）；此处仅为兜底日志面
          void r
        }
      })
      .catch((e) => {
        pushEntry(key, { id: nextId(), sessionId: csid, ts: Date.now(), kind: 'system', text: `⚠ 发送失败：${e instanceof Error ? e.message : String(e)}` })
      })
  }

  async function stopGeneration(id: string): Promise<void> {
    const ch = channelsFor(id, bridge)
    if (!ch || !(WIRED as readonly string[]).includes(id)) return inner.stopGeneration(id)
    const csid = currentSession.get(id)
    if (!csid) return
    await ch.stop(csid)
  }

  async function renameSession(id: string, sessionId: string, title: string): Promise<SessionMeta> {
    const ch = channelsFor(id, bridge)
    if (!ch || !(WIRED as readonly string[]).includes(id)) return inner.renameSession(id, sessionId, title)
    const clean = title.trim()
    const key = kOf(id, sessionId)
    if (NATIVE_META[id]?.rename === 'native' && ch.rename) {
      // 官方原生重命名（主进程同时更新索引 titleSource=user）
      const r = await ch.rename(sessionId, clean)
      if (!r.ok) throw toWiredError(new Error(r.error || `${id} rename failed`), id)
    } else {
      const r = await ch.indexUpdate(sessionId, clean ? { title: clean, titleSource: 'user' } : {})
      if (!r.ok) throw toWiredError(new Error(r.error || `${id} index update failed`), id)
    }
    const meta = metas.get(key) ?? { id: sessionId, agentId: id, title: clean, createdAt: Date.now(), updatedAt: Date.now(), pinned: false, nativeSessionId: sessionId }
    if (clean) {
      meta.title = clean
      metas.set(key, meta)
    }
    return meta
  }

  async function deleteSession(id: string, sessionId: string): Promise<void> {
    const ch = channelsFor(id, bridge)
    if (!ch || !(WIRED as readonly string[]).includes(id)) return inner.deleteSession(id, sessionId)
    if (NATIVE_META[id]?.delete === 'unsupported') {
      // 能力裁决：claude-code 无官方删除接口——明确 UNSUPPORTED，绝不伪造成功
      throw mkError('unsupported', `${id} 无官方会话删除接口（能力裁决 UNSUPPORTED）`, id)
    }
    // 真实删除：官方途径（hermes CLI / openclaw sessions.delete / codex thread/delete）
    const r = await ch.del(sessionId)
    if (!r.ok) throw toWiredError(new Error(r.error || `${id} session delete failed`), id)
    const key = kOf(id, sessionId)
    transcripts.delete(key)
    metas.delete(key)
    if (currentSession.get(id) === sessionId) {
      const rest = [...metas.entries()].filter(([, m]) => m.agentId === id && !m.orphaned)
      if (rest.length > 0) currentSession.set(id, rest[0][1].id)
      else currentSession.delete(id)
    }
  }

  async function pinSession(id: string, sessionId: string, pinned: boolean): Promise<void> {
    const ch = channelsFor(id, bridge)
    if (!ch || !(WIRED as readonly string[]).includes(id)) return inner.pinSession(id, sessionId, pinned)
    const r = await ch.indexUpdate(sessionId, { pinned })
    if (!r.ok) throw toWiredError(new Error(r.error || `${id} index update failed`), id)
    const key = kOf(id, sessionId)
    const m = metas.get(key)
    if (m) {
      m.pinned = pinned
      metas.set(key, m)
    }
  }

  async function archiveSession(id: string, sessionId: string): Promise<void> {
    const ch = channelsFor(id, bridge)
    if (!ch || !(WIRED as readonly string[]).includes(id)) return inner.archiveSession(id, sessionId)
    const key = kOf(id, sessionId)
    if (NATIVE_META[id]?.archive === 'native' && ch.archive) {
      // 官方原生归档（主进程同时更新索引）
      const r = await ch.archive(sessionId, true)
      if (!r.ok) throw toWiredError(new Error(r.error || `${id} archive failed`), id)
    } else {
      // 归档=聚合器索引语义（不动原生数据，任务书 §三）
      const r = await ch.indexUpdate(sessionId, { archived: true })
      if (!r.ok) throw toWiredError(new Error(r.error || `${id} index update failed`), id)
    }
    transcripts.delete(key)
    metas.delete(key)
    if (currentSession.get(id) === sessionId) {
      const rest = [...metas.entries()].filter(([, m]) => m.agentId === id && !m.orphaned)
      if (rest.length > 0) currentSession.set(id, rest[0][1].id)
      else currentSession.delete(id)
    }
  }

  async function listArchivedSessions(): Promise<ArchivedSession[]> {
    const demo = await inner.listArchivedSessions()
    const real: ArchivedSession[] = []
    for (const id of WIRED) {
      const ch = channelsFor(id, bridge)
      if (!ch) continue
      try {
        const r = await ch.list()
        if (!r.ok) continue // 真实桥不可用时跳过该 Agent（错误在会话操作面已如实上抛）
        for (const row of r.sessions ?? []) {
          if (row.archived) {
            real.push({ id: row.nativeSessionId, agentId: id, title: row.title || '（未命名）', archivedAt: row.lastSeen ?? Date.now() })
          }
        }
      } catch (_) { /* 单 Agent 桥失败不拖垮整体归档清单 */ }
    }
    return [...real, ...demo]
  }

  async function inIndexFor(id: string, nativeSessionId: string): Promise<boolean> {
    const ch = channelsFor(id, bridge)
    if (!ch) return false
    const r = await ch.list()
    return !!r.sessions?.some((s) => s.nativeSessionId === nativeSessionId)
  }

  async function restoreArchivedSession(nativeSessionId: string): Promise<void> {
    // 13.22 行为保留：仅 hermes（索引归档）与 13.23 已接线 Agent 的索引条目
    for (const id of WIRED) {
      const ch = channelsFor(id, bridge)
      if (!ch) continue
      if (await inIndexFor(id, nativeSessionId)) {
        if (NATIVE_META[id]?.archive === 'native' && ch.archive) {
          const r = await ch.archive(nativeSessionId, false)
          if (!r.ok) throw toWiredError(new Error(r.error || `${id} unarchive failed`), id)
        } else {
          const r = await ch.indexUpdate(nativeSessionId, { archived: false })
          if (!r.ok) throw toWiredError(new Error(r.error || `${id} index update failed`), id)
        }
        return
      }
    }
    return inner.restoreArchivedSession(nativeSessionId)
  }

  async function deleteArchivedSessionForever(nativeSessionId: string): Promise<void> {
    // 永久删除=真实删除原生会话（官方途径）；非索引条目（stub 演示行）回落 inner
    for (const id of WIRED) {
      const ch = channelsFor(id, bridge)
      if (!ch) continue
      if (await inIndexFor(id, nativeSessionId)) {
        if (NATIVE_META[id]?.delete === 'unsupported') {
          throw mkError('unsupported', `${id} 无官方会话删除接口（能力裁决 UNSUPPORTED）`, id)
        }
        const r = await ch.del(nativeSessionId)
        if (!r.ok) throw toWiredError(new Error(r.error || `${id} session delete failed`), id)
        return
      }
    }
    return inner.deleteArchivedSessionForever(nativeSessionId)
  }

  // —— 组装：已接线 Agent 走真实，其余回落 inner ————————————————————————————
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
