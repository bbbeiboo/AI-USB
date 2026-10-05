// 13.23 三 Agent 真实桥 mock e2e（零新依赖；全部经注入缝 mock，不触真实进程/网络）。
// OpenClaw：fake WebSocket + fake spawn + fake fetch（官方 Gateway WS 帧协议）。
// Codex：fake 子进程（官方 app-server NDJSON JSON-RPC）。
// Claude Code：fake 子进程（官方 CLI stream-json 流式协议）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import openclawMod from '../Launcher/App/openclaw-gateway.js';
import codexMod from '../Launcher/App/codex-appserver.js';
import claudeMod from '../Launcher/App/claude-cli-bridge.js';

const { createOpenClawGateway } = openclawMod;
const { createCodexAppServer } = codexMod;
const { createClaudeCliBridge } = claudeMod;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- OpenClaw fake WebSocket ----------
class FakeWS {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.listeners = {};
    FakeWS.last = this;
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  send(data) {
    const frame = JSON.parse(data);
    this.sent.push(frame);
    if (FakeWS.outgoing) FakeWS.outgoing(frame, this);
  }
  close(code, reason) { this.closed = { code, reason }; }
  // 测试侧（模拟 Gateway）
  open() { for (const fn of this.listeners.open || []) fn({}); }
  push(frame) { for (const fn of this.listeners.message || []) fn({ data: JSON.stringify(frame) }); }
}

/** fake Gateway：challenge → 响应 connect → 按测试脚本响应 req / 推送 event */
function fakeGateway(sock, { helloPayload } = {}) {
  const reqs = [];
  sock.open();
  sock.push({ type: 'event', event: 'connect.challenge', payload: { nonce: 'nonce-1', ts: 1728000000000 } });
  FakeWS.outgoing = (frame) => {
    if (frame.type !== 'req') return;
    reqs.push(frame);
    if (frame.method === 'connect') {
      sock.push({ type: 'res', id: frame.id, ok: true, payload: helloPayload ?? { auth: { scopes: ['operator.read', 'operator.write'], deviceToken: 'dev-token-1' } } });
    } else if (frame.method === 'sessions.list') {
      sock.push({ type: 'res', id: frame.id, ok: true, payload: { sessions: [
        { key: 'agent:main:main', displayName: '主会话', lastMessagePreview: '你好', updatedAt: 1728000000000, archived: false, pinned: false, hasActiveRun: false },
        { key: 'agent:main:old', label: '旧会话', archived: true },
      ] } });
    } else if (frame.method === 'chat.send') {
      sock.push({ type: 'res', id: frame.id, ok: true, payload: { runId: 'r1', status: 'accepted' } });
      const key = frame.params.sessionKey;
      setTimeout(() => {
        sock.push({ type: 'event', event: 'chat', payload: { runId: 'r1', sessionKey: key, seq: 0, state: 'delta', deltaText: '你好呀', replace: true } });
        sock.push({ type: 'event', event: 'agent', payload: { runId: 'r1', sessionKey: key, stream: 'thinking', seq: 1, ts: 1, data: { text: '思考中', delta: '思考中' } } });
        sock.push({ type: 'event', event: 'agent', payload: { runId: 'r1', sessionKey: key, stream: 'tool', seq: 2, ts: 2, data: { phase: 'start', name: 'terminal', toolCallId: 'c1' } } });
        sock.push({ type: 'event', event: 'agent', payload: { runId: 'r1', sessionKey: key, stream: 'tool', seq: 3, ts: 3, data: { phase: 'result', name: 'terminal', result: 'ok' } } });
        sock.push({ type: 'event', event: 'chat', payload: { runId: 'r1', sessionKey: key, seq: 4, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: '你好呀' }] }, stopReason: 'end_turn' } });
      }, 5);
    } else if (frame.method === 'chat.history') {
      sock.push({ type: 'res', id: frame.id, ok: true, payload: { messages: [
        { role: 'user', content: '早', timestamp: 1 },
        { role: 'assistant', content: '早安', timestamp: 2 },
      ] } });
    } else if (frame.method === 'sessions.patch') {
      sock.push({ type: 'res', id: frame.id, ok: true, payload: {} });
    } else if (frame.method === 'sessions.delete') {
      const once = reqs.filter((r) => r.method === 'sessions.delete').length;
      if (once === 1) sock.push({ type: 'res', id: frame.id, ok: false, error: { code: 'PERMISSION_DENIED', message: 'missing scope operator.admin' } });
      else sock.push({ type: 'res', id: frame.id, ok: true, payload: {} });
    } else if (frame.method === 'chat.abort') {
      sock.push({ type: 'res', id: frame.id, ok: true, payload: { ok: true, aborted: true, runIds: ['r1'] } });
    } else {
      sock.push({ type: 'res', id: frame.id, ok: true, payload: {} });
    }
  };
  return reqs;
}

function makeOpenClaw() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-gw-test-'));
  const gw = createOpenClawGateway({
    nodeExe: 'node.exe',
    openclawEntry: 'openclaw.mjs',
    stateDir: path.join(dir, 'state'),
    configPath: path.join(dir, 'config.yaml'),
    deviceFile: path.join(dir, 'device.json'),
    wsOverride: FakeWS,
    fetchOverride: async () => ({ ok: true }),
    maxStartupRetries: 3,
    connectTimeoutMs: 2000,
    rpcTimeoutMs: 2000,
  });
  return { gw, dir };
}

/** 连接 fake gateway 并等 hello-ok 完成 */
async function connectOpenClaw(gw) {
  const p = gw.listSessions();
  await sleep(10);
  const reqs = fakeGateway(FakeWS.last);
  await p;
  return reqs;
}

test('openclaw：握手（challenge→v3 签名→connect→hello-ok）+ sessions.list → nativeSessionId=row.key', async () => {
  const { gw, dir } = makeOpenClaw();
  try {
    const reqs = await connectOpenClaw(gw);
    const connect = reqs.find((r) => r.method === 'connect');
    assert.ok(connect, 'connect req 已发出');
    assert.equal(connect.params.minProtocol, 4);
    assert.equal(connect.params.role, 'operator');
    assert.deepEqual(connect.params.scopes, ['operator.read', 'operator.write']);
    assert.match(connect.params.device.signature, /^[A-Za-z0-9_-]+$/, 'v3 签名 base64url');
    assert.equal(connect.params.device.signedAt, 1728000000000, 'signedAt=challenge.ts');
    assert.ok(connect.params.device.id.length === 64, 'deviceId=sha256hex');
    assert.equal(connect.params.device.nonce, 'nonce-1');
    assert.ok(gw.isAlive(), 'hello-ok 后存活');
    // 会话映射：nativeSessionId = row.key（sessionKey），title=displayName>label
    const r = await gw.listSessions();
    assert.equal(r[0].nativeSessionId, 'agent:main:main');
    assert.equal(r[0].title, '主会话');
    assert.equal(r[0].preview, '你好');
    assert.equal(r[1].nativeSessionId, 'agent:main:old');
    assert.equal(r[1].title, '旧会话');
    assert.equal(r[1].archived, true);
    assert.ok(fs.existsSync(path.join(dir, 'device.json')), '设备身份文件复用/生成');
  } finally { gw.close(); }
});

test('openclaw：发送回合（chat.send 幂等键 + 事件映射 text_replace/thinking/tool/message_end）', async () => {
  const { gw } = makeOpenClaw();
  try {
    await connectOpenClaw(gw);
    const events = [];
    await (async () => {
      for await (const ev of gw.streamMessage('agent:main:main', '你好')) events.push(ev);
    })();
    const sendReq = FakeWS.last.sent.find((f) => f.type === 'req' && f.method === 'chat.send');
    assert.ok(sendReq, 'chat.send 已发出');
    assert.ok(sendReq.params.idempotencyKey, '幂等键=客户端生成（必填）');
    assert.equal(sendReq.params.sessionKey, 'agent:main:main');

    assert.equal(events[0].type, 'message_start');
    const tr = events.find((e) => e.type === 'text_replace');
    assert.ok(tr, 'chat delta（replace 语义）→ text_replace');
    assert.equal(tr.text, '你好呀');
    assert.ok(events.some((e) => e.type === 'thinking' && e.text === '思考中'), 'agent thinking → thinking 增量');
    assert.ok(events.some((e) => e.type === 'tool_start' && e.name === 'terminal'));
    assert.ok(events.some((e) => e.type === 'tool_result' && e.name === 'terminal' && e.summary === 'ok'));
    const end = events[events.length - 1];
    assert.equal(end.type, 'message_end');
    assert.equal(end.stopReason, 'end_turn');
  } finally { gw.close(); }
});

test('openclaw：历史重放（chat.history → user_message/assistant）+ rename/archive/abort', async () => {
  const { gw } = makeOpenClaw();
  try {
    await connectOpenClaw(gw);
    const r = await gw.loadSession('agent:main:main');
    assert.deepEqual(r.history, [{ type: 'user_message', text: '早' }, { type: 'text_delta', text: '早安' }]);

    await gw.renameSession('agent:main:main', '新名字');
    const patch = FakeWS.last.sent.filter((f) => f.method === 'sessions.patch').pop();
    assert.equal(patch.params.key, 'agent:main:main');
    assert.equal(patch.params.label, '新名字', '官方原生重命名=label');

    await gw.archiveSession('agent:main:main', true);
    const arch = FakeWS.last.sent.filter((f) => f.method === 'sessions.patch').pop();
    assert.equal(arch.params.archived, true);

    await gw.stopGeneration('agent:main:main');
    const abort = FakeWS.last.sent.find((f) => f.method === 'chat.abort');
    assert.equal(abort.params.sessionKey, 'agent:main:main', '官方 chat.abort');
  } finally { gw.close(); }
});

test('openclaw：删除降级（operator.write 先 archivedOnly 删→权限不足→先归档再删）', async () => {
  const { gw } = makeOpenClaw();
  try {
    await connectOpenClaw(gw);
    await gw.deleteSession('agent:main:main');
    const deletes = FakeWS.last.sent.filter((f) => f.method === 'sessions.delete');
    assert.equal(deletes.length, 2);
    assert.equal(deletes[0].params.archivedOnly, true, 'operator.write 必须 archivedOnly:true');
    const patches = FakeWS.last.sent.filter((f) => f.method === 'sessions.patch');
    assert.ok(patches.some((f) => f.params.archived === true), '降级路径：先归档再删');
  } finally { gw.close(); }
});

// ---------- Codex fake 子进程 ----------
function fakeChild() {
  const c = {
    writes: [],
    killed: false,
    stdinEnded: false,
    handlers: {},
    stdout: { setEncoding() {}, on(type, fn) { c.handlers['stdout:' + type] = fn; } },
    stderr: { setEncoding() {}, on() {} },
    stdin: { write(d) { c.writes.push(...d.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))); return true; }, end() { c.stdinEnded = true; } },
    kill() { c.killed = true; },
    on(type, fn) { c.handlers[type] = fn; },
    emitLine(obj) { c.handlers['stdout:data'](JSON.stringify(obj) + '\n'); },
    emitExit(code) { c.handlers.exit && c.handlers.exit(code); },
    lastRequest() { return c.writes.filter((w) => w.id !== undefined && w.method).pop(); },
  };
  return c;
}

function respondTo(child, method, payload, { error } = {}) {
  const req = child.writes.find((w) => w.method === method && !w._responded && w.id !== undefined);
  if (!req) throw new Error('no pending request for ' + method);
  req._responded = true;
  child.emitLine(error ? { id: req.id, error } : { id: req.id, result: payload ?? {} });
}

function makeCodex() {
  const children = [];
  const srv = createCodexAppServer({
    nodeExe: 'node.exe',
    codexEntry: 'codex.js',
    codexHome: 'C:/codex-home',
    spawnOverride: () => { const c = fakeChild(); children.push(c); return c; },
    initTimeoutMs: 2000,
    rpcTimeoutMs: 2000,
  });
  return { srv, children };
}

/** 完成 initialize/initialized 握手 */
async function initCodex(c) {
  respondTo(c, 'initialize', { userAgent: 'codex/0.156.1', codexHome: 'C:/codex-home' });
  // 让响应微任务落地：ensureInitialized 继续 → 写 initialized 通知 + 后续 req
  await sleep(2);
}

test('codex：官方包装器 spawn + initialize/initialized + thread/list + thread/start', async () => {
  const { srv, children } = makeCodex();
  try {
    const listP = srv.listSessions();
    await sleep(10);
    const c = children[0];
    await initCodex(c);
    respondTo(c, 'thread/list', { data: [{ id: 'thread-1', name: '我的线程', preview: '早', createdAt: 1728000000, updatedAt: 1728000100 }] });
    const sessions = await listP;
    assert.equal(children.length, 1);
    assert.ok(c.writes[0].method === 'initialize' && c.writes[0].params.clientInfo, 'initialize{clientInfo}');
    assert.ok(c.writes.some((w) => w.method === 'initialized' && w.id === undefined), 'initialized 为通知（无 id）');
    assert.equal(sessions[0].nativeSessionId, 'thread-1', 'nativeSessionId=thread.id');
    assert.equal(sessions[0].title, '我的线程');
    // thread/start：thread/started 通知携带 thread.id
    const createP = srv.createSession();
    await sleep(5);
    respondTo(c, 'thread/start', { turn: null });
    c.emitLine({ method: 'thread/started', params: { thread: { id: 'th-new' } } });
    const meta = await createP;
    assert.equal(meta.nativeSessionId, 'th-new');
  } finally { srv.close(); }
});

test('codex：turn/start 流式（delta/thinking/tool）+ 回合中段 interrupt + failed→真实错误', async () => {
  const { srv, children } = makeCodex();
  try {
    const listP = srv.listSessions();
    await sleep(10);
    const c = children[0];
    await initCodex(c);
    respondTo(c, 'thread/list', { data: [] });
    await listP;

    const events = [];
    const sendP = (async () => {
      for await (const ev of srv.streamMessage('thread-1', 'hi')) events.push(ev);
    })();
    await sleep(5);
    respondTo(c, 'turn/start', {});
    c.emitLine({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 't1' } } });
    c.emitLine({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', delta: '你好' } });
    c.emitLine({ method: 'item/reasoning/summaryTextDelta', params: { threadId: 'thread-1', delta: '想' } });
    c.emitLine({ method: 'item/started', params: { threadId: 'thread-1', item: { id: 'i1', type: 'commandExecution', command: 'dir' } } });
    c.emitLine({ method: 'item/completed', params: { threadId: 'thread-1', item: { id: 'i1', type: 'commandExecution', exitCode: 0 } } });
    await sleep(10); // 等生成器消费事件
    assert.equal(events[0].type, 'message_start');
    assert.ok(events.some((e) => e.type === 'text_delta' && e.text === '你好'));
    assert.ok(events.some((e) => e.type === 'thinking' && e.text === '想'));
    assert.ok(events.some((e) => e.type === 'tool_start' && String(e.name).includes('dir')));
    assert.ok(events.some((e) => e.type === 'tool_result' && e.summary === 'exit 0'));

    // 回合中段真实中断：turn/interrupt（threadId+turnId 官方必填）
    const stopP = srv.stopGeneration('thread-1');
    await sleep(5);
    const itp = c.lastRequest();
    assert.equal(itp.method, 'turn/interrupt');
    assert.deepEqual({ threadId: itp.params.threadId, turnId: itp.params.turnId }, { threadId: 'thread-1', turnId: 't1' });
    respondTo(c, 'turn/interrupt', {});
    c.emitLine({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 't1', status: 'interrupted' } } });
    await stopP;
    await sendP;
    const end = events[events.length - 1];
    assert.equal(end.type, 'message_end');
    assert.equal(end.stopReason, 'cancelled', '官方 interrupted → cancelled 语义');

    // failed：官方错误传播链 turn/completed failed → 真实错误（不假完成）
    const events2 = [];
    const send2 = (async () => {
      for await (const ev of srv.streamMessage('thread-1', 'hi2')) events2.push(ev);
    })().catch((e) => { events2.push({ type: 'THROWN', code: e.code }); });
    await sleep(5);
    respondTo(c, 'turn/start', {});
    c.emitLine({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 't2', status: 'failed', error: { message: 'Missing environment variable: OPENAI_API_KEY' } } } });
    await send2;
    assert.ok(events2.some((e) => e.type === 'error' && e.code === 'provider-auth'), 'failed→provider-auth');
    assert.equal(events2.filter((e) => e.type === 'message_end').pop().stopReason, 'error');
    assert.ok(events2.some((e) => e.type === 'THROWN' && e.code === 'provider-auth'), '发送 Promise 也真实失败');
  } finally { srv.close(); }
});

test('codex：审批请求自动 denied + rename/archive/delete + 历史重放', async () => {
  const { srv, children } = makeCodex();
  try {
    const listP = srv.listSessions();
    await sleep(10);
    const c = children[0];
    await initCodex(c);
    respondTo(c, 'thread/list', { data: [] });
    await listP;

    // 审批请求（Server→Client）：自动拒绝（真实拒绝，不伪造放行）
    const events = [];
    const sendP = (async () => { for await (const ev of srv.streamMessage('thread-1', 'x')) events.push(ev); })();
    await sleep(5);
    respondTo(c, 'turn/start', {});
    c.emitLine({ id: 99, method: 'execCommandApproval', params: { threadId: 'thread-1', callId: 'c9' } });
    const deny = c.writes.find((w) => w.id === 99);
    assert.deepEqual(deny.result, { decision: 'denied' });
    c.emitLine({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 't3', status: 'completed' } } });
    await sendP;
    assert.ok(events.some((e) => e.type === 'tool_result' && String(e.name).includes('execCommandApproval')), '审批拒绝有显式事件');

    // rename/archive/delete：官方原生通道（请求需逐个应答）
    const rp = srv.renameSession('thread-1', '改名');
    await sleep(2);
    respondTo(c, 'thread/name/set', {});
    await rp;
    assert.equal(c.lastRequest().method, 'thread/name/set');
    assert.deepEqual(c.lastRequest().params, { threadId: 'thread-1', name: '改名' });
    const ap = srv.archiveSession('thread-1', true);
    await sleep(2);
    respondTo(c, 'thread/archive', {});
    await ap;
    assert.equal(c.lastRequest().method, 'thread/archive');
    const up = srv.archiveSession('thread-1', false);
    await sleep(2);
    respondTo(c, 'thread/unarchive', {});
    await up;
    assert.equal(c.lastRequest().method, 'thread/unarchive');
    const dp = srv.deleteSession('thread-1');
    await sleep(2);
    respondTo(c, 'thread/delete', {});
    await dp;
    assert.equal(c.lastRequest().method, 'thread/delete');

    // 历史重放：thread/resume + thread/items/list（不读 rollout JSONL）
    const loadP = srv.loadSession('thread-1');
    await sleep(5);
    respondTo(c, 'thread/resume', {});
    await sleep(2);
    respondTo(c, 'thread/items/list', { data: [
      { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: '早' }] },
      { id: 'a1', type: 'agentMessage', content: [{ type: 'text', text: '早安' }] },
      { id: 'r1', type: 'reasoning', content: [{ type: 'text', text: '（思考，不进重放）' }] },
    ] });
    const r = await loadP;
    assert.deepEqual(r.history, [{ type: 'user_message', text: '早' }, { type: 'text_delta', text: '早安' }]);
  } finally { srv.close(); }
});

// ---------- Claude Code fake 子进程 ----------
function makeClaude(overrides = {}) {
  const children = [];
  const bridge = createClaudeCliBridge({
    command: 'claude.cmd',
    configDir: 'C:/claude-config',
    spawnOverride: (cmd, args) => {
      const c = fakeChild();
      c.cmd = cmd; c.args = args;
      children.push(c);
      return c;
    },
    interruptGraceMs: 60,
    ...overrides,
  });
  return { bridge, children };
}

async function runTurn(bridge, sid, text) {
  const events = [];
  for await (const ev of bridge.streamMessage(sid, text)) events.push(ev);
  return events;
}

test('claude：懒 spawn（--session-id）+ init 回读 + stream_event 增量 + result 终态', async () => {
  const { bridge, children } = makeClaude();
  try {
    const meta = await bridge.createSession();
    const sid = meta.nativeSessionId;
    assert.match(sid, /^[0-9a-f-]{36}$/i, '新建会话=官方 --session-id uuid');

    const turnP = runTurn(bridge, sid, 'hi');
    await sleep(10);
    assert.equal(children.length, 1, '懒 spawn：首条消息才起进程');
    const c = children[0];
    assert.equal(c.cmd, 'claude.cmd');
    assert.ok(c.args.includes('--input-format') && c.args.includes('stream-json'), '官方流式输入');
    assert.ok(c.args.includes('--output-format') && c.args.includes('stream-json'), '官方流式输出');
    assert.ok(c.args.includes('--include-partial-messages'));
    assert.ok(c.args.includes('--session-id') && c.args.includes(sid), '首启指定官方 --session-id');

    c.emitLine({ type: 'system', subtype: 'init', session_id: sid, model: 'm' });
    await sleep(5);
    const userLine = c.writes.find((w) => w.type === 'user');
    assert.equal(userLine.message.role, 'user');
    assert.equal(userLine.message.content[0].text, 'hi');

    c.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } } });
    c.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '思考' } } });
    c.emitLine({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu1', name: 'Bash', input: {} } } });
    c.emitLine({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'done' }] } });
    c.emitLine({ type: 'result', subtype: 'success', is_error: false, result: '你好', session_id: sid });
    const events = await turnP;
    assert.equal(events[0].type, 'message_start');
    assert.ok(events.some((e) => e.type === 'text_delta' && e.text === '你好'));
    assert.ok(events.some((e) => e.type === 'thinking' && e.text === '思考'));
    assert.ok(events.some((e) => e.type === 'tool_start' && e.name === 'Bash'));
    assert.ok(events.some((e) => e.type === 'tool_result' && e.name === 'Bash' && e.summary === 'done'));
    assert.equal(events[events.length - 1].type, 'message_end');
  } finally { bridge.close(); }
});

test('claude：result is_error→error 事件；进程死亡后官方 --resume 续接；interrupt 线格式', async () => {
  const { bridge, children } = makeClaude();
  try {
    const meta = await bridge.createSession();
    const sid = meta.nativeSessionId;
    // 错误回合（result is_error → 显式 error 事件，不伪造成功）
    const events1 = runTurn(bridge, sid, 'x');
    await sleep(10);
    const c1 = children[0];
    c1.emitLine({ type: 'system', subtype: 'init', session_id: sid });
    await sleep(5);
    c1.emitLine({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'quota exceeded', session_id: sid });
    const ev1 = await events1;
    assert.ok(ev1.some((e) => e.type === 'error' && /quota/.test(e.message)));
    assert.equal(ev1[ev1.length - 1].stopReason, 'error');
    // 进程自然退出（一次性回合语义）
    c1.emitExit(0);

    // 续接：进程死亡后官方 --resume
    const turnP = runTurn(bridge, sid, 'y');
    await sleep(10);
    const c2 = children[1];
    assert.ok(c2, '重新 spawn');
    assert.ok(c2.args.includes('--resume') && c2.args.includes(sid), '官方 --resume 续接');
    c2.emitLine({ type: 'system', subtype: 'init', session_id: sid });
    await sleep(5);
    const finish = (async () => {
      c2.emitLine({ type: 'result', subtype: 'success', is_error: false, session_id: sid });
      await turnP;
    })();
    await finish;
    c2.emitExit(0);

    // interrupt：官方 control_request 线格式 + control_response
    const p3 = runTurn(bridge, sid, 'z');
    await sleep(10);
    const c3 = children[2];
    c3.emitLine({ type: 'system', subtype: 'init', session_id: sid });
    await sleep(5);
    const stopP = bridge.stopGeneration(sid);
    await sleep(5);
    const ctrl = c3.writes.find((w) => w.type === 'control_request');
    assert.equal(ctrl.request.subtype, 'interrupt', '官方 control_request interrupt');
    c3.emitLine({ type: 'control_response', response: { subtype: 'success', request_id: ctrl.request_id } });
    await stopP;
    assert.equal(c3.killed, false, '有应答 → 不 kill');
    // 兜底 kill：无应答
    const stopQ = bridge.stopGeneration(sid);
    await sleep(120);
    assert.equal(c3.killed, true, '无应答 → kill 兜底（真实取消）');
    await stopQ;
    // 回合收尾：kill 后进程退出 → 回合以 process_exit 真实落定
    c3.emitExit(1);
    await p3;
  } finally { bridge.close(); }
});

test('claude：--resume 失败=官方孤儿探测（session-not-found/offline 原样上抛，不悬死）', async () => {
  const { bridge, children } = makeClaude();
  try {
    const meta = await bridge.createSession();
    const sid = meta.nativeSessionId;
    const p1 = runTurn(bridge, sid, 'x');
    await sleep(10);
    const c1 = children[0];
    c1.emitLine({ type: 'system', subtype: 'init', session_id: sid });
    await sleep(5);
    c1.emitLine({ type: 'result', subtype: 'success', is_error: false, session_id: sid });
    await p1;
    c1.emitExit(0);
    // 会话已被外部删除：resume 启动即退出（CLI 非零退出，stderr 报会话不存在）
    const p2 = runTurn(bridge, sid, 'x');
    await sleep(10);
    const c2 = children[1];
    assert.ok(c2.args.includes('--resume'), '官方 --resume 探测');
    c2.emitExit(1);
    await assert.rejects(p2, (e) => e.code === 'session-not-found' || e.code === 'offline');
  } finally { bridge.close(); }
});
