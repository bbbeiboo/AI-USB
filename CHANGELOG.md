# 版本说明（CHANGELOG）

本项目遵循语义化版本（SemVer）。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [0.1.0] - 2026-09-20

### 新增
- **核心引擎**：PORTABLE_ROOT 动态推导（Windows/macOS/Linux AppImage/portable 各布局）。
- **进程管理**：跨平台启动/停止/重启，detached 解耦（Launcher 退出后 Agent 独立运行），防重复启动，启动超时。
- **四 Agent 适配器**：OpenClaw / Hermes / Codex / Claude Code 统一接口 + 状态机 + 健康检查。
- **配置管理**：config/app.json、agents.json、providers.json、update.json，缺失自动落默认值。
- **更新管理器**：GitHub Releases 检查 → 下载 → SHA256 校验 → 备份 → 替换 → 失败自动回滚，数据目录保护。
- **Launcher UI**：Electron 桌面界面（状态轮询、启动/停止、设置、诊断、检查更新）。
- **环境诊断**：OS/CPU/架构/RAM/运行时版本/Agent 状态，自动脱敏。

### 测试
- 36 项单元/集成测试全部通过（进程管理、生命周期、配置、状态、更新、打包态路径）。

### 打包
- electron-builder 三平台配置（Windows nsis+portable / macOS dmg+zip / Linux AppImage+deb）。
- Windows 产物已构建并实机验证便携数据落点。

### 已知限制
- macOS / Linux 产物需在对应平台或 CI 构建（macOS dmg 无法在 Windows 交叉构建）。
- 产物未代码签名（Windows SmartScreen / macOS Gatekeeper 会提示）。
- Claude Code 为专有软件，不可随产品再分发（见 NOTICE/NOTICE.md）。
