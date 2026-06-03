# Deite Flutter Migration

This directory contains the **Flutter port** of the Deite app (formerly React 19 + Capacitor 7 hybrid web app).

> **Note:** The original codebase is **React + Capacitor**, not React Native. One orphan RN file exists at `mobile/screens/TeaFeedScreen.tsx` but is not used in production. The Flutter app ports the live web/Capacitor implementation under `src/`.

## Project structure

```
flutter_app/
├── lib/
│   ├── main.dart                 # App entry + Firebase init
│   ├── config/                   # env.dart, firebase_options.dart
│   ├── contexts/                 # ThemeNotifier (dark/light)
│   ├── router/                   # go_router — 27 routes mirroring App.js
│   ├── services/                 # API, auth, Firestore, chat, reflection, news
│   ├── screens/                  # All pages (Dashboard, Chat, Pod, Community, …)
│   ├── components/               # Bottom nav, calendar, skeletons, share cards
│   ├── lib/                      # Pod explore config, trending algorithms
│   ├── models/                   # ChatMessage, etc.
│   └── utils/                    # date_utils, storage helpers
├── assets/images/                # DEITECIrc.webp, provider icons
├── assets/icons/                 # crew-icon, community icon
└── android/                      # therapist.deite.app package
```

## Prerequisites

- Flutter SDK 3.44+ (`flutter doctor`)
- Android Studio / Xcode for device builds
- Firebase project `deitedatabase` (same as React app)
- API keys (see Environment variables)

On Windows, enable **Developer Mode** for plugin symlinks: Settings → Privacy & security → For developers → Developer Mode.

## Setup

### 1. Install dependencies

```bash
cd flutter_app
flutter pub get
```

**Windows:** Enable **Developer Mode** (Settings → Privacy & security → For developers → Developer Mode ON). Required for Flutter plugin symlinks. If registry change needs admin, toggle manually in Settings.

### 2. Firebase Android

1. `google-services.json` is already at `android/app/` (copied from Capacitor project).
2. Android Firebase options are set in `lib/config/firebase_options.dart`:
   - `appId`: `1:300613626896:android:96b25a5c6549a45307ae95`
   - `apiKey`: from `google-services.json`
3. Register your debug/release SHA-1 in Firebase Console for Google Sign-In (see `../DEBUG_GOOGLE_SIGNIN.md`).

### 3. Environment variables

React used `REACT_APP_*` in `.env`. Flutter uses `--dart-define`:

| React (REACT_APP_*) | Flutter (--dart-define) |
|---------------------|-------------------------|
| `OPENAI_API_KEY` | `OPENAI_API_KEY` |
| `GROK_API_KEY` | `GROK_API_KEY` |
| `BACKEND_URL` / `VERTEX_BACKEND_URL` | `BACKEND_URL` |
| `GENERATE_NEWS_IMAGE_FALLBACK_URL` | `GENERATE_NEWS_IMAGE_FALLBACK_URL` |
| `NEWSAPI_KEY` | `NEWSAPI_KEY` |
| `WORLDNEWS_API_KEY` | `WORLDNEWS_API_KEY` |
| `GNEWS_API_KEY` | `GNEWS_API_KEY` |
| `THENEWS_API_TOKEN` | `THENEWS_API_TOKEN` |

Example run:

```bash
flutter run \
  --dart-define=OPENAI_API_KEY=sk-... \
  --dart-define=GROK_API_KEY=xai-... \
  --dart-define=BACKEND_URL=https://detea-backend.onrender.com \
  --dart-define=NEWSAPI_KEY=...
```

For release builds, pass the same defines to `flutter build apk`.

### 4. Backend (unchanged)

- **Vertex Express:** `backend-vertex/` on Render (`https://detea-backend.onrender.com`)
- **Firebase Functions:** `functions/` (LinkedIn, NewsAPI proxy, ingest)
- **Firestore rules:** `firestore.rules` (unchanged)

No server-side changes required for Flutter.

### 5. Run

```bash
# Android
flutter run

# With local Vertex backend
flutter run --dart-define=BACKEND_URL=http://10.0.2.2:3002
```

## Routes (parity with React Router)

| Path | Screen |
|------|--------|
| `/` | Splash |
| `/landing` | Landing |
| `/welcome` | Welcome |
| `/signup`, `/login` | Auth |
| `/signup/profile-details` | Onboarding |
| `/dashboard` | Home + day reflection |
| `/chat` | AI chat (whisper mode) |
| `/pod/*` | Crew hub, sports, AI-tech, explore |
| `/community`, `/watchlist` | Social feed |
| `/wellbeing` | Mood charts |
| `/reflections`, `/share-*` | Reflection history & social share |
| `/tea-feed` | Entertainment feed |
| `/profile`, `/user/:userId` | Profiles |

Android hardware back behavior is implemented in `lib/router/app_router.dart` via `PopScope`.

## React Native / Capacitor → Flutter library mapping

| Original | Flutter equivalent | Notes |
|----------|-------------------|-------|
| React 19 + CRA | Flutter widgets | Full rewrite |
| react-router-dom | `go_router` | Same paths |
| React Context (theme) | `provider` + `ThemeNotifier` | localStorage → SharedPreferences |
| Capacitor core | Flutter platform channels | Native APIs via plugins |
| @capacitor-firebase/authentication | `google_sign_in` + `firebase_auth` | Native Google Sign-In |
| @capacitor/share | `share_plus` | Share sheets |
| @capacitor/filesystem | `path_provider` | Cache before share |
| @capacitor/clipboard | `Clipboard` (services) | Built-in |
| @capacitor/app (back button) | `PopScope` + `SystemNavigator` | Route stack in app_router |
| firebase JS SDK | `firebase_core`, `firebase_auth`, `cloud_firestore`, `firebase_storage` | Same project |
| fetch / CapacitorHttp | `http` package | api_client.dart |
| axios (mentioned in requirements) | **Not used in React app** — uses `fetch` | Ported as `http` |
| localStorage | `shared_preferences` | Same key names preserved |
| sessionStorage | `shared_preferences` (session keys) | |
| lucide-react | `lucide_icons` | Icon parity |
| recharts | `fl_chart` | Wellbeing charts |
| html-to-image | `screenshot` + `RepaintBoundary` | Share card PNG export |
| browser-image-compression | `flutter_image_compress` | Profile uploads |
| react-easy-crop | `image_cropper` | Profile crop UI |
| gsap / Shuffle.tsx | Flutter `AnimationController` + custom | Text scramble simplified |
| three.js / LaserFlow.tsx | Custom painters or static gradient | See parity notes |
| tailwind CSS | Inline `ThemeData` + `BoxDecoration` | Colors matched manually |

## Parity notes (closest Flutter equivalent)

| Area | Limitation | Flutter approach |
|------|------------|------------------|
| **LaserFlow / Three.js** | No 1:1 WebGL laser | Starfield gradient on login; optional `flutter_gl` later |
| **GSAP SplitText** | No GSAP | `AnimatedDefaultTextStyle` / custom scramble |
| **Pixel-perfect Tailwind** | Different layout engine | Manual spacing from React inline styles |
| **Browser CORS proxies** | N/A on mobile | Direct HTTP or Firebase Functions only |
| **OpenAI keys in client** | Same security model as React | Keys via `--dart-define`; consider moving to backend |
| **LinkedIn OAuth web callback** | WebView/deep link | `url_launcher` + App Links (`therapist.deite.app`) |
| **TeaFeedScreen.tsx (RN)** | Orphan file | Ported from `TeaFeedPage.js` (web) |

## Validation checklist

| Item | Status |
|------|--------|
| 27 routes defined | ✅ `app_router.dart` |
| Firebase auth (email + Google) | ✅ `auth_service.dart` |
| Firestore service (~60+ methods) | ✅ `firestore_service.dart` |
| Vertex API client (all endpoints) | ✅ `vertex_api_client.dart` |
| Chat service (multi-provider) | ✅ `chat_service.dart` |
| Reflection service | ✅ `reflection_service.dart` |
| Dashboard + Pod hub screens | ✅ Ported |
| Chat page (whisper, providers) | ✅ Ported |
| Community / share / wellbeing | ✅ Ported |
| Dark/light theme | ✅ |
| Bottom navigation | ✅ |
| Android back stack | ✅ |

Run `flutter analyze` and fix remaining issues before release.

## Unchanged backend endpoints

All Vertex routes preserved (`backend-vertex/index.js`):

- `POST /chat`, `/reflection`, `/summary`, `/analyze-pattern`
- `POST /generate-news-image`, `/image-description`, `/generateContent`, `/generatePost`
- `GET /health`

Firebase Functions: LinkedIn API, NewsAPI proxy, news ingest, delete account, post embeddings — **no changes**.

## Building release APK

```bash
flutter build apk --release \
  --dart-define=OPENAI_API_KEY=... \
  --dart-define=BACKEND_URL=https://detea-backend.onrender.com
```

Sign with the same keystore as the Capacitor app (`android/app/my-release-key.jks`) for Google Sign-In continuity.
