# NOTICE

AI U盘 便携式多 Agent 工作台

Copyright (c) 2026 AI U盘 contributors。本项目以 MIT 许可证发布，见根目录 `LICENSE`。

---

## 被管理 Agent 的许可证与分发条款

> 关键原则（PROJECT_SPEC §2）：**Agent 是否可随产品分发，须以其官方许可证与分发条款为准。**

本产品（Launcher）本身是**进程管理器 / 控制中心**，不内置、不捆绑任何 Agent 二进制。
Launcher 仅负责**检测用户已安装的 Agent**，并提供启动 / 停止 / 状态管理。因此各 Agent
由用户从官方渠道自行安装，本产品不涉及再分发其二进制。

各 Agent 当前（2026-09）许可证与分发结论：

| Agent | 官方许可证 | 能否随产品再分发 |
|---|---|---|
| OpenClaw | MIT（核心 Gateway） | ✅ 可（遵守 MIT 声明） |
| Hermes | MIT | ✅ 可（遵守 MIT 声明） |
| Codex CLI (OpenAI) | Apache-2.0 | ✅ 可（遵守 Apache-2.0 声明） |
| Claude Code (Anthropic) | **专有**（© Anthropic PBC，Commercial ToS） | ❌ **不可自由再分发** |

> ⚠️ **Claude Code 是专有软件**：其官方仓库 `LICENSE.md` 为「© Anthropic PBC. All rights
> reserved. Use is subject to Anthropic's Commercial Terms of Service」，npm 包 license 字段为
> `SEE LICENSE IN README.md`。**严禁**将其二进制随本产品捆绑、镜像或再分发；用户须通过
> Anthropic 官方渠道自行安装并遵守其商业条款。

上述许可证结论基于公开信息，**分发前请以各官方仓库最新 LICENSE 文件为准复核**。

---

## 本项目直接运行时依赖

| 包 | 版本 | 许可证 | 说明 |
|---|---|---|---|
| electron | ^44.4.3 | MIT | 桌面运行时（打包进产物） |
| tar | ^7.5.22 | Blue Oak Model License 1.0.0 | 更新包解压（打包进 asar） |

完整依赖清单见 `THIRD_PARTY/DEPENDENCIES.md`。
