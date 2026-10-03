# ============================================================================
# check-runtime.ps1
# Purpose: Verify the project portable runtime. Prints [OK]/[WARN]/[FAIL].
#          Does NOT report a missing component as [OK].
# ============================================================================

# Load portable env for THIS session so checks see the project runtimes
. (Join-Path $PSScriptRoot 'portable-env.ps1')

Write-Host ""
Write-Host "=== Runtime Health Check ==="

$results = @()

function Test-Tool($name, $cmd, $arg = '--version', $required = $true) {
  $p = (Get-Command $cmd -ErrorAction SilentlyContinue).Source
  if (-not $p) {
    if ($required) {
      Write-Host "[FAIL] $name : not found on PATH"
      return @{ name = $name; status = 'FAIL' }
    } else {
      Write-Host "[WARN] $name : not found (optional)"
      return @{ name = $name; status = 'WARN' }
    }
  }
  try {
    $v = (& $cmd $arg 2>&1 | Select-Object -First 1)
  } catch {
    $v = '(error running)'
  }
  Write-Host "[OK]   $name : $v  ($p)"
  return @{ name = $name; status = 'OK'; version = "$v" }
}

# Required runtimes
$results += Test-Tool 'Node'      'node'    '--version' $true
$results += Test-Tool 'npm'       'npm'     '--version' $true
$results += Test-Tool 'Python'    'python'  '--version' $true
$results += Test-Tool 'pip'      'pip'     '--version' $true
$results += Test-Tool 'Git'       'git'     '--version' $true
$results += Test-Tool 'Git LFS'  'git-lfs' '--version' $false

# Host / built-in tools
$psv = $PSVersionTable.PSVersion.ToString()
Write-Host "[OK]   PowerShell : $psv"
$results += @{ name = 'PowerShell'; status = 'OK'; version = $psv }

# curl (built-in on Win10/11) - optional but expected
$curlSys = Join-Path $env:SystemRoot 'System32\curl.exe'
if (Test-Path $curlSys) {
  $cv = (& $curlSys --version | Select-Object -First 1)
  Write-Host "[OK]   curl : $cv"
  $results += @{ name = 'curl'; status = 'OK' }
} else {
  Write-Host "[WARN] curl : not found in System32 (optional)"
  $results += @{ name = 'curl'; status = 'WARN' }
}

# tar (built-in bsdtar on Win10/11) - optional but expected
$tarSys = Join-Path $env:SystemRoot 'System32\tar.exe'
if (Test-Path $tarSys) {
  $tv = (& $tarSys --version | Select-Object -First 1)
  Write-Host "[OK]   tar : $tv"
  $results += @{ name = 'tar'; status = 'OK' }
} else {
  Write-Host "[WARN] tar : not found in System32 (optional)"
  $results += @{ name = 'tar'; status = 'WARN' }
}

# 7-Zip - optional; project uses built-in Expand-Archive/tar instead
$sz = (Get-Command '7z' -ErrorAction SilentlyContinue).Source
if (-not $sz) { $sz = "$env:ProgramFiles\7-Zip\7z.exe" }
if (Test-Path $sz) {
  Write-Host "[OK]   7-Zip : found at $sz"
  $results += @{ name = '7-Zip'; status = 'OK' }
} else {
  Write-Host "[WARN] 7-Zip : not installed (NOT required; Windows built-ins cover zip)"
  $results += @{ name = '7-Zip'; status = 'WARN' }
}

# Summary
Write-Host ""
Write-Host "=== Summary ==="
$fail = ($results | Where-Object { $_.status -eq 'FAIL' }).Count
$warn = ($results | Where-Object { $_.status -eq 'WARN' }).Count
$ok   = ($results | Where-Object { $_.status -eq 'OK' }).Count
Write-Host "OK=$ok  WARN=$warn  FAIL=$fail"
if ($fail -gt 0) { exit 1 } else { exit 0 }
