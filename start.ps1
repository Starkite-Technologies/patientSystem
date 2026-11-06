# PatientFlow temporary pilot on this laptop (fictional patients only):
#   self-hosted Supabase in Docker (gateway 127.0.0.1:8100, loopback only)
#   Django (waitress, 127.0.0.1:8000) <- /api and /auth/v1 proxy <- built frontend (vite preview, 127.0.0.1:4173)
#   <- named Cloudflare tunnel "patientflow" (fixed link https://<PUBLIC_HOSTNAME>, config in %USERPROFILE%\.cloudflared\patientflow.yml)
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1             # everything, fixed link
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -StackOnly  # only Supabase (for migrations / Studio)
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -NoTunnel   # local test at http://localhost:4173
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -QuickTunnel  # fallback: random trycloudflare.com link
# Ctrl+C stops Django, frontend and tunnel. Supabase keeps running; stop it with:
#   docker compose -p supabase stop
param(
    [switch]$StackOnly,
    [switch]$NoTunnel,
    [switch]$QuickTunnel,
    [string]$SupabaseDir = 'C:\Users\alexs\patientflow-supabase\upstream\docker'
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$gateway = 'http://127.0.0.1:8100'

function Fail($message) { Write-Host "STOPPED: $message" -ForegroundColor Red; exit 1 }
function JwtRole($token) {
    try {
        $part = $token.Split('.')[1].Replace('-', '+').Replace('_', '/')
        $part += '=' * ((4 - $part.Length % 4) % 4)
        return ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($part)) | ConvertFrom-Json).role
    } catch { return $null }
}

# --- 1. Configuration safety checks (values are never printed) -------------
foreach ($override in '.env.local', '.env.production', '.env.production.local') {
    if (Test-Path $override) { Fail "$override exists and would silently override .env. Merge it into .env and delete it." }
}
if (-not (Test-Path '.env')) { Fail 'Missing .env.' }
$cfg = @{}
Get-Content '.env' | Where-Object { $_ -match '^\s*([A-Z0-9_]+)\s*=(.*)$' } | ForEach-Object { $cfg[$Matches[1]] = $Matches[2].Trim() }
if ($cfg['VITE_SUPABASE_URL'] -ne 'same-origin') { Fail 'VITE_SUPABASE_URL must be same-origin (Auth is proxied through this app).' }
if ($cfg['SUPABASE_URL'] -ne $gateway) { Fail "SUPABASE_URL must be $gateway (local self-hosted gateway)." }
$key = $cfg['VITE_SUPABASE_PUBLISHABLE_KEY']
if (-not $key -or (JwtRole $key) -ne 'anon') { Fail 'VITE_SUPABASE_PUBLISHABLE_KEY must be the self-hosted ANON_KEY (role anon).' }
if ($cfg['SUPABASE_PUBLISHABLE_KEY'] -and $cfg['SUPABASE_PUBLISHABLE_KEY'] -ne $key) { Fail 'SUPABASE_PUBLISHABLE_KEY must match VITE_SUPABASE_PUBLISHABLE_KEY.' }
if ($cfg['DJANGO_DEBUG'] -ne 'false') { Fail 'Set DJANGO_DEBUG=false.' }
if (-not $cfg['DJANGO_SECRET_KEY']) { Fail 'DJANGO_SECRET_KEY is empty.' }
if ($cfg['DATABASE_URL']) { Fail 'Remove DATABASE_URL from .env; migrations use deploy\selfhost\apply-legacy-migrations.ps1.' }
foreach ($flag in 'NECMS_ENABLED', 'VITE_NECMS_ENABLED', 'VITE_SYNTHETIC_DEMO', 'VITE_NECMS_PRESENTATION') {
    if ($cfg[$flag] -and $cfg[$flag] -ne 'false') { Fail "$flag must be false for the pilot." }
    # Process environment variables would override .env for both Django and Vite.
    Remove-Item "Env:$flag" -ErrorAction SilentlyContinue
}
foreach ($name in 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY') { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }

# --- 2. Self-hosted Supabase (Docker) --------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker is not installed.' }
# After a reboot (auto-start at sign-in) Docker Desktop may still be starting: open it if needed and wait up to 5 minutes.
docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE) {
    $desktop = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'
    if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue) -and (Test-Path $desktop)) { Write-Host 'Opening Docker Desktop...'; Start-Process $desktop }
    Write-Host 'Waiting for the Docker engine...'
    foreach ($i in 1..60) { Start-Sleep -Seconds 5; docker info --format '{{.ServerVersion}}' *> $null; if (-not $LASTEXITCODE) { break } }
    if ($LASTEXITCODE) { Fail 'Docker Desktop did not start within 5 minutes. Open it and wait until it says "Engine running".' }
}
$stackEnv = Join-Path $SupabaseDir '.env'
if (-not (Test-Path $stackEnv)) { Fail "Missing $stackEnv (self-hosted Supabase secrets)." }
$compose = @('compose', '-p', 'supabase', '-f', (Join-Path $SupabaseDir 'docker-compose.yml'),
    '-f', (Join-Path $PSScriptRoot 'deploy\selfhost\docker-compose.patientflow.yml'), '--env-file', $stackEnv)
Write-Host 'Starting self-hosted Supabase (db, auth, rest, realtime, meta, studio, gateway)...'
& docker @compose up -d db auth rest realtime meta studio api-gw
if ($LASTEXITCODE) { Fail 'docker compose up failed. See: docker compose -p supabase logs' }

$published = (docker port supabase-envoy 8000/tcp) -join ' '
if ($published -notmatch '^127\.0\.0\.1:8100$') { Fail "Gateway must be published on 127.0.0.1:8100 only (got: $published)." }
$authOk = $false
foreach ($i in 1..90) {
    try { $settings = Invoke-RestMethod "$gateway/auth/v1/settings" -Headers @{ apikey = $key } -TimeoutSec 3; $authOk = $true; break } catch { Start-Sleep -Seconds 2 }
}
if (-not $authOk) { Fail 'Supabase Auth did not become ready. See: docker compose -p supabase logs auth' }
if (-not $settings.disable_signup -or $settings.external.phone -or $settings.external.anonymous_users) {
    Fail 'Supabase Auth allows sign-up, phone or anonymous logins. Fix DISABLE_SIGNUP / ENABLE_PHONE_SIGNUP / ENABLE_ANONYMOUS_USERS.'
}
Write-Host "Supabase ready. Studio (this laptop only): $gateway  (login: DASHBOARD_USERNAME / DASHBOARD_PASSWORD in $stackEnv)"
if ($StackOnly) { exit 0 }

# --- 3. Python environment and frontend build ------------------------------
foreach ($port in 8000, 4173) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { Fail "Port $port is already in use. Close the other program (or a previous start.ps1 window)." }
}
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared -and (Test-Path "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe")) { $cloudflared = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe" }
if (-not $NoTunnel -and -not $cloudflared) { Fail 'cloudflared is not installed: winget install --id Cloudflare.cloudflared' }
$tunnelConfig = Join-Path $env:USERPROFILE '.cloudflared\patientflow.yml'
$publicHost = $cfg['PUBLIC_HOSTNAME']
if (-not $NoTunnel -and -not $QuickTunnel) {
    if (-not (Test-Path $tunnelConfig)) { Fail "Missing $tunnelConfig (named tunnel). Use -QuickTunnel for a temporary link." }
    if (-not $publicHost) { Fail 'Set PUBLIC_HOSTNAME in .env (for example patientflow.starkitetechnologies.com).' }
    if (($cfg['DJANGO_ALLOWED_HOSTS'] -split ',') -notcontains $publicHost) { Fail "Add $publicHost to DJANGO_ALLOWED_HOSTS in .env." }
}

$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { Write-Host 'Creating Python environment...'; python -m venv .venv }
Write-Host 'Checking Python packages...'
& $python -m pip install -q --disable-pip-version-check -r backend\requirements.txt waitress
if ($LASTEXITCODE) { Fail 'pip install failed.' }
& $python backend\manage.py check_supabase
if ($LASTEXITCODE) { Fail 'Supabase check failed. Have the legacy migrations been applied? (deploy\selfhost\apply-legacy-migrations.ps1)' }

Write-Host 'Building frontend...'
npm.cmd run build
if ($LASTEXITCODE) { Fail 'Frontend build failed.' }
if (-not (Select-String -Path 'dist\assets\*.js' -SimpleMatch $key -Quiet)) { Fail 'Build does not contain the Supabase key (it would start in demo mode).' }

# --- 4. Start Django, frontend and tunnel ----------------------------------
$processes = @()
try {
    $processes += Start-Process $python -ArgumentList '-m', 'waitress', '--listen=127.0.0.1:8000', 'config.wsgi:application' `
        -WorkingDirectory (Join-Path $PSScriptRoot 'backend') -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput "$logs\django.log" -RedirectStandardError "$logs\django-error.log"
    $node = (Get-Command node).Source
    $processes += Start-Process $node -ArgumentList 'node_modules\vite\bin\vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort' `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logs\web.log" -RedirectStandardError "$logs\web-error.log"

    $ready = $false
    foreach ($i in 1..30) {
        Start-Sleep -Seconds 1
        try {
            $api = Invoke-RestMethod 'http://127.0.0.1:4173/api/health/' -TimeoutSec 2
            Invoke-RestMethod 'http://127.0.0.1:4173/auth/v1/health' -Headers @{ apikey = $key } -TimeoutSec 2 | Out-Null
            if ($api.status -eq 'ok' -and $api.supabase_configured) { $ready = $true; break }
        } catch {}
    }
    if (-not $ready) { Fail 'Django, the frontend or the /auth/v1 proxy did not start. See logs\django-error.log and logs\web-error.log.' }

    if ($NoTunnel) {
        $link = 'http://localhost:4173'
    } elseif (-not $QuickTunnel) {
        # Named tunnel: the real hostname is passed through and checked by Vite (allowedHosts) and Django (ALLOWED_HOSTS).
        $processes += Start-Process $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--config', $tunnelConfig, 'run', 'patientflow' `
            -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logs\tunnel.log" -RedirectStandardError "$logs\tunnel-error.log"
        $connected = $false
        foreach ($i in 1..45) {
            Start-Sleep -Seconds 1
            if (Select-String -Path "$logs\tunnel-error.log", "$logs\tunnel.log" -Pattern 'Registered tunnel connection' -Quiet -ErrorAction SilentlyContinue) { $connected = $true; break }
        }
        if (-not $connected) { Fail 'The named tunnel did not connect. See logs\tunnel-error.log.' }
        $link = "https://$publicHost"
        $reachable = $false
        foreach ($i in 1..10) {
            try { if ((Invoke-WebRequest "$link/api/health/" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) { $reachable = $true; break } } catch { Start-Sleep -Seconds 3 }
        }
        if (-not $reachable) { Write-Host "WARNING: tunnel connected, but $link did not answer yet. Compare the laptop lookup with Resolve-DnsName $publicHost -Server 1.1.1.1. Do not recreate the working DNS route." -ForegroundColor Yellow }
    } else {
        # Host header rewrite: Vite and Django only ever see "localhost", so the random tunnel name needs no configuration.
        $processes += Start-Process $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:4173', '--http-host-header', 'localhost:4173' `
            -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logs\tunnel.log" -RedirectStandardError "$logs\tunnel-error.log"
        $link = $null
        foreach ($i in 1..45) {
            Start-Sleep -Seconds 1
            $match = Select-String -Path "$logs\tunnel-error.log", "$logs\tunnel.log" -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($match) { $link = $match.Matches[0].Value; break }
        }
        if (-not $link) { Fail 'No tunnel link. See logs\tunnel-error.log.' }
    }

    Write-Host ''
    Write-Host "PatientFlow pilot is reachable at:  $link" -ForegroundColor Green
    Write-Host 'FICTIONAL PATIENTS ONLY on this setup. Sign-in required. Keep this window open and the laptop awake. Ctrl+C to stop.' -ForegroundColor Yellow
    while ($true) {
        Start-Sleep -Seconds 5
        $dead = $processes | Where-Object { $_.HasExited }
        if ($dead) { Fail "A component stopped ($(($dead | ForEach-Object { $_.StartInfo.FileName | Split-Path -Leaf }) -join ', '), exit $($dead[0].ExitCode)). See the logs folder." }
    }
}
finally {
    # Stop whole process trees: the .venv python.exe is a launcher whose child keeps serving (and holding the port) otherwise.
    foreach ($p in $processes) { if ($p) { taskkill.exe /PID $p.Id /T /F *> $null } }
    if ($processes) { Write-Host 'Stopped Django, frontend and tunnel. Supabase is still running (docker compose -p supabase stop).' }
}
