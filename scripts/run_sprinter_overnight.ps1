$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repo
New-Item -ItemType Directory -Force -Path "data/sprinter/logs" | Out-Null
$day = Get-Date -Format "yyyyMMdd"
Write-Host ""
Write-Host "DeepSpec — Sprinter overnight watcher"
Write-Host "  Repo: $repo"
Write-Host "  Log:  data\sprinter\logs\watch-$day.log"
Write-Host "  Drop photos in: data\sprinter\incoming\<PART_NUMBER>\"
Write-Host "  Leave this window open. Ctrl+C to stop."
Write-Host ""
py -3 scripts/sprinter_watch.py --tonight
