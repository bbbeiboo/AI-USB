/**
 * 关于页（13.18 任务书 §3.2）：应用名/版本/构建时间/开源致谢。
 * 版本号与 Launcher/App/package.json 的 1.0.0 对齐（常量注明来源；stub 构建时间）。
 */
export const APP_VERSION = '1.0.0' // 来源：Launcher/App/package.json version
const APP_BUILD_TIME = '<stub 演示，未注入真实构建时间>'

export default function AboutPage() {
  return (
    <div className="space-y-4 p-5">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[20px] font-semibold tracking-tight">AI Agent 母盘</h3>
        <span id="about-version" className="rounded bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">v{APP_VERSION}</span>
      </div>
      <div className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-card">
        <div className="flex items-center justify-between px-3.5 py-2.5 text-[13px]">
          <span className="text-muted-foreground">版本</span>
          <span>{APP_VERSION}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5 text-[13px]">
          <span className="text-muted-foreground">构建时间</span>
          <span className="text-[12px]">{APP_BUILD_TIME}</span>
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5 text-[13px]">
          <span className="text-muted-foreground">四个 Agent</span>
          <span>OpenClaw · Hermes · Codex · Claude Code</span>
        </div>
      </div>
      <div>
        <h4 className="text-[13px] font-semibold">开源致谢</h4>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          本产品基于以下开源项目构建：Electron、React、Vite、TypeScript、Tailwind CSS、
          Radix UI、Lucide Icons、better-sqlite3。感谢这些项目的作者与社区。
        </p>
      </div>
    </div>
  )
}
