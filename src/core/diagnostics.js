/**
 * 环境诊断（PROJECT_SPEC §19）。报告自动脱敏：绝不输出 API Key / Token。
 */
import os from 'node:os';
import { resolvePortableRoot } from './portable-root.js';
import { runCommand } from './process-manager.js';

async function runtimeVersion(cmd, args) {
  const r = await runCommand(cmd, args, { timeout: 10000 });
  return r.ok ? (r.stdout || r.stderr || '').split('\n')[0] : 'not-found';
}

export async function diagnose(mgr) {
  const agents = {};
  for (const [id, a] of Object.entries(mgr.adapters)) {
    const inst = await a.detect_installation();
    agents[id] = { installed: inst.installed, version: inst.version };
  }

  return {
    os: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    architecture: os.arch(),
    ramMB: Math.round(os.totalmem() / 1024 / 1024),
    portableRoot: resolvePortableRoot(),
    disk: null, // 由平台层补充
    runtime: {
      node: await runtimeVersion('node', ['--version']),
      git: await runtimeVersion('git', ['--version']),
      python: await runtimeVersion('python', ['--version']),
    },
    agents,
  };
}
