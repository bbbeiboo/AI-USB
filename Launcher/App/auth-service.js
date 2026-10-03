'use strict';
/**
 * 认证服务（第 2 步）
 * ---------------------------------------------------------------------------
 * 职责：SQLite 建表（users / user_sessions / agent_runs）+ 口令哈希（bcryptjs）
 *      + JWT 会话签发/校验/吊销 + agent_runs 运行记录的最小读写。
 *
 * 设计要点（与"U 盘便携"这个前提强相关）：
 *  1. 数据库文件放在 <ROOT>/Launcher/Data/app.db，随 U 盘走，与 agent-state.json、
 *     usage/、secrets/ 同级。
 *  2. JWT 签名密钥**不能用 DPAPI 加密**：DPAPI 是"当前 Windows 用户 + 当前机器"绑定，
 *     把密钥 DPAPI 化会让同一支 U 盘插到另一台电脑后无法校验任何令牌（用户被迫重新登录，
 *     更糟的情况是登录后立刻失效）。所以密钥存在数据库自身的 meta 表里，随 U 盘一起搬。
 *     代价：拿到 U 盘的人能读出密钥 —— 这是便携设备的现实威胁模型，已在注释里写明。
 *  3. 所有时间戳统一用毫秒整数（SQLite INTEGER），便于与 JS Date.now() 直接比较。
 *  4. 任何日志都不打印口令、哈希、JWT 明文；只打印用户名与 jti（会话标识）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let Database = null;
let bcrypt = null;
let jwt = null;
try { Database = require('better-sqlite3'); } catch (e) { Database = null; }
try { bcrypt = require('bcryptjs'); } catch (e) { bcrypt = null; }
try { jwt = require('jsonwebtoken'); } catch (e) { jwt = null; }

// --- 可调参数 ---------------------------------------------------------------
const TOKEN_TTL_SEC = 7 * 24 * 3600;   // 令牌有效期 7 天
const BCRYPT_ROUNDS = 10;              // bcrypt 代价因子（约 60-120ms/次）
const USERNAME_MIN = 3, USERNAME_MAX = 32;
const PASSWORD_MIN = 6, PASSWORD_MAX = 128;

// --- 模块状态 ---------------------------------------------------------------
let db = null;
let dbFile = null;
let jwtSecret = null;
let logger = () => {};
let lastError = null;

const SCHEMA = `
-- 用户表：口令只存 bcrypt 哈希，绝不存明文
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  disabled      INTEGER NOT NULL DEFAULT 0
);
-- 用户名大小写不敏感唯一（Alice 与 alice 视为同一人）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username COLLATE NOCASE);

-- 会话表：每个 JWT 对应一行，logout 通过吊销 jti 实现"真注销"
CREATE TABLE IF NOT EXISTS user_sessions (
  jti        TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  ua         TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions (user_id);

-- Agent 运行记录：第 7 步接四个 Agent 时写入（PID 用 spawn 真实返回值）
CREATE TABLE IF NOT EXISTS agent_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  agent_id   TEXT    NOT NULL,
  session_id TEXT,
  model      TEXT,
  pid        INTEGER,
  status     TEXT    NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  exit_code  INTEGER,
  error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_user_started ON agent_runs (user_id, started_at DESC);

-- 键值表：存放 JWT 签名密钥等"随 U 盘走"的小状态
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

/** 确保 meta 里的 JWT 密钥存在，返回密钥字符串。 */
function ensureJwtSecret() {
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get('jwt_secret');
  if (row && row.v) return row.v;
  const secret = crypto.randomBytes(32).toString('hex'); // 256bit 随机
  db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run('jwt_secret', secret);
  logger('Event=Auth MetaCreated key=jwt_secret (256bit, 随 U 盘存储)');
  return secret;
}

/**
 * 初始化：打开/创建数据库并建表。
 * @param {{root?:string, dbFile?:string, log?:Function}} [opts]
 * @returns {{ok:boolean, dbFile?:string, error?:string}}
 */
function init(opts) {
  opts = opts || {};
  if (typeof opts.log === 'function') logger = opts.log;
  try {
    if (!Database) throw new Error('better-sqlite3 不可用（原生模块加载失败）');
    if (!bcrypt) throw new Error('bcryptjs 不可用');
    if (!jwt) throw new Error('jsonwebtoken 不可用');
    if (db && db.open) return { ok: true, dbFile };

    dbFile = opts.dbFile || process.env.AI_USB_AUTH_DB ||
      path.join(opts.root || process.cwd(), 'Launcher', 'Data', 'app.db');
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    db = new Database(dbFile);          // 同步打开，U 盘上第一次会稍慢
    db.pragma('journal_mode = WAL');    // 并发读更好；与 Hermes 的 WAL 取舍一致
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
    jwtSecret = ensureJwtSecret();
    lastError = null;
    logger(`Event=Auth Ready db=${dbFile}`);
    return { ok: true, dbFile };
  } catch (e) {
    lastError = String((e && e.message) || e);
    logger(`Event=Auth InitFailed reason=${lastError}`);
    db = null;
    return { ok: false, error: lastError };
  }
}

function isReady() { return !!(db && db.open && jwtSecret); }
function unavailable() { return { ok: false, reason: 'auth-unavailable', error: lastError || '认证服务未就绪' }; }

/** 入参校验（只做本地规则校验，不查库）。 */
function validateCredentials(username, password) {
  const errors = [];
  const u = String(username == null ? '' : username).trim();
  const p = String(password == null ? '' : password);
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) errors.push(`用户名长度需 ${USERNAME_MIN}-${USERNAME_MAX} 位`);
  if (!/^[A-Za-z0-9_.@-]+$/.test(u)) errors.push('用户名只能用字母/数字/_.@-');
  if (p.length < PASSWORD_MIN || p.length > PASSWORD_MAX) errors.push(`密码长度需 ${PASSWORD_MIN}-${PASSWORD_MAX} 位`);
  return { username: u, password: p, errors };
}

/** 对外可见的用户对象（永不包含 password_hash）。 */
function publicUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, createdAt: row.created_at, lastLoginAt: row.last_login_at || null };
}

/** 注册：用户名唯一（大小写不敏感），口令 bcrypt 哈希入库。 */
function register(payload) {
  if (!isReady()) return unavailable();
  const { username, password, errors } = validateCredentials(payload && payload.username, payload && payload.password);
  if (errors.length) return { ok: false, reason: 'validation', errors };
  const now = Date.now();
  try {
    const exists = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (exists) return { ok: false, reason: 'exists', errors: ['用户名已被占用'] };
    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const info = db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(username, hash, now);
    logger(`Event=Auth Register id=${info.lastInsertRowid} name=${username}`);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    return { ok: true, user: publicUser(row) };
  } catch (e) {
    logger(`Event=Auth RegisterFailed name=${username} reason=${String((e && e.message) || e)}`);
    return { ok: false, reason: 'error', errors: [String((e && e.message) || e)] };
  }
}

/** 登录：校验口令 → 建会话行 → 签发 JWT。 */
function login(payload) {
  if (!isReady()) return unavailable();
  const username = String((payload && payload.username) || '').trim();
  const password = String((payload && payload.password) || '');
  if (!username || !password) return { ok: false, reason: 'validation', errors: ['用户名和密码不能为空'] };
  try {
    const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
    // 不区分"用户不存在"与"密码错误"，避免账号枚举
    if (!row || row.disabled) return { ok: false, reason: 'bad-credentials', errors: ['用户名或密码错误'] };
    const okPw = bcrypt.compareSync(password, row.password_hash);
    if (!okPw) {
      logger(`Event=Auth LoginFailed name=${username} reason=bad-password`);
      return { ok: false, reason: 'bad-credentials', errors: ['用户名或密码错误'] };
    }
    const now = Date.now();
    const jti = crypto.randomUUID();
    const expiresAt = now + TOKEN_TTL_SEC * 1000;
    db.prepare('INSERT INTO user_sessions (jti, user_id, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?)')
      .run(jti, row.id, now, expiresAt, String((payload && payload.ua) || 'launcher'));
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.id);
    const token = jwt.sign({ sub: row.id, usr: row.username, jti }, jwtSecret, { expiresIn: TOKEN_TTL_SEC });
    logger(`Event=Auth Login id=${row.id} name=${row.username} jti=${jti} ttlSec=${TOKEN_TTL_SEC}`);
    return { ok: true, token, expiresAt, user: publicUser({ ...row, last_login_at: now }) };
  } catch (e) {
    logger(`Event=Auth LoginError name=${username} reason=${String((e && e.message) || e)}`);
    return { ok: false, reason: 'error', errors: [String((e && e.message) || e)] };
  }
}

/** 校验令牌：签名 + 过期 + 会话行未被吊销。 */
function verify(token) {
  if (!isReady()) return unavailable();
  if (!token) return { ok: false, reason: 'no-token' };
  let claims;
  try {
    claims = jwt.verify(String(token), jwtSecret);
  } catch (e) {
    const reason = (e && e.name === 'TokenExpiredError') ? 'expired' : 'invalid';
    return { ok: false, reason };
  }
  try {
    const sess = db.prepare('SELECT * FROM user_sessions WHERE jti = ?').get(claims.jti);
    if (!sess) return { ok: false, reason: 'unknown-session' };
    if (sess.revoked_at) return { ok: false, reason: 'revoked' };
    if (sess.expires_at <= Date.now()) return { ok: false, reason: 'expired' };
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(claims.sub);
    if (!row || row.disabled) return { ok: false, reason: 'user-disabled' };
    return { ok: true, user: publicUser(row), expiresAt: sess.expires_at, jti: claims.jti };
  } catch (e) {
    return { ok: false, reason: 'error', error: String((e && e.message) || e) };
  }
}

/** 登出：吊销该令牌对应的会话行（其他设备的会话不受影响）。 */
function logout(token) {
  if (!isReady()) return unavailable();
  if (!token) return { ok: false, reason: 'no-token' };
  try {
    // 即使令牌已过期也要能"登出"：先尝试解出 jti，失败则直接结束
    let claims = null;
    try { claims = jwt.verify(String(token), jwtSecret, { ignoreExpiration: true }); } catch (_) { claims = null; }
    if (!claims || !claims.jti) return { ok: true, revoked: 0 };
    const info = db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL').run(Date.now(), claims.jti);
    logger(`Event=Auth Logout jti=${claims.jti} revoked=${info.changes}`);
    return { ok: true, revoked: info.changes };
  } catch (e) {
    return { ok: false, reason: 'error', error: String((e && e.message) || e) };
  }
}

/** 吊销某用户的全部会话（改密码/踢下线用，第 2 步先提供能力）。 */
function logoutAll(userId) {
  if (!isReady()) return unavailable();
  const info = db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), userId);
  logger(`Event=Auth LogoutAll userId=${userId} revoked=${info.changes}`);
  return { ok: true, revoked: info.changes };
}

/** 用户数（给登录页做"是否已有账号"判断）。 */
function userCount() {
  if (!isReady()) return 0;
  try { return db.prepare('SELECT COUNT(*) AS n FROM users').get().n; } catch (_) { return 0; }
}

// --- agent_runs 最小读写（第 7 步使用） -------------------------------------
function startRun(info) {
  if (!isReady()) return null;
  try {
    const r = db.prepare(`INSERT INTO agent_runs (user_id, agent_id, session_id, model, pid, status, started_at)
                          VALUES (?, ?, ?, ?, ?, 'running', ?)`)
      .run((info && info.userId) || null, String((info && info.agentId) || 'unknown'),
           (info && info.sessionId) || null, (info && info.model) || null, (info && info.pid) || null, Date.now());
    return r.lastInsertRowid;
  } catch (e) { logger(`Event=Auth RunStartFailed reason=${String((e && e.message) || e)}`); return null; }
}
function endRun(runId, info) {
  if (!isReady() || !runId) return false;
  try {
    db.prepare('UPDATE agent_runs SET status = ?, ended_at = ?, exit_code = ?, error = ? WHERE id = ?')
      .run(String((info && info.status) || 'stopped'), Date.now(), (info && info.exitCode) != null ? info.exitCode : null,
           (info && info.error) || null, runId);
    return true;
  } catch (e) { logger(`Event=Auth RunEndFailed reason=${String((e && e.message) || e)}`); return false; }
}

function close() { try { if (db && db.open) db.close(); } catch (_) {} db = null; }

module.exports = {
  init, isReady, register, login, verify, logout, logoutAll, userCount,
  startRun, endRun, close,
  validateCredentials, publicUser,
  get dbFile() { return dbFile; },
  get lastError() { return lastError; },
  TOKEN_TTL_SEC, BCRYPT_ROUNDS,
};
