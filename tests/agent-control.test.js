// 13.13 阶段 2 单测：stub 状态机 / 工厂 / 导出格式生成 / real 骨架契约
// 直接以 Node strip-types 加载渲染层 TS 源码（stub 仅 import type，无运行时依赖）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubAgentControlService } from '../Launcher/App/renderer/src/services/agent-control-stub.ts';
import { getAgentControlService, __resetAgentControlServiceForTest } from '../Launcher/App/renderer/src/services/agent-control.ts';
import { realAgentControlService } from '../Launcher/App/renderer/src/services/agent-control-real.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFast() {
  return createStubAgentControlService({ startDelayMs: 10, stopDelayMs: 10, restartGapMs: 5, sendDelayMs: 10 });
}

test('工厂默认返回 stub：接口方法齐全且为函数', async () => {
  __resetAgentControlServiceForTest();
  const svc = getAgentControlService();
  for (const m of ['listAgents', 'getAgentStatus', 'startAgent', 'stopAgent', 'restartAgent',
    'newSession', 'listSessions', 'switchSession', 'getOutput', 'clearOutput', 'undoClearOutput',
    'copyOutput', 'exportSession', 'sendInput', 'openLogs', 'pinAgent', 'onStatusChange', 'onOutput']) {
    assert.equal(typeof svc[m], 'function', `method ${m}`);
  }
});

test('listAgents：4 个 Agent，id 与 agents.json 对齐，默认全 STOPPED', async () => {
  const svc = makeFast();
  const agents = await svc.listAgents();
  assert.deepEqual(agents.map((a) => a.id).sort(),
    ['claude-code', 'codex', 'hermes', 'openclaw']);
  assert.ok(agents.every((a) => a.status === 'STOPPED'));
  assert.ok(agents.every((a) => a.short.length >= 1));
});

test('startAgent：STOPPED → STARTING → RUNNING 全程发事件，resolve 为 RUNNING', async () => {
  const svc = makeFast();
  const events = [];
  svc.onStatusChange((id, s) => events.push([id, s]));
  const r = await svc.startAgent('hermes');
  assert.equal(r, 'RUNNING');
  assert.deepEqual(events, [['hermes', 'STARTING'], ['hermes', 'RUNNING']]);
  assert.equal(await svc.getAgentStatus('hermes'), 'RUNNING');
});

test('stopAgent：RUNNING → STOPPING → STOPPED；对 STOPPED 幂等', async () => {
  const svc = makeFast();
  const events = [];
  svc.onStatusChange((id, s) => events.push([id, s]));
  await svc.startAgent('codex');
  events.length = 0;
  const r = await svc.stopAgent('codex');
  assert.equal(r, 'STOPPED');
  assert.deepEqual(events, [['codex', 'STOPPING'], ['codex', 'STOPPED']]);
  events.length = 0;
  await svc.stopAgent('codex');
  assert.deepEqual(events, [], 'STOPPED 上再 stop 不应产生事件');
});

test('restartAgent：完整 绿→黄→灰→黄→绿 流转', async () => {
  const svc = makeFast();
  const events = [];
  svc.onStatusChange((id, s) => events.push(s));
  await svc.startAgent('openclaw');
  events.length = 0;
  const r = await svc.restartAgent('openclaw');
  assert.equal(r, 'RUNNING');
  assert.deepEqual(events, ['STOPPING', 'STOPPED', 'STARTING', 'RUNNING']);
});

test('newSession：追加置顶为当前会话，输出为空；switchSession 切回种子会话有演示输出', async () => {
  const svc = makeFast();
  const before = await svc.listSessions('hermes');
  assert.equal(before.length, 3);
  const meta = await svc.newSession('hermes');
  const after = await svc.listSessions('hermes');
  assert.equal(after.length, 4);
  assert.equal(after[0].id, meta.id, '新会话应排在列表首位');
  assert.deepEqual(await svc.getOutput('hermes'), [], '新会话输出为空');
  const back = await svc.switchSession('hermes', before[0].id);
  assert.equal(back.id, before[0].id);
  const out = await svc.getOutput('hermes');
  assert.ok(out.length >= 3, '种子会话应有演示输出');
  assert.ok(out.some((e) => e.kind === 'system' && /stub/.test(e.text)));
});

test('clearOutput → undoClearOutput：清空后可完整恢复', async () => {
  const svc = makeFast();
  const orig = await svc.getOutput('openclaw');
  await svc.clearOutput('openclaw');
  assert.deepEqual(await svc.getOutput('openclaw'), []);
  const restored = await svc.undoClearOutput('openclaw');
  assert.ok(Array.isArray(restored) && restored.length === orig.length);
  assert.deepEqual(await svc.getOutput('openclaw').then((r) => r.map((e) => e.id)), orig.map((e) => e.id));
  assert.equal(await svc.undoClearOutput('openclaw'), null, '二次撤销应返回 null');
});

test('sendInput：回显 + ≥2 行模拟响应经 onOutput 推送，含流式打字机条目', async () => {
  const svc = makeFast();
  const pushed = [];
  svc.onOutput((id, e) => pushed.push(e));
  await svc.sendInput('hermes', '你好');
  const kinds = pushed.map((e) => e.kind);
  assert.equal(kinds[0], 'user', '第一条应为回显');
  assert.ok(kinds.filter((k) => k === 'agent').length >= 2, '至少 2 行 agent 响应');
  const streamEntries = pushed.filter((e) => e.streaming !== undefined);
  assert.ok(streamEntries.length >= 5, '打字机条目应有多次分片更新');
  const finalStream = streamEntries[streamEntries.length - 1];
  assert.equal(finalStream.streaming, false, '流式条目应结束');
  assert.ok(finalStream.text.length > 10, '流式条目最终文本完整');
  assert.ok(pushed.some((e) => e.text.includes('你好')), '回显包含输入文本');
});

test('copyOutput：返回包含条目文本的非空字符串', async () => {
  const svc = makeFast();
  const text = await svc.copyOutput('codex');
  assert.ok(typeof text === 'string' && text.length > 0);
  const out = await svc.getOutput('codex');
  assert.ok(text.includes(out[0].text));
});

test("exportSession：md 与 json 两种格式均为真实结构", async () => {
  const svc = makeFast();
  const sessions = await svc.listSessions('openclaw');
  const md = await svc.exportSession('openclaw', sessions[0].id, 'md');
  assert.match(md.filename, /^openclaw-.+\.md$/);
  assert.ok(md.content.startsWith('# '), 'md 应有标题');
  assert.ok(md.content.includes('## 输出'));
  assert.ok(md.content.includes('user:'), 'md 应包含条目行');
  const json = await svc.exportSession('openclaw', sessions[0].id, 'json');
  assert.match(json.filename, /\.json$/);
  const parsed = JSON.parse(json.content);
  assert.equal(parsed.session.id, sessions[0].id);
  assert.ok(Array.isArray(parsed.entries) && parsed.entries.length > 0);
});

test('pinAgent：置顶条目排前，可取消', async () => {
  const svc = makeFast();
  await svc.pinAgent('codex', true);
  let agents = await svc.listAgents();
  assert.equal(agents[0].id, 'codex');
  assert.equal(agents[0].pinned, true);
  await svc.pinAgent('codex', false);
  agents = await svc.listAgents();
  assert.ok(agents.every((a) => !a.pinned));
});

test('__calls 记录全部调用方法名', async () => {
  const svc = makeFast();
  await svc.listAgents();
  await svc.startAgent('hermes');
  await svc.sendInput('hermes', 'x');
  const names = svc.__calls.map((c) => c.method);
  assert.ok(names.includes('listAgents') && names.includes('startAgent') && names.includes('sendInput'));
});

test('未知 agent id 应抛错（防呆）', async () => {
  const svc = makeFast();
  await assert.rejects(() => svc.startAgent('nonexistent'));
});

test('realAgentControlService：每方法都 throw not-wired-yet（骨架契约）', async () => {
  await assert.rejects(() => realAgentControlService.listAgents(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.startAgent('hermes'), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.exportSession('hermes', 's', 'md'), /not-wired-yet/);
  assert.throws(() => realAgentControlService.onStatusChange(() => {}), /not-wired-yet/);
});
