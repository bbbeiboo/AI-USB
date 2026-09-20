# 故障排查

## 1. Agent 显示「未安装」

**原因**：Launcher 通过命令行 `--version` 探测 Agent，未找到可执行文件。

**排查**：
```bash
# 检查是否真的安装了
hermes --version
codex --version
claude --version
openclaw --version
```

若命令不存在，需从官方渠道安装（见 `docs/INSTALL.md`）。若命令存在但 Launcher 仍显示未安装，
检查该命令是否在系统 PATH 中（Launcher 与终端使用相同的 PATH）。

## 2. 启动失败 / 启动即退出

**原因**：Agent 进程启动后立即退出（命令错误、缺少配置、端口冲突等）。

**排查**：
1. 手动运行该 Agent 命令，观察报错：
   ```bash
   hermes   # 直接运行看输出
   ```
2. 查看 Agent 自身日志。
3. 若 Agent 需要 TTY 交互（如 `hermes`、`codex` 的交互式界面），
   请改用其 GUI/桌面入口（如 `hermes desktop`、`codex app`）。

## 3. 数据目录写到了「系统临时目录」而非 U盘

**原因**：极少数情况下 portable 版未能识别便携目录。

**排查**：
- 确认运行的是 `-portable.exe`（便携版），而非安装版。
- 检查 exe 所在目录是否可写。
- 查看 `logs/launcher.log` 第一行 `starting (root=...)`，确认 root 是否为 exe 所在目录。

## 4. 更新失败

**常见原因与表现**：

| 原因 | 表现 |
|---|---|
| 未配置更新源 | `--update-check` 返回 `not-configured` |
| 校验失败 | 返回 `verify-failed`（SHA256 不匹配） |
| 网络中断 | 返回 `network-error` |
| 磁盘不足 | 返回 `disk-full` |
| 权限不足 | 返回 `permission-denied` |

**说明**：任何失败都会自动回滚到上一版本，不影响现有运行。

## 5. 端口 / 健康检查问题

**原因**：不同 Agent 健康检测方式不同（进程存活 / CLI 响应 / 端口）。

**排查**：查看 `logs/launcher.log`，确认 Agent 实际是否在运行。Launcher 只做「进程存活」级检测，
更深入的可用性由 Agent 自身保证。

## 6. 诊断报告

```bash
node launcher.js --doctor
```

输出 OS/CPU/架构/RAM/运行时版本/Agent 状态。**报告自动脱敏，不含任何 API Key / Token**。

## 7. 导出诊断日志

日志位于 `logs/launcher.log`。遇到问题时请附带该文件（确认不含敏感信息）。
