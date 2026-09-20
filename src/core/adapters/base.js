/**
 * AgentAdapter 基类 —— 所有 Agent 必须实现统一接口（CODEX.md §7）。
 *
 * 状态机（CODEX.md §8）：
 *   Unknown / NotInstalled / Stopped / Starting / Running / Stopping / Error / Updating
 *
 * 状态只来自 Process Manager + Health Check，UI 不得自行猜测。
 */
import { spawnDetached, isProcessAlive, terminateTree, runCommand } from '../process-manager.js';
import { healthCheck } from '../health-check.js';
import { logger } from '../logger.js';

export const STATUS = {
  Unknown: 'Unknown',
  NotInstalled: 'NotInstalled',
  Stopped: 'Stopped',
  Starting: 'Starting',
  Running: 'Running',
  Stopping: 'Stopping',
  Error: 'Error',
  Updating: 'Updating',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate, { timeout, interval = 250 }) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(interval);
  }
  return await predicate();
}

export class AgentAdapter {
  /**
   * @param {object} def  适配器静态定义：{ id, displayName, command, args, cwd, health, probe, detect }
   * @param {object} deps { state (读写共享状态), config (agents.json 片段), saveState() }
   */
  constructor(def, deps) {
    this.id = def.id;
    this.displayName = def.displayName;
    this.def = def;
    this.deps = deps;
  }

  /* ---------------- 元数据 / 安装检测 ---------------- */

  get_metadata() {
    return { id: this.id, name: this.displayName, version: this.def.version ?? null };
  }

  /** 解析启动命令（子类可覆盖，例如适配 PATH 或便携内置运行时）。 */
  resolveCommand() {
    return {
      command: this.deps.config?.command ?? this.def.command,
      args: this.deps.config?.args ?? this.def.args ?? [],
      cwd: this.deps.config?.cwd ?? this.def.cwd ?? '',
    };
  }

  /** 安装探测：默认用 `command --version`。子类可覆盖为更精确的探测。 */
  async detect_installation() {
    const { command, args } = this.resolveCommand();
    const probeArgs = this.def.versionArgs ?? ['--version'];
    const r = await runCommand(command, probeArgs, { timeout: 15000 });
    if (r.ok) {
      return { installed: true, path: command, version: (r.stdout || r.stderr || '').split('\n')[0] };
    }
    return { installed: false, path: command, version: null };
  }

  async check_dependencies() {
    // 默认无额外依赖；子类覆盖（例如需要 Node/Git/Python）
    return { ok: true, missing: [] };
  }

  async get_version() {
    const inst = await this.detect_installation();
    return inst.version;
  }

  /* ---------------- 状态 / 进程 ---------------- */

  /** 记录的状态片段。 */
  getState() {
    return this.deps.state.agents[this.id] ?? { pid: null, start_time: null, status: STATUS.Unknown };
  }

  is_running() {
    const { pid } = this.getState();
    return isProcessAlive(pid);
  }

  /** 健康探测配置（子类可提供更具体的 probe）。 */
  getProbe() {
    return this.def.probe ?? null;
  }

  async health_check() {
    const { pid } = this.getState();
    if (!isProcessAlive(pid)) return { healthy: false, reason: 'not-running' };
    return healthCheck(pid, this.getProbe());
  }

  /* ---------------- 生命周期 ---------------- */

  /** 完整状态：结合安装态 + 进程态 + 健康态。 */
  async status() {
    const st = this.getState();
    if (st.status === STATUS.Starting) return STATUS.Starting;
    if (st.status === STATUS.Stopping) return STATUS.Stopping;
    if (st.status === STATUS.Updating) return STATUS.Updating;
    if (st.pid && isProcessAlive(st.pid)) return STATUS.Running;
    const inst = await this.detect_installation();
    return inst.installed ? STATUS.Stopped : STATUS.NotInstalled;
  }

  async start() {
    if (this.is_running()) {
      return { ok: false, status: STATUS.Running, reason: 'already-running' };
    }
    const inst = await this.detect_installation();
    if (!inst.installed) {
      this._set({ status: STATUS.NotInstalled, pid: null });
      return { ok: false, status: STATUS.NotInstalled, reason: 'not-installed' };
    }
    this._set({ status: STATUS.Starting });
    logger.info(this.id, `start: ${JSON.stringify(this.resolveCommand())}`);

    const { command, args, cwd } = this.resolveCommand();
    let pid;
    try {
      pid = spawnDetached(command, args, cwd);
    } catch (err) {
      this._set({ status: STATUS.Error, pid: null });
      logger.error(this.id, `spawn failed: ${err.message}`);
      return { ok: false, status: STATUS.Error, reason: 'spawn-failed', error: err.message };
    }

    this._set({ status: STATUS.Starting, pid, start_time: new Date().toISOString() });

    // 启动确认：进程存活即视为 Running；若配置了端口/HTTP 探测则等待其就绪（受启动超时约束）。
    const timeout = this.deps.config?.startupTimeoutMs
      ?? this.deps.appConfig?.startupTimeoutMs
      ?? 30000;
    const probe = this.getProbe();

    const ready = await waitFor(async () => {
      if (!isProcessAlive(pid)) return false; // 进程已退出
      if (!probe) return true; // 无额外探测 → 进程存活即就绪
      const hc = await healthCheck(pid, probe);
      return hc.healthy;
    }, { timeout });

    if (!isProcessAlive(pid)) {
      this._set({ status: STATUS.Error });
      logger.error(this.id, 'process exited during startup');
      return { ok: false, status: STATUS.Error, reason: 'exited-during-startup' };
    }
    if (!ready) {
      // 超时：进程仍在但未就绪
      this._set({ status: STATUS.Error });
      logger.error(this.id, 'startup timeout');
      return { ok: false, status: STATUS.Error, reason: 'startup-timeout' };
    }

    this._set({ status: STATUS.Running });
    logger.info(this.id, `running (pid=${pid})`);
    return { ok: true, status: STATUS.Running, pid };
  }

  async stop() {
    const { pid } = this.getState();
    this._set({ status: STATUS.Stopping });
    if (pid) {
      await terminateTree(pid);
    }
    this._set({ status: STATUS.Stopped, pid: null, start_time: null });
    logger.info(this.id, 'stopped');
    return { ok: true, status: STATUS.Stopped };
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  /* ---------------- UI / 配置 ---------------- */

  /** 打开 Agent 自己的 UI（默认空实现，子类覆盖）。 */
  async open_ui() {
    return { ok: false, reason: 'not-implemented' };
  }

  async configure() {
    return { ok: true };
  }

  /* ---------------- 内部 ---------------- */

  _set(patch) {
    const prev = this.deps.state.agents[this.id] ?? {};
    this.deps.state.agents[this.id] = { ...prev, ...patch };
    this.deps.saveState();
  }
}
