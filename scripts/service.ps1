<#
  Runs Homebase in the background on Windows, using the built-in Task Scheduler: it starts with
  the computer (before anyone signs in) and comes back if it ever stops.

  From an administrator PowerShell in the Homebase folder:
    npm run service -- install     set it up and start it
    npm run service -- status      is it running?
    npm run service -- restart     after pulling updates and running npm run build
    npm run service -- stop        stop it until the next restart or reboot
    npm run service -- uninstall   remove it (your data stays)

  PORT, HOST, HOMEBASE_DB, HOMEBASE_VAPID_SUBJECT, HOMEBASE_BACKUP_DIR and HOMEBASE_BACKUP_KEEP set
  in this shell when you install are remembered for the service.
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall', 'status', 'restart', 'stop')]
  [string]$Action = 'status'
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Homebase'
$Root = Split-Path -Parent $PSScriptRoot
$Data = Join-Path $Root 'server\data'
$Config = Join-Path $Data 'service-config.ps1'
$Log = Join-Path $Data 'homebase.log'

# The port the service uses: from its saved settings, else this shell, else 8080.
$Port = 8080
if (Test-Path $Config) {
  $saved = Select-String -Path $Config -Pattern "^\`$env:PORT = '(\d+)'" | Select-Object -First 1
  if ($saved) { $Port = [int]$saved.Matches[0].Groups[1].Value }
}
if ($env:PORT -and $Action -eq 'install') { $Port = [int]$env:PORT }

function Assert-Admin {
  $me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an administrator PowerShell (right-click PowerShell, then "Run as administrator").'
  }
}

function Stop-Homebase {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  # Node can outlive the task's own process, so also stop whatever is serving the port.
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

switch ($Action) {
  'install' {
    Assert-Admin
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { throw 'Node.js was not found. Install Node 22.18 or newer, then open a new PowerShell.' }
    $version = [version](& $node -p 'process.versions.node')
    if ($version -lt [version]'22.18.0') { throw "Homebase needs Node 22.18 or newer; this computer has $version." }
    if (-not (Test-Path (Join-Path $Root 'web\dist\index.html'))) { throw 'Build the app first: npm install, then npm run build.' }
    if (-not (Test-Path (Join-Path $Root 'node_modules'))) { throw 'Install the packages first: npm install.' }

    New-Item -ItemType Directory -Force $Data | Out-Null
    # The service starts without this shell's settings, so write them down for scripts\run.ps1.
    $lines = @("# Written by scripts\service.ps1 install. Re-run it to change these.", "`$Node = '$node'")
    foreach ($name in 'PORT', 'HOST', 'HOMEBASE_DB', 'HOMEBASE_VAPID_SUBJECT', 'HOMEBASE_BACKUP_DIR', 'HOMEBASE_BACKUP_KEEP') {
      $value = [Environment]::GetEnvironmentVariable($name)
      if ($value) { $lines += "`$env:$name = '$($value -replace "'", "''")'" }
    }
    Set-Content -Path $Config -Value $lines -Encoding UTF8

    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
      Stop-Homebase
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    $run = Join-Path $PSScriptRoot 'run.ps1'
    $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$run`"" -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings `
      -Description "Homebase family scheduler on http://localhost:$Port" | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Homebase is installed and starting. In a few seconds, open http://localhost:$Port"
    Write-Host "It now starts whenever the computer does. Log: $Log"
  }
  'uninstall' {
    Assert-Admin
    Stop-Homebase
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    Write-Host 'Homebase no longer runs in the background. Your data and backups are still in server\data.'
  }
  'stop' {
    Assert-Admin
    Stop-Homebase
    Write-Host 'Homebase is stopped. It starts again at the next reboot, or with: npm run service -- restart'
  }
  'restart' {
    Assert-Admin
    Stop-Homebase
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Restarted. Open http://localhost:$Port in a few seconds."
  }
  'status' {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) { Write-Host 'Homebase is not installed as a background service. Run: npm run service -- install'; break }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "Task: $($task.State) (last started $($info.LastRunTime))"
    try {
      $health = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 5
      Write-Host "Homebase is answering on http://localhost:$Port ($($health.liveClients) screens connected)."
    } catch {
      Write-Host "Homebase is not answering on port $Port. The end of the log may say why: $Log"
    }
  }
}
