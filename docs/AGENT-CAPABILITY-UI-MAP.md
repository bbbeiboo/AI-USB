# AGENT-CAPABILITY-UI-MAP —— Capability → UI 映射（13.20 轮）

> 任务书 §十四：确保以后增加 Agent 时不用重新设计页面。
> 配套文档：AGENT-SOURCES.md（来源基线）、AGENT-CAPABILITY-MATRIX.md（五态判定）、
> HERMES-SETTINGS-MATRIX.md（Hermes 全量设置）。

## 0. 统一裁决：不支持的能力「显示但明确标记不支持」

任务书 §十二给了两个选项（隐藏 / 显示但标记）。**本项目统一采用：显示但明确标记不支持**，
理由与约束：

1. 13.18 的 18 项设置导航是**聚合器级**页面，不是单 Agent 页面——隐藏会造成
   「不同 Agent 打开设置中心看到不同结构」，违反任务书「不允许四个 Agent 各搞一套」。
2. 标记式能让用户知道「这个能力是存在的、只是当前 Agent 不支持」，与转交（把工作
   转给支持的 Agent）的产品主轴天然衔接；隐藏式则让能力消失。
3. **硬约束**：标记 ≠ 假控件。标记「不支持」的页面上不得出现可交互的假开关/假输入框
   （沿用 13.18 占位页禁令）；只允许说明文案 + 「由 XX Agent 接手」引导。

本轮 UI 未改（schema+capability+adapter+service 是本轮重点，见任务书 §十一）；
本表是接线轮实现显隐/标记时的唯一依据。

## 1. 能力组 → 聚合器 UI 落点

| Capability 组 | UI 落点 | 依据能力判定什么 |
| --- | --- | --- |
| model | 设置·模型；输入框 model-selector | 模型切换/推理力度是否可配 |
| auxiliary | 设置·模型（辅助模型 8 行） | 每行绑定是否对该 Agent 有意义（如 OpenClaw 无压缩小模型 → 该行标「不支持」） |
| conversation | 会话列表 / 设置·已归档 | 重命名/归档/导出入口是否出现 |
| generation | 输入框 发送⇄停止、重新生成 | stop/retry 按钮是否启用 |
| files | 文件页；输入框 ＋/📎 | 上传/下载是否走审批提示 |
| computer | （未来「工作区/高级」页） | 终端/桌面控制能力说明，Windows 实验性标注 |
| browser | 设置·Browser | Browser 页是否为「本 Agent 不支持」标记态 |
| memory | 设置·记忆与上下文 | 同上 |
| skills | 设置·插件 | 同上 |
| mcp | 设置·工具与密钥 | 同上 |
| delegation | 设置·高级 | 子代理/编排说明 |
| security | 设置·安全 | 审批模式/脱敏说明 |
| voice | 设置·语音 | 同上 |
| streaming / gateway | 设置·网关 | 渠道绑定说明（OpenClaw/Hermes 有、Codex/Claude Code 无 → 标记） |
| task / transfer | 任务页 / 队列页 / 推荐卡 / TransferDialog | 目标 Agent 能否接任务/文件/上下文（canAcceptTransfer 门控，已落地 stub） |
| settings | 设置中心各页 | 页内字段按 AgentSettingsField.status 渲染：implemented 可编辑 / planned 说明 / advanced/native-only 只读说明 |
| update | 设置·关于 / 顶栏检查更新 | update.check/rollback 是否原生（Codex 无原生 rollback → 说明经 npm 降级） |
| agent | 设置·关于 / 切换器 | 版本、更新入口 |

## 2. TransferDialog / 推荐卡的门控规则（本轮已在服务层落地）

- `transfer.receive=unsupported` 的目标：不出现在目标列表（当前四 Agent 均非 unsupported）。
- `transfer.task/file/conversation=unsupported`：对应复选框禁用并标「目标不支持」；
  提交时服务层 `canAcceptTransfer` 二次兜底（stub 已单测）。
- `transfer.file=permission-required`（OpenClaw）：复选框旁标「需目标端审批」，不阻断。
- 推荐（`getRecommendation`）按「全部附带内容」的最坏假设过滤：目标接不住 → 不出卡。

## 3. 新增 Agent 时的操作顺序（架构边界，本轮最重要的成果）

1. 在 `docs/AGENT-SOURCES.md` 登记：官方仓库/文档、锁定版本、本地入口、配置入口。
2. 新建 `services/capabilities/<id>.ts`：对照任务书 20 组逐项判定五态，每条给官方依据。
3. 在 `AGENT-CAPABILITY-MATRIX.md` 加一列（含「与最新版差异」注记）。
4. 补该 Agent 的 `SETTINGS_SCHEMA`（Secret 项只记标记）。
5. **UI 零改动**：设置中心、任务/队列/文件、转交门控全部按能力表自动表现。
