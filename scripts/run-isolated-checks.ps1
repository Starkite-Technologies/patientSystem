# Run only existing local checks. This script never invokes the hosted migration
# command, the hosted seed command, or the Supabase reachability command.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPreviousLocation = Get-Location
$taskVariableNames = @(
    'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'DATABASE_URL',
    'DJANGO_DEBUG', 'DJANGO_SECRET_KEY', 'DJANGO_ALLOWED_HOSTS', 'NECMS_ENABLED', 'VITE_NECMS_ENABLED'
)
$taskPreviousEnvironment = @{}
foreach ($taskVariableName in $taskVariableNames) {
    $taskPreviousEnvironment[$taskVariableName] = [Environment]::GetEnvironmentVariable($taskVariableName, 'Process')
}

try {
    Set-Location -LiteralPath $taskRoot
    # Nonempty sentinels prevent Windows PowerShell from removing empty env vars
    # and python-dotenv/Vite subsequently loading hosted values from .env files.
    # The sentinel is intentionally an unreachable loopback HTTPS endpoint.
    $env:VITE_SUPABASE_URL = 'https://127.0.0.1:1'
    $env:VITE_SUPABASE_PUBLISHABLE_KEY = 'isolated-test-placeholder'
    $env:SUPABASE_URL = 'https://127.0.0.1:1'
    $env:SUPABASE_PUBLISHABLE_KEY = 'isolated-test-placeholder'
    $env:DATABASE_URL = 'postgresql://127.0.0.1:1/isolated_disabled'
    $env:DJANGO_DEBUG = 'true'
    $env:DJANGO_SECRET_KEY = 'isolated-tests-only-not-a-deployment-secret'
    $env:DJANGO_ALLOWED_HOSTS = 'localhost,127.0.0.1,testserver'
    $env:NECMS_ENABLED = 'false'
    $env:VITE_NECMS_ENABLED = 'false'

    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
    & .\.venv\Scripts\python.exe backend\manage.py test patients --verbosity 1
    if ($LASTEXITCODE -ne 0) { throw 'Django tests failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript/Vite build failed.' }
    & npm.cmd run test:database
    if ($LASTEXITCODE -ne 0) { throw 'In-memory database checks failed.' }
    & npm.cmd run test:hospitals
    if ($LASTEXITCODE -ne 0) { throw 'Hospital isolation database checks failed.' }
    Write-Output 'Isolated baseline checks passed. Hosted values were not used.'
} finally {
    foreach ($taskVariableName in $taskVariableNames) {
        [Environment]::SetEnvironmentVariable($taskVariableName, $taskPreviousEnvironment[$taskVariableName], 'Process')
    }
    Set-Location -LiteralPath $taskPreviousLocation.Path
}
