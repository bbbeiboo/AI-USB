/**
 * 生成第三方依赖清单（THIRD_PARTY）。
 * 扫描 node_modules 第一层 package.json，提取 name/version/license，按字母排序输出。
 * 用法：node scripts/generate-third-party.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { portablePath } from '../src/core/portable-root.js';

const nodeModules = portablePath('node_modules');

function readPkg(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function licenseText(pkg) {
  const l = pkg.license;
  if (!l) return 'UNKNOWN';
  if (typeof l === 'string') return l;
  if (l.type) return l.type;
  if (l.name) return l.name;
  return 'UNKNOWN';
}

function main() {
  const entries = [];
  const topDirs = fs.readdirSync(nodeModules, { withFileTypes: true });

  for (const ent of topDirs) {
    if (!ent.isDirectory()) continue;
    // 跳过 scoped 包的第一层（@scope），展开内部
    if (ent.name.startsWith('@')) {
      for (const sub of fs.readdirSync(path.join(nodeModules, ent.name), { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        const pkg = readPkg(path.join(nodeModules, ent.name, sub.name));
        if (pkg) entries.push({ name: `${ent.name}/${sub.name}`, version: pkg.version, license: licenseText(pkg), url: pkg.homepage ?? pkg.repository?.url ?? '' });
      }
    } else {
      const pkg = readPkg(path.join(nodeModules, ent.name));
      if (pkg) entries.push({ name: ent.name, version: pkg.version, license: licenseText(pkg), url: pkg.homepage ?? pkg.repository?.url ?? '' });
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  const lines = [];
  lines.push('# 第三方依赖清单');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push(`依赖总数：${entries.length}`);
  lines.push('');
  lines.push('| 包名 | 版本 | 许可证 | 来源 |');
  lines.push('|---|---|---|---|');
  for (const e of entries) {
    const url = typeof e.url === 'string' ? e.url.replace(/^git\+/, '').replace(/\.git$/, '') : '';
    lines.push(`| ${e.name} | ${e.version} | ${e.license} | ${url} |`);
  }

  // 按许可证归类统计
  lines.push('');
  lines.push('## 许可证分布');
  lines.push('');
  const byLicense = {};
  for (const e of entries) {
    byLicense[e.license] = (byLicense[e.license] ?? 0) + 1;
  }
  for (const [lic, count] of Object.entries(byLicense).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${lic}: ${count}`);
  }

  const out = portablePath('THIRD_PARTY');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'DEPENDENCIES.md'), lines.join('\n') + '\n', 'utf8');
  console.log(`已生成 THIRD_PARTY/DEPENDENCIES.md（${entries.length} 个依赖）`);
}

main();
