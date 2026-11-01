[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$failures = [System.Collections.Generic.List[string]]::new()

function Add-Failure {
    param([Parameter(Mandatory = $true)][string]$Message)
    [void]$failures.Add($Message)
}

function Read-RequiredText {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    $path = Join-Path $projectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Add-Failure "Missing required file: $RelativePath"
        return ''
    }
    return Get-Content -LiteralPath $path -Raw
}

function Require-Literal {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Context
    )
    if (-not $Text.Contains($Expected)) {
        Add-Failure "$Context is missing: $Expected"
    }
}

function Read-IniAssignments {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Context
    )
    $assignments = @{}
    $currentSection = ''
    $lineNumber = 0
    foreach ($rawLine in ($Text -split "`r?`n")) {
        $lineNumber += 1
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith(';') -or $line.StartsWith('#')) {
            continue
        }
        if ($line -match '^\[([^\]]+)\]$') {
            $currentSection = $Matches[1]
            continue
        }
        if ($line -notmatch '^([+-]?[A-Za-z0-9_.]+)\s*=(.*)$') {
            Add-Failure "$Context has malformed INI syntax on line $lineNumber`: $line"
            continue
        }
        if (-not $currentSection) {
            Add-Failure "$Context has an assignment outside a section on line $lineNumber`: $line"
            continue
        }
        $compoundKey = "$currentSection`n$($Matches[1])"
        if (-not $assignments.ContainsKey($compoundKey)) {
            $assignments[$compoundKey] = @()
        }
        $assignments[$compoundKey] += $Matches[2].Trim()
    }
    return $assignments
}

function Require-IniAssignment {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Assignments,
        [Parameter(Mandatory = $true)][string]$Section,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][string]$ExpectedValue,
        [Parameter(Mandatory = $true)][string]$Context,
        [switch]$AllowAdditionalValues
    )
    $compoundKey = "$Section`n$Key"
    if (-not $Assignments.ContainsKey($compoundKey)) {
        Add-Failure "$Context is missing [$Section] $Key=$ExpectedValue"
        return
    }
    $values = @($Assignments[$compoundKey])
    $matchCount = @($values | Where-Object { $_ -ceq $ExpectedValue }).Count
    if ($matchCount -ne 1) {
        Add-Failure "$Context must contain [$Section] $Key=$ExpectedValue exactly once; found $matchCount."
    }
    if (-not $AllowAdditionalValues -and $values.Count -ne 1) {
        Add-Failure "$Context contains conflicting or duplicate [$Section] $Key assignments: $($values -join ', ')"
    }
}

$projectText = Read-RequiredText 'Hushpoint.uproject'
$engineText = Read-RequiredText 'Config\DefaultEngine.ini'
$gameText = Read-RequiredText 'Config\DefaultGame.ini'
$settingsText = Read-RequiredText 'Config\DefaultGameUserSettings.ini'
$inputText = Read-RequiredText 'Config\DefaultInput.ini'
$migrationText = Read-RequiredText 'MIGRATION_PLAN.md'
$validationText = Read-RequiredText 'VALIDATION.md'
$engineIni = Read-IniAssignments $engineText 'DefaultEngine.ini'
$gameIni = Read-IniAssignments $gameText 'DefaultGame.ini'
$settingsIni = Read-IniAssignments $settingsText 'DefaultGameUserSettings.ini'
$inputIni = Read-IniAssignments $inputText 'DefaultInput.ini'

if ($projectText) {
    try {
        $project = $projectText | ConvertFrom-Json
        if ($project.FileVersion -ne 3) {
            Add-Failure 'Hushpoint.uproject FileVersion must be 3.'
        }
        if ($project.PSObject.Properties.Name -contains 'EngineAssociation') {
            Add-Failure 'EngineAssociation must stay absent until an installed UE5 version is tested.'
        }
        if ($project.PSObject.Properties.Name -contains 'Modules') {
            Add-Failure 'Blueprint-first scaffold must not declare native modules.'
        }
        if (@($project.TargetPlatforms) -notcontains 'Windows') {
            Add-Failure 'Hushpoint.uproject must target Windows.'
        }
        $plugins = @($project.Plugins)
        if ($plugins.Count -ne 1 -or $plugins[0].Name -ne 'EnhancedInput' -or $plugins[0].Enabled -ne $true) {
            Add-Failure 'EnhancedInput must be the only declared plugin and must be enabled.'
        }
    }
    catch {
        Add-Failure "Hushpoint.uproject is not valid JSON: $($_.Exception.Message)"
    }
}

$hardwareSection = '/Script/HardwareTargeting.HardwareTargetingSettings'
$rendererSection = '/Script/Engine.RendererSettings'
$windowsSection = '/Script/WindowsTargetPlatform.WindowsTargetSettings'
$uiSection = '/Script/Engine.UserInterfaceSettings'
Require-IniAssignment $engineIni $hardwareSection 'TargetedHardwareClass' 'Desktop' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $hardwareSection 'DefaultGraphicsPerformance' 'Maximum' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $rendererSection 'r.AllowStaticLighting' 'False' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $rendererSection 'r.DynamicGlobalIlluminationMethod' '1' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $rendererSection 'r.ReflectionMethod' '1' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $rendererSection 'r.ForwardShading' 'False' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $rendererSection 'r.GenerateMeshDistanceFields' 'True' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $rendererSection 'r.Lumen.HardwareRayTracing' 'False' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $rendererSection 'r.RayTracing' 'False' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $rendererSection 'r.Nanite.ProjectEnabled' 'False' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $rendererSection 'r.Shadow.Virtual.Enable' '0' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $windowsSection 'DefaultGraphicsRHI' 'DefaultGraphicsRHI_DX12' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $windowsSection '+D3D12TargetedShaderFormats' 'PCD3D_SM6' 'DefaultEngine.ini'
Require-IniAssignment $engineIni 'SystemSettings' 't.MaxFPS' '30' 'DefaultEngine.ini'
Require-IniAssignment $engineIni $uiSection 'DesignScreenSize' '(X=1280,Y=720)' 'DefaultEngine.ini'

$projectSection = '/Script/EngineSettings.GeneralProjectSettings'
Require-IniAssignment $gameIni $projectSection 'ProjectName' 'HUSHPOINT' 'DefaultGame.ini'
Require-IniAssignment $gameIni $projectSection 'ProjectVersion' '0.1.0-scaffold' 'DefaultGame.ini'

$settingsSection = '/Script/Engine.GameUserSettings'
Require-IniAssignment $settingsIni $settingsSection 'ResolutionSizeX' '1280' 'DefaultGameUserSettings.ini'
Require-IniAssignment $settingsIni $settingsSection 'ResolutionSizeY' '720' 'DefaultGameUserSettings.ini'
Require-IniAssignment $settingsIni $settingsSection 'LastUserConfirmedResolutionSizeX' '1280' 'DefaultGameUserSettings.ini'
Require-IniAssignment $settingsIni $settingsSection 'LastUserConfirmedResolutionSizeY' '720' 'DefaultGameUserSettings.ini'
Require-IniAssignment $settingsIni $settingsSection 'FullscreenMode' '2' 'DefaultGameUserSettings.ini'
Require-IniAssignment $settingsIni $settingsSection 'FrameRateLimit' '30.000000' 'DefaultGameUserSettings.ini'

$inputSection = '/Script/Engine.InputSettings'
Require-IniAssignment $inputIni $inputSection 'DefaultPlayerInputClass' '/Script/EnhancedInput.EnhancedPlayerInput' 'DefaultInput.ini'
Require-IniAssignment $inputIni $inputSection 'DefaultInputComponentClass' '/Script/EnhancedInput.EnhancedInputComponent' 'DefaultInput.ini'
foreach ($axis in @(
    '(AxisName="MoveForward",Scale=1.000000,Key=W)',
    '(AxisName="MoveForward",Scale=-1.000000,Key=S)',
    '(AxisName="MoveForward",Scale=1.000000,Key=Up)',
    '(AxisName="MoveForward",Scale=-1.000000,Key=Down)',
    '(AxisName="MoveRight",Scale=-1.000000,Key=A)',
    '(AxisName="MoveRight",Scale=1.000000,Key=D)',
    '(AxisName="MoveRight",Scale=-1.000000,Key=Left)',
    '(AxisName="MoveRight",Scale=1.000000,Key=Right)'
)) {
    Require-IniAssignment $inputIni $inputSection '+AxisMappings' $axis 'DefaultInput.ini' -AllowAdditionalValues
}

foreach ($contract in @(
    'Up = swizzle `YXZ`',
    'Down = negate then swizzle `YXZ`',
    'Right = positive X',
    'Left = negate X',
    '25–42 minute'
)) {
    Require-Literal $migrationText $contract 'MIGRATION_PLAN.md'
}
Require-Literal $validationText 'Blocked` is not a product pass' 'VALIDATION.md'

if ($failures.Count -gt 0) {
    Write-Error ("HUSHPOINT Unreal scaffold validation failed:`n - " + ($failures -join "`n - "))
    exit 1
}

Write-Output 'PASS: HUSHPOINT Unreal scaffold contract validated.'
