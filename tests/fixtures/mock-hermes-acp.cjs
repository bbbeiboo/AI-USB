// Mock Hermes ACP stdio server（13.22 网关单测用）——实现 initialize / session/new /
// session/list / session/load / session/prompt / session/cancel 的最小官方语义面。
const readline = require('node:readline');

const rl = readline.createInterface({ input: process.stdin });
const sessions = new Set();

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function update(sessionId, u) { send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: u } }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  (async () => {
    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, sessionCapabilities: { fork: {}, list: {}, resume: {} } },
          agentInfo: { name: 'mock-hermes', version: '0.0.0' },
          authMethods: [],
        });
        break;
      case 'session/new':
        await sleep(50);
        sessions.add(params.cwd || 'x');
        reply(id, { sessionId: 'mock-' + Math.random().toString(36).slice(2, 10), models: [], modes: [] });
        break;
      case 'session/list':
        reply(id, { sessions: [{ sessionId: 'mock-listed-1', cwd: 'E:\\fake\\Hermes', title: 'Mock 会话', updated_at: '2026-10-04T00:00:00Z' }], next_cursor: null });
        break;
      case 'session/load':
        // 官方语义：先重放历史（user/agent 各一条）再响应
        update(params.sessionId, { sessionUpdate: 'user_message_chunk', content: [{ type: 'text', text: '历史用户消息' }] });
        await sleep(30);
        update(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: '历史助手回复' }] });
        await sleep(30);
        reply(id, { modes: [] });
        break;
      case 'session/prompt': {
        const sessionId = params.sessionId;
        await sleep(20);
        update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: [{ type: 'text', text: '思考中' }] });
        await sleep(20);
        update(sessionId, { sessionUpdate: 'tool_call', title: 'terminal', kind: 'execute', rawInput: { cmd: 'echo' } });
        await sleep(20);
        for (const part of ['流式', '回复', '分片']) {
          update(sessionId, { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: part }] });
          await sleep(20);
        }
        update(sessionId, { sessionUpdate: 'session_info_update', title: '自动标题' });
        reply(id, { stopReason: 'end_turn' });
        break;
      }
      case 'session/cancel':
        reply(id, {});
        break;
      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found', data: { method } } });
    }
  })();
});
