# Compare release/debug SHA-1 with android/app/google-services.json (fixes Google Sign-In error 10)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$gsPath = Join-Path $root "android\app\google-services.json"
$releaseKs = Join-Path $root "android\app\my-release-key.jks"

Write-Host "Google Sign-In SHA-1 check" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $gsPath)) {
  Write-Host "Missing google-services.json at $gsPath" -ForegroundColor Red
  exit 1
}

$gs = Get-Content $gsPath -Raw | ConvertFrom-Json
$registered = @()
foreach ($oc in $gs.client[0].oauth_client) {
  if ($oc.client_type -eq 1 -and $oc.android_info.certificate_hash) {
    $registered += $oc.android_info.certificate_hash.ToLower()
  }
}
Write-Host "Registered in google-services.json:" -ForegroundColor White
$registered | ForEach-Object { Write-Host "  - $_" }

function Normalize-Sha1($line) {
  if ($line -match "SHA1:\s*([0-9A-F:]+)") {
    return ($Matches[1] -replace ":", "").ToLower()
  }
  return $null
}

$releaseSha = $null
if (Test-Path $releaseKs) {
  $out = keytool -list -v -keystore $releaseKs -alias my-key-alias -storepass "Vasudev@123" 2>&1 | Out-String
  $releaseSha = Normalize-Sha1 $out
  if ($releaseSha) {
    Write-Host ""
    Write-Host "Release keystore (my-release-key.jks) SHA-1: $releaseSha" -ForegroundColor White
    if ($registered -contains $releaseSha) {
      Write-Host "OK: Release SHA-1 is registered." -ForegroundColor Green
    } else {
      Write-Host "MISSING: Add this SHA-1 in Firebase, then refresh google-services.json." -ForegroundColor Red
    }
  }
}

$debugKs = Join-Path $env:USERPROFILE ".android\debug.keystore"
if (Test-Path $debugKs) {
  $out = keytool -list -v -keystore $debugKs -alias androiddebugkey -storepass android -keypass android 2>&1 | Out-String
  $debugSha = Normalize-Sha1 $out
  if ($debugSha) {
    Write-Host ""
    Write-Host "Debug keystore SHA-1: $debugSha" -ForegroundColor White
    if ($registered -contains $debugSha) {
      Write-Host "OK: Debug SHA-1 is registered." -ForegroundColor Green
    } else {
      Write-Host "MISSING: Add debug SHA-1 in Firebase for Studio debug builds." -ForegroundColor Yellow
    }
  }
}

Write-Host ""
Write-Host "After any Firebase change: npx cap sync android, rebuild APK, reinstall." -ForegroundColor Cyan
