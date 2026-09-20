# 第三方组件说明

本目录记录随产品分发或构建所使用的第三方组件及其许可证。

## 目录内容

- `DEPENDENCIES.md` — 完整依赖清单（240 项，由 `scripts/generate-third-party.mjs` 自动生成）。
- 许可证全文位于项目根 `licenses/` 目录：
  - `electron-LICENSE.txt` — Electron（MIT）
  - `tar-LICENSE.txt` — tar（Blue Oak Model License 1.0.0）
  - `Apache-2.0.txt` — Apache License 2.0（Codex CLI 分发所需）

## 运行时依赖（随产物分发）

| 包 | 许可证 | 说明 |
|---|---|---|
| electron | MIT | 桌面运行时 |
| tar | Blue Oak Model License 1.0.0 | 更新包解压 |

## 构建时依赖（不随产物分发）

electron-builder 及其传递依赖仅在构建阶段使用，不进入最终产物。完整列表见 `DEPENDENCIES.md`。

## 重新生成清单

```bash
node scripts/generate-third-party.mjs
```

> 说明：`DEPENDENCIES.md` 扫描的是 node_modules 全部包（含构建工具链），
> 运行时实际随产物分发的仅上表列出的 electron 与 tar 两项。
