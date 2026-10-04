# Hermes Agent 全量设置映射文档（HERMES-SETTINGS-MATRIX）

| 项目 | 值 |
|---|---|
| Agent | Hermes |
| 官方仓库 | https://github.com/NousResearch/hermes-agent |
| 项目锁定版本 | 0.21.4（upstream commit c0d72947，本仓库 `pyproject.toml` version=0.21.4，git HEAD c0d7294 已核实） |
| 提取日期 | 2026-10-03 |
| 本机配置 | `E:\桌面\AI Agent 母盘\agents\Hermes\config.yaml`（2130 行） |

**脱敏声明**：本文档遵守硬性安全规则。`agents/Hermes/auth.json`、`auth.lock`、`.env`、`backups/`、`pairing/` 一律未读取。`config.yaml` 中匹配 `/api_key|apikey|token|secret|password|credential|private_key/i` 的 key 只记录 key 名与类型，值一律写 `<redacted>`。经核查，本机 config.yaml **不含任何明文密钥**（唯一密钥相关条目是 `model.key_env`，其值是环境变量**名**而非密钥本身）。本机实际密钥由聚合器通过子进程环境变量 `HERMES_LAUNCHER_API_KEY` 注入（见「聚合器安全配置」一节）。

**Source 列约定**（均为官方 v0.21.4 源码，根目录 `agents/Hermes/hermes-agent/`）：
- 【D】= `hermes_cli/config_defaults.py`（DEFAULT_CONFIG / OPTIONAL_ENV_VARS，运行时代码真实默认值）
- 【E】= `cli-config.yaml.example`（官方示例配置，2267 行）
- 【A】= `agent/` 目录下对应模块
- 其余为具体文件路径。

**列约定**：
- 默认值以【D】为准；【D】未收录但【E】给出默认的，以【E】为准并注明。
- 「本机值」列：本机 config.yaml 与官方示例逐行 diff 后**仅 6 处实际差异**（已逐条标注）；其余条目本机值与默认一致或未覆写，记「—」。
- 「Runtime Change」：`是（/命令）`= 有 slash 命令即时切换；`否`= 需重启或新会话；`未在源码中定位`= 源码未标注。
- 「Secret」= 是 表示该 key 的**值**属于凭据类，本文档中一律 `<redacted>` 或只记类型。

---

## 1. Model / Provider / Fallback / Reasoning

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 默认模型 | `model.default`（别名 `model.model`） | str | `""` | models.dev 目录或目录外任意模型 id | 主模型；`--model` 可单次覆盖 | config.yaml | `poolside/laguna-s-2.1:free`（diff①） | 否 | 是（/model、--model） | 否 | 【D】【E】 |
| 推理提供方 | `model.provider` | str | `auto` | auto/openrouter/nous/nous-api/anthropic/openai-codex/copilot/gemini/zai/kimi-coding/minimax/minimax-cn/huggingface/nvidia/xiaomi/arcee/ollama-cloud/deepinfra/kilocode/ai-gateway/azure-foundry/lmstudio/custom（ollama/vllm/llamacpp→custom） | 选择推理端；`--provider` 单次覆盖 | config.yaml | `custom`（diff②） | 否 | 是（/model、--provider） | 否 | 【E】 |
| API 基址 | `model.base_url` | str | `https://openrouter.ai/api/v1` | 任意 OpenAI 兼容 URL | custom 端点地址 | config.yaml | `https://openrouter.ai/api/v1`（未改） | 否 | 否 | 新会话 | 【E】 |
| API 密钥 | `model.api_key` | str | 未设 | 字符串 | 内联密钥（建议放 .env） | config.yaml | 未启用（注释态） | **是** | 否 | 重启 | 【E】 |
| 密钥环境变量名 | `model.key_env` | str | 未设 | 环境变量名（非密钥值） | 从该环境变量读密钥 | config.yaml | `HERMES_LAUNCHER_API_KEY`（diff③，聚合器注入） | 否（值为变量名） | 否 | 重启 | 【E】 |
| 请求流式 | `model.streaming` | bool | `true` | true/false | 强制整会话非流式（自托管服务端 tool-call 流损坏时逃生口） | config.yaml | 未覆写 | 否 | 否 | 新会话 | 【E】 |
| 上下文窗口 | `model.context_length` | int | 自动探测 | 正整数 | 总窗口（输入+输出）；仅自动探测错误时手设 | config.yaml | 未覆写 | 否 | 否 | 新会话 | 【E】 |
| Ollama num_ctx | `model.ollama_num_ctx` | int | 自动 | 正整数 | 仅 Ollama：随请求发送的 num_ctx | config.yaml | 未覆写 | 否 | 否 | 新会话 | 【E】 |
| 默认请求头 | `model.default_headers`（别名 `extra_headers`） | dict | 未设 | header 键值 | 覆盖 OpenAI SDK 识别头（网关/WAF 场景）；仅 OpenAI 线协议 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【E】 |
| 命名提供方 | `providers.<name>` | dict | `{}` | — | 命名端点定义 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】【E】 |
| ↳ 线协议 | `providers.<name>.api_mode` | str | 自动探测 | chat_completions / codex_responses / anthropic_messages | 指定 wire 协议 | config.yaml | — | 否 | 否 | 重启 | 【E】 |
| ↳ 命令铸造凭据 | `providers.<name>.key_cmd` | str | 未设 | shell 命令 | 每请求运行、输出 token（短时 bearer 刷新） | config.yaml | — | **是**（输出为凭据） | 否 | 重启 | 【E】 |
| ↳ 请求超时 | `providers.<name>.request_timeout_seconds` | int | 1800（HERMES_API_TIMEOUT）/原生 Anthropic 900 | 秒 | 每请求超时 | config.yaml | — | 否 | 否 | 重启 | 【E】 |
| ↳ 非流式陈旧超时 | `providers.<name>.stale_timeout_seconds` | int | 90（HERMES_API_CALL_STALE_TIMEOUT） | 秒 | 非流式陈旧检测 | config.yaml | — | 否 | 否 | 重启 | 【E】 |
| ↳ 额外请求体 | `providers.<name>.extra_body` | dict | `{}` | — | 合并进请求体（如网关 service_tier） | config.yaml | — | 否 | 否 | 重启 | 【E】 |
| ↳ 会话亲和头 | `providers.<name>.session_affinity_header` | str | 未设 | header 名 | 向会话感知代理传递会话 id | config.yaml | — | 否 | 否 | 重启 | 【E】 |
| 回退链 | `fallback_providers` | list | `[]` | 条目同 providers（provider/model/base_url/…） | 主模型故障后按序切换 | config.yaml | 未覆写 | 条目可含 api_key（是） | 否 | 重启 | 【D】 |
| 回退切换阈值 | `fallback.min_switch_reset_seconds` | int | `0`（关） | 秒 | 限流重置早于该值时留在主模型 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 凭据池策略 | `credential_pool_strategies` | dict | `{}` | — | 多凭据轮换策略 | config.yaml | — | 条目涉凭据（是） | 否 | 重启 | 【D】 |
| 推理力度 | `agent.reasoning_effort` | str/dict | `medium`（【E】；【D】未单列默认键） | xhigh/high/medium/low/minimal/none；dict 形式 `{enabled,effort}` | 思考量等级 | config.yaml | `medium`（示例值，未改） | 否 | 否 | 新会话 | 【E】 |
| 按模型推理力度 | `agent.reasoning_overrides` | dict | `{}` | 模型名→力度 | 覆盖特定模型力度；不支持 config set | config.yaml | — | 否 | 否 | 新会话 | 【E】【D】 |
| 推理回显 | `agent.reasoning_echo` | bool | `false` | true/false | 重放历史时保留 reasoning_content（DeepSeek/Kimi 族） | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 输出详略 | `agent.text_verbosity` | str | `""`（不发送） | ""/low/medium/high | Responses API `text.verbosity` | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 快速/优先档 | `agent.service_tier` | str | `""` | ""/normal/fast/auto/cold | OpenAI Priority / xAI / Anthropic fast | config.yaml | — | 否 | 是（/fast） | 否 | 【D】【E】 |
| 快速档窗口 | `agent.fast_auto_seconds` | int | `60` | 秒 | auto/cold 模式下前 N 秒走 fast | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| API 重试次数 | `agent.api_max_retries` | int | `3` | ≥1 | Hermes 层 API 错误重试 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 自动恢复轮数 | `agent.auto_recovery_cycles` | int | `5` | 0-… | 重试+回退耗尽后继续等重试的轮数 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 流排空超时 | `agent.stream_drain_timeout` | float | `2.0` | 秒 | 终止帧后继续读 SSE 的秒数 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 空响应守卫 | `agent.empty_response_guard` | dict | `{enabled:true, cost_threshold_usd:0.25}` | — | 阻止对确定性空响应重复全额计费重试 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 回合存活看门狗 | `agent.turn_liveness` | dict | `{timeout_s:600.0, poll_s:15.0}` | 秒 | 无进展回合强中断与租约回收 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| OpenRouter 路由 | `provider_routing` | dict | 未设（价格排序） | sort/only/ignore/order/require_parameters/data_collection/models | OpenRouter 上游路由策略 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【E】 |
| OpenRouter 响应缓存 | `openrouter.response_cache` / `response_cache_ttl` / `min_coding_score` | bool/int/float | `true`/`300`/`0.65` | TTL 1-86400；score 0.0-1.0 | 边缘缓存与 pareto-code 路由 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】【E】 |
| AWS Bedrock | `bedrock.region` / `bedrock.discovery.*` / `bedrock.guardrail.*` | dict | `""`/`{enabled:true,…}`/`{…}` | — | Bedrock 区域、模型发现、Guardrails | config.yaml | 未覆写 | 凭据走 AWS env（是） | 否 | 重启 | 【D】 |
| Google Vertex | `vertex.project_id` / `vertex.region` | str | `""`/`global` | GCP 项目/区域 | Vertex AI（Gemini）凭据走 .env 的 VERTEX_CREDENTIALS_PATH | config.yaml | 未覆写 | 凭据走 env（是） | 否 | 重启 | 【D】 |
| Nous Portal | `nous.keepalive_interval_seconds` / `nous.anthropic_wire` / `nous.guest` | int/str/bool | `900`/`chat`/`true` | wire: chat/native/auto | Portal 保活、Anthropic 线路、免费层 | config.yaml | 未覆写 | 凭据在 auth.json（是，未读取） | 否 | 重启 | 【D】 |
| Azure Foundry 认证 | `model.auth_mode` / `model.entra.scope` | str | — | entra_id；scope URL | Entra ID 免密认证 | config.yaml | 未覆写 | 凭据走 Entra（是） | 否 | 重启 | 【E】 |
| 统一操作时限 | `timeouts.tools.concurrent_batch` / `sequential_call` | int | `420` | 秒；0/负=无界 | 并行/顺序工具调用截止时间 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【E】 |
| 模型别名 | `model_aliases` | dict | 未设 | 别名→{model,provider,base_url,api_key/key_env} | /model 短名映射 | config.yaml | — | 条目可含 api_key（是） | 否 | 重启 | 【E】 |
| 模型元数据覆盖 | `model_overrides` | dict | `{}` | provider.model→{context_window,…} | 覆盖模型能力元数据 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| models.dev 镜像 | `models_dev.url` | str | `""`（官方 api.json） | URL | 模型目录镜像 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 远程模型目录 | `model_catalog.enabled/url/ttl_minutes/providers` | — | `true`/官方 URL/`20` | — | 模型选择列表远程目录 | config.yaml | — | 否 | 否 | 重启 | 【D】 |

## 2. Auxiliary Models（辅助模型）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 辅助重试 | `auxiliary.transient_retries` | int | `2` | 0-6 | 同提供方瞬态重试次数 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】 |
| 仅免费档 | `auxiliary.free_only` | bool | `false` | — | OpenRouter 回退仅限 `:free` 模型 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】 |
| 回退模型 | `auxiliary.openrouter_model` | str | `""`（gemini-3.6-flash 付费） | 模型 id | 覆盖自动链 OpenRouter 回退模型 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 仅流式端点 | `auxiliary.stream_only_base_urls` | list | `[]` | URL 子串 | 这些端点强制 stream=True | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 各任务块 | `auxiliary.<task>` | dict | `_aux(timeout)`：`{provider:"auto", model:"", base_url:"", api_key:"", timeout:T, extra_body:{}, reasoning_effort:""}` | provider: auto/openrouter/nous/gemini/ollama-cloud/codex/main | 每任务独立 provider+model | config.yaml | 未覆写 | api_key=**是** | 否 | 重启 | 【D】【E】 |
| ↳ 视觉 | `auxiliary.vision` | dict | timeout=120, download_timeout=30 | — | vision_analyze + 浏览器截图分析 | config.yaml | — | api_key=是 | 否 | 重启 | 【D】【E】 |
| ↳ 压缩 | `auxiliary.compression` | dict | timeout=120, no_progress_timeout=None | — | 上下文压缩摘要 | config.yaml | — | api_key=是 | 否 | 重启 | 【D】【E】 |
| ↳ 标题生成 | `auxiliary.title_generation` | dict | `{enabled:true, model_upgrade_enabled:true, timeout:30, prefer_fast_model:false, language:""}` | — | 会话标题 | config.yaml | — | api_key=是 | 否 | 重启 | 【D】【E】 |
| ↳ 其他任务 | `auxiliary.skills_hub/approval/review/mcp/memory_query_rewrite/tts_audio_tags/triage_specifier/kanban_decomposer/profile_describer/goal_judge/curator/monitor/background_review/moa_reference/moa_aggregator` | dict | 各自 timeout 30-900 | — | 分类器/评审/策划/kanban/MoA 等专用辅助调用 | config.yaml | — | api_key=是 | 否 | 重启 | 【D】 |
| 视觉嵌入预算 | `vision.embed_target_bytes` | int | `262144`（64KiB-4MiB 钳制） | 字节 | 单张内嵌图像字节预算 | config.yaml | 未覆写 | 否 | 否 | 新会话 | 【D】【E】 |
| 单图嵌入次数 | `vision.max_calls_per_image` | int/null | `null`（子代理 3，主代理不限） | 数字/0=不限 | 同图重复嵌入限频 | config.yaml | — | 否 | 否 | 新会话 | 【D】【E】 |
| 图像输入模式 | `agent.image_input_mode` | str | `auto` | auto/native/text | 用户图像直达主模型或预分析 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |

## 3. Terminal / Local / Docker / SSH / Modal / Daytona / Vercel Sandbox / Singularity

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 终端后端 | `terminal.backend` | str | `local` | local/ssh/docker/singularity/modal/daytona/vercel_sandbox | 命令执行环境 | config.yaml | `local`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| Modal 模式 | `terminal.modal_mode` | str | `auto` | — | Modal 运行方式 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 降级模式 | `terminal.degraded_mode` | str | `warn` | warn/fail | 远端后端连接失败的表现 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 工作目录 | `terminal.cwd` | str | `.` | 路径 | CLI 用 `.`；gateway/cron 用此值 | config.yaml | `.`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 终端临时目录 | `terminal.temp_dir` | str | `""`（TMPDIR 或 HERMES_HOME/cache/terminal） | 绝对路径 | 后台日志/pid/沙箱根 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 字体 | `terminal.font_family` | str | `""`（内建 JetBrains Mono 栈） | CSS 字体栈 | 桌面 xterm 字体 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 命令超时 | `terminal.timeout` | int | `180` | 秒 | 单命令超时 | config.yaml | `180`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 守护进程宽限 | `terminal.daemon_term_grace_seconds` | float | `2.0` | 秒 | SIGTERM→SIGKILL 间隔 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 一次性运行等待 | `terminal.oneshot_completion_wait_seconds` | float | `600.0` | 秒 | -q/-z 退出时等待后台通知进程 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 环境透传 | `terminal.env_passthrough` | list | `[]` | 环境变量名 | 传入沙箱终端/execute_code | config.yaml | — | 值可能是凭据（是） | 否 | 重启 | 【D】 |
| 回传大小上限 | `terminal.sync_back_max_bytes` | int | `2147483648`（2GiB） | 字节 | 远端状态回传解包上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| HOME 策略 | `terminal.home_mode` | str | `auto` | auto/real/profile | 工具子进程 HOME | config.yaml | `auto`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| shell 初始化文件 | `terminal.shell_init_files` | list | `[]`（bash 时自动 source profile/bashrc） | 路径 | 会话环境快照额外 source | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 自动 source bashrc | `terminal.auto_source_bashrc` | bool | `true` | — | 快照登录 shell 读 rc 文件 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| SSH 主机/用户/端口/密钥 | `terminal.ssh_host/ssh_user/ssh_port/ssh_key` | str/int | 未设（22） | — | SSH 后端连接参数 | config.yaml | 未覆写 | ssh_key 指向私钥文件（是） | 否 | 重启 | 【E】 |
| Docker 镜像 | `terminal.docker_image` | str | `nikolaik/python-nodejs:python3.11-nodejs20` | 镜像 | Docker 后端镜像 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】【E】 |
| Docker 转发环境 | `terminal.docker_forward_env` | list | `[]` | 变量名 | 宿主→容器转发（值对容器可见） | config.yaml | — | 是 | 否 | 重启 | 【E】 |
| Docker 固定环境 | `terminal.docker_env` | dict | `{}` | 键值 | 容器内直接设置（systemd 场景） | config.yaml | — | 是 | 否 | 重启 | 【D】 |
| Docker 卷挂载 | `terminal.docker_volumes` | list | `[]` | `host:container` | 额外 bind mount | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 挂载 cwd | `terminal.docker_mount_cwd_to_workspace` | bool | `false` | — | 挂载启动目录到 /workspace（削弱隔离） | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| Docker 网络 | `terminal.docker_network` | bool | `true` | — | false=--network=none | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Docker 额外参数 | `terminal.docker_extra_args` | list | `[]` | docker run 旗标 | 逐字附加在安全默认之后 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| Docker shm 大小 | `terminal.docker_shm_size` | str | `1g` | — | /dev/shm（Chromium/PyTorch 需要） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 宿主用户身份运行 | `terminal.docker_run_as_host_user` | bool | `false` | — | --user uid:gid，文件归属宿主用户 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| Snap Docker 兼容 | `terminal.docker_snap_compat` | bool | `false` | — | 去掉 --init 与 no-new-privileges | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 共享容器身份 | `terminal.docker_shared_container_key` | str | `""` | — | 信任配置共享一个容器身份 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Singularity 镜像 | `terminal.singularity_image` | str | `docker://nikolaik/python-nodejs:python3.11-nodejs20` | — | HPC 容器镜像 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】【E】 |
| Modal 镜像 | `terminal.modal_image` | str | 同上 | — | Modal 沙箱镜像 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】【E】 |
| Daytona 镜像 | `terminal.daytona_image` | str | 同上 | — | Daytona 沙箱镜像（需 DAYTONA_API_KEY） | config.yaml | 未覆写 | 凭据走 env（是） | 否 | 重启 | 【D】【E】 |
| Vercel 运行时 | `terminal.vercel_runtime` | str | `node24` | node24/node22/python3.13 | vercel_sandbox 后端运行时 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 容器 CPU | `terminal.container_cpu` | int | `1` | 核数 | docker/singularity/modal/daytona/vercel 通用 | config.yaml | `1`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 容器内存 | `terminal.container_memory` | int | `5120`（MB） | — | 同上 | config.yaml | `5120`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 容器磁盘 | `terminal.container_disk` | int | `51200`（MB） | — | 同上 | config.yaml | `51200`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 容器持久化 | `terminal.container_persistent` | bool | `true` | — | 文件系统跨会话保留 | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| sudo 密码 | `terminal.sudo_password` | str | 未设（交互提示） | 字符串/`""` | sudo -S 管道；明文存储警告 | config.yaml | 未覆写 | **是** | 否 | 重启 | 【D】【E】 |
| 持久 shell | `terminal.persistent_shell` | bool | `true` | — | 非本地后端保持 bash 会话（cwd/env 存续） | config.yaml | — | 否 | 否 | 重启 | 【D】 |

## 4. Memory（持久记忆）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 记忆开关 | `memory.memory_enabled` | bool | `true` | — | MEMORY.md（MEMORY.md → memories/ 目录本机存在） | config.yaml | `true`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 用户画像 | `memory.user_profile_enabled` | bool | `true` | — | USER.md 用户档案 | config.yaml | `true`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 写入审批 | `memory.write_approval` | bool | `false` | — | true=前台写内联审批、后台写暂存 /memory pending | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 记忆字符上限 | `memory.memory_char_limit` | int | `2200` | — | ~800 token | config.yaml | `2200`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 用户画像上限 | `memory.user_char_limit` | int | `1375` | — | ~500 token | config.yaml | `1375`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 记忆提醒间隔 | `memory.nudge_interval` | int | `10` | 0=关 | 每 N 个用户回合提醒保存记忆 | config.yaml | `10`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 外部记忆提供方 | `memory.provider` | str | `""` | openviking/mem0/hindsight/holographic/retaindb/byterover | 外置记忆插件（仅一个） | config.yaml | — | 对应 API key 走 env（是） | 否 | 重启 | 【D】 |
| Honcho 集成 | `honcho` | dict | `{}` | — | ~/.honcho/config.json 为准；此处仅 Hermes 覆盖 | config.yaml | 未覆写 | HONCHO_API_KEY 走 env（是） | 否 | 重启 | 【D】【E】 |

## 5. Skills（技能）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 技能创建提醒 | `skills.creation_nudge_interval` | int | `15` | 0=关 | 每 N 次工具迭代提醒创建技能 | config.yaml | `15`（未改） | 否 | 否 | 新会话 | 【E】 |
| 外部技能目录 | `skills.external_dirs` | list | `[]` | 路径 | 只读共享目录（~/${VAR} 展开） | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 技能创建目录 | `skills.create_dir` | str | `""`（profile 本地） | HERMES_HOME 相对路径 | 新技能落点 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 项目技能发现 | `skills.project_discovery` | bool | `true` | — | 扫描受信项目根的 .hermes/.agents skills | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 受信项目目录 | `skills.trusted_project_dirs` | list | `[]` | 绝对路径 | `hermes skills trust` 管理 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 自动加载技能 | `skills.auto_load` | list | `[]` | 技能名 | 每个新会话固定全量加载 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 模板变量 | `skills.template_vars` | bool | `true` | — | 替换 ${HERMES_SKILL_DIR}/${HERMES_SESSION_ID} | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 内联 shell | `skills.inline_shell` / `inline_shell_timeout` | bool/int | `false`/`10` | — | SKILL.md 中 !`cmd` 片段预执行 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 代理创建技能扫描 | `skills.guard_agent_created` | bool | `false` | — | 对 skill_manage 写入做安全扫描 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| NVIDIA Tier1 建议扫描 | `skills.tier1_advisory` | bool | `true` | — | 安装时咨询式扫描（需 skillevaluator 在 PATH） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 技能写入审批 | `skills.write_approval` | bool | `false` | — | 技能变更暂存 /skills pending approve | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 策划台账 | `skills.ledger` / `ledger_max_bytes` | bool/int | `true`/`5242880` | — | .curator_ledger.jsonl 变更台账+回滚 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Curator 策划器 | `curator.enabled/interval_hours/min_idle_hours/stale_after_days/archive_after_days/consolidate/prune_builtins/archive_ttl_days` | — | `true`/`168`/`2`/`14`/`30`/`false`/`false`/`0` | — | 后台技能维护（闲置→stale→archive） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Curator 备份 | `curator.backup.enabled/keep` | bool/int | `true`/`2` | — | 整理前快照 skills.tar.gz | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Skills Hub | toolset `skills_hub` | — | — | — | 在线注册表安装（用户驱动） | —（工具层） | — | GITHUB_TOKEN 走 env（是） | — | — | 【E】 |

## 6. Context / Compression（上下文与压缩）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 上下文引擎 | `context.engine` | str | `compressor` | compressor/插件名（如 lcm） | 窗口管理引擎 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 内存修剪 | `context.memory_trim.*` | dict | `{enabled:true, cooldown_seconds:60.0, log_every_n:1, info_log_min_delta_mb:0.0}` | — | glibc 页归还 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 压缩开关 | `compression.enabled` | bool | `true` | — | 自动上下文压缩 | config.yaml | `true`（未改） | 否 | 是（/compress 手动） | 新会话 | 【D】【E】 |
| 压缩前置检查点 | `compression.checkpoint_required` | bool | `false` | — | 无检查点则拒绝有损压缩 | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 压缩进度通知 | `compression.progress_notices` | bool | `false` | — | 常规压缩进度送达聊天平台 | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 压缩阈值 | `compression.threshold` | float | `0.50`（<512K 窗口下限 0.75） | 0-1 | 触发压缩的窗口占比 | config.yaml | `0.50`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 按模型阈值 | `compression.model_thresholds` | dict | `{}` | 模型子串→比例；可加 `<provider>:` 前缀 | 分模型压缩点 | config.yaml | — | 否 | 否 | 新会话 | 【D】【E】 |
| 绝对 token 阈值 | `compression.threshold_tokens` | int | `256000` | null=仅比例 | 触发上限（取低者） | config.yaml | `256000`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| Codex 自动抬升 | `compression.codex_gpt55_autoraise` / `…_autoraise_notice` | bool | `true`/`true` | — | gpt-5.5 系 Codex 路由抬到 85% | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 尾部保留比 | `compression.target_ratio` | float | `0.20` | 0.10-0.80 | 阈值×ratio 为尾部预算 | config.yaml | `0.20`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 尾部模式 | `compression.tail_mode` | str | `lean` | lean/legacy | lean=钳制尾部+摘要；legacy=逐字尾部 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 最近消息保留 | `compression.protect_last_n` | int | `20` | — | 尾部最少保留消息数 | config.yaml | `20`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 尾部用户消息保底 | `compression.min_tail_user_messages` | int | `1` | — | 真实用户消息保证存续数 | config.yaml | `1`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 压缩重试轮数 | `compression.max_attempts` | int | `3`（上限 10） | ≥1 | 放弃前重试轮数 | config.yaml | `3`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 头部保护 | `compression.protect_first_n` | int | `3` | 0=只留 system | 头部非系统消息永不摘要 | config.yaml | `3`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 闲置压缩 | `compression.idle_compact_after_seconds` | int | `0` | 秒 | 恢复会话先压缩陈旧历史 | config.yaml | `0`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 微压缩 | `compression.micro_compact` / `micro_compact_every_n_turns` / `micro_compact_defrag_threshold_tokens` | bool/int | `false`/`1`/`2000` | — | 每回合滚动摘要（每轮破坏 prompt cache） | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 卫生压缩 | `compression.hygiene_hard_message_limit / hygiene_timeout_seconds / hygiene_total_ceiling_seconds / hygiene_failure_cooldown_seconds / hygiene_max_turn_hold_seconds` | int | `5000`/`30`/`600`/`300`/`10` | 秒 | 网关会话卫生压缩预算 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 压缩超时 | `compression.context_timeout_seconds / context_total_ceiling_seconds` | int | `120`/`600` | 秒；0=禁用 | in-agent compress_context 预算 | config.yaml | — | 否 | 否 | 重启 | 【E】 |
| 摘要失败中止 | `compression.abort_on_summary_failure` | bool | `false` | — | 摘要失败即中止而非占位继续 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 原地压缩 | `compression.in_place` | bool | `true` | — | 不轮换 session id | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Codex app-server 压缩 | `compression.codex_app_server_auto` | str | `native` | native/hermes/off | codex 线程压缩归谁管 | config.yaml | `native`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| OpenAI 服务端压缩 | `compression.codex_responses_native / codex_responses_compact_threshold` | bool/int | `false`/`null` | — | Responses API 服务端压缩 | config.yaml | `false` / 空（=null，diff④） | 否 | 否 | 重启 | 【D】【E】 |
| 主动修剪 | `compression.proactive_prune_tokens / proactive_prune_min_result_chars / proactive_prune_min_reclaim_tokens` | int | `0`/`8000`/`4096` | — | 无 LLM 的旧工具结果修剪（缓存迟滞门） | config.yaml | `0`/`8000`/`4096`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 上下文文件上限 | `context_file_max_chars` | int/null | `null`（20K-500K 随窗口缩放） | 字符 | SOUL.md/AGENTS.md 等单文件截断上限 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 上下文文件读超时 | `context_file_read_timeout` | float | `5.0` | 秒 | 网络盘冷读保护 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| read_file 上限 | `file_read_max_chars` | int | `100000` | 字符 | 单次读文件上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Anthropic 缓存 TTL | `prompt_caching.cache_ttl` | str | `5m` | 5m/1h/auto/falsy=关 | Anthropic prompt cache 档位 | config.yaml | `5m`（未改） | 否 | 否 | 新会话 | 【D】【E】 |
| 预填消息 | `prefill_messages_file` | str | `""` | JSON 路径 | 每次 API 调用前注入 few-shot 消息（不落盘） | config.yaml | — | 否 | 否 | 重启 | 【D】 |

## 7. Tool Output / Guardrails / Verify-on-Stop

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 工具输出截断 | `tool_output.max_bytes / max_lines / max_line_length` | int | `50000`/`2000`/`2000` | — | 终端输出 head+tail；read_file 行钳制 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| MCP 结果溢出 | `tool_budget.mcp_result_size_chars` | int | `50000` | 字符 | mcp_* 工具结果溢写阈值 | config.yaml | — | 否 | 否 | 重启 | 【E】 |
| 循环护栏-警告 | `tool_loop_guardrails.warnings_enabled` | bool | `true` | — | 重复失败软警告 | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 循环护栏-硬停 | `tool_loop_guardrails.hard_stop_enabled` | bool | `false` | — | 交互面硬停（选择加入） | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 非交互硬停 | `tool_loop_guardrails.non_interactive_hard_stop_enabled` | bool | `true` | — | gateway/cron 无人值守默认硬停 | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 警告阈值 | `tool_loop_guardrails.warn_after` | dict | `{exact_failure:2, same_tool_failure:3, idempotent_no_progress:2}` | — | 触发警告次数 | config.yaml | 未改 | 否 | 否 | 重启 | 【D】【E】 |
| 硬停阈值 | `tool_loop_guardrails.hard_stop_after` | dict | `{exact_failure:5, same_tool_failure:8, idempotent_no_progress:5}` | — | 触发硬停次数 | config.yaml | 未改 | 否 | 否 | 重启 | 【D】【E】 |
| 单回合上限 | `tool_loop_guardrails.loop_caps` | dict | `{max_web_searches:50, max_subagents:50}` | 0=不限 | 每回合搜索/子代理硬上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 回合上限 | `agent.max_turns` | int/null | `null`（代码默认无限；【E】示例写 500） | 数字/none | 每会话最大工具迭代数 | config.yaml | `500`（示例值） | 否 | 否 | 新会话 | 【D】【E】 |
| 预算预警比 | `agent.budget_warning_ratio` | float/null | `null` | 0-1 | 有限回合上限耗尽前一次性警告 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 运行预算 | `agent.run_budget_seconds` | int/null | `null` | 秒 | 每次运行墙钟预算（80% 提醒） | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 工具使用强制 | `agent.tool_use_enforcement` | str/bool/list | `auto` | auto/true/false/模型子串列表 | 引导模型真调用工具而非描述 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 执行纪律块 | `agent.execution_guidance` | 同上 | `auto` | — | 执行纪律系统提示块 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 意图确认续跑 | `agent.intent_ack_continuation` | 同上 | `auto` | — | 「只说不做」时注入继续推动 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 反停滞守卫 | `agent.stall_guards` | bool | `true` | — | 同参同果循环断路器+继续意图扩展 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 完成指导块 | `agent.task_completion_guidance` | bool | `true` | — | 「把活干完」提示块 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 并行工具引导 | `agent.parallel_tool_call_guidance` | bool | `true` | — | 引导只读工具并入一个批次 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 环境探测 | `agent.environment_probe` | bool | `true` | — | pip/uv/PEP-668 异常才出现在系统提示 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 停机验证 | `agent.verify_on_stop` | bool/str | `false` | true/false/auto；env HERMES_VERIFY_ON_STOP 优先 | 编辑代码后无新鲜验证则拒绝收尾 | config.yaml | — | 否 | 否 | 新会话 | 【D】【E】 |
| 验证指导 | `agent.verify_guidance` | bool | `true` | — | verify-on-stop 附 UI/清洁 diff 提示 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 验证推动上限 | `agent.max_verify_nudges` | int | `3` | — | pre_verify 钩子可推动继续的上限 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 工具搜索 | `tools.tool_search.enabled/threshold_pct/search_default_limit/max_search_limit/listing/listing_max_tokens/defer` | — | `auto`/`5`/`5`/`25`/`auto`/`4000`/内建冷工具表 | — | 大量工具时代理桥接按需呈现 | config.yaml | — | 否 | 否 | 新会话 | 【D】 |
| 连接器 | `tools.connectors.enabled` | bool | `true` | — | Nous 工具网关连接器 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| LSP 诊断 | `lsp.enabled / wait_mode / wait_timeout / warmup_timeout / broken_retry_seconds / exclude_roots / install_strategy / package_manager / idle_timeout / servers` | — | `true`/`document`/`5.0`/`0.0`/`0.0`/`[]`/`auto`/`npm`/`600.0`/`{}` | — | write_file/patch 后置 Lint 的 LSP 诊断 | config.yaml | — | servers.env 可能含凭据（是） | 否 | 重启 | 【D】 |

## 8. Browser / Web Search / MCP / Code Execution

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 浏览器后端 | `browser.backend` | str | `""`（自动：browser-use 可用则用之） | ""/browser-use/off | 浏览器驱动模式 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 闲置超时 | `browser.inactivity_timeout` | int | `120` | 秒 | 会话闲置自动关闭 | config.yaml | `120`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 命令超时 | `browser.command_timeout` | int | `30` | 秒 | 单浏览器命令超时 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 快照阈值 | `browser.snapshot_threshold` | int | `15000` | ≥1000 字符 | 快照截断入库阈值 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 会话录制 | `browser.record_sessions` | bool | `false` | — | 自动录制 WebM | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 有头模式 | `browser.headed` | bool | `false` | — | 可见 Chromium 窗口 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 私网访问 | `browser.allow_private_urls` | bool | `false` | — | 允许 localhost/内网 IP | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 本地引擎 | `browser.engine` | str | `auto` | auto/lightpanda/chrome | 本地浏览器引擎 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 私网本地回退 | `browser.auto_local_for_private_urls` | bool | `true` | — | 云后端遇 LAN URL 自动本地 Chromium | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| CDP 端点 | `browser.cdp_url` | str | `""` | URL | 附着既有 Chromium | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 真实 profile | `browser.use_real_profile` | bool | `false` | — | 同意后用真实登录快照浏览 | config.yaml | — | 凭据在快照（是） | 否 | 重启 | 【D】 |
| profile 自动关闭 | `browser.real_profile_autoclose` | bool | `false` | — | Windows 锁定 profile 时征询后关闭 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| profile 固定 | `browser.real_profile_pin` | str | `""` | 目录名 | 指定快照源 profile（缺失即失败关闭） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| JS 守卫 | `browser.restrict_evaluate / allow_unsafe_evaluate` | bool | `false`/`false` | — | console 求值敏感原语黑名单 | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 对话框策略 | `browser.dialog_policy / dialog_timeout_s` | str/int | `must_respond`/`300` | must_respond/auto_dismiss/auto_accept | CDP 对话框监督 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Camofox | `browser.camofox.*` | dict | `{managed_persistence:false, …}` | — | 反检测浏览身份 | config.yaml | — | CAMOFOX_API_KEY 走 env（是） | 否 | 重启 | 【D】 |
| 扩展控制 | `browser.extension_control.enabled / developer_mode` | bool | `false`/`false` | — | 认证扩展接管浏览器；特权能力门 | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| Web 后端 | `web.backend / search_backend / extract_backend` | str | `""` | 空/searxng/native/… | 搜索与抓取后端 | config.yaml | — | 后端 key 走 env（是） | 否 | 重启 | 【D】 |
| 抓取字符上限 | `web.extract_char_limit` | int | `15000` | 字符 | web_extract 每页预算 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 免钥回退环 | `web.keyless_fallback / keyless_rescue / provider_tier` | bool/dict | `true`/`true`/`{}` | — | 无 key 免费层轮换与单次救援 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Web 缓存 | `web.cache_enabled / cache_ttl_minutes / cache_exempt_hosts` | bool/int/list | `true`/`20`/`[]` | — | 搜索/抓取 TTL 缓存与豁免 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| MCP 服务器 | `mcp_servers.<name>` | dict | 未设 | stdio: command/args/env；http: url/headers | 外部 MCP 工具接入 | config.yaml | 未覆写（本机无 mcp_servers 段） | env/headers 可含凭据（是） | 是（/reload-mcp，确认后） | 否 | 【E】 |
| ↳ 每服务器选项 | `mcp_servers.<name>.timeout / connect_timeout / keepalive_interval / lazy / sampling.*` | — | `120`/`60`/HTTP 180（stdio 关）/`false`/`{enabled:true,…}` | — | 超时、保活、惰性注册、采样 | config.yaml | — | 同上 | 否 | 重启 | 【E】 |
| MCP 热重载 | `mcp.auto_reload_on_config_change` | bool | `true` | — | config 变化自动重建（失效 prompt cache） | config.yaml | — | 否 | 是（/reload-mcp） | 否 | 【D】 |
| MCP 发现并发 | `mcp.discovery_concurrency` | int | `4` | 0=不限 | 单次发现最多连接数 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| MCP 发现超时 | `mcp_discovery_timeout / mcp_single_query_discovery_timeout` | float | `1.5`/`15.0` | 秒 | 首建/单查询模式等待发现的窗口 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 代码执行模式 | `code_execution.mode` | str | `project` | project/strict | execute_code 运行环境 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 代码执行超时 | `code_execution.timeout` | int | `300` | 秒 | 脚本超时击杀 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 代码执行调用上限 | `code_execution.max_tool_calls` | int | `50` | — | 每次脚本 RPC 工具调用上限 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 内核回收 | `code_execution.kernel_idle_timeout / max_session_kernels` | int | `1800`/`4` | — | 会话内核闲置回收与 LRU 上限 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| X 搜索 | `x_search.model / reasoning_effort / timeout_seconds / retries` | — | `grok-4.5`/`null`/`180`/`2` | — | xAI x_search 工具（有凭据+工具启用才注册） | config.yaml | — | XAI_API_KEY 走 env（是） | 否 | 重启 | 【D】 |

## 9. Delegation / Orchestrator / Worktree / MoA

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 子代理模型 | `delegation.model` | str | `""`（继承父） | 模型 id | 子代理模型固定 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 子代理提供方 | `delegation.provider` | str | `""`（继承父） | provider id | 子代理提供方固定 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 子代理回退链 | `delegation.fallback_providers` | list/null | `null`（继承）；`[]`=禁用 | 同顶层回退链 | 子代理回退 | config.yaml | — | 条目可含 api_key（是） | 否 | 重启 | 【D】【E】 |
| 子代理端点 | `delegation.base_url / api_key / api_mode` | str | `""`/`""`/`""` | — | 子代理直连 OpenAI 兼容端点 | config.yaml | — | api_key=**是** | 否 | 重启 | 【D】 |
| 子代理请求覆盖 | `delegation.request_overrides` | dict | `{}` | — | 每子代理 API kwargs（extra_body 深合并） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 子代理压缩上限 | `delegation.compression_threshold_tokens` | int | `0` | ≥16000 启用 | 子代理压缩触发绝对上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| MCP 工具集继承 | `delegation.inherit_mcp_toolsets` | bool | `true` | — | 收窄子代理工具集时保留 MCP | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 子代理迭代上限 | `delegation.max_iterations` | int | `250` | — | 每个子代理自己的回合预算 | config.yaml | `250`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 子代理摘要上限 | `delegation.max_summary_chars` | int | `24000` | 0=关 | 结果摘要字符硬顶（溢出落盘） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 子代理超时 | `delegation.child_timeout_seconds` | int | `0`（不限，下限 30） | 秒 | 无进展不活跃上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 子代理力度 | `delegation.reasoning_effort` | str | `""`（继承） | ultra…none | 子代理思考力度 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 子代理并发 | `delegation.max_concurrent_children` | int | `10`（下限 1，无上限） | — | 批内并行子代理上限 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 独立完成返回 | `delegation.independent_completions` | bool | `false` | — | 后台扇出逐任务回报 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 派生深度 | `delegation.max_spawn_depth` | int | `1` | 1-3 | 编排器嵌套深度 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 编排器开关 | `delegation.orchestrator_enabled` | bool | `true` | — | role=orchestrator 子代理总开关 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 一次性运行子代理上限 | `delegation.oneshot_max_children` | int | `2` | 0=不限 | -q 运行可派生数 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 子代理自动审批 | `delegation.subagent_auto_approve` | bool | `false` | — | 危险命令审批：false=自动拒绝/true=批准一次 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 子代理进程通知 | `delegation.surface_child_process_notifications` | bool | `false` | — | 子代理后台进程通知路由给父 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Git worktree 隔离 | `worktree` / `worktree_sync` | bool | `false`/`true` | — | 每会话隔离 worktree；从远端 tip 开分支 | config.yaml | 未覆写 | 否 | 是（-w 旗标） | 否 | 【E】 |
| MoA 混合代理 | `moa.default_preset / active_preset / save_traces / trace_dir / privacy_filter / presets` | — | `default`/`""`/`false`/`""`/`""`/内建 default 预设 | privacy_filter: ""/display/full | /moa 参考模型+聚合器 | config.yaml | — | presets 条目可含凭据（是） | 是（/moa） | 否 | 【D】 |
| 目标循环 | `goals.max_turns` | int | `20` | — | /goal 续跑上限（自动暂停） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 会话内循环 | `loops.min_interval_seconds / max_ticks / self_paced_floor_seconds / self_paced_ceiling_seconds` | int | `30`/`100`/`60`/`900` | — | /loop 节奏与上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |

## 10. Approval / Deny Rules（审批与拒绝规则）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 审批模式 | `approvals.mode` | str | `smart` | manual/smart/off | 危险命令审批策略 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】 |
| 审批超时 | `approvals.timeout` | int | `300` | 秒 | 未应答即失败关闭 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】 |
| cron 审批 | `approvals.cron_mode` | str | `deny` | deny/approve | cron 命中危险命令的行为 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】 |
| 单查询审批 | `approvals.single_query_mode` | str | `deny` | deny/approve | -q 会话危险命令行为 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】 |
| 无人值守审批 | `approvals.unattended_mode` | str | `deny` | deny/approve | webhook/api_server 等平台行为 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】 |
| smart 策略补充 | `approvals.smart_policy` | str | `""` | 文本 | 附加到审批守卫系统提示 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 拒绝熔断 | `approvals.denial_breaker_threshold` | int | `3` | 0=关 | 连续拒绝后升级硬停 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 拒绝规则 | `approvals.deny` | list | `[]` | fnmatch 通配（大小写不敏感） | 匹配即拒绝，--yolo 也拦 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| MCP 重载确认 | `approvals.mcp_reload_confirm` | bool | `true` | — | /reload-mcp 先确认 | config.yaml | 未覆写 | 否 | 是（Always Approve→false） | 否 | 【D】 |
| 破坏性命令确认 | `approvals.destructive_slash_confirm` | bool | `true` | — | /clear /new /reset /undo 确认 | config.yaml | 未覆写 | 否 | 是（Always Approve→false） | 否 | 【D】 |
| 永久允许清单 | `command_allowlist` | list | `[]` | 命令模式 | 「always」审批追加的永久放行 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 快捷命令 | `quick_commands` | dict | `{}` | 名称→命令（type 仅 exec） | 绕过 agent 循环直接执行 | config.yaml | — | 命令本体视内容（否/是） | 否 | 重启 | 【D】 |
| 审批呈现通道 | `security.approval.transport / transport_fallback` | str | `builtin`/`deny` | transport：builtin/插件名；fallback：deny/builtin | 审批 UI 传输与失败策略 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| Computer Use 权限 | `computer_use.permission_mode / capability_manifest` | str | `standard`/`""` | standard/bounded（unrestricted 仅会话级） | cua-driver 审批边界 | config.yaml | — | 否 | 否 | 重启 | 【D】 |

## 11. Security / Redaction（安全与脱敏）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 私网请求 | `security.allow_private_urls` | bool | `false` | — | 允许请求内网 IP | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 代理 fake-ip 段 | `security.fake_ip_ranges` | list | `[]` | CIDR | Clash/Mihomo 哨兵段放行 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 密钥脱敏 | `security.redact_secrets` | bool | `true` | — | 输出中的凭据脱敏 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 训练档确认 | `security.allow_data_training_tiers_noninteractive` | bool | `false` | — | 无人值守使用可训练档的确认 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 受保护指令文件 | `security.protected_instruction_files / protected_instruction_extra_patterns` | bool/list | `true`/`[]` | fnmatch | AGENTS.md/CLAUDE.md/SOUL.md 写入必人审 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| tirith 扫描 | `security.tirith_enabled / tirith_path / tirith_timeout / tirith_fail_open` | bool/str/int | `true`/`tirith`/`5`/`true` | — | 预执行命令安全扫描（同形 URL、管道投毒等） | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 网站黑名单 | `security.website_blocklist` | dict | `{enabled:false, domains:[], shared_files:[]}` | — | 浏览/抓取域名拦截 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 已确认通告 | `security.acked_advisories` | list | `[]` | 通告 id | 供应链通告确认（hermes doctor --ack） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 懒安装 | `security.allow_lazy_installs` | bool | `true` | — | 首用后端时从 PyPI 拉包 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| PII 脱敏 | `privacy.redact_pii` | bool | `false` | — | 电话剥除、用户/聊天 ID 哈希后才送模型 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| MoA 隐私过滤 | `moa.privacy_filter` | str | `""` | ""/display/full | 顾问输出 PII/凭据脱敏 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 出口凭据代理 | `proxy.enabled / tunnel_port / auto_install / credential_source / enforce_on_docker / allow_env_fallback / upstream_deny_cidrs / extra_allowed_hosts` | — | `false`/`9090`/`true`/`env`/`true`/`false`/`null`/`[]` | credential_source: env/bitwarden | iron-proxy 出口注入（沙箱只见代币） | config.yaml | — | 代理凭据（是） | 否 | 重启 | 【D】 |
| 凭据保险库 | `vault.onepassword.enabled/account/binary_path/service_account_token_env`、`vault.bitwarden.*` | — | `true`/`""`/`""`/`OP_SERVICE_ACCOUNT_TOKEN`；`true`/`""` | — | browser_vault 可用的登录源 | config.yaml | — | 主密码交互提示，headless 锁定（是） | 否 | 重启 | 【D】 |
| 外部密钥源-BSM | `secrets.bitwarden.enabled/access_token_env/project_id/server_url/cache_ttl_seconds/encrypted_cache/override_existing/auto_install` | — | `false`/`BWS_ACCESS_TOKEN`/`""`/`""`/`300`/`{false,0}`/`true`/`true` | — | Bitwarden Secrets Manager 启动同步 | config.yaml | 未覆写 | bootstrap token 走 env（是） | 否 | 重启 | 【D】【E】 |
| 外部密钥源-1Password | `secrets.onepassword.enabled/env/account/service_account_token_env/binary_path/cache_ttl_seconds/override_existing` | — | `false`/`{}`/`""`/`OP_SERVICE_ACCOUNT_TOKEN`/`""`/`300`/`true` | env: VAR→op:// 引用 | op CLI 启动解析 | config.yaml | 未覆写 | op:// 引用指向凭据（是） | 否 | 重启 | 【D】【E】 |
| 密钥源顺序 | `secrets.sources` | list | 注册顺序 | 源名列表 | 显式排序 | config.yaml | — | 否 | 否 | 重启 | 【E】 |

## 12. Checkpoint（文件检查点 / 回滚）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 检查点开关 | `checkpoints.enabled` | bool | `false` | — | 每回合首写前快照工作目录；/rollback 恢复 | config.yaml | — | 否 | 是（--checkpoints） | 新会话 | 【D】 |
| 快照上限 | `checkpoints.max_snapshots` | int | `20` | — | 每工作目录快照数 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 总大小上限 | `checkpoints.max_total_size_mb` | int | `500` | 0=关 | ~/.hermes/checkpoints 硬顶 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 单文件上限 | `checkpoints.max_file_size_mb` | int | `10` | 0=不过滤 | 跳过数据集/模型权重 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 自动修剪 | `checkpoints.auto_prune / retention_days / min_interval_hours` | bool/int | `true`/`7`/`24` | — | 后台清扫过期项目（绝不删孤儿） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 压缩前置检查点 | `compression.checkpoint_required` | bool | `false` | — | 见第 6 节（同键交叉引用） | config.yaml | `false` | 否 | 否 | 重启 | 【D】【E】 |

## 13. TTS / STT / Voice / Wake Word

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TTS 提供方 | `tts.provider` | str | `edge` | edge/elevenlabs/openai/xai/minimax/mistral/gemini/deepinfra/neutts/kittentts/piper | 语音合成 | config.yaml | 未覆写 | 云提供方 key 走 env（是） | 否 | 重启 | 【D】 |
| TTS 流式首句 | `tts.streaming.min_len` | int | `20` | 字符 | 最短独立播报首句 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Edge 语音 | `tts.edge.voice` | str | `en-US-AriaNeural` | — | 免费 Edge TTS 声音 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| OpenAI TTS | `tts.openai.model/voice/consent_attestation/pcm_sample_rate` | — | `gpt-4o-mini-tts`/`alloy`/`""`/`24000` | — | OpenAI 语音 | config.yaml | — | key 走 env（是） | 否 | 重启 | 【D】 |
| ElevenLabs | `tts.elevenlabs.voice_id/model_id` | str | `pNInz6obpgDQGcFmaJgB`/`eleven_multilingual_v2` | — | — | config.yaml | — | key 走 env（是） | 否 | 重启 | 【D】 |
| Gemini TTS | `tts.gemini.model/voice/audio_tags/persona_prompt_file` | — | `gemini-2.5-flash-preview-tts`/`Kore`/`false`/`""` | — | 3.1 支持 [audio tags] 隐式改写 | config.yaml | — | key 走 env（是） | 否 | 重启 | 【D】【E】 |
| xAI TTS | `tts.xai.*` | — | voice_id `eve`、language `en`、speed `1.0`、auto_speech_tags `false`、optimize_streaming_latency `0`、sample_rate `24000`、bit_rate `128000` | — | — | config.yaml | — | key 走 env（是） | 否 | 重启 | 【D】【E】 |
| Mistral/MiniMax/KittenTTS/NeuTTS/Piper/DeepInfra | `tts.mistral / minimax / kittentts / neutts / piper / deepinfra` | dict | 各自默认（见源码） | — | 其余提供方 | config.yaml | — | key 走 env（是） | 否 | 重启 | 【D】 |
| TTS 交付上限 | `tts.delivery_profiles.<platform>` | dict | 内建：discord 10MiB、telegram 50MiB、其余 10MiB，safety_ratio 0.85 | max_file_bytes/safety_ratio | 每平台音频上传上限 | config.yaml | — | 否 | 否 | 重启 | 【E】 |
| STT 开关 | `stt.enabled` | bool | `true` | — | 语音消息自动转写 | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| STT 回显 | `stt.echo_transcripts` | bool | `true` | — | 🎙️ 回显原始转写 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| STT 提供方 | `stt.provider` | str | 未设（自动阶梯） | local/groq/openai/mistral/elevenlabs/deepinfra | 未设即自动检测 | config.yaml | 未覆写 | 云提供方 key 走 env（是） | 否 | 重启 | 【D】【E】 |
| STT 全局语言 | `stt.language` | str | `en` | ""=自动；es/zh/… | Whisper 短clip误判防护 | config.yaml | `en`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 云端静音修剪 | `stt.cloud_trim_silence / cloud_trim_threshold_db / cloud_trim_keep_ms` | — | `true`/`-40`/`300` | — | ffmpeg 客户端修剪（失败传原始） | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 本地 Whisper | `stt.local.model/language/initial_prompt/vad/vad_min_silence_ms/no_speech_prob_threshold/logprob_threshold/unload_after_idle_seconds` | — | `base`/`""`/`""`/`true`/`500`/`0.6`/`-1.0`/`0` | model: tiny…large-v3/turbo | faster-whisper 反幻觉加固 | config.yaml | `base`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| Groq/OpenAI/Mistral STT | `stt.groq.* / stt.openai.* / stt.mistral.*` | — | `whisper-large-v3-turbo` / `whisper-1`、timeout 60、max_retries 1 / `voxtral-mini-latest` | — | 云转写 | config.yaml | openai 块未改 | key 走 env（是） | 否 | 重启 | 【D】【E】 |
| 语音会话模式 | `voice.voice_chat_mode` | str | `chained` | chained/gpt-live | STT→Hermes→TTS 或 GPT-Live 全双工 | config.yaml | — | gpt-live 需 OpenAI key（是） | 否 | 重启 | 【D】 |
| GPT-Live | `voice.gpt_live.model/voice/instructions` | — | `gpt-live-1`/`marin`/`""` | — | 全双工语音模型 | config.yaml | — | api_key 可选覆盖（是） | 否 | 重启 | 【D】 |
| 录音键 | `voice.record_key` | str | `ctrl+b` | — | TUI 录音快捷键 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 提交方式 | `voice.submit_mode` | str | `direct` | direct/draft | 直接提交或可编辑草稿 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 最长录音 | `voice.max_recording_seconds` | int | `120` | 秒 | — | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 自动 TTS | `voice.auto_tts` | bool | `false` | — | 回复自动朗读 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 客户端直连 | `voice.client_direct` | bool | `true` | — | 桌面远程客户端直连 STT/TTS 提供方 | config.yaml | — | 凭据经认证 REST 下发（是） | 否 | 重启 | 【D】 |
| 提示音 | `voice.beep_enabled / beep_volume / thinking_sound` | bool/float | `true`/`0.3`/`true` | — | 录音提示与思考音 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 静音检测 | `voice.silence_threshold / silence_duration` | int/float | `200`/`3.0` | — | RMS 静音阈值与自动停 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 打断 | `voice.barge_in / barge_in_grace_seconds / barge_in_threshold_multiplier / stop_phrases` | — | `true`/`0.5`/`3.0`/`["stop"]` | — | 说话即中断代理/TTS | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 唤醒词 | `wake_word.enabled / surface / input_device / capture / provider / phrase / sensitivity / confirmation_frames / start_new_session / profile_routing / openwakeword.* / sherpa.* / porcupine.*` | — | `false`/`auto`/`null`/`auto`/`openwakeword`/`hey hermes`/`0.6`/`3`/`true`/`true`/… | provider: openwakeword/sherpa/porcupine | 「Hey Hermes」免提 | config.yaml | — | PORCUPINE_ACCESS_KEY 走 env（是） | 是（/wake） | 否 | 【D】【E】 |

## 14. Display / Language / Theme

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 紧凑横幅 | `display.compact` | bool | `false` | — | 单行横幅 | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 个性 | `display.personality` | str | `""` | 内建或自定义名 | 活跃人格（经 /personality） | config.yaml | — | 否 | 是（/personality） | 否 | 【D】 |
| 自定义人格 | `agent.personalities` | dict | `{}` | name→prompt 或 {system_prompt,tone,style} | 追加/覆盖内建人格 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 工具进度 | `display.tool_progress` | str | `all` | off/new/all/verbose/log | 工具活动显示级别 | config.yaml | `all`（未改） | 否 | 是（/verbose） | 否 | 【D】【E】 |
| 进度气泡清理 | `display.cleanup_progress` | bool | `false` | — | 终答后删除进度气泡（Telegram） | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【E】 |
| 中途助手消息 | `display.interim_assistant_messages` | bool | `true` | — | 中途叙述保留/发送 | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 警告通知抑制 | `display.suppress_warning_notifications` | bool | `false` | — | 隐藏自动告警（结果/审批永不隐藏） | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 长时心跳 | `display.long_running_notifications` | bool | `true` | — | 「⏳ Working — N min」心跳 | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【E】 |
| 忙碌确认详情 | `display.busy_ack_detail` | bool | `true` | — | 忙 ack 带迭代/工具上下文 | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【E】 |
| 忙碌输入 | `display.busy_input_mode` | str | `interrupt` | interrupt/queue/steer | 忙时回车行为 | config.yaml | `interrupt`（未改） | 否 | 是（/busy） | 否 | 【D】【E】 |
| 转向确认 | `display.busy_steer_ack_enabled` | bool | `true` | — | steer 气泡显示 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 多行快捷键 | `display.cli_multiline_shortcuts` | bool | `true` | — | Ctrl+J 等多行输入 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 默认界面 | `display.interface` | str | `cli` | cli/tui | `hermes` 启动界面 | config.yaml | — | 否 | 是（--cli/--tui） | 否 | 【D】 |
| TUI 自动恢复 | `display.tui_auto_resume_recent / resume_last_session / tui_agents_nudge` | bool | `false`/`true`/`true` | — | 恢复最近会话/子代理提示 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 恢复展示 | `display.resume_display / resume_exchanges / resume_max_user_chars / resume_max_assistant_chars / resume_max_assistant_lines / resume_skip_tool_only` | — | `full`/`10`/`300`/`200`/`3`/`true` | — | /resume 概要 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 完成铃 | `display.bell_on_complete / bell_on_prompt` | bool | `false`/`false` | — | 终答/阻塞提示响铃 | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 思考显示 | `display.show_reasoning / reasoning_full` | bool | `true`/`false` | — | 推理框展示 | config.yaml | `true`（未改） | 否 | 是（/reasoning） | 否 | 【D】【E】 |
| 记忆通知 | `display.memory_notifications` | str | `on` | off/on/verbose | 后台自我改进通知 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 后台进程通知 | `display.background_process_notifications` | str | `concise` | concise/off/result/error/all | terminal(background) 完成通知 | config.yaml | `concise`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| CLI 流式渲染 | `display.streaming` | bool | 代码默认 `false`（【E】示例写 true） | — | 终端逐行流式 | config.yaml | `true`（示例值） | 否 | 否 | 重启 | 【D】【E】 |
| 时间戳 | `display.timestamps / timestamp_format` | bool/str | `false`/`%H:%M` | strftime | 消息时间戳 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| Markdown 渲染 | `display.final_response_markdown` | str | `strip` | render/strip/raw | 终答 markdown 处理 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 输出保留 | `display.persistent_output / persistent_output_max_lines / cli_rebuild_scrollback_on_redraw / persist_prompts` | — | `true`/`200`/`false`/`true` | — | 重绘时保留滚回 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 内联 diff | `display.inline_diffs / file_mutation_verifier` | bool | `true`/`true` | — | 写文件 diff 预览与失败提示 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 积分通知 | `display.credits_notices` | bool | `true` | — | Nous 积分状态通知 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 空回复解释 | `display.turn_completion_explainer` | bool | `true` | — | 空回复附原因行 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 成本/电池 | `display.show_cost / battery` | bool | `false`/`false` | — | 状态栏成本/电量 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 专注视图 | `display.focus_view / focus_saved_tool_progress` | bool/str | `false`/`all` | — | /focus 显示模式（仅显示层） | config.yaml | — | 否 | 是（/focus） | 否 | 【D】 |
| 皮肤 | `display.skin` | str | `default` | default/ares/mono/slate/daylight/warm-lightmode/poseidon/sisyphus/charizard/自定义 | 主题皮肤 | config.yaml | — | 否 | 是（/skin） | 否 | 【D】【E】 |
| 界面语言 | `display.language` | str | `en` | en/zh/ja/de/es/fr/tr/uk | 静态消息语言（非 agent 回复） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| TUI 指示器 | `display.tui_status_indicator` | str | `kaomoji` | kaomoji/emoji/unicode/ascii | 忙碌指示样式 | config.yaml | — | 否 | 是（/indicator） | 否 | 【D】 |
| CLI 刷新 | `display.cli_refresh_interval` | float | `1.0` | 秒；0=关 | 闲置重绘间隔 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Vim 模式 | `display.vim_mode` | bool | `false` | — | 输入编辑器 vi 键位 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 用户消息回显 | `display.user_message_preview.first_lines / last_lines` | int | `2`/`2` | — | 提交行回显 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 评论通道 | `display.show_commentary` | bool | `true` | — | Codex commentary 作为中途更新 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 消息网关 /verbose | `display.tool_progress_command` | bool | `false` | — | 聊天平台开 /verbose | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 预览长度/友好标签 | `display.tool_preview_length / friendly_tool_labels` | int/bool | `0`/`true` | — | 工具预览与拟人状态标签 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 回合小结 | `display.turn_summary / spinner_token_flow` | bool | `true`/`true` | — | CLI 回合耗时/改动小结 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 工具分组 | `display.tool_progress_grouping` | str | `accumulate` | accumulate/separate | 工具进度气泡合并 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 状态短语 | `display.status_phrases` | dict | `{}` | path/paths/mode | 自定义长时状态短语 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 推理样式 | `display.reasoning_style` | str | `code` | code/blockquote/subtext | 推理摘要渲染 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 系统通知 TTL | `display.ephemeral_system_ttl` | int | `0` | 秒 | 「新会话开始！」自动删除 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 平台显示覆盖 | `display.platforms.<platform>.*` | dict | telegram streaming=true，discord/slack=false，wecom=true | — | 每平台流式/清理等覆盖 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 运行时页脚 | `display.runtime_footer.enabled / fields` | — | `false`/`[model,context_pct,cwd]` | — | 终答页脚 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 状态栏字段 | `display.status_bar.fields` | list | `[]`（默认集） | model/context_pct/git_branch/… | CLI/TUI 状态栏可见字段 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 复制快捷键 | `display.copy_shortcut` | str | `auto` | auto/ctrl_c/ctrl_shift_c/disabled | 复制键位 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 宠物 | `display.pet.enabled/slug/render_mode/scale/unicode_cols` | — | `false`/`""`/`auto`/`0.33`/`0` | — | Petdex 吉祥物 | config.yaml | — | 否 | 是（hermes pets） | 否 | 【D】 |

## 15. Streaming（网关流式）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 流式总开关 | `streaming.enabled` | bool | `false` | — | 聊天平台逐 token 流式（官方注明启用后需重启网关） | config.yaml | `false`（未改） | 否 | 否 | **是（重启网关）** | 【D】【E】 |
| 传输方式 | `streaming.transport` | str | `auto` | auto/draft/edit/off | 原生草稿或渐进编辑 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 编辑间隔 | `streaming.edit_interval` | float | 代码 `0.8`（【E】示例 0.3） | 秒 | 渐进编辑最小间隔 | config.yaml | 示例值 0.3（注释态/生效值 0.8） | 否 | 否 | 重启 | 【D】【E】 |
| 缓冲阈值 | `streaming.buffer_threshold` | int | 代码 `24`（【E】示例 40） | 字符 | 强制 flush 字符数 | config.yaml | 示例值 40（注释态/生效值 24） | 否 | 否 | 重启 | 【D】【E】 |
| 光标 | `streaming.cursor` | str | ` ▉` | 字符串 | 流式光标 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 新鲜终稿 | `streaming.fresh_final_after_seconds` | float | `0.0` | 秒 | Telegram 预览可见超 N 秒终稿发新消息 | config.yaml | — | 否 | 否 | 重启 | 【D】 |

## 16. Discord / Telegram / Slack / WhatsApp / 其他平台

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Discord 必须提及 | `discord.require_mention` | bool | `true` | — | 服务器频道需 @mention | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| Discord 自由频道 | `discord.free_response_channels` | str | `""` | 频道 ID 逗号串 | 无需提及的频道 | config.yaml | `""`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| Discord 白名单 | `discord.allowed_channels / thread_require_mention` | str/bool | `""`/`false` | — | 频道白名单/线程提及 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Discord 自动线程 | `discord.auto_thread / free_response_auto_thread` | bool | `true`/`false` | — | @mention 建线程 | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| Bot 内联提及 | `discord.bots_require_inline_mention` | bool | `true` | — | bot 作者须字面 @thisbot | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| Discord 历史回填 | `discord.history_backfill / history_backfill_limit` | bool/int | `true`/`50` | — | 触发时回填频道滚回 | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| Discord 离线补递 | `discord.missed_message_backfill.*` | dict | `{enabled:false, window_seconds:21600, limit:100, max_dispatches:10, max_attempts:3}` | — | 重连后补投漏消息 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Discord 表情 | `discord.reactions` | bool | `true` | — | 👀/✅/❌ 处理表情 | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| Discord WS 探活 | `discord.websocket_liveness_interval_seconds / failure_threshold / heartbeat_ack_max_age_seconds / max_latency_seconds / event_max_silence_seconds` | — | `15`/`2`/`60`/`30`/`14400` | — | 网关传输健康探测 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Discord 频道提示 | `discord.channel_prompts` | dict | `{}` | — | 每频道临时系统提示 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Discord DM 角色认证 | `discord.dm_role_auth_guild` | str | `""` | guild id | DM 也可按角色授权 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Discord 管理动作 | `discord.server_actions` | str | `""`（全部） | 逗号动作表 | discord/discord_admin 工具允许动作 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Discord 附件 | `discord.max_attachment_bytes` | int | `33554432`（32MiB） | 0=不限 | 缓存附件上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Discord 审批 @ | `discord.approval_mentions` | bool | `false` | — | 审批时 @ 允许用户 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Discord 语音 | `discord.voice_channel_inactivity_timeout_seconds / voice_playback_timeout_seconds / voice_fx.*` | — | `300`/`120`/`{enabled:false,…}` | — | 语音频道停留/混音 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Telegram 白名单 | `telegram.allowed_chats` | str | `""` | chat ID 逗号串 | 仅应答这些群组 | config.yaml | `""`（未改） | 否 | 否 | 重启 | 【D】 |
| Telegram 表情/提示 | `telegram.reactions / channel_prompts` | bool/dict | `false`/`{}` | — | 处理表情与每 chat 提示 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Telegram 富消息 | `telegram.extra.rich_messages / rich_drafts / allow_cjk_rich_messages` | bool | `false`/`false`/`false` | — | Bot API 10.1 富消息（CJK 默认关） | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| Telegram 网关项 | `platforms.telegram.reply_to_mode / guest_mode / allowed_chats / extra.drop_pending_on_cold_boot / disable_link_previews / command_menu.*` | — | `first`/`false`/…/`true`/`false`/`{max_commands:60, priority_mode:prepend}` | reply_to_mode: off/first/all | 网关 Telegram 行为 | config.yaml | — | 否 | 否 | 重启 | 【E】 |
| Slack | `slack.require_mention / free_response_channels / allowed_channels / require_mention_channels / ignore_other_user_mentions / thread_require_mention / channel_prompts` | — | `true`/`""`/`""`/`""`/`false`/`false`/`{}` | — | Slack 行为 | config.yaml | — | SLACK_BOT_TOKEN/APP_TOKEN 走 env（是） | 否 | 重启 | 【D】 |
| Slack 网关项 | `platforms.slack.extra.native_task_cards / api_human_users / unfurl_links / unfurl_media` | — | `false`/`[]`/`false`/`false` | — | Slack 卡片与预览 | config.yaml | — | 否 | 否 | 重启 | 【E】 |
| WhatsApp | `whatsapp` 段 | dict | `{}`（reply_prefix：None=内建头） | — | WhatsApp 行为（凭据走 pairing，未读取） | config.yaml | 未覆写 | 配对凭据在 pairing/（是，未读取） | 否 | 重启 | 【D】 |
| Mattermost | `mattermost.*` | dict | 同 Slack 形态 | — | Mattermost 行为 | config.yaml | — | MATTERMOST_TOKEN 走 env（是） | 否 | 重启 | 【D】 |
| Matrix | `matrix.*` | dict | 同上 | — | Matrix 行为（E2EE 设备/恢复键走 env） | config.yaml | — | MATRIX_ACCESS_TOKEN/RECOVERY_KEY（是） | 否 | 重启 | 【D】 |
| 通用平台工具集 | `platform_toolsets.<platform>` | dict | cli/telegram/discord/whatsapp/slack/signal/homeassistant/qqbot/yuanbao/teams/google_chat 各自预设 | 预设名或工具集列表 | 每平台工具面 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【E】 |
| 平台提示覆盖 | `platform_hints` | dict | `{}` | append/replace | 每平台系统提示 hint | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 拟人延迟 | `human_delay.mode / min_ms / max_ms` | — | `off`/`800`/`2500` | mode: off/natural/custom | 消息分片间拟人延迟 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| API 服务器 | `platforms.api_server.enabled / extra.key / extra.model_routes` | — | env API_SERVER_ENABLED/KEY/PORT 8642/HOST | — | OpenAI 兼容 API 服务 | config.yaml | 未覆写 | extra.key=**是**（<redacted> 策略适用） | 否 | 重启 | 【E】 |

## 17. Group Session（群聊会话隔离）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 每用户会话 | `group_sessions_per_user` | bool | `true` | — | 群聊按参与者分 session（安全默认） | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【E】 |
| 并发会话上限 | `max_concurrent_sessions` | int/null | `null`（0/omit=不限） | 数字 | 全局活跃聊天会话上限（优先于 gateway.max_concurrent_sessions） | config.yaml | 空（=null，diff⑤） | 否 | 否 | 重启 | 【E】【D】 |
| 内存会话上限 | `max_live_sessions` | int | `16` | 0=关 | LRU 驻留上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 终端续接 | `session.terminal_continue` | bool | `true` | — | `hermes -c` 按终端恢复 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Bot Mode 中继 | `bot_mode.envelope_ttl_seconds / turn_wait_seconds` | int | `900`/`120` | — | 跨连接信封 TTL 与忙等 | config.yaml | — | 否 | 否 | 重启 | 【D】 |

## 18. Quick Commands（快捷命令）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 快捷命令 | `quick_commands` | dict | `{}` | name→{type: exec, …} | 绕过 agent 循环直接执行（仅 exec） | config.yaml | — | 命令内容自审 | 否 | 重启 | 【D】 |

（相关：`command_allowlist` 见第 10 节；shell 钩子 `hooks` / `hooks_auto_accept` 见下）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Shell 钩子 | `hooks.<event>` | list | `{}` | 事件: pre_tool_call/post_tool_call/pre_llm_call/post_llm_call/pre_api_request/post_api_request/on_session_start/on_session_end/on_session_finalize/on_session_reset/subagent_stop；条目 {matcher,command,timeout} | 脚本钩子（stdin JSON） | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 钩子自动接受 | `hooks_auto_accept` | bool | `false` | — | 非 TTY 免确认（或 --accept-hooks） | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 插件系统 | `plugins.hook_callback_timeout / load_timeout_seconds / allow_deprecated_imports / enabled / disabled` | — | `30`/`10`/`false`/（由 CLI 写） | — | 插件加载与兼容层 | config.yaml | — | 否 | 否 | 重启 | 【D】【C】 |

## 19. Database（数据库与存储）

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 日志模式 | `database.journal_mode` | str | `wal` | wal/delete | SQLite journal | config.yaml | `wal`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| WAL 检查点 | `database.wal_autocheckpoint / journal_size_limit` | int/null | `null`（SQLite 默认） | 页/字节 | WAL 尺寸 pragma | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 持久化级别 | `database.synchronous` | str/int | 未设（编译期默认） | OFF/NORMAL/FULL/EXTRA 或 0-3 | state.db durability | config.yaml | — | 否 | 否 | 重启 | 【E】 |
| fd 上限 | `runtime.nofile_soft_limit` | int | `4096` | 0/false/null=关 | 服务器进程 RLIMIT_NOFILE | config.yaml | `4096`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 会话自动修剪 | `sessions.auto_prune / retention_days / min_interval_hours` | — | `true`/`90`/`24` | — | 启动时清过期已结束会话 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 会话归档 | `sessions.auto_archive / auto_archive_days` | bool/int | `false`/`3` | — | 闲置软隐藏 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| VACUUM | `sessions.vacuum_after_prune / min_vacuum_interval_days` | bool/int | `true`/`30` | — | 修剪后回收磁盘（>25% 可回收才执行） | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| FTS 提示 | `sessions.fts_optimize_notice` | str | `advise` | advise/require/off | 紧凑 FTS 重建提示 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| CJK 索引 | `sessions.cjk_fts / search_slow_ms` | bool/int | `true`/`1000` | — | CJK bigram 索引与慢查询日志 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 转录护栏 | `sessions.max_resume_messages / max_export_messages` | int | `20000`/`20000` | 0=关 | 恢复/导出消息上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 文件日志 | `logging.level / max_size_mb / backup_count` | — | `INFO`/`5`/`3` | — | agent.log/errors.log 轮转 | config.yaml | — | 否 | 否 | 重启 | 【D】 |

## 20. Gateway / Session / Cache / Reconnect

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 中断宽限 | `gateway.signal_interrupt_grace_timeout` | int | `1` | 秒 | SIGTERM 后 agent 收尾宽限 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 投递台账 | `gateway.delivery_ledger` | bool | `true` | — | 至少一次投递（崩溃补投） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 平台连接超时 | `gateway.platform_connect_timeout` | int | `30` | 秒；0=无限 | 单平台启动/重连连接窗口 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 事件循环看门狗 | `gateway.loop_watchdog / _probe_interval_s / _probe_timeout_s / _max_strikes` | — | `true`/`30.0`/`10.0`/`3` | — | 卡死硬退 75 交服务管理器重启 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 允许所有用户 | `gateway.allow_all_users` | bool | `false` | — | 免允许清单（安全选项） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| bot 循环守卫 | `gateway.bot_loop_guard` | dict | `{enabled:true, max_events:20, window_seconds:300, cooldown_seconds:600}` | — | bot↔bot 死循环限流 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 启动看门狗 | `gateway.startup_watchdog / startup_watchdog_timeout_seconds` | bool/int | `true`/`300` | — | 启动活性硬退 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| sessions.json 镜像 | `gateway.write_sessions_json` | bool | `true` | — | 兼容旧工具/降级 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 多 profile 复用 | `gateway.multiplex_profiles / auto_multiplex_migration / profile_routes` | — | `true`/`true`/`[]` | — | 一网关承载全部 profile | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 缩容到零 | `gateway.scale_to_zero.idle_timeout_minutes` | int | `2` | — | Labs 开关下 relay 休眠 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 重启循环熔断 | `gateway.restart_loop_guard / respawn_storm` | dict | `{max_restarts:3, window_seconds:60, max_gap_seconds:300}`/`{max_starts:5, window_seconds:120}` | — | 自动恢复风暴熔断 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 消息时间戳 | `gateway.message_timestamps.enabled` | bool | `false` | — | 模型上下文加时间戳前缀 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 入站媒体上限 | `gateway.max_inbound_media_bytes` | int | `134217728`（128MiB） | 0=不限 | 防 OOM | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 代理信任环境 | `gateway.trust_env` | bool | `true` | — | HTTP_PROXY/系统代理自动检测 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 媒体严格投递 | `gateway.strict / media_delivery_allow_dirs / trust_recent_files / trust_recent_files_seconds` | — | `false`/`[]`/`true`/`600` | — | 防 prompt injection 外泄凭据文件 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 跨网关房间 | `gateway.room_link_url` | str | 未设（Desktop 协调） | 公网 HTTPS URL | Bot Mode 跨网关房间端点 | config.yaml | — | 否 | 否 | **是（重启网关）** | 【E】 |
| API 服务器并发 | `gateway.api_server.max_concurrent_runs / history_tool_output_max_chars` | int | `10`/`0` | — | 429 限流与历史工具输出钳制 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 网关代理模式 | `gateway.proxy_url`（env GATEWAY_PROXY_URL/KEY） | str | 未设 | URL | 平台 I/O 转发远端 Hermes | config.yaml | — | GATEWAY_PROXY_KEY=**是** | 否 | 重启 | 【E】 |
| Agent 缓存 | `agent.agent_cache.max_size / idle_ttl_secs / memory_high_mb / max_evictions_per_pass / protect_recent` | — | `128`/`3600`/`auto`/`16`/`8` | — | 网关每会话热 agent LRU | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 网关非活动超时 | `agent.gateway_timeout / gateway_timeout_warning / gateway_notify_interval / session_stall_timeout` | int | `1800`/`900`/`180`/`300` | 秒；0=关 | 空闲终止/预警/心跳/停滞通知 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 租约/澄清 | `agent.gateway_turn_lease_timeout / clarify_timeout` | int | `5`/`3600` | 秒 | 别名路由租约/clarify 阻塞上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 重启排水 | `agent.restart_drain_timeout / cron_drain_timeout / restart_after_turn_timeout / build_wait_timeout` | int | `0`/`30`/`1800`/`600` | 秒 | 停止/重启排水预算 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 重连关注阈值 | `agent.reconnect_attention_after` | int | `7200` | 秒；0=关 | 持续重连失败标记 needs_attention | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 自动继续新鲜度 | `agent.gateway_auto_continue_freshness / gateway_startup_restore_drain_timeout / gateway_startup_warmup_timeout` | int | `3600`/`30`/`20` | 秒 | 崩溃后续跑注释与启动门 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 本地流陈旧上限 | `agent.local_stream_stale_timeout` | int | `900` | 秒 | 本地端点陈旧检测上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 净化升级阈值 | `agent.sanitizer_heal_escalation_threshold` | int | `3` | 0=关 | 修复循环升级告警 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |

## 21. Updates / Backup / Rollback

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 更新检查 | `updates.check` | bool | `true` | — | 被动版本检查（显式 update 不受影响） | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 更新前备份 | `updates.pre_update_backup` | str | 代码默认 `quick`（【E】示例 false） | quick/full/off；legacy true/false | 更新前快照（>1GiB 跳过） | config.yaml | `false`（示例值） | 否 | 否 | 重启 | 【D】【E】 |
| 备份保留 | `updates.backup_keep` | int | `5` | ≥1 | 备份 zip 保留数 | config.yaml | `5`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 非交互本地改动 | `updates.non_interactive_local_changes` | str | `stash` | stash/discard | 更新时源码树改动处理 | config.yaml | `stash`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 停靠分支 | `updates.auto_switch_parked_branch / parked_branch_strategy` | bool/str | `true`/`switch` | strategy: switch/update_in_place | 特征分支更新策略 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| CUA 驱动刷新 | `updates.refresh_cua_driver` | bool | `true` | — | 更新时刷新 cua-driver（macOS） | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 回滚 | `checkpoints.*`（/rollback） | — | — | — | 文件级回滚见第 12 节 | config.yaml | — | 否 | — | — | 【D】 |

## 22. Network / Timezone / Onboarding / Dashboard

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 强制 IPv4 | `network.force_ipv4` | bool | `false` | — | 跳过 IPv6 避免挂起 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 时区 | `timezone` | str | `""`（服务器本地） | IANA 名（如 Asia/Shanghai） | 系统提示时区 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 引导提示 | `onboarding.seen` / `onboarding.profile_build` | dict/str | `{}`/`ask` | ask/off | 首次提示闩锁；档案构建询问 | config.yaml | `seen.openclaw_residue_cleanup: true`（diff⑥，本机唯一新增段） | 否 | 否 | 重启 | 【D】 |
| 仪表盘主题 | `dashboard.theme` | str | `default` | default/midnight/ember/mono/cyberpunk/rose | Web 仪表盘主题 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 回合隔离 | `dashboard.turn_isolation / compute_host_heartbeat_secs / compute_host_respawn_max` | bool/int | `false`/`15`/`3` | — | 进程隔离灰度控制 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| token 分析 | `dashboard.show_token_analytics` | bool | `false` | — | 本地下界估算展示 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 受信代理 | `dashboard.trusted_proxies` | list | `[]` | IP/CIDR | X-Forwarded-* 信任源 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| WS 保活 | `dashboard.ws_ping_interval / ws_ping_timeout / ws_orphan_reap_grace_s / ws_orphan_activity_stale_s` | float | `20.0`/`20.0`/`20.0`/`600.0` | — | WebSocket 保活与孤儿回收 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 启动孤儿清扫 | `dashboard.startup_orphan_sweep` | bool | `true` | — | 清理死网关遗留「active」行 | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| OAuth 门 | `dashboard.oauth.client_id / portal_url` | str | `""`/`""` | — | Nous Portal OAuth（--host 非回环时启用） | config.yaml | — | client_id 非密钥（否） | 否 | 重启 | 【D】【E】 |
| 自托管 OIDC | `dashboard.oauth.provider / self_hosted.issuer / client_id / scopes / client_secret` | str | — | — | 通用 OIDC 门 | config.yaml | — | client_secret=**是**（<redacted>，建议走 env） | 否 | 重启 | 【E】 |
| 基础认证 | `dashboard.basic_auth.username / password_hash / password / secret / session_ttl_seconds` | — | `""`×4/`0` | — | 用户名/密码门 | config.yaml | — | password/password_hash/secret=**是**（<redacted>） | 否 | 重启 | 【D】 |
| 排水认证 | `dashboard.drain_auth.scope / min_secret_chars` | str/int | `drain`/`43` | — | secret 走 env HERMES_DASHBOARD_DRAIN_SECRET | config.yaml | — | secret 走 env（是） | 否 | 重启 | 【D】 |
| 公共 URL | `dashboard.public_url` | str | `""` | 完整 authority | OAuth 回调基址（反代场景） | config.yaml | — | 否 | 否 | 重启 | 【D】【E】 |
| 医生探测超时 | `doctor.live_probe_timeout` | int | `10` | 秒 | hermes doctor --live 单探测 | config.yaml | — | 否 | 否 | 重启 | 【D】 |

## 23. Cron / Kanban

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 补跑错过任务 | `cron.catch_up_missed` | bool | `true` | — | false=计划停机后不补跑 | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| cron 自排程 | `cron.allow_agent_scheduling` | bool | `false` | — | cron agent 可用 cronjob 工具集 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| cron 预检 | `cron.preflight` | bool | `true` | — | 派发前校验凭据/技能/交付 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| cron 模型 | `cron.model / cron.model_provider` | str | `""` | — | cron 专用模型与提供方 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| cron 调度器 | `cron.provider / cron.chronos.*` | dict | `""`/内建 60s ticker | provider 名（如 chronos） | 调度触发器 | config.yaml | — | 无（agent 不持调度凭据） | 否 | 重启 | 【D】 |
| cron 交付 | `cron.wrap_response / delivery.notify / mirror_delivery` | — | `true`/`true`/`false` | — | 页脚包装、平台推送、可续投递 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| cron 并发/保留 | `cron.max_parallel_jobs / output_retention / script_timeout_seconds / session_db_timeout_seconds / media_send_timeout_seconds / failure_repeat_alert_hours` | — | `null`/`50`/`3600`/`10`/`300`/`6` | — | 并行、输出保留、各超时、告警抑制 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| cron 系统作用域 | `cron.require_restart_safe_scope` | bool | `false` | — | systemd 无 linger 时 fail-closed | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Kanban 订阅 | `kanban.auto_subscribe_on_create / notify_in_gateway` | bool | `true`/`true` | — | 创建即订阅事件/网关轮询投递 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 看板派发 | `kanban.dispatch_in_gateway / dispatch_interval_seconds / failure_limit / max_in_progress / max_in_progress_per_profile / dispatch_profiles` | — | `true`/`60`/`2`/`null`/`null`/`null` | — | 网关内派发器与并发上限 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 评审派发 | `kanban.review_dispatch` | bool | `true` | — | 评审列自动派 sdlc-review | config.yaml | `true`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 看板分解 | `kanban.auto_decompose / auto_decompose_per_tick / orchestrator_profile / default_assignee` | — | `true`/`3`/`""`/`""` | — | Triage 自动分解与画像 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 看板回收 | `kanban.dispatch_stale_timeout_seconds / reconcile_orphans / done_sub_retention_days / worker_log_rotate_bytes / worker_log_backup_count` | — | `14400`/`true`/`30`/`2097152`/`1` | — | 心跳回收/孤儿重排/日志轮转 | config.yaml | — | 否 | 否 | 重启 | 【D】 |

## 24. Telemetry / Monitoring

| UI 名称 | 官方 Key | 类型 | 默认值 | 可选值 | 作用 | 配置文件 | 本机值 | Secret | Runtime Change | Restart | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 共享指标-采集 | `telemetry.shared_metrics.enabled` | bool | `false` | — | 本地聚合计数采集（profile 自有选择，管理配置不可覆盖） | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 共享指标-发送 | `telemetry.shared_metrics.send` | bool | `false` | — | 独立发送同意（需 enabled） | config.yaml | `false`（未改） | 否 | 否 | 重启 | 【D】【E】 |
| 上报端点 | `telemetry.shared_metrics.endpoint` | str | `https://telemetry.nousresearch.com/v1/telemetry` | URL | 非 HTTPS 仅 localhost；不可 env 覆盖 | config.yaml | 未覆写 | 否 | 否 | 重启 | 【D】【E】 |
| 监控导出 | `monitoring.install_id / gateway_health_export.* / export.otlp.*` | — | `""`/`{enabled:false,…}`/`{enabled:false, endpoint:"", headers_env:{}}` | — | OTLP 健康导出（无内容数据） | config.yaml | — | headers_env 只存 env 变量名（否） | 否 | 重启 | 【D】 |
| CUA 遥测 | `computer_use.cua_telemetry` | bool | `false` | — | 默认关 cua-driver 上游 PostHog | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| Computer Use 其余 | `computer_use.native_wayland / max_image_dimension / capture_after_mode / ax_max_elements / no_overlay / allow_unsigned_driver` | — | `false`/`1456`/`som`/`200`/`null`/`false` | — | cua-driver 调优 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| 桌面应用 | `desktop.font_family / repo_scan_* / electron_flags / renderer_max_old_space_mb / ozone_platform_hint / disable_gpu / password_store / manage_launcher_entry / macos_signing_identity / auto_continue.*` | — | 见源码（font `""`、auto_continue enabled=true 等） | — | Hermes Desktop 启动项 | config.yaml | — | 否 | 否 | 重启 | 【D】 |
| llama.cpp 运行时 | `local_runtime.enabled / tag / backend / models_max / port / detect_ports` | — | `false`/`b10964`/`auto`/`4`/`0`/`[]` | backend: cuda/metal/vulkan/hip/cpu | 托管 llama-server | config.yaml | — | 否 | 否 | 重启 | 【D】 |

## 25. Auth（仅记 key 名——凭据本体在 auth.json / .env，未读取）

| Key 名 | 类型 | 说明 | Source |
|---|---|---|---|
| `auth.adopt_external_logins` | bool | 借用/刷新 Codex CLI 与 Claude Code 登录（其 refresh token 单次有效）。凭据本体在 auth.json，未读取。 | 【D】【E】 |
| `auth.codex_login_flow` | str | device_code（默认）/ browser（PKCE 回环回调）。 | 【D】【E】 |
| auth.json | — | 各 provider OAuth 凭据存储（agents/Hermes/auth.json）。**按安全规则未读取，不记录任何内容**。 | — |
| auth.lock | — | auth.json 锁文件。**未读取**。 | — |
| .env | — | 密钥环境变量文件。**未读取**；OPTIONAL_ENV_VARS（【D】）定义了全部可选密钥变量名（OPENROUTER_API_KEY、GOOGLE_API_KEY、TELEGRAM_BOT_TOKEN、DISCORD_BOT_TOKEN、SLACK_BOT_TOKEN、API_SERVER_KEY、BROWSERBASE_API_KEY、ELEVENLABS_API_KEY、MISTRAL_API_KEY、PORCUPINE_ACCESS_KEY、DAYTONA_API_KEY 等，均只记名称不记值）。 | 【D】 |

---

## 三、严格分离清单

### A. Hermes 原生配置（config.yaml 自有 key，全部归 Hermes 自治）

- 数据库/运行时：`database.*`、`runtime.nofile_soft_limit`、`logging.*`
- 模型：`model.*`、`providers.*`、`fallback_providers`、`fallback.*`、`model_aliases`、`model_overrides`、`models_dev.*`、`model_catalog.*`、`provider_routing`、`openrouter.*`、`bedrock.*`、`vertex.*`、`nous.*`、`timeouts.*`
- 辅助模型：`auxiliary.*`、`vision.*`
- 终端/沙箱：`terminal.*`、`code_execution.*`
- 记忆/技能：`memory.*`、`honcho`、`skills.*`、`curator.*`
- 上下文：`context.*`、`compression.*`、`context_file_max_chars`、`file_read_max_chars`、`prompt_caching.*`、`prefill_messages_file`
- 工具面：`tool_output.*`、`tool_budget.*`、`tool_loop_guardrails.*`、`tools.*`、`lsp.*`、`mcp_servers`、`mcp.*`、`platform_toolsets.*`
- 浏览器/Web：`browser.*`、`web.*`、`x_search.*`
- 委派/MoA：`delegation.*`、`worktree`、`worktree_sync`、`moa.*`、`goals.*`、`loops.*`
- 审批/安全：`approvals.*`、`command_allowlist`、`security.*`、`privacy.*`、`proxy.*`、`vault.*`、`secrets.*`
- 检查点：`checkpoints.*`
- 语音：`tts.*`、`stt.*`、`voice.*`、`wake_word.*`
- 显示：`display.*`、`agent.personalities`
- 流式：`streaming.*`
- 平台：`discord.*`、`telegram.*`、`slack.*`、`whatsapp`、`mattermost.*`、`matrix.*`、`platforms.*`、`platform_hints`、`human_delay.*`
- 会话/网关：`group_sessions_per_user`、`max_concurrent_sessions`、`max_live_sessions`、`session.*`、`sessions.*`、`gateway.*`、`agent.*`、`quick_commands`、`hooks`、`hooks_auto_accept`、`plugins.*`、`bot_mode.*`
- 更新/看板：`updates.*`、`dashboard.*`、`network.*`、`timezone`、`onboarding.*`、`cron.*`、`kanban.*`、`telemetry.*`、`monitoring.*`、`computer_use.*`、`desktop.*`、`local_runtime.*`、`doctor.*`、`auth.*`

### B. 聚合器配置（AI Agent 母盘 Launcher 侧，不属于 Hermes）

| 项 | 位置 | 值/说明 |
|---|---|---|
| agent id | `src/core/adapters/hermes.js` | `'hermes'` |
| 显示名 | 同上 | `displayName: 'Hermes'` |
| 图标 | — | **未在源码中定位**（adapter/base.js 无 icon 字段） |
| 启用开关 | `config/agents.json → hermes.enabled` | `true` |
| 启动命令 | `config/agents.json → hermes.command/args/cwd` | `hermes` / `[]` / `""`（便携模式覆写为 `agents\Hermes\bin\hermes.exe`，cwd=`agents\Hermes`） |
| 健康检查 | `config/agents.json → hermes.health`；adapter `versionArgs:['--version']`、`probe:null` | cli 探活 + --version |
| 启动模式 | adapter `mode: 'console'` | 必须真实控制台窗口（prompt_toolkit 限制），经 `Build\Scripts\start-hermes.ps1` 打开 cmd |
| 桌面 UI | adapter `open_ui()` | `hermes desktop` |
| 进程特征 | adapter `processSignature()` | `hermes.exe` |
| 转交目标 | `Launcher/App/renderer/src/components/chat/TransferDialog.tsx` | 无显式「优先级」配置：用户在转交对话框选择 targetId，推荐卡（RecommendationCard）预选推荐 agent |
| 模型块改写 | `Launcher/App/main.js → syncHermesModelConfig()`（HERMES_KEY_ENV='HERMES_LAUNCHER_API_KEY'） | 启动时仅改写 config.yaml 的 model 块（provider/base_url/key_env/default），其余段落不动 |

### C. 聚合器安全配置（凭据引用与注入，密钥值不落 Hermes 配置）

| 项 | 位置 | 说明 |
|---|---|---|
| 聚合器提供方凭据 | `config/providers.json → agnes.apiKey` | **Secret=是，值 `<redacted>`**（本文档从未记录其值） |
| 凭据注入通道 | `Launcher/App/main.js → buildAgentEnvExtra()` | 启动 Hermes 子进程时把 DPAPI 解密的明文 Key 放入环境变量 `HERMES_LAUNCHER_API_KEY`，**不写入 config.yaml** |
| 密钥变量名引用 | `agents/Hermes/config.yaml → model.key_env` | 值为变量**名** `HERMES_LAUNCHER_API_KEY`（非密钥） |
| HERMES_HOME 隔离 | `Build/Scripts/start-hermes.ps1` | `$env:HERMES_HOME = <root>\Agents\Hermes`，与机器级安装（D:\Hermes）隔离 |
| 配置备份 | `agents/Hermes/config.yaml.bak`、`config/providers.json.bak-20261003` | 存在备份文件；含密钥的备份应视为同等敏感 |
| 机读审计 | `Build/Audit/phase-11-hermes-provider-report.md` 等 | 记录「真实 Key 不写进 config.yaml」机制；phase-15 报告确认 HOST API KEY 未落入包 |

---

## 四、统计

| 指标 | 数值 | 说明 |
|---|---|---|
| 发现总数（主矩阵条目，第 1-24 节） | **451** | 每行均给出官方 Key、默认值与 Source |
| Auth 节 key 名条目 | 5 | 只记 key 名，不记值（auth.json/.env 未读取） |
| 聚合器清单条目（B+C） | 16 | B 聚合器配置 10 条 + C 聚合器安全配置 6 条 |
| **Secret 项数** | **58** | 主矩阵 Secret 列标「是」的条目（值级凭据、凭据引用通道、指向私钥/配对文件者）；文中一律 `<redacted>` 或只记机制 |
| Runtime 即时可改（slash 命令） | 15 | 如 /model、/verbose、/skin、/reasoning、/busy、/fast、/personality、/focus、/wake、/moa、/compress 等 |
| 明确需重启网关 | 2 | `streaming.enabled`（官方注明启用后重启）、`gateway.room_link_url` |
| 需重启/新会话生效 | 其余绝大多数 | 源码未标注热生效的键默认记「否（重启/新会话）」 |
| 未在源码中定位 | 2 | 聚合器侧「图标」字段；个别键的运行时可改性未标注 |
| 本机 config.yaml 与官方示例实际差异 | 6 | ① model.default ② model.provider ③ model.key_env ④ compression.codex_responses_compact_threshold（null→空） ⑤ max_concurrent_sessions（null→空） ⑥ onboarding.seen.openclaw_residue_cleanup（新增） |

### 各类别条数

| 类别 | 条数 | 类别 | 条数 |
|---|---|---|---|
| 1. Model/Provider/Fallback/Reasoning | 41 | 13. TTS/STT/Voice/Wake Word | 27 |
| 2. Auxiliary Models | 12 | 14. Display/Language/Theme | 47 |
| 3. Terminal/沙箱后端 | 36 | 15. Streaming | 6 |
| 4. Memory | 8 | 16. Discord/Telegram/Slack/WhatsApp 等 | 28 |
| 5. Skills | 15 | 17. Group Session | 5 |
| 6. Context/Compression | 29 | 18. Quick Commands | 4 |
| 7. Tool Output/Guardrails/Verify | 24 | 19. Database | 11 |
| 8. Browser/Web/MCP/Code Execution | 31 | 20. Gateway/Session/Cache/Reconnect | 26 |
| 9. Delegation/Orchestrator/Worktree | 22 | 21. Updates/Backup/Rollback | 7 |
| 10. Approval/Deny Rules | 14 | 22. Network/Timezone/Onboarding/Dashboard | 15 |
| 11. Security/Redaction | 16 | 23. Cron/Kanban | 13 |
| 12. Checkpoint | 6 | 24. Telemetry/Monitoring | 8 |

---

## 附：核验说明

- 版本与上游：`hermes-agent/pyproject.toml` 第 5 行 `version = "0.21.4"`；仓库 git HEAD `c0d7294`（与任务书 c0d72947 一致）。
- 默认值权威来源为 `hermes_cli/config_defaults.py` 的 `DEFAULT_CONFIG`（`_config_version: 46`）与 `cli-config.yaml.example`；两者冲突时已标注（如 `agent.max_turns` 代码默认 null/示例 500、`display.streaming` 代码 false/示例 true、`streaming.edit_interval` 代码 0.8/示例 0.3、`updates.pre_update_backup` 代码 quick/示例 false）。
- 本机 config.yaml 实质为官方示例的带值副本 + 6 处差异，无任何明文密钥；唯一密钥相关项 `model.key_env` 只引用环境变量名。
- COMPAT_MANIFEST.md（2026-09-14 移除的插件兼容层）只涉及一个 config 键：`plugins.allow_deprecated_imports`，已收录。
