// 13.20 能力层单测：Capability Matrix 契约 / unsupported 如实性 / 转交门控 /
// Hermes 设置 Schema / Secret 分离 / 凭据服务。
// 直接以 Node strip-types 加载渲染层 TS 源码。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY_GROUP_KEYS, AGENT_CAPABILITIES, AGENT_SETTINGS_SCHEMAS, AGENT_INFO, canAcceptTransfer } from '../Launcher/App/renderer/src/services/capabilities/index.ts';
import { createStubAgentControlService, createStubCredentialService } from '../Launcher/App/renderer/src/services/agent-control-stub.ts';

const AGENT_IDS = ['openclaw', 'hermes', 'codex', 'claude-code'];

// 任务书 §三 的 20 类检查项展开为统一能力 id 清单（四 Agent 同名同义，结构统一契约）
const CANONICAL_IDS = {
  agent: ['agent.info', 'agent.health', 'agent.update', 'agent.restart', 'agent.stop'],
  model: ['model.providers', 'model.models', 'model.switch', 'model.test', 'model.fallback', 'model.reasoning', 'model.fast_mode', 'model.verbosity'],
  auxiliary: ['auxiliary.vision', 'auxiliary.compression', 'auxiliary.title', 'auxiliary.review', 'auxiliary.approval', 'auxiliary.skills', 'auxiliary.custom'],
  conversation: ['conversation.list', 'conversation.create', 'conversation.open', 'conversation.rename', 'conversation.archive', 'conversation.restore', 'conversation.delete', 'conversation.export'],
  generation: ['generation.send', 'generation.stream', 'generation.stop', 'generation.resume', 'generation.retry'],
  files: ['files.list', 'files.read', 'files.write', 'files.upload', 'files.download', 'files.delete', 'files.export', 'files.drag_drop'],
  computer: ['computer.terminal', 'computer.filesystem', 'computer.process', 'computer.browser', 'computer.keyboard', 'computer.mouse', 'computer.screen', 'computer.window'],
  browser: ['browser.open', 'browser.navigate', 'browser.click', 'browser.type', 'browser.download', 'browser.upload', 'browser.screenshot', 'browser.tabs', 'browser.cookies', 'browser.cdp'],
  memory: ['memory.read', 'memory.search', 'memory.write', 'memory.delete', 'memory.profile', 'memory.external_provider'],
  skills: ['skills.list', 'skills.load', 'skills.create', 'skills.update', 'skills.delete', 'skills.approval'],
  mcp: ['mcp.list', 'mcp.add', 'mcp.remove', 'mcp.enable', 'mcp.disable', 'mcp.tools', 'mcp.resources', 'mcp.prompts'],
  delegation: ['delegation.supported', 'delegation.spawn', 'delegation.parallel', 'delegation.max_children', 'delegation.max_depth', 'delegation.orchestrator', 'delegation.worktree'],
  security: ['security.permissions', 'security.approval', 'security.smart_approval', 'security.deny_rules', 'security.secret_redaction', 'security.pii_redaction', 'security.website_blocklist'],
  voice: ['voice.input', 'voice.output', 'voice.stt', 'voice.tts', 'voice.vad', 'voice.streaming'],
  streaming: ['streaming.chat', 'streaming.gateway', 'streaming.events'],
  gateway: ['gateway.gateway', 'gateway.telegram', 'gateway.discord', 'gateway.slack', 'gateway.whatsapp'],
  task: ['task.create', 'task.list', 'task.status', 'task.cancel', 'task.pause', 'task.resume', 'task.queue', 'task.events'],
  transfer: ['transfer.receive', 'transfer.send', 'transfer.file', 'transfer.conversation', 'transfer.task', 'transfer.queue', 'transfer.recommendation'],
  settings: ['settings.get', 'settings.set', 'settings.reset', 'settings.export', 'settings.import', 'settings.schema', 'settings.reload'],
  update: ['update.check', 'update.download', 'update.install', 'update.rollback'],
};

const SUPPORT_STATES = ['native', 'adapter', 'unsupported', 'permission-required', 'sandbox-only'];

test('能力组键 20 组且顺序固定（任务书 §三 类别顺序）', () => {
  assert.deepEqual(CAPABILITY_GROUP_KEYS, Object.keys(CANONICAL_IDS));
});

test('Agent Interface 契约：四个 Agent 都有完整身份档案与能力全景', () => {
  for (const id of AGENT_IDS) {
    const info = AGENT_INFO[id];
    assert.ok(info, `info ${id}`);
    assert.ok(info.version.length >= 4, `${id} 版本号`);
    assert.ok(info.repoUrl.startsWith('https://'), `${id} repoUrl`);
    assert.ok(info.docsUrl.startsWith('http'), `${id} docsUrl`);
    assert.ok(info.localEntry.length >= 4 && info.configEntrance.length >= 4, `${id} 入口说明`);

    const caps = AGENT_CAPABILITIES[id];
    assert.equal(caps.agentId, id);
    assert.equal(caps.version, info.version, `${id} 版本一致性`);
    for (const group of CAPABILITY_GROUP_KEYS) {
      assert.deepEqual(
        caps.groups[group].map((c) => c.id).sort(),
        [...CANONICAL_IDS[group]].sort(),
        `${id}.${group} 能力 id 集合与统一契约一致`,
      );
    }
    // 每条能力：五态合法 + 描述与依据非空（禁止无依据判定）
    for (const group of CAPABILITY_GROUP_KEYS) {
      for (const c of caps.groups[group]) {
        assert.ok(SUPPORT_STATES.includes(c.supported), `${id} ${c.id} 五态`);
        assert.ok(c.description.length >= 6, `${id} ${c.id} 描述`);
        assert.ok(c.source.length >= 4, `${id} ${c.id} 依据`);
      }
    }
  }
});

test('Unsupported 如实性：已知不支持项必须保持 unsupported（不得伪造 native）', () => {
  const get = (id, cap) => {
    for (const g of CAPABILITY_GROUP_KEYS) {
      const hit = AGENT_CAPABILITIES[id].groups[g].find((c) => c.id === cap);
      if (hit) return hit;
    }
    return null;
  };
  // 调研/源码定位不出的能力一律 unsupported
  assert.equal(get('hermes', 'voice.vad').supported, 'unsupported');
  assert.equal(get('hermes', 'settings.reload').supported, 'unsupported');
  assert.equal(get('hermes', 'update.rollback').supported, 'unsupported');
  assert.equal(get('openclaw', 'model.fast_mode').supported, 'unsupported');
  assert.equal(get('openclaw', 'mcp.resources').supported, 'unsupported');
  assert.equal(get('openclaw', 'security.pii_redaction').supported, 'unsupported');
  assert.equal(get('openclaw', 'delegation.worktree').supported, 'unsupported');
  // 五态语义锚点：OpenClaw 桌面控制是真 native（computer-use 循环）；接收转交是官方 native（webhooks/A2A/RPC）
  assert.equal(get('openclaw', 'computer.screen').supported, 'permission-required');
  assert.equal(get('openclaw', 'transfer.receive').supported, 'native');
  assert.equal(get('hermes', 'computer.keyboard').supported, 'permission-required');
  // Hermes 官方源码实体锚点（terminal/browser/memory/delegation 均有源码文件）
  assert.equal(get('hermes', 'computer.terminal').supported, 'native');
  assert.equal(get('hermes', 'browser.cdp').supported, 'native');
});

test('Adapter 能力锚点：跨 Agent 转交的队列/推荐由聚合器提供（adapter-provided 如实标注）', () => {
  for (const id of AGENT_IDS) {
    for (const cap of ['transfer.queue', 'transfer.recommendation']) {
      const c = AGENT_CAPABILITIES[id].groups.transfer.find((x) => x.id === cap);
      assert.equal(c.supported, 'adapter', `${id} ${cap}`);
      assert.match(c.description, /聚合器/, `${id} ${cap} 描述写明聚合器补位`);
    }
  }
});

// —— 转交能力门控（13.20 §十三）———————————————————————————————

test('canAcceptTransfer：四 Agent 全附带内容可接收（native/adapter 均放行，仅 unsupported 拦截）', () => {
  for (const id of AGENT_IDS) {
    const gate = canAcceptTransfer(id, { includeConversation: true, includeFiles: true, includeTask: true });
    assert.equal(gate.ok, true, `${id} 应可接收`);
  }
});

test('canAcceptTransfer：目标不支持的能力被拦截并给出人话原因（注入能力集验证）', () => {
  const caps = structuredClone(AGENT_CAPABILITIES.hermes);
  const fileCap = caps.groups.transfer.find((c) => c.id === 'transfer.file');
  fileCap.supported = 'unsupported';
  const gate = canAcceptTransfer('hermes', { includeConversation: true, includeFiles: true, includeTask: true }, caps);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /transfer\.file=unsupported/);

  const convCaps = structuredClone(AGENT_CAPABILITIES.codex);
  convCaps.groups.transfer.find((c) => c.id === 'transfer.receive').supported = 'unsupported';
  const gate2 = canAcceptTransfer('codex', { includeConversation: false, includeFiles: false, includeTask: true }, convCaps);
  assert.equal(gate2.ok, false);
  assert.match(gate2.reason, /transfer\.receive=unsupported/);

  // 不勾选被拦截的附带内容时放行（按需判定，不做一刀切）
  const gate3 = canAcceptTransfer('hermes', { includeConversation: true, includeFiles: false, includeTask: true }, caps);
  assert.equal(gate3.ok, true);
});

test('stub transferTask 走能力门控：正向路径放行（拦截路径由 canAcceptTransfer 注入用例覆盖）', async () => {
  const svc = createStubAgentControlService({ sendDelayMs: 5 });
  const r = await svc.transferTask({ sourceAgentId: 'hermes', targetAgentId: 'codex', includeConversation: true, includeFiles: true, includeTask: true });
  assert.equal(r.ok, true);
});

// —— 设置 Schema（13.20 §七）——————————————————————————————————

test('Hermes 设置 Schema：字段结构完整、enum 有取值域、Secret 无默认值', () => {
  const schema = AGENT_SETTINGS_SCHEMAS.hermes;
  assert.ok(schema.length >= 25, `Hermes Schema 应覆盖全部顶层段（实际 ${schema.length}）`);
  const keys = new Set();
  for (const f of schema) {
    assert.ok(f.key && f.uiName && f.description, `字段名/描述 ${f.key}`);
    assert.ok(f.source.length >= 4, `依据 ${f.key}`);
    assert.ok(!keys.has(f.key), `key 唯一 ${f.key}`);
    keys.add(f.key);
    if (f.type === 'enum') assert.ok((f.enumValues ?? []).length >= 2, `enum 取值域 ${f.key}`);
    if (f.secret) assert.equal('defaultValue' in f, false, `Secret 字段不得带默认值 ${f.key}`);
    assert.ok(['implemented', 'planned', 'advanced/native-only'].includes(f.status), `status ${f.key}`);
  }
  // Secret 标记锚点：Hermes API Key 走 auth 层
  const secret = schema.find((f) => f.key === 'auth.api_key');
  assert.ok(secret && secret.secret === true && secret.configFile === 'auth-store');
});

test('四 Agent 都有设置 Schema 且无重复 key', () => {
  for (const id of AGENT_IDS) {
    const schema = AGENT_SETTINGS_SCHEMAS[id];
    assert.ok(schema.length >= 8, `${id} schema 覆盖度`);
    const keys = schema.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, `${id} key 唯一`);
  }
});

test('stub getSettingsSchema/getSettings/setSettings：Schema 校验 + Secret 拒入 + 不落盘', async () => {
  const svc = createStubAgentControlService();
  const schema = await svc.getSettingsSchema('hermes');
  assert.ok(schema.length >= 25);

  const settings = await svc.getSettings('hermes');
  assert.ok('display.language' in settings, '内存镜像含 Schema 字段');

  await svc.setSettings('hermes', { 'model.reasoning_effort': 'low' });
  assert.equal((await svc.getSettings('hermes'))['model.reasoning_effort'], 'low');

  // 未知键 / 类型错 / enum 错 / Secret 键 全部拒绝
  await assert.rejects(() => svc.setSettings('hermes', { 'no.such.key': 1 }), /unknown settings key/);
  await assert.rejects(() => svc.setSettings('hermes', { 'delegation.max_children': 'many' }), /number/);
  await assert.rejects(() => svc.setSettings('hermes', { 'model.reasoning_effort': 'ultra' }), /取值须为/);
  await assert.rejects(() => svc.setSettings('hermes', { 'auth.api_key': 'sk-xxx' }), /CredentialService/);
  // Secret 拒入后镜像中不存在该键（密钥零接触）
  assert.ok(!('auth.api_key' in (await svc.getSettings('hermes'))));

  await svc.resetSettings('hermes', ['model.reasoning_effort']);
  assert.notEqual((await svc.getSettings('hermes'))['model.reasoning_effort'], 'low');

  const exported = await svc.exportSettings('hermes');
  assert.match(exported.filename, /^hermes-settings-.*\.json$/);
  assert.ok(!exported.content.includes('sk-'), '导出内容不含任何密钥形状字符串');
});

test('stub importSettings：合法 JSON 计数导入、非法输入防呆', async () => {
  const svc = createStubAgentControlService();
  const n = await svc.importSettings('codex', JSON.stringify({ model_reasoning_effort: 'low' }));
  assert.equal(n, 1);
  assert.equal((await svc.getSettings('codex')).model_reasoning_effort, 'low');
  await assert.rejects(() => svc.importSettings('codex', '{bad json'), /合法 JSON/);
  await assert.rejects(() => svc.importSettings('codex', '[1,2]'), /settings 对象/);
  await assert.rejects(() => svc.importSettings('codex', JSON.stringify({ env_key: 'x' })), /CredentialService/);
});

// —— Secret 分离 / CredentialService（任务书 §十）—————————————————

test('CredentialService：明文永不出口（configured+masked 之外无任何值）', async () => {
  const cred = createStubCredentialService();
  assert.equal(await cred.hasCredential('hermes.model'), false);
  await cred.setCredential('hermes.model', 'super-secret-value-123');
  assert.equal(await cred.hasCredential('hermes.model'), true);

  const status = await cred.getCredential('hermes.model');
  assert.equal(status.configured, true);
  assert.equal(status.maskedValue, '••••••••');
  // 序列化结果整体不含明文（密钥零接触验收口径）
  assert.ok(!JSON.stringify(status).includes('super-secret-value-123'));

  const probe = await cred.getCredential('nothing.here');
  assert.equal(probe.configured, false);
  assert.equal(probe.maskedValue, '');

  await cred.deleteCredential('hermes.model');
  assert.equal(await cred.hasCredential('hermes.model'), false);
  await assert.rejects(() => cred.setCredential('x', ''), /不能为空/);

  // stub 不伪造连通性成功
  const test = await cred.testCredential('hermes.model');
  assert.equal(test.ok, false);
  assert.match(test.message, /stub/);
});

// —— 13.20 新增服务行为 ————————————————————————————————————————

test('getInfo/getCapabilities：stub 返回档案与能力全景（deep copy，外部改不动注册表）', async () => {
  const svc = createStubAgentControlService();
  const info = await svc.getInfo('openclaw');
  assert.equal(info.version, '2026.9.5');
  const caps = await svc.getCapabilities('openclaw');
  assert.equal(caps.agentId, 'openclaw');
  caps.groups.model.find((c) => c.id === 'model.switch').supported = 'unsupported';
  const caps2 = await svc.getCapabilities('openclaw');
  assert.equal(caps2.groups.model.find((c) => c.id === 'model.switch').supported, 'native');
  await assert.rejects(() => svc.getInfo('nope'), /unknown agent/);
});

test('archiveSession：会话进归档清单并可被既有 restore 消费', async () => {
  const svc = createStubAgentControlService();
  const before = (await svc.listSessions('hermes')).length;
  const archBefore = (await svc.listArchivedSessions()).length;
  const target = (await svc.listSessions('hermes'))[0];
  await svc.archiveSession('hermes', target.id);
  assert.equal((await svc.listSessions('hermes')).length, before - 1);
  const archived = await svc.listArchivedSessions();
  assert.equal(archived.length, archBefore + 1);
  assert.ok(archived.some((s) => s.id === target.id));
  await svc.restoreArchivedSession(target.id);
  assert.equal((await svc.listArchivedSessions()).length, archBefore);
  await assert.rejects(() => svc.archiveSession('hermes', 'no-such'), /not found/);
});

test('checkUpdate：stub 不联网（upToDate=null）且 message 带 stub 与版本差距说明', async () => {
  const svc = createStubAgentControlService();
  const u = await svc.checkUpdate('hermes');
  assert.equal(u.currentVersion, '0.21.4');
  assert.equal(u.latestVersion, null);
  assert.equal(u.upToDate, null);
  assert.match(u.message, /stub/);
});

test('testProvider：未知提供方防呆；已知提供方不伪造连通性成功', async () => {
  const svc = createStubAgentControlService();
  await assert.rejects(() => svc.testProvider('no-such-provider'), /unknown provider/);
  const r = await svc.testProvider('sensenova');
  assert.equal(r.ok, false);
  assert.match(r.message, /未发送任何请求/);
});
