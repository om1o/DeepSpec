$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = $PSScriptRoot
$packageRoot = Join-Path $projectRoot "build"
$gameBinary = Join-Path $packageRoot "Hushpoint.exe"
$copyrightSource = Join-Path $projectRoot "COPYRIGHT.txt"
$godotPackageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
$godot = Get-ChildItem -LiteralPath $godotPackageRoot -Recurse -File -Filter "Godot_v4.7.2-stable_win64_console.exe" |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $godot) {
    throw "Godot 4.7.2 console executable was not found."
}

$template = Join-Path $env:APPDATA "Godot\export_templates\4.7.2.stable\windows_release_x86_64.exe"
if (-not (Test-Path -LiteralPath $template)) {
    throw "Godot 4.7.2 Windows export templates are not installed."
}
if (-not (Test-Path -LiteralPath $copyrightSource)) {
    throw "COPYRIGHT.txt is required for the packaged Godot license notice."
}

New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

& $godot --headless --path $projectRoot --import
if ($LASTEXITCODE -ne 0) { throw "Godot import failed with exit code $LASTEXITCODE." }

& $godot --headless --path $projectRoot --script res://tests/test_runner.gd
if ($LASTEXITCODE -ne 0) { throw "State tests failed with exit code $LASTEXITCODE." }

& $godot --headless --path $projectRoot --script res://tests/integration_runner.gd
if ($LASTEXITCODE -ne 0) { throw "Integration tests failed with exit code $LASTEXITCODE." }

& $godot --headless --path $projectRoot --export-release "Windows Desktop" $gameBinary
if ($LASTEXITCODE -ne 0) { throw "Windows export failed with exit code $LASTEXITCODE." }

Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination (Join-Path $packageRoot "README.md") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "GAME_DESIGN.md") -Destination (Join-Path $packageRoot "GAME_DESIGN.md") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "THIRD_PARTY_NOTICES.md") -Destination (Join-Path $packageRoot "THIRD_PARTY_NOTICES.md") -Force
Copy-Item -LiteralPath $copyrightSource -Destination (Join-Path $packageRoot "COPYRIGHT.txt") -Force

foreach ($requiredFile in @("Hushpoint.exe", "README.md", "GAME_DESIGN.md", "THIRD_PARTY_NOTICES.md", "COPYRIGHT.txt")) {
    if (-not (Test-Path -LiteralPath (Join-Path $packageRoot $requiredFile))) {
        throw "The export command completed but required package file '$requiredFile' is missing."
    }
}

$binary = Get-Item -LiteralPath $gameBinary
Write-Output ("HUSHPOINT BUILD PASS: {0} ({1:N1} MiB)" -f $binary.FullName, ($binary.Length / 1MB))
