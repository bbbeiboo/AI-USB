/**
 * 用量统计类 IPC 封装（preload.js 的 usage:* 部分）。
 *
 * 与 config-client 同一套设计原则：所有函数 async 且永不抛异常，
 * IPC 未注入或主进程抛错时返回 { ok:false } 兜底，绝不把异常抛给 React 组件。
 */
import { ipc, safeInvoke } from './ipc'
import type { UsageDashboardResult, UsageExportResult } from '@/types/launcher'

/** IPC 不可用时的统一兜底文案 */
const NO_IPC = 'IPC 不可用（preload.js 未加载）'

/** 汇总看板：近 N 天的请求 / token / 费用与 byAgent / byProvider / byModel 三个维度 */
export function getUsageDashboard(days: number): Promise<UsageDashboardResult> {
  return safeInvoke('getUsageDashboard', () => ipc.usageDashboard(days), { ok: false, error: NO_IPC })
}

/** 导出用量明细：主进程写盘后调 shell.showItemInFolder */
export function exportUsage(format: 'csv' | 'json'): Promise<UsageExportResult> {
  return safeInvoke('exportUsage', () => ipc.usageExport(format), { ok: false, error: NO_IPC })
}

/** 清空全部用量记录（不可恢复，UI 侧必须二次确认后才调用） */
export function clearUsage(): Promise<{ ok: boolean; error?: string }> {
  return safeInvoke('clearUsage', () => ipc.usageClear(), { ok: false, error: NO_IPC })
}
