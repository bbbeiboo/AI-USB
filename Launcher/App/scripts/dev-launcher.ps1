<#
  dev-launcher.ps1 —— AI Agent Launcher 的统一启动入口

  为什么需要它（两个实测踩过的坑）：
    1) DSH 宿主会给每条命令的进程环境注入 ELECTRON_RUN_AS_NODE=1，
       直接跑 electron 会退化成 Node 模式：窗口不出现，--selftest 报 "bad option"。
       本脚本启动前先清除该变量。
    2) PowerShell 用 & 启动 GUI 子系统程序【不会等待】，$LASTEXITCODE 为空、stdout 也拿不到。
       本脚本统一改用 Start-Process -Wait + 重定向到临时文件来采集输出与退出码。

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-launcher.ps1 -Mode dev
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-launcher.ps1 -Mode prod
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-launcher.ps1 -Mode selftest
#>
[CmdletBinding()]
param(
  [ValidateSet('dev', 'prod', 'selftest', 'selftest-config', 'selftest-p9')]
  [string]$Mode = 'dev'
)

$ErrorActionPreference = 'Stop'

# scripts/ 的上一级目录就是 Launcher/App
$AppDir   = Split-Path -Parent $PSScriptRoot
$Electron = Join-Path $AppDir 'node_modules\electron\dist\electron.exe'

Write-Host "[dev-launcher] Mode=$Mode" -ForegroundColor Cyan
Write-Host "[dev-launcher] AppDir=$AppDir"

# --- 1) 清除 DSH 注入的 ELECTRON_RUN_AS_NODE（不清则 Electron 变 Node） ---
if (Test-Path Env:ELECTRON_RUN_AS_NODE) {
  Write-Host "[dev-launcher] 检测到 ELECTRON_RUN_AS_NODE=$env:ELECTRON_RUN_AS_NODE，已清除（否则 Electron 以 Node 模式运行）" -ForegroundColor Yellow
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}

# --- 2) 前置检查，失败时给出可操作提示而不是白屏 ---
if (-not (Test-Path -LiteralPath $Electron)) {
  Write-Error "找不到 Electron：$Electron ；请先在 Launcher/App 下执行 npm install"
  exit 1
}

$distIndex = Join-Path $AppDir 'renderer\dist\index.html'
if ($Mode -eq 'prod' -and -not (Test-Path -LiteralPath $distIndex)) {
  Write-Warning "renderer/dist/index.html 不存在，生产分支会加载失败，请先执行 npm run build:web"
}

if ($Mode -eq 'dev') {
  # 快速探测 5173 是否在监听（TcpClient 比 Test-NetConnection 快得多）
  $listening = $false
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    # 必须用 localhost：Vite 8 默认只绑 IPv6 回环 ::1，
    # 用 127.0.0.1 探测会误报"未监听"（实测 Get-NetTCPConnection 显示 ::1:5173）
    $tcp.Connect('localhost', 5173)
    $listening = $true
    $tcp.Close()
  } catch { $listening = $false }
  if (-not $listening) { Write-Warning "localhost:5173 未监听，开发分支会白屏；请先执行 npm run dev:web" }
}

# --- 3) 组装启动参数与环境变量 ---
$argList   = @('.')
$envBackup = @{}
switch ($Mode) {
  'dev'             { }  # 不设 NODE_ENV：main.js 靠 !app.isPackaged 判定为开发分支
  'prod'            { $envBackup['NODE_ENV'] = $env:NODE_ENV; $env:NODE_ENV = 'production' }
  'selftest'        { $argList += '--selftest' }
  'selftest-config' { $argList += '--selftest-config' }
  'selftest-p9'     { $argList += '--selftest-p9' }
}

# --- 4) 启动并等待（GUI 程序必须用 Start-Process -Wait 才能拿到退出码） ---
$outLog = Join-Path $env:TEMP ("ai-agent-launcher-{0}.out.log" -f $Mode)
$errLog = Join-Path $env:TEMP ("ai-agent-launcher-{0}.err.log" -f $Mode)
Remove-Item -LiteralPath $outLog, $errLog -ErrorAction SilentlyContinue

Write-Host ("[dev-launcher] 启动：{0} {1}" -f $Electron, ($argList -join ' '))
# 用 splatting 传参，避免 PowerShell 反引号续行（反引号在 JS 模板里会截断字符串）
$startParams = @{
  FilePath               = $Electron
  ArgumentList           = $argList
  WorkingDirectory       = $AppDir
  NoNewWindow            = $true
  Wait                   = $true
  PassThru               = $true
  RedirectStandardOutput = $outLog
  RedirectStandardError  = $errLog
}
$proc = Start-Process @startParams

# --- 5) 回显子进程输出（selftest 的 SELFTEST_JSON 就在这里） ---
if (Test-Path -LiteralPath $outLog) { Get-Content -LiteralPath $outLog | Write-Host }
if (Test-Path -LiteralPath $errLog) {
  $errText = Get-Content -LiteralPath $errLog -Raw -ErrorAction SilentlyContinue
  if ($errText -and $errText.Trim()) { Write-Host $errText -ForegroundColor DarkYellow }
}

# --- 6) 还原被临时改写的环境变量，避免影响后续命令 ---
foreach ($k in $envBackup.Keys) { Set-Item -Path "Env:$k" -Value $envBackup[$k] }

Write-Host "[dev-launcher] 退出码 = $($proc.ExitCode)" -ForegroundColor Cyan
exit $proc.ExitCode
