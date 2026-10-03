/**
 * 统一 Toast 组件（13.13 阶段 3）。
 * ---------------------------------------------------------------------------
 * 所有按钮反馈走这里（规范 §7）：3-5s 自动消失、不阻塞操作、可带一个撤销动作。
 * 模块级 store + 订阅：无 Provider 层级要求，<ToastHost /> 挂一次即可。
 */
import { useEffect, useState } from 'react'

export interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastItem {
  id: number
  text: string
  action?: ToastAction
}

const listeners = new Set<(items: ToastItem[]) => void>()
let items: ToastItem[] = []
let seq = 1

function emit() {
  for (const l of listeners) l(items)
}

export function toast(text: string, opts?: { action?: ToastAction; durationMs?: number }) {
  const id = seq++
  items = [...items.slice(-2), { id, text, action: opts?.action }]
  emit()
  setTimeout(() => dismissToast(id), opts?.durationMs ?? 4000)
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

/** App 根部挂载一次：fixed 顶部居中，AutomationId toast-host / toast-item */
export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items)
  useEffect(() => {
    listeners.add(setList)
    return () => {
      listeners.delete(setList)
    }
  }, [])
  if (list.length === 0) return null
  return (
    <div id="toast-host" className="pointer-events-none fixed inset-x-0 top-14 z-50 flex flex-col items-center gap-1.5">
      {list.map((t) => (
        <div
          key={t.id}
          id="toast-item"
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border/60 bg-card/95 px-3 py-1.5 text-[13px] shadow-apple backdrop-blur"
        >
          <span>{t.text}</span>
          {t.action ? (
            <button
              className="rounded px-1.5 py-0.5 text-[13px] font-medium text-primary transition-colors duration-150 ease-out hover:bg-accent"
              onClick={() => {
                t.action?.onClick()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
