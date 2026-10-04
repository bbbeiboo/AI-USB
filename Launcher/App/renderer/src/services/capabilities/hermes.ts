/**
 * Hermes（NousResearch/hermes-agent）能力全景与原生设置 Schema。
 * ---------------------------------------------------------------------------
 * 版本基线：0.21.4（upstream c0d72947）——依据 AGENT-SOURCES.md。
 * 能力依据全部为本地官方源码包 agents/Hermes/hermes-agent/ 内的实际文件，
 * 标注为 `源码:<相对路径>`；未能在源码定位的能力如实标 unsupported/adapter，
 * 绝不因「应该有」而标 native。官方最新版（上游已大幅前进）的差异只在
 * AGENT-CAPABILITY-MATRIX.md 记录，不改这里的三态判定。
 */
import type { AgentCapabilities, AgentSettingsField } from '../agent-capability-types.ts'

export const HERMES_VERSION = '0.21.4'

const SRC = '源码:agents/Hermes/hermes-agent/'

export const HERMES_CAPABILITIES: AgentCapabilities = {
  agentId: 'hermes',
  version: HERMES_VERSION,
  repoUrl: 'https://github.com/NousResearch/hermes-agent',
  docsUrl: 'https://github.com/NousResearch/hermes-agent#readme',
  groups: {
    agent: [
      { id: 'agent.info', supported: 'native', description: 'hermes --version 输出版本/安装方式/上游 commit', source: `${SRC}hermes_cli（--version 实测 0.21.4）` },
      { id: 'agent.health', supported: 'native', description: '进程存活即健康；estop 提供紧急停止', source: `${SRC}agent/estop.py` },
      { id: 'agent.update', supported: 'native', description: 'hermes update 自更新（git 安装方式）', source: `${SRC}cli.py（--version 输出自带 update 提示）` },
      { id: 'agent.restart', supported: 'native', description: '控制台窗口内重开即重启；无内建 restart 子命令', source: `${SRC}src/core/adapters/hermes.js（聚合器 restart 路径）` },
      { id: 'agent.stop', supported: 'native', description: 'estop / 中断控制可停当前回合', source: `${SRC}agent/interrupt_control.py` },
    ],
    model: [
      { id: 'model.providers', supported: 'native', description: '多提供方注册表：OpenAI/Anthropic/Gemini/Bedrock/Vertex/OpenRouter/LM Studio 等', source: `${SRC}agent/provider_registry.py` },
      { id: 'model.models', supported: 'native', description: 'models_dev 缓存 + provider_models_cache 列模型', source: `${SRC}agent/models_dev.py` },
      { id: 'model.switch', supported: 'native', description: 'config.yaml model: 段切换主模型', source: `${SRC}config.yaml（model: 段）` },
      { id: 'model.test', supported: 'adapter', description: '官方无 provider 连通性测试命令；由聚合器 testProvider 实现', source: '聚合器 13.20 接口（官方源码未见对应命令）' },
      { id: 'model.fallback', supported: 'native', description: 'fallback 冷却与辅助模型回退恢复', source: `${SRC}agent/fallback_cooldown.py` },
      { id: 'model.reasoning', supported: 'native', description: 'reasoning effort 参数', source: `${SRC}agent/reasoning_effort.py` },
      { id: 'model.fast_mode', supported: 'native', description: 'fast mode 独立实现', source: `${SRC}agent/fast_mode.py` },
      { id: 'model.verbosity', supported: 'native', description: 'reasoning/verbosity 参数装配', source: `${SRC}agent/reasoning_params.py` },
    ],
    auxiliary: [
      { id: 'auxiliary.vision', supported: 'native', description: '视觉消息预处理 + 图片路由', source: `${SRC}agent/vision_message_prep.py` },
      { id: 'auxiliary.compression', supported: 'native', description: '上下文压缩（含手动/微压缩）', source: `${SRC}agent/context_compressor.py` },
      { id: 'auxiliary.title', supported: 'native', description: '会话标题生成器', source: `${SRC}agent/title_generator.py` },
      { id: 'auxiliary.review', supported: 'native', description: '评审引擎 + 后台评审队列', source: `${SRC}agent/review_engine.py` },
      { id: 'auxiliary.approval', supported: 'native', description: '智能审批（辅助模型打分）', source: `${SRC}tools/approval_smart.py` },
      { id: 'auxiliary.skills', supported: 'native', description: '技能中心搜索/装配走辅助模型', source: `${SRC}tools/skills_hub.py` },
      { id: 'auxiliary.custom', supported: 'native', description: '辅助模型客户端与任务路由（aux_* 家族）', source: `${SRC}agent/auxiliary_client.py` },
    ],
    conversation: [
      { id: 'conversation.list', supported: 'native', description: '会话持久化 + 会话搜索工具', source: `${SRC}agent/session_persistence.py` },
      { id: 'conversation.create', supported: 'native', description: '新会话即新持久化线程', source: `${SRC}agent/session_persistence.py` },
      { id: 'conversation.open', supported: 'native', description: '恢复既有会话继续对话', source: `${SRC}agent/session_persistence.py` },
      { id: 'conversation.rename', supported: 'native', description: '标题生成器落会话标题（可编辑）', source: `${SRC}agent/title_generator.py` },
      { id: 'conversation.archive', supported: 'adapter', description: '官方无归档语义；聚合器层实现（移入归档清单）', source: '聚合器 13.18/13.20 归档接口' },
      { id: 'conversation.restore', supported: 'adapter', description: '同上，聚合器层恢复', source: '聚合器 13.18/13.20 归档接口' },
      { id: 'conversation.delete', supported: 'native', description: '删除持久化会话文件', source: `${SRC}agent/session_persistence.py` },
      { id: 'conversation.export', supported: 'adapter', description: 'md/json 导出由聚合器按输出转录生成', source: '聚合器 exportSession（13.13 起）' },
    ],
    generation: [
      { id: 'generation.send', supported: 'native', description: '回合循环（turn facade）', source: `${SRC}agent/turn_facade.py` },
      { id: 'generation.stream', supported: 'native', description: '流式投递与单写者流监控', source: `${SRC}agent/stream_delivery.py` },
      { id: 'generation.stop', supported: 'native', description: '中断控制/estop 落定当前回合', source: `${SRC}agent/interrupt_control.py` },
      { id: 'generation.resume', supported: 'native', description: '会话持久化支撑续聊', source: `${SRC}agent/session_persistence.py` },
      { id: 'generation.retry', supported: 'native', description: '回合重试状态机 + 重试工具', source: `${SRC}agent/turn_retry_state.py` },
    ],
    files: [
      { id: 'files.list', supported: 'native', description: '文件操作工具族（list/read/write/search）', source: `${SRC}tools/file_tools.py` },
      { id: 'files.read', supported: 'native', description: '读取 + 抽取（read_extract）', source: `${SRC}tools/read_extract.py` },
      { id: 'files.write', supported: 'native', description: '写入护栏（write_guards）+ 文件安全', source: `${SRC}tools/file_tools_write_guards.py` },
      { id: 'files.upload', supported: 'adapter', description: '「上传」即聚合器把宿主文件放入工作目录；由聚合器实现', source: '聚合器 file:export（通道表）' },
      { id: 'files.download', supported: 'adapter', description: '同上，聚合器把工作目录文件交付宿主', source: '聚合器 file:export（通道表）' },
      { id: 'files.delete', supported: 'native', description: '文件操作工具族含删除', source: `${SRC}tools/file_operations.py` },
      { id: 'files.export', supported: 'adapter', description: '聚合器导出通道', source: '聚合器 file:export（通道表）' },
      { id: 'files.drag_drop', supported: 'adapter', description: '拖拽为 UI 层交互，落地即 files.upload', source: '聚合器 13.17 输入框拖拽预留' },
    ],
    computer: [
      { id: 'computer.terminal', supported: 'native', description: '终端工具（后台/守卫/生命周期/sudo）', source: `${SRC}tools/terminal_tool.py` },
      { id: 'computer.filesystem', supported: 'native', description: '同 files.*（file_tools 族）', source: `${SRC}tools/file_tools.py` },
      { id: 'computer.process', supported: 'native', description: '进程注册表（启动/结果/通知/检查点）', source: `${SRC}tools/process_registry.py` },
      { id: 'computer.browser', supported: 'native', description: '经浏览器工具驱动浏览器（见 browser 组）', source: `${SRC}tools/browser_tool.py` },
      { id: 'computer.keyboard', supported: 'permission-required', description: 'computer-use CUA 后端可注入键盘输入，需权限授予', source: `${SRC}tools/computer_use/cua_backend_input.py + permissions.py` },
      { id: 'computer.mouse', supported: 'permission-required', description: 'CUA 后端可注入鼠标，需权限授予', source: `${SRC}tools/computer_use/cua_backend_input.py + permissions.py` },
      { id: 'computer.screen', supported: 'permission-required', description: 'CUA 后端可截屏/视觉路由，需权限授予', source: `${SRC}tools/computer_use/cua_backend_capture.py` },
      { id: 'computer.window', supported: 'permission-required', description: '窗口读取/布局工具（read_window/apply_layout），需权限授予', source: `${SRC}tools/read_window_tool.py` },
    ],
    browser: [
      { id: 'browser.open', supported: 'native', description: '浏览器工具生命周期 + supervisor', source: `${SRC}tools/browser_tool_lifecycle.py` },
      { id: 'browser.navigate', supported: 'native', description: '导航/快照/会话管理', source: `${SRC}tools/browser_tool_snapshot.py` },
      { id: 'browser.click', supported: 'native', description: '快照定位交互', source: `${SRC}tools/browser_tool.py` },
      { id: 'browser.type', supported: 'native', description: '同上（表单输入）', source: `${SRC}tools/browser_tool.py` },
      { id: 'browser.download', supported: 'native', description: '浏览器会话下载', source: `${SRC}tools/browser_tool_session.py` },
      { id: 'browser.upload', supported: 'native', description: '浏览器会话上传', source: `${SRC}tools/browser_tool_session.py` },
      { id: 'browser.screenshot', supported: 'native', description: '视觉快照（browser_tool_vision）', source: `${SRC}tools/browser_tool_vision.py` },
      { id: 'browser.tabs', supported: 'native', description: '多标签/会话状态（camofox state）', source: `${SRC}tools/browser_camofox_state.py` },
      { id: 'browser.cookies', supported: 'native', description: '真实 profile 会话保持', source: `${SRC}tools/browser_tool_real_profile.py` },
      { id: 'browser.cdp', supported: 'native', description: 'CDP 工具直连', source: `${SRC}tools/browser_cdp_tool.py` },
    ],
    memory: [
      { id: 'memory.read', supported: 'native', description: '记忆工具读取', source: `${SRC}tools/memory_tool.py` },
      { id: 'memory.search', supported: 'native', description: '记忆工具检索', source: `${SRC}tools/memory_tool.py` },
      { id: 'memory.write', supported: 'native', description: '记忆写入（memory_tool_store）', source: `${SRC}tools/memory_tool_store.py` },
      { id: 'memory.delete', supported: 'native', description: '记忆存储管理含删除', source: `${SRC}tools/memory_tool_store.py` },
      { id: 'memory.profile', supported: 'native', description: '用户画像由记忆管理器维护', source: `${SRC}agent/memory_manager.py` },
      { id: 'memory.external_provider', supported: 'native', description: '记忆提供方抽象（可外接）', source: `${SRC}agent/memory_provider.py` },
    ],
    skills: [
      { id: 'skills.list', supported: 'native', description: '技能工具 + 技能中心搜索（官方/GitHub/ClawHub 等源）', source: `${SRC}tools/skills_hub.py` },
      { id: 'skills.load', supported: 'native', description: '技能预处理/装配', source: `${SRC}agent/skill_preprocessing.py` },
      { id: 'skills.create', supported: 'native', description: '技能管理器（批量/守卫）', source: `${SRC}tools/skill_manager_tool.py` },
      { id: 'skills.update', supported: 'native', description: '技能同步（skills_sync）', source: `${SRC}tools/skills_sync.py` },
      { id: 'skills.delete', supported: 'native', description: '技能管理器含删除', source: `${SRC}tools/skill_manager_tool.py` },
      { id: 'skills.approval', supported: 'native', description: '技能 AST 审计 + 守卫 + 台账', source: `${SRC}tools/skills_ast_audit.py` },
    ],
    mcp: [
      { id: 'mcp.list', supported: 'native', description: 'MCP 工具配置与发现', source: `${SRC}tools/mcp_tool_config.py` },
      { id: 'mcp.add', supported: 'native', description: '配置写入（yaml mcp 段）', source: `${SRC}tools/mcp_tool_config.py` },
      { id: 'mcp.remove', supported: 'native', description: '配置移除（yaml mcp 段）', source: `${SRC}tools/mcp_tool_config.py` },
      { id: 'mcp.enable', supported: 'native', description: 'MCP 生命周期管理（启用侧）', source: `${SRC}tools/mcp_tool_lifecycle.py` },
      { id: 'mcp.disable', supported: 'native', description: 'MCP 生命周期管理（禁用侧）', source: `${SRC}tools/mcp_tool_lifecycle.py` },
      { id: 'mcp.tools', supported: 'native', description: 'MCP 工具注册/循环/采样', source: `${SRC}tools/mcp_tool_registration.py` },
      { id: 'mcp.resources', supported: 'native', description: 'MCP 内容/资源通道', source: `${SRC}tools/mcp_tool_content.py` },
      { id: 'mcp.prompts', supported: 'native', description: 'MCP schema/提示通道', source: `${SRC}tools/mcp_tool_schema.py` },
    ],
    delegation: [
      { id: 'delegation.supported', supported: 'native', description: 'delegate 工具族完整存在', source: `${SRC}tools/delegate_tool.py` },
      { id: 'delegation.spawn', supported: 'native', description: '子代理派生（child_run）', source: `${SRC}tools/delegate_tool_child_run.py` },
      { id: 'delegation.parallel', supported: 'native', description: '异步委派并行', source: `${SRC}tools/async_delegation.py` },
      { id: 'delegation.max_children', supported: 'native', description: '委派配置含并发上限', source: `${SRC}tools/delegate_tool_config.py` },
      { id: 'delegation.max_depth', supported: 'native', description: '委派配置含深度上限', source: `${SRC}tools/delegate_tool_config.py` },
      { id: 'delegation.orchestrator', supported: 'native', description: 'MoA 循环（mixture-of-agents 编排）', source: `${SRC}agent/moa_loop.py` },
      { id: 'delegation.worktree', supported: 'native', description: '子代理 git worktree 隔离', source: `${SRC}tools/subagent_worktree.py` },
    ],
    security: [
      { id: 'security.permissions', supported: 'native', description: '审批门（approval 家族）', source: `${SRC}tools/approval.py` },
      { id: 'security.approval', supported: 'native', description: '审批上下文/阈值/人工等待', source: `${SRC}tools/approval_floors.py` },
      { id: 'security.smart_approval', supported: 'native', description: '智能自动批准', source: `${SRC}tools/approval_smart.py` },
      { id: 'security.deny_rules', supported: 'native', description: '威胁模式 + 终端作用域限制', source: `${SRC}tools/threat_patterns.py` },
      { id: 'security.secret_redaction', supported: 'native', description: 'redact/secret_scope 双层脱敏', source: `${SRC}agent/redact.py` },
      { id: 'security.pii_redaction', supported: 'native', description: 'redact 模块同时覆盖 PII 规则', source: `${SRC}agent/redact.py` },
      { id: 'security.website_blocklist', supported: 'native', description: 'tirith 安全 + 搜索策略约束', source: `${SRC}tools/tirith_security.py` },
    ],
    voice: [
      { id: 'voice.input', supported: 'native', description: '语音输入（转写提供方）', source: `${SRC}agent/transcription_provider.py` },
      { id: 'voice.output', supported: 'native', description: 'TTS 提供方注册表', source: `${SRC}agent/tts_provider.py` },
      { id: 'voice.stt', supported: 'native', description: '转写注册表（多引擎）', source: `${SRC}agent/transcription_registry.py` },
      { id: 'voice.tts', supported: 'native', description: 'TTS 注册表（含 neutts 本地合成）', source: `${SRC}tools/neutts_synth.py` },
      { id: 'voice.vad', supported: 'unsupported', description: '未在 0.21.4 源码定位到独立 VAD 模块', source: `${SRC}（全源码 grep 无 vad 实体）` },
      { id: 'voice.streaming', supported: 'native', description: '音频流经流式投递通道', source: `${SRC}agent/stream_delivery.py` },
    ],
    streaming: [
      { id: 'streaming.chat', supported: 'native', description: 'chat completion 流监控', source: `${SRC}agent/chat_completion_stream_monitor.py` },
      { id: 'streaming.gateway', supported: 'native', description: 'gateway 流式通道（配置 gateway: 段）', source: `${SRC}config.yaml（gateway: 段）` },
      { id: 'streaming.events', supported: 'native', description: '单写者流事件', source: `${SRC}agent/stream_single_writer.py` },
    ],
    gateway: [
      { id: 'gateway.gateway', supported: 'native', description: '内建 gateway（bot relay/受管网关）', source: `${SRC}tools/bot_relay.py` },
      { id: 'gateway.telegram', supported: 'native', description: 'send_message 目标族含 Telegram', source: `${SRC}tools/send_message_targets.py` },
      { id: 'gateway.discord', supported: 'native', description: 'Discord 工具 + bot 送达', source: `${SRC}tools/discord_tool.py` },
      { id: 'gateway.slack', supported: 'native', description: 'send_message 目标族含 Slack', source: `${SRC}tools/send_message_targets.py` },
      { id: 'gateway.whatsapp', supported: 'native', description: 'send_message 目标族含 WhatsApp', source: `${SRC}tools/send_message_targets.py` },
    ],
    task: [
      { id: 'task.create', supported: 'native', description: 'kanban 工具建单', source: `${SRC}tools/kanban_tools.py` },
      { id: 'task.list', supported: 'native', description: 'kanban 列单', source: `${SRC}tools/kanban_tools.py` },
      { id: 'task.status', supported: 'native', description: 'kanban 状态上下文', source: `${SRC}tools/kanban_toolset_context.py` },
      { id: 'task.cancel', supported: 'native', description: 'kanban 停止（kanban_stop）', source: `${SRC}agent/kanban_stop.py` },
      { id: 'task.pause', supported: 'native', description: '中断作用域控制支撑暂停语义', source: `${SRC}agent/interrupt_scope.py` },
      { id: 'task.resume', supported: 'native', description: '会话持久化 + 检查点恢复', source: `${SRC}tools/checkpoint_manager.py` },
      { id: 'task.queue', supported: 'native', description: 'cron/周期调度 + 守护池', source: `${SRC}tools/daemon_pool.py` },
      { id: 'task.events', supported: 'native', description: '过程注册表通知', source: `${SRC}tools/process_registry_notifications.py` },
    ],
    transfer: [
      { id: 'transfer.receive', supported: 'adapter', description: 'Hermes 内建 delegate 只面向自身子代理；跨 Agent 接收任务由聚合器适配层落地', source: '聚合器 13.17/13.20 transferTask（adapter-provided）' },
      { id: 'transfer.send', supported: 'adapter', description: '同上（推荐/转交由聚合器统一实现）', source: '聚合器 agent:transfer（通道表）' },
      { id: 'transfer.file', supported: 'adapter', description: '附带文件经聚合器文件通道传递', source: '聚合器 file:export（通道表）' },
      { id: 'transfer.conversation', supported: 'adapter', description: '上下文以转录文本注入目标会话（聚合器实现）', source: '聚合器 transferTask includeConversation' },
      { id: 'transfer.task', supported: 'adapter', description: '任务条目登记进目标队列（聚合器实现）', source: '聚合器 task:queue（通道表）' },
      { id: 'transfer.queue', supported: 'adapter', description: '队列状态机在聚合器层', source: '聚合器 listQueue' },
      { id: 'transfer.recommendation', supported: 'adapter', description: '推荐由聚合器按能力矩阵生成', source: '聚合器 getRecommendation（13.20 能力感知）' },
    ],
    settings: [
      { id: 'settings.get', supported: 'adapter', description: '官方配置为文件态（config.yaml）；聚合器读取后映射', source: `${SRC}cli-config.yaml.example` },
      { id: 'settings.set', supported: 'adapter', description: '聚合器写 config.yaml 对应键（写通道真接线轮落地）', source: `${SRC}cli-config.yaml.example` },
      { id: 'settings.reset', supported: 'adapter', description: '聚合器按 Schema 默认值回写', source: '聚合器 resetSettings' },
      { id: 'settings.export', supported: 'adapter', description: '聚合器导出（剔除 Secret）', source: '聚合器 exportSettings' },
      { id: 'settings.import', supported: 'adapter', description: '聚合器导入校验', source: '聚合器 importSettings' },
      { id: 'settings.schema', supported: 'native', description: '官方示例配置即 Schema 基准（cli-config.yaml.example）', source: `${SRC}cli-config.yaml.example` },
      { id: 'settings.reload', supported: 'unsupported', description: '0.21.4 未见运行时热重载命令；改动需重启 Agent', source: `${SRC}（全源码 grep 无 reload 子命令）` },
    ],
    update: [
      { id: 'update.check', supported: 'native', description: '--version 输出自带上游落后提示（check）', source: `${SRC}cli.py（实测提示 7900 commits behind）` },
      { id: 'update.download', supported: 'native', description: 'hermes update（git pull 安装方式）', source: `${SRC}cli.py` },
      { id: 'update.install', supported: 'native', description: 'hermes update（git pull 安装方式）', source: `${SRC}cli.py` },
      { id: 'update.rollback', supported: 'unsupported', description: '未在源码定位回滚命令（backups/ 为数据备份非程序回滚）', source: `${SRC}（全源码 grep 无 rollback 子命令）` },
    ],
  },
}

/**
 * Hermes 原生设置 Schema（TS 面）——全量映射文档见 docs/HERMES-SETTINGS-MATRIX.md。
 * 这里收录与聚合器 18 个设置页相关的代表字段（覆盖全部顶层段）；
 * source 指向本地官方源码/示例配置。Secret 项只记标记，绝不存值。
 */
export const HERMES_SETTINGS_SCHEMA: AgentSettingsField[] = [
  // —— Model / Provider / Fallback / Reasoning / Fast Mode / Verbosity ——
  { key: 'model.provider', uiName: '模型提供方', type: 'string', description: '主模型提供方（openai/anthropic/openrouter/bedrock/vertex/自定义）', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'models', status: 'implemented', capability: 'model.providers', source: `${SRC}cli-config.yaml.example + agent/provider_registry.py` },
  { key: 'model.name', uiName: '主模型', type: 'string', description: '主模型名（model.name）', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'models', status: 'implemented', capability: 'model.switch', source: `${SRC}config.yaml（model: 段）` },
  { key: 'model.reasoning_effort', uiName: '推理力度', type: 'enum', enumValues: ['low', 'medium', 'high'], description: '推理力度（低中高）', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'models', status: 'implemented', capability: 'model.reasoning', source: `${SRC}agent/reasoning_effort.py` },
  { key: 'model.fast_mode', uiName: '快速模式', type: 'boolean', description: 'fast mode 开关', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'models', status: 'implemented', capability: 'model.fast_mode', source: `${SRC}agent/fast_mode.py` },
  { key: 'model.fallback', uiName: '回退链', type: 'list', description: '主模型不可用时的回退模型链', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'models', status: 'planned', capability: 'model.fallback', source: `${SRC}agent/fallback_cooldown.py` },
  { key: 'auth.api_key', uiName: '提供方 API Key', type: 'string', description: '提供方密钥（值只存 auth 层，聚合器零接触）', configFile: 'auth-store', secret: true, runtimeChange: false, requiresRestart: true, page: 'keys', status: 'advanced/native-only', capability: 'model.providers', source: `${SRC}agent/credential_persistence.py` },
  // —— Auxiliary models ——
  { key: 'auxiliary.*', uiName: '辅助模型绑定', type: 'object', description: '按用途绑定辅助小模型（视觉/压缩/标题/评审/审批/MCP/技能）', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'models', status: 'implemented', capability: 'auxiliary.custom', source: `${SRC}agent/auxiliary_client.py` },
  // —— Terminal / 运行环境 ——
  { key: 'terminal.scope', uiName: '终端作用域', type: 'enum', enumValues: ['workspace', 'wide'], description: '终端可触达目录范围', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'workspace', status: 'planned', capability: 'computer.terminal', source: `${SRC}tools/terminal_scope.py` },
  { key: 'runtime.cwd', uiName: '运行目录', type: 'string', description: 'Agent 工作目录', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'workspace', status: 'planned', capability: 'computer.filesystem', source: `${SRC}agent/runtime_cwd.py` },
  { key: 'code_execution.enabled', uiName: '代码执行', type: 'boolean', description: '代码执行工具开关', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'advanced', status: 'planned', capability: 'computer.terminal', source: `${SRC}tools/code_execution_tool.py` },
  // —— Memory ——
  { key: 'memory.provider', uiName: '记忆提供方', type: 'string', description: '记忆后端选择（可外接）', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'memory', status: 'planned', capability: 'memory.external_provider', source: `${SRC}agent/memory_provider.py` },
  // —— Browser / Web / MCP ——
  { key: 'browser.engine', uiName: '浏览器引擎', type: 'string', description: '浏览器后端（camofox/lightpanda/CDP）', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'browser', status: 'planned', capability: 'browser.open', source: `${SRC}tools/browser_provider.py` },
  { key: 'web_search.provider', uiName: '网页搜索提供方', type: 'string', description: '搜索后端选择', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'browser', status: 'planned', capability: 'browser.navigate', source: `${SRC}agent/web_search_provider.py` },
  { key: 'mcp.servers', uiName: 'MCP 服务器', type: 'list', description: 'MCP 服务器清单（add/remove/enable）', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'keys', status: 'planned', capability: 'mcp.list', source: `${SRC}tools/mcp_tool_config.py` },
  // —— Delegation / Guardrails ——
  { key: 'delegation.max_children', uiName: '子代理并发上限', type: 'number', description: '并行委派上限', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'advanced', status: 'planned', capability: 'delegation.max_children', source: `${SRC}tools/delegate_tool_config.py` },
  { key: 'tool_loop_guardrails.enabled', uiName: '工具循环护栏', type: 'boolean', description: '工具循环/重复护栏', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'advanced', status: 'planned', capability: 'security.deny_rules', source: `${SRC}tools/repetition_guard.py` },
  // —— Approval / Security ——
  { key: 'security.smart_approval', uiName: '智能审批', type: 'boolean', description: '辅助模型参与的自动批准', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'security', status: 'planned', capability: 'security.smart_approval', source: `${SRC}tools/approval_smart.py` },
  { key: 'security.redaction', uiName: '密钥/PII 脱敏', type: 'boolean', description: '输出脱敏开关', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'security', status: 'planned', capability: 'security.secret_redaction', source: `${SRC}agent/redact.py` },
  // —— Voice ——
  { key: 'stt.provider', uiName: '语音转写引擎', type: 'string', description: 'STT 后端', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'voice', status: 'planned', capability: 'voice.stt', source: `${SRC}agent/transcription_registry.py` },
  { key: 'tts.provider', uiName: '语音合成引擎', type: 'string', description: 'TTS 后端（含本地 neutts）', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'voice', status: 'planned', capability: 'voice.tts', source: `${SRC}agent/tts_registry.py` },
  // —— Display ——
  { key: 'display.language', uiName: '界面语言', type: 'string', description: '显示语言（i18n）', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'appearance', status: 'planned', capability: 'agent.info', source: `${SRC}agent/i18n.py` },
  { key: 'display.theme', uiName: '主题', type: 'string', description: '显示主题（外观）', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'appearance', status: 'planned', source: `${SRC}agent/display.py` },
  // —— Gateway / Streaming ——
  { key: 'gateway.enabled', uiName: '网关', type: 'boolean', description: '内建网关开关', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'gateway', status: 'planned', capability: 'gateway.gateway', source: `${SRC}tools/bot_relay.py` },
  { key: 'gateway.channels', uiName: '消息渠道', type: 'list', description: 'Telegram/Discord/Slack/WhatsApp 绑定', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'gateway', status: 'planned', capability: 'gateway.telegram', source: `${SRC}tools/send_message_targets.py` },
  { key: 'streaming.enabled', uiName: '流式输出', type: 'boolean', description: '流式投递开关', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'advanced', status: 'planned', capability: 'streaming.chat', source: `${SRC}agent/stream_delivery.py` },
  // —— Updates / Database / Onboarding ——
  { key: 'updates.channel', uiName: '更新通道', type: 'string', description: '更新通道设置', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'about', status: 'planned', capability: 'update.check', source: `${SRC}config.yaml（updates: 段）` },
  { key: 'database.url', uiName: '数据库', type: 'string', description: '会话/状态数据库位置', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'advanced', status: 'advanced/native-only', source: `${SRC}config.yaml（database: 段）` },
  { key: 'onboarding.completed', uiName: '引导完成标记', type: 'boolean', description: '首次引导状态', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: false, page: 'none', status: 'advanced/native-only', source: `${SRC}agent/onboarding.py` },
  { key: 'telemetry.enabled', uiName: '遥测', type: 'boolean', description: '遥测数据上报开关', configFile: 'config.yaml', secret: false, runtimeChange: false, requiresRestart: true, page: 'security', status: 'planned', source: `${SRC}config.yaml（telemetry: 段）` },
]
