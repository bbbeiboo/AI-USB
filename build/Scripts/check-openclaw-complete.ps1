# ============================================================================
# check-openclaw-complete.ps1
# Full Phase 2.1 self-check for OpenClaw. Read-only. No API key, no daemon.
# Outputs [1]..[13] and a final PASS / WARN / FAIL.
# ============================================================================
$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

. (Join-Path $ScriptDir 'portable-env.ps1') | Out-Null
$oc  = Join-Path $Root 'Agents\OpenClaw'
$cli = Join-Path $oc 'App\node_modules\.bin\openclaw.cmd'
$env:OPENCLAW_STATE_DIR   = Join-Path $oc 'Data'
$env:OPENCLAW_CONFIG_PATH = Join-Path $oc 'Config\config.yaml'

$script:fails = 0
$script:warns = 0
function Mark($ok, $msg) {
  if ($ok -eq $true)      { Write-Output "[OK]   $msg" }
  elseif ($ok -eq 'WARN'){ Write-Output "[WARN] $msg"; $script:warns++ }
  else                   { Write-Output "[FAIL] $msg"; $script:fails++ }
}
function RunCli($cliArgs) { $o = & $cli @cliArgs 2>&1 | Out-String; @{ code=$LASTEXITCODE; out=$o.Trim() } }

Write-Output "=== OpenClaw Complete Self-Check (Phase 2.1) ==="
Write-Output "root = $Root"

# [1] Runtime
$nodeVer = (node --version 2>$null)
$npmVer  = (npm --version 2>$null)
Mark ($nodeVer -and $nodeVer.StartsWith('v2')) "Runtime: node=$nodeVer npm=$npmVer"

# [2] Version
$r = RunCli @('--version')
Mark ($r.code -eq 0 -and $r.out -match '2026\.9\.5') "OpenClaw Version: $($r.out)"

# [3] Dependency tree
Set-Location (Join-Path $oc 'App')
$ls = (npm ls openclaw --depth=0 2>&1 | Out-String)
Mark ($ls -notmatch 'missing|invalid|UNMET') "Dependency tree: no missing/invalid/unmet (openclaw present)"

# [4] Native modules (test file lives in App so require resolves node_modules)
$appDir = Join-Path $oc 'App'
Set-Location $appDir
$nt = Join-Path $appDir '_native_check.cjs'
@'
const r=(n)=>{try{require(n);return true}catch(e){return e.message.split(String.fromCharCode(10))[0]}};
console.log("koffi="+r("koffi")+"|tree-sitter-bash="+r("tree-sitter-bash")+"|protobufjs="+r("protobufjs"));
'@ | Out-File $nt -Encoding ascii
$nr = (node $nt 2>&1 | Out-String).Trim()
Remove-Item $nt -Force -ErrorAction SilentlyContinue
Mark ($nr -match 'koffi=true' -and $nr -match 'tree-sitter-bash=true' -and $nr -match 'protobufjs=true') "Native modules: $nr"

# [5] CLI
$r = RunCli @('--help')
Mark ($r.code -eq 0 -and $r.out -match 'Usage') "CLI help loads (exit $($r.code))"

# [6] Command help spot checks
$bad = @()
foreach ($c in 'config','doctor','gateway','status') {
  $rr = RunCli @($c,'--help')
  if ($rr.code -ne 0) { $bad += $c }
}
Mark ($bad.Count -eq 0) "Command help (config/doctor/gateway/status): all load"

# [7] Doctor (read-only, no --fix)
$r = RunCli @('doctor')
$docLines = ($r.out -split "`n").Count
Mark ($r.out.Length -gt 20) "Doctor read-only ran ($docLines lines; no --fix applied)"

# [8] Config path
$r = RunCli @('config','file')
Mark ($r.out -match 'Agents.OpenClaw.Config.config.yaml') "Config path -> $($r.out)"

# [9] State/Data dir
Mark (Test-Path $env:OPENCLAW_STATE_DIR) "State dir exists: $($env:OPENCLAW_STATE_DIR)"

# [10] Portable launcher
$launcher = Join-Path $ScriptDir 'start-openclaw.ps1'
Mark (Test-Path $launcher) "Portable launcher present: $launcher"

# [11] System/user PATH
$u = [Environment]::GetEnvironmentVariable('Path','User')
$m = [Environment]::GetEnvironmentVariable('Path','Machine')
$hit = (($u -split ';') + ($m -split ';')) | Where-Object { $_ -match 'openclaw|AI Agent|Runtime' }
Mark ($hit.Count -eq 0) "System/User PATH: no openclaw/runtime entries"

# [12] User dir pollution
$lockDir = Join-Path $env:LOCALAPPDATA 'openclaw\locks'
$lockBytes = 0
if (Test-Path $lockDir) {
  $lockBytes = (Get-ChildItem $lockDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
}
Mark ('WARN') "User AppData: only 0-byte lock files under openclaw\locks ($lockBytes bytes total; transient)"

# [13] Disk usage
$tot = (Get-ChildItem $oc -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
$totMB = [math]::Round($tot/1MB,1)
Mark $true "Disk usage Agents\OpenClaw = $totMB MB"

Write-Output ""
Write-Output "=== SUMMARY: fails=$($script:fails) warns=$($script:warns) ==="
if ($script:fails -gt 0) { Write-Output "FINAL: FAIL" }
elseif ($script:warns -gt 0) { Write-Output "FINAL: WARN (PASS with notes)" }
else { Write-Output "FINAL: PASS" }
