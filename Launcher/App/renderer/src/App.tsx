/**
 * v2 布局（13.16 更新）：
 *   ┌──────────────────── TopBar（毛玻璃）────────────────────┐
 *   │ [logo=当前Agent，左键切换]   当前会话名   [检查更新][帮助] │
 *   ├──── SideBar ──────┬────────── Workbench ────────────────┤
 *   │ 新建会话           │ 工具条：会话名+模型chip+重生成/清空/    │
 *   │ 会话搜索(Ctrl+K)   │   复制/导出（启停栏已删：开机自启全部）  │
 *   │ 会话列表(⋯菜单)    │ 输出流（stub 驱动，含流式响应）         │
 *   │ [用户卡+设置]       │ 输入框 + 发送                         │
 *   ├── StatusBar（状态+日志入口+stub 标识）┴────────────────────┤
 * 13.16 裁决：打开软件即开启全部 Agent（hook 层统一走 startAgent，真接线轮零改动）；
 * 工作台头部启停栏删除，日志入口移到状态栏。数据全部来自 getAgentControlService()
 * （stub/real 唯一切换点）。设置弹窗沿用既有三组件（13.13 硬规则 6：功能逻辑不动）。
 */
import { useEffect, useState } from 'react'
import TopBar from '@/components/layout/TopBar'
import SideBar from '@/components/layout/SideBar'
import Workbench from '@/components/workbench/Workbench'
import StatusBar from '@/components/layout/StatusBar'
import { ToastHost } from '@/components/ui/toast'
import SettingsModal from '@/components/settings/SettingsModal'
import { useWorkbench } from '@/hooks/use-workbench'

export default function App() {
  const wb = useWorkbench()
  /*
   * 设置弹窗开关：入口在侧栏左下用户卡（app-settings，13.15 起唯一入口）→ 根节点持有。
   * 弹窗内部逻辑不动（打开时才拉数据，约束 7）。
   */
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)

  // Ctrl+N 新建会话（快捷键面板见顶栏帮助 Popover；Ctrl+K 由 SideBar 自管聚焦）
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.ctrlKey && ev.key.toLowerCase() === 'n') {
        ev.preventDefault()
        void wb.newSession()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wb])

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <TopBar
        agents={wb.agents}
        current={wb.current}
        sessionTitle={wb.sessionTitle}
        onSwitchAgent={(id) => void wb.switchAgent(id)}
      />
      <div className="flex min-h-0 flex-1">
        <SideBar
          sessions={wb.sessions}
          sessionId={wb.sessionId}
          onNewSession={() => void wb.newSession()}
          onSwitchSession={(id) => void wb.switchSession(id)}
          onRenameSession={(id, title) => void wb.renameSession(id, title)}
          onDeleteSession={(id) => void wb.deleteSession(id)}
          onPinSession={(id) => void wb.toggleSessionPin(id)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <Workbench wb={wb} />
      </div>
      <StatusBar agent={wb.current} onOpenLogs={() => void wb.openLogs()} />
      <ToastHost />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
