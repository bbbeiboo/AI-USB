/**
 * API 配置表单 —— 旧 UI「API 配置」页（index.html 的 #configView）的 React 迁移版。
 * ---------------------------------------------------------------------------
 * 迁移原则：交互行为逐项对齐旧 UI，只把实现方式换成 React。
 *   - 数据来源：父组件 SettingsModal 通过 props 传入 configs / presets（打开面板时才拉）；
 *   - 表单状态：全部用 useState（旧 UI 是直接读 DOM 节点的 value）；
 *   - 落盘的 provider 恒为 presets[presetId].protocolKind，presetId 只留在渲染层（约束 6）。
 *
 * 两处刻意"不按最直觉写法"的地方，都在下面就地写了注释：
 *   1) Provider 切换用 onChange 处理函数，**不用** useEffect(presetId)。因为程序回填 presetId
 *      时 effect 同样会跑，会把「自定义」配置里保存的 baseUrl 当成"用户切到了 custom"而清空，
 *      直接破坏「保存自定义 baseUrl → 重开仍是自定义」这条验收。
 *   2) 切到 custom 预设时无条件清空 baseUrl + 清脏标记 —— 这是旧 UI 的既定行为
 *      （index.html L433），不是 bug，照搬。
 *
 * 与旧 UI 的一处刻意差异：旧 UI 的「Provider 名称」（cCustomName）输入框没有迁移 ——
 * 它在旧 UI 里从不参与 readForm() / saveApiConfig，是个从来没生效过的死字段。
 */
import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  clearApiKey,
  fetchModels,
  getModelCache,
  presetIdFor,
  saveApiConfig,
  testProviderConnection,
  validateApiConfig,
} from '@/services/config-client'
import { CONFIG_TABS, toConfigId } from '@/services/agent-client'
import type { ApiConfigEntry, ProviderPreset, TestProviderConnectionResult } from '@/types/launcher'
import ConnectionTestButton from './ConnectionTestButton'

/** validateFields（main.js L170）返回的错误码 -> 中文提示 */
const FIELD_LABEL: Record<string, string> = {
  provider: 'Provider 类型',
  baseUrl: 'API Base URL',
  model: 'Model',
  apiKey: 'API Key',
  apiKeyTooShort: 'API Key（少于 8 位）',
}

/** 缓存时间戳转中文相对时间（措辞与旧 UI loadCachedModels 一致） */
function formatAge(ageMs?: number): string {
  const mins = Math.max(0, Math.round((ageMs || 0) / 60000))
  if (mins < 1) return '刚刚'
  if (mins < 60) return mins + ' 分钟前'
  return Math.round(mins / 60) + ' 小时前'
}

/** 原生 select 与 shadcn Input 保持同一套视觉（不新增依赖） */
const SELECT_CLASS =
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30'

interface ApiConfigFormProps {
  /** provider:presets 的返回（预设表读不到时为空对象） */
  presets: Record<string, ProviderPreset>
  /** api-config:get 的返回，key 是 **config id**（claudeCode 不是 claude-code） */
  configs: Record<string, ApiConfigEntry>
  /** 保存 / 清除密钥成功后通知父组件重新拉取配置 */
  onSaved?: () => void
}

export default function ApiConfigForm({ presets, configs, onSaved }: ApiConfigFormProps) {
  // 选中 Agent 用 **agent id** 空间（openclaw|hermes|codex|claude-code），
  // 调 IPC 前一律过 toConfigId()（见 services/agent-client.ts 的双 id 说明）
  const [selectedAgentId, setSelectedAgentId] = useState<string>('openclaw')
  const [presetId, setPresetId] = useState<string>('openai')
  const [baseUrl, setBaseUrl] = useState<string>('')
  const [baseUrlDirty, setBaseUrlDirty] = useState<boolean>(false)
  const [model, setModel] = useState<string>('')
  const [apiKey, setApiKey] = useState<string>('')
  const [showKey, setShowKey] = useState<boolean>(false)
  const [saving, setSaving] = useState<boolean>(false)
  const [validating, setValidating] = useState<boolean>(false)
  const [fetchingModels, setFetchingModels] = useState<boolean>(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelMsg, setModelMsg] = useState<string>('')
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  // 「测试当前表单」的独立状态：它测的是输入框里的值，与 ConnectionTestButton（测磁盘配置）无关
  const [formTesting, setFormTesting] = useState<boolean>(false)
  const [formResult, setFormResult] = useState<TestProviderConnectionResult | null>(null)

  const configId = toConfigId(selectedAgentId)
  const cfg = configs[configId]
  const preset = presets[presetId]

  // toast 3 秒自动消失（换一条 toast 时旧的定时器会被 effect 清理掉）
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(t)
  }, [toast])

  /**
   * 打开面板 / 切 Provider 时调用：24 小时内的模型缓存直接填下拉，**不发网络请求**
   * （对应旧 UI 的 loadCachedModels）。
   * 显式传参而不是读 state：调用点上刚刚算好的值还没进 state，读 state 会拿到上一轮的旧值。
   */
  const loadCachedModels = useCallback(async (providerId: string, url: string) => {
    setModelOptions([])
    setModelMsg('')
    const res = await getModelCache({ providerId, baseUrl: url.trim() })
    if (res.ok && res.models && res.models.length) {
      setModelOptions(res.models)
      setModelMsg('缓存 ' + res.models.length + ' 个模型（' + formatAge(res.ageMs) + '拉取）')
    }
  }, [])

  // 回填表单：切 Agent，或父组件刷新了 configs / presets 时执行
  useEffect(() => {
    const cid = toConfigId(selectedAgentId)
    const c = configs[cid]
    setApiKey('') // 约束 7：密钥明文永不回显，输入框恒为空
    setShowKey(false)
    setModelOptions([])
    setModelMsg('')
    setFormResult(null)
    setToast(null)
    /*
     * 全新未配置判定（同时覆盖"后端没返回该 id 条目"的防御场景）。
     * 为什么需要它：api-config:get（main.js L669）对 CONFIG_IDS 里 4 个 id **恒定返回条目**，
     * 未配置时 provider/baseUrl/model 都是空串 —— 只判断 !c 永远不会成立，
     * 结果就是全新 Agent 打开时显示「自定义 + 空 BaseURL」，新用户没有起点。
     * 判据取"四字段全空且无密钥"：已配置过的 Agent 不可能四字段全空
     * （validateFields 要求 model 必填、provider 必须是三种协议之一），
     * 所以这个判定不会改变任何已保存配置的回显。
     */
    const isFresh = !c || (!c.configured && !c.provider && !c.baseUrl && !c.model)
    if (isFresh) {
      setPresetId('openai')
      /*
       * ⚠️ presets.openai 必须判空。本 effect 在**首次挂载**时就会执行，
       * 而那一刻父组件的 load() 还没返回，presets 仍是 {}（L58 已声明该契约）；
       * 裸读 presets.openai.baseUrl 会抛 TypeError，React 随即卸载整棵根，
       * 表现为「点开设置 → 整个应用白屏」（含会话页面一起消失）。
       * 4.1.5.4 端到端验收实测到该崩溃（ApiConfigForm.tsx:114 旧行号）。
       * 退化成空串即可：Provider 下拉本就有「预设表为空」的兜底分支（见 L317）。
       */
      const openaiBaseUrl = presets.openai?.baseUrl || ''
      setBaseUrl(openaiBaseUrl)
      setBaseUrlDirty(false)
      setModel('')
      void loadCachedModels('openai', openaiBaseUrl)
      return
    }
    // 方案 2：先按 baseUrl 反查预设，反查不到再退回旧 UI 的语义
    const pid = presetIdFor(c, presets)
    setPresetId(pid)
    setBaseUrl(c.baseUrl || '')
    setBaseUrlDirty(false)
    setModel(c.model || '')
    void loadCachedModels(pid, c.baseUrl || '')
  }, [selectedAgentId, configs, presets, loadCachedModels])

  // 兜底：presets 里没有当前 presetId 时退到第一个预设，避免 <select> 显示空白
  // （照搬旧 UI fillForm 里的同款兜底）
  useEffect(() => {
    const ids = Object.keys(presets)
    if (ids.length > 0 && !presets[presetId]) setPresetId(ids[0])
  }, [presets, presetId])

  /**
   * 用户手动切换 Provider（等价旧 UI 的 cProvider.onchange）。
   * ⚠️ 刻意不用 useEffect(presetId)：程序回填 presetId 时 effect 也会跑，
   * 那样会把「自定义」配置里保存的 baseUrl 误清空，回显直接失效。
   */
  function handlePresetChange(nextId: string) {
    setPresetId(nextId)
    setModelOptions([])
    setModelMsg('')
    setFormResult(null)
    const p = presets[nextId]
    if (!p) return
    // 切到 custom（预设 baseUrl 为空）：无条件清空 + 清脏标记，照搬旧 UI index.html L433
    if (!p.baseUrl) {
      setBaseUrl('')
      setBaseUrlDirty(false)
      void loadCachedModels(nextId, '')
      return
    }
    // 切到其他预设：仅在用户没手改过 BaseURL 时才覆盖
    if (!baseUrlDirty) {
      setBaseUrl(p.baseUrl)
      void loadCachedModels(nextId, p.baseUrl)
      return
    }
    void loadCachedModels(nextId, baseUrl)
  }

  /** 拉取模型列表：1 次 GET 模型列表，后端 10 秒超时，成功后主进程写 24h 缓存 */
  async function handleFetchModels() {
    setFetchingModels(true)
    setModelMsg('正在请求 GET ' + (preset && preset.modelsEndpoint ? preset.modelsEndpoint : '/models') + ' …')
    const res = await fetchModels({
      id: configId,
      providerId: presetId,
      baseUrl: baseUrl.trim(),
      // 空串不传：让后端用已保存的密钥（与旧 UI 同语义）
      apiKey: apiKey.trim() ? apiKey : undefined,
    })
    setFetchingModels(false)
    if (res.ok && res.models) {
      setModelOptions(res.models)
      // fetchModels 的返回里没有 ageMs，只有 cached 标志；具体多久前拉的要靠 getModelCache
      setModelMsg('✓ 拉到 ' + res.models.length + ' 个模型' + (res.cached ? '（缓存）' : ''))
      return
    }
    setModelOptions([])
    setModelMsg('')
    setToast({ kind: 'err', msg: (res.error || '拉取失败') + (res.hint ? '（' + res.hint + '）' : '') })
  }

  /** 验证配置：纯本地字段校验，不发网络请求（旧 UI validateBtn） */
  async function handleValidate() {
    setValidating(true)
    const res = await validateApiConfig({
      provider: (preset && preset.protocolKind) || '',
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey,
    })
    setValidating(false)
    if (res.ok && res.valid) {
      setToast({ kind: 'ok', msg: '格式校验通过（未发起网络请求）' })
      return
    }
    if (!res.ok) {
      setToast({ kind: 'err', msg: res.error || '校验失败' })
      return
    }
    const names = (res.errors || []).map((f) => FIELD_LABEL[f] || f)
    setToast({ kind: 'err', msg: '格式错误：' + names.join('、') })
  }

  /** 保存：provider 存 protocolKind（约束 6）；apiKey 留空表示沿用已保存的密钥 */
  async function handleSave() {
    setSaving(true)
    const res = await saveApiConfig({
      id: configId,
      provider: (preset && preset.protocolKind) || '',
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey,
      enabled: true,
    })
    setSaving(false)
    if (res.ok) {
      setToast({ kind: 'ok', msg: '已保存' + (res.maskedKey ? '（' + res.maskedKey + '）' : '') })
      // 通知父组件重新 getApiConfig：表单会再次从磁盘回填，脏标记一并清零
      onSaved?.()
      return
    }
    const extra = res.errors && res.errors.length ? '：' + res.errors.map((f) => FIELD_LABEL[f] || f).join('、') : ''
    setToast({ kind: 'err', msg: (res.reason || '保存失败') + extra })
  }

  /** 清除 API Key：只删密钥文件，不动其他字段（旧 UI clearBtn） */
  async function handleClearKey() {
    if (!window.confirm('确定删除当前 Agent 的 API Key？此操作不会删除 Agent 本体。')) return
    const res = await clearApiKey(configId)
    if (res.ok) {
      setApiKey('')
      setToast({ kind: 'ok', msg: '已清除 API Key' })
      onSaved?.()
      return
    }
    setToast({ kind: 'err', msg: res.reason || '清除失败' })
  }

  /** 测试当前表单：POST responsesEndpoint，15 秒超时，用输入框里的值（旧 UI testProvBtn） */
  async function handleTestForm() {
    setFormTesting(true)
    setFormResult(null)
    const res = await testProviderConnection({
      id: configId,
      providerId: presetId,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey: apiKey.trim() ? apiKey : undefined,
    })
    setFormTesting(false)
    setFormResult(res)
  }

  // 按钮可用性判断（与旧 UI updateModelButtons 一致，另加上"已保存过密钥"也算有 Key"）
  const hasBase = !!baseUrl.trim()
  const hasKey = !!apiKey.trim() || !!(cfg && cfg.configured)
  const hasModel = !!model.trim()
  const canFetch = hasBase && hasKey
  const canTestForm = hasBase && hasKey && hasModel

  return (
    <div id="api-config-form" className="flex flex-col gap-4">
      {/* ===== 1) Agent 切换（顺序与旧 UI tabMap 一致） ===== */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Agent</span>
        <div className="flex flex-wrap items-center gap-1">
          {CONFIG_TABS.map((t) => (
            <Button
              key={t.configId}
              id={'agent-tab-' + t.configId}
              variant={t.agentId === selectedAgentId ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setSelectedAgentId(t.agentId)}
            >
              {t.fallbackName}
            </Button>
          ))}
        </div>
      </div>

      {/* ===== 2) Provider 下拉（选项动态来自 presets，不硬编码厂商） ===== */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cfg-provider" className="text-xs font-medium text-muted-foreground">
          Provider 类型
        </label>
        <select
          id="cfg-provider"
          className={SELECT_CLASS}
          value={presetId}
          onChange={(e) => handlePresetChange(e.target.value)}
        >
          {Object.keys(presets).length === 0 ? (
            // 预设表读不到时的兜底项（旧 UI renderProviderOptions 同款）
            <option value="custom">自定义</option>
          ) : (
            Object.entries(presets).map(([id, p]) => (
              <option key={id} value={id}>
                {p.label || id}
              </option>
            ))
          )}
        </select>
      </div>

      {/* ===== 3) API Base URL + 脏标记 ===== */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cfg-baseurl" className="text-xs font-medium text-muted-foreground">
          API Base URL
        </label>
        <Input
          id="cfg-baseurl"
          placeholder="https://example.com/v1"
          value={baseUrl}
          onChange={(e) => {
            setBaseUrl(e.target.value)
            setBaseUrlDirty(true) // 只有用户主动输入才算脏；预设自动填充不算
          }}
        />
        {baseUrlDirty ? (
          <p id="cfg-baseurl-dirty" className="text-xs text-amber-600 dark:text-amber-400">
            已手动修改，切换厂商不覆盖。
          </p>
        ) : null}
      </div>

      {/* ===== 4) Model + 拉取模型（缓存 / 结果都显示在这块下面） ===== */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cfg-model" className="text-xs font-medium text-muted-foreground">
          Model（可直接输入，或拉取列表后选择）
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="cfg-model"
            placeholder="例如：gpt-4o-mini"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <Button
            id="cfg-fetch-models"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={!canFetch || fetchingModels}
            title={canFetch ? '发 1 次 GET 模型列表（10 秒超时，不重试）' : '需要先填 API Base URL 与 API Key'}
            onClick={() => void handleFetchModels()}
          >
            {fetchingModels ? <Loader2 className="size-4 animate-spin" /> : null}
            {fetchingModels ? '拉取中…' : '拉取模型'}
          </Button>
        </div>
        <select
          id="cfg-model-list"
          className={SELECT_CLASS}
          value={modelOptions.indexOf(model) >= 0 ? model : ''}
          disabled={modelOptions.length === 0}
          onChange={(e) => {
            if (e.target.value) setModel(e.target.value)
          }}
        >
          <option value="">
            {modelOptions.length ? '（' + modelOptions.length + ' 个模型，选择一个）' : '（未拉取模型）'}
          </option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {modelMsg ? (
          <p id="cfg-model-msg" className="text-xs text-muted-foreground">
            {modelMsg}
          </p>
        ) : null}
      </div>

      {/* ===== 5) API Key（password / text 切换） ===== */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cfg-key" className="text-xs font-medium text-muted-foreground">
          API Key（默认隐藏；留空表示沿用已保存的密钥）
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="cfg-key"
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            placeholder={(preset && preset.keyPlaceholder) || '••••••••'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Button
            id="cfg-toggle-key"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            title={showKey ? '隐藏' : '显示'}
            aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
            onClick={() => setShowKey((v) => !v)}
          >
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>

      {/* ===== 6) 只读回显（密钥只回掩码） ===== */}
      <p id="cfg-key-status" className="text-xs">
        {cfg && cfg.configured ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            {'● 已配置（' + (cfg.maskedKey || '') + '）'}
          </span>
        ) : (
          <span className="text-muted-foreground">○ 未配置</span>
        )}
      </p>

      {/* ===== 7) 动作按钮组 ===== */}
      <div className="flex flex-wrap items-start gap-2 border-t border-border pt-3">
        <Button
          id="cfg-validate"
          variant="outline"
          size="sm"
          disabled={validating}
          title="只做本地字段校验，不发任何网络请求"
          onClick={() => void handleValidate()}
        >
          {validating ? <Loader2 className="size-4 animate-spin" /> : null}
          {validating ? '校验中…' : '验证配置'}
        </Button>

        {/* 用已保存的配置测（GET /models，10s） */}
        <ConnectionTestButton configId={configId} />

        {/* 用输入框里的值测（POST /responses，15s） */}
        <div className="flex flex-col items-start gap-1">
          <Button
            id="cfg-test-form"
            variant="outline"
            size="sm"
            disabled={!canTestForm || formTesting}
            title={
              canTestForm
                ? '用当前输入框里的值发 1 次 POST responses（15 秒超时，不重试），保存前先验证'
                : '请先填写 API Base URL、Model 与 API Key（或该 Agent 已保存过密钥）'
            }
            onClick={() => void handleTestForm()}
          >
            {formTesting ? <Loader2 className="size-4 animate-spin" /> : null}
            {formTesting ? '测试中…' : '测试当前表单'}
          </Button>
          {formResult ? <FormTestResultLine result={formResult} /> : null}
        </div>

        <Button id="cfg-save" size="sm" disabled={saving} onClick={() => void handleSave()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {saving ? '保存中…' : '保存'}
        </Button>

        <Button id="cfg-clear-key" variant="destructive" size="sm" onClick={() => void handleClearKey()}>
          清除 API Key
        </Button>
      </div>

      {/* ===== 8) 结果提示（3 秒后自动消失） ===== */}
      <div className="min-h-5">
        {toast ? (
          <p
            id="cfg-toast"
            className={
              toast.kind === 'ok'
                ? 'text-xs text-emerald-600 dark:text-emerald-400'
                : 'text-xs text-red-600 dark:text-red-400'
            }
          >
            {(toast.kind === 'ok' ? '✓ ' : '✗ ') + toast.msg}
          </p>
        ) : null}
      </div>

      {/* 安全说明：内容与旧 UI 的 .note 一致，避免用户以为密钥会跟着 U 盘走 */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        API Key 将加密保存在当前 Windows 用户环境（DPAPI），不会写入 U 盘配置文件，也不会随 U 盘复制到其他电脑。
        「验证连接」= 1 次 GET /models（10 秒超时，用已保存的配置）；「测试当前表单」= 1 次
        POST /responses（15 秒超时，用输入框里的值）；「拉取模型」= 1 次 GET 模型列表（10 秒超时）。
        三者都不会自动重试；API Key 输入框留空时使用已保存的密钥。
      </p>
    </div>
  )
}

/** 「测试当前表单」的结果行：成功绿 / 失败红 + hint */
function FormTestResultLine({ result }: { result: TestProviderConnectionResult }) {
  if (result.ok) {
    const parts: string[] = []
    if (result.status) parts.push('HTTP ' + result.status)
    if (typeof result.latencyMs === 'number') parts.push(result.latencyMs + 'ms')
    if (result.apiKeySource) parts.push('密钥来源：' + result.apiKeySource)
    return (
      <p id="cfg-test-form-result" className="text-xs text-emerald-600 dark:text-emerald-400">
        {'✓ 连接正常' + (parts.length ? '（' + parts.join(' · ') + '）' : '')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <p id="cfg-test-form-result" className="text-xs text-red-600 dark:text-red-400">
        {'✗ ' + (result.error || '连接失败')}
      </p>
      {result.hint ? <p className="text-xs text-muted-foreground">{result.hint}</p> : null}
    </div>
  )
}
