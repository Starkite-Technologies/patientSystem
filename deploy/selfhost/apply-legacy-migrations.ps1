# Apply the six legacy PatientFlow migrations to the LOCAL self-hosted Supabase database (container supabase-db),
# then run deploy/pilot-verify.sql. Never applies *necms* files.
#   Preview (no changes):  powershell -NoProfile -ExecutionPolicy Bypass -File deploy\selfhost\apply-legacy-migrations.ps1
#   Apply:                 ... -File deploy\selfhost\apply-legacy-migrations.ps1 -Apply
# Each applied file is recorded (name + SHA-256) in public._patientflow_migrations, the same history table
# used by `manage.py apply_supabase_migrations`, so reruns skip completed files and detect edited ones.
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$files = @(
    '202610130001_initial.sql',
    '202610140001_normalize_names.sql',
    '202610140002_nurse_surgeon_roles.sql',
    '202610140003_nurse_coordination.sql',
    '202610140004_patient_date_of_birth.sql',
    '202610140005_auto_patient_references.sql'
)
function Fail($message) { Write-Host "STOPPED: $message" -ForegroundColor Red; exit 1 }
function Sql($query) {
    $out = docker exec supabase-db psql -U postgres -d postgres -X -q -tA -v ON_ERROR_STOP=1 -c $query
    if ($LASTEXITCODE) { Fail "Query failed: $query" }
    return ($out -join "`n").Trim()
}
function RunFile($path, $name) {
    docker exec supabase-db mkdir -p /tmp/patientflow | Out-Null
    docker cp $path "supabase-db:/tmp/patientflow/$name" | Out-Null
    if ($LASTEXITCODE) { Fail "Could not copy $name into the container." }
    # Out-Host keeps psql output out of the return value.
    docker exec supabase-db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -f "/tmp/patientflow/$name" | Out-Host
    return $LASTEXITCODE
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker is not installed or not on PATH.' }
foreach ($c in 'supabase-db', 'supabase-auth') {
    $health = docker inspect -f '{{.State.Health.Status}}' $c 2>$null
    if ($health -ne 'healthy') { Fail "$c is not healthy ($health). Start the stack with start.ps1 -StackOnly first." }
}
if ((Sql "select to_regclass('auth.users') is not null") -ne 't') { Fail 'auth.users is missing: Auth has not finished its own migrations yet.' }
if ((Sql "select count(*) from pg_namespace where nspname='necms_private'") -ne '0') { Fail 'NECMS objects found in this database. Stop and investigate.' }

$historyExists = (Sql "select to_regclass('public._patientflow_migrations') is not null") -eq 't'
$tablesExist = (Sql "select to_regclass('public.staff_profiles') is not null") -eq 't'
if ($tablesExist -and -not $historyExists) { Fail 'PatientFlow tables exist without migration history. Inspect manually; nothing was applied.' }

$pending = @()
foreach ($name in $files) {
    $path = Join-Path $repo "supabase\migrations\$name"
    if (-not (Test-Path $path)) { Fail "Missing $name" }
    $hash = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
    $recorded = if ($historyExists) { Sql "select checksum from public._patientflow_migrations where name='$name'" } else { '' }
    if ($recorded -and $recorded -ne $hash) { Fail "$name differs from its applied version." }
    if ($recorded) { Write-Host "Already applied: $name" } else { Write-Host "Pending:         $name  (sha256 $($hash.Substring(0,12))...)"; $pending += @{ name = $name; path = $path; hash = $hash } }
}
if (-not $Apply) {
    Write-Host ''
    Write-Host "Preview only. $($pending.Count) migration(s) would be applied. Rerun with -Apply to make changes." -ForegroundColor Yellow
    exit 0
}

Sql @"
create table if not exists public._patientflow_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now());
alter table public._patientflow_migrations enable row level security;
revoke all on public._patientflow_migrations from public, anon, authenticated;
"@ | Out-Null
foreach ($m in $pending) {
    Write-Host "Applying $($m.name)..." -ForegroundColor Cyan
    if (RunFile $m.path $m.name) { Fail "$($m.name) failed and was rolled back. Earlier files stay applied." }
    Sql "insert into public._patientflow_migrations(name, checksum) values ('$($m.name)', '$($m.hash)')" | Out-Null
    Write-Host "Applied: $($m.name)" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Running deploy\pilot-verify.sql (read-only):'
if (RunFile (Join-Path $repo 'deploy\pilot-verify.sql') 'pilot-verify.sql') { Fail 'Verification query failed.' }
