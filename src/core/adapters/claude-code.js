import { AgentAdapter } from './base.js';

/** Claude Code CLI 适配器（Anthropic）。 */
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
      },
      deps,
    );
  }
}
