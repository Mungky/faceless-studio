param([string]$TaskName = 'Faceless Studio Worker', [switch]$Remove)
$ErrorActionPreference = 'Stop'
$studioRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($Remove) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; return }
$node = (Get-Command node -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $node -Argument '--env-file-if-exists=.env --import tsx apps/worker/src/index.ts' -WorkingDirectory $studioRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 1 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
# Interactive logon is intentional: Flow requires the signed-in, visible desktop.
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Faceless Studio polling worker; one GPU job at a time.' -RunLevel Limited
Write-Output 'Worker scheduled at user logon. Open and keep Flow visible for generation jobs.'
