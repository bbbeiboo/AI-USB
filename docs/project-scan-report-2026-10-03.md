# AI Agent U盘 — 项目进展扫描报告

> 扫描时间：2026-10-03
> 扫描根目录：`E:\桌面\AI Agent 母盘`
> 方式：目录结构扫描 + 文件实读 + 单元测试实跑 + Electron 端到端自检实跑
> 原则：只记录实测结果，不采信文档自述。

---

## 一、总体结论

**项目不是"从零的半成品"，而是"功能基本齐全、但存在一条未打通的进程管理链路"的状态。**

- 四个 Agent 的**本体已全部真实就位且可运行**，版本与清单（manifest）完全一致；
- 便携运行时（Node / Python / Git / Git-LFS）齐备，便携隔离环境脚本完整；
- 新 Launcher 的 UI、API 配置、用量统计、托盘等功能代码完成度高；
- **核心短板集中在"启动后的进程追踪与停止"**：停止脚本存在语法错误、3 个 Agent 的 PID 追踪失败、交互启动会产生双窗口、运行状态不持久化。这些是让产品"看起来半成品"的直接原因；
- 另有 1 个误建的垃圾目录、1 处明文 API Key、测试命令污染、交付缓存未清理等问题。

**母盘当前体量：13.29 GB，约 38.6 万个文件。**

---

## 二、实测资产清单

### 1. 四个 Agent 本体（端到端自检实测，全部 READY）

| Agent | 期望版本（manifest） | 自检实测版本 | 本体路径 | 结论 |
|---|---|---|---|---|
| OpenClaw | 2026.9.5 | OpenClaw 2026.9.5 (ec9c1a1) | `Agents/OpenClaw/App/node_modules/.bin/openclaw.cmd` | ✅ 可用 |
| Hermes | 0.21.4 | Hermes Agent v0.21.4 (2026.9.21) | `Agents/Hermes/bin/hermes.exe` | ✅ 可用 |
| Codex | 0.156.1 | codex-cli 0.156.1 | `Agents/Codex/App/node_modules/.bin/codex.cmd` | ✅ 可用 |
| Claude Code | 2.1.280 | 2.1.280 (Claude Code) | `Agents/ClaudeCode/App/node_modules/.bin/claude.cmd` | ✅ 可用 |

> 自检命令：`start-launcher.ps1 --selftest`，会真实调用各启动脚本取版本，非静态判断。

### 2. 便携运行时（`Runtime/`）

| 运行时 | 版本/形态 | 状态 |
|---|---|---|
| Node | node.exe（便携） | ✅ |
| Python | 3.12（python312.dll，3.12.8 安装源） | ✅ |
| Git | PortableGit 2.55（git-bash / git-cmd） | ✅ |
| Git-LFS | 3.7.1（git-lfs.exe） | ✅ |
| Tools | 空目录 | ⚪ 占位 |

### 3. 便携隔离体系（完成度高）

- `Build/Scripts/portable-env.ps1`：仅在**当前进程** PATH 前置自带运行时，不修改系统/用户 PATH、不写注册表；
- 自动清除 PYTHONPATH/PYTHONHOME/NODE_PATH 等宿主污染；
- 将 HOME、XDG_CONFIG/CACHE、npm 缓存与全局目录、pip 缓存与配置全部重定向到 `UserData/`；
- 各 Agent 启动脚本设置独立隔离变量：`OPENCLAW_STATE_DIR`、`HERMES_HOME`、`CODEX_HOME`、`CLAUDE_CONFIG_DIR`。

### 4. 新 Launcher 功能（`Launcher/App/`）

- Agent 聚合台：侧栏列表 + 详情页，启动 / 停止 / 重启 / 全部启动 / 全部停止；
- 托盘（Tray）生命周期：关窗入托盘、托盘菜单、退出确认；
- API 配置：Provider/BaseURL/Model 表单，密钥用 **Windows DPAPI 加密**存储，界面只回显掩码；
- 连接测试：单次 GET /models，10 秒超时，不自动重试，含中文错误归因；
- 用量统计：JSONL 记录、按 Agent/Provider/Model 汇总、价格表、成本重算；
- 本地用量代理（127.0.0.1，用户主动开启，含 SSRF 防护、SSE 支持）；
- CSV/JSON 导出、单实例锁、只读回退。

### 5. 测试与发布材料（实测）

- ✅ 项目自有单元测试 **36/36 通过**（`tests/` 下 7 个文件）；
- ✅ Electron 端到端自检 **4/4 READY**；
- ✅ 商业材料齐全：LICENSE / NOTICE / THIRD_PARTY / CHANGELOG / docs（安装、故障排查、发布清单）；
- ✅ 生产工厂脚本（`scripts/production-factory.mjs`）、客户模板（`Build/Release/CustomerTemplate`）；
- ✅ CI：`.github/workflows/build.yml`；
- ✅ 已打包产物：`Build/Release/Windows-x64/AI-Agent.exe`（约 100 MB，9-25 打包，与当前源码一致）。

---

## 三、问题清单（按严重程度排序）

### P0 — 直接影响核心功能

**1. 停止功能实际失效（脚本语法错误）**
- 位置：`Launcher/App/agent-process-manager.js` 的 `stopByToken()`，内嵌 PowerShell 第 1 行：
  `Get-CimInstance ... )` 末尾多了一个右括号 `)`，PowerShell 解析失败、无输出；
- 实测印证：日志中停止动作只留下空的 `[pm]` 行，没有 `stopped=N`；
- 后果：UI「停止 / 停止全部」按钮当前无法真正关闭 Agent。

**2. 三个 Agent 的 PID 追踪失败（rootPid 为空）**
- `findAgentRoot()` 用 manifest 的 `processToken` 去匹配进程命令行，但实际启动命令行是
  `powershell -NoExit -File ...start-xxx.ps1`，其中：
  - Hermes 令牌 `Hermes\bin\hermes.exe`、Codex 令牌 `...codex.cmd`、Claude 令牌 `claude.cmd`
    **均不出现在外层命令行中** → 匹配超时 → 日志记录 `rootPid=detached`（即 null）；
- 后果：这三个 Agent 启动后无法被准确追踪，状态与真实进程脱节。

**3. 交互启动产生"双窗口"**
- `start-hermes.ps1 / start-codex.ps1 / start-claude-code.ps1` 的交互分支用
  `Start-Process cmd /k ...` **再开一个内层窗口**，而外层 `powershell -NoExit` 空壳仍然残留；
- 真正运行 Agent 的是内层窗口，进程管理器追踪的却是外层壳，停止时必然错乱或残留窗口。

### P1 — 影响可靠性与安全

**4. 运行状态不持久化**
- 进程管理器状态仅存内存；Launcher 重开后记录为空，无法识别/接管此前已启动的 Agent
  （旧 `src/` 体系曾有 `data/state.json` 持久化，新体系在此点上为能力倒退）。

**5. 误建的垃圾目录：`Agents/ClaudeCode `（目录名末尾带一个空格）**
- 形成于 9-27，内部仅 `.claude.json` 与 1 个备份（共 2 个文件），近乎空目录；
- Windows 路径规范化会让常规访问静默跳转到正常的 `ClaudeCode` 目录，普通命令难以查看/删除；
- 需用 `\\?\` 扩展路径前缀处理（删除前建议你确认，报告不擅自删除）。

**6. API Key 明文存放**
- `config/providers.json` 中存在 **51 字符的明文 apiKey**（agnes，当前 enabled=true），会随 U 盘流转；
- `.gitignore` 未忽略该文件，存在被提交进版本库的风险；
- 它与 Launcher 的 DPAPI 加密方案是**两套并存的凭证体系**，建议统一。

### P2 — 工程规范与交付清洁度

**7. 测试命令被污染**
- `npm test` 为裸 `node --test`，会递归扫到 `Build/Release/CustomerTemplate` 内第三方
  `.test.ts` 等文件并报错；需限定为 `node --test tests/`（本次已用显式文件列表验证 36/36 通过）。

**8. 部分文件编码损坏**
- `config/app.json` 中名称"AI U盘"已损坏为乱码且结构可疑；
- 根 `electron-builder.yml` 中文注释全部乱码（配置结构本身可用）。

**9. 交付母盘可瘦身（当前 13.29 GB）**
- `UserData/npm-cache` 约 461 MB、`npm-global` 约 294 MB（构建缓存）；
- `Build/Downloads` 约 145 MB（运行时原始安装包）；
- `release/` 约 581 MB（9-20 旧架构产物）；
- `Build/Audit` 大量过程报告、`build/` 内中间产物。

**10. 占位目录未启用**
- `skills / plugins / mcp / memory / projects / backup / updates` 目前均为空。

### P3 — 发布范围

**11. 仅 Windows 平台**：macOS / Linux 未构建；产物未代码签名（SmartScreen / Gatekeeper 会提示）。

---

## 四、建议的下一步（建议按序）

1. **P0 修复停止链路**：删除 `stopByToken` 中多余的 `)`，并实跑验证能输出 `stopped=N`；
2. **P0 统一窗口模型**：让启动脚本的交互模式不再 `Start-Process` 二次开窗
   （由进程管理器直接 spawn 最终目标并持有真实 PID），消除双窗口；
3. **P1 修正追踪令牌**：用"启动脚本路径"或 spawn 返回的真实 PID 作为匹配依据，替代当前对不上的 processToken；
4. **P1 状态持久化**：恢复 state.json 写入与重开重扫，支持 Launcher 重开后接管已运行 Agent；
5. **P1 清理与安全**：用 `\\?\` 前缀处理 `ClaudeCode ` 垃圾目录；明文 Key 迁移到 DPAPI、
   将 `config/providers.json` 加入 `.gitignore`（或改为不含密钥的模板）；
6. **P2 工程收尾**：限定测试扫描范围、修复乱码文件、清理缓存与旧产物瘦身；
7. **P2 重新打包并做"干净 U 盘 + 陌生电脑"实机全流程验收**（启动→对话→停止→重开恢复）；
8. **P3**：代码签名、按需补 macOS/Linux。

---

## 五、附：两代架构并存说明

| 维度 | 旧架构（9-20，v1.0.0） | 新架构（9-23~25，当前主线） |
|---|---|---|
| 入口 | 根 `launcher.js` + `src/`（零依赖 ESM） | `Launcher/App/`（CommonJS Electron） |
| 清单 | `config/*.json` | `Build/Config/agents.json` |
| Agent 布局 | 检测系统已安装 Agent | `Agents/<名>/App` 内置便携本体 |
| 产物 | `release/ai-usb-1.0.0-*.exe`（约 106–111 MB） | `Build/Release/Windows-x64/AI-Agent.exe`（约 100 MB） |
| 状态 | 建议保留为参考/回滚基线 | 后续开发与交付应以新架构为准 |
