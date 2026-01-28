# Google Sign-In Setup (Native Android)

This app uses **native** Google Sign-In on Android via `@capacitor-firebase/authentication`. No web OAuth (no popup, no redirect). Follow these steps so Sign in with Google works in the APK.

---

## 1. Firebase Console

1. Open [Firebase Console](https://console.firebase.google.com/) and select your project.
2. Go to **Project settings** (gear) → **Your apps**.
3. If you don’t have an Android app:
   - Click **Add app** → **Android**.
   - **Android package name** must match your app exactly, e.g. `com.deite.app` (see `android/app/build.gradle.kts` → `applicationId`).
   - Register the app and download **google-services.json**.
4. Place **google-services.json** in:
   ```
   android/app/google-services.json
   ```
5. Add your **SHA-1** (and optionally SHA-256) for the keystore you use to build the APK:
   - In Project settings → Your apps → your Android app, click **Add fingerprint**.
   - Paste the SHA-1 from step 2 below.

---

## 2. Get SHA-1 for your keystore

**Debug builds (Android Studio / `./gradlew assembleDebug`):**

```bash
cd android
./gradlew signingReport
```

Under **Variant: debug**, copy the **SHA-1** (and SHA-256 if you want). Use the same values in Firebase (step 1) and in Google Cloud (step 3).

**Release builds (APK signed with your own keystore):**

If you use a release keystore (e.g. `my-release-key.jks`), get its SHA-1:

```bash
keytool -list -v -keystore android/app/my-release-key.jks -alias my-key-alias
```

Use that SHA-1 in Firebase and in the **release** Android OAuth client in Google Cloud.

---

## 3. Google Cloud Console – Android OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select the **same project** as in Firebase.
2. Go to **APIs & Services** → **Credentials**.
3. Click **Create credentials** → **OAuth client ID**.
4. Application type: **Android**.
5. **Name**: e.g. "Android client (Web app name)".
6. **Package name**: same as Firebase and `applicationId`, e.g. `com.deite.app`.
7. **SHA-1 certificate fingerprint**: paste the SHA-1 from step 2 (debug or release, depending on which build you use).
8. Create. You do **not** need a Web client or redirect URIs for native Sign-In.

---

## 4. Android project

- **Package name**: `android/app/build.gradle.kts` → `applicationId` (e.g. `com.deite.app`) must match Firebase and the Android OAuth client.
- **google-services.json**: must be in `android/app/`.
- **Plugins**: `@capacitor-firebase/authentication` is included via `capacitor.settings.gradle` and `capacitor.build.gradle`. After any change:
  ```bash
  npx cap sync android
  ```

---

## 5. Flow summary (no code changes needed if setup is done)

1. User taps **Sign in with Google** in the React app.
2. `signInWithGoogle()` in `authService.js` runs (only on native; on web it returns a clear error).
3. The Capacitor plugin opens the **native Android** Google account chooser.
4. User selects an account; the plugin returns an **ID token** (and optional access token).
5. The app calls Firebase **signInWithCredential** with that token, so the user is signed in to Firebase Auth.
6. The rest of the app uses Firebase Auth as usual (e.g. `getCurrentUser()`, `onAuthStateChange`).

No browser, no `signInWithPopup`, no `signInWithRedirect`, no redirect URIs.

---

## 6. Troubleshooting

| Symptom | Check |
|--------|--------|
| "FirebaseAuthentication plugin not available" | Run the **APK** (or `npx cap run android`), not the web app in a browser. Plugin only works on native. |
| "Google sign-in did not return an ID token" | Ensure SHA-1 is added in Firebase **and** in an **Android** OAuth client in Google Cloud (same package name). |
| Account picker doesn’t appear / silent fail | Same as above; also confirm `google-services.json` is in `android/app/` and run `npx cap sync android` then rebuild. |
| Build errors | Run `npm run build`, then `npx cap sync android`, then open `android/` in Android Studio and build the APK. |

---

## 7. References

- [Capacitor Firebase Authentication – Google Sign-In](https://github.com/capawesome-team/capacitor-firebase/blob/main/packages/authentication/docs/setup-google.md)
- [Firebase Auth – Android](https://firebase.google.com/docs/auth/android/start)
