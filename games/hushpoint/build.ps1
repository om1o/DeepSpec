$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "build"))
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

if (
    -not [string]::Equals(
        [System.IO.Path]::GetDirectoryName($packageRoot),
        $projectRoot,
        [System.StringComparison]::OrdinalIgnoreCase
    ) -or
    -not [string]::Equals(
        [System.IO.Path]::GetFileName($packageRoot),
        "build",
        [System.StringComparison]::OrdinalIgnoreCase
    )
) {
    throw "Refusing to clean an unexpected package directory: $packageRoot"
}

if (Test-Path -LiteralPath $packageRoot) {
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "test.ps1")
if ($LASTEXITCODE -ne 0) { throw "HUSHPOINT tests failed with exit code $LASTEXITCODE." }

& $godot --headless --path $projectRoot --export-release "Windows Desktop" $gameBinary
if ($LASTEXITCODE -ne 0) { throw "Windows export failed with exit code $LASTEXITCODE." }

Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination (Join-Path $packageRoot "README.md") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "GAME_DESIGN.md") -Destination (Join-Path $packageRoot "GAME_DESIGN.md") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "THIRD_PARTY_NOTICES.md") -Destination (Join-Path $packageRoot "THIRD_PARTY_NOTICES.md") -Force
Copy-Item -LiteralPath $copyrightSource -Destination (Join-Path $packageRoot "COPYRIGHT.txt") -Force

$requiredFiles = @("COPYRIGHT.txt", "GAME_DESIGN.md", "Hushpoint.exe", "README.md", "THIRD_PARTY_NOTICES.md")
foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $packageRoot $requiredFile))) {
        throw "The export command completed but required package file '$requiredFile' is missing."
    }
}

$packagedDirectories = @(Get-ChildItem -LiteralPath $packageRoot -Directory)
if ($packagedDirectories.Count -ne 0) {
    throw "The package contains unexpected directories: $($packagedDirectories.Name -join ', ')"
}

$packagedFiles = @(Get-ChildItem -LiteralPath $packageRoot -File | Select-Object -ExpandProperty Name)
$unexpectedFiles = @($packagedFiles | Where-Object { $_ -notin $requiredFiles })
if ($unexpectedFiles.Count -ne 0) {
    throw "The package contains unexpected files: $($unexpectedFiles -join ', ')"
}
if ($packagedFiles.Count -ne $requiredFiles.Count) {
    throw "The package file count does not match the required package contract."
}

$binary = Get-Item -LiteralPath $gameBinary
Write-Output ("HUSHPOINT BUILD PASS: {0} ({1:N1} MiB)" -f $binary.FullName, ($binary.Length / 1MB))
