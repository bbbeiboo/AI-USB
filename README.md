# AI U盘

便携式多 Agent 工作台 —— 把 AI Agent、工作区、项目、Skills、Plugins、MCP、Memory、配置、启动、更新和维护能力整合到一个便携环境。

## 管理的 Agent

| ID | 名称 | 状态（本机） |
|---|---|---|
| openclaw | OpenClaw | 未安装 |
| hermes | Hermes | 已安装 |
| codex | Codex | 未安装 |
| claude-code | Claude Code | 未安装 |

## 快速开始

```bash
# 安装依赖（仅 UI 需要 Electron）
npm install

# 启动桌面 Launcher
npm start

# 或纯 CLI（无需 Electron）
node launcher.js            # 查看四 Agent 状态
node launcher.js --start hermes
node launcher.js --stop hermes
node launcher.js --doctor   # 环境诊断
node launcher.js --update-check   # 检查更新
node launcher.js --update [sha256] # 执行更新（可选 SHA256 校验值）
```

## 测试

```bash
npm test   # node --test，覆盖进程管理 / 生命周期 / 配置 / 状态 / 更新 / 打包态路径
```

## 打包

```bash
npm run dist:win    # Windows：NSIS 安装版 + portable 便携版
npm run dist:mac    # macOS：dmg + zip（需在 macOS 上构建）
npm run dist:linux  # Linux：AppImage + deb
```

产物输出到 `release/`。便携性说明：打包后数据目录（config/data/logs/workspace 等）自动落在
可执行文件所在目录（U盘上），而非系统临时目录或用户目录——`PORTABLE_ROOT` 按平台推导：
Windows 用 exe 所在目录（portable 版走 `PORTABLE_EXECUTABLE_DIR`）、macOS 从 `.app` 向上、
Linux AppImage 用 `$APPIMAGE`。

## 目录结构

```
├── launcher.js            # CLI 入口
├── src/
│   ├── core/              # 核心（零依赖）
│   │   ├── portable-root.js   # PORTABLE_ROOT 动态推导
│   │   ├── config.js          # 配置管理
│   │   ├── state.js           # 运行状态持久化
│   │   ├── process-manager.js # 进程生命周期引擎
│   │   ├── health-check.js    # 健康检查
│   │   ├── diagnostics.js     # 环境诊断
│   │   ├── agent-manager.js   # 统一编排
│   │   └── adapters/          # 四 Agent 适配器
│   ├── electron/          # Electron 主进程 + preload
│   └── ui/                # 渲染层（HTML/CSS/JS）
├── config/                # app/agents/providers/update.json
├── data/                  # state.json（运行状态）
├── logs/                  # launcher.log
├── workspace/ projects/ skills/ plugins/ mcp/ memory/   # 用户数据
└── tests/                 # node --test 单元测试
```

## 核心保证

- **PORTABLE_ROOT 动态推导**：永不硬编码盘符，Launcher 在哪，根目录就在哪。
- **进程解耦**：Agent 以 detached 方式启动，Launcher 退出后 Agent 独立运行。
- **防重复启动**：再次打开 Launcher 会扫描并恢复运行状态，禁止启动第二实例。
- **真实检测**：状态来自 Process Manager + Health Check，不用固定 sleep 伪造成功。
- **安全**：禁止硬编码/明文/日志记录 API Key；诊断报告自动脱敏。
- **更新安全**：更新只替换代码文件，绝不删除数据目录；下载后 SHA256 校验，失败自动回滚。

## 更新机制

1. 在 `config/update.json` 配置 `githubRepo`（形如 `owner/repo`）。
2. 发布新版本时在 GitHub Release 附上按平台命名的归档（如 `ai-usb-win32-x64.tar.gz`）。
3. 检查更新：`node launcher.js --update-check`，或 UI 设置 → 更新 → 检查更新。
4. 执行更新：下载 → SHA256 校验 → 备份 → 替换 → 失败自动回滚。
5. 更新过程绝不触碰 `workspace/ projects/ skills/ plugins/ mcp/ memory/ config/ backup/` 等数据目录。

## 许可证

MIT。第三方 Agent 是否可随产品分发，须按其官方许可证与分发条款确认。
