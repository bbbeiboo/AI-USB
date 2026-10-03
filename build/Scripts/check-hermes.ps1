# ============================================================================
# check-hermes.ps1
# Project Hermes self-check. Read-only. No API key, no daemon.
# Outputs [1]..[12] and final PASS / WARN / FAIL.
# ============================================================================
$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

. (Join-Path $ScriptDir 'portable-env.ps1') | Out-Null
$hh = Join-Path $Root 'Agents\Hermes'
$env:HERMES_HOME = $hh
$hermesExe = Join-Path $hh 'bin\hermes.exe'

$script:fails = 0
$script:warns = 0
function Mark($ok, $msg) {
  if ($ok -eq $true)        { Write-Output "[OK]   $msg" }
  elseif ($ok -eq 'WARN')   { Write-Output "[WARN] $msg"; $script:warns++ }
  else                      { Write-Output "[FAIL] $msg"; $script:fails++ }
}

Write-Output "=== Hermes Self-Check ==="
Write-Output "HERMES_HOME = $hh"

# [1] installed
Mark (Test-Path $hermesExe) "[1] Hermes installed: $hermesExe"

# [2] version
$ver = & $hermesExe --version 2>&1 | Out-String
Mark ($ver -match 'v0\.') "[2] Version: $(($ver -split "`n")[0].Trim())"

# [3] executable
Mark (Test-Path $hermesExe) "[3] Executable: bin\hermes.exe"

# [4] runtime (python venv)
$py = Join-Path $hh 'hermes-agent\venv\Scripts\python.exe'
Mark (Test-Path $py) "[4] Python venv: $(if(Test-Path $py){'present'}else{'missing'})"

# [5] config
Mark (Test-Path (Join-Path $hh 'config.yaml')) "[5] Config: Agents\Hermes\config.yaml"

# [6] data / sessions
Mark (Test-Path (Join-Path $hh 'sessions')) "[6] Data/sessions dir present"

# [7] cache
$cachePresent = (Test-Path (Join-Path $hh 'audio_cache')) -or (Test-Path (Join-Path $hh 'image_cache'))
Mark ($cachePresent) "[7] Cache dirs present (audio/image)"

# [8] logs
Mark (Test-Path (Join-Path $hh 'logs')) "[8] Logs dir present"

# [9] credentials location (no real key)
$envFile = Join-Path $hh '.env'
$realKey = $false
if (Test-Path $envFile) {
  $realKey = [bool](Get-Content $envFile | Where-Object { $_ -notmatch '^\s*#' -and $_ -match 'sk-[a-zA-Z0-9]{20,}' })
}
Mark (-not $realKey) "[9] Credentials: .env in project, NO real key (template only)"

# [10] PATH pollution (persisted)
$u = [Environment]::GetEnvironmentVariable('Path','User')
$m = [Environment]::GetEnvironmentVariable('Path','Machine')
$hit = (($u -split ';') + ($m -split ';')) | Where-Object { $_ -match 'Agents\\Hermes' }
Mark ($hit.Count -eq 0) "[10] Persisted PATH: no project Hermes entry"

# [11] user dir pollution (~/.hermes)
$uhermes = Join-Path $env:USERPROFILE '.hermes'
Mark (-not (Test-Path $uhermes)) "[11] User dir: no ~/.hermes (config stays in project)"

# [12] portable launcher present
Mark (Test-Path (Join-Path $ScriptDir 'start-hermes.ps1')) "[12] Portable launcher start-hermes.ps1 present"

Write-Output ""
Write-Output "=== SUMMARY: fails=$($script:fails) warns=$($script:warns) ==="
if ($script:fails -gt 0) { Write-Output "FINAL: FAIL" }
elseif ($script:warns -gt 0) { Write-Output "FINAL: WARN (PASS with notes)" }
else { Write-Output "FINAL: PASS" }
