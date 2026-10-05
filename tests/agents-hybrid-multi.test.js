// 13.23 四 Agent 混合服务交叉契约：6 对两两组合（任务书 §十三）。
// fake 完整桥（hermes 老通道 + 统一通道并存）驱动 hybrid，验证：
// 同时会话 / 事件隔离 / 取消隔离 / 错误隔离 / 索引隔离 / UNSUPPORTED 裁决。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubAgentControlService } from '../Launcher/App/renderer/src/services/agent-control-stub.ts';
import { createHybridAgentControlService } from '../Launcher/App/renderer/src/services/agent-control-hybrid.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 默认回合脚本：message_start → text_delta → message_end */
const defaultScript = (agentId) => [
  { type: 'message_start' },
  { type: 'text_delta', text: `回复-${agentId}` },
  { type: 'message_end', stopReason: 'end_turn' },
];

/** fake 完整桥：模拟主进程（hermes:* + agents:session:* 全套 IPC 面） */
function fakeFullBridge() {
  const listeners = [];
  const states = new Map(); // agentId → Map(nativeId → {title,pinned,archived,...})
  let scripts = {};
  const stopCalls = [];
  const deleteCalls = [];
  const renameCalls = [];
  const archiveCalls = [];
  const st = (agentId) => {
    if (!states.has(agentId)) states.set(agentId, new Map());
    return states.get(agentId);
  };
  const rowOf = (agentId, nativeSessionId, v = {}) => ({
    agentId, nativeSessionId,
    title: v.title || '', pinned: !!v.pinned, archived: !!v.archived, orphaned: !!v.orphaned,
    lastMessagePreview: v.preview || '', lastSeen: v.lastSeen ?? Date.now(), sortOrder: 0,
  });
  let seq = 0;
  const newId = (agentId) => `${agentId}-native-${++seq}`;
  return {
    listeners, scripts, stopCalls, deleteCalls, renameCalls, archiveCalls,
    setScripts(s) { scripts = s; },
    // —— hermes 老通道（13.22 形状，逐字保留）——
    hermesSessionList: async () => ({ ok: true, sessions: [...st('hermes').entries()].map(([id, v]) => rowOf('hermes', id, v)) }),
    hermesSessionCreate: async () => {
      const id = newId('hermes'); st('hermes').set(id, {});
      return { ok: true, session: { agentId: 'hermes', nativeSessionId: id, title: '', status: 'active' } };
    },
    hermesSessionOpen: async (id) => ({ ok: true, session: { agentId: 'hermes', nativeSessionId: id, title: '', status: 'idle' }, history: [{ type: 'user_message', text: 'hermes 历史' }] }),
    hermesSessionSend: async ({ nativeSessionId }) => {
      for (const ev of scripts['hermes'] ?? defaultScript('hermes')) {
        for (const l of listeners) l({ nativeSessionId, event: ev });
      }
      return { ok: true };
    },
    hermesSessionStop: async (id) => { stopCalls.push(['hermes', id]); return { ok: true }; },
    hermesSessionDelete: async (id) => { deleteCalls.push(['hermes', id]); st('hermes').delete(id); return { ok: true }; },
    hermesIndexUpdate: async ({ nativeSessionId, patch }) => {
      const v = st('hermes').get(nativeSessionId);
      if (!v) return { ok: false, error: 'not in index' };
      Object.assign(v, patch);
      return { ok: true };
    },
    hermesIndexRemove: async (id) => { st('hermes').delete(id); return { ok: true }; },
    onHermesSessionEvent: (cb) => listeners.push(cb),
    // —— 13.23 统一通道（openclaw/codex/claude-code）——
    agentSessionList: async (agentId) => ({ ok: true, sessions: [...st(agentId).entries()].map(([id, v]) => rowOf(agentId, id, v)) }),
    agentSessionCreate: async (agentId) => {
      const id = newId(agentId); st(agentId).set(id, {});
      return { ok: true, session: { agentId, nativeSessionId: id, title: '', status: 'idle' } };
    },
    agentSessionOpen: async (agentId, id) => ({ ok: true, session: { agentId, nativeSessionId: id, title: '', status: 'idle' }, history: [{ type: 'user_message', text: `${agentId} 历史` }] }),
    agentSessionSend: async ({ agentId, nativeSessionId }) => {
      for (const ev of scripts[agentId] ?? defaultScript(agentId)) {
        for (const l of listeners) l({ agentId, nativeSessionId, event: ev });
      }
      return { ok: true };
    },
    agentSessionStop: async (agentId, id) => { stopCalls.push([agentId, id]); return { ok: true }; },
    agentSessionDelete: async (agentId, id) => {
      deleteCalls.push([agentId, id]);
      if (agentId === 'claude-code') return { ok: false, code: 'unsupported', error: 'claude-code 无官方会话删除接口（能力裁决 UNSUPPORTED）' };
      st(agentId).delete(id);
      return { ok: true };
    },
    agentSessionRename: async (payload) => { renameCalls.push(payload); const v = st(payload.agentId).get(payload.nativeSessionId); if (v && payload.title) v.title = payload.title; return { ok: true }; },
    agentSessionArchive: async (payload) => { archiveCalls.push(payload); const v = st(payload.agentId).get(payload.nativeSessionId); if (v) v.archived = payload.archived !== false; return { ok: true }; },
    agentIndexUpdate: async ({ agentId, nativeSessionId, patch }) => {
      const v = st(agentId).get(nativeSessionId);
      if (!v) return { ok: false, error: 'not in index' };
      Object.assign(v, patch);
      return { ok: true };
    },
    agentIndexRemove: async ({ agentId, nativeSessionId }) => { st(agentId).delete(nativeSessionId); return { ok: true }; },
    onAgentSessionEvent: (cb) => listeners.push(cb),
  };
}

function makeHybrid() {
  const bridge = fakeFullBridge();
  const svc = createHybridAgentControlService(createStubAgentControlService({ sendDelayMs: 5, startDelayMs: 5 }), bridge);
  return { bridge, svc };
}

// —— 任务书 §十三：6 对两两组合 ——
const PAIRS = [
  ['openclaw', 'codex'],
  ['openclaw', 'claude-code'],
  ['openclaw', 'hermes'],
  ['codex', 'claude-code'],
  ['codex', 'hermes'],
  ['claude-code', 'hermes'],
];

for (const [A, B] of PAIRS) {
  test(`交叉契约 ${A} × ${B}：同时会话/事件隔离/索引隔离`, async () => {
    const { svc } = makeHybrid();
    const tagged = [];
    svc.onOutput((agentId, entry) => tagged.push([agentId, entry.kind, entry.text]));

    // 同时会话：两个 Agent 各自新建 + 发送
    const metaA = await svc.newSession(A);
    const metaB = await svc.newSession(B);
    assert.equal(metaA.id, metaA.nativeSessionId, `${A} 双 ID 契约`);
    assert.equal(metaB.id, metaB.nativeSessionId, `${B} 双 ID 契约`);
    assert.equal(metaA.agentId, A);
    assert.equal(metaB.agentId, B);

    await svc.sendInput(A, `问-${A}`);
    await svc.sendInput(B, `问-${B}`);
    await sleep(40);

    // 事件隔离：各自回复不串流；事件正确携带 agentId
    const outA = await svc.getOutput(A);
    const outB = await svc.getOutput(B);
    assert.ok(outA.some((e) => e.kind === 'agent' && e.text === `回复-${A}`), `${A} 回复在 ${A}`);
    assert.ok(outB.some((e) => e.kind === 'agent' && e.text === `回复-${B}`), `${B} 回复在 ${B}`);
    assert.equal(outA.some((e) => e.text === `回复-${B}`), false, `${A} 不见 ${B} 的回复（无跨 Agent 串流）`);
    assert.equal(outB.some((e) => e.text === `回复-${A}`), false, `${B} 不见 ${A} 的回复`);
    assert.ok(outA.some((e) => e.kind === 'user' && e.text === `问-${A}`));
    assert.ok(outB.some((e) => e.kind === 'user' && e.text === `问-${B}`));
    assert.ok(tagged.some(([id, kind, text]) => id === A && kind === 'agent' && text === `回复-${A}`), 'onOutput 载荷携带正确 agentId');
    assert.ok(tagged.some(([id, kind, text]) => id === B && kind === 'agent' && text === `回复-${B}`));
    assert.equal(tagged.some(([id, , text]) => id === A && text === `回复-${B}`), false);

    // 索引隔离：会话列表互不混入
    const listA = await svc.listSessions(A);
    const listB = await svc.listSessions(B);
    assert.ok(listA.some((s) => s.id === metaA.id), `${A} 列表含其会话`);
    assert.ok(listB.some((s) => s.id === metaB.id), `${B} 列表含其会话`);
    assert.equal(listA.some((s) => s.id === metaB.id), false, '索引隔离：A 列表无 B 会话');
    assert.equal(listB.some((s) => s.id === metaA.id), false, '索引隔离：B 列表无 A 会话');
  });
}

test('交叉契约：取消真实路由到各自 Agent 通道；A 停止不影响 B', async () => {
  const { svc, bridge } = makeHybrid();
  const a = await svc.newSession('openclaw');
  await svc.newSession('codex');
  await svc.sendInput('openclaw', 'q1');
  await svc.sendInput('codex', 'q2');
  await sleep(30);
  await svc.stopGeneration('openclaw');
  await sleep(10);
  assert.deepEqual(bridge.stopCalls, [['openclaw', a.id]], 'stop 只发给 openclaw');
});

test('交叉契约：错误隔离——hermes 回合出错不影响 codex（同时会话）', async () => {
  const { svc, bridge } = makeHybrid();
  await svc.newSession('hermes');
  await svc.newSession('codex');
  await svc.sendInput('codex', 'q-codex');
  await sleep(30);
  const codexOut1 = await svc.getOutput('codex');
  // hermes 注入错误回合
  bridge.setScripts({ hermes: [
    { type: 'message_start' },
    { type: 'text_delta', text: '部分输出' },
    { type: 'error', message: 'provider timeout', code: 'timeout' },
  ] });
  await svc.sendInput('hermes', 'q-hermes');
  await sleep(40);
  const hermesOut = await svc.getOutput('hermes');
  assert.ok(hermesOut.some((e) => e.kind === 'system' && e.text.includes('⚠') && e.text.includes('timeout')), 'hermes 显式错误条目');
  const codexOut2 = await svc.getOutput('codex');
  assert.deepEqual(codexOut2, codexOut1, 'codex 输出零变化（错误隔离）');
});

test('交叉契约：索引隔离——置顶/改名只影响本 Agent；openclaw/codex 走官方原生 rename', async () => {
  const { svc, bridge } = makeHybrid();
  const a = await svc.newSession('openclaw');
  const b = await svc.newSession('codex');
  await svc.pinSession('openclaw', a.id, true);
  const listA = await svc.listSessions('openclaw');
  assert.equal(listA[0].id, a.id, 'openclaw 置顶生效');
  const listB = await svc.listSessions('codex');
  assert.equal(listB.some((s) => s.pinned), false, 'codex 不受 openclaw 置顶影响');

  await svc.renameSession('openclaw', a.id, 'oc 改名');
  assert.deepEqual(bridge.renameCalls, [{ agentId: 'openclaw', nativeSessionId: a.id, title: 'oc 改名' }], 'openclaw rename=官方原生通道');
  await svc.renameSession('codex', b.id, 'cx 改名');
  assert.equal(bridge.renameCalls[1].agentId, 'codex');
  // claude-code：无官方 rename → 仅索引（renameCalls 不变）
  const c = await svc.newSession('claude-code');
  await svc.renameSession('claude-code', c.id, 'cc 改名');
  assert.equal(bridge.renameCalls.length, 2, 'claude-code 不走官方 rename 通道');
  const listC = await svc.listSessions('claude-code');
  assert.equal(listC.find((s) => s.id === c.id).title, 'cc 改名', '索引侧标题已更新');
});

test('UNSUPPORTED 裁决：claude-code delete 明确拒绝（真实 unsupported，不伪造成功）', async () => {
  const { svc } = makeHybrid();
  const c = await svc.newSession('claude-code');
  await assert.rejects(() => svc.deleteSession('claude-code', c.id), (e) => e.code === 'unsupported');
  // 归档删除永久项同样拒绝
  await assert.rejects(() => svc.deleteArchivedSessionForever(c.id), (e) => e.code === 'unsupported');
});

test('claude-code 会话：索引承载 + 打开（官方 --resume 语义在主进程；重放=空历史标注）', async () => {
  const { svc } = makeHybrid();
  const c = await svc.newSession('claude-code');
  await svc.sendInput('claude-code', '写个函数');
  await sleep(30);
  const out = await svc.getOutput('claude-code');
  assert.ok(out.some((e) => e.kind === 'agent' && e.text === '回复-claude-code'));
  // 切换重开：官方不提供整段重放 → 无伪造历史（history 为空、不报错）
  await svc.switchSession('claude-code', c.id);
  await sleep(30);
  const out2 = await svc.getOutput('claude-code');
  assert.ok(out2.some((e) => e.kind === 'user' && e.text === '写个函数'), '本次运行期转录保留');
});

test('归档交叉：openclaw 官方原生归档 / claude-code 索引归档，归档清单按 agentId 区分', async () => {
  const { svc, bridge } = makeHybrid();
  const a = await svc.newSession('openclaw');
  const c = await svc.newSession('claude-code');
  await svc.archiveSession('openclaw', a.id);
  assert.deepEqual(bridge.archiveCalls, [{ agentId: 'openclaw', nativeSessionId: a.id, archived: true }], 'openclaw 归档=官方原生');
  await svc.archiveSession('claude-code', c.id);
  assert.equal(bridge.archiveCalls.length, 1, 'claude-code 归档仅索引（agentIndexUpdate）');
  const archived = await svc.listArchivedSessions();
  assert.ok(archived.some((x) => x.agentId === 'openclaw' && x.id === a.id));
  assert.ok(archived.some((x) => x.agentId === 'claude-code' && x.id === c.id));
  await svc.restoreArchivedSession(c.id);
  const archived2 = await svc.listArchivedSessions();
  assert.equal(archived2.some((x) => x.agentId === 'claude-code' && x.id === c.id), false, '恢复只影响 claude-code 条目');
  assert.ok(archived2.some((x) => x.agentId === 'openclaw' && x.id === a.id), 'openclaw 条目不受影响');
});
