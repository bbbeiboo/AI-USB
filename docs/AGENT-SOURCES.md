# AGENT-SOURCES —— 四 Agent 真实来源基线（13.20 轮）

> 任务书 §二：开始任何代码修改前先确定四个 Agent 的真实来源。本表为项目锁定事实，
> 版本以**本项目实际安装**为准；官方最新版本能力差异在 AGENT-CAPABILITY-MATRIX.md 单独记录。
> 生成日期：2026-10-03。

| Agent | 官方仓库 | 官方文档 | 项目版本 | 最新版本 | 本地入口 | 配置入口 |
| --- | --- | --- | --- | --- | --- | --- |
| OpenClaw | github.com/openclaw/openclaw | docs.openclaw.ai | **2026.9.5**（npm 包 openclaw，`agents/OpenClaw/App/node_modules/openclaw/package.json`） | 2026.9.8（2026-10-03 发布，联网核实） | `openclaw` 命令（config.agents.openclaw.command） | `agents/OpenClaw/Config/config.yaml`（⚠ 官方格式为 JSON5 `~/.openclaw/openclaw.json`，便携树经 OPENCLAW_CONFIG_PATH 指向本目录；config.example.yaml 参照） |
| Hermes | github.com/NousResearch/hermes-agent（本地源码包 git remote 确认） | 仓库 README / docs | **0.21.4**（2026.9.21，upstream c0d72947；`hermes.exe --version` 实测；安装方式 git） | 源码包提示「7900 commits behind」，落后上游较多 | `agents/Hermes/bin/hermes.exe`（经 `Build/Scripts/start-hermes.ps1` 打开控制台窗口，`HERMES_HOME` 隔离） | `agents/Hermes/config.yaml`（2130 行；密钥文件 auth.json/auth.lock/.env **零接触**） |
| Codex | github.com/openai/codex | developers.openai.com/codex（config-reference / cli-reference / config-schema.json） | **0.156.1**（npm 包 @openai/codex，`agents/Codex/App/package.json`） | 0.160.0（npm registry，2026-10-03 核实） | `codex` 命令（config.agents.codex.command） | `agents/Codex/config.toml`（当前：model=sensenova-6.8-flash-lite，provider=agnes + [tui]/[projects]/[windows]；官方 JSON Schema 见 config-schema.json） |
| Claude Code | github.com/anthropics/claude-code | code.claude.com/docs（settings-reference / model-config 等） | **2.1.288**（`claude --version` 实测） | npm latest 2.1.289 / 原生 stable 2.1.285（2026-10-03 核实） | `claude` 命令（config.agents['claude-code'].command；⚠ 机器级全局安装 `D:\DeepSeek Harness\npm-global\claude`，**不在便携树内**——换机部署的已知缺口，见下） | `agents/ClaudeCode/settings.json`（当前仅 `{"theme":"auto"}`；用户级另有 ~/.claude 不属于本盘） |

## 逐 Agent 说明

### OpenClaw（npm 发行版）
- 本地目录结构：`agents/OpenClaw/{App,Cache,Config,Data,Logs,Runtime}`；App 内为 node_modules 安装（openclaw 2026.9.5）。
- 启动方式：launcher 经 src/core/adapters/openclaw.js 走 `openclaw` 命令；配置块 `config.agents.openclaw`（enabled/command/args/cwd/health）。
- 配置文件 `Config/config.yaml` 存在且与 `config.example.yaml` 并存（官方示例随包分发）。

### Hermes（git 安装版）
- 官方源码完整在 `agents/Hermes/hermes-agent/`（pyproject.toml name=hermes-agent version=0.21.4；git remote = git@github.com:NousResearch/hermes-agent.git）。
- 自带 bin：hermes.exe / browser.exe / hermes-acp.exe / uv.exe 等；OpenAI SDK 2.24.0，Python 3.11.16。
- 版本差距：上游已大幅前进（本地提示 7900 commits behind）；**能力矩阵以锁定版 0.21.4 的本地官方源码为基线**，官方最新能力只做差异记录，不作为基线（任务书 §二.3）。
- 配置面：`config.yaml`（顶层键 database/runtime/model/kanban/cron/terminal/browser/tool_loop_guardrails/compression/prompt_caching/memory/streaming/skills/agent/gateway/platform_toolsets/stt/code_execution/delegation/display/telemetry/auth/updates/onboarding 等，全量映射见 HERMES-SETTINGS-MATRIX.md）。

### Codex（npm 发行版 @openai/codex）
- 本地目录：`agents/Codex/{App,Cache,Config,Data,Logs,Runtime}` + config.toml、history.jsonl、goals/logs/memories/queue 等多个 sqlite（运行时产物）。
- 注意：`agents/Codex/auth.json` 存在但**密钥零接触，永不读取**。
- config.toml 使用自定义 model_provider（agnes）指向第三方聚合端点——说明 model_providers 机制在用。

### Claude Code（机器级安装）
- 本体不在 U 盘便携树内：`D:\DeepSeek Harness\npm-global\claude`（2.1.288）。`agents/ClaudeCode/` 只存 settings/history/sessions/plugins 等数据。
- **可移植性缺口（如实记录，不在本轮修复）**：换机后 `claude` 命令可能不存在；接线轮需决定「随盘分发 or 首次启动引导安装」。本轮矩阵仍按 2.1.288 能力基线。

## 基线裁决

1. **能力基线 = 项目锁定版本**：OpenClaw 2026.9.5 / Hermes 0.21.4 / Codex 0.156.1 / Claude Code 2.1.288。官方最新版本的新能力只记在矩阵「最新版差异」注记，不计入 supported 判定。
2. **依据优先级**：本地官方源码（Hermes 有源码包，最可靠）> 官方文档 > 官方仓库 README > 官方 issue/发布说明。第三方教程一律不作为能力依据（任务书 §二.5）。
3. **密钥零接触**：auth.json / auth.lock / .env / pairing/ / backups/ 永不读取；矩阵与设置映射中 Secret 项只记 key 名、类型与归属文件。
4. 版本号取证命令：`hermes.exe --version`、`claude --version`、node 读各 App node_modules package.json。
