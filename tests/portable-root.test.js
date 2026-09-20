import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { resolvePortableRoot, portablePath } from '../src/core/portable-root.js';

test('PORTABLE_ROOT 推导到项目根目录（AI Agent 母盘）', () => {
  const root = resolvePortableRoot();
  assert.ok(root.endsWith('AI Agent 母盘'), `实际: ${root}`);
});

test('PORTABLE_ROOT 环境变量覆盖生效', () => {
  const fake = 'C:/__ai_usb_test__';
  process.env.PORTABLE_ROOT = fake;
  assert.equal(resolvePortableRoot(), path.resolve(fake));
  delete process.env.PORTABLE_ROOT;
});

test('portablePath 基于 PORTABLE_ROOT 拼接', () => {
  process.env.PORTABLE_ROOT = 'C:/__ai_usb_test__';
  assert.equal(portablePath('config', 'app.json'), path.join('C:/__ai_usb_test__', 'config', 'app.json'));
  delete process.env.PORTABLE_ROOT;
});
