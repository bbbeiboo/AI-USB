# 版本说明（CHANGELOG）

本项目遵循语义化版本（SemVer）。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [1.0.0] - 2026-09-20

### 首个正式版本

便携式多 Agent 工作台——把 AI Agent、工作区、配置、启动、更新和维护能力整合到一个便携环境。

#### 核心能力

- **Portable Launcher**：PORTABLE_ROOT 动态推导（Windows/macOS/Linux AppImage/portable），数据跟 exe 走，不写系统盘
- **Agent Manager**：统一编排 OpenClaw / Hermes / Codex / Claude Code 四个 Agent
- **Process Manager**：跨平台进程生命周期引擎（detached 启动/停止/重启/防重复/启动超时），Launcher 退出后 Agent 独立运行
- **四 Agent Adapter**：OpenClaw / Hermes / Codex / Claude Code 统一接口 + 状态机 + 健康检查
- **Health Check**：按 Agent 类型探测（process/cli/port/http）
- **Config Manager**：config/*.json 加载/默认值/合并
- **State Persistence**：data/state.json 运行状态持久化 + 重新打开恢复
- **Diagnostics**：OS/CPU/架构/RAM/运行时/Agent 状态，自动脱敏
- **Update Manager**：GitHub Releases 检查 → 下载 → SHA256 校验 → 备份 → 替换 → 失败自动回滚，数据目录保护
- **Backup/Rollback**：备份排除数据目录 + 失败回滚恢复

#### 桌面 UI（Electron 44）

- 四 Agent 状态卡片 + 实时轮询
- 启动选中 / 全部启动 / 全部停止 / 设置
- 诊断 / 检查更新 / 关于
- 自动关闭（启动确认后 Launcher 退出）

#### 打包

- electron-builder 三平台配置（Windows nsis+portable / macOS dmg+zip / Linux AppImage+deb）
- Windows 产物已构建并实机验证便携数据落点
- GitHub Actions 三平台矩阵 CI

#### 商业发布

- LICENSE (MIT) / NOTICE / THIRD_PARTY / licenses/ 齐全
- Claude Code 专有软件，不随产品再分发（Detect/Guide/Launch 模式）
- 安装说明 / 故障排查 / 版本说明 / Release Checklist

#### 测试

- 36 项单元/集成测试全部通过
- 两进程验收：Launcher 退出后 Agent 独立运行 + HTTP 健康检查
- U盘用户完整流程模拟：7/7 步通过
- 便携性跨盘验证（C/D 盘数据跟随 exe）
- 生产工厂 9/9 检查通过

#### 已知限制

- macOS / Linux 产物需在对应平台或 CI 构建
- 产物未代码签名（Windows SmartScreen / macOS Gatekeeper 会提示）
- Claude Code 为专有软件，不可随产品再分发
- API 真实连接测试未执行（无凭证）
- Usage Tracking / Cost Tracking / Pricing Engine 未实现（不在 v1.0.0 范围）

## [1.0.0-rc.1] - 2026-09-20

### 变更
- 版本号统一到单一来源（`package.json`），移除 config 中冗余的 `version` 字段。
- 新增 `src/core/version.js` 的 `getVersion()`，诊断/更新等统一读取。

### 说明
- 首个候选发布版（Release Candidate），功能与 0.1.0 一致，进入发布验证阶段。

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
