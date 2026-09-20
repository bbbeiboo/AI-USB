/**
 * AI U盘 Launcher —— CLI 入口（不依赖 Electron，可直接运行与测试）。
 *
 *   node launcher.js              # 显示四个 Agent 状态
 *   node launcher.js --list       # 列出 Agent 元数据
 *   node launcher.js --start <id> # 启动某个 Agent
 *   node launcher.js --stop <id>
 *   node launcher.js --restart <id>
 *   node launcher.js --doctor     # 环境诊断
 *   node launcher.js --update-check   # 检查更新
 *   node launcher.js --update [sha256] # 执行更新（可选 SHA256）
 */
import { createManager } from './src/core/agent-manager.js';
import { resolvePortableRoot } from './src/core/portable-root.js';
import { getConfig } from './src/core/config.js';
import { UpdateManager } from './src/core/update-manager.js';
import fs from 'node:fs';
import path from 'node:path';

function createUpdater() {
  const pkg = JSON.parse(fs.readFileSync(path.join(resolvePortableRoot(), 'package.json'), 'utf8'));
  return new UpdateManager({
    root: resolvePortableRoot(),
    currentVersion: pkg.version,
    config: getConfig('update'),
  });
}

async function printStatus(mgr) {
  const all = await mgr.statusAll();
  console.log('\nAI U盘 — Agent 状态');
  console.log('PORTABLE_ROOT =', resolvePortableRoot());
  console.log('');
  for (const [id, a] of Object.entries(all)) {
    console.log(`  ${a.name.padEnd(14)} ${a.status}`);
  }
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);
  const mgr = createManager();
  const cmd = args[0];
  const target = args[1];

  try {
    switch (cmd) {
      case '--list':
        for (const m of mgr.list()) console.log(`${m.id}\t${m.name}`);
        break;
      case '--start':
        console.log('启动', target, '...');
        console.log(await mgr.start(target));
        break;
      case '--stop':
        console.log(await mgr.stop(target));
        break;
      case '--restart':
        console.log(await mgr.restart(target));
        break;
      case '--doctor':
      case '--diagnose': {
        const { diagnose } = await import('./src/core/diagnostics.js');
        console.log(JSON.stringify(await diagnose(mgr), null, 2));
        break;
      }
      case '--update-check': {
        const up = createUpdater();
        console.log(await up.checkForUpdates());
        break;
      }
      case '--update': {
        const up = createUpdater();
        console.log(await up.update({ expectedSha256: target }));
        break;
      }
      default:
        await printStatus(mgr);
    }
  } catch (err) {
    console.error('[错误]', err.message);
    process.exitCode = 1;
  }
}

main();
