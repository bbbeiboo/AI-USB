'use strict';
/**
 * 认证 IPC 层（第 2 步）
 * ---------------------------------------------------------------------------
 * 把 auth-service 暴露给渲染进程，channel 一览：
 *   auth:register  { username, password }        -> { ok, user }
 *   auth:login     { username, password }        -> { ok, token, expiresAt, user }
 *   auth:verify    { token }                     -> { ok, user, expiresAt }
 *   auth:logout    { token }                     -> { ok, revoked }
 *   auth:status    {}                            -> { ok, ready, hasUsers, dbFile }
 *
 * 约定：
 *  - 只接受纯对象入参并强制转字符串，避免原型污染/注入式 payload；
 *  - 返回值一律不含 password_hash、不含 JWT 签名密钥；
 *  - 令牌只在登录响应里下发一次，之后的校验由渲染进程持有并回传。
 */
function registerAuthIpc(deps) {
  const { ipcMain, auth, log } = deps || {};
  if (!ipcMain) throw new Error('registerAuthIpc: 缺少 ipcMain');
  if (!auth) throw new Error('registerAuthIpc: 缺少 auth 服务');
  const say = typeof log === 'function' ? log : () => {};
  const str = (v, max) => String(v == null ? '' : v).slice(0, max || 256);

  ipcMain.handle('auth:register', async (_e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const r = auth.register({ username: str(p.username, 64), password: str(p.password, 256) });
    // 注册成功顺手不发令牌：让用户显式登录一次，流程更清晰
    return r;
  });

  ipcMain.handle('auth:login', async (_e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const r = auth.login({ username: str(p.username, 64), password: str(p.password, 256), ua: str(p.ua, 64) || 'launcher' });
    if (r && r.ok) say(`Event=AuthIpc Login id=${r.user && r.user.id} expiresAt=${r.expiresAt}`);
    return r;
  });

  ipcMain.handle('auth:verify', async (_e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    return auth.verify(str(p.token, 4096));
  });

  ipcMain.handle('auth:logout', async (_e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    return auth.logout(str(p.token, 4096));
  });

  ipcMain.handle('auth:status', async () => {
    try {
      return { ok: true, ready: auth.isReady(), hasUsers: auth.userCount() > 0, dbFile: auth.dbFile || null };
    } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
  });

  say('Event=AuthIpc Registered channels=auth:register,auth:login,auth:verify,auth:logout,auth:status');
  return true;
}

module.exports = { registerAuthIpc };
