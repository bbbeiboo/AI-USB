import { AgentAdapter } from './base.js';
import { spawnDetached } from '../process-manager.js';
import { portablePath } from '../portable-root.js';

/**
 * Hermes Agent 适配器。
 * Hermes 是交互式 TUI（prompt_toolkit），必须运行在真实控制台窗口内，
 * 无头 spawn 会报 NoConsoleScreenBufferError 并退出。
 * 因此按 mode: 'console' 启动：通过 Build\Scripts\start-hermes.ps1 打开 cmd 窗口，
 * 脚本内设置 HERMES_HOME 指向项目安装目录（隔离机器级 D:\Hermes）。
 * 打开桌面 UI：hermes desktop。
 */
export class HermesAdapter extends AgentAdapter {
  constructor(deps) {
    super(
      {
        id: 'hermes',
        displayName: 'Hermes',
        command: 'hermes',
        args: [],
        versionArgs: ['--version'],
        probe: null,
        mode: 'console',
      },
      deps,
    );
  }

  /** 便携入口：随包分发的 hermes.exe。 */
  portableExecutable() {
    return { command: portablePath('agents', 'Hermes', 'bin', 'hermes.exe'), cwd: portablePath('agents', 'Hermes'), mode: 'console' };
  }

  /** 便携启动脚本：设置 HERMES_HOME 隔离并打开可交互的控制台窗口。 */
  portableScript() {
    return { script: portablePath('Build', 'Scripts', 'start-hermes.ps1'), token: 'start-hermes.ps1' };
  }

  /** 进程命令行特征：用于控制台窗口 PID 查找。 */
  processSignature() {
    return 'hermes.exe';
  }

  /** 打开 Hermes 桌面 UI（hermes desktop）。 */
  async open_ui() {
    const { command, cwd } = this.portableExecutable();
    const pid = spawnDetached(command, ['desktop'], cwd);
    return { ok: true, pid };
  }
}
