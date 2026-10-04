/**
 * 四 Agent 官方身份档案（getInfo 数据源）——与 docs/AGENT-SOURCES.md 一一对应。
 * 版本为项目锁定版本（取证命令见 AGENT-SOURCES.md §基线裁决）；
 * versionNote 为静态记录（stub 不联网探测）。
 */
import type { AgentInfo } from '../agent-control-types.ts'

export const AGENT_INFO_RECORD: Record<string, AgentInfo> = {
  openclaw: {
    id: 'openclaw',
    name: 'OpenClaw',
    version: '2026.9.5',
    repoUrl: 'https://github.com/openclaw/openclaw',
    docsUrl: 'https://docs.openclaw.ai',
    localEntry: 'openclaw 命令（agents/OpenClaw/App 内 npm 安装）',
    configEntrance: 'agents/OpenClaw/Config/config.yaml（经 OPENCLAW_CONFIG_PATH；官方格式为 JSON5 openclaw.json）',
    versionNote: '官方最新 2026.9.8（2026-10-03 发布），本地落后 3 个 patch 版本',
  },
  hermes: {
    id: 'hermes',
    name: 'Hermes',
    version: '0.21.4',
    repoUrl: 'https://github.com/NousResearch/hermes-agent',
    docsUrl: 'https://github.com/NousResearch/hermes-agent#readme',
    localEntry: 'agents/Hermes/bin/hermes.exe（经 start-hermes.ps1 控制台窗口启动）',
    configEntrance: 'agents/Hermes/config.yaml（HERMES_HOME 隔离；密钥经环境变量注入，文件内零明文）',
    versionNote: '上游已大幅前进（本地提示 7900 commits behind）；能力基线以锁定版 0.21.4 本地官方源码为准',
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    version: '0.156.1',
    repoUrl: 'https://github.com/openai/codex',
    docsUrl: 'https://developers.openai.com/codex',
    localEntry: 'codex 命令（agents/Codex/App 内 npm 包 @openai/codex）',
    configEntrance: 'agents/Codex/config.toml（[model_providers.*]/[tui]/[projects]/[windows]）',
    versionNote: '官方最新 0.160.0（npm registry，2026-10-03 核实），本地落后 0.157~0.160 四个 minor',
  },
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    version: '2.1.288',
    repoUrl: 'https://github.com/anthropics/claude-code',
    docsUrl: 'https://code.claude.com/docs',
    localEntry: 'claude 命令（⚠ 机器级全局安装，不在便携树内）',
    configEntrance: 'agents/ClaudeCode/settings.json（用户级 ~/.claude 不属于本盘）',
    versionNote: 'npm latest 2.1.289 / 原生 stable 通道 2.1.285（2026-10-03 核实），本机 2.1.288 居中',
  },
}
