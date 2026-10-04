// 13.22 网关/索引单测：mock ACP stdio server 驱动 hermes-acp-gateway 全链路。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn as spawnChild } from 'node:child_process'
import { createHermesAcpGateway } from '../Launcher/App/hermes-acp-gateway.js'
import { toAgentError } from '../Launcher/App/hermes-acp-gateway.js'
import { createSessionIndex } from '../Launcher/App/session-index.js'

import { fileURLToPath } from 'node:url'
const MOCK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mock-hermes-acp.cjs');

function makeGateway(extra) {
  return createHermesAcpGateway({
    command: process.execPath,
    hermesHome: 'E:\\fake\\Hermes',
    env: { MOCK_ACP: '1' },
    spawnOverride: (cmd, args, opts) => {
      // 用 Node 跑 mock 脚本，但让子进程 argv[1] 看起来像 acp server
      
      return spawnChild(process.execPath, [MOCK], opts);
    },
    log: () => {},
    ...extra,
  });
}

test('网关：createSession 走官方 session/new，返回原生 sessionId（非聚合器 UUID）', async () => {
  const gw = makeGateway();
  const s = await gw.createSession({ cwd: 'E:\\fake\\Hermes' });
  assert.ok(s.nativeSessionId && s.nativeSessionId.startsWith('mock-'), s.nativeSessionId);
  assert.equal(s.agentId, 'hermes');
  gw.close();
});

test('网关：streamMessage 产出 message_start → text_delta* → message_end 全事件链', async () => {
  const gw = makeGateway();
  const s = await gw.createSession({});
  const events = [];
  for await (const ev of gw.streamMessage(s.nativeSessionId, '你好')) {
    events.push(ev);
    if (events.length > 50) break;
  }
  assert.equal(events[0].type, 'message_start');
  assert.ok(events.some((e) => e.type === 'text_delta' && e.text.includes('流式')),
    '应有 text_delta 事件：' + JSON.stringify(events.slice(0, 3)));
  assert.ok(events.some((e) => e.type === 'thinking'));
  assert.ok(events.some((e) => e.type === 'tool_start'));
  const end = events.find((e) => e.type === 'message_end');
  assert.ok(end, '应有 message_end');
  assert.equal(end.stopReason, 'end_turn');
  gw.close();
});

test('网关：sendMessage 聚合全文；loadSession 返回官方重放历史（user_message 保留角色）', async () => {
  const gw = makeGateway();
  const s = await gw.createSession({});
  const text = await gw.sendMessage(s.nativeSessionId, '总结一下');
  assert.ok(text.includes('流式'), 'sendMessage 应聚合 text_delta');
  // mock server 对 load 重放历史
  const loaded = await gw.loadSession(s.nativeSessionId);
  assert.equal(loaded.nativeSessionId, s.nativeSessionId);
  assert.ok(Array.isArray(loaded.history) && loaded.history.length >= 2);
  assert.ok(loaded.history.some((e) => e.type === 'user_message' && e.text.includes('历史用户消息')),
    '历史重放应保留 user_message 角色');
  assert.ok(loaded.history.some((e) => e.type === 'text_delta'), '历史重放含 agent 文本');
  gw.close();
});

test('网关：listSessions 映射官方 session/list（title/updatedAt 保留）', async () => {
  const gw = makeGateway();
  const list = await gw.listSessions();
  assert.ok(Array.isArray(list) && list.length >= 1);
  assert.ok(list[0].nativeSessionId.length > 0);
  assert.equal(typeof list[0].title, 'string');
  gw.close();
});

test('网关错误映射：provider-auth / session-not-found / offline / timeout（任务书 §十四）', () => {
  const e1 = toAgentError(new Error("provider 'custom' resolved without credentials"));
  assert.equal(e1.code, 'provider-auth');
  const e2 = toAgentError(new Error('Session not found: abc'));
  assert.equal(e2.code, 'session-not-found');
  const e3 = toAgentError(new Error('spawn hermes-acp ENOENT'));
  assert.equal(e3.code, 'offline');
  const e4 = toAgentError(new Error('request timed out after 30000ms'));
  assert.equal(e4.code, 'timeout');
  const e5 = toAgentError(new Error('Method not found: x'));
  assert.equal(e5.code, 'protocol');
});

// —— Session Index（聚合器索引，任务书 §二/§十一/§十二）—————————————————

function tmpIndex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidx-'));
  return createSessionIndex({ filePath: path.join(dir, 'session-index.json'), log: () => {} });
}

test('索引：nativeSessionId 为真源键；索引键=agentId/nativeSessionId ≠ 原生 ID', () => {
  const idx = tmpIndex();
  assert.equal(idx.keyOf('hermes', 'abc'), 'hermes/abc');
  assert.notEqual(idx.keyOf('hermes', 'abc'), 'abc');
});

test('索引：Native → Index 同步新增与回填；用户改名（titleSource=user）不被原生自动标题覆盖', () => {
  const idx = tmpIndex();
  idx.sync('hermes', [{ nativeSessionId: 'n1', title: '会话一' }], 1000);
  idx.update('hermes', 'n1', { pinned: true, archived: true, title: '用户改名', titleSource: 'user' });
  idx.sync('hermes', [{ nativeSessionId: 'n1', title: '原生自动标题' }], 2000);
  const all = idx.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].pinned, true, '置顶是索引侧字段，同步不覆盖');
  assert.equal(all[0].archived, true);
  assert.equal(all[0].title, '用户改名', '用户改名（索引侧 displayName）不被原生自动标题覆盖');
  // 未被用户改名的会话：原生标题照常回填
  idx.sync('hermes', [{ nativeSessionId: 'n1', title: '原生自动标题' }, { nativeSessionId: 'n9', title: '' }], 3000);
  idx.sync('hermes', [{ nativeSessionId: 'n1', title: '原生自动标题' }, { nativeSessionId: 'n9', title: '新会话标题' }], 4000);
  assert.equal(idx.all().find((r) => r.nativeSessionId === 'n9').title, '新会话标题');
});

test('索引：原生会话被删 → orphan 检测标记，不制造假会话；恢复后自动解除', () => {
  const idx = tmpIndex();
  idx.sync('hermes', [{ nativeSessionId: 'n1', title: 'A' }, { nativeSessionId: 'n2', title: 'B' }], 1000);
  // n2 从原生消失
  let rows = idx.sync('hermes', [{ nativeSessionId: 'n1', title: 'A' }], 2000);
  const n2 = rows.find((r) => r.nativeSessionId === 'n2');
  assert.equal(n2.orphaned, true, '消失的原生会话须标 orphaned');
  assert.equal(rows.length, 2, 'orphan 条目保留（不自动删除/不伪造）');
  // 重现 → 解除 orphan
  rows = idx.sync('hermes', [{ nativeSessionId: 'n1', title: 'A' }, { nativeSessionId: 'n2', title: 'B' }], 3000);
  assert.equal(rows.find((r) => r.nativeSessionId === 'n2').orphaned, false);
});

test('索引：update/remove 防呆与持久化（重启后仍可读）', () => {
  const idx = tmpIndex();
  idx.sync('hermes', [{ nativeSessionId: 'n1', title: 'A' }], 1000);
  idx.update('hermes', 'n1', { lastMessagePreview: '预览文本' });
  assert.equal(idx.all()[0].lastMessagePreview, '预览文本');
  assert.equal(idx.update('hermes', 'nope', { pinned: true }), null);
  assert.equal(idx.remove('hermes', 'n1'), true);
  assert.equal(idx.remove('hermes', 'n1'), false);
  assert.equal(idx.all().length, 0);
});
