/**
 * 设置中心左导航（13.18 任务书 §二）：18 项固定顺序，图标+文案，单选高亮。
 * SETTINGS_SECTION_META 同时供搜索overlay 使用（设置项名唯一清单）。
 */
import {
  Archive, Bell, Brain, Cloud, Cpu, CreditCard, Globe, Info, Keyboard, KeyRound,
  LayoutDashboard, MessageSquare, Mic, Network, Palette, Puzzle, Shield, SlidersHorizontal,
} from 'lucide-react'
import type { SettingsSectionId } from '@/services/agent-control-types'
import { cn } from 'cn'

export const SETTINGS_SECTION_META: ReadonlyArray<{ id: SettingsSectionId; label: string; icon: typeof Cpu }> = [
  { id: 'models', label: '模型', icon: Cpu },
  { id: 'chat', label: '对话', icon: MessageSquare },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'workspace', label: '工作区', icon: LayoutDashboard },
  { id: 'security', label: '安全', icon: Shield },
  { id: 'browser', label: 'Browser', icon: Globe },
  { id: 'memory', label: '记忆与上下文', icon: Brain },
  { id: 'voice', label: '语音', icon: Mic },
  { id: 'advanced', label: '高级', icon: SlidersHorizontal },
  { id: 'notifications', label: '通知', icon: Bell },
  { id: 'billing', label: '账单', icon: CreditCard },
  { id: 'providers', label: '提供方', icon: Cloud },
  { id: 'gateway', label: '网关', icon: Network },
  { id: 'hotkeys', label: '键盘快捷键', icon: Keyboard },
  { id: 'keys', label: '工具与密钥', icon: KeyRound },
  { id: 'plugins', label: '插件', icon: Puzzle },
  { id: 'archived', label: '已归档对话', icon: Archive },
  { id: 'about', label: '关于', icon: Info },
]

interface Props {
  active: SettingsSectionId
  onSelect: (id: SettingsSectionId) => void
}

export default function SettingsNav({ active, onSelect }: Props) {
  return (
    <nav id="settings-nav" className="flex w-[200px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 p-2">
      {SETTINGS_SECTION_META.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          id={`settings-nav-${id}`}
          aria-current={active === id}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150 ease-out hover:bg-accent/70',
            active === id && 'bg-accent font-medium',
          )}
          onClick={() => onSelect(id)}
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </nav>
  )
}
