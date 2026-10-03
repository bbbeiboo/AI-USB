/**
 * AgentAdapter 基类 —— 所有 Agent 必须实现统一接口（CODEX.md §7）。
 *
 * 状态机（CODEX.md §8）：
 *   Unknown / NotInstalled / Stopped / Starting / Running / Stopping / Error / Updating
 *
 * 状态只来自 Process Manager + Health Check，UI 不得自行猜测。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnDetached, spawnNewConsole, spawnConsoleCommand, findAgentBySignature, isProcessAlive, terminateTree, runCommand } from '../process-manager.js';
import { healthCheck } from '../health-check.js';
import { logger } from '../logger.js';
import { portablePath } from '../portable-root.js';

/**
 * 便携 Node 可执行文件：优先使用随包分发的 Runtime\Node\node.exe，
 * 缺失时回退到当前进程的 node（开发态）。
 */
export function portableNodeExecutable() {
  const bundled = portablePath('Runtime', 'Node', 'node.exe');
  return fs.existsSync(bundled) ? bundled : process.execPath;
}

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
    const cfg = this.deps.config ?? {};

    // 便携内置入口：优先于 PATH（打包态 Agent 随 U 盘分发，不依赖系统安装）
    const portable = this.portableExecutable();
    if (portable && fs.existsSync(portable.command)) {
      // cfg.args 为空数组时回退到适配器默认 args（用户配置不应覆盖空数组）
      const userArgs = (cfg.args && cfg.args.length > 0) ? cfg.args : (this.def.args ?? []);
      return {
        command: portable.command,
        args: [...(portable.args ?? []), ...userArgs],
        cwd: cfg.cwd || portable.cwd || this.def.cwd || '',
        mode: portable.mode ?? this.def.mode,
      };
    }

    // 便携入口不存在（开发态未带完整运行时）→ 回退用户配置 / PATH 裸命令
    const userArgs2 = (cfg.args && cfg.args.length > 0) ? cfg.args : (this.def.args ?? []);
    return {
      command: cfg.command ?? this.def.command,
      args: userArgs2,
      cwd: cfg.cwd ?? this.def.cwd ?? '',
      mode: this.def.mode,
    };
  }

  /** 便携可执行入口：返回 { command, args?, cwd?, mode? } 或 null。子类覆盖。 */
  portableExecutable() {
    return null;
  }

  /** 进程命令行特征（用于控制台模式 PID 查找）。子类覆盖。 */
  processSignature() {
    return null;
  }

  /**
   * 便携启动脚本（.ps1）：控制台式 Agent 优先用它开窗口。
   * 脚本负责加载便携运行时、设置 HERMES_HOME/CODEX_HOME 等隔离变量后拉起 Agent。
   * 返回 { script, token } 或 null。子类覆盖。
   */
  portableScript() {
    return null;
  }

  /** 安装探测：默认用 `command --version`。子类可覆盖为更精确的探测。 */
  async detect_installation() {
    const portable = this.portableExecutable();
    let command, args;
    if (portable && fs.existsSync(portable.command)) {
      command = portable.command;
      // detectArgs 只含 CLI 入口（如 openclaw.mjs 路径），不含运行时模式参数（如 serve/gateway run）
      args = portable.detectArgs ?? [];
    } else {
      const resolved = this.resolveCommand();
      command = resolved.command;
      args = []; // PATH 裸命令检测不需要 args
    }
    const probeArgs = [...args, ...(this.def.versionArgs ?? ['--version'])];
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
    const st = this.getState();
    // PID 快速检查（headless 模式 / console 模式已找到 PID）
    if (st.pid && isProcessAlive(st.pid)) return true;
    // 签名检查（console 模式 PID 未记录时，按命令行特征查找）
    if (!st.pid && st.signature) return findAgentBySignature(st.signature) !== null;
    return false;
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

    const { command, args, cwd, mode } = this.resolveCommand();
    const isConsole = mode === 'console';
    logger.info(this.id, `start (${isConsole ? 'console' : 'headless'}): ${command} ${args.join(' ')}`);

    let pid;
    let signature = null;
    try {
      if (isConsole) {
        const scr = this.portableScript();
        if (scr && fs.existsSync(scr.script)) {
          // 优先走 ps1 启动脚本：Node spawn 的无头模式无法创建真实控制台，
          // 无头 TUI 会因 "stdin is not a terminal" 立即退出。
          spawnNewConsole(scr.script);
          signature = scr.token || path.basename(scr.script);
        } else {
          spawnConsoleCommand(command, args, cwd);
          signature = this.processSignature() ?? command.split(/[\\/]/).pop();
        }
      } else {
        pid = spawnDetached(command, args, cwd);
      }
    } catch (err) {
      this._set({ status: STATUS.Error, pid: null });
      logger.error(this.id, `spawn failed: ${err.message}`);
      return { ok: false, status: STATUS.Error, reason: 'spawn-failed', error: err.message };
    }

    // 控制台模式：定位承载 Agent 的持久进程（powershell -NoExit 窗口），并记录其 PID。
    // 该进程是 cmd.exe / Agent 的祖先，terminateTree 可整树回收。
    if (isConsole) {
      await sleep(4000);
      pid = signature ? findAgentBySignature(signature) : null;
      logger.info(this.id, `console root pid=${pid ?? 'not-found'} (signature=${signature})`);
      this._set({ status: STATUS.Running, pid, start_time: new Date().toISOString(), signature });
      return { ok: true, status: STATUS.Running, pid: pid ?? null, signature };
    }

    this._set({ status: STATUS.Starting, pid, start_time: new Date().toISOString() });

    // headless 模式：启动确认 + 健康探测
    // 超时可由适配器 def 声明（冷启动较慢的网关类 Agent），其次取用户配置
    const timeout = this.def.startupTimeoutMs
      ?? this.deps.config?.startupTimeoutMs
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
      this._set({ status: STATUS.Error });
      logger.error(this.id, 'startup timeout');
      return { ok: false, status: STATUS.Error, reason: 'startup-timeout' };
    }

    this._set({ status: STATUS.Running });
    logger.info(this.id, `running (pid=${pid})`);
    return { ok: true, status: STATUS.Running, pid };
  }

  async stop() {
    const st = this.getState();
    this._set({ status: STATUS.Stopping });
    let pid = st.pid;
    // 控制台模式：PID 未记录时用签名查找
    if (!pid && st.signature) {
      pid = findAgentBySignature(st.signature);
    }
    if (pid) {
      await terminateTree(pid);
    }
    this._set({ status: STATUS.Stopped, pid: null, start_time: null, signature: null });
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
