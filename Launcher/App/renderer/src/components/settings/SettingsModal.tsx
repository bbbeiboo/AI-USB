/**
 * 设置面板（Modal 容器）——第 4.1 步：旧 UI「API 配置」页迁移到 React 的入口。
 * ---------------------------------------------------------------------------
 * 职责边界：
 *  - 本组件只负责「弹窗容器 + 取数 + 标签页切换」，表单本身在 ApiConfigForm.tsx；
 *  - 数据在「打开时」才拉（open: false -> true），关闭时清空本地状态，
 *    保证不在 App 启动阶段触发任何 IPC（任务书约束 7）；
 *  - 用 fixed 定位独立挂在 App 根节点，不参与三栏布局的 flex 流（任务书约束 6）。
 *  - 关闭方式三种：Escape / 点遮罩 / 右上角 ×（与旧 UI 的返回按钮语义对齐）。
 */
import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getApiConfig, getProviderPresets } from '@/services/config-client'
import type { ApiConfigEntry, ProviderPreset } from '@/types/launcher'
import ApiConfigForm from './ApiConfigForm'
import UsagePanel from './UsagePanel'
import AboutPanel from './AboutPanel'

/** 标签页 id；4.2 / 4.4 只需在这里补对应分支，不用改容器结构 */
type SettingsTab = 'api' | 'usage' | 'about'

const TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: 'api', label: 'API 配置' },
  { id: 'usage', label: '用量统计' },
  { id: 'about', label: '关于' },
]

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>('api')
  // 下面四份状态都由本组件持有（ApiConfigForm 是纯展示 + 回调，见 4.1.3.3 的 props 约定）
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configs, setConfigs] = useState<Record<string, ApiConfigEntry>>({})
  const [presets, setPresets] = useState<Record<string, ProviderPreset>>({})

  /**
   * 拉取设置面板所需的全部数据。
   * 两个 IPC 并发发出；config-client 内部已把「IPC 未注入 / 主进程抛错」统一转成 { ok:false }，
   * 所以这里不会出现未捕获异常。
   * 预设表拿不到时不视为致命错误：下拉会退化成只有兜底项，但配置本身仍可读可写。
   */
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [cfgRes, presetRes] = await Promise.all([getApiConfig(), getProviderPresets()])
    if (!cfgRes.ok) {
      setError(cfgRes.error || '读取 API 配置失败')
      setLoading(false)
      return
    }
    setConfigs(cfgRes.agents || {})
    setPresets(presetRes.ok ? presetRes.presets || {} : {})
    setLoading(false)
  }, [])

  // 打开时才拉数据：只在 false -> true 时触发，关闭时不动网络
  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  // 关闭后清空本地状态：下次打开必须重新拉，不能复用旧数据（验收项「关闭再打开 → 重新拉数据」）
  useEffect(() => {
    if (open) return
    setTab('api')
    setConfigs({})
    setPresets({})
    setError(null)
    setLoading(false)
  }, [open])

  // Escape 关闭
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  // 关闭时直接不渲染：省掉「display:none 但仍在 DOM 里」这类隐藏状态
  if (!open) return null

  return (
    <div
      id="settings-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      // mousedown 而不是 click：避免在面板内按下、拖到遮罩上松开时被误判为「点了遮罩」
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <div
        id="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="bg-background flex h-[600px] max-h-[90vh] w-[800px] max-w-[90vw] flex-col rounded-lg border border-border shadow-lg"
      >
        {/* ===== 标题栏 ===== */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">设置</h2>
          <Button
            id="settings-modal-close"
            variant="ghost"
            size="icon-sm"
            title="关闭"
            aria-label="关闭"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* ===== 标签页头（用已有 shadcn button，不引入新依赖） ===== */}
        <div role="tablist" className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
          {TABS.map((t) => (
            <Button
              key={t.id}
              id={'settings-tab-' + t.id}
              role="tab"
              aria-selected={tab === t.id}
              variant={tab === t.id ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        {/* ===== 内容区：min-h-0 让内部滚动生效 ===== */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'api' ? (
            loading ? (
              <LoadingSkeleton />
            ) : error ? (
              <ErrorBlock message={error} onRetry={() => void load()} />
            ) : (
              /*
               * 表单主体在 ApiConfigForm 里：它只做展示与回调，不认识 IPC。
               * 数据（configs / presets）由本组件取好并持有；保存/清除密钥成功后
               * 走 onSaved={load} 重新拉一次，保证回显与磁盘上那份一致。
               */
              <ApiConfigForm presets={presets} configs={configs} onSaved={load} />
            )
          ) : tab === 'usage' ? (
            // 4.2：用量统计面板（数据在面板挂载时才拉，见 UsagePanel 内部说明）
            <UsagePanel />
          ) : (
            // 4.4：关于页（只读信息 + 打开日志文件夹）
            <AboutPanel />
          )}
        </div>
      </div>
    </div>
  )
}

/** 加载骨架：形状接近表单（几行 label + 输入框），避免布局跳动 */
function LoadingSkeleton() {
  return (
    <div id="settings-loading" className="space-y-3" aria-busy="true">
      <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
          <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
        </div>
      ))}
    </div>
  )
}

/** 取数失败提示 + 重试 */
function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div id="settings-error" className="space-y-3">
      <p className="text-sm text-destructive">读取配置失败：{message}</p>
      <Button id="settings-retry" variant="outline" size="sm" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}
