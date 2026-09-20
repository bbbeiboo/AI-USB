import { test } from 'node:test';
import assert from 'node:assert';
import { isProcessAlive, spawnDetached, terminateTree } from '../src/core/process-manager.js';

test('isProcessAlive 当前进程为 true', () => {
  assert.equal(isProcessAlive(process.pid), true);
});

test('isProcessAlive 不存在进程为 false', () => {
  assert.equal(isProcessAlive(999999999), false);
  assert.equal(isProcessAlive(0), false);
  assert.equal(isProcessAlive(-1), false);
  assert.equal(isProcessAlive(null), false);
});

test('spawnDetached 启动真实子进程并返回 PID', async () => {
  const pid = spawnDetached(process.execPath, ['-e', 'setInterval(()=>{}, 60000)'], '');
  assert.ok(pid > 0, `PID 非法: ${pid}`);
  // 稍等确保进程已存在
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(isProcessAlive(pid), true, '子进程应存活');
  // 清理
  await terminateTree(pid);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(isProcessAlive(pid), false, '子进程应已终止');
});

test('terminateTree 对已退出进程安全（无异常）', async () => {
  const ok = await terminateTree(999999999);
  assert.equal(ok, true);
});
