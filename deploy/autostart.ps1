# Scheduled-task entry point ("PatientFlow pilot", at sign-in): runs start.ps1 without a window,
# writing its output to logs\autostart.log and logs\autostart-error.log.
# Start-Process redirects at the OS level, so docker's progress output on stderr is not turned into
# PowerShell errors (which would stop start.ps1 under $ErrorActionPreference = 'Stop').
$repo = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$run = Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$repo\start.ps1`"" `
    -WorkingDirectory $repo -RedirectStandardOutput "$logs\autostart.log" -RedirectStandardError "$logs\autostart-error.log" `
    -NoNewWindow -PassThru -Wait
exit $run.ExitCode
