/**
 * v2 布局（13.17 任务书重构）：
 *   ┌────────────────────── TopBar（毛玻璃）────────────────────────┐
 *   │ [logo=当前Agent ▼]                    [搜索][通知][更多 ⋯]      │
 *   ├──── SideBar ──────┬──────────── 主区（按视图切换）──────────────┤
 *   │ ＋新建 / 搜索       │ chat:   Workbench（会话名+⋯ / 消息+推荐卡 /  │
 *   │ 会话|任务|文件|队列 │         输入区＋📎拖拽+模型+发送↔停止）       │
 *   │ 最近会话(⋯菜单)     │ tasks:  TaskPanel   queue: QueuePanel        │
 *   │ [用户块+设置行]     │ files:  FilePanel                            │
 *   └───────────────────┴──────────────────────────────────────────────┘
 * 13.17 裁决：底部 StatusBar 整体删除（任务书 §十二/§三十九），日志入口移入 ⋯ 菜单；
 * 每轮回复带「转交」推荐卡（TransferDialog，禁止自转交）；数据全部来自
 * getAgentControlService()（stub/real 唯一切换点）。设置弹窗沿用既有三组件
 * （13.13 硬规则 6：功能逻辑不动）。
 */
import { useEffect, useState } from 'react'
import TopBar from '@/components/layout/TopBar'
import SideBar, { type SideView } from '@/components/layout/SideBar'
import Workbench from '@/components/workbench/Workbench'
import TaskPanel from '@/components/task/TaskPanel'
import QueuePanel from '@/components/task/QueuePanel'
import FilePanel from '@/components/files/FilePanel'
import { ToastHost } from '@/components/ui/toast'
import SettingsDialog from '@/components/settings/SettingsDialog'
import SettingsModal from '@/components/settings/SettingsModal'
import { useWorkbench } from '@/hooks/use-workbench'
import type { SettingsSectionId, TaskItem } from '@/services/agent-control-types'

export default function App() {
  const wb = useWorkbench()
  /*
   * 设置中心（13.18）：SideBar 设置行 / 顶栏 ⋯ 关于 → 新 SettingsDialog（18 项导航）。
   * 既有 SettingsModal（API 配置/用量/关于三组件，13.13 接受区）不动，保留
   * 「用户菜单 → 使用情况」一个入口（真实用量数据只在其中）。
   */
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('models')
  const [apiSettingsOpen, setApiSettingsOpen] = useState<boolean>(false)
  const openSettings = (s: SettingsSectionId = 'models') => {
    setSettingsSection(s)
    setSettingsOpen(true)
  }
  const [view, setView] = useState<SideView>('chat')

  // Ctrl+N 新建会话（快捷键面板见顶栏 ⋯ → 快捷键；Ctrl+K 由 SideBar 自管聚焦）
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.ctrlKey && ev.key.toLowerCase() === 'n') {
        ev.preventDefault()
        setView('chat')
        void wb.newSession()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wb])

  /** 任务/搜索结果 → 打开对应会话（跨 Agent 时先切 Agent，偏好会话直达） */
  async function openTask(task: TaskItem) {
    if (task.agentId !== wb.current?.id) await wb.switchAgent(task.agentId, task.sessionId)
    else if (task.sessionId) await wb.switchSession(task.sessionId)
    setView('chat')
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <TopBar
        agents={wb.agents}
        current={wb.current}
        sessions={wb.sessions}
        notifications={wb.notifications}
        onSwitchAgent={(id) => void wb.switchAgent(id)}
        onOpenSession={(id) => {
          setView('chat')
          void wb.switchSession(id)
        }}
        onOpenView={(v) => setView(v)}
        onOpenLogs={() => void wb.openLogs()}
        onOpenAbout={() => openSettings('about')}
      />
      <div className="flex min-h-0 flex-1">
        <SideBar
          view={view}
          sessions={wb.sessions}
          sessionId={wb.sessionId}
          onSwitchView={setView}
          onNewSession={() => void wb.newSession()}
          onSwitchSession={(id) => void wb.switchSession(id)}
          onRenameSession={(id, title) => void wb.renameSession(id, title)}
          onDeleteSession={(id) => void wb.deleteSession(id)}
          onPinSession={(id) => void wb.toggleSessionPin(id)}
          onOpenSettings={() => openSettings('models')}
          onOpenUsage={() => setApiSettingsOpen(true)}
        />
        {view === 'chat' ? (
          <Workbench wb={wb} />
        ) : view === 'tasks' ? (
          <TaskPanel agents={wb.agents} onOpenTask={(t) => void openTask(t)} />
        ) : view === 'queue' ? (
          <QueuePanel agents={wb.agents} />
        ) : (
          <FilePanel agents={wb.agents} />
        )}
      </div>
      <ToastHost />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} initialSection={settingsSection} agents={wb.agents} />
      <SettingsModal open={apiSettingsOpen} onOpenChange={setApiSettingsOpen} />
    </div>
  )
}
