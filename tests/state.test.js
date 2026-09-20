import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readState, writeState, getAgentState, setAgentState } from '../src/core/state.js';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usb-state-'));
process.env.PORTABLE_ROOT = ROOT;

test('无状态文件时 readState 返回空结构', () => {
  const s = readState();
  assert.deepEqual(s, { agents: {} });
});

test('writeState 后 readState 可读回', () => {
  writeState({ agents: { hermes: { pid: 123, status: 'Running' } } });
  const s = readState();
  assert.equal(s.agents.hermes.pid, 123);
  assert.equal(s.agents.hermes.status, 'Running');
});

test('setAgentState 合并而非覆盖', () => {
  let s = { agents: {} };
  s = setAgentState(s, 'codex', { pid: 5 });
  s = setAgentState(s, 'codex', { status: 'Running' });
  assert.equal(s.agents.codex.pid, 5);
  assert.equal(s.agents.codex.status, 'Running');
});
