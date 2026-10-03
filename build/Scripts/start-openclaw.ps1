# ============================================================================
# start-openclaw.ps1
# Launch OpenClaw using the project-local runtime and portable isolation.
# Usage:
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-openclaw.ps1
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-openclaw.ps1 --version
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-openclaw.ps1 chat --local
# ============================================================================

# Resolve project root from this script's location (Build\Scripts -> root)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

# Load project portable runtimes into THIS process only
. (Join-Path $ScriptDir 'portable-env.ps1')

# OpenClaw-specific isolation (process scope only)
$oc = Join-Path $Root 'Agents\OpenClaw'
$env:OPENCLAW_STATE_DIR   = Join-Path $oc 'Data'
$env:OPENCLAW_CONFIG_PATH = Join-Path $oc 'Config\config.yaml'

# The CLI shim
$cli = Join-Path $oc 'App\node_modules\.bin\openclaw.cmd'
if (-not (Test-Path $cli)) {
  Write-Host "[start-openclaw] ERROR: OpenClaw CLI not found at $cli" -ForegroundColor Red
  exit 1
}

Write-Host "[start-openclaw] OPENCLAW_STATE_DIR   = $env:OPENCLAW_STATE_DIR"
Write-Host "[start-openclaw] OPENCLAW_CONFIG_PATH = $env:OPENCLAW_CONFIG_PATH"
Write-Host "[start-openclaw] Using node: $(node --version)"
Write-Host ""

# Forward all arguments passed to this script to openclaw
& $cli @args
exit $LASTEXITCODE
