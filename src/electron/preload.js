/**
 * Preload —— 通过 contextBridge 暴露安全 IPC 给渲染进程。
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('aiUsb', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  list: () => ipcRenderer.invoke('agents:list'),
  status: () => ipcRenderer.invoke('agents:status'),
  start: (id) => ipcRenderer.invoke('agent:start', id),
  stop: (id) => ipcRenderer.invoke('agent:stop', id),
  restart: (id) => ipcRenderer.invoke('agent:restart', id),
  startAll: () => ipcRenderer.invoke('agents:startAll'),
  stopAll: () => ipcRenderer.invoke('agents:stopAll'),
  doctor: () => ipcRenderer.invoke('doctor'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  runUpdate: (sha256) => ipcRenderer.invoke('update:run', sha256),
  openExternal: (url) => ipcRenderer.invoke('ui:open-external', url),
  close: () => ipcRenderer.invoke('ui:close'),
});
