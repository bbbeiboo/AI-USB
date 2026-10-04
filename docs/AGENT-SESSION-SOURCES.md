# AGENT-SESSION-SOURCES —— 四 Agent 会话真源与官方访问通道（13.22 轮）

> 架构裁决（13.22 §一）：**Agent 原生会话数据 = Source of Truth**；聚合器只维护索引
> （`Launcher/Data/session-index.json`），不复制消息历史、不重新实现会话存储。
> 访问优先级（§六）：官方 API → SDK → IPC → CLI → 数据文件；只有前面不存在才允许后者。
> 调查日期：2026-10-04。依据：Hermes=本地官方源码（最可靠）；OpenClaw/Codex/Claude Code=官方文档+官方仓库。

| Agent | Session Source | Message Source | Official API | CLI | Read | Write | Stream | Delete |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Hermes** | **state.db（SQLite，$HERMES_HOME\state.db；TUI/ACP/gateway 共享，source 列分来源）** | 同库 messages 表 | ✅ **ACP stdio**（hermes-acp.exe，官方 SDK acp 0.9.0；session/list /new /load /prompt /cancel /fork /resume；**本轮已实测接线**）；另有 dashboard HTTP/WS（hermes serve，127.0.0.1:9119，token 认证） | ✅ 很全：sessions list/export/delete/archive/rename/pin、--resume | ✅ ACP session/list + session/load（历史经官方事件重放） | ✅ ACP session/new + prompt | ✅ ACP session/update 流（agent_message_chunk/thought/tool_call/plan/session_info_update） | ✅ 官方 CLI `hermes sessions delete`（本轮删除走此通道） |
| **OpenClaw** | **per-agent SQLite**：~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite（归档 transcript 在 agents/<id>/sessions/） | 同库 + transcript | ✅ **Gateway WS RPC**（18789 loopback，官方 SDK @openclaw/gateway-client；sessions.list/create/delete/patch/subscribe、chat.send/abort/history；官方明示 text_delta 实为 chat 流 deltaText 帧） | ✅ sessions list/archive/delete/tail、openclaw agent --session-key、gateway call <method> | ✅ sessions.list/describe/preview/get | ✅ sessions.create + chat.send | ✅ chat/agent/narration 三投影（三选一，防重复消费） | ✅ sessions.delete |
| **Codex** | **rollout 文件**：$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl（路径高置信；格式官方未承诺稳定；新版有 SQLite 元数据索引） | 同 rollout | ✅ **app-server**（`codex app-server`，stdio JSONL JSON-RPC；官方明示「power rich clients」= VS Code 扩展同款通道；thread/list/start/resume/delete/metadata/update、turn/start/steer/interrupt；⚠ 方法名在 0.15x↔main 间有版本偏移，接线前须对锁定版实测抓包） | 部分：resume picker / exec resume / `codex delete`（0.134+）；**无程序化 list CLI** | ✅ app-server thread/list + thread/read | ✅ thread/start + turn/start | ✅ item/started/updated/completed 通知（agentMessage delta） | ✅ thread/delete |
| **Claude Code** | **~/.claude/projects/<project>/<session-uuid>.jsonl**（明文 transcript，官方说明默认保留 30 天） | 同 jsonl（格式未文档化，但 SDK getSessionMessages 官方支持读取） | ✅ **Agent SDK**（@anthropic-ai/claude-agent-sdk，streaming input mode：query() 多轮长驻、resume/sessionId、includePartialMessages 流式、interrupt()；**v 近期新增官方 listSessions/getSessionMessages/getSessionInfo/renameSession/tagSession**） | 部分：--resume <id|name|路径>、-n 命名、/rename /export；**无 list CLI、无删除命令** | ✅ SDK listSessions/getSessionMessages | ✅ query/resume 多轮发送 | ✅ stream_event text_delta（token 级） | ✖ **删除无官方接口**（仅 30 天自动清理；SDK deleteSession 仅 /core 提及未公开文档化） |

## 逐 Agent 关键事实与缺口

### Hermes（本轮真实接线 ✅）
- **真源**：`agents/Hermes/state.db`（聚合器不直接读——一切经 ACP/CLI）。
- **ACP 事件**（acp_adapter/events.py、tools.py）：agent_message_chunk / agent_thought_chunk / tool_call(+update) / plan / session_info_update（自动标题）/ usage_update；session/load 重放历史（user_message_chunk + 全部上述事件）。
- **两个已知官方边界（如实记录）**：
  1. `session/load` 与 `session/list` 仅覆盖 **source='acp'** 的会话（acp_adapter/session.py:428、list_sessions_rich(source="acp")）——TUI/CLI 建的会话（时间戳形 ID）不在 ACP 面；聚合器索引因此只管 ACP 自建会话（uuid4），TUI 会话主权归 TUI。
  2. `session/cancel` 后被中断的 prompt 文本存入 `interrupted_prompt_text`，下一条普通 prompt 会自动拼上（server.py:701-723）——UI 层应提示用户「停止后建议换个说法或新建会话」。
- **HERMES_HOME 内容分类（任务书 §七）**：配置=config.yaml(.bak)；认证=.env(禁读)/auth.lock/pairing/；**会话+消息真源=state.db(+wal/shm)**；运行时=runtime/active_sessions.json（活跃租约，非持久会话）；记忆=memories/；缓存=cache/、audio_cache/、image_cache/、*_cache.json；日志=logs/；程序=bin/ + hermes-agent/；sessions/ 目录为空（历史遗留，非存储）。
- **密钥**：ACP 进程经 `HERMES_LAUNCHER_API_KEY` 环境变量解析（config model.key_env 引用）；Launcher 既有 DPAPI/providers.json 注入链复用，密钥零接触不变。

### OpenClaw（下一轮接线目标）
- **官方通道**：Gateway WS RPC（`@openclaw/gateway-client` + `@openclaw/gateway-protocol`，Node ≥22.19，wire v4，Ed25519 设备握手，可能触发设备配对）。
- **缺口**：重命名无专用 RPC（仅 sessions.patch 元数据 + groups.rename）→ 聚合器索引 displayName 补位；文本流三投影必须三选一；A2A/webhooks 不适合做会话管理面。
- **能力矩阵勘误**（13.20）：官方文档无字面 `text_delta` 事件名——chat 流的 `deltaText` 帧即 token 级文本。

### Codex（第三轮）
- **官方通道**：app-server（官方明示的富客户端集成接口）。**纠偏：`codex mcp-server` 已被官方移除**（developers.openai.com/codex/mcp-server）——13.20 矩阵中「mcp-server 转交入口」作废，改 app-server/exec。
- **缺口**：rollout 格式无稳定性承诺；SDK/exec 无 list/归档/删除，exec 无优雅中断（只能杀进程）；app-server 无版本冻结（0.156.1 需实测方法名：thread/new vs thread/start）。
- **本机注意**：CODEX_HOME=agents/Codex；openai 骨干 key 经 env_key 注入（零接触不变）。

### Claude Code（第四轮）
- **官方通道**：Agent SDK streaming input mode（官方文档化最完整；listSessions 为新增官方 API——比早前认知好）。
- **缺口**：删除无官方接口（30 天自动清理是唯一官方途径）→ 聚合器 deleteSession 对 claude-code 应标 unsupported 或仅做索引移除+文档说明；裸 CLI stream-json 控制协议（control_request）官方未文档化，优先走 SDK。
- **本机注意**：claude 为机器级全局安装（不在便携树）；会话目录按项目路径有损编码，勿反解，用 SDK API。

## 聚合器索引职责（实现于 Launcher/App/session-index.js）
- 保存：agentId / nativeSessionId / title(+titleSource) / pinned / archived / orphaned / lastMessagePreview / lastSeen / sortOrder。
- 不保存：消息历史、Agent 上下文、Memory、工具状态。
- 同步方向：Native →（官方接口）→ Index；原生消失 → orphaned 标记（不伪造、不自动重建）。
