import { AgentAdapter } from './base.js';

/** OpenClaw 适配器。 */
export class OpenClawAdapter extends AgentAdapter {
  constructor(deps) {
    super(
      {
        id: 'openclaw',
        displayName: 'OpenClaw',
        command: 'openclaw',
        args: [],
        versionArgs: ['--version'],
        probe: null,
      },
      deps,
    );
  }
}
