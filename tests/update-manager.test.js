import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import * as tar from 'tar';
import {
  compareVersions,
  sha256File,
  selectAsset,
  fetchLatestRelease,
  downloadFile,
  UpdateManager,
  PROTECTED_DIRS,
  isProtectedPath,
} from '../src/core/update-manager.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usb-upd-'));

/* ---------------- 纯函数 ---------------- */

test('compareVersions 语义化比较', () => {
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.1.0', '1.0.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('v2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
});

test('sha256File 计算真实哈希', async () => {
  const dir = tmp();
  const f = path.join(dir, 'x.txt');
  fs.writeFileSync(f, 'hello');
  const h = await sha256File(f);
  assert.equal(h, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('isProtectedPath 识别受保护目录', () => {
  assert.equal(isProtectedPath('workspace/a.txt'), true);
  assert.equal(isProtectedPath('config/app.json'), true);
  assert.equal(isProtectedPath('src/core.js'), false);
  assert.equal(isProtectedPath('launcher.js'), false);
  for (const d of ['workspace', 'projects', 'skills', 'plugins', 'mcp', 'memory', 'config', 'backup', 'logs', 'data', 'agents', 'updates']) {
    assert.ok(PROTECTED_DIRS.has(d), d);
  }
});

/* ---------------- asset 选择 ---------------- */

test('selectAsset 匹配平台 + 架构 + 归档格式', () => {
  const assets = [
    { name: 'ai-usb-win32-x64.tar.gz' },
    { name: 'ai-usb-darwin-arm64.tar.gz' },
    { name: 'ai-usb-linux-x64.tgz' },
    { name: 'ai-usb-win32-x64.zip' },
    { name: 'README.md' },
  ];
  assert.equal(selectAsset(assets, { platform: 'win32', arch: 'x64' }).name, 'ai-usb-win32-x64.tar.gz');
  assert.equal(selectAsset(assets, { platform: 'darwin', arch: 'arm64' }).name, 'ai-usb-darwin-arm64.tar.gz');
  assert.equal(selectAsset(assets, { platform: 'linux', arch: 'x64' }).name, 'ai-usb-linux-x64.tgz');
  assert.equal(selectAsset([{ name: 'notes.txt' }], {}), null);
});

/* ---------------- GitHub API ---------------- */

test('fetchLatestRelease 解析 release', async () => {
  const mock = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v1.2.0', assets: [], body: '' }) });
  const r = await fetchLatestRelease('o/r', { fetchImpl: mock });
  assert.equal(r.tag_name, 'v1.2.0');
});

test('fetchLatestRelease 404 → null', async () => {
  const mock = async () => ({ ok: false, status: 404 });
  assert.equal(await fetchLatestRelease('o/r', { fetchImpl: mock }), null);
});

/* ---------------- 下载 ---------------- */

test('downloadFile 从本地 HTTP 服务器真实下载', async () => {
  const server = http.createServer((_q, res) => res.end('download-content'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const dest = path.join(tmp(), 'dl.txt');
  await downloadFile(`http://127.0.0.1:${port}/f`, dest);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'download-content');
  server.close();
});

/* ---------------- 备份 / 保护 ---------------- */

test('backup 只备份代码文件，排除受保护数据目录', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'launcher.js'), 'code');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'core.js'), 'core');
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workspace', 'u.txt'), 'user');

  const um = new UpdateManager({ root, currentVersion: '0.1.0', config: {} });
  const { backupDir } = await um.backup();

  assert.ok(fs.existsSync(path.join(backupDir, 'launcher.js')));
  assert.ok(fs.existsSync(path.join(backupDir, 'src', 'core.js')));
  assert.equal(fs.existsSync(path.join(backupDir, 'workspace')), false, '不应备份数据目录');
});

/* ---------------- 应用更新（真实 tar.gz 解压） ---------------- */

async function makeTarGz(fixtureDir, outFile) {
  await tar.c({ gzip: true, cwd: fixtureDir, file: outFile }, ['.']);
}

test('apply 覆盖代码文件且不触碰受保护数据目录', async () => {
  const root = tmp();
  // 旧版本结构
  fs.writeFileSync(path.join(root, 'launcher.js'), 'old-launcher');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'core.js'), 'old-core');
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workspace', 'userdata.txt'), 'KEEP-ME');
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'app.json'), '{"a":1}');

  // 新版本 fixture（含试图覆盖数据目录的恶意/误打包文件）
  const fixture = tmp();
  fs.writeFileSync(path.join(fixture, 'launcher.js'), 'new-launcher');
  fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'src', 'core.js'), 'new-core');
  fs.writeFileSync(path.join(fixture, 'src', 'newfile.js'), 'brand-new');
  fs.mkdirSync(path.join(fixture, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'workspace', 'userdata.txt'), 'EVIL-OVERWRITE');

  const archive = path.join(tmp(), 'update.tar.gz');
  await makeTarGz(fixture, archive);

  const um = new UpdateManager({ root, currentVersion: '0.1.0', config: {} });
  const r = await um.apply(archive);

  assert.equal(r.ok, true);
  assert.ok(r.installed >= 3);
  assert.equal(fs.readFileSync(path.join(root, 'launcher.js'), 'utf8'), 'new-launcher');
  assert.equal(fs.readFileSync(path.join(root, 'src', 'core.js'), 'utf8'), 'new-core');
  assert.equal(fs.readFileSync(path.join(root, 'src', 'newfile.js'), 'utf8'), 'brand-new');
  // 受保护目录必须保持原样
  assert.equal(fs.readFileSync(path.join(root, 'workspace', 'userdata.txt'), 'utf8'), 'KEEP-ME');
  assert.equal(fs.readFileSync(path.join(root, 'config', 'app.json'), 'utf8'), '{"a":1}');
});

/* ---------------- 回滚 ---------------- */

test('rollback 从备份恢复被破坏的文件', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'launcher.js'), 'v1');
  const um = new UpdateManager({ root, currentVersion: '0.1.0', config: {} });
  const { backupDir } = await um.backup();

  fs.writeFileSync(path.join(root, 'launcher.js'), 'CORRUPTED');
  await um.rollback(backupDir);
  assert.equal(fs.readFileSync(path.join(root, 'launcher.js'), 'utf8'), 'v1');
});

/* ---------------- 完整流程（校验失败 + 成功） ---------------- */

test('update 校验失败返回 verify-failed（不触碰文件）', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'launcher.js'), 'orig');

  const server = http.createServer((_q, res) => res.end('update-bytes'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const release = {
    tag_name: 'v2.0.0',
    assets: [{ name: 'ai-usb-win32-x64.tar.gz', browser_download_url: `http://127.0.0.1:${port}/update.tar.gz` }],
  };
  const fetchImpl = async (url, opts) => {
    if (String(url).includes('api.github.com')) return { ok: true, status: 200, json: async () => release };
    return fetch(url, opts);
  };

  const um = new UpdateManager({ root, currentVersion: '0.1.0', config: { githubRepo: 'o/r' }, fetchImpl });
  const r = await um.update({ expectedSha256: 'deadbeef'.repeat(8) });

  assert.equal(r.ok, false);
  assert.equal(r.reason, 'verify-failed');
  assert.equal(fs.readFileSync(path.join(root, 'launcher.js'), 'utf8'), 'orig'); // 未被改动
  server.close();
});

test('update 完整成功流程（下载→校验→备份→替换）', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'launcher.js'), 'old-launcher');
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workspace', 'u.txt'), 'KEEP');

  // 新版本 tar.gz
  const fixture = tmp();
  fs.writeFileSync(path.join(fixture, 'launcher.js'), 'new-launcher');
  fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'src', 'core.js'), 'new-core');
  const archive = path.join(tmp(), 'update.tar.gz');
  await makeTarGz(fixture, archive);
  const expectedSha = await sha256File(archive);

  // 本地 HTTP 服务器提供该 tar.gz
  const server = http.createServer((_q, res) => {
    fs.createReadStream(archive).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const release = {
    tag_name: 'v2.0.0',
    assets: [{ name: 'ai-usb-win32-x64.tar.gz', browser_download_url: `http://127.0.0.1:${port}/update.tar.gz` }],
  };
  const fetchImpl = async (url, opts) => {
    if (String(url).includes('api.github.com')) return { ok: true, status: 200, json: async () => release };
    return fetch(url, opts);
  };

  const um = new UpdateManager({ root, currentVersion: '0.1.0', config: { githubRepo: 'o/r' }, fetchImpl });
  const r = await um.update({ expectedSha256: expectedSha });

  assert.equal(r.ok, true);
  assert.equal(r.latest, '2.0.0');
  assert.equal(fs.readFileSync(path.join(root, 'launcher.js'), 'utf8'), 'new-launcher');
  assert.equal(fs.readFileSync(path.join(root, 'workspace', 'u.txt'), 'utf8'), 'KEEP');
  server.close();
});
