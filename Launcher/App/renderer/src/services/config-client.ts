/**
 * 配置类 IPC 封装（preload.js 的 api-config:* / provider:* 部分）。
 *
 * 设计原则：
 *  - 所有函数都是 async 且永不抛异常：IPC 未注入或主进程抛错时返回 { ok:false, ... } 兜底，
 *    这样设置面板不会因为一次失败调用而白屏。
 *  - 这一层不做业务校验（"哪些字段必填"是主进程 validateFields 的职责），
 *    只做预设表相关的**纯展示逻辑**（baseUrl 反查预设）。
 */
import { ipc, safeInvoke } from './ipc'
import type {
  ApiConfigEntry,
  ApiConfigResult,
  FetchModelsPayload,
  FetchModelsResult,
  ModelCachePayload,
  ModelCacheResult,
  ProviderPreset,
  ProviderPresetsResult,
  SaveApiConfigPayload,
  SaveApiConfigResult,
  TestConnectionResult,
  TestProviderConnectionPayload,
  TestProviderConnectionResult,
  ValidateApiConfigFields,
  ValidateApiConfigResult,
} from '@/types/launcher'

/** IPC 不可用时的统一兜底文案 */
const NO_IPC = 'IPC 不可用（preload.js 未加载）'

// --- IPC 封装 ---------------------------------------------------------------

/** 读取四个 Agent 的配置（密钥只回掩码，永远拿不到明文） */
export function getApiConfig(): Promise<ApiConfigResult> {
  return safeInvoke('getApiConfig', () => ipc.getApiConfig(), { ok: false, error: NO_IPC })
}

/** 保存配置：非敏感字段写 user-config.json，apiKey 由主进程用 DPAPI 加密后单独存 */
export function saveApiConfig(payload: SaveApiConfigPayload): Promise<SaveApiConfigResult> {
  return safeInvoke('saveApiConfig', () => ipc.saveApiConfig(payload), { ok: false, reason: NO_IPC })
}

/** 清除某个 Agent 的 API Key（只删密钥文件，不动其他字段） */
export function clearApiKey(configId: string): Promise<{ ok: boolean; configured?: boolean; reason?: string }> {
  return safeInvoke('clearApiKey', () => ipc.clearApiKey(configId), { ok: false, reason: NO_IPC })
}

/** 纯本地字段校验（不发网络请求）；errors 里是字段名 */
export function validateApiConfig(fields: ValidateApiConfigFields): Promise<ValidateApiConfigResult> {
  return safeInvoke('validateApiConfig', () => ipc.validateApiConfig(fields), { ok: false, error: NO_IPC })
}

/** 读取 Provider 预设表（下拉要动态渲染，不硬编码厂商列表） */
export function getProviderPresets(): Promise<ProviderPresetsResult> {
  return safeInvoke('getProviderPresets', () => ipc.getProviderPresets(), { ok: false, error: NO_IPC })
}

/**
 * 连接测试：单次 GET {base}/models，10 秒超时，不重试。
 * anthropic-compatible 会返回 kind='blocked'（后端不猜端点、不发付费请求）。
 */
export function testConnection(configId: string): Promise<TestConnectionResult> {
  return safeInvoke('testConnection', () => ipc.testConnection(configId), {
    ok: false,
    kind: 'blocked',
    message: NO_IPC,
  })
}

/**
 * 用表单当前输入的值测试连接（POST responsesEndpoint，15s 超时）。
 * 与 testConnection 的区别（旧 UI 里也是两个独立按钮，别混用）：
 *  - testConnection：用磁盘上**已保存**的配置（只传 configId），GET /models，10s；
 *    对应旧 UI 的「验证连接」按钮（testConnBtn），负责回答"存下来的那份配置通不通"。
 *  - testProviderConnection：用**当前表单值**（传完整字段），POST /responses，15s；
 *    对应旧 UI 的「测试连接」按钮（testProvBtn），允许用户在保存前先验证一遍。
 * 两者都不自动重试。
 */
export function testProviderConnection(
  payload: TestProviderConnectionPayload,
): Promise<TestProviderConnectionResult> {
  return safeInvoke('testProviderConnection', () => ipc.testProviderConnection(payload), {
    ok: false,
    error: NO_IPC,
  })
}

/** 拉取模型列表：单次 GET modelsEndpoint，10 秒超时，成功后主进程写 24h 缓存 */
export function fetchModels(payload: FetchModelsPayload): Promise<FetchModelsResult> {
  return safeInvoke('fetchModels', () => ipc.fetchModels(payload), { ok: false, error: NO_IPC })
}

/** 读取模型缓存（24h TTL；过期返回 cached:false + expired:true） */
export function getModelCache(payload: ModelCachePayload): Promise<ModelCacheResult> {
  return safeInvoke('getModelCache', () => ipc.getModelCache(payload), { ok: false, error: NO_IPC })
}

// --- 预设回显（纯前端逻辑，方案 2） -----------------------------------------

/**
 * baseUrl 归一化：去首尾空白、去尾部斜杠、转小写。
 * 反查比对前必须过这一步，否则 https://API.OpenAI.com/v1/ 会漏匹配。
 */
export function normalizeBaseUrl(url: string): string {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * 从预设表构建 baseUrl -> presetId 的反查表。
 * 空的 baseUrl 会被跳过：custom 预设的 baseUrl 就是空串，
 * 否则任何"没填地址"的配置都会被误判成 custom（那本来就是兜底结果，没必要走反查）。
 */
export function buildBaseUrlReverseMap(presets: Record<string, ProviderPreset>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [id, p] of Object.entries(presets || {})) {
    const key = normalizeBaseUrl(p?.baseUrl || '')
    if (key && !map.has(key)) map.set(key, id)
  }
  return map
}

/**
 * 回显用的预设 id（方案 2 = 旧 UI 的 presetIdFor() + baseUrl 反查）。
 *
 * 背景：api-config:get 只回协议类型 protocolKind，不回预设 id，
 * 所以"保存过 DeepSeek"的配置重新打开时，旧 UI 会退化成显示「自定义」。
 * 这里先按 baseUrl 反查预设，反查不到再退回旧 UI 的原始语义。
 *
 * @param config  某条 ApiConfigEntry（至少要有 provider 与 baseUrl）
 * @param presets provider:presets 的返回
 */
export function presetIdFor(
  config: Pick<ApiConfigEntry, 'provider' | 'baseUrl'>,
  presets: Record<string, ProviderPreset>,
): string {
  const kind = String(config?.provider || '')
  const baseUrl = String(config?.baseUrl || '')

  // 1) 先按 baseUrl 反查：用户实际填的地址最能说明用的是哪个厂商
  const hit = buildBaseUrlReverseMap(presets).get(normalizeBaseUrl(baseUrl))
  if (hit) {
    const p = presets[hit]
    // 交叉校验协议类型：避免把 anthropic 配置反查成协议不同的同名 baseUrl 预设
    if (!kind || (p && p.protocolKind === kind)) return hit
  }

  // 2) 反查不到，退回旧 UI index.html presetIdFor() 的原始语义
  if (kind === 'anthropic-compatible') return 'anthropic'
  if (kind === 'openai-compatible' && !baseUrl) return 'openai'
  return 'custom'
}
