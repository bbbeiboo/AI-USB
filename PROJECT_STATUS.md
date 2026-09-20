# PROJECT_STATUS

> 本文件记录项目真实状态，由主开发 Agent 维护，禁止虚构。

## 概览

| 项 | 值 |
|---|---|
| 项目 | AI U盘 — 便携式多 Agent 工作台 |
| 目录 | `E:\桌面\AI Agent 母盘` |
| 技术栈 | Node.js v24（核心零依赖 ESM）+ Electron 44（UI） |
| 更新日期 | 2026-09-20 |

## 环境扫描 (Phase 0)

| 工具 | 状态 |
|---|---|
| Node.js | ✅ v24.19.0 |
| npm | ✅ 11.17.0 |
| Python | ✅ 3.11.16 + uv 0.12.5 |
| Git | ✅ 2.55.0 |
| Rust/Cargo | ❌ 未安装 |
| Go | ❌ 未安装 |

## Agent 检测结果（本机真实状态）

| Agent | 状态 | 版本 |
|---|---|---|
| Hermes | ✅ 已安装 | v0.21.1 |
| Codex | ❌ 未安装 | — |
| Claude Code | ❌ 未安装 | — |
| OpenClaw | ❌ 未安装 | — |

## 开发进度

| Phase | 内容 | 状态 |
|---|---|---|
| 0 | 项目扫描 | ✅ 完成 |
| 1 | Launcher | ✅ 完成（CLI + Electron UI） |
| 2 | Agent Adapter | ✅ 完成（统一接口 + 4 Adapter） |
| 3 | Process Manager | ✅ 完成（detached/防重/停止/重启/超时） |
| 4 | 状态检测 | ✅ 完成（状态机 + 健康检查） |
| 5 | 自动关闭 Launcher | ✅ 完成（autoCloseAfterStart） |
| 6 | 重新打开状态恢复 | ✅ 完成（state.json 持久化 + 重扫） |
| 7 | 便携数据 | ✅ 完成（PORTABLE_ROOT 动态推导） |
| 8 | 配置/API | ✅ 完成（config/*.json + IPC） |
| 9 | Update | ✅ 完成（GitHub Releases + 校验/备份/回滚） |
| 10 | Backup/Rollback | ✅ 完成（备份 + 失败回滚，随 Update 实现） |
| 11 | 跨平台构建 | 🟡 Windows 完成（nsis+portable 已构建验证）；macOS/Linux 需对应平台或 CI |
| 12 | 商业发布 | ⬜ 未开始（licenses/NOTICE/THIRD_PARTY） |

## 验证结果

- ✅ 单元测试 18/18 通过（`node --test`）
- ✅ 两进程验收：Launcher 退出后 Agent 独立运行 + HTTP 健康检查通过
- ✅ Electron 冒烟测试：窗口加载成功、PORTABLE_ROOT 正确解析
- ✅ Update 管理器测试 12/12：下载/校验/备份/替换/回滚/数据目录保护/错误路径
- ✅ 打包态 PORTABLE_ROOT 测试 6/6：Windows/macOS/Linux AppImage/portable 各布局
- ✅ Windows 打包成功：setup.exe + portable.exe，实机验证数据目录落 exe 旁

## BLOCKED

无。后续 Phase（Update / Backup / 打包）需按 CODEX.md 顺序继续。
