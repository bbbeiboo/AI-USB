/**
 * 生产工厂冒烟测试（Production Factory Smoke Test）。
 *
 * 真实执行发布前检查，生成：
 *   - production/output/AIUSB-YYYYMMDD-NNNN/manifest.json        （文件清单 + SHA256）
 *   - production/output/AIUSB-YYYYMMDD-NNNN/production-report.json（检查结果 PASS/FAIL/BLOCKED）
 *
 * 绝不默认 PASS：每项检查真实执行并记录结果。
 * 用法：node scripts/production-factory.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { getVersion } from '../src/core/version.js';
import { resolvePortableRoot } from '../src/core/portable-root.js';

const ROOT = resolvePortableRoot();
const steps = [];
const record = (name, status, detail = '') => steps.push({ name, status, detail });

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/* 1. 版本 */
const VERSION = getVersion();
record('Version', VERSION === '1.0.0-rc.1' ? 'PASS' : 'FAIL', `version=${VERSION}`);

/* 2. Git 干净 */
try {
  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: ROOT }).trim();
  record('Git clean', dirty === '' ? 'PASS' : 'FAIL', dirty ? `dirty:\n${dirty}` : 'clean');
} catch (e) {
  record('Git clean', 'BLOCKED', e.message);
}

/* 3. 测试 */
try {
  const r = execFileSync('node', ['--test'], { encoding: 'utf8', cwd: ROOT, timeout: 120000 });
  const pass = /\bpass\s+(\d+)/.exec(r);
  const fail = /\bfail\s+(\d+)/.exec(r);
  const f = fail ? Number(fail[1]) : -1;
  const p = pass ? Number(pass[1]) : -1;
  record('Tests', f === 0 && p > 0 ? 'PASS' : 'FAIL', `${p} pass / ${f} fail`);
} catch (e) {
  record('Tests', 'FAIL', e.message);
}

/* 4. Secret 扫描 */
function secretScan(dir, rel = '') {
  const hits = [];
  const patterns = [
    [/sk-[a-zA-Z0-9]{20,}/, 'OpenAI key'],
    [/sk-ant-[a-zA-Z0-9-]{20,}/, 'Anthropic key'],
    [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
    [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
    [/gh[pousr]_[a-zA-Z0-9]{30,}/, 'GitHub token'],
    [/password\s*[:=]\s*['"][^'"]{4,}['"]/i, 'hardcoded password'],
    [/api[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]/i, 'hardcoded api key'],
  ];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    const relp = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (['node_modules', 'release', '.git', 'data', 'logs'].includes(ent.name)) continue;
      hits.push(...secretScan(p, relp));
    } else if (/\.(js|mjs|json|yml|yaml|md|html|txt|bat|ps1|sh)$/.test(ent.name)) {
      const content = fs.readFileSync(p, 'utf8');
      for (const [re, label] of patterns) {
        if (re.test(content)) hits.push(`${relp} (${label})`);
      }
    }
  }
  return hits;
}
const secretHits = secretScan(ROOT);
record('Secret scan', secretHits.length === 0 ? 'PASS' : 'FAIL', secretHits.length ? secretHits.join('\n') : 'no secrets');

/* 5. 许可证审计 */
const licenseFiles = ['LICENSE', 'NOTICE/NOTICE.md', 'THIRD_PARTY/DEPENDENCIES.md', 'THIRD_PARTY/README.md', 'licenses/electron-LICENSE.txt', 'licenses/tar-LICENSE.txt', 'licenses/Apache-2.0.txt'];
const missingLic = licenseFiles.filter((f) => !fs.existsSync(path.join(ROOT, f)));
record('License audit', missingLic.length === 0 ? 'PASS' : 'FAIL', missingLic.length ? `missing: ${missingLic.join(', ')}` : 'all present');

/* 6. 配置有效性 */
function validJson(file) {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, 'config', file), 'utf8')); return true; }
  catch { return false; }
}
const badCfg = ['app.json', 'agents.json', 'providers.json', 'update.json'].filter((f) => !validJson(f));
record('Config validity', badCfg.length === 0 ? 'PASS' : 'FAIL', badCfg.length ? `invalid: ${badCfg.join(', ')}` : 'all valid JSON');

/* 7. Agent 检测 */
try {
  const r = execFileSync('node', ['launcher.js', '--list'], { encoding: 'utf8', cwd: ROOT, timeout: 30000 });
  const agents = r.trim().split('\n').filter(Boolean);
  record('Agent detection', agents.length === 4 ? 'PASS' : 'FAIL', `${agents.length} agents: ${agents.join(', ')}`);
} catch (e) {
  record('Agent detection', 'FAIL', e.message);
}

/* 8. Claude Code 分发检查（生产包不得含其二进制） */
function hasClaudeBinary(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (['node_modules', '.git'].includes(ent.name)) continue;
      if (hasClaudeBinary(p)) return true;
    } else if (/claude|anthropic/i.test(ent.name) && /\.(exe|bin|dmg|pkg|deb|AppImage|zip|tar\.gz|whl|node)$/.test(ent.name)) {
      return true;
    }
  }
  return false;
}
const claudeHits = hasClaudeBinary(path.join(ROOT, 'src')) || hasClaudeBinary(path.join(ROOT, 'scripts'));
record('Claude Code redist check', claudeHits ? 'FAIL' : 'PASS', claudeHits ? '发现疑似 Claude Code 二进制' : '无 Claude Code 二进制/镜像');

/* 9. 便携路径（无硬编码盘符） */
const srcFiles = [];
function collectSrc(dir, prefix) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    const relp = path.join(prefix, ent.name);
    if (ent.isDirectory()) collectSrc(p, relp);
    else if (/\.(js|mjs)$/.test(ent.name)) srcFiles.push(relp);
  }
}
collectSrc(path.join(ROOT, 'src'), 'src'); // 只扫产品核心代码；工具脚本含正则/转义会误报
const hardcoded = [];
for (const f of srcFiles) {
  const c = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (/[A-Za-z]:\\/m.test(c) || /\/Users\/|\/home\/[a-z]/i.test(c)) hardcoded.push(f);
}
record('Portable path (no hardcoded drives)', hardcoded.length === 0 ? 'PASS' : 'FAIL', hardcoded.length ? hardcoded.join(', ') : 'no hardcoded paths');

/* 10. 生产包文件清单 + SHA256 */
const packageFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8', cwd: ROOT }).trim().split('\n').filter(Boolean);
const manifestFiles = packageFiles.map((f) => ({ path: f, sha256: sha256(path.join(ROOT, f)) }));

// 附带已构建的 Windows 产物（若存在）
const winArtifacts = [];
for (const f of fs.readdirSync(path.join(ROOT, 'release'), { withFileTypes: true })) {
  if (f.isFile() && /\.exe$/.test(f.name)) {
    const p = path.join(ROOT, 'release', f.name);
    winArtifacts.push({ path: `release/${f.name}`, sha256: sha256(p), size: fs.statSync(p).size });
  }
}

/* 输出 */
const batchId = `AIUSB-${today()}-0001`;
const outDir = path.join(ROOT, 'production', 'output', batchId);
fs.mkdirSync(outDir, { recursive: true });

const manifest = {
  batch_id: batchId,
  product: 'AI U盘',
  version: VERSION,
  generated_at: new Date().toISOString(),
  portable_root: ROOT,
  files: manifestFiles,
  windows_artifacts: winArtifacts,
};

const report = {
  batch_id: batchId,
  product: 'AI U盘',
  version: VERSION,
  generated_at: new Date().toISOString(),
  steps,
  summary: {
    pass: steps.filter((s) => s.status === 'PASS').length,
    fail: steps.filter((s) => s.status === 'FAIL').length,
    blocked: steps.filter((s) => s.status === 'BLOCKED').length,
    total: steps.length,
  },
};

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'production-report.json'), JSON.stringify(report, null, 2) + '\n');

// 控制台输出
console.log('\n=== Production Factory Report ===');
for (const s of steps) {
  const icon = s.status === 'PASS' ? '✅' : s.status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} ${s.name}: ${s.status}${s.detail ? ' — ' + s.detail.split('\n')[0] : ''}`);
}
console.log(`\n汇总: ${report.summary.pass} PASS / ${report.summary.fail} FAIL / ${report.summary.blocked} BLOCKED`);
console.log(`输出目录: ${outDir}`);
console.log(`manifest.json: ${manifestFiles.length} 文件 + ${winArtifacts.length} 个 Windows 产物`);
process.exit(report.summary.fail > 0 ? 1 : 0);
