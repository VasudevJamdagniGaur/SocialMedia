# Deite Flutter — agent instructions

This directory **is the app**. All product code is Dart under `lib/`.

- **Do not** edit `legacy/capacitor-web/` for new features.
- **Routes**: `lib/router/app_router.dart` (27 routes)
- **Services**: `lib/services/` (`chat_service.dart`, `firestore_service.dart`, …)
- **Pod/news libs**: `lib/lib/pod_*.dart`
- **Env**: `--dart-define` keys in `lib/config/env.dart`
- **Firebase Android**: `android/app/google-services.json`

When comparing behavior to the old web app, read reference only from `../legacy/capacitor-web/src/`.
