import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getConfig, saveConfig, initConfig, DEFAULT_CONFIG } from '../src/core/config.js';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usb-cfg-'));
process.env.PORTABLE_ROOT = ROOT;

test('getConfig 未落盘时返回默认值', () => {
  const app = getConfig('app');
  assert.equal(app.name, 'AI U盘');
  assert.equal(app.startupTimeoutMs, 30000);
});

test('saveConfig 持久化并可读回', () => {
  saveConfig('app', { logLevel: 'DEBUG' });
  const app = getConfig('app');
  assert.equal(app.logLevel, 'DEBUG');
  assert.equal(app.name, 'AI U盘'); // 未覆盖字段保留默认
});

test('initConfig 生成所有默认配置文件', () => {
  initConfig();
  for (const section of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(fs.existsSync(path.join(ROOT, 'config', `${section}.json`)), `${section}.json 缺失`);
  }
});
