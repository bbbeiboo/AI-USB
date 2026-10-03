// 本阶段的假数据与共享类型，集中放在一处便于后续接入真实数据时整体替换。
// 3.6 阶段【不连接任何 IPC】，全部为前端状态。

/** Agent 下拉的选项 */
export interface AgentOption {
  id: string
  name: string
}

/** 一条会话（历史记录） */
export interface Conversation {
  id: string
  title: string
  /** 分组标签：今天 / 昨天 / 更早 */
  group: string
}

/** 一条聊天消息 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

/** 四个 Agent（与 agents.json 的 id 保持一致，便于后续直接接真实数据） */
export const AGENTS: AgentOption[] = [
  { id: 'openclaw', name: 'OpenClaw' },
  { id: 'hermes', name: 'Hermes' },
  { id: 'codex', name: 'Codex' },
  { id: 'claude-code', name: 'Claude Code' },
]

/** 模型下拉（假数据） */
export const MODELS: string[] = ['cloud-deepseek', 'local-qwen', 'local-llama']

/** 会话列表（假数据，按 今天 / 昨天 / 更早 分组） */
export const CONVERSATIONS: Conversation[] = [
  { id: 'c1', title: '整理 U 盘目录结构', group: '今天' },
  { id: 'c2', title: 'OpenClaw 启动失败排查', group: '今天' },
  { id: 'c3', title: '写一份便携版说明文档', group: '昨天' },
  { id: 'c4', title: '比较三个模型的回答质量', group: '更早' },
]

/** 初始消息（假数据：1 条用户 + 1 条 AI） */
export const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: '帮我看一下这台机器上有几个 Agent 可以启动？',
  },
  {
    id: 'm2',
    role: 'assistant',
    content:
      '当前检测到 4 个：OpenClaw、Hermes、Codex、Claude Code，状态都是 READY。你可以用顶部的下拉框切换要对话的 Agent。',
  },
]

/** 生成一个简单的自增 id（仅前端演示用，不参与业务） */
let seq = 100
export function nextId(prefix = 'm'): string {
  seq += 1
  return prefix + seq
}
