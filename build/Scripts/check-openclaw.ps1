# ============================================================================
# check-openclaw.ps1
# Verify OpenClaw install, paths, and check for system pollution.
# ============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

. (Join-Path $ScriptDir 'portable-env.ps1') | Out-Null

$oc  = Join-Path $Root 'Agents\OpenClaw'
$cli = Join-Path $oc 'App\node_modules\.bin\openclaw.cmd'
$env:OPENCLAW_STATE_DIR   = Join-Path $oc 'Data'
$env:OPENCLAW_CONFIG_PATH = Join-Path $oc 'Config\config.yaml'

$fail = 0
function Ok($m)   { Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; $script:fail++ }

Write-Host "=== OpenClaw Install Check ==="

# 1. CLI exists
if (Test-Path $cli) { Ok "CLI present: $cli" } else { Fail "CLI missing: $cli" }

# 2. Version (actually run it)
if (Test-Path $cli) {
  $v = & $cli --version 2>&1 | Where-Object { $_ -match '^OpenClaw' } | Select-Object -First 1
  if ($v) { Ok "Version: $v" } else { Fail "openclaw --version produced no OpenClaw line" }
}

# 3. Config path resolves
if (Test-Path $cli) {
  $cfg = & $cli config file 2>&1 | Where-Object { $_ -match 'Agents.OpenClaw' } | Select-Object -First 1
  if ($cfg) { Ok "Config path: $cfg" }
  else { Warn "Config path unexpected (see stderr)" }
}

# 4. Folders
foreach ($d in @('App','Config','Runtime','Cache','Logs','Data')) {
  $p = Join-Path $oc $d
  if (Test-Path $p) { Ok "Folder $d/ exists" } else { Warn "Folder $d/ missing" }
}

# 5. Used runtimes
Ok ("node = " + (node --version) + "  npm = " + (npm --version))

# 6. Pollution: persistent PATH
$userPath = [Environment]::GetEnvironmentVariable('PATH','User')
$machPath = [Environment]::GetEnvironmentVariable('PATH','Machine')
if (($userPath -match 'openclaw') -or ($machPath -match 'openclaw')) { Fail "openclaw found in persistent PATH" }
else { Ok "Persistent PATH clean (no openclaw)" }

# 7. npm global should not contain openclaw
$g = npm ls -g --depth=0 2>&1 | Out-String
if ($g -match 'openclaw') { Warn "openclaw appears in npm global list" } else { Ok "npm global has no openclaw (local install)" }

# 8. Disk usage
$size = (Get-ChildItem $oc -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
Ok ("OpenClaw folder size: {0:N1} MB" -f ($size/1MB))

Write-Host ""
Write-Host "=== Summary: $(if ($fail -eq 0) {'PASS'} else {'FAIL'}) ($fail failures) ==="
exit $fail
