/**
 * Agent 控制服务工厂 —— UI 与实现之间的唯一切换点。
 * ---------------------------------------------------------------------------
 * 13.22 起：preload 注入了 Hermes 真实会话桥（window.launcher.hermesSessionList）
 * 时返回「混合服务」——hermes 走官方 ACP 真实链路，其余 Agent/能力回落 stub。
 * 测试/浏览器直开（无 preload）环境自动回 stub，UI 代码零改动。
 */
import type { AgentControlService } from './agent-control-types.ts'
import { createStubAgentControlService } from './agent-control-stub.ts'
import { realAgentControlService } from './agent-control-real.ts'
import { createHybridAgentControlService } from './agent-control-hybrid.ts'

/**
 * 旧切换点保留：realAgentControlService（全量真实骨架）仍是下一阶段的目标形态。
 * 故意用函数返回值而非模块级常量——esbuild 会对常量做折叠+死代码消除，
 * 把 realAgentControlService 整支从 bundle 里删掉（asar 检索要求骨架必须在包内）。
 */
function useRealService(): boolean {
  return false
}

let cached: AgentControlService | null = null

export function getAgentControlService(): AgentControlService {
  if (!cached) {
    const bridge = typeof window !== 'undefined' ? window.launcher : undefined
    if (bridge && typeof bridge.hermesSessionList === 'function') {
      cached = createHybridAgentControlService(createStubAgentControlService(), bridge)
    } else {
      cached = useRealService() ? realAgentControlService : createStubAgentControlService()
    }
  }
  return cached
}

// 测试/诊断用：显式重建（绕过单例缓存）
export function __resetAgentControlServiceForTest(): void {
  cached = null
}

export type { AgentControlService } from './agent-control-types.ts'
