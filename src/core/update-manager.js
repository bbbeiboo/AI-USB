/**
 * Update 管理器（CODEX.md §16/§17，PROJECT_SPEC §14）。
 *
 * 流程：
 *   检查版本 → 发现新版本 → 用户确认 → 下载 → SHA256 校验 → 备份 → 替换 → 重启
 *
 * 失败必须支持：下载失败 / 校验失败 / 替换失败 / 磁盘不足 / 权限不足 / 网络中断，
 * 失败后恢复旧 Launcher（回滚）。
 *
 * 安全约束：
 *   - 更新只替换 Launcher 代码文件，绝不删除数据目录
 *     （workspace/projects/skills/plugins/mcp/memory/config/backup/logs/data/agents/updates）。
 *   - 解压使用纯 JS `tar` 包，天然防 zip-slip 路径穿越。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { logger } from './logger.js';

/* ---------------- 纯函数（可独立测试） ---------------- */

/** 语义化版本比较（忽略前导 v）。返回 1 / 0 / -1。 */
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((x) => Number.parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 计算文件 SHA256（hex）。 */
export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/* ---------------- 受保护数据目录 ---------------- */

export const PROTECTED_DIRS = new Set([
  'workspace', 'projects', 'skills', 'plugins', 'mcp', 'memory',
  'config', 'backup', 'logs', 'data', 'agents', 'updates', 'shared',
]);

export function isProtectedPath(relPath) {
  const first = relPath.split(/[\\/]/)[0];
  return PROTECTED_DIRS.has(first);
}

/* ---------------- 下载 ---------------- */

/** 下载文件到 destPath，支持超时。网络错误抛 ECONNRESET / ENOTFOUND 等。 */
export async function downloadFile(url, destPath, { timeout = 300000, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'HTTP_ERROR', status: res.status });
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath));
  return destPath;
}

/* ---------------- GitHub Releases ---------------- */

const PLATFORM_KEYS = {
  win32: ['win32', 'windows', 'win'],
  darwin: ['darwin', 'macos', 'mac', 'osx'],
  linux: ['linux'],
};

const ARCH_KEYS = {
  x64: ['x64', 'amd64', 'x86_64'],
  arm64: ['arm64', 'aarch64'],
};

function normalizePlatform(p) {
  const map = { win: 'win32', windows: 'win32', darwin: 'darwin', macos: 'darwin', mac: 'darwin', osx: 'darwin', linux: 'linux' };
  return map[String(p).toLowerCase()] ?? String(p).toLowerCase();
}

function normalizeArch(a) {
  const map = { x64: 'x64', amd64: 'x64', x86_64: 'x64', arm64: 'arm64', aarch64: 'arm64' };
  return map[String(a).toLowerCase()] ?? String(a).toLowerCase();
}

export function currentPlatformArch({ platform = process.platform, arch = process.arch } = {}) {
  return { platform: normalizePlatform(platform), arch: normalizeArch(arch) };
}

/**
 * 从 release 的 assets 中选择匹配本平台的更新包。
 * 匹配：asset 名包含平台关键字 且 包含架构关键字，且为归档格式（.tar.gz/.tgz/.zip）。
 */
export function selectAsset(assets, { platform, arch } = {}) {
  const { platform: p, arch: a } = currentPlatformArch({ platform, arch });
  const pKeys = PLATFORM_KEYS[p] ?? [p];
  const aKeys = ARCH_KEYS[a] ?? [a];
  const name = (n) => String(n || '').toLowerCase();

  const archive = assets.filter((x) => /\.(tar\.gz|tgz|zip)$/i.test(name(x.name)));
  if (archive.length === 0) return null;

  for (const asset of archive) {
    const n = name(asset.name);
    const hasPlatform = pKeys.some((k) => n.includes(k));
    const hasArch = aKeys.some((k) => n.includes(k));
    if (hasPlatform && hasArch) return asset;
  }
  return null;
}

/**
 * 获取 GitHub 最新 release。返回 { tag_name, assets, body } 或 null（无 release）。
 * 可用 fetchImpl 注入 mock。
 */
export async function fetchLatestRelease(repo, { fetchImpl = fetch } = {}) {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'ai-usb-updater', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(`GitHub API HTTP ${res.status}`), { code: 'HTTP_ERROR', status: res.status });
  return res.json();
}

/* ---------------- 归档解压（纯 JS tar） ---------------- */

async function extractArchive(archivePath, destDir) {
  const ext = path.extname(archivePath).toLowerCase();
  if (ext === '.zip') {
    // zip 走系统 unzip（tar 包不处理 zip；Windows/macOS/Linux 均有 tar 支持 zip 时走 bsdtar）
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    await promisify(execFile)('tar', ['-xf', archivePath, '-C', destDir]);
    return destDir;
  }
  // tar.gz / tgz
  const { x } = await import('tar');
  await x({ file: archivePath, cwd: destDir, strip: 0 });
  return destDir;
}

/* ---------------- 文件复制辅助 ---------------- */

async function copyTree(srcDir, destDir, { filter } = {}) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      if (filter && filter(ent.name, true) === false) continue;
      fs.mkdirSync(dest, { recursive: true });
      await copyTree(src, dest, { filter });
    } else {
      if (filter && filter(ent.name, false) === false) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}

/** 把错误映射为结构化 reason。 */
function mapFsError(err) {
  const code = err?.code;
  if (code === 'ENOSPC') return 'disk-full';
  if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
  if (code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN') return 'network-error';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'network-error';
  if (code === 'HTTP_ERROR') return 'download-failed';
  return 'unknown';
}

/* ---------------- UpdateManager ---------------- */

export class UpdateManager {
  /**
   * @param {object} opts { root, currentVersion, config, logger, fetchImpl }
   */
  constructor(opts) {
    this.root = opts.root;
    this.log = opts.logger ?? logger;
    this.config = opts.config ?? {};
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.currentVersion = opts.currentVersion ?? this.config.currentVersion ?? null;
  }

  _platformArch() {
    const p = this.config.assetPlatform && this.config.assetPlatform !== 'auto'
      ? this.config.assetPlatform : process.platform;
    const a = this.config.assetArch && this.config.assetArch !== 'auto'
      ? this.config.assetArch : process.arch;
    return currentPlatformArch({ platform: p, arch: a });
  }

  /** 检查是否有新版本。返回 { hasUpdate, current, latest, release, asset }。 */
  async checkForUpdates() {
    const repo = this.config.githubRepo;
    if (!repo) {
      return { hasUpdate: false, current: this.currentVersion, reason: 'not-configured' };
    }
    const release = await fetchLatestRelease(repo, { fetchImpl: this.fetchImpl });
    if (!release) return { hasUpdate: false, current: this.currentVersion, reason: 'no-release' };

    const latest = String(release.tag_name || '').replace(/^v/i, '');
    const current = String(this.currentVersion || '').replace(/^v/i, '');
    const hasUpdate = compareVersions(latest, current) > 0;
    const asset = hasUpdate ? selectAsset(release.assets || [], this._platformArch()) : null;

    return { hasUpdate, current, latest, release, asset };
  }

  /** 下载更新包到 updates/ 目录。 */
  async download(asset) {
    const dir = path.join(this.root, 'updates');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${asset.name || 'update'}-${Date.now()}`;
    const dest = path.join(dir, filename);
    await downloadFile(asset.browser_download_url, dest, { fetchImpl: this.fetchImpl });
    return { archivePath: dest };
  }

  /** SHA256 校验。expectedSha256 为空则跳过（返回 skipped）。 */
  async verify(archivePath, expectedSha256) {
    if (!expectedSha256) return { ok: true, skipped: true };
    const actual = await sha256File(archivePath);
    return { ok: actual === expectedSha256, actual, expected: expectedSha256 };
  }

  /** 备份当前 Launcher 代码（不含受保护数据目录）。返回备份目录。 */
  async backup() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.root, 'backup', `pre-update-${this.currentVersion}-${stamp}`);
    fs.mkdirSync(backupDir, { recursive: true });
    await copyTree(this.root, backupDir, {
      filter: (name, isDir) => {
        if (isDir && PROTECTED_DIRS.has(name)) return false;
        return true;
      },
    });
    return { backupDir };
  }

  /** 应用更新：解压 + 覆盖代码文件，跳过受保护目录，不删除任何受保护数据。 */
  async apply(archivePath) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usb-update-'));
    let installed = 0;
    try {
      await extractArchive(archivePath, tmp);
      // 定位解压后可能存在的单层根目录
      const entries = fs.readdirSync(tmp, { withFileTypes: true });
      const srcRoot = entries.length === 1 && entries[0].isDirectory()
        ? path.join(tmp, entries[0].name)
        : tmp;

      const walk = (dir, rel = '') => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const relPath = rel ? path.join(rel, ent.name) : ent.name;
          if (isProtectedPath(relPath)) continue; // 绝不触碰数据目录
          const src = path.join(dir, ent.name);
          const dest = path.join(this.root, relPath);
          if (ent.isDirectory()) {
            fs.mkdirSync(dest, { recursive: true });
            walk(src, relPath);
          } else {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
            installed++;
          }
        }
      };
      walk(srcRoot);
      return { ok: true, installed };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** 从备份目录恢复（回滚）。 */
  async rollback(backupDir) {
    await copyTree(backupDir, this.root, {
      filter: (name, isDir) => {
        if (isDir && PROTECTED_DIRS.has(name)) return false;
        return true;
      },
    });
    return { ok: true };
  }

  /**
   * 完整更新流程（含失败自动回滚）。
   * 返回 { ok, reason?, latest?, backupDir? }。
   */
  async update({ expectedSha256, asset } = {}) {
    let archivePath = null;
    let backupDir = null;
    try {
      // 1. 检查
      const check = await this.checkForUpdates();
      if (!check.hasUpdate) {
        return { ok: false, reason: check.reason ?? 'no-update', latest: check.latest, current: check.current };
      }
      const targetAsset = asset ?? check.asset;
      if (!targetAsset) {
        return { ok: false, reason: 'no-matching-asset', latest: check.latest };
      }

      // 2. 下载
      const dl = await this.download(targetAsset);
      archivePath = dl.archivePath;

      // 3. 校验
      const verify = await this.verify(archivePath, expectedSha256);
      if (!verify.ok) {
        return { ok: false, reason: 'verify-failed', actual: verify.actual, expected: verify.expected };
      }

      // 4. 备份
      const bk = await this.backup();
      backupDir = bk.backupDir;

      // 5. 替换
      const applied = await this.apply(archivePath);
      return { ok: true, latest: check.latest, backupDir, installed: applied.installed };
    } catch (err) {
      const reason = mapFsError(err);
      this.log.error('update', `update failed (${reason}): ${err.message}`);
      // 6. 失败回滚
      if (backupDir) {
        try {
          await this.rollback(backupDir);
          this.log.info('update', 'rolled back to previous version');
        } catch (rbErr) {
          this.log.error('update', `rollback failed: ${rbErr.message}`);
        }
      }
      return { ok: false, reason, error: err.message };
    } finally {
      // 清理下载的更新包
      if (archivePath) fs.rmSync(archivePath, { force: true });
    }
  }
}
