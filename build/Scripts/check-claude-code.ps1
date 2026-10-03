# ============================================================================
# check-claude-code.ps1
# Project Claude Code self-check. Read-only. No API key, no login.
# Outputs checks and final PASS / WARN / FAIL.
# ============================================================================
$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

. (Join-Path $ScriptDir 'portable-env.ps1') | Out-Null
$cc = Join-Path $Root 'Agents\ClaudeCode'
$env:CLAUDE_CONFIG_DIR = $cc
$claudeCmd = Join-Path $cc 'App\node_modules\.bin\claude.cmd'

$script:fails = 0; $script:warns = 0
function Mark($ok,$msg){ if($ok -eq $true){Write-Output "[OK]   $msg"}elseif($ok -eq 'WARN'){Write-Output "[WARN] $msg";$script:warns++}else{Write-Output "[FAIL] $msg";$script:fails++} }

Write-Output "=== Claude Code Self-Check ==="
Write-Output "CLAUDE_CONFIG_DIR = $cc"

# 1 installed
Mark (Test-Path $claudeCmd) "[1] claude.cmd present"

# 2 version
$ver = & $claudeCmd --version 2>$null
Mark ([bool](($ver -join "`n") -match '2\.1\.280')) "[2] Version: $(($ver | Select-Object -First 1))"

# 3 help
$help = & $claudeCmd --help 2>&1
Mark ([bool](($help -join "`n") -match 'Usage: claude')) "[3] --help works"

# 4 doctor
$doc = & $claudeCmd doctor 2>&1
Mark ([bool](($doc -join "`n") -match 'No installation issues found')) "[4] doctor: no installation issues"

# 5 persisted PATH
$u=[Environment]::GetEnvironmentVariable('Path','User'); $m=[Environment]::GetEnvironmentVariable('Path','Machine')
$hit=(($u -split ';')+($m -split ';')) | Where-Object { $_ -match 'Agents\\ClaudeCode' }
Mark ($hit.Count -eq 0) "[5] Persisted PATH: no project ClaudeCode entry"

# 6 user dir (~/.claude not created/touched)
$uc = Join-Path $env:USERPROFILE '.claude'
Mark (-not (Test-Path $uc)) "[6] User ~/.claude: not created"
Mark (-not (Test-Path (Join-Path $env:USERPROFILE '.claude.json'))) "[6b] User ~/.claude.json: not created"

# 7 credentials in project (no real token)
$realCred=$false
foreach($f in @('credentials','.credentials.json','.claude.json')){
  $p=Join-Path $cc $f
  if(Test-Path $p){ $t=Get-Content $p -Raw -ErrorAction SilentlyContinue
    if($t -match 'sk-ant|oauth|accessToken|refreshToken|apiKey.*[A-Za-z0-9]{30}'){ $realCred=$true } }
}
Mark (-not $realCred) "[7] Project: no real API key / OAuth token"

# 8 OpenClaw regression
$env:OPENCLAW_STATE_DIR=Join-Path $Root 'Agents\OpenClaw\Data'
$env:OPENCLAW_CONFIG_PATH=Join-Path $Root 'Agents\OpenClaw\Config\config.yaml'
$ocVer=& (Join-Path $Root 'Agents\OpenClaw\App\node_modules\.bin\openclaw.cmd') --version 2>$null
Mark ([bool](($ocVer -join "`n") -match '2026\.9\.5')) "[8] OpenClaw: $(($ocVer|Select-Object -First 1))"

# 9 Hermes regression
$env:HERMES_HOME=Join-Path $Root 'Agents\Hermes'
$hVer=& (Join-Path $Root 'Agents\Hermes\bin\hermes.exe') --version 2>$null
Mark ([bool](($hVer -join "`n") -match '0\.21\.4')) "[9] Hermes: $(($hVer|Select-Object -First 1))"

# 10 Codex regression
$env:CODEX_HOME=Join-Path $Root 'Agents\Codex'
$cxVer=& (Join-Path $Root 'Agents\Codex\App\node_modules\.bin\codex.cmd') --version 2>$null
Mark ([bool](($cxVer -join "`n") -match '0\.156\.1')) "[10] Codex: $(($cxVer|Select-Object -First 1))"

Write-Output ""
Write-Output "=== SUMMARY: fails=$($script:fails) warns=$($script:warns) ==="
if($script:fails -gt 0){ Write-Output "FINAL: FAIL" }
elseif($script:warns -gt 0){ Write-Output "FINAL: WARN (PASS with notes)" }
else{ Write-Output "FINAL: PASS" }
