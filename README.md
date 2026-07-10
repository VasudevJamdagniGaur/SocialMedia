# Deite — Emotional Wellness App

**The mobile app is Flutter/Dart.** All UI, routing, Firebase, AI chat, pods, and community live in [`flutter_app/`](flutter_app/).

> The old React + Capacitor client was archived to [`legacy/capacitor-web/`](legacy/capacitor-web/) and is hidden from Cursor via `.cursorignore`.

## Quick start (Flutter)

```powershell
cd flutter_app
flutter pub get
flutter run -d emulator-5554 `
  --dart-define=BACKEND_URL=https://socitea.onrender.com `
  --dart-define=OPENAI_API_KEY=your_key `
  --dart-define=GROK_API_KEY=your_key
```

On Windows, enable **Developer Mode** (Settings → Privacy & security → For developers) for plugin symlinks.

See [`flutter_app/MIGRATION.md`](flutter_app/MIGRATION.md) and [`flutter_app/SMOKE_TEST.md`](flutter_app/SMOKE_TEST.md).

## Cursor / VS Code

Open **`deite.code-workspace`** — workspace folders are `flutter_app/` and `server/` (Dart only). Legacy JS/TS is under `legacy/` and hidden from search.

## Backend (Dart)

```powershell
cd server
dart pub get
dart run bin/server.dart
```

Set `GOOGLE_APPLICATION_CREDENTIALS`, `NEWSAPI_KEY`, `OPENAI_API_KEY`. See [`server/README.md`](server/README.md).

## Repo layout

| Path | Purpose |
|------|---------|
| **`flutter_app/`** | **Production mobile app (Dart/Flutter)** |
| **`server/`** | **Production backend (Dart/Shelf)** — Vertex AI, NewsAPI proxy, suggestions |
| `legacy/capacitor-web/` | Archived React/Capacitor client |
| `legacy/backend-vertex-node/` | Archived Node Vertex backend |
| `legacy/functions-ts/` | Archived Firebase Functions (TS) — triggers only |
| `legacy/detea-proxy-node/` | Archived dev Reddit proxy |
| `firestore.rules`, `storage.rules` | Firebase security rules |

## Features (Flutter)

- AI chat (OpenAI / Grok / Vertex), whispers, day reflections
- Dashboard, calendar, emotional wellbeing
- Crew pods: sports, AI-tech, entrepreneurship, current affairs, explore feeds
- Community, tea feed, watchlist, share to LinkedIn / X / Reddit
- Firebase Auth, Firestore, Google Sign-In (Android)

## Android release

Flutter Android project: `flutter_app/android/` (`therapist.deite.app`).  
Release keystore from the old Capacitor app: `legacy/capacitor-web/android/app/my-release-key.jks`.
