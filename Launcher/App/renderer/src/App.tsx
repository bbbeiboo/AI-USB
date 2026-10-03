/**
 * v2 布局（13.13：Apple 风格 + 全量公共按钮 + stub 服务接口层）：
 *   ┌────────────────── TopBar（毛玻璃）──────────────────┐
 *   │ AI Agent      当前会话名           [切换器][设置]    │
 *   ├──── SideBar ────┬──────── Workbench ────────────────┤
 *   │ 新建会话         │ 头像+名称+徽标+启停/重启/日志/置顶   │
 *   │ Agent 列表       │ 输出工具条（清空/复制/导出）          │
 *   │ 会话列表         │ 输出流（stub 驱动，含流式响应）       │
 *   │                 │ 输入框 + 发送                        │
 *   ├── StatusBar ────┴───────────────────────────────────┤
 * 数据全部来自 getAgentControlService()（stub/real 唯一切换点，见 services/agent-control.ts）。
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
   * 设置弹窗开关：两处入口（顶栏齿轮 app-settings）→ 根节点持有。
   * 弹窗内部逻辑不动（打开时才拉数据，约束 7）。
   */
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <TopBar
        sessionTitle={wb.sessionTitle}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <SideBar
          agents={wb.agents}
          currentId={wb.current?.id ?? null}
          sessions={wb.sessions}
          sessionId={wb.sessionId}
          onSwitchAgent={(id) => void wb.switchAgent(id)}
          onNewSession={() => void wb.newSession()}
          onSwitchSession={(id) => void wb.switchSession(id)}
        />
        <Workbench wb={wb} />
      </div>
      <StatusBar agent={wb.current} />
      <ToastHost />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
