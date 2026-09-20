# Release Checklist

> 发布前逐项核对。每项状态必须真实记录，禁止默认全部 PASS。
> 状态：`PASS` / `FAIL` / `BLOCKED` / `N/A` / `NOT VERIFIED`

## v1.0.0-rc.1（2026-09-20）

| # | 检查项 | 状态 | 说明 |
|---|---|---|---|
| 1 | Version 单一来源 | PASS | `package.json`=1.0.0-rc.1，`getVersion()` 统一读取，config 无冗余 version |
| 2 | Git clean | PASS | 工作区干净（Factory 运行时） |
| 3 | Tests | PASS | 36/36（node --test） |
| 4 | Secret scan | PASS | 无 API key/token/私钥/硬编码密码 |
| 5 | License audit | PASS | LICENSE + NOTICE + THIRD_PARTY + licenses/ 齐全 |
| 6 | Windows build | PASS | nsis + portable，产物名 `ai-usb-1.0.0-rc.1-*.exe` |
| 7 | macOS build | BLOCKED | 需 macOS 构建机或 CI（dmg 无法在 Windows 交叉构建） |
| 8 | Linux build | BLOCKED | 需 Linux 构建机或 CI（AppImage/deb） |
| 9 | SHA256 | PASS | manifest.json 含全部文件 + 产物的 SHA256 |
| 10 | Production manifest | PASS | `production/output/AIUSB-20260920-0001/manifest.json` |
| 11 | Production report | PASS | 9/9 检查通过 |
| 12 | Portable exe smoke test | PASS | 窗口加载成功，数据落 exe 旁 |
| 13 | Setup.exe 安装流程 | NOT VERIFIED | 未实测 NSIS 安装/卸载流程 |
| 14 | Portable path test | PASS | C 盘、D 盘跨盘验证，数据跟随 exe |
| 15 | Agent detection | PASS | 4 Agent 检测；Hermes 真实检测到 v0.21.1，其余诚实标未安装 |
| 16 | Agent lifecycle | PASS | 7/7 完整流程（启动→关闭→恢复→防重复→停止） |
| 17 | Launcher 退出后 Agent 存活 | PASS | 两进程验收：HTTP 健康检查通过 |
| 18 | API test | N/A | 无真实 API 凭证，无法测 provider 连接 |
| 19 | Usage tracking | N/A | 本版本未实现该功能 |
| 20 | Update test | PASS | 12/12（下载/校验/备份/替换/回滚/数据保护） |
| 21 | Rollback test | PASS | 单元测试覆盖 |
| 22 | Backup test | PASS | 单元测试覆盖（排除数据目录） |
| 23 | Diagnostics test | PASS | `--doctor` 真实输出 OS/CPU/Agent/版本 |
| 24 | Claude Code 再分发检查 | PASS | 生产包无 Claude Code 二进制/镜像（Detect/Guide/Launch 模式） |

## 结论

- **PASS**：18 项
- **BLOCKED**：2 项（macOS / Linux 构建，需对应平台或 CI）
- **NOT VERIFIED**：1 项（setup.exe 安装流程）
- **N/A**：2 项（API 凭证、usage tracking）

> **发布前必须补**：macOS / Linux 产物（CI 或对应平台）、setup.exe 安装流程实测、代码签名。
> 未完成项不得视为「已发布」。
