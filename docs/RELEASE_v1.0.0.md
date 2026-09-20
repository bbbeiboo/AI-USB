# Release Report — v1.0.0

## 基本信息

| 项 | 值 |
|---|---|
| Version | 1.0.0 |
| Git Commit | 122ca6f → (后续 fix commits) |
| Git Tag | v1.0.0 |
| GitHub Repository | git@github.com:bbbeiboo/AI-USB.git |
| GitHub Release | **BLOCKED** — SSH 认证未通过，未 push |

## 三平台构建

| 平台 | 状态 | 产物 | 说明 |
|---|---|---|---|
| Windows x64 | **PASS** | `ai-usb-1.0.0-portable.exe` (106.1 MB) + `ai-usb-1.0.0-setup.exe` (106.3 MB) | 本机构建 + 实机验证 |
| macOS | **BLOCKED** | — | 需 macOS 构建机或 CI（dmg 无法在 Windows 交叉构建） |
| Linux | **BLOCKED** | — | 需 Linux 构建机或 CI |

## CI

| 项 | 状态 | 说明 |
|---|---|---|
| GitHub Actions 配置 | PASS | `.github/workflows/build.yml` 三平台矩阵已就绪 |
| CI 触发 | **BLOCKED** | 未 push（SSH 认证未通过） |

## 质量验证

| 项 | 状态 | 说明 |
|---|---|---|
| Tests | PASS | 36/36 通过（node --test） |
| SHA256 | PASS | `release/SHA256SUMS.txt` 包含全部产物哈希 |
| Secret Scan | PASS | 0 secrets（API_KEY=0, TOKEN=0, PASSWORD=0, PRIVATE_KEY=0, COOKIE=0） |
| License Audit | PASS | LICENSE / NOTICE / THIRD_PARTY / licenses/ 齐全 |
| Claude Code 分发检查 | PASS | 生产包无 Claude Code 二进制/镜像 |
| Production Factory | PASS | 9/9 检查通过 |
| Production ID | AIUSB-20260920-0001 | manifest.json (59 文件 + 2 产物) |
| Smoke Test | PASS | portable.exe 真实运行，窗口加载 + 数据落 exe 旁 |
| U盘用户流程模拟 | PASS | 7/7 步通过 |
| 便携性跨盘验证 | PASS | C 盘 + D 盘数据跟随 exe |

## 版本一致性

| 源 | 版本 |
|---|---|
| package.json | 1.0.0 |
| getVersion() | 1.0.0 |
| CHANGELOG | [1.0.0] |
| Git Tag | v1.0.0 |
| Production Factory | 1.0.0 |
| GitHub Release | **BLOCKED**（未 push） |

## 已知限制

1. **SSH 认证未通过** — 本机已生成 ed25519 公钥，但未添加到 GitHub 账号，导致无法 push/触发 CI
2. macOS / Linux 产物需 CI 或对应平台构建
3. 产物未代码签名（Windows SmartScreen / macOS Gatekeeper 会提示）
4. Claude Code 为专有软件，不随产品再分发（Detect/Guide/Launch 模式）
5. API 真实连接测试未执行（无凭证）
6. Usage Tracking / Cost Tracking / Pricing Engine 未实现（不在 v1.0.0 范围）

## Release Status

```
BLOCKED — 本地 v1.0.0 全部就绪，但无法 push 到 GitHub（SSH 认证未通过）
```

### 解除阻塞的方法

将以下公钥添加到 GitHub (https://github.com/settings/keys)：

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIg9ZRtJg05Q27E8heFdXgke8pz81J21FwhnXjn8miws ai-usb@bbbeiboo
```

添加后执行：
```bash
cd "E:/桌面/AI Agent 母盘"
git push -u origin master
git push origin v1.0.0
```

push + tag 会自动触发三平台 CI 构建，完成后 GitHub Release 会自动创建。
