/**
 * Process Manager —— 跨平台进程生命周期引擎。
 *
 * 硬性要求（CODEX.md §9/§10）：
 *   - 防重复启动
 *   - 记录 PID（仅作辅助）
 *   - 真实检测进程存在
 *   - 支持停止 / 重启 / 启动超时 / 健康检查
 *   - Launcher 退出后 Agent 独立运行（detached + unref，不绑定父进程生命周期）
 *   - 不用固定 sleep 作为唯一成功判断
 */
import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WINDOWS = process.platform === 'win32';

/** 判断进程是否真实存在（跨平台）。PID 只是辅助信号，最终可用性交给 health_check。 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (WINDOWS) {
    // tasklist 是 Windows 上最可靠的进程存在性检查
    try {
      // 注意：execFileSync 直接返回 stdout 字符串（非 {stdout} 对象）
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      return out.includes(String(pid));
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // EPERM = 进程存在但无权限
  }
}

/** 以 detached 方式启动子进程，返回 PID。子进程完全独立于 Launcher 生命周期。 */
export function spawnDetached(command, args = [], cwd = '') {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    cwd: cwd || undefined,
    windowsHide: false,
  });
  child.unref();
  return child.pid;
}

/** 结束整个进程树（Windows 用 taskkill /T，POSIX 用进程组信号）。 */
export async function terminateTree(pid) {
  if (!isProcessAlive(pid)) return true;
  if (WINDOWS) {
    try {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  // 宽限期后强杀
  await new Promise((r) => setTimeout(r, 2000));
  if (isProcessAlive(pid)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    }
  }
  return true;
}

/** 运行一次性命令并返回 stdout（用于版本探测 / CLI 探测）。 */
export async function runCommand(command, args = [], { timeout = 15000 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      windowsHide: true,
      encoding: 'utf8',
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return { ok: false, error: err, stdout: err.stdout?.trim() ?? '', stderr: err.stderr?.trim() ?? '' };
  }
}
