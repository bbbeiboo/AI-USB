import { AgentAdapter } from './base.js';
import { portablePath } from '../portable-root.js';

/**
 * Claude Code CLI 适配器（Anthropic）。
 * 交互式 TUI，需要真实控制台窗口 → mode: 'console'（新窗口启动）。
 * 注意：启动后需 ANTHROPIC_API_KEY 或 `claude login` 完成认证。
 */
export class ClaudeCodeAdapter extends AgentAdapter {
  constructor(deps) {
    super(
      {
        id: 'claude-code',
        displayName: 'Claude Code',
        command: 'claude',
        args: [],
        versionArgs: ['--version'],
        probe: null,
        mode: 'console',
      },
      deps,
    );
  }

  /** 便携入口：随包分发的 claude.exe，新控制台窗口。 */
  portableExecutable() {
    return {
      command: portablePath('agents', 'ClaudeCode', 'App', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
      cwd: portablePath('agents', 'ClaudeCode', 'App'),
      mode: 'console',
    };
  }

  /** 便携启动脚本：设置 CLAUDE_CONFIG_DIR 隔离，并打开可交互的真实控制台窗口。 */
  portableScript() {
    return { script: portablePath('Build', 'Scripts', 'start-claude-code.ps1'), token: 'start-claude-code.ps1' };
  }

  /** 进程命令行特征：用于控制台窗口 PID 查找。 */
  processSignature() {
    return 'claude.exe';
  }
}
