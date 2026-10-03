/**
 * IPC 单点访问层。
 * ---------------------------------------------------------------------------
 * 为什么需要这一层：
 *  1) window.launcher 由 preload.js 在 Electron 里注入；用浏览器直接打开
 *     renderer/dist 或 Vite dev 页面时它是 undefined。集中在这里判空并打一条可读日志，
 *     避免每个调用点都写一遍可选链。
 *  2) 类型来自 @/types/launcher，调用方拿得到补全与参数校验。
 */
import type { LauncherApi } from '@/types/launcher'

/** preload.js 是否已注入（浏览器直开 renderer 时为 false） */
export const hasLauncher: boolean = typeof window !== 'undefined' && !!window.launcher

if (!hasLauncher) {
  console.error('[ipc] window.launcher 不存在，preload.js 可能未加载')
}

/**
 * preload 暴露的原始接口。
 * 这里断言为非空：真正的"能不能用"请用 hasLauncher 判断，
 * 或者直接用下面的 safeInvoke（它会把"未注入"和"调用抛异常"统一转成兜底返回值）。
 */
export const ipc = window.launcher as LauncherApi

/**
 * 统一的 IPC 调用包装。
 * IPC 未注入、或主进程调用抛异常时返回 fallback，绝不把异常抛给 React 组件
 * （否则一次 IPC 失败就会让整个设置面板白屏）。
 *
 * @param label    出错时打进控制台的名字，便于定位是哪个调用失败
 * @param fn       实际调用，写成 () => ipc.xxx() 的形式
 * @param fallback 兜底返回值，通常传 { ok: false, reason: '...' }
 */
export async function safeInvoke<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!hasLauncher) {
    console.error('[ipc] ' + label + ' 跳过：window.launcher 未注入')
    return fallback
  }
  try {
    return await fn()
  } catch (e) {
    console.error('[ipc] ' + label + ' 失败：', e)
    return fallback
  }
}
