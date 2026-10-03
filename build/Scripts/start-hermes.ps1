# ============================================================================
# start-hermes.ps1
# Launch project-local Hermes Agent (portable, isolated from D:\Hermes).
# Usage:
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-hermes.ps1 --version
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-hermes.ps1 --help
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-hermes.ps1 chat
# ============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

# Load project portable runtimes into THIS process only (no persistent PATH)
. (Join-Path $ScriptDir 'portable-env.ps1')

# Hermes-specific isolation (process scope only). Point config/data at the
# project install, overriding the machine-wide HERMES_HOME (D:\Hermes).
$hh = Join-Path $Root 'Agents\Hermes'
$env:HERMES_HOME = $hh

$hermesExe = Join-Path $hh 'bin\hermes.exe'
if (-not (Test-Path $hermesExe)) {
    Write-Host "[start-hermes] ERROR: hermes.exe not found at $hermesExe" -ForegroundColor Red
    exit 1
}

Write-Host "[start-hermes] HERMES_HOME   = $env:HERMES_HOME"
Write-Host "[start-hermes] Using: $hermesExe"
Write-Host ""

# Non-interactive (--version / --help probe): run directly so the launcher can read
# stdout without opening a window. Interactive launch: prompt_toolkit cannot use the
# PowerShell console host from the GUI, so open a REAL cmd console window.
if ($args.Count -gt 0) {
    & $hermesExe @args
    exit $LASTEXITCODE
}
Start-Process cmd.exe -ArgumentList '/k', "set HERMES_HOME=$hh && `"$hermesExe`""
