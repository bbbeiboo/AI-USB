/**
 * 验收步骤 2：在「Launcher 已退出」的独立进程中，验证 Agent 仍存活并可健康检查。
 * 用法：node scripts/acceptance-verify.mjs
 */
import { isProcessAlive, terminateTree } from '../src/core/process-manager.js';
import { checkHttp } from '../src/core/health-check.js';
import { portablePath } from '../src/core/portable-root.js';
import fs from 'node:fs';

const pidFile = portablePath('data', 'orphan.pid');
const pid = Number(fs.readFileSync(pidFile, 'utf8'));

const alive = isProcessAlive(pid);
const httpOk = await checkHttp('http://127.0.0.1:9477');

console.log('orphan pid =', pid);
console.log('process alive after Launcher exit :', alive);
console.log('HTTP health check                  :', httpOk);

const pass = alive && httpOk;
console.log(pass ? '✅ ACCEPTANCE PASS' : '❌ ACCEPTANCE FAIL');

// 清理
await terminateTree(pid);
fs.rmSync(pidFile, { force: true });
process.exit(pass ? 0 : 1);
