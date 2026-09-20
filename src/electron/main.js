/**
 * Electron 主进程 —— AI U盘 Launcher。
 * 职责：窗口管理 + 通过 IPC 暴露 AgentManager 能力。
 * Agent 以 detached 方式启动，Launcher 退出后 Agent 独立运行。
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManager } from '../core/agent-manager.js';
import { resolvePortableRoot } from '../core/portable-root.js';
import { diagnose } from '../core/diagnostics.js';
import { logger } from '../core/logger.js';
import { UpdateManager } from '../core/update-manager.js';
import { getConfig } from '../core/config.js';
import { getVersion } from '../core/version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 关键：在首次调用 resolvePortableRoot() 之前设置打包态标记。
// 打包后数据目录（config/data/logs/workspace…）落在可执行文件旁边（U盘上）。
process.env.AI_USB_PACKAGED = app.isPackaged ? '1' : '0';

let mainWindow = null;
let manager = null;

// 单实例锁：禁止重复启动 Launcher 本身
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function getManager() {
  if (!manager) manager = createManager();
  return manager;
}

function getUpdater() {
  return new UpdateManager({
    root: resolvePortableRoot(),
    currentVersion: getVersion(),
    config: getConfig('update'),
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 420,
    minHeight: 560,
    title: 'AI U盘',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  // 冒烟测试：窗口加载完成后自动退出（CI / 无头验证用）
  if (process.env.AI_USB_SMOKE_TEST === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      logger.info('launcher', 'SMOKE OK — window loaded');
      setTimeout(() => app.quit(), 500);
    });
    mainWindow.webContents.once('did-fail-load', (_e, code, desc) => {
      logger.error('launcher', `SMOKE FAIL — load error ${code}: ${desc}`);
      process.exitCode = 1;
      app.quit();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ---------------- IPC 处理器 ---------------- */

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    name: 'AI U盘',
    portableRoot: resolvePortableRoot(),
    platform: process.platform,
    arch: process.arch,
    autoCloseAfterStart: getManager().appConfig.autoCloseAfterStart ?? true,
  }));

  ipcMain.handle('agents:list', () => getManager().list());
  ipcMain.handle('agents:status', async () => getManager().statusAll());
  ipcMain.handle('agent:start', async (_e, id) => getManager().start(id));
  ipcMain.handle('agent:stop', async (_e, id) => getManager().stop(id));
  ipcMain.handle('agent:restart', async (_e, id) => getManager().restart(id));
  ipcMain.handle('agents:startAll', async () => getManager().startAll());
  ipcMain.handle('agents:stopAll', async () => getManager().stopAll());
  ipcMain.handle('doctor', async () => diagnose(getManager()));
  ipcMain.handle('update:check', async () => getUpdater().checkForUpdates());
  ipcMain.handle('update:run', async (_e, sha256) => getUpdater().update({ expectedSha256: sha256 }));
  ipcMain.handle('ui:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('ui:close', () => {
    if (mainWindow) mainWindow.close();
  });
}

app.whenReady().then(() => {
  logger.info('launcher', `starting (root=${resolvePortableRoot()})`);
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 关键：Launcher 退出，但已启动的 Agent（detached）不受影响
  logger.info('launcher', 'window-all-closed → quitting (agents keep running)');
  app.quit();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
