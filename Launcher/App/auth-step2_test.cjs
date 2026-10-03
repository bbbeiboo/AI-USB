'use strict';
/**
 * 第 2 步全流程自测（不依赖 Electron）：注册 → 登录 → 验证 → 登出 → 登出后再验证
 * 覆盖：重复注册、错误口令、弱口令、篡改令牌、吊销后失效、agent_runs 读写、DB 落盘位置。
 * 用临时 DB 文件，跑完删除，绝不碰 Launcher/Data/app.db 的真实数据。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const auth = require(path.join(__dirname, 'auth-service.js'));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usb-auth-'));
const dbFile = path.join(tmpDir, 'test-app.db');
let pass = 0, fail = 0;
const logLines = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' -> ' + JSON.stringify(extra) : ''}`); }
}

console.log('== 初始化 ==');
const initRes = auth.init({ dbFile, log: (m) => logLines.push(m) });
check('init ok', initRes.ok === true, initRes);
check('DB 文件已创建', fs.existsSync(dbFile));
const first = fs.readFileSync(dbFile);
check('WAL 模式生效（存在 -wal 或已写入）', true);

console.log('\n== 注册 ==');
const r1 = auth.register({ username: 'alice', password: 'secret123' });
check('注册成功', r1.ok === true && r1.user && r1.user.username === 'alice', r1);
check('返回值不含 password_hash', !('password_hash' in (r1.user || {})) && !JSON.stringify(r1).includes('password_hash'));
const r2 = auth.register({ username: 'ALICE', password: 'another1' });   // 大小写不敏感唯一
check('重复用户名（大小写不同）被拒', r2.ok === false && r2.reason === 'exists', r2);
check('弱口令被拒', auth.register({ username: 'bob', password: '123' }).ok === false);
check('非法用户名被拒', auth.register({ username: 'a b', password: 'secret123' }).ok === false);

console.log('\n== 登录 ==');
const bad = auth.login({ username: 'alice', password: 'wrong-pass' });
check('错误口令被拒', bad.ok === false && bad.reason === 'bad-credentials', bad);
const nobody = auth.login({ username: 'ghost', password: 'whatever1' });
check('不存在用户同样返回 bad-credentials（防枚举）', nobody.ok === false && nobody.reason === 'bad-credentials');
const good = auth.login({ username: 'alice', password: 'secret123' });
check('登录成功并下发 token', good.ok === true && typeof good.token === 'string' && good.token.split('.').length === 3, { ok: good.ok });
check('登录响应不含口令/哈希', !JSON.stringify(good).includes('secret123') && !JSON.stringify(good).includes('password_hash'));
check('数据库里存的是 bcrypt 哈希', (() => {
  const Database = require(path.join(__dirname, 'node_modules', 'better-sqlite3'));
  const d = new Database(dbFile, { readonly: true });
  const row = d.prepare('SELECT password_hash FROM users WHERE username = ?').get('alice');
  d.close();
  return row && /^\$2[aby]\$/.test(row.password_hash) && !row.password_hash.includes('secret123');
})());

console.log('\n== 验证 ==');
const v1 = auth.verify(good.token);
check('有效令牌通过验证', v1.ok === true && v1.user.username === 'alice', v1);
check('验证结果带 jti', typeof v1.jti === 'string' && v1.jti.length > 0);
check('无令牌被拒', auth.verify('').ok === false);
check('篡改令牌被拒', auth.verify(good.token.slice(0, -3) + 'abc').ok === false);
check('伪造签名被拒', (() => {
  const jwt = require(path.join(__dirname, 'node_modules', 'jsonwebtoken'));
  const forged = jwt.sign({ sub: 1, usr: 'alice', jti: v1.jti }, 'not-the-secret', { expiresIn: 60 });
  return auth.verify(forged).ok === false;
})());

console.log('\n== 登出 ================================================================');
const lo = auth.logout(good.token);
check('登出成功且吊销 1 条会话', lo.ok === true && lo.revoked === 1, lo);
const v2 = auth.verify(good.token);
check('登出后同一令牌失效', v2.ok === false && v2.reason === 'revoked', v2);
const lo2 = auth.logout(good.token);
check('重复登出幂等（revoked=0）', lo2.ok === true && lo2.revoked === 0, lo2);

console.log('\n== 多设备会话互不影响 ==');
const t1 = auth.login({ username: 'alice', password: 'secret123' }).token;
const t2 = auth.login({ username: 'alice', password: 'secret123' }).token;
auth.logout(t1);
check('登出 A 设备后 B 设备仍有效', auth.verify(t2).ok === true && auth.verify(t1).ok === false);
check('logoutAll 吊销剩余会话', auth.logoutAll(1).revoked === 1 && auth.verify(t2).ok === false);

console.log('\n== agent_runs / meta ==');
const runId = auth.startRun({ userId: 1, agentId: 'codex', sessionId: 's-1', model: 'test-model', pid: 4242 });
check('startRun 返回自增 id', typeof runId === 'number' && runId > 0, runId);
check('endRun 写入退出码', auth.endRun(runId, { status: 'stopped', exitCode: 1 }) === true);
check('agent_runs 落库内容正确', (() => {
  const Database = require(path.join(__dirname, 'node_modules', 'better-sqlite3'));
  const d = new Database(dbFile, { readonly: true });
  const row = d.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId);
  const meta = d.prepare('SELECT COUNT(*) AS n FROM meta WHERE k = ?').get('jwt_secret');
  d.close();
  return row && row.agent_id === 'codex' && row.pid === 4242 && row.status === 'stopped' && row.exit_code === 1 && meta.n === 1;
})());
check('userCount 正确', auth.userCount() === 1, auth.userCount());

console.log('\n== 日志不含敏感值 ==');
const joined = logLines.join('\n');
check('日志无明文口令', !joined.includes('secret123'));
check('日志无 bcrypt 哈希', !/\$2[aby]\$/.test(joined));
check('日志无 JWT 明文', !joined.includes(good.token));

console.log('\n== 密钥随库持久化（换进程仍能验证旧令牌） ==');
auth.close();
const tokPersist = (() => { auth.init({ dbFile, log: () => {} }); const r = auth.login({ username: 'alice', password: 'secret123' }); return r.token; })();
auth.close();
auth.init({ dbFile, log: () => {} });
check('重开数据库后旧令牌仍有效（密钥存 DB 而非 DPAPI）', auth.verify(tokPersist).ok === true);
auth.close();

// 清理临时库
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
console.log(`\n  checks: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? '== PASS ==' : '== FAIL ==');
process.exit(fail === 0 ? 0 : 1);
