# PHASE-ALL-AGENTS-PLAN —— 四 Agent 全量 REAL 接线：代码入口 × 官方接口调查 × 实施计划

> 13.23 轮。基线 commit `af80382`。本文档 = 任务书第一原则交付物：
> 所有结论来自 **本仓库代码实读 + 本真机已装版本的实测探测**（不是凭记忆/猜测），
> 探测脚本与原始输出要点记录在各节。实现开始前无须重做调查。

## 〇、目标与红线（任务书原文摘要）

把 OpenClaw / Codex / Claude Code 三个 STUB 全部升级 REAL，Hermes REAL 链路**不回退**。
禁止：解析 Agent 私有会话存储冒充官方 API、伪造 session/stream/cancel、mock 冒充 REAL、
把不支持的伪造成功。每 Agent 会话真源 = Agent 自己的存储/服务（13.22 裁决不变），
聚合器只维护 `Launcher/Data/session-index.json` 索引。

---

## 一、现有代码地图（af80382 实读）

### 1.1 会话链路分层（Hermes 已 REAL，三个 STUB 共用同一骨架）

| 层 | 文件 | 说明 |
|---|---|---|
| 渲染层服务工厂 | `Launcher/App/renderer/src/services/agent-control.ts` | 检测 `window.launcher?.hermesSessionList` → hybrid，否则 stub；`useRealService()` 仍 false |
| stub（全量体验） | `Launcher/App/renderer/src/services/agent-control-stub.ts`（789 行） | 四 Agent 种子会话/流式/任务/设置，全部内存态；13.23 后继续承接「尚未真实化的能力」 |
| hybrid（真实覆盖） | `Launcher/App/renderer/src/services/agent-control-hybrid.ts`（376 行） | `HERMES='hermes'` 常量 + 每个 override 首行 `if (id !== HERMES) return inner.X(...)`；原生事件→OutputEntry 翻译层 `handleNativeEvent`（订阅与历史重放共用）；metas/transcripts/turns 三个 Map |
| 主进程桥 | `Launcher/App/main.js` L1410-1573 | `hermesAcpEnv()`（buildBundledProviderEnv→DPAPI 兜底，密钥值不落 UI）、`getHermesGateway()`（懒 spawn）、IPC `hermes:session:list/create/open/send/stop/delete` + `hermes:index:update/remove`、`pushHermesEvent` 广播、before-quit 收尾 |
| 官方协议网关 | `Launcher/App/hermes-acp-gateway.js`（449 行 CJS） | spawn hermes-acp.exe、JSONL 帧、session/update→AgentEvent 映射、toAgentError（protocol 先于 not-found） |
| 会话索引 | `Launcher/App/session-index.js`（144 行 CJS） | `sync/upsert/update/remove`、orphan 检测、titleSource='user' 保护、原子写 |
| preload | `Launcher/App/preload.js` | `hermesSessionList/Create/Open/Send/Stop/Delete`、`hermesIndexUpdate/Remove`、`onHermesSessionEvent` |
| 渲染层类型 | `Launcher/App/renderer/src/types/launcher.d.ts` | LauncherApi 上 8 个 hermes 方法 + 结果接口 |

### 1.2 接口契约（一次定死，13.22 不改）

- `AgentSessionAdapter` / `AgentSession`（双 ID：aggregatorId 可选，nativeSessionId=真源键）/ `AgentEvent`（message_start/text_delta/thinking/tool_start/tool_result/user_message/session_info/error/message_end）/ `AgentError`（8 码：offline/provider-auth/session-not-found/permission/timeout/busy/unsupported/protocol）→ `agent-control-types.ts` L324-340。
- `SessionMeta.nativeSessionId?` + `orphaned?` 已存在。
- UI 事件面：`OutputEntry{streaming}` upsert（同 id 原位增长=打字机），`use-workbench` 零改动目标。

### 1.3 测试基线

`tests/`（根，ESM，`"type":"module"`）：97/97。会话相关：
- `tests/hermes-session.test.js`（9）——mock ACP server（`tests/fixtures/mock-hermes-acp.cjs`）端到端；注意 spawn .cjs 必须 `process.execPath` 包裹（EFTYPE 坑）。
- `tests/hybrid-service.test.js`（8）——fakeBridge 双 ID 契约/历史重放/错误传播/非 hermes 回落 stub。

### 1.4 打包白名单（高频回归坑）

`Launcher/App/package.json` build.files 数组——**新增主进程模块必须登记**，否则静默不进 asar，运行时 require 崩。13.22 已补 `hermes-acp-gateway.js`/`session-index.js`。

### 1.5 Agent 启动链（与桥的关系）

- manifest `Build/Config/agents.json`：openclaw exePath=`openclaw.cmd`（无参）、codex=`codex.cmd`、claude=`claude.cmd --bare`、hermes=`hermes.exe`；launcher 脚本 `Build/Scripts/start-*.ps1` 设隔离 env。
- `launchAgent()`（main.js L540）：childEnv = process.env + bundled providers.json env + DPAPI secret env；`pm.startAgent` 托管。
- **13.23 裁决**：会话桥不依赖 startAgent/pm 生命周期，按 13.22 Hermes 先例**懒 spawn 自管**（OpenClaw 例外，见 §2.1 生命周期节）。provider env 组装直接复用 `buildBundledProviderEnv()`。

---

## 二、真机官方接口探测结论（2026-10-04 实测）

### 2.1 OpenClaw（2026.9.5，`agents/OpenClaw/App/node_modules/openclaw`）

**官方通道 = Gateway WebSocket RPC（唯一控制平面）**。官方文档随包分发：
`docs/gateway/protocol/*.md`（transport/handshake/auth/pairing/rpc-*），权威且自洽。

**生命周期**（官方 `docs/gateway/embedding.md` 的 Electron 宿主配方，实测通过）：
```
node openclaw.mjs gateway run --allow-unconfigured
env: OPENCLAW_STATE_DIR=<ROOT>/agents/OpenClaw/Data
     OPENCLAW_CONFIG_PATH=<ROOT>/agents/OpenClaw/Config/config.yaml
     OPENCLAW_DISABLE_BONJOUR=1  OPENCLAW_EXEC_SHELL_SNAPSHOT=0
     OPENCLAW_NO_RESPAWN=1       OPENCLAW_SKIP_CHANNELS=1
```
实测 15:35 启动 ~13s 就绪；`/health` HTTP 探活（现有 OpenClawAdapter probe 同款）。
⚠ Electron 坑（官方文档明确警告）：**必须用真 Node 而非 Electron 的 process.execPath** 作宿主（Runtime/Node），否则 shell snapshot 弹「Unable to find Electron app」；`OPENCLAW_EXEC_SHELL_SNAPSHOT=0` 必须设在 Gateway 子进程 env。退出码 78=EX_CONFIG（配置类失败，官方流程：doctor --fix 后重试一次）。重启语义： orderly 前广播 `shutdown` 事件（带 restartExpectedMs）→ close 1012；`OPENCLAW_NO_RESPAWN=1` 保证 PID 归宿主管。

**握手（实测通过）**：
1. 首帧必为 `connect`；先收 `connect.challenge` 事件 `{nonce, ts}`。
2. 设备身份 Ed25519：`deviceId = sha256(raw 公钥 32B).hex`，公钥传 raw base64url（SPKI DER 去掉 12 字节头）。
3. v3 签名载荷（官方 `dist/device-auth-*.mjs` 逐字段核实）：
   `v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily`（platform/deviceFamily 小写化；token 缺省为空串）
4. connect params：`minProtocol/maxProtocol:4`、`client:{id:'gateway-client',version,platform:'win32',mode:'backend'}`、`role:'operator'`、`scopes:['operator.read','operator.write']`、`device:{id,publicKey,signature(base64url),signedAt:challenge.ts,nonce}`。
5. **免共享 token 依据**（实测）：本机 config 无 gateway.auth 段 → Gateway 日志「auth token was missing. Generated a runtime token」；回环 + 设备签名走官方「Silent local pairing」（pairing.md L225：回环默认静默批准首次设备配对+scope 升级）。实测 connect 通过（收 1013=startup-sidecars 可重试，非 auth 错）。
   ⚠ 实测 connect 曾返回可重试 `UNAVAILABLE`(details.reason='startup-sidecars') 后 close 1013 'gateway starting'——**必须实现重试环**（官方 embedding.md：以 WS 信号为准，不 scrape 日志）。
6. 设备身份文件：`Launcher/Data/openclaw-device.json`（探测时已生成，字段 deviceId/publicKeyPem/privateKeyPem，桥直接复用此格式）。⚠ 这是 launcher 自己的设备密钥（自生成、本地存储、不显示），与「Agent API 密钥零接触」是两类东西，与 Hermes 的 DPAPI 链互不相干。

**帧形**（官方 transport.md）：req `{type:'req',id,method,params}` / res `{type:'res',id,ok,payload|error{code,message,details}}` / event `{type:'event',event,payload,seq?}`。超时/慢消费限值看 `hello-ok.policy.maxPayload`。

**会话/聊天 RPC**（探索代理从 dist TypeBox schema 逐字段提取，文件名见其报告）：
- `sessions.list{limit,offset,sortBy,archived,includeLastMessage,agentId,...}` → `{sessions:[SessionRow],count,...}`；行键 = **`key`**（sessionKey），`sessionId`=底层转录 id 可缺省；有用字段：`key,sessionId,label,autoLabel,displayName,derivedTitle,lastMessagePreview,agentId,updatedAt,createdAt,archived,pinned,status,lastRunError,hasActiveRun`。
- `sessions.create{key?,agentId?,displayName?,message?,idempotencyKey?}` → `{ok,key,sessionId?,runStarted?,runId?}`。
- `sessions.patch{key,label?,archived?,pinned?,model?,expectedSessionId?}` → **重命名=label**（patch 无 displayName 字段）；归档/恢复=archived:true/false。
- `sessions.delete{key,archivedOnly?}`（operator.write 调用者必须带 archivedOnly:true；否则要 operator.admin）。
- `chat.send{sessionKey,message,idempotencyKey(必填!),...}` → ack `{runId,status:'accepted'|'in_flight'|ok|timeout|error}`；**幂等键=客户端生成的 params 字段**（无 HTTP header）。
- `chat.history{sessionKey,limit,cursor?}` → `{messages:[{role,content|text,timestamp,__openclaw:{runId,id,...}}],deltaCursor?,sessionInfo}`（display-normalized，工具 XML 已剥离）。
- `chat.abort{sessionKey,runId?}` → `{ok,aborted,runIds}`；`sessions.abort{key,runId?,clearQueued?}`。
- `models.list{}` → `{models:[{id,name,provider,available,...}]}`（模型切换走 sessions.patch model）。
- 事件族（operator 可订阅）：**`chat`**（`{runId,sessionKey,seq,state:'delta'|'final'|'aborted'|'error'|'status',deltaText?,replace?,message?,errorMessage?,errorKind?,errorDetail?}`）、**`agent`**（`{runId,stream:'assistant'|'thinking'|'tool'|'plan'|'run_status'|'approval'|'lifecycle'|'error',seq,ts,data}`——thinking 增量与 tool start/result 在此）、`session.message`（转录行+session 快照）、`sessions.changed`、`shutdown`、`connect.challenge`、`tick`。
- `sessions.subscribe{...list 参数}` 一次拿「订阅+首拍」。

**无裸 HTTP 探测端口**（18789 同时是 WS + health HTTP）。

### 2.2 Codex（@openai/codex 0.156.1，`agents/Codex/App/node_modules/@openai/codex`）

**官方通道 = `codex app-server`（stdio NDJSON JSON-RPC）**。实测本子命令存在；
官方 JSON Schema 可本机生成（已存 `build/Config/codex-app-server-schema/`，101 个 client request +
全部 notification 定义）——**版本漂移防护：实现以该 schema 为准**（memory 里 0.15x vs main 方法名漂移风险由此根除）。

**spawn（实测通过）**：
```
node <ROOT>/agents/Codex/App/node_modules/@openai/codex/bin/codex.js app-server
env: CODEX_HOME=<ROOT>/agents/Codex  (+ launchAgent 同款 provider env)
cwd: <ROOT>/agents/Codex
```
⚠ 直接 spawn vendor `codex.exe`（323MB，真实存在于 `@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/`）在非 ASCII 路径下 ENOENT（Windows spawn 坑）；**经 bin/codex.js 包装器 spawn 则正常**（包装器自己解析 vendor 路径）。Electron 内 spawn node 需 `ELECTRON_RUN_AS_NODE=1`（既有环境陷阱）。

**协议（实测往返通过）**：
- `initialize{clientInfo:{name,title,version}}` → `{userAgent,codexHome,platformOs,...}`（实测 codexHome 正确指向隔离目录）。
- `thread/list{pageSize?}` → `{data:[{id,preview,sessionId,historyMode,...}]}`（实测返回真机历史「你好」等）。
- `thread/start{}` → 通知 `thread/started{thread{id,...}}` + res `{turn:null,...}`；**nativeSessionId = thread.id**。
- `turn/start{threadId,input:[{type:'text',text}]}` → 实测真实回合事件序列：
  `turn/started` → `item/started{item{type:'userMessage',content}}` → … → `turn/completed{turn{status}}`。
- **实测真机错误传播链**：无 OPENAI_API_KEY 时 `thread/status/changed{status:{type:'systemError'}}` → `error{error{message}}` → `turn/completed{turn{status:'failed',error}}`。桥必须把 `turn/completed.status='failed'` 映射为 AgentError（不假完成）。
- 流式 delta：`item/agentMessage/delta{threadId,turnId,itemIds,delta}`；reasoning：`item/reasoning/summaryTextDelta` + `item/reasoning/textDelta`；工具：`item/started{type:'commandExecution'|'fileChange'|'mcpToolCall'|'webSearch'}` + `item/commandExecution/outputDelta` 等 + `item/completed`。
- 会话管理（全部官方存在，超出任务书预期）：`thread/resume`、`thread/name/set`（**官方重命名**）、`thread/archive`/`thread/unarchive`、`thread/delete`、`thread/turns/list`、`thread/items/list`、`turn/interrupt{threadId,turnId?}`、`model/list`。
- Server→Client 请求（审批）：`item/commandExecution/requestApproval`、`applyPatchApproval`、`execCommandApproval` 等——**本轮映射为 deny 选项自动拒绝 + 显式事件**（同 Hermes ACP request_permission 处理先例），不做审批 UI。

**认证/模型**：`config.toml`（agnes provider, base_url=token.sensenova.cn/v1, wire_api=responses, model=sensenova-6.8-flash-lite）+ `auth.json`（**密钥零接触：不读不显示**）；launchAgent 链已有 `syncCodexModelConfig` 写 provider 块 + OPENAI_API_KEY env 注入，桥复用。

### 2.3 Claude Code（@anthropic-ai/claude-code 2.1.280 wrapper + claude.exe，`agents/ClaudeCode`）

**关键事实**：本机安装的是 **wrapper 包**（bin/claude.exe + cli-wrapper.cjs），SDK 的 `sdk.mjs`/
`@anthropic-ai/claude-agent-sdk` **未安装**。但官方 Agent SDK 的 `query()` 本身就是 spawn CLI
`--print --output-format stream-json` 的薄封装 → **走官方 CLI 流式模式 = 零新依赖下的等价官方通道**（遵守零新依赖铁律；文档会如实记录这一等价性）。

**CLI 能力面（--help 实测）**：
- 流式：`-p --output-format stream-json --include-partial-messages`；双向流式输入：`--input-format stream-json`（官方 streaming input mode，即 SDK 持久进程模式）+ `--replay-user-messages`。
- 会话：`--session-id <uuid>`（指定会话 id）、`--resume <session-id>`、`--fork-session`；init 消息带 `session_id`（官方取回 nativeSessionId 的途径）。
- **列表：无官方子命令**（`agents`/`attach`/`rm`/`stop` 均是 background-sessions 另一特性）。SDK `listSessions()` 在未安装的 agent-sdk 包里 → **listSessions=UNSUPPORTED**（任务书§四：不为补 UI 解析 `~/*.jsonl`；索引承载本桥创建/见过的会话 + `--resume` 官方探测孤儿：resume 失败=session-not-found→orphaned）。
- rename/archive/delete 原生会话：CLI 无官方途径 → **UNSUPPORTED**（索引侧 pinned/title 照常，标注为聚合器元数据）。
- 中断：SDK 协议 `control_request{subtype:'interrupt'}`（持久进程模式）；一次性进程模式则 kill 子进程=中断（官方 transcript 保留部分输出）。

**认证/模型**：env = `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`(agnes) + `ANTHROPIC_MODEL` + `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`（buildBundledProviderEnv('claudeCode') 现成）+ `CLAUDE_CONFIG_DIR=<ROOT>/agents/ClaudeCode`。

**待实现期实测确认项**（写代码时第一件事）：stream-json 消息形状（system/init、assistant、result）与 control_request interrupt 的线格式——用一次性 `-p` 回合抓取（真机小消息）。

### 2.4 能力对照总表（13.23 实现目标态）

| 能力 | Hermes(已有) | OpenClaw | Codex | Claude Code |
|---|---|---|---|---|
| 会话列表 | REAL (session/list) | REAL (sessions.list) | REAL (thread/list) | **UNSUPPORTED**（索引承载+resume 探测） |
| 新建 | REAL | REAL | REAL | REAL（新进程=新会话） |
| 发送+流式 | REAL | REAL (chat.send+chat/agent 事件) | REAL (turn/start+item/* delta) | REAL (stream-json) |
| thinking | REAL | REAL (agent stream:'thinking') | REAL (reasoning delta) | REAL (stream-json thinking 块) |
| 工具事件 | REAL | REAL (agent stream:'tool') | REAL (item/started/completed) | REAL (tool_use 块) |
| 停止 | REAL (session/cancel) | REAL (chat.abort) | REAL (turn/interrupt) | REAL (control interrupt/kill) |
| 历史重放 | REAL (session/load) | REAL (chat.history) | REAL (thread/resume+turns/list) | REAL (--resume 续接; 无整段重放→loadSession 返回空历史+标注) |
| 重命名 | REAL（索引） | REAL (sessions.patch label=原生) | REAL (thread/name/set=原生) | UNSUPPORTED（仅索引） |
| 归档 | REAL（索引） | REAL (sessions.patch archived=原生) | REAL (thread/archive=原生) | UNSUPPORTED（仅索引） |
| 删除 | REAL (CLI) | REAL (sessions.delete) | REAL (thread/delete) | UNSUPPORTED |
| 置顶 | 索引 | 索引 | 索引 | 索引 |

（「索引」= 聚合器 session-index 语义，13.22 既有；「=原生」表示 OpenClaw/Codex 官方原生支持，比 Hermes 更强。）

---

## 三、实施计划（Phase A → B → C → 收尾）

### 3.0 通用模式（复刻 Hermes 先例，不动已跑通链路）

每个 Agent 一组：
- 主进程模块 `Launcher/App/<agent>-bridge.js`（CJS，零新依赖，工厂函数 + spawnOverride 测试缝）。
- `main.js` 新增平行桥段：env 组装（复用 buildBundledProviderEnv / DPAPI 链，密钥值不出主进程）、懒 getGateway、IPC `<agent>:session:list/create/open/send/stop/delete` + `<agent>:index:update/remove`、统一事件广播 `agents:session:event` **载荷带 agentId**（hermes 老通道保留不动，新通道不占用旧名）；before-quit 收尾。
- preload 增方法 + `launcher.d.ts` 类型。
- 渲染层：`agent-control-hybrid.ts` 重构为按 agentId 的桥描述符表（`getChannels(agentId)`），`handleNativeEvent`/metaToSessionMeta 参数化 agentId；**每个 override 仍以「该 agent 无桥 → 回落 inner」开头**；hermes 行为逐字节不变（既有 8 个 hybrid 测试全绿为回归门槛）。

### 3.1 Phase A：OpenClaw（Launcher/App/openclaw-gateway.js）

1. 设备身份加载/生成（Launcher/Data/openclaw-device.json，既有格式）。
2. Gateway 宿主：真 Node（Runtime/Node/node.exe）+ embedding env；已在跑（health 200）则直连不重复 spawn；退出码 78 → doctor 修复一次重试；shutdown 事件/1012/1013 重连环（指数退避封顶）。
3. WS 客户端：challenge→v3 签名→connect（startup-sidecars 重试）；rpc 超时；`tick` 保活依赖原生 ping/pong（不额外造心跳）。
4. 会话方法：list（sessions.list→index.sync，nativeSessionId=row.key；sessionId 作补充字段）、create、open（chat.history→user_message/assistant 重放事件）、send（chat.send 必填 idempotencyKey=uuid）、stop（chat.abort）、rename（sessions.patch label）、archive（patch archived）、delete（sessions.delete {key,archived:true} 先归档段再删——**实现期实测**，不行则需 admin/降级标注）、pin（索引）。
5. 事件映射：chat state:delta→text_delta（replace 处理）、state:final/aborted/error→message_end/error；agent stream:'thinking'→thinking、stream:'tool' phase start/result→tool_start/tool_result；session.message→user_message（重放）+ sessions.changed→索引同步。
6. 真机验收：发一条真实消息（agent model: openai/gpt-6-astra——**若其 provider 无凭据，将如实报 provider-auth**，不伪造；该 Agent 的 provider 配置属用户数据，本轮只如实上报）。

### 3.2 Phase B：Codex（Launcher/App/codex-appserver.js）

1. spawn `node bin/codex.js app-server`（ELECTRON_RUN_AS_NODE=1；CODEX_HOME+provider env）。
2. initialize/initialized；request(id) 超时；notification 分发。
3. thread/list→index.sync（nativeSessionId=thread.id）；thread/start；turn/start 流式生成器；turn/interrupt；thread/resume（历史：thread/turns/list + items/list→重放事件）；thread/name/set；thread/archive(+unarchive)；thread/delete。
4. 审批请求（ServerRequest）自动 deny + 显式 tool_result/error 事件（记录官方请求名）。
5. 错误映射：turn/completed failed→按 error.message 模式归 8 码；systemError→protocol/provider-auth 判别。
6. 事件映射：item/agentMessage/delta→text_delta；reasoning deltas→thinking；item/started(completed) userMessage→user_message、commandExecution/fileChange/mcpToolCall/webSearch→tool_start/tool_result；turn/started→message_start；turn/completed→message_end。

### 3.3 Phase C：Claude Code（Launcher/App/claude-cli-bridge.js）

1. 每会话持久子进程：`claude.exe -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose`（env 见 §2.3；cwd=workspace）。首轮无 --resume（可选 --session-id 自生成 uuid），读 init 消息取 session_id→index.upsert。
2. 复用已开进程发后续 user 消息；进程退出→下次发送以 `--resume <session_id>` 重启（官方续接）。
3. 中断：先试 control_request interrupt（实现期抓真机线格式确认），失败兜底 kill。
4. listSessions：UNSUPPORTED→索引+resume 探测孤儿（切会话时 resume 校验，失败标记 orphaned，不伪造）。rename/archive/delete：仅索引。
5. 事件映射：stream-json assistant 块 text_delta→text_delta、thinking 块→thinking、tool_use→tool_start、tool_result→tool_result；result 消息→message_end；错误→error。

### 3.4 收尾（任务书§五-§十四）

- hybrid 泛化 + `use-workbench` 验证四 Agent 并发隔离（每 Agent 独立桥实例/订阅/turn 状态）。
- 测试：每 Agent 一个 mock 端到端文件（mock gateway WS server / mock app-server / mock claude 进程，全部 spawnOverride 注入）+ cross-agent 混合契约（六对两两组合：同时会话/事件隔离/取消隔离/错误隔离/索引隔离）+ Hermes 97 个既有测试全绿。
- tsc 0 错误 → 打包 → **asar 白名单核查（三个新桥模块必须在内）** → packaged exe 真机 smoke + 重启恢复。
- 文档：更新 `docs/AGENT-SESSION-SOURCES.md`（以实测为准的修订）+ 新增 `docs/AGENT-REAL-CONNECTION.md`；最终报告 15 项清单（含每 Agent REAL/UNSUPPORTED 能力、真实 API 证据、commit SHA）。

---

## 四、风险与开放项（实现期裁决点）

1. **OpenClaw agent 凭据未知**：gateway 日志显示默认模型 openai/gpt-6-astra，其 provider 凭据存于 OpenClaw 自己的 state（不读）。若 chat.send 真实报 provider-auth → 如实上报 NOT TESTABLE WITHOUT CREDENTIALS（任务书§十一允许）。
2. **OpenClaw delete 权限**：operator.write 调用 delete 需 archivedOnly:true 或 admin——实现期实测降级路径（先 patch archived:true 再 delete{archivedOnly:true}）。
3. **Claude stream-json 线格式**：control_request interrupt / init 消息形状以真机抓包为准（官方文档只有 SDK 层描述）。
4. **Codex 线程列表分页**：thread/list pageSize 语义实现期确认。
5. **四 Agent 并发资源**：3 个常驻子进程 + WS；全部懒启动（首次用到该 Agent 会话才 spawn），before-quit 统一收尾。
6. **OpenClaw Gateway 与 pm 生命周期**：pm 的 openclaw.cmd 裸启动（TUI）与桥的 gateway run 是两回事——本轮桥自管 gateway 子进程（SKIP_CHANNELS=1 的控制面专用 Gateway），不与 pm 抢 PID；文档中说明。
7. ⚠ 打包：Electron main 无法 require asar 内 node_modules 里的 openclaw（embedding 要求真安装目录）——**桥 spawn 的是盘上真实路径（ROOT/agents/...），不受 asar 影响**；桥模块本身进 asar。
