# Deite Flutter — Smoke Test Checklist

Run the app:
```bash
cd flutter_app
flutter run -d emulator-5554 \
  --dart-define=BACKEND_URL=https://socitea.onrender.com \
  --dart-define=OPENAI_API_KEY=your_key \
  --dart-define=GROK_API_KEY=your_key
```

## Flow checklist

| Step | Route | Verify |
|------|-------|--------|
| 1. Splash | `/` | Shows logo; logged-out → landing after ~2s |
| 2. Landing | `/landing` | Get Started → signup |
| 3. Signup / Login | `/signup`, `/login` | Email auth; Google on Android device |
| 4. Profile details | `/signup/profile-details` | Birthday, age, bio saved |
| 5. Dashboard | `/dashboard` | Calendar, day reflection card, chat FAB |
| 6. Chat | `/chat` | Send message, whisper toggle, provider cycle |
| 7. Reflection | Dashboard | Generate / view day reflection |
| 8. Share | `/share-suggestions` | LinkedIn / X / Reddit suggestions |
| 9. Pod | `/pod` | Crew hub, sports / AI-tech tiles |
| 10. Community | `/community` | Feed loads, like/create post |

## UI parity vs Capacitor APK

Compare side-by-side on the same device resolution (390×844 typical):

- **Bottom nav**: height 56px, crew icon 64px, community icon scale 1.08 when active
- **Dashboard**: hub bg `#0F0F0F`, accent `#A855F7`, bottom padding for nav (~80px)
- **Chat bubbles**: user right-aligned purple tint; AI left gray
- **Splash/Landing**: logo circle 96px, purple glow shadow
- **Login**: radial gradient `#1B2735` → `#090A0F`, button `#8AB4F8`

Log spacing deltas in issues for follow-up tweaks.
