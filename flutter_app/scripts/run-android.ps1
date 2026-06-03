# Reliable flutter run on Android emulator (fixes common adb install failures).
param(
    [string]$Device = "emulator-5554"
)

$ErrorActionPreference = "Stop"
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
    Write-Error "adb not found at $adb. Install Android SDK platform-tools."
}

Write-Host "Waiting for device $Device..."
& $adb -s $Device wait-for-device
Start-Sleep -Seconds 2

Write-Host "Removing old install (ignore errors if not installed)..."
& $adb -s $Device uninstall therapist.deite.app 2>$null | Out-Null

Set-Location (Join-Path $PSScriptRoot "..")
flutter run -d $Device @args
