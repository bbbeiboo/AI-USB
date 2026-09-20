/**
 * 配置管理：加载/保存 config/*.json，缺失时落默认值。
 * 严禁把用户数据与程序代码混在一起；配置一律在 <root>/config/。
 */
import fs from 'node:fs';
import path from 'node:path';
import { portablePath } from './portable-root.js';

const CONFIG_DIR = () => portablePath('config');

export const DEFAULT_CONFIG = {
  app: {
    name: 'AI U盘',
    version: '0.1.0',
    logLevel: 'INFO',
    startupTimeoutMs: 30000,
    autoCloseAfterStart: true,
  },
  agents: {
    openclaw: { enabled: true, command: 'openclaw', args: [], cwd: '', health: 'cli' },
    hermes: { enabled: true, command: 'hermes', args: [], cwd: '', health: 'cli' },
    codex: { enabled: true, command: 'codex', args: [], cwd: '', health: 'cli' },
    'claude-code': { enabled: true, command: 'claude', args: [], cwd: '', health: 'cli' },
  },
  providers: {
    openai: { enabled: false, baseUrl: 'https://api.openai.com/v1' },
    anthropic: { enabled: false, baseUrl: 'https://api.anthropic.com' },
  },
  update: {
    channel: 'stable',
    checkIntervalHours: 24,
    githubRepo: '',
    currentVersion: '',
    assetPlatform: 'auto',
    assetArch: 'auto',
  },
};

function readJson(file) {
  const p = path.join(CONFIG_DIR(), file);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  const dir = CONFIG_DIR();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (typeof base !== 'object' || base === null) return override ?? base;
  if (typeof override !== 'object' || override === null) return override ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in base && typeof base[k] === 'object' && base[k] !== null
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

/** 读取某个配置块（app/agents/providers/update），自动合并默认值。 */
export function getConfig(section) {
  const file = `${section}.json`;
  const onDisk = readJson(file);
  const base = DEFAULT_CONFIG[section] ?? {};
  return onDisk ? deepMerge(base, onDisk) : structuredClone(base);
}

/** 写回某个配置块（合并后落盘）。 */
export function saveConfig(section, data) {
  const merged = deepMerge(getConfig(section), data);
  writeJson(`${section}.json`, merged);
  return merged;
}

/** 首次初始化：把所有默认配置落盘。 */
export function initConfig() {
  for (const section of Object.keys(DEFAULT_CONFIG)) {
    if (readJson(`${section}.json`) === null) {
      writeJson(`${section}.json`, DEFAULT_CONFIG[section]);
    }
  }
}

export { CONFIG_DIR };
