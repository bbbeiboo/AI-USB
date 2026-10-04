# AGENT-CAPABILITY-MATRIX —— 四 Agent 能力矩阵（13.20 轮）

> 20 类别 × 4 Agent 全量判定。五态：`native`（官方原生）/ `adapter`（聚合器适配层提供）/
> `permission-required`（原生但需授权）/ `sandbox-only`（仅沙箱环境）/ `unsupported`（不支持，不伪造）。
> 判定依据逐条见 TS 数据文件（`Launcher/App/renderer/src/services/capabilities/*.ts`，每条带 source）；
> 本文档是汇总视图 + 版本差异注记。**能力基线 = 项目锁定版本**（AGENT-SOURCES.md）。
> TS 数据由单测钉死：133 条能力 id 四 Agent 同名同义（tests/agent-capability.test.js）。

| Agent | 锁定版本 | 官方最新 | 数据文件 | 依据来源 |
| --- | --- | --- | --- | --- |
| OpenClaw | 2026.9.5 | 2026.9.8 | capabilities/openclaw.ts | docs.openclaw.ai（CLI/概念/工具/网关各页） |
| Hermes | 0.21.4 | 上游大幅前进（7900+ commits） | capabilities/hermes.ts | **本地官方源码包** agents/Hermes/hermes-agent/（最可靠） |
| Codex | 0.156.1 | 0.160.0 | capabilities/codex.ts | developers.openai.com/codex（config-reference/cli-reference/sandboxing/subagents） |
| Claude Code | 2.1.288 | npm 2.1.289 / stable 2.1.285 | capabilities/claude-code.ts | code.claude.com/docs（settings/model-config/permissions/computer-use/channels…） |

## 汇总矩阵（√=native，A=adapter，P=permission-required，S=sandbox-only，✗=unsupported）

| 能力组 | OpenClaw | Hermes | Codex | Claude Code |
| --- | --- | --- | --- | --- |
| agent（info/health/update/restart/stop） | √ | √ | √（restart/stop 为 A） | √（restart/stop 为 A） |
| model（providers/switch/fallback/reasoning…） | √（fallback 链、/think） | √（fallback、reasoning、fast_mode） | √（无 fallback/fast_mode） | √（fallbackModel 链、thinking/effort） |
| auxiliary（按用途辅助模型） | √（utility/decision/image/pdf） | √（视觉/压缩/标题/评审/审批/MCP/技能全套） | 部分（review_model + memories 小模型） | 部分（DEFAULT_*_MODEL 别名 + subagent model） |
| conversation（list/create/rename/archive/export） | √（rename=A） | √（archive/restore=A） | 部分（list/create/open=√，其余 A/✗） | √（rename/export=√；**archive 官方明确无**） |
| generation（send/stream/stop/resume/retry） | √ | √ | √（stop=A） | √（stop 原生 Esc/SDK interrupt） |
| files | √（upload/download 需审批 P） | √（upload/download=A） | √（写受沙箱 P） | √（拖拽/图片粘贴原生） |
| computer（terminal/键鼠/屏幕/窗口） | **√ 真桌面控制**（Windows 为实验性 cua-computer） | √（CUA 后端，P） | terminal/进程 √；键鼠屏幕 ✗ | macOS：键鼠屏幕 P（research preview）；**Windows：✗** |
| browser | √（CDP/tabs/cookies） | √（CDP/camofox/真实 profile） | ✗（可经 MCP 外接=A） | A（Chrome 扩展 MCP，需 claude.ai 登录） |
| memory | √（写入=编辑 Markdown） | √（memory_provider 可外接） | √（AGENTS.md + memories 默认关） | √（CLAUDE.md + auto memory） |
| skills | √（Workshop 提案制+审批） | √（skills hub 多来源+AST 审计） | √（SKILL.md） | √（Agent Skills + marketplace） |
| mcp | √（双向：客户端+serve） | √（resources/prompts 有） | √（resources ✗） | √（resources/prompts 均有） |
| delegation | √（sessions_spawn/深度策略；worktree ✗） | √（delegate 族+MoA+worktree） | √（multi_agent 默认开，max_depth=1） | √（并发 20/深度 3/worktree 隔离/teams 实验） |
| security | √（exec 五模式+AI 审阅者+secret scanning；PII ✗） | √（审批族+redact+secret_scope） | √（granular+deny 规则；脱敏 ✗） | √（六模式+hooks 脱敏） |
| voice | √（TTS 多家+Talk；VAD ✗） | √（STT/TTS 注册表；VAD ✗） | ✗ 全部 | 听写 √（需 claude.ai 账户）；TTS ✗ |
| streaming | √（UI 真流 text_delta；渠道=块流） | √ | √（exec --json / app-server） | √（stream-json 双向+token 级） |
| gateway（IM 渠道） | **√ 全**（Telegram 内置；Discord/Slack/WhatsApp 官方插件） | √（四渠道） | ✗（CLI；云端产品除外） | 部分（Telegram/Discord 预览版；Slack/WhatsApp ✗） |
| task/queue/cron | √（cron 全套+hooks） | √（kanban/cron/daemon） | ✗（CLI；队列=A） | √（后台 bash+/tasks+待办工具） |
| **transfer（接收外部任务）** | **native**（webhooks/A2A/RPC 三官方入口） | A（聚合器落地；内建 delegate 仅子代理） | **native**（exec/mcp-server/app-server/SDK） | **native**（-p/mcp serve/SDK/channels） |
| settings | √（config RPC+**schema 命令**+**热加载**） | 文件态（get/set=A；schema=示例配置） | 文件态（**官方 JSON Schema**=√；热改 ✗） | √（四层 settings+**官方 JSON Schema**+部分热加载） |
| update | √（含 **verified rollback**） | √（hermes update；rollback ✗） | √（rollback=A 经 npm） | √（versions 目录指回=原生回滚） |

## 逐组要点与差异注记（与官方最新版的差异只记此处）

### 7. Computer Control（任务书特别强调：不得把「能跑 Terminal」等同「能控桌面」）
- **OpenClaw 是四者中唯一「真原生全桌面控制」**：`computer.act`+`screen.snapshot` 视觉动作循环（截图→点击/键入/滚动/拖拽），V2 窗口族（list_windows/get_accessibility_tree/set_value/invoke_menu）；且官方明确「动作族不含文件系统/终端」。**Windows 上为实验性 `cua-computer` 插件：仅主显示器、无按键保持/修饰键组合**（本机平台限制，接线轮必须按此降级预期）。
- **Hermes**：CUA 后端（cua_backend_input/capture + permissions.py）→ 键鼠屏幕窗口 = permission-required；terminal/file/process = 原生工具族。
- **Codex CLI**：沙箱只覆盖 shell/文件系统/网络；浏览器/GUI 全部是 **Codex App** 能力，CLI 记 ✗。
- **Claude Code**：内置 computer-use MCP 仅 macOS research preview（Pro/Max、逐应用批准、不支持 -p 模式）；**本机（Windows CLI）无桌面控制**。Windows 桌面控制仅 Claude Desktop 应用。

### 18. Transfer（本项目核心能力）
- 三家官方原生接收入口（OpenClaw webhooks/A2A、Codex exec/mcp-server、Claude Code -p/mcp serve）；**Hermes 无跨 Agent 接收语义 → adapter**（聚合器 transferTask 落地，已如实标注）。
- 全部四家：`transfer.queue` / `transfer.recommendation` = **adapter**（队列与推荐状态机在聚合器层，单测钉死）。
- 推荐卡与 TransferDialog 已按能力门控（canAcceptTransfer）：目标不支持某附带内容 → 拒绝并给原因；OpenClaw 的 `transfer.file=permission-required` 前端应显示「需目标端审批」而非禁用。

### 19. Configuration（设置映射的地基）
- 有**官方机器可读 Schema** 的：Codex（config-schema.json）、Claude Code（schemastore）、OpenClaw（`config schema` 命令）；Hermes 以 `cli-config.yaml.example` + 源码 DEFAULT_CONFIG 为 Schema 基准（全量映射见 HERMES-SETTINGS-MATRIX.md，451 条）。
- 支持**热加载**的：OpenClaw（Gateway 监听文件）、Claude Code（permissions/hooks 等键）；Hermes/Codex 多数键需重启/新会话 → 设置中心标「重启后生效」。

### Secret 分离（任务书 §十）
- 四家密钥形态已查清且**全部支持「配置文件只存引用、值进安全存储」**：Hermes（本机实测：Launcher 经 DPAPI 解密后以 `HERMES_LAUNCHER_API_KEY` 环境变量注入，config.yaml 只引用变量名）；Codex（model_providers.env_key）；Claude Code（env.ANTHROPIC_API_KEY/apiKeyHelper）；OpenClaw（secrets 命令族+凭据存储映射）。
- 聚合器侧 `CredentialService` 已建（stub 内存态；getCredential 只回 configured+掩码，单测断言明文永不出口）。

### 官方与任务书预设不一致处（以官方为准，如实记录）
1. Claude Code「Voice/Messaging 应 unsupported」不成立：有 /voice 听写与 channels（Telegram/Discord）——但均需 claude.ai 账户，API key 模式不可用。
2. Claude Code「键鼠屏幕应 unsupported」不成立：macOS 有内置 computer-use MCP（research preview）；Windows 才是 ✗。
3. OpenClaw 配置是 **JSON5 openclaw.json**，不是常见教程说的 yaml（本机文件名 config.yaml 系便携树自定路径）。
4. Codex `approval_policy` 的 `on-failure` 已弃用、`untrusted` 已退役；`wire_api` 仅支持 `responses`。
5. Hermes「图标」聚合器配置项在源码中不存在（HERMES-SETTINGS-MATRIX 已标注未定位）。

## 统计

- 能力总数：20 组 × 133 条（四 Agent 同名同义，由 tests/agent-capability.test.js 钉死）。
- 五态分布（条数×4 Agent=532 判定）：native ≈ 65%，adapter ≈ 15%，permission-required ≈ 6%，sandbox-only 1（claude-code website_blocklist），unsupported ≈ 13%——全部逐条带官方 source，无一条凭记忆判定。
