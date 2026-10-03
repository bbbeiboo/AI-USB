const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('launcher', {
  getManifest: () => ipcRenderer.invoke('manifest:get'),
  probeAgents: () => ipcRenderer.invoke('agents:probe'),
  launch: (id) => ipcRenderer.invoke('agent:launch', id),
  selfQuit: () => ipcRenderer.invoke('app:selfquit'),
  quit: () => ipcRenderer.invoke('app:quit'),
  // Phase 16.2: agent runtime status (read-only payload; no process object)
  getAgentStatuses: () => ipcRenderer.invoke('agents:status'),
  getAgentStatus: (id) => ipcRenderer.invoke('agent:status', id),
  stopAgent: (id) => ipcRenderer.invoke('agent:stop', id),
  restartAgent: (id) => ipcRenderer.invoke('agent:restart', id),
  startAllAgents: () => ipcRenderer.invoke('agents:start-all'),
  stopAllAgents: () => ipcRenderer.invoke('agents:stop-all'),
  onAgentStatus: (cb) => ipcRenderer.on('agent:status', (_e, payload) => cb(payload)),
  onTrayQuit: (cb) => ipcRenderer.on('tray:request-quit', () => cb()),
  onAgentResync: (cb) => ipcRenderer.on('agent:resync', () => cb()),
  requestQuit: (opts) => ipcRenderer.invoke('app:request-quit', opts),
  openLogs: () => ipcRenderer.invoke('shell:openLogs'),
  // API configuration (secrets never returned; only maskedKey)
  getApiConfig: () => ipcRenderer.invoke('api-config:get'),
  saveApiConfig: (payload) => ipcRenderer.invoke('api-config:save', payload),
  clearApiKey: (id) => ipcRenderer.invoke('api-config:clear-secret', id),
  validateApiConfig: (fields) => ipcRenderer.invoke('api-config:validate', fields),
  // Phase 9: user-triggered connectivity test (1 request, no retry)
  testConnection: (cfgId) => ipcRenderer.invoke('provider:test', cfgId),
  // Provider presets + model list + Responses-API connectivity (2026-10 round)
  getProviderPresets: () => ipcRenderer.invoke('provider:presets'),
  fetchModels: (payload) => ipcRenderer.invoke('provider:fetch-models', payload),
  getModelCache: (payload) => ipcRenderer.invoke('provider:model-cache', payload),
  testProviderConnection: (payload) => ipcRenderer.invoke('provider:test-connection', payload),
  // 第 2 步：登录层（SQLite + bcryptjs + JWT）；令牌由渲染进程保管，主进程不落盘
  authRegister: (payload) => ipcRenderer.invoke('auth:register', payload),
  authLogin: (payload) => ipcRenderer.invoke('auth:login', payload),
  authVerify: (payload) => ipcRenderer.invoke('auth:verify', payload),
  authLogout: (payload) => ipcRenderer.invoke('auth:logout', payload),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  // Phase 12: local usage / cost statistics (read-only summary; clear needs confirm)
  usageSummary: (days) => ipcRenderer.invoke('usage:summary', days),
  usageList: () => ipcRenderer.invoke('usage:list'),
  usageClear: () => ipcRenderer.invoke('usage:clear'),
  pricingGet: () => ipcRenderer.invoke('pricing:get'),
  pricingSet: (entry) => ipcRenderer.invoke('pricing:set', entry),
  // Phase 14: rich dashboard + sanitized export
  usageDashboard: (days) => ipcRenderer.invoke('usage:dashboard', days),
  usageExport: (format) => ipcRenderer.invoke('usage:export', format),
  // Phase 13: explicit localhost usage proxy (user opt-in)
  proxyStart: () => ipcRenderer.invoke('proxy:start'),
  proxyStop: () => ipcRenderer.invoke('proxy:stop'),
  proxyStatus: () => ipcRenderer.invoke('proxy:status'),
});
