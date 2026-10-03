# ============================================================================
# start-launcher.ps1
# Launch the portable AI Agent Launcher (Electron) from the mother folder.
# Resolves root dynamically; no hard-coded drive letter; no persistent PATH.
# ============================================================================
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

. (Join-Path $ScriptDir 'portable-env.ps1') | Out-Null

$elec = Join-Path $Root 'Launcher\App\node_modules\.bin\electron.cmd'
if (-not (Test-Path $elec)) {
    Write-Host "[start-launcher] ERROR: electron.cmd not found at $elec" -ForegroundColor Red
    exit 1
}
Write-Host "[start-launcher] Root = $Root"
Write-Host "[start-launcher] Launcher UI starting..."
# Pass through any extra args (e.g. --selftest).
& $elec (Join-Path $Root 'Launcher\App') @args
exit $LASTEXITCODE
