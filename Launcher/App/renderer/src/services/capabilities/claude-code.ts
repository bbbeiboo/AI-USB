/**
 * Claude Code（Anthropic）能力全景与原生设置 Schema。
 * ---------------------------------------------------------------------------
 * 版本基线：2.1.288（原生安装；npm latest 2.1.289 / stable 通道 2.1.285，本机居中）。
 * 能力依据全部为官方文档 code.claude.com/docs，标注为 `文档:code.claude.com/docs/en/<页>`。
 * 两处反直觉事实（调研代理核实，官方文档明确）：① macOS CLI 有内置 computer-use MCP
 * （research preview，/mcp 启用；Windows CLI 无桌面控制）；② CLI 有 /voice 听写与
 * channels 消息机制（均需 claude.ai 账户，API key 下不可用）。本机为 Windows，
 * 平台限制在描述中写明，不因 macOS 有而给 Windows 记 native。
 */
import type { AgentCapabilities, AgentSettingsField } from '../agent-capability-types.ts'

export const CLAUDE_CODE_VERSION = '2.1.288'

const DOC = '文档:code.claude.com/docs/en'

export const CLAUDE_CODE_CAPABILITIES: AgentCapabilities = {
  agentId: 'claude-code',
  version: CLAUDE_CODE_VERSION,
  repoUrl: 'https://github.com/anthropics/claude-code',
  docsUrl: 'https://code.claude.com/docs',
  groups: {
    agent: [
      { id: 'agent.info', supported: 'native', description: 'claude --version + claude doctor（健康诊断）+ 会话内 /status', source: `${DOC}/cli-reference` },
      { id: 'agent.health', supported: 'native', description: 'claude doctor（安装健康/设置校验，只读）', source: `${DOC}/cli-reference` },
      { id: 'agent.update', supported: 'native', description: 'claude update + 原生自动后台更新（通道 latest/stable）', source: `${DOC}/setup` },
      { id: 'agent.restart', supported: 'adapter', description: '官方无 restart 命令；聚合器进程管理器负责重启', source: 'src/core/adapters/claude-code.js（聚合器进程层）' },
      { id: 'agent.stop', supported: 'adapter', description: '无独立 stop 命令（会话内 Esc 中断回合为 native）；停进程由聚合器实现', source: `${DOC}/interactive-mode` },
    ],
    model: [
      { id: 'model.providers', supported: 'native', description: 'Anthropic API / Bedrock / Vertex 接入（env 决定）', source: `${DOC}/model-config` },
      { id: 'model.models', supported: 'native', description: '别名 default/opus/sonnet/haiku/fable + availableModels/deniedModels', source: `${DOC}/settings-reference` },
      { id: 'model.switch', supported: 'native', description: '/model（Enter 存默认 / s 仅本会话）+ --model + settings model', source: `${DOC}/model-config` },
      { id: 'model.test', supported: 'adapter', description: '官方无连通性测试命令；聚合器 testProvider 实现', source: `${DOC}/cli-reference（无对应命令）` },
      { id: 'model.fallback', supported: 'native', description: 'fallbackModel 链（最多 3 个，过载/不可用时触发）', source: `${DOC}/model-config` },
      { id: 'model.reasoning', supported: 'native', description: 'alwaysThinkingEnabled + CLAUDE_CODE_EFFORT_LEVEL / /effort + ultrathink', source: `${DOC}/model-config` },
      { id: 'model.fast_mode', supported: 'unsupported', description: '官方无 fast mode 键', source: `${DOC}/model-config（无对应项）` },
      { id: 'model.verbosity', supported: 'unsupported', description: '无 verbosity 键（详细度仅 MAX_THINKING_TOKENS 类推理预算）', source: `${DOC}/settings-reference（无对应键）` },
    ],
    auxiliary: [
      { id: 'auxiliary.vision', supported: 'unsupported', description: '无按用途视觉小模型键（视觉随主模型）', source: `${DOC}/model-config（无对应键）` },
      { id: 'auxiliary.compression', supported: 'unsupported', description: '有 /compact 但无压缩专用模型键', source: `${DOC}/model-config（无对应键）` },
      { id: 'auxiliary.title', supported: 'unsupported', description: '无标题生成专用模型键', source: `${DOC}/model-config（无对应键）` },
      { id: 'auxiliary.review', supported: 'unsupported', description: '无 review 专用模型键', source: `${DOC}/model-config（无对应键）` },
      { id: 'auxiliary.approval', supported: 'unsupported', description: '无审批打分专用模型键（auto 模式分类器不可配模型）', source: `${DOC}/permissions（无对应键）` },
      { id: 'auxiliary.skills', supported: 'unsupported', description: '无技能搜索专用模型键', source: `${DOC}/skills（无对应键）` },
      { id: 'auxiliary.custom', supported: 'native', description: 'ANTHROPIC_DEFAULT_*_MODEL 别名 + subagent model 字段 + CLAUDE_CODE_SUBAGENT_MODEL', source: `${DOC}/model-config` },
    ],
    conversation: [
      { id: 'conversation.list', supported: 'native', description: '/resume 选择器（搜索/重命名/跨项目）', source: `${DOC}/sessions` },
      { id: 'conversation.create', supported: 'native', description: '新会话（/ + claude -n 命名新建）', source: `${DOC}/sessions` },
      { id: 'conversation.open', supported: 'native', description: '--resume <id|name|路径> / --continue', source: `${DOC}/cli-reference` },
      { id: 'conversation.rename', supported: 'native', description: '/rename + 选择器 Ctrl+R + claude -n', source: `${DOC}/sessions` },
      { id: 'conversation.archive', supported: 'unsupported', description: '官方明确无归档命令（文档建议 SessionEnd hook 自实现）', source: `${DOC}/sessions（官方明确的「无」）` },
      { id: 'conversation.restore', supported: 'adapter', description: '聚合器归档清单实现（配合 archive=unsupported 的现状）', source: '聚合器 13.18/13.20 归档接口' },
      { id: 'conversation.delete', supported: 'unsupported', description: '无官方删除命令（会话为 ~/.claude/projects 下 jsonl）', source: `${DOC}/sessions（无对应命令）` },
      { id: 'conversation.export', supported: 'native', description: '/export 菜单 + -p --output-format json + hooks transcript_path', source: `${DOC}/sessions` },
    ],
    generation: [
      { id: 'generation.send', supported: 'native', description: '交互 + claude -p 非交互（stdin 管道上限 10MB）', source: `${DOC}/headless` },
      { id: 'generation.stream', supported: 'native', description: '交互流式 + --include-partial-messages token 级 stream_event', source: `${DOC}/headless` },
      { id: 'generation.stop', supported: 'native', description: 'Esc 中断当前回合；headless SIGINT / SDK interrupt()；可续接被中断回合', source: `${DOC}/interactive-mode` },
      { id: 'generation.resume', supported: 'native', description: 'CLAUDE_CODE_RESUME_INTERRUPTED_TURN 续接 + --resume 会话级', source: `${DOC}/headless` },
      { id: 'generation.retry', supported: 'native', description: 'system/api_retry 事件（attempt/max_retries/retry_delay_ms）', source: `${DOC}/headless` },
    ],
    files: [
      { id: 'files.list', supported: 'native', description: '文件工具族 + @ 目录引用', source: `${DOC}/common-workflows` },
      { id: 'files.read', supported: 'native', description: 'Read 工具（gitignore 语法权限规则，可护住 .env）', source: `${DOC}/permissions` },
      { id: 'files.write', supported: 'native', description: 'Write/Edit 工具（权限规则约束）', source: `${DOC}/permissions` },
      { id: 'files.upload', supported: 'native', description: '@ 文件/目录引用 + 图片粘贴（Windows Alt+V）+ 路径', source: `${DOC}/common-workflows` },
      { id: 'files.download', supported: 'adapter', description: '聚合器把产物交付宿主（file:export）', source: '聚合器 file:export（通道表）' },
      { id: 'files.delete', supported: 'native', description: 'Bash 工具删除（权限规则约束）', source: `${DOC}/permissions` },
      { id: 'files.export', supported: 'adapter', description: '聚合器导出通道', source: '聚合器 file:export（通道表）' },
      { id: 'files.drag_drop', supported: 'native', description: '官方明确图片拖拽入会话', source: `${DOC}/common-workflows` },
    ],
    computer: [
      { id: 'computer.terminal', supported: 'native', description: 'Bash 工具（后台化/权限规则；原生 Windows 无沙箱）', source: `${DOC}/sandboxing` },
      { id: 'computer.filesystem', supported: 'native', description: 'Read/Write/Edit + additionalDirectories', source: `${DOC}/permissions` },
      { id: 'computer.process', supported: 'native', description: 'Bash 子进程 + 后台任务', source: `${DOC}/interactive-mode` },
      { id: 'computer.browser', supported: 'native', description: '经 Claude in Chrome 扩展驱动浏览器（见 browser 组）', source: `${DOC}/chrome` },
      { id: 'computer.keyboard', supported: 'permission-required', description: '内置 computer-use MCP（/mcp 启用，逐会话按应用批准）——仅 macOS research preview；Windows CLI 无', source: `${DOC}/computer-use` },
      { id: 'computer.mouse', supported: 'permission-required', description: '同上（点击/滚动；仅 macOS research preview）', source: `${DOC}/computer-use` },
      { id: 'computer.screen', supported: 'permission-required', description: '同上（截屏，终端窗口排除在外；仅 macOS research preview）', source: `${DOC}/computer-use` },
      { id: 'computer.window', supported: 'permission-required', description: '同上（打开应用/操作窗口；仅 macOS research preview）', source: `${DOC}/computer-use` },
    ],
    browser: [
      { id: 'browser.open', supported: 'adapter', description: 'Claude in Chrome 扩展（≥1.0.36，claude --chrome / /chrome）以 MCP 工具暴露；需 claude.ai 登录，不支持 WSL', source: `${DOC}/chrome` },
      { id: 'browser.navigate', supported: 'adapter', description: '同上（Chromium 系：Chrome/Edge/Brave/Arc/Vivaldi/Opera）', source: `${DOC}/chrome` },
      { id: 'browser.click', supported: 'adapter', description: '同上（browser_batch 批量动作）', source: `${DOC}/chrome` },
      { id: 'browser.type', supported: 'adapter', description: '同上（browser_batch 批量动作）', source: `${DOC}/chrome` },
      { id: 'browser.download', supported: 'adapter', description: '同上（browser_batch 批量动作）', source: `${DOC}/chrome` },
      { id: 'browser.upload', supported: 'adapter', description: '同上（browser_batch 批量动作）', source: `${DOC}/chrome` },
      { id: 'browser.screenshot', supported: 'adapter', description: '同上（截图/GIF 录制）', source: `${DOC}/chrome` },
      { id: 'browser.tabs', supported: 'adapter', description: '同上（扩展运行于用户真实 Chrome）', source: `${DOC}/chrome` },
      { id: 'browser.cookies', supported: 'adapter', description: '同上（用户登录态随扩展可用）', source: `${DOC}/chrome` },
      { id: 'browser.cdp', supported: 'unsupported', description: '官方未提供 CDP 直连接口（扩展路径非 CDP）', source: `${DOC}/chrome（无对应项）` },
    ],
    memory: [
      { id: 'memory.read', supported: 'native', description: 'CLAUDE.md 层级（managed→user→project→local）+ @path 导入', source: `${DOC}/memory` },
      { id: 'memory.search', supported: 'native', description: 'auto memory 笔记（MEMORY.md 每会话自动加载）+ 文件检索工具', source: `${DOC}/memory` },
      { id: 'memory.write', supported: 'native', description: 'auto memory 自写笔记（~/.claude/projects/<project>/memory/）', source: `${DOC}/memory` },
      { id: 'memory.delete', supported: 'native', description: '编辑/删除记忆文件（autoMemoryDirectory 可迁移）', source: `${DOC}/settings-reference` },
      { id: 'memory.profile', supported: 'native', description: 'auto memory 四类含 user（用户事实画像）', source: `${DOC}/memory` },
      { id: 'memory.external_provider', supported: 'unsupported', description: '无外接记忆提供方键', source: `${DOC}/settings-reference（无对应键）` },
    ],
    skills: [
      { id: 'skills.list', supported: 'native', description: '~/.claude/skills、.claude/skills、插件 skills/、claude.ai synced', source: `${DOC}/skills` },
      { id: 'skills.load', supported: 'native', description: '按 description 自动加载 + /skill-name 手动 + paths glob 触发', source: `${DOC}/skills` },
      { id: 'skills.create', supported: 'native', description: 'SKILL.md + frontmatter（name/description/allowed-tools 等）', source: `${DOC}/skills` },
      { id: 'skills.update', supported: 'native', description: '技能文件即接口，直接更新', source: `${DOC}/skills` },
      { id: 'skills.delete', supported: 'native', description: '删除技能目录/插件', source: `${DOC}/skills` },
      { id: 'skills.approval', supported: 'native', description: 'marketplace 安装经 /plugin 流程 + 托管设置锁定', source: `${DOC}/settings-reference` },
    ],
    mcp: [
      { id: 'mcp.list', supported: 'native', description: 'claude mcp list/get', source: `${DOC}/mcp` },
      { id: 'mcp.add', supported: 'native', description: 'claude mcp add/add-json（http/sse/stdio/ws；.mcp.json 项目级）', source: `${DOC}/mcp` },
      { id: 'mcp.remove', supported: 'native', description: 'claude mcp remove', source: `${DOC}/mcp` },
      { id: 'mcp.enable', supported: 'native', description: 'scope 优先级 managed>local>project>user>plugin + 信任批准', source: `${DOC}/mcp` },
      { id: 'mcp.disable', supported: 'native', description: 'scope 优先级 managed>local>project>user>plugin + 信任批准', source: `${DOC}/mcp` },
      { id: 'mcp.tools', supported: 'native', description: 'mcp__<server>__<tool> 命名 + >2min 自动后台化', source: `${DOC}/mcp` },
      { id: 'mcp.resources', supported: 'native', description: '@server:resource 资源引用（MCP 协议）', source: `${DOC}/mcp` },
      { id: 'mcp.prompts', supported: 'native', description: 'MCP prompts 经协议暴露', source: `${DOC}/mcp` },
    ],
    delegation: [
      { id: 'delegation.supported', supported: 'native', description: 'subagents（Task 工具，独立上下文窗口）', source: `${DOC}/sub-agents` },
      { id: 'delegation.spawn', supported: 'native', description: '.claude/agents 定义 + claude --agent / --agents', source: `${DOC}/sub-agents` },
      { id: 'delegation.parallel', supported: 'native', description: '前台/后台并行 subagent（Ctrl+B 转后台）', source: `${DOC}/sub-agents` },
      { id: 'delegation.max_children', supported: 'native', description: 'CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS（默认 20）', source: `${DOC}/sub-agents` },
      { id: 'delegation.max_depth', supported: 'native', description: 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH（默认 3）', source: `${DOC}/sub-agents` },
      { id: 'delegation.orchestrator', supported: 'native', description: 'agent teams（实验性，lead+teammates+共享任务列表）', source: `${DOC}/agent-teams` },
      { id: 'delegation.worktree', supported: 'native', description: 'subagent frontmatter isolation: worktree', source: `${DOC}/sub-agents` },
    ],
    security: [
      { id: 'security.permissions', supported: 'native', description: 'permission modes default/acceptEdits/plan/auto/dontAsk/bypassPermissions', source: `${DOC}/permissions` },
      { id: 'security.approval', supported: 'native', description: 'permissions.allow/ask/deny（deny→ask→allow 求值）+ /permissions', source: `${DOC}/permissions` },
      { id: 'security.smart_approval', supported: 'native', description: 'auto 模式分类器（无常规提示）', source: `${DOC}/permissions` },
      { id: 'security.deny_rules', supported: 'native', description: 'Tool(specifier) 规则语法（Bash/Read/Edit/WebFetch/mcp__）', source: `${DOC}/permissions` },
      { id: 'security.secret_redaction', supported: 'native', description: 'PreToolUse hook 可拦截并改写入参（updatedInput 脱敏）', source: `${DOC}/hooks` },
      { id: 'security.pii_redaction', supported: 'unsupported', description: '无专用 PII 脱敏特性（可经 PreToolUse hook 自实现）', source: `${DOC}/hooks（无专用特性）` },
      { id: 'security.website_blocklist', supported: 'sandbox-only', description: 'sandbox.network.allowedDomains 代理 allowlist——仅 macOS/Linux 沙箱；Windows 无沙箱', source: `${DOC}/sandboxing` },
    ],
    voice: [
      { id: 'voice.input', supported: 'native', description: '/voice 语音听写（按住 Space/tap；需 claude.ai 账户，API key 不可用；Windows/WSL 需 WSLg）', source: `${DOC}/voice-dictation` },
      { id: 'voice.output', supported: 'unsupported', description: '无 TTS 朗读能力', source: `${DOC}/voice-dictation（无对应项）` },
      { id: 'voice.stt', supported: 'native', description: '听写转录（21 种语言，不耗 token）', source: `${DOC}/voice-dictation` },
      { id: 'voice.tts', supported: 'unsupported', description: '无 TTS 朗读能力', source: `${DOC}（无对应能力）` },
      { id: 'voice.vad', supported: 'unsupported', description: '无独立 VAD（push-to-talk 为手动触发）', source: `${DOC}/voice-dictation（无对应项）` },
      { id: 'voice.streaming', supported: 'unsupported', description: '未定位流式语音语义', source: `${DOC}/voice-dictation（无对应项）` },
    ],
    streaming: [
      { id: 'streaming.chat', supported: 'native', description: '-p --output-format stream-json + --include-partial-messages（text_delta）', source: `${DOC}/headless` },
      { id: 'streaming.gateway', supported: 'native', description: '--input-format stream-json 双向流式', source: `${DOC}/cli-reference` },
      { id: 'streaming.events', supported: 'native', description: 'system/init（含 capabilities）/api_retry/assistant/result 事件族', source: `${DOC}/headless` },
    ],
    gateway: [
      { id: 'gateway.gateway', supported: 'native', description: 'channels 插件机制（research preview，外部事件推入本地会话可双向）+ SendMessage 跨会话', source: `${DOC}/channels` },
      { id: 'gateway.telegram', supported: 'native', description: '官方 telegram 插件（需 Bun + claude.ai 账户 + 配对码）', source: `${DOC}/channels` },
      { id: 'gateway.discord', supported: 'native', description: 'channels 预览支持 Discord', source: `${DOC}/channels` },
      { id: 'gateway.slack', supported: 'unsupported', description: 'channels 预览不含 Slack', source: `${DOC}/channels（官方明确的清单）` },
      { id: 'gateway.whatsapp', supported: 'unsupported', description: '无 WhatsApp 渠道', source: `${DOC}/channels（无对应项）` },
    ],
    task: [
      { id: 'task.create', supported: 'native', description: '后台 bash（提示词要求/Ctrl+B）+ TaskCreate 待办工具', source: `${DOC}/interactive-mode` },
      { id: 'task.list', supported: 'native', description: '/tasks（shell+子代理）+ TaskList', source: `${DOC}/interactive-mode` },
      { id: 'task.status', supported: 'native', description: '/tasks 状态查看 + 输出文件可 Read', source: `${DOC}/interactive-mode` },
      { id: 'task.cancel', supported: 'native', description: '/tasks 停止运行中的 shell 与子代理', source: `${DOC}/interactive-mode` },
      { id: 'task.pause', supported: 'unsupported', description: '无暂停语义（只能停止）', source: `${DOC}/interactive-mode（无对应项）` },
      { id: 'task.resume', supported: 'native', description: '后台任务输出落盘可回看 + CLAUDE_CODE_RESUME_INTERRUPTED_TURN', source: `${DOC}/headless` },
      { id: 'task.queue', supported: 'adapter', description: '聚合器队列状态机', source: '聚合器 listQueue' },
      { id: 'task.events', supported: 'native', description: 'hooks 事件族（Notification/Stop/SessionStart 等约 30 种）', source: `${DOC}/hooks` },
    ],
    transfer: [
      { id: 'transfer.receive', supported: 'native', description: 'claude -p（stdin/参数）+ mcp serve（作为被调用方）+ Agent SDK + channels 推送', source: `${DOC}/headless` },
      { id: 'transfer.send', supported: 'native', description: 'SendMessage 跨会话互传 + mcp serve 对外服务', source: `${DOC}/sub-agents` },
      { id: 'transfer.file', supported: 'adapter', description: '聚合器把附带文件放入工作目录', source: '聚合器 file:export（通道表）' },
      { id: 'transfer.conversation', supported: 'adapter', description: '上下文以转录注入 -p 提示（聚合器实现）', source: '聚合器 transferTask includeConversation' },
      { id: 'transfer.task', supported: 'native', description: '-p/--resume 接收任务载荷并取回 session_id/成本', source: `${DOC}/headless` },
      { id: 'transfer.queue', supported: 'adapter', description: '队列状态机在聚合器层', source: '聚合器 listQueue' },
      { id: 'transfer.recommendation', supported: 'adapter', description: '推荐由聚合器按能力矩阵生成', source: '聚合器 getRecommendation（13.20 能力感知）' },
    ],
    settings: [
      { id: 'settings.get', supported: 'native', description: 'settings 四层文件（user/project/local/managed）+ /config + /status', source: `${DOC}/settings` },
      { id: 'settings.set', supported: 'native', description: '/config 直写 settings.json / settings.local.json', source: `${DOC}/settings` },
      { id: 'settings.reset', supported: 'adapter', description: '聚合器按官方 Schema 默认值回写', source: '聚合器 resetSettings' },
      { id: 'settings.export', supported: 'adapter', description: '聚合器导出（剔除 Secret）', source: '聚合器 exportSettings' },
      { id: 'settings.import', supported: 'adapter', description: '聚合器导入校验', source: '聚合器 importSettings' },
      { id: 'settings.schema', supported: 'native', description: '官方 JSON Schema（json.schemastore.org/claude-code-settings.json）+ settings-reference 全键页', source: `${DOC}/settings-reference` },
      { id: 'settings.reload', supported: 'native', description: 'permissions/hooks/apiKeyHelper 等监听文件热加载；model 等启动时读一次', source: `${DOC}/settings` },
    ],
    update: [
      { id: 'update.check', supported: 'native', description: '自动后台更新（启动时+定期；通道 latest/stable）', source: `${DOC}/setup` },
      { id: 'update.download', supported: 'native', description: '同上（后台预取）', source: `${DOC}/setup` },
      { id: 'update.install', supported: 'native', description: '下次启动生效 + claude update 手动', source: `${DOC}/setup` },
      { id: 'update.rollback', supported: 'native', description: 'versions/ 目录默认保留当前+最新两个版本，符号链接可指回', source: `${DOC}/setup` },
    ],
  },
}

/** Claude Code 原生设置 Schema（TS 面）——键名以官方 settings-reference 为准 */
export const CLAUDE_CODE_SETTINGS_SCHEMA: AgentSettingsField[] = [
  { key: 'model', uiName: '主模型', type: 'string', description: '模型名或别名（opus/sonnet/haiku/fable/opusplan）', configFile: 'settings.json', secret: false, runtimeChange: false, requiresRestart: false, page: 'models', status: 'implemented', capability: 'model.switch', source: `${DOC}/model-config` },
  { key: 'fallbackModel', uiName: '回退模型链', type: 'list', description: '过载/不可用时按序回退（最多 3 个）', configFile: 'settings.json', secret: false, runtimeChange: false, requiresRestart: false, page: 'models', status: 'planned', capability: 'model.fallback', source: `${DOC}/model-config` },
  { key: 'alwaysThinkingEnabled', uiName: '扩展思考', type: 'boolean', description: '始终启用 thinking', configFile: 'settings.json', secret: false, runtimeChange: false, requiresRestart: false, page: 'models', status: 'planned', capability: 'model.reasoning', source: `${DOC}/settings-reference` },
  { key: 'permissions.defaultMode', uiName: '权限模式', type: 'enum', enumValues: ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'], description: '默认权限模式', configFile: 'settings.json', secret: false, runtimeChange: true, requiresRestart: false, page: 'security', status: 'planned', capability: 'security.permissions', source: `${DOC}/permissions` },
  { key: 'permissions.allow', uiName: '允许规则', type: 'list', description: 'Tool(specifier) 允许清单', configFile: 'settings.json', secret: false, runtimeChange: true, requiresRestart: false, page: 'security', status: 'planned', capability: 'security.approval', source: `${DOC}/permissions` },
  { key: 'permissions.deny', uiName: '拒绝规则', type: 'list', description: 'Tool(specifier) 拒绝清单（优先求值）', configFile: 'settings.json', secret: false, runtimeChange: true, requiresRestart: false, page: 'security', status: 'planned', capability: 'security.deny_rules', source: `${DOC}/permissions` },
  { key: 'sandbox.enabled', uiName: '沙箱', type: 'boolean', description: 'Bash 沙箱（仅 macOS/Linux；原生 Windows 不支持）', configFile: 'settings.json', secret: false, runtimeChange: false, requiresRestart: true, page: 'security', status: 'planned', capability: 'computer.terminal', source: `${DOC}/sandboxing` },
  { key: 'sandbox.network.allowedDomains', uiName: '网络域名白名单', type: 'list', description: '沙箱网络代理 allowlist', configFile: 'settings.json', secret: false, runtimeChange: false, requiresRestart: true, page: 'security', status: 'planned', capability: 'security.website_blocklist', source: `${DOC}/sandboxing` },
  { key: 'autoMemoryEnabled', uiName: '自动记忆', type: 'boolean', description: 'auto memory 开关', configFile: 'settings.json', secret: false, runtimeChange: false, requiresRestart: false, page: 'memory', status: 'planned', capability: 'memory.write', source: `${DOC}/settings-reference` },
  { key: 'autoMemoryDirectory', uiName: '记忆目录', type: 'string', description: 'auto memory 存储位置', configFile: 'settings.json', secret: false, runtimeChange: false, requiresRestart: true, page: 'memory', status: 'planned', capability: 'memory.delete', source: `${DOC}/settings-reference` },
  { key: 'enabledPlugins', uiName: '插件启停', type: 'object', description: '已启用插件（marketplace 安装）', configFile: 'settings.json', secret: false, runtimeChange: false, requiresRestart: false, page: 'plugins', status: 'planned', capability: 'skills.approval', source: `${DOC}/settings-reference` },
  { key: 'autoUpdatesChannel', uiName: '更新通道', type: 'enum', enumValues: ['latest', 'stable'], description: 'stable 滞后约一周并跳过重大回归版本', configFile: 'settings.json', secret: false, runtimeChange: false, requiresRestart: false, page: 'about', status: 'planned', capability: 'update.check', source: `${DOC}/setup` },
  { key: 'voiceEnabled', uiName: '语音听写', type: 'boolean', description: '/voice 开关（需 claude.ai 账户）', configFile: 'settings.json', secret: false, runtimeChange: false, requiresRestart: false, page: 'voice', status: 'planned', capability: 'voice.input', source: `${DOC}/settings-reference` },
  { key: 'channelsEnabled', uiName: '消息渠道', type: 'boolean', description: 'channels 机制开关（托管键）', configFile: 'settings.json', secret: false, runtimeChange: false, requiresRestart: true, page: 'gateway', status: 'planned', capability: 'gateway.gateway', source: `${DOC}/settings-reference` },
  { key: 'hooks', uiName: 'Hooks', type: 'object', description: 'PreToolUse 等事件钩子（可做脱敏/拦截）', configFile: 'settings.json', secret: false, runtimeChange: true, requiresRestart: false, page: 'advanced', status: 'planned', capability: 'security.secret_redaction', source: `${DOC}/hooks` },
  { key: 'env.ANTHROPIC_API_KEY', uiName: 'Anthropic API Key', type: 'string', description: '密钥经 env 键注入（值只进安全存储/环境变量，settings 不落明文）', configFile: 'auth-store', secret: true, runtimeChange: false, requiresRestart: true, page: 'keys', status: 'advanced/native-only', capability: 'model.providers', source: `${DOC}/settings-reference` },
  { key: 'env.ANTHROPIC_DEFAULT_HAIKU_MODEL', uiName: '后台小模型', type: 'string', description: 'haiku 别名解析与后台功能模型（ANTHROPIC_SMALL_FAST_MODEL 已弃用）', configFile: 'env', secret: false, runtimeChange: false, requiresRestart: true, page: 'models', status: 'planned', capability: 'auxiliary.custom', source: `${DOC}/model-config` },
]
