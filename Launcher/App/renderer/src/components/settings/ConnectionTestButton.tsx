/**
 * 「验证连接」按钮 —— 用磁盘上**已保存**的配置做一次连通性测试。
 * ---------------------------------------------------------------------------
 * 对应旧 UI 的 testConnBtn（「验证连接」）：
 *   - 只传 configId，主进程自己从 user-config.json + DPAPI 密钥里取配置；
 *   - 单次 GET {base}/models，10 秒硬超时，不重试；
 *   - anthropic-compatible 不猜端点、不发付费请求，返回 kind='blocked'。
 *
 * ⚠️ 与 ApiConfigForm 里的「测试当前表单」不是同一件事：
 *   本组件测的是**已经存下来的那份配置**；「测试当前表单」测的是**输入框里的当前值**
 *   （POST /responses，15 秒）。两个按钮的 title 里都写清楚了，避免用户混淆。
 */
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { testConnection } from '@/services/config-client'
import type { TestConnectionResult } from '@/types/launcher'

interface ConnectionTestButtonProps {
  configId: string
  disabled?: boolean
  /** 按钮文案，默认「验证连接」（沿用旧 UI 的叫法） */
  label?: string
}

export default function ConnectionTestButton({
  configId,
  disabled = false,
  label = '验证连接',
}: ConnectionTestButtonProps) {
  const [state, setState] = useState<'idle' | 'testing' | 'done'>('idle')
  const [result, setResult] = useState<TestConnectionResult | null>(null)

  // 切换 Agent 时清掉上一个 Agent 的结果：否则会看到"B 的按钮旁边挂着 A 的结论"
  useEffect(() => {
    setState('idle')
    setResult(null)
  }, [configId])

  async function handleTest() {
    setState('testing')
    setResult(null)
    const res = await testConnection(configId)
    setResult(res)
    setState('done')
  }

  const testing = state === 'testing'

  return (
    // items-start：结果文字较长换行时不把按钮拉高
    <div className="flex flex-col items-start gap-1">
      <Button
        id="conn-test-saved"
        variant="outline"
        size="sm"
        disabled={disabled || testing || !configId}
        onClick={() => void handleTest()}
        title="用已保存的配置发 1 次 GET /models（10 秒超时，不重试）"
      >
        {testing ? <Loader2 className="size-4 animate-spin" /> : null}
        {testing ? '测试中…' : state === 'done' ? '重试' : label}
      </Button>
      {state === 'done' && result ? <TestConnectionResultLine result={result} /> : null}
    </div>
  )
}

/** 结果行：成功绿 / blocked 黄 / 失败红（导出出来给「测试当前表单」复用同一套配色） */
export function TestConnectionResultLine({ result }: { result: TestConnectionResult }) {
  if (result.ok) {
    const parts: string[] = []
    if (result.status) parts.push('HTTP ' + result.status)
    if (typeof result.latencyMs === 'number') parts.push(result.latencyMs + 'ms')
    return (
      <p id="conn-test-result" className="text-xs text-emerald-600 dark:text-emerald-400">
        {'✓ 连接成功' + (parts.length ? '（' + parts.join(' · ') + '）' : '')}
      </p>
    )
  }
  // blocked 的中文归因由主进程 statusMessage() 给出（anthropic 就是"暂不自动连接测试"）；
  // IPC 未注入时这里会是"IPC 不可用…"，同样如实显示，不会被伪装成 blocked。
  if (result.kind === 'blocked') {
    return (
      <p id="conn-test-result" className="text-xs text-amber-600 dark:text-amber-400">
        {'⚠ ' + (result.message || '该 Provider 类型暂不自动连接测试。')}
      </p>
    )
  }
  return (
    <p id="conn-test-result" className="text-xs text-red-600 dark:text-red-400">
      {'✗ ' + (result.message || result.reason || '连接失败')}
    </p>
  )
}
