/**
 * 模拟真实 U盘用户完整流程（第十阶段）。
 *
 *   插入U盘 → 双击 → 检测 → 启动Agent → Launcher自动关闭 → Agent独立运行
 *   → 再次双击 → 恢复状态 → 防重复启动 → 停止
 *
 * 用 mock Agent（node 长驻进程）模拟真实 Agent；两次「打开 Launcher」用两个
 * adapter 实例（各自从磁盘读状态）来模拟两个独立进程。
 */
import { AgentAdapter, STATUS } from '../src/core/adapters/base.js';
import { readState, writeState } from '../src/core/state.js';

const MOCK = {
  command: process.execPath,
  args: ['-e', 'setInterval(()=>{}, 120000)'],
  versionArgs: ['--version'],
  probe: null,
};

function openLauncher() {
  // 每次「打开 Launcher」都从磁盘重新读状态（模拟独立进程）
  const state = readState();
  return new AgentAdapter(
    { id: 'demo', displayName: 'Demo Agent', ...MOCK },
    { state, appConfig: { startupTimeoutMs: 5000 }, config: {}, saveState: () => writeState(state) },
  );
}

async function main() {
  const results = [];
  const step = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

  console.log('=== 模拟 U盘用户流程 ===\n');

  step('插入U盘，双击 AI U盘（首次打开）', true);

  const L1 = openLauncher();
  const s1 = await L1.status();
  step('Launcher 检测 Agent', s1 === STATUS.Stopped || s1 === STATUS.NotInstalled, `初始状态=${s1}`);

  const r1 = await L1.start();
  step('用户点击「启动」→ Agent 启动成功', r1.ok, `status=${r1.status}, pid=${r1.pid}`);

  step('Launcher 确认成功，自动关闭（Agent 独立运行）', true, 'Launcher 退出');

  // 第二次打开（新进程）
  const L2 = openLauncher();
  const alive = L2.is_running();
  step('再次双击 → 恢复运行状态', alive, `is_running=${alive}`);

  const r2 = await L2.start();
  step('再次点「启动」→ 防重复启动', r2.reason === 'already-running', `reason=${r2.reason}`);

  const r3 = await L2.stop();
  await new Promise((r) => setTimeout(r, 400));
  step('用户点「停止」→ Agent 停止', r3.status === STATUS.Stopped && !L2.is_running(), `status=${r3.status}`);

  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n流程结果: ${results.length - fail}/${results.length} 步通过`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
