# Script to check keystore SHA1 fingerprint
# This helps verify if a keystore matches the one expected by Google Play

param(
    [Parameter(Mandatory=$true)]
    [string]$KeystorePath,
    
    [Parameter(Mandatory=$true)]
    [string]$StorePassword,
    
    [Parameter(Mandatory=$false)]
    [string]$KeyAlias = ""
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Checking Keystore Fingerprint" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Expected SHA1 (from Google Play):" -ForegroundColor Yellow
Write-Host "56:C7:FE:88:BD:80:B9:BD:0B:90:3C:DD:30:D4:64:2E:FA:1D:C5:64" -ForegroundColor Yellow
Write-Host ""

if ($KeyAlias -eq "") {
    Write-Host "Getting keystore info..." -ForegroundColor Green
    keytool -list -v -keystore $KeystorePath -storepass $StorePassword
} else {
    Write-Host "Getting keystore info for alias: $KeyAlias" -ForegroundColor Green
    keytool -list -v -keystore $KeystorePath -storepass $StorePassword -alias $KeyAlias
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Look for the SHA1 fingerprint above" -ForegroundColor Cyan
Write-Host "It should match the expected one!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

