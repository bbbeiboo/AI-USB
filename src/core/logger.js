/**
 * 日志系统：统一写入 logs/ 目录，滚动追加。
 * 等级：DEBUG < INFO < WARN < ERROR
 * Release 默认 INFO。
 */
import fs from 'node:fs';
import path from 'node:path';
import { portablePath } from './portable-root.js';

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const level = LEVELS[process.env.AI_USB_LOG_LEVEL] ?? LEVELS.INFO;

function ensureDir() {
  const dir = portablePath('logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function write(entry) {
  const line = `${entry.ts} [${entry.level}] ${entry.scope ? `(${entry.scope}) ` : ''}${entry.msg}\n`;
  try {
    fs.appendFileSync(path.join(ensureDir(), 'launcher.log'), line, 'utf8');
  } catch {
    /* 日志失败不应中断主流程 */
  }
}

function log(lvl, scope, msg) {
  if (LEVELS[lvl] < level) return;
  const entry = { ts: new Date().toISOString(), level: lvl, scope, msg };
  write(entry);
  return entry;
}

export const logger = {
  debug: (scope, msg) => log('DEBUG', scope, msg),
  info: (scope, msg) => log('INFO', scope, msg),
  warn: (scope, msg) => log('WARN', scope, msg),
  error: (scope, msg) => log('ERROR', scope, msg),
};
