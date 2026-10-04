/**
 * realAgentControlService —— 下一轮真接线的骨架（本轮每方法都 throw not-wired-yet）。
 * ---------------------------------------------------------------------------
 * 本文件是「唯一切换点」的另一半：factory 切到 real 后，UI 代码零改动。
 *
 * 【下一轮通道映射表（定死不改动）】
 * | 方法                  | 通道/来源                              | preload 现状 |
 * |-----------------------|----------------------------------------|--------------|
 * | listAgents            | manifest:get + agents:probe            | 已有（getManifest/probeAgents） |
 * | getAgentStatus        | agents:status                          | 已有（getAgentStatuses） |
 * | startAgent            | agent:launch                           | 已有（launch，13.12 真机实测闭环） |
 * | stopAgent             | agent:stop                             | 已有（stopAgent） |
 * | restartAgent          | agent:restart                          | 已有（restartAgent） |
 * | onStatusChange        | agent:status 推送                      | 已有（onAgentStatus；⚠不可退订，需模块级一次守卫，见 agent-client.ts） |
 * | newSession/listSessions/switchSession | 需新增 agent:sessions  | 无 |
 * | renameSession/deleteSession/pinSession | 需新增 agent:sessions（写操作同通道） | 无 |
 * | getOutput/clearOutput/undoClearOutput | 需新增 agent:output    | 无 |
 * | sendInput             | 需新增 agent:input                     | 无 |
 * | listModels/getModel/setModel | 接 cfg:model-list / cfg:save（既有配置通道） | 部分（settings 已用） |
 * | exportSession         | 需新增 agent:export                    | 无 |
 * | copyOutput            | 渲染层自足（getOutput + clipboard 写入）| 无需通道 |
 * | openLogs              | shell:openLogs（现有=全局日志）→ 下一轮扩展 per-agent | 部分 |
 * | pinAgent              | 渲染层偏好（localStorage 即可）        | 无需通道 |
 * | listTasks             | 需新增 task:list                       | 无 |
 * | listQueue             | 需新增 task:queue                      | 无 |
 * | listFiles             | 需新增 file:list（数据源=各 Agent 工作目录） | 无 |
 * | getRecommendation     | 需新增 agent:recommend                 | 无 |
 * | transferTask          | 需新增 agent:transfer（写操作，含附带内容载荷） | 无 |
 * | listNotifications     | 需新增 task:events（完成/转交/文件/队列事件流） | 无 |
 * | stopGeneration        | 需新增 agent:input 的 stop 语义（或 agent:abort） | 无 |
 * | listSettingsSections/listSettingsProviders/getMainModelConfig/listAuxModels/listArchivedSessions | 需新增 settings:get | 无 |
 * | setMainModelConfig/setAuxModel/resetAllAuxModels | 需新增 settings:update（写 provider 缓存） | 无 |
 * | restoreArchivedSession/deleteArchivedSessionForever | 需新增 archive:restore / archive:delete | 无 |
 * | getInfo/getCapabilities | 渲染层静态数据（services/capabilities/，13.20）→ 接线轮可加 agent:info | 无需通道 |
 * | archiveSession          | 需新增 archive:add（写操作）                  | 无 |
 * | checkUpdate             | 需新增 update:check（per-agent）              | 无 |
 * | testProvider            | 需新增 provider:test（真实连通性探测）        | 无 |
 * | getSettingsSchema       | 渲染层静态数据（AGENT_SETTINGS_SCHEMAS）      | 无需通道 |
 * | getSettings/setSettings/resetSettings/exportSettings/importSettings | 需新增 settings:native（读改各 Agent 原生配置文件；Secret 键拒绝走此通道） | 无 |
 * | CredentialService.*     | 需新增 credential:*（系统安全存储，UI 只拿 masked） | 无 |
 *
 * 会话/输出类通道依赖「Agent 会话数据源」的裁决（Agent TUI 的会话持久化位置），
 * 下一轮接线前需先与用户确认数据来源，不在本轮范围。
 */
import type { AgentControlService } from './agent-control-types.ts'

function notWired(method: string): never {
  throw new Error(`not-wired-yet: ${method}`)
}

export const realAgentControlService: AgentControlService = {
  async listAgents() { notWired('listAgents') },
  async getAgentStatus() { notWired('getAgentStatus') },
  async startAgent() { notWired('startAgent') },
  async stopAgent() { notWired('stopAgent') },
  async restartAgent() { notWired('restartAgent') },
  async newSession() { notWired('newSession') },
  async listSessions() { notWired('listSessions') },
  async switchSession() { notWired('switchSession') },
  async renameSession() { notWired('renameSession') },
  async deleteSession() { notWired('deleteSession') },
  async pinSession() { notWired('pinSession') },
  async getOutput() { notWired('getOutput') },
  async clearOutput() { notWired('clearOutput') },
  async undoClearOutput() { notWired('undoClearOutput') },
  async copyOutput() { notWired('copyOutput') },
  async exportSession() { notWired('exportSession') },
  async sendInput() { notWired('sendInput') },
  async openLogs() { notWired('openLogs') },
  async pinAgent() { notWired('pinAgent') },
  async listModels() { notWired('listModels') },
  async getModel() { notWired('getModel') },
  async setModel() { notWired('setModel') },
  async listTasks() { notWired('listTasks') },
  async listQueue() { notWired('listQueue') },
  async listFiles() { notWired('listFiles') },
  async getRecommendation() { notWired('getRecommendation') },
  async transferTask() { notWired('transferTask') },
  async listNotifications() { notWired('listNotifications') },
  async stopGeneration() { notWired('stopGeneration') },
  async listSettingsSections() { notWired('listSettingsSections') },
  async listSettingsProviders() { notWired('listSettingsProviders') },
  async getMainModelConfig() { notWired('getMainModelConfig') },
  async setMainModelConfig() { notWired('setMainModelConfig') },
  async listAuxModels() { notWired('listAuxModels') },
  async setAuxModel() { notWired('setAuxModel') },
  async resetAllAuxModels() { notWired('resetAllAuxModels') },
  async listArchivedSessions() { notWired('listArchivedSessions') },
  async restoreArchivedSession() { notWired('restoreArchivedSession') },
  async deleteArchivedSessionForever() { notWired('deleteArchivedSessionForever') },
  async getInfo() { notWired('getInfo') },
  async getCapabilities() { notWired('getCapabilities') },
  async archiveSession() { notWired('archiveSession') },
  async checkUpdate() { notWired('checkUpdate') },
  async testProvider() { notWired('testProvider') },
  async getSettingsSchema() { notWired('getSettingsSchema') },
  async getSettings() { notWired('getSettings') },
  async setSettings() { notWired('setSettings') },
  async resetSettings() { notWired('resetSettings') },
  async exportSettings() { notWired('exportSettings') },
  async importSettings() { notWired('importSettings') },
  onStatusChange() { notWired('onStatusChange') },
  onOutput() { notWired('onOutput') },
}

/** realCredentialService —— 真实凭据服务骨架（系统安全存储，接线轮落地；UI 只拿 masked） */
export const realCredentialService: import('./agent-control-types.ts').CredentialService = {
  async hasCredential() { notWired('hasCredential') },
  async getCredential() { notWired('getCredential') },
  async setCredential() { notWired('setCredential') },
  async deleteCredential() { notWired('deleteCredential') },
  async testCredential() { notWired('testCredential') },
}
