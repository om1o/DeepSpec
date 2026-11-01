param(
    [switch]$VerboseGodot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$godotPackageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
$godot = Get-ChildItem -LiteralPath $godotPackageRoot -Recurse -File -Filter "Godot_v4.7.2-stable_win64_console.exe" |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $godot) {
    throw "Godot 4.7.2 console executable was not found."
}

$profileName = "hushpoint-tests-$([Guid]::NewGuid().ToString('N'))"
$testProfileRoot = Join-Path ([System.IO.Path]::GetTempPath()) $profileName
$testAppData = Join-Path $testProfileRoot "AppData\Roaming"
$previousAppData = [Environment]::GetEnvironmentVariable("APPDATA", "Process")
$previousTestProfile = [Environment]::GetEnvironmentVariable("HUSHPOINT_TEST_PROFILE", "Process")

try {
    New-Item -ItemType Directory -Path $testAppData -Force | Out-Null
    $env:APPDATA = $testAppData
    $env:HUSHPOINT_TEST_PROFILE = $testProfileRoot

    $verbosityArgs = @()
    if ($VerboseGodot) {
        $verbosityArgs += "--verbose"
    }

    & $godot @verbosityArgs --headless --path $projectRoot --import
    if ($LASTEXITCODE -ne 0) { throw "Godot import failed with exit code $LASTEXITCODE." }

    $testRunners = @(
        "res://tests/test_runner.gd",
        "res://tests/integration_runner.gd",
        "res://tests/input_smoke_runner.gd",
        "res://tests/settings_runner.gd"
    )
    foreach ($testRunner in $testRunners) {
        & $godot @verbosityArgs --headless --path $projectRoot --script $testRunner
        if ($LASTEXITCODE -ne 0) {
            throw "$testRunner failed with exit code $LASTEXITCODE."
        }
    }
} finally {
    if ($null -eq $previousAppData) {
        Remove-Item Env:APPDATA -ErrorAction SilentlyContinue
    } else {
        $env:APPDATA = $previousAppData
    }
    if ($null -eq $previousTestProfile) {
        Remove-Item Env:HUSHPOINT_TEST_PROFILE -ErrorAction SilentlyContinue
    } else {
        $env:HUSHPOINT_TEST_PROFILE = $previousTestProfile
    }

    if (Test-Path -LiteralPath $testProfileRoot) {
        $resolvedProfile = [System.IO.Path]::GetFullPath($testProfileRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
        $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
        $profileParent = [System.IO.Path]::GetDirectoryName($resolvedProfile)
        $profileLeaf = [System.IO.Path]::GetFileName($resolvedProfile)
        if (
            -not [string]::Equals($profileParent, $resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not $profileLeaf.StartsWith("hushpoint-tests-", [System.StringComparison]::Ordinal)
        ) {
            throw "Refusing to remove unexpected test profile directory: $resolvedProfile"
        }
        Remove-Item -LiteralPath $resolvedProfile -Recurse -Force
    }
}

Write-Output "HUSHPOINT TESTS PASS: isolated user profile removed."
