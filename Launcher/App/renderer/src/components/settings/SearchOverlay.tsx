/**
 * 设置搜索（13.18 任务书 §3.3）：胶囊点击或 Ctrl+K 展开。
 * 范围 = 18 个导航项 + 模型页 8 个辅助任务名 + Mixture of Agents；
 * 结果分组「设置页 / 模型设置」；辅助任务命中 → 跳模型页并高亮该行 2 秒。
 */
import { useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { SETTINGS_SECTION_META } from './SettingsNav'
import type { SettingsSectionId } from '@/services/agent-control-types'
import { cn } from 'cn'

const AUX_TASKS: Array<{ taskId: string; label: string }> = [
  { taskId: 'vision', label: '视觉' },
  { taskId: 'compaction', label: '压缩' },
  { taskId: 'skills', label: '技能中心' },
  { taskId: 'approvals', label: '审批' },
  { taskId: 'mcp', label: 'MCP' },
  { taskId: 'title-gen', label: '标题生成' },
  { taskId: 'review', label: '评审' },
  { taskId: 'maintainer', label: '维护器' },
]
const MOA_LABEL = 'Mixture of Agents'

interface Props {
  onJump: (section: SettingsSectionId, highlightTaskId?: string) => void
  onClose: () => void
}

export default function SearchOverlay({ onJump, onClose }: Props) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  // 展开即聚焦（refs 在挂载后可用）
  queueMicrotask(() => inputRef.current?.focus())

  const query = q.trim().toLowerCase()
  const hitSections = useMemo(
    () => (query ? SETTINGS_SECTION_META.filter((s) => s.label.toLowerCase().includes(query)) : []),
    [query],
  )
  const hitAux = useMemo(
    () => (query ? AUX_TASKS.filter((t) => t.label.toLowerCase().includes(query) || t.taskId.includes(query)) : []),
    [query],
  )
  const hitMoa = query !== '' && MOA_LABEL.toLowerCase().includes(query)
  const noHit = query !== '' && hitSections.length === 0 && hitAux.length === 0 && !hitMoa

  function jump(section: SettingsSectionId, highlightTaskId?: string) {
    onJump(section, highlightTaskId)
    onClose()
  }

  return (
    <div className="absolute inset-x-0 top-2 z-10 mx-auto w-[420px] max-w-[85%]">
      <div className="rounded-xl border border-border bg-background shadow-lg">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <input
            id="settings-search-input"
            ref={inputRef}
            value={q}
            placeholder="搜索设置…"
            aria-label="搜索设置"
            className="h-6 w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
            onChange={(ev) => setQ(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Escape') onClose()
              if (ev.key === 'Enter') {
                const first = hitSections[0]
                if (first) jump(first.id)
                else if (hitAux[0]) jump('models', hitAux[0].taskId)
                else if (hitMoa) jump('models')
              }
            }}
          />
          <kbd className="rounded border border-border/60 bg-accent px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
        </div>
        <div id="settings-search-results" className="max-h-72 overflow-y-auto p-1.5">
          {!query ? (
            <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">搜索 18 个设置页与模型设置</div>
          ) : noHit ? (
            <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">无匹配结果</div>
          ) : (
            <>
              {hitSections.length > 0 ? (
                <div>
                  <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium text-muted-foreground">设置页</div>
                  {hitSections.map(({ id, label }) => (
                    <button
                      key={id}
                      id={`settings-search-item-${id}`}
                      className={cn('w-full rounded-md px-2 py-1.5 text-left text-[12px] transition-colors duration-150 ease-out hover:bg-accent')}
                      onClick={() => jump(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
              {(hitAux.length > 0 || hitMoa) ? (
                <div>
                  <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium text-muted-foreground">模型设置</div>
                  {hitAux.map((t) => (
                    <button
                      key={t.taskId}
                      id={`settings-search-item-aux-${t.taskId}`}
                      className="w-full rounded-md px-2 py-1.5 text-left text-[12px] transition-colors duration-150 ease-out hover:bg-accent"
                      onClick={() => jump('models', t.taskId)}
                    >
                      {t.label}
                    </button>
                  ))}
                  {hitMoa ? (
                    <button
                      id="settings-search-item-moa"
                      className="w-full rounded-md px-2 py-1.5 text-left text-[12px] transition-colors duration-150 ease-out hover:bg-accent"
                      onClick={() => jump('models')}
                    >
                      {MOA_LABEL}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
