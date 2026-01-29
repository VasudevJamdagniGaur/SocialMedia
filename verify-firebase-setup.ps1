# Firebase Setup Verification Script
# Run this after placing google-services.json

Write-Host "🔍 Verifying Firebase Setup for Android..." -ForegroundColor Cyan
Write-Host ""

# Check if google-services.json exists
$googleServicesPath = "android\app\google-services.json"
if (Test-Path $googleServicesPath) {
    Write-Host "✅ google-services.json found!" -ForegroundColor Green
    
    # Check if it's valid JSON
    try {
        $json = Get-Content $googleServicesPath -Raw | ConvertFrom-Json
        Write-Host "✅ File is valid JSON" -ForegroundColor Green
        
        # Check package name
        $packageName = $json.client[0].client_info.android_client_info.package_name
        if ($packageName -eq "com.deite.app") {
            Write-Host "✅ Package name is correct: $packageName" -ForegroundColor Green
        } else {
            Write-Host "❌ WRONG package name: $packageName (should be com.deite.app)" -ForegroundColor Red
            Write-Host "   Download the correct google-services.json from Firebase Console" -ForegroundColor Yellow
        }
        
        # Check project ID
        $projectId = $json.project_info.project_id
        Write-Host "📋 Project ID: $projectId" -ForegroundColor White
        
    } catch {
        Write-Host "❌ File exists but is not valid JSON!" -ForegroundColor Red
        Write-Host "   Re-download from Firebase Console" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ google-services.json NOT FOUND!" -ForegroundColor Red
    Write-Host "   Expected location: $googleServicesPath" -ForegroundColor Yellow
    Write-Host "   Follow instructions in FIREBASE_SETUP_INSTRUCTIONS.md" -ForegroundColor Yellow
}

Write-Host ""

# Check package.json dependencies
Write-Host "📦 Checking Firebase dependencies..." -ForegroundColor Cyan
$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
if ($packageJson.dependencies."@capacitor-firebase/authentication") {
    Write-Host "✅ @capacitor-firebase/authentication installed" -ForegroundColor Green
} else {
    Write-Host "❌ @capacitor-firebase/authentication NOT installed" -ForegroundColor Red
}

if ($packageJson.dependencies.firebase) {
    Write-Host "✅ firebase installed" -ForegroundColor Green
} else {
    Write-Host "❌ firebase NOT installed" -ForegroundColor Red
}

Write-Host ""

# Check build.gradle
Write-Host "📝 Checking build.gradle..." -ForegroundColor Cyan
$buildGradle = Get-Content "android\build.gradle" -Raw
if ($buildGradle -match "com.google.gms:google-services") {
    Write-Host "✅ Google Services plugin configured in build.gradle" -ForegroundColor Green
} else {
    Write-Host "❌ Google Services plugin NOT in build.gradle" -ForegroundColor Red
}

Write-Host ""

# Check AndroidManifest
Write-Host "📝 Checking AndroidManifest.xml..." -ForegroundColor Cyan
$manifest = Get-Content "android\app\src\main\AndroidManifest.xml" -Raw
if ($manifest -match "INTERNET") {
    Write-Host "✅ INTERNET permission present" -ForegroundColor Green
} else {
    Write-Host "❌ INTERNET permission missing" -ForegroundColor Red
}

Write-Host ""
Write-Host "📋 Summary:" -ForegroundColor Cyan
Write-Host "1. If google-services.json is present and correct, rebuild the app:" -ForegroundColor White
Write-Host "   npm run build" -ForegroundColor Yellow
Write-Host "   npx cap sync android" -ForegroundColor Yellow
Write-Host "   cd android && ./gradlew assembleDebug" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. Install the APK on your phone and test Google Sign-In" -ForegroundColor White
Write-Host ""
Write-Host "3. If still not working, check:" -ForegroundColor White
Write-Host "   - SHA-1 fingerprint is added in Firebase Console" -ForegroundColor Yellow
Write-Host "   - Google Sign-In is enabled in Firebase Authentication" -ForegroundColor Yellow
Write-Host "   - Package name matches: com.deite.app" -ForegroundColor Yellow

