/**
 * 聚合器 Session Index（13.22 §二/§十一/§十二）。
 * ---------------------------------------------------------------------------
 * 架构裁决：Agent 原生会话 = Source of Truth；本索引只存
 *   agentId / nativeSessionId / 展示名 / 置顶 / 归档 / 排序 / 预览 / lastSeen，
 * 绝不保存完整消息历史、Agent 上下文、Memory（那是 Agent 原生的主权数据）。
 *
 * 同步方向（§十二）：Native → Adapter → Index；索引永不单方面覆盖 Agent 原生数据。
 * orphan 规则（§十一）：原生会话被删除 → 下次同步检测到 nativeSessionId 不存在 →
 *   标记 orphaned=true 保留条目（供用户清理），不得自动制造新会话冒充。
 *
 * 纯 Node 模块（零 Electron 依赖），可被 node --test 直测。
 */
const fs = require('node:fs')
const path = require('node:path')

const INDEX_VERSION = 1

function emptyIndex() {
  return { version: INDEX_VERSION, sessions: [] }
}

function createSessionIndex({ filePath, log = () => {} }) {
  if (!filePath) throw new Error('session-index: filePath required')

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (raw && raw.version === INDEX_VERSION && Array.isArray(raw.sessions)) return raw
      log('session-index: 格式不符，按空索引处理')
      return emptyIndex()
    } catch {
      return emptyIndex()
    }
  }

  function save(index) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tmp = filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, filePath)
  }

  function keyOf(agentId, nativeSessionId) {
    return `${agentId}/${nativeSessionId}`
  }

  return {
    keyOf,
    /** 读取全部索引条目 */
    all() {
      return load().sessions
    },
    /**
     * 单条登记/刷新（新建原生会话后立即入索引）。与 sync 的区别：
     * 不做 orphan 扫描——sync 以官方清单为准全量比对，upsert 只管单条。
     */
    upsert(agentId, nativeSessionId, patch = {}, now = Date.now()) {
      const index = load()
      let entry = index.sessions.find((e) => e.agentId === agentId && e.nativeSessionId === nativeSessionId)
      if (!entry) {
        entry = {
          agentId,
          nativeSessionId,
          title: '',
          pinned: false,
          archived: false,
          orphaned: false,
          lastMessagePreview: '',
          lastSeen: now,
          sortOrder: index.sessions.length,
        }
        index.sessions.push(entry)
      }
      for (const k of ['title', 'titleSource', 'pinned', 'archived', 'lastMessagePreview', 'orphaned']) {
        if (k in patch) entry[k] = patch[k]
      }
      entry.lastSeen = now
      save(index)
      return { ...entry }
    },
    /** 用某 Agent 的官方原生会话清单同步索引（Native → Index；检测 orphan） */
    sync(agentId, nativeSessions, now = Date.now()) {
      const index = load()
      const nativeKeys = new Set()
      for (const s of nativeSessions) {
        const k = keyOf(agentId, s.nativeSessionId)
        nativeKeys.add(k)
        let entry = index.sessions.find((e) => e.agentId === agentId && e.nativeSessionId === s.nativeSessionId)
        if (!entry) {
          entry = {
            agentId,
            nativeSessionId: s.nativeSessionId,
            title: s.title || '',
            pinned: false,
            archived: false,
            orphaned: false,
            lastMessagePreview: '',
            lastSeen: now,
            sortOrder: index.sessions.length,
          }
          index.sessions.push(entry)
        }
        // 真源侧字段回填；索引侧（pinned/archived/sortOrder）以索引为准。
        // 标题：titleSource='user'（用户在聚合器改过名）→ 原生自动标题不覆盖；否则原生为准
        if (s.title && entry.titleSource !== 'user') entry.title = s.title
        entry.orphaned = false
        entry.lastSeen = now
        if (s.updatedAt) entry.updatedAt = s.updatedAt
      }
      // orphan 检测：索引里有、原生清单里没有 → 标记（保留，不伪造）
      for (const e of index.sessions) {
        if (e.agentId === agentId && !nativeKeys.has(keyOf(agentId, e.nativeSessionId))) {
          if (!e.orphaned) log(`session-index: orphaned ${keyOf(agentId, e.nativeSessionId)}`)
          e.orphaned = true
        }
      }
      save(index)
      return index.sessions.filter((e) => e.agentId === agentId)
    },
    /** 索引侧元数据更新（展示名/置顶/归档/预览）；仅索引，不触原生 */
    update(agentId, nativeSessionId, patch) {
      const index = load()
      const entry = index.sessions.find((e) => e.agentId === agentId && e.nativeSessionId === nativeSessionId)
      if (!entry) return null
      for (const k of ['title', 'titleSource', 'pinned', 'archived', 'lastMessagePreview', 'sortOrder']) {
        if (k in patch) entry[k] = patch[k]
      }
      save(index)
      return { ...entry }
    },
    /** 从索引移除（orphan 清理 / 用户显式删除索引条目） */
    remove(agentId, nativeSessionId) {
      const index = load()
      const i = index.sessions.findIndex((e) => e.agentId === agentId && e.nativeSessionId === nativeSessionId)
      if (i < 0) return false
      index.sessions.splice(i, 1)
      save(index)
      return true
    },
  }
}

module.exports = { createSessionIndex, INDEX_VERSION: 1 }
