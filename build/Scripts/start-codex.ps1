# ============================================================================
# start-codex.ps1
# Launch project-local OpenAI Codex CLI (portable, isolated from ~/.codex).
# Usage:
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-codex.ps1 --version
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-codex.ps1 doctor
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-codex.ps1 exec "say hi"
# ============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

# Load project portable runtimes into THIS process only
. (Join-Path $ScriptDir 'portable-env.ps1') | Out-Null

# Redirect Codex config/data/cache into the project (process scope only).
$cx = Join-Path $Root 'Agents\Codex'
$env:CODEX_HOME = $cx

$codexCmd = Join-Path $cx 'App\node_modules\.bin\codex.cmd'
if (-not (Test-Path $codexCmd)) {
    Write-Host "[start-codex] ERROR: codex.cmd not found at $codexCmd" -ForegroundColor Red
    exit 1
}

Write-Host "[start-codex] CODEX_HOME = $env:CODEX_HOME"
Write-Host "[start-codex] Using: $codexCmd"
Write-Host ""

# Non-interactive probe: run directly. Interactive: open a real cmd console.
if ($args.Count -gt 0) {
    & $codexCmd @args
    exit $LASTEXITCODE
}
$env:PATH = "$cx\App\node_modules\.bin;$env:PATH"
Start-Process cmd.exe -ArgumentList '/k', "set CODEX_HOME=$cx && `"$codexCmd`""
