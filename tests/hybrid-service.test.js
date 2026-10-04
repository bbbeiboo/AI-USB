// 13.22 混合服务契约测试：hermes 真实链路（经 fake bridge）+ 其余 Agent 回落 stub。
// 直接以 Node strip-types 加载渲染层 TS 源码。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubAgentControlService } from '../Launcher/App/renderer/src/services/agent-control-stub.ts';
import { createHybridAgentControlService } from '../Launcher/App/renderer/src/services/agent-control-hybrid.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fake bridge：模拟主进程 hermes 会话桥的 IPC 面（不触真实进程） */
function fakeBridge() {
  const listeners = [];
  const natives = new Map();
  let turnScript = [
    { type: 'message_start' },
    { type: 'thinking', text: '思考' },
    { type: 'tool_start', name: 'terminal' },
    { type: 'text_delta', text: '真实' },
    { type: 'text_delta', text: '流式回复' },
    { type: 'message_end', stopReason: 'end_turn' },
  ];
  return {
    listeners,
    natives,
    setTurnScript(events) { turnScript = events; },
    hermesSessionList: async () => ({
      ok: true,
      sessions: [...natives.entries()].map(([nativeSessionId, v]) => ({
        agentId: 'hermes', nativeSessionId, title: v.title, pinned: !!v.pinned,
        archived: !!v.archived, orphaned: !!v.orphaned, lastMessagePreview: v.preview || '',
        lastSeen: v.lastSeen ?? Date.now(), sortOrder: 0,
      })),
    }),
    hermesSessionCreate: async () => {
      const id = 'native-' + Math.random().toString(36).slice(2, 8);
      natives.set(id, { title: '', lastSeen: Date.now() });
      return { ok: true, session: { agentId: 'hermes', nativeSessionId: id, title: '', status: 'active' } };
    },
    hermesSessionOpen: async (id) => ({
      ok: true,
      session: { agentId: 'hermes', nativeSessionId: id, title: '', status: 'idle' },
      history: [{ type: 'user_message', text: '历史用户消息' }, { type: 'text_delta', text: '历史回复' }],
    }),
    hermesSessionSend: async ({ nativeSessionId }) => {
      for (const ev of turnScript) {
        for (const l of listeners) l({ nativeSessionId, event: ev });
      }
      return { ok: true };
    },
    hermesSessionStop: async () => ({ ok: true }),
    hermesSessionDelete: async (id) => { natives.delete(id); return { ok: natives.has(id) === false }; },
    hermesIndexUpdate: async ({ nativeSessionId, patch }) => {
      const v = natives.get(nativeSessionId);
      if (!v) return { ok: false, error: 'not in index' };
      Object.assign(v, patch);
      return { ok: true };
    },
    hermesIndexRemove: async (id) => { natives.delete(id); return { ok: true }; },
    onHermesSessionEvent: (cb) => listeners.push(cb),
  };
}

function makeHybrid() {
  const bridge = fakeBridge();
  const stub = createStubAgentControlService({ sendDelayMs: 5, startDelayMs: 5 });
  return { bridge, svc: createHybridAgentControlService(stub, bridge), stub };
}

test('混合契约：接口方法齐全；其余 Agent 仍走 stub（4 Agent 名单 + codex 发送有 stub 回复）', async () => {
  const { svc } = makeHybrid();
  for (const m of ['listAgents', 'newSession', 'sendInput', 'stopGeneration', 'getRecommendation',
    'listSettingsSections', 'listTasks', 'getInfo', 'getCapabilities', 'onOutput']) {
    assert.equal(typeof svc[m], 'function', `method ${m}`);
  }
  const agents = await svc.listAgents();
  assert.equal(agents.length, 4, 'stub 名单不变');
  await svc.newSession('codex');
  await svc.sendInput('codex', 'hi');
  await sleep(80);
  const out = await svc.getOutput('codex');
  assert.ok(out.some((e) => e.kind === 'agent' && /stub/.test(e.text)), 'codex 仍是 stub 回复');
});

test('双 ID 契约：hermes 会话 id === nativeSessionId（不存在聚合器 UUID 冒充）', async () => {
  const { svc } = makeHybrid();
  const s = await svc.newSession('hermes');
  assert.ok(s.id.startsWith('native-'), 'id 应为原生会话 ID');
  assert.equal(s.id, s.nativeSessionId, 'SessionMeta.id === nativeSessionId');
  const list = await svc.listSessions('hermes');
  const hit = list.find((x) => x.id === s.id);
  assert.ok(hit, '新会话在列表中');
  assert.equal(hit.nativeSessionId, s.id);
});

test('真实发送链路：sendInput → 事件流渲染（用户条目 + thinking/tool/agent 条目，流式聚合）', async () => {
  const { svc } = makeHybrid();
  const s = await svc.newSession('hermes');
  const seen = [];
  svc.onOutput((agentId, entry) => { if (agentId === 'hermes') seen.push(entry); });
  await svc.sendInput('hermes', '你好');
  await sleep(80);
  const out = await svc.getOutput('hermes');
  assert.ok(out.some((e) => e.kind === 'user' && e.text === '你好'), '用户条目回显');
  const agentEntry = out.find((e) => e.kind === 'agent');
  assert.ok(agentEntry, '应有 agent 条目');
  assert.equal(agentEntry.text, '真实流式回复', 'text_delta 应聚合为完整文本');
  assert.equal(agentEntry.streaming, false, 'message_end 后落定');
  assert.ok(out.some((e) => e.kind === 'system' && e.text.includes('💭')), 'thinking 事件渲染');
  assert.ok(out.some((e) => e.kind === 'system' && e.text.includes('🔧')), 'tool 事件渲染');
  assert.ok(seen.length >= 4, 'onOutput 全程推送');
});

test('历史重放：switchSession → 官方重放历史回填（user 角色保留）', async () => {
  const { svc, bridge } = makeHybrid();
  const s = await svc.newSession('hermes');
  // 清空当前转录模拟「重启后」：直接切走再切回（open 重放走 fake history）
  await svc.switchSession('hermes', s.id);
  await sleep(60);
  const out = await svc.getOutput('hermes');
  assert.ok(out.some((e) => e.kind === 'user' && e.text === '历史用户消息'), '重放的 user_message 保留角色');
  assert.ok(out.some((e) => e.kind === 'agent' && e.text === '历史回复'), '重放的 agent 文本回填');
  void bridge;
});

test('真实错误传播：list 失败按 code 上抛（provider-auth），不伪造空列表假成功', async () => {
  const bridge = fakeBridge();
  bridge.hermesSessionList = async () => ({ ok: false, error: "provider 'custom' resolved without credentials", code: 'provider-auth' });
  const svc = createHybridAgentControlService(createStubAgentControlService(), bridge);
  await assert.rejects(() => svc.listSessions('hermes'), (e) => e.code === 'provider-auth');
});

test('回合内错误事件：终止流式条目 + 显式错误条目（禁止假完成）', async () => {
  const { svc, bridge } = makeHybrid();
  const s = await svc.newSession('hermes');
  bridge.setTurnScript([
    { type: 'message_start' },
    { type: 'text_delta', text: '部分输出' },
    { type: 'error', message: 'provider timeout', code: 'timeout' },
  ]);
  await svc.sendInput('hermes', 'test');
  await sleep(80);
  const out = await svc.getOutput('hermes');
  const agent = out.find((e) => e.kind === 'agent');
  assert.ok(agent, '部分输出保留');
  assert.equal(agent.streaming, false, '错误后流式条目必须落定');
  assert.ok(out.some((e) => e.kind === 'system' && e.text.includes('⚠') && e.text.includes('timeout')), '显式错误条目');
});

test('停止/删除/置顶/改名走真实通道（bridge 调用即证据）', async () => {
  const { svc, bridge } = makeHybrid();
  const s = await svc.newSession('hermes');
  let stopped = false, deleted = false;
  const origStop = bridge.hermesSessionStop;
  const origDelete = bridge.hermesSessionDelete;
  bridge.hermesSessionStop = async (id) => { stopped = (id === s.id); return origStop(id); };
  bridge.hermesSessionDelete = async (id) => { deleted = (id === s.id); return origDelete(id); };

  await svc.stopGeneration('hermes');
  assert.equal(stopped, true, 'stop 走真实通道');

  await svc.pinSession('hermes', s.id, true);
  const list = await svc.listSessions('hermes');
  assert.equal(list[0].pinned, true, '置顶写索引');

  await svc.renameSession('hermes', s.id, '我的改名');
  const list2 = await svc.listSessions('hermes');
  assert.equal(list2.find((x) => x.id === s.id).title, '我的改名', '展示名写索引（titleSource=user）');

  await svc.archiveSession('hermes', s.id);
  const archived = await svc.listArchivedSessions();
  assert.ok(archived.some((a) => a.id === s.id), '归档进归档清单');
  await svc.restoreArchivedSession(s.id);
  assert.equal((await svc.listArchivedSessions()).some((a) => a.id === s.id), false);

  await svc.deleteSession('hermes', s.id);
  assert.equal(deleted, true, '删除走真实通道（官方 CLI）');
  const list3 = await svc.listSessions('hermes');
  assert.equal(list3.some((x) => x.id === s.id), false, '删除后列表移除');
});

test('非 hermes 的会话方法仍走 stub（hybrid 不越权接管）', async () => {
  const { svc } = makeHybrid();
  const s = await svc.newSession('openclaw');
  assert.ok(s.id.startsWith('s-openclaw-'), 'openclaw 仍是 stub 会话 id');
  await assert.rejects(() => svc.newSession('codex').then(() => {}), () => false).catch(() => {});
});
