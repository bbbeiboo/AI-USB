# ============================================================================
# check-launcher.ps1 - verify the four-agent portable launcher (read-only).
# ============================================================================
$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

. (Join-Path $ScriptDir 'portable-env.ps1') | Out-Null
$script:fails=0; $script:warns=0
function Mark($ok,$msg){ if($ok -eq $true){Write-Output "[OK]   $msg"}elseif($ok -eq 'WARN'){Write-Output "[WARN] $msg";$script:warns++}else{Write-Output "[FAIL] $msg";$script:fails++} }

Write-Output "=== Launcher Self-Check ==="

# 1 Launcher files present
Mark (Test-Path (Join-Path $Root 'Launcher\App\main.js')) "[1] main.js present"
Mark (Test-Path (Join-Path $Root 'Launcher\App\preload.js')) "[1b] preload.js present"
Mark (Test-Path (Join-Path $Root 'Launcher\App\index.html')) "[1c] index.html present"
Mark (Test-Path (Join-Path $Root 'Launcher\App\node_modules\.bin\electron.cmd')) "[1d] electron present (v44)"

# 2 agents.json present + valid JSON
$aj = Join-Path $Root 'Build\Config\agents.json'
Mark (Test-Path $aj) "[2] agents.json exists"
$ajson = $null
try { $ajson = Get-Content $aj -Raw | ConvertFrom-Json; Mark $true "[2b] agents.json valid JSON, $($ajson.agents.Count) agents" }
catch { Mark $false "[2b] agents.json invalid JSON" }

# 3 four start scripts exist
foreach($a in $ajson.agents){
  $p = Join-Path $Root ($a.launcher -replace '/','\')
  Mark (Test-Path $p) "[3] $($a.name) start script: $($a.launcher)"
}

# 4 no hard-coded drive letters in launcher source (E:\ C:\ D:\ as project paths)
$src = Get-ChildItem (Join-Path $Root 'Launcher\App') -Include *.js,*.html -Recurse | Where-Object { $_.FullName -notmatch 'node_modules' } | Get-Content -Raw
$hardcode = [bool](($src -split "`n") | Where-Object { $_ -match '(^|[^a-zA-Z])[A-Za-z]:\\' -and $_ -notmatch 'process\.platform|Program Files' })
Mark (-not $hardcode) "[4] No hard-coded drive letters in launcher source"

# 5 no persistent PATH change (no entry pointing into our mother folder)
$u=[Environment]::GetEnvironmentVariable('Path','User'); $m=[Environment]::GetEnvironmentVariable('Path','Machine')
$rootEsc = [regex]::Escape($Root)
$hit=(($u -split ';')+($m -split ';')) | Where-Object { $_ -match $rootEsc }
Mark ($hit.Count -eq 0) "[5] No mother-folder entries in persistent User/Machine PATH (pre-existing D:\Hermes etc. left untouched)"

# 6 no API key / token literals in launcher source
$leak = [bool]($src -match 'sk-ant-|sk-[A-Za-z0-9]{20}|ghp_|-----BEGIN|oauth_token\s*=')
Mark (-not $leak) "[6] No API key/token literals in launcher source"

# 7 launcher boots (selftest) and reports all 4 READY
$st = & (Join-Path $Root 'Build\Scripts\start-launcher.ps1') --selftest 2>$null | Out-String
Mark ([bool]($st -match '"id":"openclaw","status":"READY"')) "[7] openclaw READY via launcher"
Mark ([bool]($st -match '"id":"hermes","status":"READY"')) "[7b] hermes READY via launcher"
Mark ([bool]($st -match '"id":"codex","status":"READY"')) "[7c] codex READY via launcher"
Mark ([bool]($st -match '"id":"claude-code","status":"READY"')) "[7d] claude-code READY via launcher"

# 8 detached launch path works: spawn one agent's --version via the same cmd-start mechanism
$probe = Join-Path $Root 'Build\Scripts\start-codex.ps1'
$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','start','"AgentTest"','powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$probe`"",'--version' -WindowStyle Hidden -PassThru
Mark ($null -ne $p) "[8] Detached launch spawns independent process (pid=$($p.Id))"
Start-Sleep -Seconds 2

# 9 launcher log written
Mark (Test-Path (Join-Path $Root 'Launcher\Logs\launcher.log')) "[9] Launcher log file present"

Write-Output ""
Write-Output "=== SUMMARY: fails=$($script:fails) warns=$($script:warns) ==="
if($script:fails -gt 0){ Write-Output "FINAL: FAIL" }
elseif($script:warns -gt 0){ Write-Output "FINAL: WARN (PASS with notes)" }
else{ Write-Output "FINAL: PASS" }
