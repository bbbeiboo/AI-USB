/**
 * Health Check —— 按 Agent 类型实现的健康探测。
 * 不能假设所有 Agent 用同一方法（PROJECT_SPEC §6）。
 *
 * 策略：
 *   - process : 进程是否存在
 *   - cli     : 二进制是否可用（--version 探测）
 *   - port    : TCP 端口是否监听
 *   - http    : HTTP 端点是否响应
 */
import net from 'node:net';
import { isProcessAlive, runCommand } from './process-manager.js';

export function checkProcess(pid) {
  return isProcessAlive(pid);
}

export async function checkCli(command, args = ['--version'], timeout = 15000) {
  const r = await runCommand(command, args, { timeout });
  return r.ok;
}

export function checkPort(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}

export async function checkHttp(url, timeout = 5000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 组合探测：process 存活是必要条件；若配置了额外 probe 则一并校验。
 * probe: { type: 'cli'|'port'|'http', ... }
 */
export async function healthCheck(pid, probe) {
  if (!checkProcess(pid)) return { healthy: false, reason: 'process-not-alive' };
  if (!probe) return { healthy: true };

  switch (probe.type) {
    case 'cli': {
      const ok = await checkCli(probe.command, probe.args ?? ['--version'], probe.timeout);
      return { healthy: ok, reason: ok ? null : 'cli-probe-failed' };
    }
    case 'port': {
      const ok = await checkPort(probe.host ?? '127.0.0.1', probe.port, probe.timeout);
      return { healthy: ok, reason: ok ? null : 'port-not-listening' };
    }
    case 'http': {
      const ok = await checkHttp(probe.url, probe.timeout);
      return { healthy: ok, reason: ok ? null : 'http-probe-failed' };
    }
    default:
      return { healthy: true };
  }
}
