/**
 * Agent Manager —— 统一编排四个 Agent Adapter。
 * 持有共享运行状态与配置；对外提供 list/detect/start/stop/status 等能力。
 */
import { HermesAdapter } from './adapters/hermes.js';
import { CodexAdapter } from './adapters/codex.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import { OpenClawAdapter } from './adapters/openclaw.js';
import { readState, writeState } from './state.js';
import { getConfig, initConfig } from './config.js';
import { logger } from './logger.js';

const ADAPTER_DEFS = [
  ['openclaw', OpenClawAdapter],
  ['hermes', HermesAdapter],
  ['codex', CodexAdapter],
  ['claude-code', ClaudeCodeAdapter],
];

export class AgentManager {
  constructor() {
    initConfig();
    this.state = readState();
    this.appConfig = getConfig('app');
    this.agentConfigs = getConfig('agents');
    this.adapters = {};
    for (const [id, Adapter] of ADAPTER_DEFS) {
      const adapter = new Adapter({
        state: this.state,
        appConfig: this.appConfig,
        config: this.agentConfigs[id] ?? {},
        saveState: () => writeState(this.state),
      });
      this.adapters[id] = adapter;
    }
  }

  _adapter(id) {
    const a = this.adapters[id];
    if (!a) throw new Error(`Unknown agent: ${id}`);
    return a;
  }

  list() {
    return Object.values(this.adapters).map((a) => a.get_metadata());
  }

  async detectAll() {
    const out = {};
    for (const a of Object.values(this.adapters)) {
      out[a.id] = await a.detect_installation();
    }
    return out;
  }

  async statusAll() {
    const out = {};
    for (const a of Object.values(this.adapters)) {
      const status = await a.status();
      out[a.id] = { id: a.id, name: a.displayName, status, state: a.getState() };
    }
    return out;
  }

  async status(id) {
    const a = this._adapter(id);
    return { id: a.id, name: a.displayName, status: await a.status(), state: a.getState() };
  }

  async start(id) {
    return this._adapter(id).start();
  }

  async stop(id) {
    return this._adapter(id).stop();
  }

  async restart(id) {
    return this._adapter(id).restart();
  }

  async startAll() {
    const results = {};
    for (const a of Object.values(this.adapters)) {
      results[a.id] = await a.start();
    }
    return results;
  }

  async stopAll() {
    const results = {};
    for (const a of Object.values(this.adapters)) {
      results[a.id] = await a.stop();
    }
    return results;
  }
}

export function createManager() {
  return new AgentManager();
}
