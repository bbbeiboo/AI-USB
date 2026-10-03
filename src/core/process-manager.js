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

/**
 * 在新控制台窗口中启动 Agent（用于 TUI 交互式 Agent）。
 *
 * Windows 上必须用 `cmd /c start "" powershell -NoExit -File <script>` 这一形态：
 * Node 的 spawn（detached + stdio:'ignore'）不会创建新控制台，无头 TUI 会因
 * "stdin is not a terminal" 立即退出。此写法与 GUI 的 agent-process-manager.js 一致。
 *
 * @param {string} scriptAbs  启动脚本绝对路径（.ps1，负责设置便携环境后拉起 Agent）
 * @returns {number|null} 启动器的 PID（powershell -NoExit 进程）
 */
export function spawnNewConsole(scriptAbs) {
  if (WINDOWS) {
    const child = spawn('cmd.exe',
      ['/c', 'start', '', 'powershell.exe',
       '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', scriptAbs],
      { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return child.pid;
  }
  // POSIX：无窗口概念，退回 detached spawn
  const child = spawn(scriptAbs, [], { detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

/**
 * 在新控制台窗口中直接启动命令（无 ps1 脚本时的兜底）。
 * 返回的 PID 是 cmd.exe，其 /k 窗口保持打开，Agent 作为子进程运行。
 */
export function spawnConsoleCommand(command, args = [], cwd = '') {
  if (WINDOWS) {
    const cdPart = cwd ? `cd /d "${cwd}" && ` : '';
    const cmdPart = `"${command}"`;
    const argsStr = args.length > 0 ? ' ' + args.map((a) => `"${a}"`).join(' ') : '';
    const fullCmd = `${cdPart}${cmdPart}${argsStr}`;
    const child = spawn('cmd.exe', ['/k', fullCmd], {
      detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();
    return child.pid;
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore', cwd: cwd || undefined });
  child.unref();
  return child.pid;
}

/**
 * 按命令行特征查找最近创建的匹配进程 PID（用于控制台窗口 Agent 的 PID 追踪）。
 * @param {string} signature 命令行中必须包含的特征字符串，如 'codex.js'
 * @returns {number|null} 最近匹配的 PID，未找到返回 null
 */
export function findAgentBySignature(signature) {
  if (!WINDOWS) return null;
  try {
    // 必须排除执行本次查询的 powershell 自身（其命令行含 signature，且创建时间最新）。
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${signature}*' } | Sort-Object -Property CreationDate -Descending | Select-Object -First 1 -ExpandProperty ProcessId)`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 },
    );
    const pid = Number.parseInt(out.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
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

/**
 * 控制台输出解码：优先按严格 UTF-8；字节流不是合法 UTF-8 时回退 GBK。
 * 背景：PowerShell 5.1 / cmd 向重定向管道输出用系统 ANSI 代码页（中文机器 = GBK），
 * 按 utf8 解码会把中文路径撕成 U+FFFD（再写盘即 EF BF BD）。
 * TextDecoder('gbk') 为 Node 内置（full-icu），零新依赖。
 */
export function decodeConsoleOutput(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  if (buf.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk').decode(buf);
  }
}

/** 运行一次性命令并返回 stdout（用于版本探测 / CLI 探测）。 */
export async function runCommand(command, args = [], { timeout = 15000 } = {}) {
  try {
    // 以 Buffer 捕获、由 decodeConsoleOutput 决定编码（utf8 严格校验 → GBK 兜底）
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      windowsHide: true,
      encoding: 'buffer',
    });
    return { ok: true, stdout: decodeConsoleOutput(stdout).trim(), stderr: decodeConsoleOutput(stderr).trim() };
  } catch (err) {
    return {
      ok: false,
      error: err,
      stdout: decodeConsoleOutput(err.stdout).trim(),
      stderr: decodeConsoleOutput(err.stderr).trim(),
    };
  }
}
