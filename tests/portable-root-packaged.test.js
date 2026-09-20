import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { resolvePortableRoot, resolvePackagedRoot } from '../src/core/portable-root.js';

// 用 path.posix 显式验证 macOS/Linux 的分支逻辑（不依赖运行时平台）。
const posix = path.posix;

test('打包态 Windows：dirname(exe)', () => {
  const root = resolvePackagedRoot({ execPath: 'E:/my-usb/AI-USB.exe', platform: 'win32' });
  assert.equal(root, 'E:/my-usb');
});

test('打包态 macOS：从 MacOS 目录往上 3 级到 .app 父目录', () => {
  const root = resolvePackagedRoot({
    execPath: '/Volumes/my-usb/AI-USB.app/Contents/MacOS/AI-USB',
    platform: 'darwin',
    pathMod: posix,
  });
  assert.equal(root, '/Volumes/my-usb');
});

test('打包态 Linux AppImage：用 $APPIMAGE 而非临时挂载点', () => {
  const root = resolvePackagedRoot({
    execPath: '/tmp/.mount_xyz/ai-usb',
    platform: 'linux',
    appimage: '/media/usb/AI-USB.AppImage',
    pathMod: posix,
  });
  assert.equal(root, '/media/usb');
});

test('打包态 Linux（非 AppImage）：dirname(exe)', () => {
  const root = resolvePackagedRoot({ execPath: '/opt/ai-usb/ai-usb', platform: 'linux', pathMod: posix });
  assert.equal(root, '/opt/ai-usb');
});

test('打包态 Windows portable：优先用 PORTABLE_EXECUTABLE_DIR', () => {
  const root = resolvePackagedRoot({
    execPath: 'C:/Users/x/AppData/Local/Temp/xyz/AI-USB.exe',
    platform: 'win32',
    portableDir: 'E:/my-usb',
  });
  assert.equal(root, path.win32.resolve('E:/my-usb'));
});

test('开发态（未打包）：仍推导到项目根目录', () => {
  delete process.env.AI_USB_PACKAGED;
  const root = resolvePortableRoot();
  assert.ok(root.endsWith('AI Agent 母盘'), `实际: ${root}`);
});
