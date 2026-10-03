# ============================================================================
# portable-env.ps1
# Purpose: Prepend the project's OWN portable runtimes to the CURRENT process
#          PATH only. Does NOT modify system PATH or user PATH permanently.
# Usage  : . .\Build\Scripts\portable-env.ps1   (dot-source in your session)
# ============================================================================

# Resolve project root = two levels up from this script (Build\Scripts -> root)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

$env:PORTABLE_ROOT = $Root

$candidates = @(
  (Join-Path $Root 'Runtime\Node'),
  (Join-Path $Root 'Runtime\Python'),
  (Join-Path $Root 'Runtime\Python\Scripts'),
  (Join-Path $Root 'Runtime\Git\cmd'),
  (Join-Path $Root 'Runtime\Git\bin'),
  (Join-Path $Root 'Runtime\Git-LFS'),
  (Join-Path $Root 'Runtime\Tools')
)

# Only prepend dirs that actually exist
$prepend = @()
foreach ($c in $candidates) {
  if (Test-Path $c) { $prepend += $c }
}

# Prepend in one shot (process scope only; no SetEnvironmentVariable calls)
$env:PATH = ($prepend -join ';') + ';' + $env:PATH

# --- Neutralize host development-environment pollution (process scope) -----
# A customer machine normally has these unset. On a dev machine they would make
# the project Python/Node import host packages or resolve the wrong venv. Clear
# them for THIS process only; nothing is written to the registry/user env.
foreach ($poll in @('PYTHONPATH','PYTHONHOME','NODE_PATH','VIRTUAL_ENV','PYTHONSTARTUP')) {
  if (Test-Path "Env:$poll") { Remove-Item "Env:$poll" -ErrorAction SilentlyContinue }
}
$env:PYTHONNOUSERSITE = '1'
$env:PIP_NO_USER      = '1'

# --- Redirect config/cache to UserData (process scope only) ---------------
$ud = Join-Path $Root 'UserData'

# Git / shells: keep HOME and global gitconfig inside the project
$env:HOME                = (Join-Path $ud 'home')
$env:GIT_CONFIG_GLOBAL   = (Join-Path $ud 'git\config')
# XDG-based tools (many CLIs / MCP servers)
$env:XDG_CONFIG_HOME     = (Join-Path $ud 'xdg-config')
$env:XDG_CACHE_HOME      = (Join-Path $ud 'xcache')
# npm: cache + global install prefix (so `npm i -g` does not write to user dir)
$env:npm_config_cache    = (Join-Path $ud 'npm-cache')
$env:npm_config_prefix   = (Join-Path $ud 'npm-global')
# pip: cache + deterministic project config file
$env:PIP_CACHE_DIR       = (Join-Path $ud 'pip-cache')
$env:PIP_CONFIG_FILE     = (Join-Path $ud 'pip\pip.ini')

Write-Host "[portable-env] PORTABLE_ROOT = $Root"
Write-Host "[portable-env] Prepended to CURRENT process PATH:"
foreach ($p in $prepend) { Write-Host "    - $p" }
Write-Host "[portable-env] Redirected config/cache -> UserData (process scope only):"
Write-Host "    HOME                = $env:HOME"
Write-Host "    GIT_CONFIG_GLOBAL   = $env:GIT_CONFIG_GLOBAL"
Write-Host "    XDG_CONFIG_HOME     = $env:XDG_CONFIG_HOME"
Write-Host "    XDG_CACHE_HOME      = $env:XDG_CACHE_HOME"
Write-Host "    npm_config_cache    = $env:npm_config_cache"
Write-Host "    npm_config_prefix   = $env:npm_config_prefix"
Write-Host "    PIP_CACHE_DIR       = $env:PIP_CACHE_DIR"
Write-Host "    PIP_CONFIG_FILE     = $env:PIP_CONFIG_FILE"
Write-Host "[portable-env] System/user PATH and user profile were NOT modified."
