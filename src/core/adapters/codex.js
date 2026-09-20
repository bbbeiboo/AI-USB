import { AgentAdapter } from './base.js';

/** Codex CLI 适配器（OpenAI Codex）。 */
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
      },
      deps,
    );
  }
}
