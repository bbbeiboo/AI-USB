# TASKS

## 当前迭代目标：核心功能完成（CODEX.md §22）

- [x] 项目扫描、目录结构
- [x] PORTABLE_ROOT 动态推导
- [x] 配置管理 (config/*.json 加载/默认值)
- [x] 日志系统 (logs/launcher.log)
- [x] Agent 统一 Adapter 接口 + 4 个 Adapter
- [x] Process Manager (start/stop/restart/is_running/pid/health)
- [x] 状态机 (Unknown/NotInstalled/Stopped/Starting/Running/Stopping/Error/Updating)
- [x] 防重复启动
- [x] 启动超时
- [x] 健康检查（按 Agent 类型）
- [x] Launcher 退出后 Agent 独立运行 (detached + unref)
- [x] 状态持久化 (data/state.json) + 重新打开恢复
- [x] 单元测试通过 (node --test，18/18)
- [x] Launcher UI (Electron 44)

## 后续迭代（未开始）

- [x] Update 管理器（GitHub Releases + SHA256 校验 + 失败回滚 + 数据目录保护）
- [x] Backup/Rollback（备份排除数据目录 + 回滚恢复）
- [x] 跨平台打包 — Windows（nsis + portable 已构建并实机验证）
- [ ] 跨平台打包 — macOS（需 macOS 构建机 / CI）& Linux（AppImage/deb，可交叉构建）
- [x] 商业发布（licenses/NOTICE/THIRD_PARTY + CHANGELOG + 安装/故障排查）

## 阻塞项

无。
