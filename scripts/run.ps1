<#
  Started by the Homebase scheduled task (see service.ps1). Runs the server, appends its output to
  server\data\homebase.log (moving an old log aside past 10 MB), and starts it again if it stops.
#>
$Root = Split-Path -Parent $PSScriptRoot
$Data = Join-Path $Root 'server\data'
$Log = Join-Path $Data 'homebase.log'
$Node = 'node'
$config = Join-Path $Data 'service-config.ps1'
if (Test-Path $config) { . $config }
Set-Location $Root

function Write-Log([string]$text) {
  [IO.File]::AppendAllText($Log, "[$(Get-Date -Format s)] $text`r`n")
}

while ($true) {
  if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 10MB) { Move-Item $Log "$Log.old" -Force }
  Write-Log 'Starting Homebase'
  cmd /c "`"$Node`" --disable-warning=ExperimentalWarning server\src\index.ts >> `"$Log`" 2>&1"
  Write-Log "Homebase stopped (exit code $LASTEXITCODE). Starting it again in 10 seconds."
  Start-Sleep -Seconds 10
}
