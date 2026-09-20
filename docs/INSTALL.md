# 安装 / 使用说明

## 系统要求

| 项 | 要求 |
|---|---|
| 操作系统 | Windows 10/11 x64、macOS 12+ (Intel/Apple Silicon)、Linux x64 |
| 运行环境 | 无需预装（产物内置 Electron 运行时） |
| 磁盘 | 约 400 MB（便携版自解压后） |

## 一、获取

- **Windows**：`ai-usb-<版本>-portable.exe`（单文件便携版，推荐 U盘使用）或 `-setup.exe`（安装版）。
- **macOS**：`.dmg` 或 `.zip`。
- **Linux**：`.AppImage`（免安装）或 `.deb`。

## 二、U盘便携用法（核心场景）

1. 把 `ai-usb-<版本>-portable.exe` 复制到 U盘任意目录。
2. 双击运行。
3. Launcher 显示四个 Agent 的状态。
4. 选择 Agent → 点「启动选中」，Launcher 确认运行后自动关闭。
5. Agent 独立运行；再次打开 Launcher 会恢复状态，不会重复启动。

> **数据位置**：所有数据（config/data/logs/workspace 等）自动落在 exe 所在目录，跟 U盘走，不写系统盘。

## 三、安装各 Agent（用户自行安装）

Launcher **不捆绑** Agent，需从官方渠道安装：

| Agent | 安装方式 |
|---|---|
| OpenClaw | `npm install -g openclaw`（或官方安装脚本） |
| Hermes | 官方安装脚本（`curl -fsSL .../install.sh \| bash`） |
| Codex | `npm install -g @openai/codex` |
| Claude Code | `npm install -g @anthropic-ai/claude-code`（专有，见 NOTICE） |

安装后 Launcher 会自动检测到（通过命令行 `--version` 探测）。

## 四、命令行用法

```bash
node launcher.js                 # 查看四 Agent 状态
node launcher.js --start hermes  # 启动
node launcher.js --stop hermes   # 停止
node launcher.js --doctor        # 环境诊断
node launcher.js --update-check  # 检查更新
```

## 五、开发 / 构建

```bash
npm install        # 安装依赖
npm test           # 运行测试
npm start          # 启动桌面 Launcher（开发态）
npm run dist:win   # 打包 Windows
```

详见根目录 `README.md`。
