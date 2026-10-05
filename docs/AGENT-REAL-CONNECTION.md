# AGENT-REAL-CONNECTION —— 四 Agent 真实会话层接线实录（13.23 轮）

> 13.23 完成四 Agent 全量 REAL：Hermes（13.22 既有，不回退）+ OpenClaw + Codex + Claude Code。
> 本文记录每 Agent 的**实际使用的官方通道、认证方式、线格式要点、能力裁决、真机验收证据**。
> 基线 commit `af80382`；本轮调查结论见 `docs/PHASE-ALL-AGENTS-PLAN.md`。
> 与 `AGENT-SESSION-SOURCES.md`（13.22 文档调研版）冲突处，**以本文实测为准**。

## 一、统一架构

- **真源裁决不变**：各 Agent 原生会话 = Source of Truth；聚合器只维护 `Launcher/Data/session-index.json`
  （agentId / nativeSessionId / title(titleSource) / pinned / archived / orphaned / lastMessagePreview / lastSeen / sortOrder）。
- **主进程桥**（CJS，零新依赖，spawnOverride 等测试注入缝）：
  `hermes-acp-gateway.js`（13.22）/ `openclaw-gateway.js` / `codex-appserver.js` / `claude-cli-bridge.js`。
- **统一通道**：hermes 保留老通道 `hermes:*`（逐字节不动）；openclaw/codex/claude-code 走
  `agents:session:list/create/open/send/stop/delete/rename/archive` + `agents:index:update/remove`，
  事件统一广播 `agents:session:event`（载荷带 agentId）。
- **渲染层**：`agent-control-hybrid.ts` 按 agentId 通道描述表分发；状态按 `(agentId, nativeSessionId)` 复合键隔离；
  无桥/未接线能力回落 stub，绝不伪造。
- **AgentEvent 契约增补（additive）**：`text_replace`（OpenClaw chat delta 帧固定 replace:true、
  deltaText=累计全量）、`thinking_replace`（reasoning 前缀断裂整段替换）。Hermes 不产生这两类。

## 二、各 Agent 实接线规格（实测为准）

### OpenClaw（openclaw-gateway.js）
- **通道**：Gateway WebSocket `ws://127.0.0.1:18789`（唯一控制平面；官方 embedding.md「Use RPC instead of state files」）。
- **宿主**：`Runtime/Node/node.exe openclaw.mjs gateway run --allow-unconfigured`（真 Node，非 Electron execPath）+
  embedding env 四件套（DISABLE_BONJOUR / EXEC_SHELL_SNAPSHOT=0 / NO_RESPAWN / SKIP_CHANNELS）+ OPENCLAW_STATE_DIR/CONFIG_PATH。
  已在跑（/health 200）则直连不重复 spawn；exit 78=EX_CONFIG → 官方 doctor --fix 后重试一次。
- **认证（三层，缺一不可，全部官方）**：
  1. **本地 IPC token**：launcher 生成随机 token 存 `Launcher/Data/openclaw-gateway-token.json`，
     经 `OPENCLAW_GATEWAY_TOKEN` env 注入 Gateway 子进程，connect `auth.token` 携带同值
     （服务端签名 token 解析顺序 `auth.token ?? auth.deviceToken ?? bootstrapToken`）。
  2. **设备身份**：Ed25519 密钥存 `Launcher/Data/openclaw-device.json`（launcher 自有密钥，非 Agent API 密钥）；
     deviceId = sha256(raw 公钥 32B).hex；公钥传 raw base64url（SPKI DER 去 12B 头）。
  3. **v3 签名**：`v3|deviceId|clientId|clientMode|role|scopes(逗号连接)|signedAtMs|token|nonce|platform|deviceFamily`，
     base64url；`signedAt = connect.challenge.ts`。
  - ⚠ 两个真机踩坑（已在桥内固化）：请求帧 `id` **必须是非空字符串**（数字 id → close 1008 invalid request frame）；
    connect `client.deviceFamily` **必须与签名一致**（漏传 → device signature invalid）。
- **RPC**：sessions.list（行键=`key` 即 nativeSessionId）、sessions.create（idempotencyKey 客户端生成）、
  chat.send（sessionKey+message+**必填 idempotencyKey**）、chat.history（历史重放，display-normalized）、
  chat.abort、sessions.patch（**label=重命名；archived=归档**）、sessions.delete（operator.write 必须 archivedOnly:true；
  权限不足降级：先 patch archived:true 再删）。
- **事件**：`chat`（state delta=**累积替换** replace:true / final / aborted / error）承担文本与回合终态；
  `agent`（stream thinking{text,delta} / tool{phase,name,args,result}）承担思考与工具——两族不可重复消费（assistant 文本只走 chat 族）。

### Codex（codex-appserver.js）
- **通道**：`node bin/codex.js app-server`（stdio NDJSON；**必须经官方 bin 包装器**——直接 spawn vendor
  codex.exe 在非 ASCII 路径 ENOENT；Electron 内 ELECTRON_RUN_AS_NODE=1）。
- **信封**（以 `build/Config/codex-app-server-schema/` 生成物为准，0.156.1）：请求 `{id,method,params}`、
  通知 `{method,params}`、响应 `{id,result}|{id,error}`（无 jsonrpc 字段）。
- **方法**：initialize{clientInfo} → initialized（通知）→ thread/list（nativeSessionId=thread.id）/ thread/start
  （thread/started 通知携带 id）/ turn/start{threadId,input:[{type:'text',text}]} / turn/interrupt{threadId,turnId 必填，
  turnId 取自 turn/started} / thread/resume + thread/items/list（历史重放，**不读 rollout JSONL**）/
  thread/name/set（官方重命名）/ thread/archive|unarchive / thread/delete。
- **事件**：item/agentMessage/delta → text_delta；item/reasoning/*TextDelta → thinking；
  item/started|completed（commandExecution/fileChange/mcpToolCall/webSearch）→ tool_start/tool_result；
  turn/completed{turn.status}（completed|interrupted|failed）→ message_end（failed 额外 error 事件，按
  error.message 归 8 码）；Server→Client 审批请求一律 `{decision:'denied'}` 真实拒绝 + 显式 tool_result 事件。

### Claude Code（claude-cli-bridge.js）
- **通道**：官方 CLI 流式模式（= 官方 Agent SDK query() 的等价零依赖形态；本机为 wrapper 包 2.1.280，
  SDK 包未安装）：`claude.exe -p --input-format stream-json --output-format stream-json
  --include-partial-messages --verbose [--session-id <uuid> 首启 | --resume <id> 续接]`。
  spawn 真身 `@anthropic-ai/claude-code-win32-x64/claude.exe`（安装器已把 wrapper bin/claude.exe 改名 .old）；
  ENOENT 回退官方 `cli-wrapper.cjs`（node 宿主）。
- **流程**（真机实测校准）：spawn 后**立即写首条用户消息**（init 消息随首条请求之后回流，不能等 init 再写）；
  init `session_id` = 原生会话真源 → 索引登记；stream_event text_delta/thinking_delta → 对应事件；
  content_block_start tool_use / user tool_result → tool 事件；result（is_error）→ message_end（+error 事件）。
- **中断**：`control_request{subtype:'interrupt'}`（control_response 应答）；超时无应答 kill 子进程兜底（真实取消）。
- **孤儿探测**：--resume 失败（CLI 启动即退）= session-not-found → 索引标记 orphaned，不伪造。
- **能力裁决（UNSUPPORTED，不伪造）**：listSessions 无官方 CLI/SDK 途径 → **索引承载**（agents:session:list
  返回 nativeSync:false）；rename/archive/delete 原生无途径 → rename/archive=索引语义（与 Hermes 同级）、
  **delete 明确 UNSUPPORTED**；loadSession 无整段重放官方途径 → 空历史 + historyNote 标注。

## 三、能力矩阵（实测实现态）

| 能力 | Hermes | OpenClaw | Codex | Claude Code |
|---|---|---|---|---|
| 列表 | REAL（ACP session/list） | REAL（sessions.list） | REAL（thread/list） | UNSUPPORTED→索引（nativeSync:false） |
| 新建 | REAL | REAL | REAL | REAL（--session-id uuid，进程懒启动） |
| 发送+流式 | REAL | REAL（chat.send+chat/agent 事件） | REAL（turn/start+item/*） | REAL（stream-json，实测 19 事件/回合） |
| thinking | REAL | REAL（agent thinking 流） | REAL（reasoning delta） | REAL（thinking_delta） |
| 工具 | REAL | REAL（agent tool 流） | REAL（item started/completed） | REAL（tool_use/tool_result） |
| 停止 | REAL | REAL（chat.abort） | REAL（turn/interrupt） | REAL（control interrupt→kill 兜底） |
| 历史重放 | REAL（session/load 重放） | REAL（chat.history） | REAL（thread/resume+items/list） | 空历史+标注（官方无整段重放） |
| 重命名 | 索引 | **原生**（sessions.patch label） | **原生**（thread/name/set） | 索引 |
| 归档 | 索引 | **原生**（sessions.patch archived） | **原生**（thread/archive） | 索引 |
| 删除 | 原生（CLI） | **原生**（sessions.delete，archivedOnly 降级） | **原生**（thread/delete） | **UNSUPPORTED** |
| 置顶 | 索引 | 索引 | 索引 | 索引 |

## 四、真机验收证据（2026-10-05，`Launcher/App/real-machine-probe.cjs`）

- **Claude Code：REAL ✅**。真实回合 19 个事件，assistant 文本「OK」，init 回读 session_id 与 --session-id 一致
  （env：ANTHROPIC_API_KEY/BASE_URL/MODEL，经既有 buildBundledProviderEnv 注入，密钥零接触）。
- **Codex：桥链路 REAL ✅；端到端模型回复 = provider 兼容性阻塞**。thread/list（12 条真实历史线程）、
  thread/start（真实 threadId）、turn/start 真实打到 agnes 端点并返回**真实 400**：
  `tools[4].type: unknown variant 'namespace'`（sensenova/agnes 端点不支持 codex 0.156 工具 schema）。
  桥把真实错误端到端透传（error 事件 + turn failed → provider-auth/protocol）。换支持该 schema 的 provider 即通。
- **OpenClaw：Gateway 控制面 REAL ✅；模型回复 = NOT TESTABLE WITHOUT CREDENTIALS**。token 认证→v3 设备签名→
  hello-ok→sessions.list→sessions.create 真实创建（key=`agent:main:dashboard:<uuid>`）→chat.send 真实发出→
  网关返回真实 provider 错误 `No route-compatible authentication source is configured for openai.`
  （默认模型 openai/gpt-6-astra 的凭据属用户数据，本轮不读不配），桥正确映射 provider-auth。

## 五、测试与打包

- **119/119**（老 97 全绿=Hermes 零回退门槛 + 新 22：三桥 mock e2e 10 + 六对交叉契约 12）；
  tsc 0 错误；`npm run build` 成功；**asar 白名单核查**：openclaw-gateway.js / codex-appserver.js /
  claude-cli-bridge.js 全部进包（连同 hermes-acp-gateway.js / session-index.js）。
- 六对交叉契约覆盖：同时会话 / 事件隔离（onOutput 载荷带 agentId）/ 取消隔离 / 错误隔离 / 索引隔离 /
  UNSUPPORTED 裁决 / 双 ID 契约（SessionMeta.id === nativeSessionId）。
