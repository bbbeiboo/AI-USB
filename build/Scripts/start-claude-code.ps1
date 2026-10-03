# ============================================================================
# start-claude-code.ps1
# Launch project-local Claude Code (portable, isolated from ~/.claude).
# Usage:
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-claude-code.ps1 --version
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-claude-code.ps1 --help
#   powershell -ExecutionPolicy Bypass -File Build\Scripts\start-claude-code.ps1 doctor
# ============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir  = Split-Path -Parent $ScriptDir
$Root      = Split-Path -Parent $BuildDir
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }

# Load project portable runtimes into THIS process only
. (Join-Path $ScriptDir 'portable-env.ps1') | Out-Null

# Redirect Claude Code config/state into the project (process scope only).
$cc = Join-Path $Root 'Agents\ClaudeCode'
$env:CLAUDE_CONFIG_DIR = $cc

$claudeCmd = Join-Path $cc 'App\node_modules\.bin\claude.cmd'
if (-not (Test-Path $claudeCmd)) {
    Write-Host "[start-claude-code] ERROR: claude.cmd not found at $claudeCmd" -ForegroundColor Red
    exit 1
}

Write-Host "[start-claude-code] CLAUDE_CONFIG_DIR = $env:CLAUDE_CONFIG_DIR"
Write-Host "[start-claude-code] Using: $claudeCmd"
Write-Host ""

# ----------------------------------------------------------------------------
# Provider injection: Claude Code only speaks the Anthropic Messages API.
# The agnes gateway exposes a compatible /v1/messages endpoint (verified).
# Read credentials from config/providers.json (never hardcode keys in-script)
# and set the ANTHROPIC_* env vars so claude.exe starts connected to agnes
# instead of exiting with "not logged in / no API key".
# ----------------------------------------------------------------------------
$providersFile = Join-Path $Root 'config\providers.json'
if (Test-Path $providersFile) {
  try {
    $prov = Get-Content $providersFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $agnes = $prov.agnes
    if ($agnes -and $agnes.enabled -and $agnes.apiKey) {
      $env:ANTHROPIC_BASE_URL = $agnes.anthropicBaseUrl
      $env:ANTHROPIC_API_KEY   = $agnes.apiKey
      $env:ANTHROPIC_MODEL     = $agnes.model
      # agnes-2.5-flash isn't in Claude Code's built-in model catalog; without
      # this flag the interactive TUI enforces an unknown-model context-window
      # check and exits. The /v1/messages call itself works (verified via -p).
      $env:CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1'
      Write-Host "[start-claude-code] ANTHROPIC_BASE_URL = $env:ANTHROPIC_BASE_URL"
      Write-Host "[start-claude-code] ANTHROPIC_MODEL    = $env:ANTHROPIC_MODEL"
      Write-Host "[start-claude-code] ANTHROPIC_API_KEY   = (loaded from providers.json)"
    } else {
      Write-Host "[start-claude-code] WARN: agnes provider not enabled in providers.json — claude may exit without an API key" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "[start-claude-code] WARN: could not parse providers.json — $($_.Exception.Message)" -ForegroundColor Yellow
  }
} else {
  Write-Host "[start-claude-code] WARN: providers.json not found — claude may exit without an API key" -ForegroundColor Yellow
}

# Non-interactive probe (--version/--help/doctor): run directly so the launcher
# can read stdout without opening a window. Interactive launch: claude.exe's
# native TUI, like codex/hermes, needs a fresh cmd console host — running it
# inline in this PowerShell host made the TUI exit immediately. The new cmd
# window inherits this process's env (ANTHROPIC_*, CLAUDE_CONFIG_DIR), so no
# secrets appear in the cmd command line.
#
# --bare is REQUIRED for the portable/agnes setup: in normal mode claude.exe's
# TUI reads the OS keychain for OAuth tokens and, finding none in this isolated
# env (HOME redirected, no host keychain), exits the TUI silently within ~8s.
# --bare forces Anthropic auth strictly via ANTHROPIC_API_KEY and skips
# keychain/hooks/plugins/CLAUDE.md discovery — appropriate for a portable
# launcher. Built-in tools still work (verified). Without --bare the TUI exits.
if ($args.Count -gt 0) {
  & $claudeCmd @args
  exit $LASTEXITCODE
}
Start-Process cmd.exe -ArgumentList '/k', "`"$claudeCmd`" --bare"
