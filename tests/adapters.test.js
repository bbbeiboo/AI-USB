import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentAdapter, STATUS } from '../src/core/adapters/base.js';
import { readState, writeState } from '../src/core/state.js';
import { HermesAdapter } from '../src/core/adapters/hermes.js';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usb-adapters-'));
process.env.PORTABLE_ROOT = ROOT;

// Mock 长驻进程：用 node 自身跑一个 60s 的空循环，验证真实进程生命周期。
const MOCK_DEF = {
  id: 'mock',
  displayName: 'Mock',
  command: process.execPath,
  args: ['-e', 'setInterval(()=>{}, 60000)'],
  versionArgs: ['--version'],
  probe: null,
};

function makeMockAdapter() {
  const state = readState();
  const adapter = new AgentAdapter(
    { ...MOCK_DEF },
    { state, appConfig: { startupTimeoutMs: 5000 }, config: {}, saveState: () => writeState(state) },
  );
  return adapter;
}

test('STATUS 状态机常量完整', () => {
  for (const s of ['Unknown', 'NotInstalled', 'Stopped', 'Starting', 'Running', 'Stopping', 'Error', 'Updating']) {
    assert.ok(STATUS[s], s);
  }
});

test('mock 安装探测成功（node --version）', async () => {
  const a = makeMockAdapter();
  const inst = await a.detect_installation();
  assert.equal(inst.installed, true);
  assert.ok(inst.version.startsWith('v'), `version: ${inst.version}`);
});

test('生命周期：start → Running → 防重复 → 重开恢复 → stop → Stopped', async () => {
  const a1 = makeMockAdapter();

  // 启动
  const r1 = await a1.start();
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.status, STATUS.Running);
  assert.ok(r1.pid > 0);
  assert.equal(a1.is_running(), true);

  // 防重复启动
  const r2 = await a1.start();
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'already-running');

  // 模拟「再次打开 Launcher」：新建 adapter，从磁盘读回状态
  const a2 = makeMockAdapter();
  assert.equal(a2.is_running(), true, '重开 Launcher 后应能恢复运行状态');

  // 停止
  const r3 = await a2.stop();
  assert.equal(r3.status, STATUS.Stopped);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(a2.is_running(), false, '停止后进程应已终止');
});

test('未安装的 Agent：start 返回 not-installed', async () => {
  const state = readState();
  const a = new AgentAdapter(
    { id: 'ghost', displayName: 'Ghost', command: 'definitely-not-a-real-cmd-xyz', args: [], versionArgs: ['--version'], probe: null },
    { state, appConfig: { startupTimeoutMs: 1000 }, config: {}, saveState: () => writeState(state) },
  );
  const r = await a.start();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-installed');
});

test('本机真实 Agent 检测（Hermes）', async () => {
  const state = readState();
  const hermes = new HermesAdapter({ state, appConfig: {}, config: {}, saveState: () => writeState(state) });
  const inst = await hermes.detect_installation();
  // 结果必须返回合法结构；是否 installed 取决于运行环境，不做强假设
  assert.equal(typeof inst.installed, 'boolean');
  if (inst.installed) assert.ok(inst.version, 'installed 时应返回 version');
});
