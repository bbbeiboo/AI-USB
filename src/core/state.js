/**
 * 运行状态持久化：data/state.json 记录每个 Agent 的 PID / start_time / status。
 * PID 只是辅助信息，真正的「是否可用」由 health_check 决定。
 */
import fs from 'node:fs';
import path from 'node:path';
import { portablePath } from './portable-root.js';

const STATE_FILE = () => portablePath('data', 'state.json');

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
  } catch {
    return { agents: {} };
  }
}

export function writeState(state) {
  const dir = portablePath('data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function getAgentState(state, id) {
  return state.agents[id] ?? { pid: null, start_time: null, status: 'Unknown' };
}

export function setAgentState(state, id, patch) {
  state.agents[id] = { ...getAgentState(state, id), ...patch };
  return state;
}
