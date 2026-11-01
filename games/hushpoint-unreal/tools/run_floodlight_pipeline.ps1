[CmdletBinding()]
param(
    [string]$BlenderPath = '',
    [ValidateRange(0.1, 100.0)]
    [double]$TargetHeightMeters = 4.2,
    [ValidateRange(1, 100000000)]
    [int]$TriangleBudget = 60000
)

$ErrorActionPreference = 'Stop'
$toolDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDirectory = Split-Path -Parent $toolDirectory
$assetDirectory = Join-Path $projectDirectory 'SourceAssets'

function Resolve-BlenderExecutable {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        return (Resolve-Path -LiteralPath $RequestedPath -ErrorAction Stop).Path
    }

    $command = Get-Command blender -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $knownPaths = @(
        (Join-Path $env:TEMP 'hushpoint-blender-4.5.10\runtime\blender-4.5.10-windows-x64\blender.exe'),
        'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe'
    )
    foreach ($knownPath in $knownPaths) {
        if (Test-Path -LiteralPath $knownPath -PathType Leaf) {
            return $knownPath
        }
    }

    throw 'Blender 4.5.10 LTS was not found. Pass -BlenderPath explicitly.'
}

$blender = Resolve-BlenderExecutable -RequestedPath $BlenderPath
$inputGlb = Join-Path $assetDirectory 'raw\higgsfield_sam3d_99aec965-11b1-4c20-af4d-ca064aac2d77_raw.glb'
$outputGlb = Join-Path $assetDirectory 'processed\SM_Hushpoint_Floodlight.glb'
$outputFbx = Join-Path $assetDirectory 'processed\SM_Hushpoint_Floodlight.fbx'
$outputBlend = Join-Path $assetDirectory 'processed\SM_Hushpoint_Floodlight.blend'
$preview = Join-Path $assetDirectory 'reports\SM_Hushpoint_Floodlight_preview.png'
$report = Join-Path $assetDirectory 'reports\floodlight_pipeline_report.json'

& $blender --background --factory-startup --python (Join-Path $toolDirectory 'blender_floodlight_pipeline.py') -- `
    --input $inputGlb `
    --output-glb $outputGlb `
    --output-fbx $outputFbx `
    --output-blend $outputBlend `
    --preview $preview `
    --report $report `
    --asset-name 'SM_Hushpoint_Floodlight' `
    --target-height-m $TargetHeightMeters `
    --triangle-budget $TriangleBudget

if ($LASTEXITCODE -ne 0) {
    throw "Floodlight asset pipeline failed with exit code $LASTEXITCODE. See $report."
}

Write-Host "Processed GLB: $outputGlb"
Write-Host "Unreal FBX:    $outputFbx"
Write-Host "Blender file: $outputBlend"
Write-Host "Preview:      $preview"
Write-Host "Report:       $report"
