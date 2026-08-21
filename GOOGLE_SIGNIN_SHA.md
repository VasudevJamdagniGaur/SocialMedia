# Fix Google Sign-In error code 10 (Android)

**Error:** `DEVELOPER_ERROR` / code **10** — the SHA-1 of the certificate that signed the installed APK is not registered for `therapist.deite.app` in Firebase project `deitedatabase`.

## Already registered (local keystores)

| Build | SHA-1 | In `google-services.json`? |
|-------|-------|----------------------------|
| Release (`android/app/my-release-key.jks`) | `E8:3A:B9:EE:73:62:39:BB:78:B1:54:8B:DF:44:15:02:22:3D:FE:B5` | Yes |
| Debug (`~/.android/debug.keystore`) | `C4:65:FF:CB:3D:98:82:22:DC:72:9C:48:7E:5F:D5:0B:3C:9D:9F:8A` | Yes |

If **Play Store users** still get code 10, they are almost always signed with Google’s **Play App Signing** key — a **third** SHA-1 that is not in Firebase yet.

## Fix for Play Store installs (most likely)

1. Open [Google Play Console](https://play.google.com/console) → your app.
2. **Setup → App integrity → App signing** (or **Release → Setup → App signing**).
3. Under **App signing key certificate**, copy **SHA-1**.
4. Open [Firebase Console](https://console.firebase.google.com) → project **deitedatabase**.
5. ⚙ **Project settings** → Your apps → Android app `therapist.deite.app`.
6. **Add fingerprint** → paste the Play **App signing** SHA-1 (and SHA-256 if shown).
7. Also add the **Upload key certificate** SHA-1 from Play if it differs from your local release key.
8. Download a fresh **`google-services.json`** and replace:
   `flutter_app/android/app/google-services.json`
9. Wait 5–10 minutes for Google OAuth clients to propagate.
10. Rebuild and publish a new release:
    ```bash
    cd flutter_app
    flutter clean
    flutter build appbundle --release
    ```

You do **not** need to change the keystore password or create a new `.jks` for this — only register Play’s signing SHA-1.

## Verify local release SHA (optional)

```bash
keytool -list -v -keystore flutter_app/android/app/my-release-key.jks -alias my-key-alias
```

Compare to Firebase → Project settings → SHA certificate fingerprints.

## After updating Firebase

- Sideloaded release APKs signed with `my-release-key.jks` should already work (SHA matches).
- Play Store installs need the Play App Signing SHA-1 step above.
- Keep the Web client ID as `serverClientId` in `AuthService` (already set from `google-services.json` client_type 3).
