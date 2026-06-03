# Archived — Capacitor + React web app

This folder is the **previous production client** (React 19 + Capacitor 7). It is **not maintained**.

The live app is **Flutter/Dart** in [`flutter_app/`](../../flutter_app/).

## Contents

| Path | Was |
|------|-----|
| `src/` | React UI + services |
| `mobile/` | Unused React Native orphan (`TeaFeedScreen.tsx`) |
| `android/` | Capacitor Android shell |
| `public/` | Static web assets |

## Running the old app (reference only)

```bash
cd legacy/capacitor-web
npm install
npm start
```

Do not use this for new features. Port changes to `flutter_app/lib/`.
