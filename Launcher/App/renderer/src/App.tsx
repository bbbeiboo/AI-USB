/**
 * v2 布局（13.15 更新）：
 *   ┌────────────────── TopBar（毛玻璃）──────────────────┐
 *   │ [logo=当前Agent，左键切换]     当前会话名             │
 *   ├──── SideBar ────┬──────── Workbench ────────────────┤
 *   │ 新建会话         │ logo+名称+徽标+启停/重启/日志/置顶   │
 *   │ 会话列表         │ 输出工具条（清空/复制/导出）          │
 *   │ [用户卡+设置]     │ 输出流（stub 驱动，含流式响应）       │
 *   │                 │ 输入框 + 发送                        │
 *   ├── StatusBar ────┴───────────────────────────────────┤
 * 13.15 裁决：Agent 列表从侧栏删除，切换只走顶栏 logo 唯一按钮；
 * 设置齿轮移到侧栏左下用户卡。数据全部来自 getAgentControlService()（stub/real 唯一切换点）。
 * 设置弹窗沿用既有三组件（13.13 硬规则 6：功能逻辑不动）。
 */
import { useState } from 'react'
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
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <Workbench wb={wb} />
      </div>
      <StatusBar agent={wb.current} />
      <ToastHost />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
