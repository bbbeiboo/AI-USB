/**
 * 键盘快捷键页（13.18 任务书 §3.2）：静态只读表格，只列真实存在的快捷键。
 * 不发明不存在的快捷键；Ctrl+K 在设置弹窗内 scoped 为「搜索设置」。
 */
const ROWS: Array<[string, string]> = [
  ['Enter', '发送消息'],
  ['Shift + Enter', '输入换行'],
  ['Ctrl + N', '新建会话'],
  ['Ctrl + K', '搜索会话（设置弹窗内 = 搜索设置）'],
  ['Esc', '关闭弹窗 / 收起菜单'],
]

export default function HotkeysPage() {
  return (
    <div className="space-y-3 p-5">
      <h3 className="text-[14px] font-semibold">键盘快捷键</h3>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        {ROWS.map(([k, desc]) => (
          <div key={k} id={`hotkey-row-${k.replace(/[^a-z+]/gi, '-').toLowerCase()}`} className="flex items-center justify-between border-b border-border/40 px-3.5 py-2.5 last:border-0">
            <span className="text-[13px] text-muted-foreground">{desc}</span>
            <kbd className="rounded border border-border/60 bg-accent px-2 py-0.5 font-mono text-[12px]">{k}</kbd>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">只读展示；自定义快捷键将在后续版本提供。</p>
    </div>
  )
}
