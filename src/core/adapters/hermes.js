import { AgentAdapter } from './base.js';
import { spawnDetached } from '../process-manager.js';

/**
 * Hermes Agent 适配器。
 * 安装探测：hermes --version。启动：hermes（交互式 TUI）。打开 UI：hermes desktop。
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
        probe: null, // 无固定端口，进程存活即运行
      },
      deps,
    );
  }

  async open_ui() {
    const pid = spawnDetached('hermes', ['desktop'], '');
    return { ok: true, pid };
  }
}
