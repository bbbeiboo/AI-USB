import { AgentAdapter, portableNodeExecutable } from './base.js';
import { portablePath } from '../portable-root.js';

/**
 * OpenClaw 适配器。
 * 启动：openclaw gateway run（WebSocket Gateway，HTTP :18789，常驻后台）。
 * --allow-unconfigured：首次运行尚无 gateway.mode=local 配置，否则拒绝启动。
 */
export class OpenClawAdapter extends AgentAdapter {
  constructor(deps) {
    super(
      {
        id: 'openclaw',
        displayName: 'OpenClaw',
        command: 'openclaw',
        args: ['gateway', 'run', '--allow-unconfigured'],
        versionArgs: ['--version'],
        probe: { type: 'http', url: 'http://127.0.0.1:18789/health' },
        // 网关冷启动实测约 15-26s，默认 30s 在系统繁忙时会误报 startup-timeout
        startupTimeoutMs: 90000,
      },
      deps,
    );
  }

  /** 便携入口：随包分发的 openclaw npm 包（node openclaw.mjs）。 */
  portableExecutable() {
    const entry = portablePath('agents', 'OpenClaw', 'App', 'node_modules', 'openclaw', 'openclaw.mjs');
    return {
      command: portableNodeExecutable(),
      args: [entry],
      detectArgs: [entry],
      cwd: portablePath('agents', 'OpenClaw', 'App'),
    };
  }
}
