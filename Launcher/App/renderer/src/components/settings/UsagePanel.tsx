/**
 * 用量统计面板（4.2：旧 UI 的 usage 视图迁移到 React）。
 * ---------------------------------------------------------------------------
 *  - 数据在「挂载时」才拉（本组件只在用量 tab 被选中时渲染），不在 App 启动阶段触发 IPC；
 *  - 切换天数（7/30/90）重新拉取；
 *  - IPC 不可用 / 主进程报错时整块降级为错误提示 + 重试（不白屏，与设置面板同一设计）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { clearUsage, exportUsage, getUsageDashboard } from '@/services/usage-client'
import type { UsageBucketRow, UsageDashboardResult } from '@/types/launcher'

const DAY_OPTIONS = [7, 30, 90] as const

export default function UsagePanel() {
  const [days, setDays] = useState<number>(7)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<UsageDashboardResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const load = useCallback(async (d: number) => {
    setLoading(true)
    setNotice(null)
    setData(await getUsageDashboard(d))
    setLoading(false)
  }, [])

  // 挂载时拉一次；days 变化重拉
  useEffect(() => {
    void load(days)
  }, [days, load])

  async function onExport(format: 'csv' | 'json') {
    const r = await exportUsage(format)
    setNotice(
      r.ok ? `已导出 ${fmt(r.count)} 条记录并打开所在文件夹（${format.toUpperCase()}）` : r.error || '导出失败',
    )
  }

  async function onClear() {
    if (!confirmingClear) {
      setConfirmingClear(true)
      return
    }
    setConfirmingClear(false)
    const r = await clearUsage()
    setNotice(r.ok ? '用量记录已清空' : r.error || '清空失败')
    if (r.ok) void load(days)
  }

  if (loading) {
    return (
      <div id="usage-loading" className="space-y-3" aria-busy="true">
        <div className="h-9 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-24 w-full animate-pulse rounded-md bg-muted" />
      </div>
    )
  }

  if (!data || !data.ok) {
    return (
      <div id="usage-error" className="space-y-3">
        <p className="text-sm text-destructive">读取用量失败：{(data && data.error) || '未知错误'}</p>
        <Button id="usage-retry" variant="outline" size="sm" onClick={() => void load(days)}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div id="usage-panel" className="space-y-4">
      {/* ===== 工具行：天数切换 + 导出 + 清空 ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">统计范围</span>
        {DAY_OPTIONS.map((d) => (
          <Button
            key={d}
            id={`usage-days-${d}`}
            role="tab"
            aria-selected={days === d}
            variant={days === d ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setDays(d)}
          >
            近 {d} 天
          </Button>
        ))}
        <span className="flex-1" />
        <Button id="usage-export-csv" variant="outline" size="sm" onClick={() => void onExport('csv')}>
          导出 CSV
        </Button>
        <Button id="usage-export-json" variant="outline" size="sm" onClick={() => void onExport('json')}>
          导出 JSON
        </Button>
        <Button id="usage-clear" variant="destructive" size="sm" onClick={() => void onClear()}>
          {confirmingClear ? '确认清空？' : '清空记录'}
        </Button>
      </div>

      {notice && (
        <p id="usage-notice" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      {/* ===== 汇总卡片 ===== */}
      <div id="usage-totals" className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard label="请求数" value={fmt(data.requests)} sub={`成功 ${fmt(data.success)} / 失败 ${fmt(data.fail)}`} />
        <MetricCard label="输入 tokens" value={fmt(data.inputTokens)} sub={`缓存 ${fmt(data.cachedTokens)}`} />
        <MetricCard label="输出 tokens" value={fmt(data.outputTokens)} sub={`推理 ${fmt(data.reasoningTokens)}`} />
        <MetricCard
          label="费用"
          value={data.cost == null ? '—' : data.cost.toFixed(4)}
          sub={data.cost == null ? '无定价数据' : `${data.currency || 'USD'} · 已定价 ${fmt(data.pricedRequests)} 条`}
        />
      </div>

      {/* ===== 三个维度表 ===== */}
      <BucketTable idPrefix="usage-agent" title="按 Agent" rows={data.byAgent} />
      <BucketTable idPrefix="usage-provider" title="按 Provider" rows={data.byProvider} />
      <BucketTable idPrefix="usage-model" title="按模型" rows={data.byModel} />
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function BucketTable({ idPrefix, title, rows }: { idPrefix: string; title: string; rows?: UsageBucketRow[] }) {
  const list = rows || []
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-medium">{title}</h3>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无数据</p>
      ) : (
        <table id={idPrefix + '-table'} className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-2 font-normal">名称</th>
              <th className="py-1.5 pr-2 font-normal">请求</th>
              <th className="py-1.5 pr-2 font-normal">输入</th>
              <th className="py-1.5 pr-2 font-normal">输出</th>
              <th className="py-1.5 pr-2 font-normal">合计</th>
              <th className="py-1.5 font-normal">费用</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={`${r.key}-${i}`} className="border-b border-border/60 last:border-0">
                <td id={i === 0 ? `${idPrefix}-first` : undefined} className="py-1.5 pr-2 font-medium">
                  {r.key || '（未知）'}
                </td>
                <td className="py-1.5 pr-2">{fmt(r.requests)}</td>
                <td className="py-1.5 pr-2">{fmt(r.inputTokens)}</td>
                <td className="py-1.5 pr-2">{fmt(r.outputTokens)}</td>
                <td className="py-1.5 pr-2">{fmt(r.totalTokens)}</td>
                <td className="py-1.5">{r.cost == null ? '—' : r.cost.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function fmt(n?: number | null): string {
  if (n == null) return '0'
  return n.toLocaleString('zh-CN')
}
