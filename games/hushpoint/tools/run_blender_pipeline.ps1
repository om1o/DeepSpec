[CmdletBinding(DefaultParameterSetName = 'Optimize')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Optimize')]
    [string]$InputGlb,

    [Parameter(Mandatory = $true, ParameterSetName = 'Optimize')]
    [string]$OutputGlb,

    [Parameter(Mandatory = $true, ParameterSetName = 'Optimize')]
    [string]$ReportPath,

    [Parameter(Mandatory = $true, ParameterSetName = 'Fallback')]
    [switch]$GenerateFallback,

    [Parameter(ParameterSetName = 'Optimize')]
    [ValidateRange(1, 100000000)]
    [int]$DecimateThreshold = 50000,

    [Parameter(ParameterSetName = 'Optimize')]
    [ValidateRange(1, 100000000)]
    [int]$TargetTriangles = 30000,

    [Parameter(ParameterSetName = 'Optimize')]
    [string]$AssetName = '',

    [string]$BlenderPath = ''
)

$ErrorActionPreference = 'Stop'
$toolDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDirectory = Split-Path -Parent $toolDirectory

function Resolve-BlenderExecutable {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        $resolved = Resolve-Path -LiteralPath $RequestedPath -ErrorAction Stop
        return $resolved.Path
    }

    $command = Get-Command blender -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $knownPaths = @(
        (Join-Path $env:TEMP 'hushpoint-blender-4.5.10\runtime\blender-4.5.10-windows-x64\blender.exe'),
        'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe',
        'C:\Program Files\Blender Foundation\Blender 4.4\blender.exe',
        'C:\Program Files\Blender Foundation\Blender 4.3\blender.exe',
        'C:\Program Files\Blender Foundation\Blender 4.2\blender.exe',
        'C:\Program Files\Blender Foundation\Blender 4.1\blender.exe',
        'C:\Program Files\Blender Foundation\Blender 4.0\blender.exe'
    )
    foreach ($knownPath in $knownPaths) {
        if (Test-Path -LiteralPath $knownPath -PathType Leaf) {
            return $knownPath
        }
    }

    $appPackage = Get-AppxPackage -Name '*Blender*' -ErrorAction SilentlyContinue |
        Where-Object { $_.InstallLocation } |
        Select-Object -First 1
    if ($appPackage) {
        $appExecutable = Join-Path $appPackage.InstallLocation 'Blender\blender.exe'
        if (-not (Test-Path -LiteralPath $appExecutable -PathType Leaf)) {
            $appExecutable = Get-ChildItem -LiteralPath $appPackage.InstallLocation -Filter blender.exe -Recurse -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty FullName
        }
        if ($appExecutable) {
            return $appExecutable
        }
    }

    throw 'Blender was not found. Install Blender 4.x or pass -BlenderPath explicitly.'
}

function Resolve-ProjectPath {
    param([string]$PathValue)

    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return [System.IO.Path]::GetFullPath($PathValue)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $projectDirectory $PathValue))
}

$blender = Resolve-BlenderExecutable -RequestedPath $BlenderPath
Write-Host "Blender: $blender"

if ($GenerateFallback) {
    $sourceGlb = Join-Path $projectDirectory 'assets\source\port_mercy_tide_gauge_original.glb'
    $generationReport = Join-Path $projectDirectory 'assets\reports\port_mercy_tide_gauge_generation.json'
    $optimizedGlb = Join-Path $projectDirectory 'assets\models\port_mercy_tide_gauge.glb'
    $pipelineReport = Join-Path $projectDirectory 'assets\reports\port_mercy_tide_gauge_pipeline.json'

    & $blender --background --factory-startup --python (Join-Path $toolDirectory 'generate_tide_gauge.py') -- `
        --output $sourceGlb `
        --report $generationReport
    if ($LASTEXITCODE -ne 0) {
        throw "Fallback asset generation failed with exit code $LASTEXITCODE."
    }

    & $blender --background --factory-startup --python (Join-Path $toolDirectory 'blender_asset_pipeline.py') -- `
        --input $sourceGlb `
        --output $optimizedGlb `
        --report $pipelineReport `
        --decimate-threshold 50000 `
        --target-triangles 30000 `
        --asset-name Port_Mercy_Tide_Gauge
    if ($LASTEXITCODE -ne 0) {
        throw "Fallback asset optimization failed with exit code $LASTEXITCODE."
    }

    Write-Host "Original:  $sourceGlb"
    Write-Host "Optimized: $optimizedGlb"
    Write-Host "Report:    $pipelineReport"
    exit 0
}

$resolvedInput = Resolve-ProjectPath -PathValue $InputGlb
$resolvedOutput = Resolve-ProjectPath -PathValue $OutputGlb
$resolvedReport = Resolve-ProjectPath -PathValue $ReportPath

& $blender --background --factory-startup --python (Join-Path $toolDirectory 'blender_asset_pipeline.py') -- `
    --input $resolvedInput `
    --output $resolvedOutput `
    --report $resolvedReport `
    --decimate-threshold $DecimateThreshold `
    --target-triangles $TargetTriangles `
    --asset-name $AssetName
if ($LASTEXITCODE -ne 0) {
    throw "Asset pipeline failed with exit code $LASTEXITCODE. See $resolvedReport."
}

Write-Host "Optimized: $resolvedOutput"
Write-Host "Report:    $resolvedReport"
