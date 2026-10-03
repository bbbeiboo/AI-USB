# ============================================================================
# check-codex.ps1
# Project Codex self-check. Read-only. No API key, no login.
# Outputs [1]..[14] and final PASS / WARN / FAIL.
# ============================================================================
$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

. (Join-Path $ScriptDir 'portable-env.ps1') | Out-Null
$cx = Join-Path $Root 'Agents\Codex'
$env:CODEX_HOME = $cx
$codexCmd = Join-Path $cx 'App\node_modules\.bin\codex.cmd'

$script:fails = 0
$script:warns = 0
function Mark($ok, $msg) {
  if ($ok -eq $true)      { Write-Output "[OK]   $msg" }
  elseif ($ok -eq 'WARN') { Write-Output "[WARN] $msg"; $script:warns++ }
  else                    { Write-Output "[FAIL] $msg"; $script:fails++ }
}

Write-Output "=== Codex Self-Check ==="
Write-Output "CODEX_HOME = $cx"

# [1] installed
Mark (Test-Path $codexCmd) "[1] Codex installed"

# [2] version
$ver = & $codexCmd --version 2>&1 | Out-String
Mark ($ver -match 'codex-cli') "[2] Version: $(($ver -split "`n")[0].Trim())"

# [3] executable (native binary)
$native = Join-Path $cx 'App\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
Mark (Test-Path $native) "[3] Native executable present"

# [4] runtime (node via project Runtime)
Mark ((node --version 2>$null) -match 'v24') "[4] Runtime node: $(node --version 2>$null)"

# [5] config
$cfg = Join-Path $cx 'config.toml'
Mark (Test-Path $cx) "[5] Config dir (CODEX_HOME) present"

# [6] data
Mark (Test-Path (Join-Path $cx 'Data')) "[6] Data dir present"

# [7] cache
Mark (Test-Path (Join-Path $cx 'Cache')) "[7] Cache dir present"

# [8] logs
Mark (Test-Path (Join-Path $cx 'Logs')) "[8] Logs dir present"

# [9] credentials: check project CODEX_HOME for auth.json with real token
$auth = Join-Path $cx 'auth.json'
$realCred = $false
if (Test-Path $auth) {
  $txt = Get-Content $auth -Raw -ErrorAction SilentlyContinue
  $realCred = ($txt -match 'sk-|access_token|refresh_token' -and $txt.Length -gt 50)
}
Mark (-not $realCred) "[9] Credentials: no real token in project CODEX_HOME"

# [10] persisted PATH
$u = [Environment]::GetEnvironmentVariable('Path','User')
$m = [Environment]::GetEnvironmentVariable('Path','Machine')
$hit = (($u -split ';') + ($m -split ';')) | Where-Object { $_ -match 'Agents\\Codex' }
Mark ($hit.Count -eq 0) "[10] Persisted PATH: no project Codex entry"

# [11] user dir (~/.codex not newly written by project run)
$uhermes = Join-Path $env:USERPROFILE '.codex'
$recent = $false
if (Test-Path $uhermes) {
  $recent = [bool](Get-ChildItem $uhermes -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-30) })
}
Mark (-not $recent) "[11] User ~/.codex: not touched by project run"

# [12] portable launcher
Mark (Test-Path (Join-Path $ScriptDir 'start-codex.ps1')) "[12] start-codex.ps1 present"

# [13] OpenClaw isolation (quick version)
$env:OPENCLAW_STATE_DIR   = Join-Path $Root 'Agents\OpenClaw\Data'
$env:OPENCLAW_CONFIG_PATH = Join-Path $Root 'Agents\OpenClaw\Config\config.yaml'
$ocVer = & (Join-Path $Root 'Agents\OpenClaw\App\node_modules\.bin\openclaw.cmd') --version 2>$null
Mark ([bool](($ocVer -join "`n") -match '2026\.9\.5')) "[13] OpenClaw still: $(($ocVer | Select-Object -First 1))"

# [14] Hermes isolation (quick version)
$env:HERMES_HOME = Join-Path $Root 'Agents\Hermes'
$hVer = & (Join-Path $Root 'Agents\Hermes\bin\hermes.exe') --version 2>$null
Mark ([bool](($hVer -join "`n") -match '0\.21\.4')) "[14] Hermes still: $(($hVer | Select-Object -First 1))"

Write-Output ""
Write-Output "=== SUMMARY: fails=$($script:fails) warns=$($script:warns) ==="
if ($script:fails -gt 0) { Write-Output "FINAL: FAIL" }
elseif ($script:warns -gt 0) { Write-Output "FINAL: WARN (PASS with notes)" }
else { Write-Output "FINAL: PASS" }
