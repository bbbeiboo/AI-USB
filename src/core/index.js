/** 核心模块统一导出。 */
export { resolvePortableRoot, portablePath } from './portable-root.js';
export { logger } from './logger.js';
export { getConfig, saveConfig, initConfig, DEFAULT_CONFIG } from './config.js';
export { readState, writeState, getAgentState, setAgentState } from './state.js';
export {
  isProcessAlive,
  spawnDetached,
  terminateTree,
  runCommand,
} from './process-manager.js';
export { healthCheck, checkProcess, checkCli, checkPort, checkHttp } from './health-check.js';
export {
  UpdateManager,
  compareVersions,
  sha256File,
  downloadFile,
  fetchLatestRelease,
  selectAsset,
  PROTECTED_DIRS,
  isProtectedPath,
} from './update-manager.js';
export { AgentManager, createManager } from './agent-manager.js';
export { AgentAdapter, STATUS } from './adapters/base.js';
export { HermesAdapter } from './adapters/hermes.js';
export { CodexAdapter } from './adapters/codex.js';
export { ClaudeCodeAdapter } from './adapters/claude-code.js';
export { OpenClawAdapter } from './adapters/openclaw.js';
