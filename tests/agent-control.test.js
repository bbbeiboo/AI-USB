// 13.13 阶段 2 单测：stub 状态机 / 工厂 / 导出格式生成 / real 骨架契约
// 直接以 Node strip-types 加载渲染层 TS 源码（stub 仅 import type，无运行时依赖）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubAgentControlService } from '../Launcher/App/renderer/src/services/agent-control-stub.ts';
import { getAgentControlService, __resetAgentControlServiceForTest } from '../Launcher/App/renderer/src/services/agent-control.ts';
import { realAgentControlService } from '../Launcher/App/renderer/src/services/agent-control-real.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFast() {
  return createStubAgentControlService({ startDelayMs: 10, stopDelayMs: 10, restartGapMs: 5, sendDelayMs: 10 });
}

test('工厂默认返回 stub：接口方法齐全且为函数', async () => {
  __resetAgentControlServiceForTest();
  const svc = getAgentControlService();
  for (const m of ['listAgents', 'getAgentStatus', 'startAgent', 'stopAgent', 'restartAgent',
    'newSession', 'listSessions', 'switchSession', 'renameSession', 'deleteSession', 'pinSession',
    'getOutput', 'clearOutput', 'undoClearOutput',
    'copyOutput', 'exportSession', 'sendInput', 'openLogs', 'pinAgent',
    'listModels', 'getModel', 'setModel',
    'listTasks', 'listQueue', 'listFiles',
    'getRecommendation', 'transferTask', 'listNotifications', 'stopGeneration',
    'listSettingsSections', 'listSettingsProviders', 'getMainModelConfig', 'setMainModelConfig',
    'listAuxModels', 'setAuxModel', 'resetAllAuxModels',
    'listArchivedSessions', 'restoreArchivedSession', 'deleteArchivedSessionForever',
    'onStatusChange', 'onOutput']) {
    assert.equal(typeof svc[m], 'function', `method ${m}`);
  }
});

test('listAgents：4 个 Agent，id 与 agents.json 对齐，默认全 STOPPED', async () => {
  const svc = makeFast();
  const agents = await svc.listAgents();
  assert.deepEqual(agents.map((a) => a.id).sort(),
    ['claude-code', 'codex', 'hermes', 'openclaw']);
  assert.ok(agents.every((a) => a.status === 'STOPPED'));
  assert.ok(agents.every((a) => a.short.length >= 1));
  assert.ok(agents.every((a) => typeof a.desc === 'string' && a.desc.length >= 2), '13.17：切换菜单需要一句话描述');
});

test('startAgent：STOPPED → STARTING → RUNNING 全程发事件，resolve 为 RUNNING', async () => {
  const svc = makeFast();
  const events = [];
  svc.onStatusChange((id, s) => events.push([id, s]));
  const r = await svc.startAgent('hermes');
  assert.equal(r, 'RUNNING');
  assert.deepEqual(events, [['hermes', 'STARTING'], ['hermes', 'RUNNING']]);
  assert.equal(await svc.getAgentStatus('hermes'), 'RUNNING');
});

test('stopAgent：RUNNING → STOPPING → STOPPED；对 STOPPED 幂等', async () => {
  const svc = makeFast();
  const events = [];
  svc.onStatusChange((id, s) => events.push([id, s]));
  await svc.startAgent('codex');
  events.length = 0;
  const r = await svc.stopAgent('codex');
  assert.equal(r, 'STOPPED');
  assert.deepEqual(events, [['codex', 'STOPPING'], ['codex', 'STOPPED']]);
  events.length = 0;
  await svc.stopAgent('codex');
  assert.deepEqual(events, [], 'STOPPED 上再 stop 不应产生事件');
});

test('restartAgent：完整 绿→黄→灰→黄→绿 流转', async () => {
  const svc = makeFast();
  const events = [];
  svc.onStatusChange((id, s) => events.push(s));
  await svc.startAgent('openclaw');
  events.length = 0;
  const r = await svc.restartAgent('openclaw');
  assert.equal(r, 'RUNNING');
  assert.deepEqual(events, ['STOPPING', 'STOPPED', 'STARTING', 'RUNNING']);
});

test('newSession：追加置顶为当前会话，输出为空；switchSession 切回种子会话有演示输出', async () => {
  const svc = makeFast();
  const before = await svc.listSessions('hermes');
  assert.equal(before.length, 3);
  const meta = await svc.newSession('hermes');
  const after = await svc.listSessions('hermes');
  assert.equal(after.length, 4);
  assert.equal(after[0].id, meta.id, '新会话应排在列表首位');
  assert.deepEqual(await svc.getOutput('hermes'), [], '新会话输出为空');
  const back = await svc.switchSession('hermes', before[0].id);
  assert.equal(back.id, before[0].id);
  const out = await svc.getOutput('hermes');
  assert.ok(out.length >= 3, '种子会话应有演示输出');
  assert.ok(out.some((e) => e.kind === 'system' && /stub/.test(e.text)));
});

test('clearOutput → undoClearOutput：清空后可完整恢复', async () => {
  const svc = makeFast();
  const orig = await svc.getOutput('openclaw');
  await svc.clearOutput('openclaw');
  assert.deepEqual(await svc.getOutput('openclaw'), []);
  const restored = await svc.undoClearOutput('openclaw');
  assert.ok(Array.isArray(restored) && restored.length === orig.length);
  assert.deepEqual(await svc.getOutput('openclaw').then((r) => r.map((e) => e.id)), orig.map((e) => e.id));
  assert.equal(await svc.undoClearOutput('openclaw'), null, '二次撤销应返回 null');
});

test('sendInput：回显 + ≥2 行模拟响应经 onOutput 推送，含流式打字机条目', async () => {
  const svc = makeFast();
  const pushed = [];
  svc.onOutput((id, e) => pushed.push(e));
  await svc.sendInput('hermes', '你好');
  const kinds = pushed.map((e) => e.kind);
  assert.equal(kinds[0], 'user', '第一条应为回显');
  assert.ok(kinds.filter((k) => k === 'agent').length >= 2, '至少 2 行 agent 响应');
  const streamEntries = pushed.filter((e) => e.streaming !== undefined);
  assert.ok(streamEntries.length >= 5, '打字机条目应有多次分片更新');
  const finalStream = streamEntries[streamEntries.length - 1];
  assert.equal(finalStream.streaming, false, '流式条目应结束');
  assert.ok(finalStream.text.length > 10, '流式条目最终文本完整');
  assert.ok(pushed.some((e) => e.text.includes('你好')), '回显包含输入文本');
});

test('copyOutput：返回包含条目文本的非空字符串', async () => {
  const svc = makeFast();
  const text = await svc.copyOutput('codex');
  assert.ok(typeof text === 'string' && text.length > 0);
  const out = await svc.getOutput('codex');
  assert.ok(text.includes(out[0].text));
});

test("exportSession：md 与 json 两种格式均为真实结构", async () => {
  const svc = makeFast();
  const sessions = await svc.listSessions('openclaw');
  const md = await svc.exportSession('openclaw', sessions[0].id, 'md');
  assert.match(md.filename, /^openclaw-.+\.md$/);
  assert.ok(md.content.startsWith('# '), 'md 应有标题');
  assert.ok(md.content.includes('## 输出'));
  assert.ok(md.content.includes('user:'), 'md 应包含条目行');
  const json = await svc.exportSession('openclaw', sessions[0].id, 'json');
  assert.match(json.filename, /\.json$/);
  const parsed = JSON.parse(json.content);
  assert.equal(parsed.session.id, sessions[0].id);
  assert.ok(Array.isArray(parsed.entries) && parsed.entries.length > 0);
});

test('pinAgent：置顶条目排前，可取消', async () => {
  const svc = makeFast();
  await svc.pinAgent('codex', true);
  let agents = await svc.listAgents();
  assert.equal(agents[0].id, 'codex');
  assert.equal(agents[0].pinned, true);
  await svc.pinAgent('codex', false);
  agents = await svc.listAgents();
  assert.ok(agents.every((a) => !a.pinned));
});

test('13.16 会话管理：renameSession / pinSession / deleteSession（置顶优先排序）', async () => {
  const svc = makeFast();
  const before = await svc.listSessions('hermes');
  assert.ok(before.every((s) => s.pinned === false), '种子会话默认不置顶');

  // 重命名：trim 后生效，updatedAt 前移
  const renamed = await svc.renameSession('hermes', before[1].id, '  新标题  ');
  assert.equal(renamed.title, '新标题');
  const afterRename = await svc.listSessions('hermes');
  assert.equal(afterRename.find((s) => s.id === before[1].id).title, '新标题');

  // 置顶：pinned 优先排前（稳定），可取消
  await svc.pinSession('hermes', before[2].id, true);
  let list = await svc.listSessions('hermes');
  assert.equal(list[0].id, before[2].id, '置顶会话应排最前');
  assert.equal(list[0].pinned, true);
  await svc.pinSession('hermes', before[2].id, false);
  list = await svc.listSessions('hermes');
  assert.ok(list.every((s) => !s.pinned));

  // 删除：列表移除；删除的是新会话（当前）→ current 落到剩余第一条
  const meta = await svc.newSession('hermes');
  assert.deepEqual(await svc.getOutput('hermes'), []);
  await svc.deleteSession('hermes', meta.id);
  const rest = await svc.listSessions('hermes');
  assert.equal(rest.length, 3);
  assert.ok(!rest.some((s) => s.id === meta.id), '被删会话不应再出现');

  // 防呆：未知会话抛错
  await assert.rejects(() => svc.renameSession('hermes', 'nope', 'x'));
  await assert.rejects(() => svc.deleteSession('hermes', 'nope'));
  await assert.rejects(() => svc.pinSession('hermes', 'nope', true));
});

test('13.16 模型切换：listModels 非空、getModel 默认第一项、setModel 校验成员', async () => {
  const svc = makeFast();
  for (const id of ['openclaw', 'hermes', 'codex', 'claude-code']) {
    const models = await svc.listModels(id);
    assert.ok(models.length >= 3, `${id} 应有演示模型清单`);
    const def = await svc.getModel(id);
    assert.equal(def, models[0], '默认模型应为清单第一项');
    await svc.setModel(id, models[1]);
    assert.equal(await svc.getModel(id), models[1], '切换后应生效');
    await assert.rejects(() => svc.setModel(id, 'not-in-list'), /unknown model/);
  }
  await assert.rejects(() => svc.listModels('nonexistent'));
});

test('13.17 任务/队列/文件：种子齐全且字段完整', async () => {
  const svc = makeFast();
  const tasks = await svc.listTasks();
  assert.ok(tasks.length >= 4, '任务种子应 ≥4 条（覆盖五种状态的演示）');
  const statuses = new Set(tasks.map((t) => t.status));
  for (const s of ['pending', 'running', 'done', 'failed']) {
    assert.ok(statuses.has(s), `任务状态应演示到 ${s}`);
  }
  for (const t of tasks) {
    assert.ok(t.id && t.name && t.agentId && t.status && Number.isFinite(t.createdAt), `任务字段完整 ${t.id}`);
  }
  const queue = await svc.listQueue();
  assert.ok(queue.length >= 1, '队列应至少有 1 条演示');
  for (const q of queue) {
    assert.ok(q.taskId && q.taskName && q.agentId && q.position >= 1, `队列字段完整 ${q.id}`);
    assert.ok(tasks.some((t) => t.id === q.taskId), '队列条目应指向存在的任务');
  }
  const files = await svc.listFiles();
  assert.ok(files.length >= 3, '文件中心应至少 3 条演示');
  for (const f of files) {
    assert.ok(f.name && f.ext && f.sizeBytes > 0 && f.sourceAgentId && f.taskName, `文件字段完整 ${f.id}`);
  }
});

test('13.17 推荐：确定性映射、来源 Agent 不会被推荐', async () => {
  const svc = makeFast();
  for (const id of ['openclaw', 'hermes', 'codex', 'claude-code']) {
    const rec = await svc.getRecommendation(id);
    assert.ok(rec, `${id} 应有推荐`);
    assert.ok(rec.agentId !== id, '推荐目标不得是来源自己');
    assert.ok(rec.reason.length > 4 && typeof rec.confidence === 'number');
  }
  await assert.rejects(() => svc.getRecommendation('nonexistent'));
});

test('13.17 转交：登记为已转交任务 + 队列 + 通知；禁止自转交', async () => {
  const svc = makeFast();
  const beforeTasks = (await svc.listTasks()).length;
  const beforeQueue = (await svc.listQueue()).length;
  const beforeNotes = (await svc.listNotifications()).length;
  const r = await svc.transferTask({
    sourceAgentId: 'hermes', targetAgentId: 'codex',
    includeConversation: true, includeFiles: true, includeTask: false,
  });
  assert.equal(r.ok, true);
  assert.equal(r.queued, true, 'stub 一律入队演示');
  assert.ok(r.message.includes('stub'), '结果消息应带 stub 标识');
  const tasks = await svc.listTasks();
  assert.equal(tasks.length, beforeTasks + 1);
  assert.equal(tasks[0].status, 'transferred');
  assert.equal(tasks[0].agentId, 'codex');
  const queue = await svc.listQueue();
  assert.equal(queue.length, beforeQueue + 1);
  assert.equal(queue[0].position, 1, '新转交任务应排在队首');
  assert.equal(queue.length, new Set(queue.map((q) => q.position)).size, '队列位置应连续不重号');
  const notes = await svc.listNotifications();
  assert.equal(notes.length, beforeNotes + 1);
  assert.equal(notes[0].kind, 'transfer');
  // 任务书 §二十一：禁止转交给自己
  await assert.rejects(() => svc.transferTask({
    sourceAgentId: 'hermes', targetAgentId: 'hermes',
    includeConversation: true, includeFiles: false, includeTask: false,
  }), /self/);
});

test('13.17 stopGeneration：进行中的生成被中断并落定条目', async () => {
  const svc = createStubAgentControlService({ startDelayMs: 10, stopDelayMs: 10, restartGapMs: 5, sendDelayMs: 600 });
  const pushed = [];
  svc.onOutput((id, e) => pushed.push(e));
  const pending = svc.sendInput('hermes', '慢慢回答');
  // 等流式条目出现（sendDelay 600ms 后才开始分片），再触发停止
  const hasStream = () => pushed.some((e) => e.streaming !== undefined);
  for (let i = 0; i < 100 && !hasStream(); i++) await sleep(20);
  assert.ok(hasStream(), '800ms 内应出现流式条目');
  await svc.stopGeneration('hermes');
  await pending; // sendInput 应自行 resolve，不悬挂
  const stream = pushed.filter((e) => e.streaming !== undefined);
  const final = stream[stream.length - 1];
  assert.equal(final.streaming, false, '被打断的条目应落定');
  assert.ok(final.text.includes('已停止'), '落定文本应标注已停止');
  assert.equal(pushed.some((e) => e.kind === 'system' && e.text.includes('stub 输出仅演示')), false, '中断后不应再推送收尾系统条目');
});

test('13.17 stopGeneration：正常完成的发送不受影响', async () => {
  const svc = makeFast();
  const pushed = [];
  svc.onOutput((id, e) => pushed.push(e));
  // 未调用 stopGeneration：完整流程走完
  await svc.sendInput('hermes', '你好');
  const stream = pushed.filter((e) => e.streaming !== undefined);
  assert.ok(stream.length >= 5);
  assert.equal(stream[stream.length - 1].streaming, false);
  assert.ok(!stream[stream.length - 1].text.includes('已停止'), '正常完成不应带停止标注');
  await svc.stopGeneration('hermes'); // 空闲时调用应无副作用
});

test('13.18 设置：18 项导航顺序与 id 契约固定', async () => {
  const svc = makeFast();
  const sections = await svc.listSettingsSections();
  assert.deepEqual(sections, [
    'models', 'chat', 'appearance', 'workspace', 'security', 'browser', 'memory',
    'voice', 'advanced', 'notifications', 'billing', 'providers', 'gateway',
    'hotkeys', 'keys', 'plugins', 'archived', 'about',
  ]);
});

test('13.18 主模型配置：默认 sensenova、校验落点、与对话级切换器双层隔离', async () => {
  const svc = makeFast();
  const cfg = await svc.getMainModelConfig();
  assert.equal(cfg.providerId, 'sensenova');
  assert.ok(['low', 'medium', 'high'].includes(cfg.reasoningLevel));
  // 提供方清单模型名必须与 13.17 STUB_MODELS 同源（不出现第二套名字）
  const known = new Set();
  for (const id of ['openclaw', 'hermes', 'codex', 'claude-code']) {
    for (const m of await svc.listModels(id)) known.add(m);
  }
  for (const p of await svc.listSettingsProviders()) {
    assert.ok(p.models.length >= 2, `提供方 ${p.id} 应有模型`);
    for (const m of p.models) assert.ok(known.has(m), `模型 ${m} 应来自 13.17 已有名`);
  }
  // 应用：合法 → 生效；非法 → 拒绝
  await svc.setMainModelConfig({ providerId: 'anthropic', model: 'claude-opus-4.1', reasoningLevel: 'medium' });
  const after = await svc.getMainModelConfig();
  assert.equal(after.providerId, 'anthropic');
  assert.equal(after.model, 'claude-opus-4.1');
  assert.equal(after.reasoningLevel, 'medium');
  await assert.rejects(() => svc.setMainModelConfig({ providerId: 'nope', model: 'x', reasoningLevel: 'high' }), /unknown provider/);
  await assert.rejects(() => svc.setMainModelConfig({ providerId: 'openai', model: 'claude-opus-4.1', reasoningLevel: 'high' }), /not in provider/);
  await assert.rejects(() => svc.setMainModelConfig({ providerId: 'openai', model: 'o4-mini', reasoningLevel: 'ultra' }), /reasoning level/);
  // 双层隔离：设置层变更不影响对话级当前模型；对话级切换也不影响设置层
  const agentModelBefore = await svc.getModel('openclaw');
  await svc.setMainModelConfig({ providerId: 'sensenova', model: 'deepseek-v4', reasoningLevel: 'high' });
  assert.equal(await svc.getModel('openclaw'), agentModelBefore, '设置层「应用」不得改对话级当前模型');
  await svc.setModel('openclaw', 'glm-5.3');
  assert.equal((await svc.getMainModelConfig()).model, 'deepseek-v4', '对话级切换不得改设置层默认值');
});

test('13.18 辅助模型：8 行固定、指定/重置/全重置、同源校验', async () => {
  const svc = makeFast();
  const rows = await svc.listAuxModels();
  assert.deepEqual(rows.map((r) => r.taskId),
    ['vision', 'compaction', 'skills', 'approvals', 'mcp', 'title-gen', 'review', 'maintainer']);
  assert.deepEqual(rows.map((r) => r.label),
    ['视觉', '压缩', '技能中心', '审批', 'MCP', '标题生成', '评审', '维护器']);
  assert.ok(rows.every((r) => r.boundModel === null), '种子应全部为「自动 · 使用主模型」');
  // 指定：必须是当前主提供方的模型（同源）
  const main = await svc.getMainModelConfig();
  await svc.setAuxModel('vision', main.model);
  let rows2 = await svc.listAuxModels();
  assert.equal(rows2.find((r) => r.taskId === 'vision').boundModel, main.model);
  // 其他提供方的模型 → 拒绝
  const providers = await svc.listSettingsProviders();
  const foreign = providers.find((p) => p.id !== main.providerId).models[0];
  await assert.rejects(() => svc.setAuxModel('vision', foreign), /not offered by provider/);
  // 单行重置 + 未知任务防呆
  await svc.setAuxModel('vision', null);
  assert.equal((await svc.listAuxModels()).find((r) => r.taskId === 'vision').boundModel, null);
  await assert.rejects(() => svc.setAuxModel('nope', 'x'), /unknown aux task/);
  // 全部重置
  await svc.setAuxModel('mcp', main.model);
  await svc.setAuxModel('review', main.model);
  await svc.resetAllAuxModels();
  assert.ok((await svc.listAuxModels()).every((r) => r.boundModel === null));
});

test('13.18 归档：恢复/删除都从列表移除；未知 id 防呆', async () => {
  const svc = makeFast();
  const seeds = await svc.listArchivedSessions();
  assert.ok(seeds.length >= 3);
  for (const s of seeds) assert.ok(s.id && s.title && s.agentId && Number.isFinite(s.archivedAt));
  await svc.restoreArchivedSession(seeds[0].id);
  await svc.deleteArchivedSessionForever(seeds[1].id);
  const rest = await svc.listArchivedSessions();
  assert.equal(rest.length, seeds.length - 2);
  assert.ok(!rest.some((s) => s.id === seeds[0].id || s.id === seeds[1].id));
  await assert.rejects(() => svc.restoreArchivedSession(seeds[0].id), /not found/);
  await assert.rejects(() => svc.deleteArchivedSessionForever('nope'), /not found/);
});

test('__calls 记录全部调用方法名', async () => {
  const svc = makeFast();
  await svc.listAgents();
  await svc.startAgent('hermes');
  await svc.sendInput('hermes', 'x');
  const names = svc.__calls.map((c) => c.method);
  assert.ok(names.includes('listAgents') && names.includes('startAgent') && names.includes('sendInput'));
});

test('未知 agent id 应抛错（防呆）', async () => {
  const svc = makeFast();
  await assert.rejects(() => svc.startAgent('nonexistent'));
});

test('realAgentControlService：每方法都 throw not-wired-yet（骨架契约）', async () => {
  await assert.rejects(() => realAgentControlService.listAgents(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.startAgent('hermes'), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.exportSession('hermes', 's', 'md'), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.renameSession('hermes', 's', 't'), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.deleteSession('hermes', 's'), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.pinSession('hermes', 's', true), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.setModel('hermes', 'm'), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.listTasks(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.listQueue(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.listFiles(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.getRecommendation('hermes'), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.transferTask({ sourceAgentId: 'hermes', targetAgentId: 'codex', includeConversation: true, includeFiles: true, includeTask: true }), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.listNotifications(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.stopGeneration('hermes'), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.listSettingsSections(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.listSettingsProviders(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.getMainModelConfig(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.setMainModelConfig({ providerId: 'p', model: 'm', reasoningLevel: 'high' }), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.listAuxModels(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.setAuxModel('t', null), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.resetAllAuxModels(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.listArchivedSessions(), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.restoreArchivedSession('x'), /not-wired-yet/);
  await assert.rejects(() => realAgentControlService.deleteArchivedSessionForever('x'), /not-wired-yet/);
  assert.throws(() => realAgentControlService.onStatusChange(() => {}), /not-wired-yet/);
});
