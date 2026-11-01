$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$Python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    & py -3.12 -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Creating the Python virtual environment failed with exit code $LASTEXITCODE." }
}
if (-not (Test-Path -LiteralPath $Python)) { throw "Python virtual environment was not created at $Python." }

& $Python -m pip install --disable-pip-version-check -r requirements-dev.txt
if ($LASTEXITCODE -ne 0) { throw "Installing build dependencies failed with exit code $LASTEXITCODE." }
& $Python -m unittest discover -s tests -v
if ($LASTEXITCODE -ne 0) { throw "Unit tests failed with exit code $LASTEXITCODE." }

$PreviousVideoDriver = $env:SDL_VIDEODRIVER
$PreviousAudioDriver = $env:SDL_AUDIODRIVER
try {
    $env:SDL_VIDEODRIVER = "dummy"
    $env:SDL_AUDIODRIVER = "dummy"
    & $Python scripts\smoke_test.py
    if ($LASTEXITCODE -ne 0) { throw "Headless smoke test failed with exit code $LASTEXITCODE." }
    & $Python scripts\performance_check.py
    if ($LASTEXITCODE -ne 0) { throw "Performance check failed with exit code $LASTEXITCODE." }
}
finally {
    $env:SDL_VIDEODRIVER = $PreviousVideoDriver
    $env:SDL_AUDIODRIVER = $PreviousAudioDriver
}

& $Python -m PyInstaller --noconfirm --clean RecallZero.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with exit code $LASTEXITCODE." }

$NoticeRoot = Join-Path $PSScriptRoot "dist\RecallZero\THIRD_PARTY_NOTICES"
& $Python scripts\fetch_pygame_licenses.py (Join-Path $NoticeRoot "pygame-ce-2.5.8")
if ($LASTEXITCODE -ne 0) { throw "Fetching pygame-ce notices and source failed with exit code $LASTEXITCODE." }
Copy-Item -LiteralPath "THIRD_PARTY_NOTICES.md" -Destination (Join-Path $NoticeRoot "README.md") -Force
Copy-Item -LiteralPath "RELINKING.md" -Destination (Join-Path $NoticeRoot "RELINKING.md") -Force

$PythonBase = & $Python -c "import sys; print(sys.base_prefix)"
if ($LASTEXITCODE -ne 0) { throw "Locating the Python runtime license failed with exit code $LASTEXITCODE." }
$PythonLicense = Join-Path $PythonBase.Trim() "LICENSE.txt"
if (-not (Test-Path -LiteralPath $PythonLicense)) { throw "Python runtime license not found at $PythonLicense." }
$PythonNotice = Join-Path $NoticeRoot "Python-3.12"
New-Item -ItemType Directory -Path $PythonNotice -Force | Out-Null
Copy-Item -LiteralPath $PythonLicense -Destination (Join-Path $PythonNotice "LICENSE.txt") -Force

$PyInstallerLicense = Get-ChildItem -Path ".venv\Lib\site-packages\pyinstaller-*.dist-info\licenses\COPYING.txt" | Select-Object -First 1
if ($null -eq $PyInstallerLicense) { throw "PyInstaller license was not found in the virtual environment." }
$PyInstallerNotice = Join-Path $NoticeRoot "PyInstaller-6.22.3"
New-Item -ItemType Directory -Path $PyInstallerNotice -Force | Out-Null
Copy-Item -LiteralPath $PyInstallerLicense.FullName -Destination (Join-Path $PyInstallerNotice "COPYING.txt") -Force

Write-Host "Built: $PSScriptRoot\dist\RecallZero\RecallZero.exe"
