# PatientFlow CRAN demo on https://cran.starkitetechnologies.com (synthetic data only, no sign-in).
#   API + FHIR + mock registry: Django (waitress, 127.0.0.1:8010, CRAN_DEMO=true)
#   Web: production build in dist-cran\ served by vite preview on 127.0.0.1:5180
#   Public: the same named Cloudflare tunnel "patientflow" as the pilot, hostname cran.starkitetechnologies.com
# The pilot (start.ps1: ports 8000/4173, dist\, patientflow.starkitetechnologies.com) is never started, stopped or rebuilt here.
# Usage (from this folder, on the cran-demo branch):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\start-cran.ps1
# Ctrl+C stops the demo (and the tunnel connector only if this script started it).
param([string]$PublicHost = 'cran.starkitetechnologies.com')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
function Fail($message) { Write-Host "STOPPED: $message" -ForegroundColor Red; exit 1 }

# --- 1. Checks ----------------------------------------------------------------
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'cran-demo') { Fail "Check out the cran-demo branch first (current: $branch): git checkout cran-demo" }
foreach ($port in 8010, 5180) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { Fail "Port $port is already in use. Is the CRAN demo already running?" }
}
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared -and (Test-Path "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe")) { $cloudflared = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe" }
if (-not $cloudflared) { Fail 'cloudflared is not installed: winget install --id Cloudflare.cloudflared' }
$tunnelConfig = Join-Path $env:USERPROFILE '.cloudflared\patientflow.yml'
if (-not (Test-Path $tunnelConfig)) { Fail "Missing $tunnelConfig (named tunnel patientflow)." }
if (-not (Select-String -Path $tunnelConfig -SimpleMatch "hostname: $PublicHost" -Quiet)) {
    Fail "$tunnelConfig has no ingress rule for $PublicHost. Add it above the 404 rule (service: http://127.0.0.1:5180)."
}
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail 'Node.js is not installed.' }
if (-not (Test-Path '.venv\Scripts\python.exe')) { Fail 'Missing .venv. Run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt waitress' }
& .\.venv\Scripts\python.exe -c "import waitress" 2>$null
if ($LASTEXITCODE) { & .\.venv\Scripts\python.exe -m pip install -q --disable-pip-version-check waitress; if ($LASTEXITCODE) { Fail 'pip install waitress failed.' } }
if (-not (Test-Path 'node_modules\vite')) { npm.cmd install; if ($LASTEXITCODE) { Fail 'npm install failed.' } }

$processes = @()
$ownTunnel = $null
try {
    # --- 2. Demo app (build + serve) ------------------------------------------
    Write-Host 'Building and starting the CRAN demo (synthetic data)...'
    $env:CRAN_PUBLIC_HOSTNAME = $PublicHost
    $processes += Start-Process $node -ArgumentList 'scripts\start-cran-demo.mjs', '--serve' -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput "$logs\cran-web.log" -RedirectStandardError "$logs\cran-web-error.log"
    $ready = $false
    foreach ($i in 1..90) {
        Start-Sleep -Seconds 1
        try { if ((Invoke-RestMethod 'http://127.0.0.1:5180/api/cran/state/' -TimeoutSec 3).rows) { $ready = $true; break } } catch {}
        if ($processes[0].HasExited) { break }
    }
    if (-not $ready) { Fail 'The demo did not start. See logs\cran-web.log and logs\cran-web-error.log.' }

    # --- 3. Tunnel: reuse the pilot's connector if it has the cran rule, else run our own --------
    $configTime = (Get-Item $tunnelConfig).LastWriteTime
    $connectors = @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -match 'run\s+patientflow' })
    $stale = @($connectors | Where-Object { $_.CreationDate -lt $configTime })
    if ($connectors.Count -eq 0) {
        Write-Host 'No patientflow tunnel connector is running; starting one (stops with this script).'
        $ownTunnel = Start-Process $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--config', $tunnelConfig, 'run', 'patientflow' `
            -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logs\cran-tunnel.log" -RedirectStandardError "$logs\cran-tunnel-error.log"
        $processes += $ownTunnel
        $connected = $false
        foreach ($i in 1..45) {
            Start-Sleep -Seconds 1
            if (Select-String -Path "$logs\cran-tunnel-error.log", "$logs\cran-tunnel.log" -Pattern 'Registered tunnel connection' -Quiet -ErrorAction SilentlyContinue) { $connected = $true; break }
        }
        if (-not $connected) { Fail 'The named tunnel did not connect. See logs\cran-tunnel-error.log.' }
    } elseif ($stale.Count -gt 0) {
        Write-Host "WARNING: the pilot's tunnel connector was started before $PublicHost was added to $tunnelConfig." -ForegroundColor Yellow
        Write-Host "         It does not know the new hostname, so $PublicHost may answer 404 until the pilot is restarted once (start.ps1)." -ForegroundColor Yellow
    } else {
        Write-Host 'Using the running patientflow tunnel connector (it already serves this hostname).'
    }

    $link = "https://$PublicHost"
    $reachable = $false
    foreach ($i in 1..10) {
        try { if ((Invoke-WebRequest "$link/api/cran/state/" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) { $reachable = $true; break } } catch { Start-Sleep -Seconds 3 }
    }
    Write-Host ''
    if ($reachable) { Write-Host "PatientFlow CRAN demo is live at:  $link" -ForegroundColor Green }
    else { Write-Host "Demo is running locally (http://127.0.0.1:5180) but $link did not answer yet. Check the DNS route: cloudflared tunnel route dns patientflow $PublicHost" -ForegroundColor Yellow }
    Write-Host 'SYNTHETIC DATA ONLY. No sign-in. Anyone with the link can use it, including Reset demo. Keep this window open and the laptop awake. Ctrl+C to stop.' -ForegroundColor Yellow
    while ($true) {
        Start-Sleep -Seconds 5
        $dead = $processes | Where-Object { $_.HasExited }
        if ($dead) { Fail 'A demo component stopped. See logs\cran-web*.log and logs\cran-tunnel*.log.' }
    }
}
finally {
    # Only our own processes: never the pilot's Django, frontend or tunnel connector.
    foreach ($p in $processes) { if ($p) { taskkill.exe /PID $p.Id /T /F *> $null } }
    if ($processes) { Write-Host 'Stopped the CRAN demo.' }
}
