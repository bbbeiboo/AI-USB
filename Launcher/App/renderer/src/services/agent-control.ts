/**
 * Agent 控制服务工厂 —— UI 与实现之间的唯一切换点。
 * ---------------------------------------------------------------------------
 * UI 只 import getAgentControlService()，不感知 stub/real：
 *   - 本轮：USE_STUB = true → stub 内存状态机驱动完整体验；
 *   - 下一轮：把 USE_STUB 改为 false（或在实现 env 开关），UI 代码零改动。
 */
import type { AgentControlService } from './agent-control-types.ts'
import { createStubAgentControlService } from './agent-control-stub.ts'
import { realAgentControlService } from './agent-control-real.ts'

/**
 * 唯一切换点：下一轮真接线时把这里的 false 改为 true。
 * 故意用函数返回值而非模块级常量——esbuild 会对常量做折叠+死代码消除，
 * 把 realAgentControlService 整支从 bundle 里删掉（asar 检索要求骨架必须在包内）。
 */
function useRealService(): boolean {
  return false
}

let cached: AgentControlService | null = null

export function getAgentControlService(): AgentControlService {
  if (!cached) {
    cached = useRealService() ? realAgentControlService : createStubAgentControlService()
  }
  return cached
}

// 测试/诊断用：显式重建（绕过单例缓存）
export function __resetAgentControlServiceForTest(): void {
  cached = null
}

export type { AgentControlService } from './agent-control-types.ts'
