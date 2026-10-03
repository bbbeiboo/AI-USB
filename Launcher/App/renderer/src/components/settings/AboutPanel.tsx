/**
 * 关于面板（4.4）。
 * ---------------------------------------------------------------------------
 *  - 只读展示：产品名 / 启动器版本 / 便携根目录 / 日志路径，数据来自 manifest:get；
 *  - 「打开日志文件夹」走 shell:openLogs（主进程负责 shell 操作，渲染层不碰 fs）；
 *  - IPC 不可用时降级为只读提示，不报错（与设置面板同一设计）。
 */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getManifest } from '@/services/agent-client'
import type { ManifestResult } from '@/types/launcher'

export default function AboutPanel() {
  const [info, setInfo] = useState<ManifestResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void getManifest().then((r) => {
      if (!cancelled) setInfo(r)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const rows: Array<{ k: string; v: string; id?: string }> = [
    { k: '产品', v: 'AI Agent 启动器（AI U盘）', id: 'about-product' },
    { k: '启动器版本', v: (info && info.launcherVersion) || '—', id: 'about-version' },
    { k: '便携根目录', v: (info && info.root) || '—', id: 'about-root' },
    { k: '日志文件', v: (info && info.logPath) || '—', id: 'about-logpath' },
  ]

  return (
    <div id="about-panel" className="space-y-4">
      <dl className="space-y-2">
        {rows.map((r) => (
          <div key={r.k} className="flex items-start gap-3 text-sm">
            <dt className="w-24 shrink-0 text-muted-foreground">{r.k}</dt>
            <dd id={r.id} className="min-w-0 break-all font-medium">
              {r.v}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        本启动器便携化集成 OpenClaw / Hermes / Codex / Claude Code 四个 Agent，
        运行时、配置与数据全部落在 U 盘目录内，不写系统全局状态。
        日志时间为 UTC（与本地时间差 8 小时属设计行为）。
      </p>
      <Button id="about-open-logs" variant="outline" size="sm" onClick={() => void window.launcher?.openLogs()}>
        打开日志文件夹
      </Button>
    </div>
  )
}
