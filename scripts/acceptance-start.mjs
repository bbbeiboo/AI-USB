/**
 * 验收步骤 1：模拟 Launcher 启动 Agent 后立即退出。
 * 用法：node scripts/acceptance-start.mjs
 */
import { spawnDetached } from '../src/core/process-manager.js';
import { portablePath } from '../src/core/portable-root.js';
import fs from 'node:fs';

// 用一个真实的 HTTP 服务模拟「Agent」——便于后续做端口级健康检查
const pid = spawnDetached(
  process.execPath,
  ['-e', "require('http').createServer((q,s)=>s.end('ok')).listen(9477)"],
  '',
);
fs.mkdirSync(portablePath('data'), { recursive: true });
fs.writeFileSync(portablePath('data', 'orphan.pid'), String(pid));
console.log('started orphan pid =', pid);
// 立即退出 —— 关键：模拟 Launcher 关闭
process.exit(0);
