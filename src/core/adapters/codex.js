import { AgentAdapter, portableNodeExecutable } from './base.js';
import { portablePath } from '../portable-root.js';

/**
 * Codex CLI 适配器（OpenAI Codex）。
 * 交互式 TUI，需要真实控制台窗口 → mode: 'console'（新窗口启动）。
 * 注意：启动后需 `codex login` 完成身份认证。
 */
export class CodexAdapter extends AgentAdapter {
  constructor(deps) {
    super(
      {
        id: 'codex',
        displayName: 'Codex',
        command: 'codex',
        args: [],
        versionArgs: ['--version'],
        probe: null,
        mode: 'console',
      },
      deps,
    );
  }

  /** 便携入口：随包分发的 @openai/codex npm 包（node bin/codex.js），新控制台窗口。 */
  portableExecutable() {
    const entry = portablePath('agents', 'Codex', 'App', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    return {
      command: portableNodeExecutable(),
      args: [entry],
      detectArgs: [entry],
      cwd: portablePath('agents', 'Codex', 'App'),
      mode: 'console',
    };
  }

  /** 便携启动脚本：设置 CODEX_HOME 隔离，并打开可交互的真实控制台窗口。 */
  portableScript() {
    return { script: portablePath('Build', 'Scripts', 'start-codex.ps1'), token: 'start-codex.ps1' };
  }

  /** 进程命令行特征：用于控制台窗口 PID 查找。 */
  processSignature() {
    return 'codex.js';
  }
}
