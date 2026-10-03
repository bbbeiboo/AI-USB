/**
 * Agent 控制类 IPC 封装（preload.js 的 manifest / probe / agent 运行时部分）。
 *
 * ⚠️ 双 id 空间（本步最容易踩的坑，必须集中在这里处理，不要散落到组件里）
 * ---------------------------------------------------------------------------
 *  - agent id ：agents.json / agent:launch / agent:stop / agent:restart / agent:status
 *               取值 openclaw | hermes | codex | claude-code
 *  - config id：api-config:* / provider:test(cfgId) / DPAPI 密钥文件名
 *               取值 openclaw | hermes | codex | claudeCode   ← 只有 Claude Code 不同
 *
 * 成因：main.js 的 CONFIG_IDS 常量在 agents.json 定稿前就写成了驼峰 claudeCode，
 * 而 agents.json 用的是连字符 claude-code。本阶段不改后端（约束 3），
 * 所以只在渲染层做一次显式映射。旧 UI 是两处硬编码实现的：
 *   index.html L221 的 tabMap，以及 L260 的 (a.id === 'claude-code') ? 'claudeCode' : a.id。
 */
import { hasLauncher, ipc, safeInvoke } from './ipc'
import type {
  AgentActionResult,
  AgentStatusEvent,
  AgentStatusesResult,
  AgentStatusResult,
  ManifestResult,
  ProbeAgentsResult,
  StartAllResult,
  StopAllResult,
} from '@/types/launcher'

/** IPC 不可用时的统一兜底文案 */
const NO_IPC = 'IPC 不可用（preload.js 未加载）'

/** agent id -> config id 的映射表；不在表里的 id 原样返回（将来新增 Agent 只改这里） */
const AGENT_TO_CONFIG_ID: Record<string, string> = {
  openclaw: 'openclaw',
  hermes: 'hermes',
  codex: 'codex',
  'claude-code': 'claudeCode',
}

/** agent id -> config id（给 api-config:* / provider:test 用） */
export function toConfigId(agentId: string): string {
  return AGENT_TO_CONFIG_ID[agentId] ?? agentId
}

/** config id -> agent id（反查；把设置页选中的 config id 换回 agent id 时用） */
export function toAgentId(configId: string): string {
  const hit = Object.entries(AGENT_TO_CONFIG_ID).find(([, c]) => c === configId)
  return hit ? hit[0] : configId
}

/**
 * 设置页 Agent 切换用的标签。
 * 顺序与旧 UI 的 tabMap 完全一致，避免用户感觉"顺序变了"。
 * fallbackName 只在拿不到 manifest 时使用（有 manifest 时优先用 manifest 里的 name）。
 */
export const CONFIG_TABS: ReadonlyArray<{ configId: string; agentId: string; fallbackName: string }> = [
  { configId: 'openclaw', agentId: 'openclaw', fallbackName: 'OpenClaw' },
  { configId: 'hermes', agentId: 'hermes', fallbackName: 'Hermes' },
  { configId: 'codex', agentId: 'codex', fallbackName: 'Codex' },
  { configId: 'claudeCode', agentId: 'claude-code', fallbackName: 'Claude Code' },
]

// --- 启动 / 停止 / 重启 ------------------------------------------------------

/**
 * 启动一个 Agent。
 * 实际调用 preload.launch(id)，语义化命名避免代码/任务书两套叫法。
 * 注意：preload 里没有 startAgent，agent:launch 就是旧 UI「启动」按钮走的通道。
 */
export function startAgent(agentId: string): Promise<AgentActionResult> {
  return safeInvoke('launch', () => ipc.launch(agentId), { ok: false, reason: NO_IPC })
}

/** startAgent 的本名：服务层对外统一叫 launchAgent，startAgent 是任务书里的叫法 */
export const launchAgent = startAgent

/** 停止一个 Agent */
export function stopAgent(agentId: string): Promise<AgentActionResult> {
  return safeInvoke('stopAgent', () => ipc.stopAgent(agentId), { ok: false, reason: NO_IPC })
}

/** 重启一个 Agent */
export function restartAgent(agentId: string): Promise<AgentActionResult> {
  return safeInvoke('restartAgent', () => ipc.restartAgent(agentId), { ok: false, reason: NO_IPC })
}

/** 全部启动 */
export function startAllAgents(): Promise<StartAllResult> {
  return safeInvoke('startAllAgents', () => ipc.startAllAgents(), { ok: false, error: NO_IPC })
}

/** 全部停止 */
export function stopAllAgents(): Promise<StopAllResult> {
  return safeInvoke('stopAllAgents', () => ipc.stopAllAgents(), { ok: false, error: NO_IPC })
}

// --- 状态查询 ---------------------------------------------------------------

/** 读取全部 Agent 的运行时状态（返回 { [agentId]: { agentId, status, pid, startedAt } }） */
export function getAgentStatuses(): Promise<AgentStatusesResult> {
  return safeInvoke('getAgentStatuses', () => ipc.getAgentStatuses(), { ok: false, error: NO_IPC })
}

/** 读取单个 Agent 的运行时状态 */
export function getAgentStatus(agentId: string): Promise<AgentStatusResult> {
  return safeInvoke('getAgentStatus', () => ipc.getAgentStatus(agentId), { ok: false, error: NO_IPC })
}

// --- 事件订阅 ---------------------------------------------------------------

/**
 * 订阅主进程的 Agent 状态推送。
 *
 * ⚠️ preload.js 的 onAgentStatus 返回的是 ipcRenderer.on(...) 的返回值，
 * 没有把 removeListener 暴露出来 —— 也就是说**注册之后无法取消订阅**。
 * 叠加 main.tsx 里的 React StrictMode（开发期 effect 会执行两次），
 * 在 useEffect 里无脑注册会导致回调重复触发。
 * 因此调用方必须自己做一次性守卫（例如模块级 subscribed 标记），
 * 4.3 的 Agent 控制台会按这个约定实现。
 */
export function onAgentStatus(cb: (payload: AgentStatusEvent) => void): void {
  if (!hasLauncher) return
  ipc.onAgentStatus(cb)
}

/** 订阅托盘"请求退出"事件（同样无法取消订阅） */
export function onTrayQuit(cb: () => void): void {
  if (!hasLauncher) return
  ipc.onTrayQuit(cb)
}

/** 订阅主进程的 Agent 状态重同步事件（同样无法取消订阅） */
export function onAgentResync(cb: () => void): void {
  if (!hasLauncher) return
  ipc.onAgentResync(cb)
}

// --- manifest / probe ------------------------------------------------------

/** 读取 agents.json 清单（含 root / logPath 等运行时信息） */
export function getManifest(): Promise<ManifestResult> {
  return safeInvoke('getManifest', () => ipc.getManifest(), { ok: false, error: NO_IPC })
}

/** 探测四个 Agent 的版本与可用性（可能耗时，内部会逐个起进程跑 --version） */
export function probeAgents(): Promise<ProbeAgentsResult> {
  return safeInvoke('probeAgents', () => ipc.probeAgents(), { ok: false, error: NO_IPC })
}
