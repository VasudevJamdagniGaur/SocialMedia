# LinkedIn OAuth – DeTea

## 1. LinkedIn Developer App

- **Authorized redirect URL:**  
  `https://deitedatabase.firebaseapp.com/auth/linkedin/callback`
- **Client ID:** `86ek56lm1yueyc`  
- **Client Secret:** in env only (never in frontend).

## 2. Firebase Functions – environment variables

The **root `.env`** is used by the React app only. The LinkedIn API runs in **Firebase Functions**, which do not read the root `.env`. You must set the same variables for the backend:

**Option A – Local emulator**

1. In the **`functions/`** folder, copy the example and add your values:
   ```bash
   cd functions
   cp .env.example .env
   ```
2. Edit `functions/.env` and set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.

**Option B – Production (deployed functions)**

1. Firebase Console → your project → **Functions** → **Environment variables** (or Google Cloud Console → Cloud Functions → your function → Edit → Environment variables).
2. Add:
   - `LINKEDIN_CLIENT_ID` = `86ek56lm1yueyc`
   - `LINKEDIN_CLIENT_SECRET` = your app’s client secret from the LinkedIn Developer Portal.

Redeploy after changing env vars:

```bash
firebase deploy --only functions
```

## 3. Hosting (callback + API)

- Callback page: `public/auth/linkedin/callback/index.html` is deployed with the app (e.g. at `https://deitedatabase.firebaseapp.com/auth/linkedin/callback`).
- API routes are served by the same host via Hosting rewrites:
  - `POST /api/linkedin/exchange` → exchanges code for token and stores it.
  - `POST /api/linkedin/share` → creates a LinkedIn UGC post with image.

Build and deploy:

```bash
npm run build
firebase deploy --only hosting,functions
```

## 4. Connecting LinkedIn in the app (initiate OAuth)

Redirect the user to LinkedIn’s authorization URL with `state` = Firebase UID so the callback can associate the token with the user:

```
https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=86ek56lm1yueyc&redirect_uri=https://deitedatabase.firebaseapp.com/auth/linkedin/callback&state=FIREBASE_UID&scope=openid%20profile%20email%20w_member_social
```

Replace `FIREBASE_UID` with the signed-in user’s `auth.currentUser.uid`.  
Required scope for posting: `w_member_social`.

## 5. Firestore

- **Token storage:** `users/{uid}` with field `linkedin`: `{ accessToken, expiresAt, linkedinPersonUrn, updatedAt }`.
- **Post update (optional):** `POST /api/linkedin/share` can receive `postId`; it then updates `posts/{postId}` with `platform`, `linkedinPostId`, `caption`, `imageUrl`.

Existing Firestore rules for `users/{userId}` already allow the authenticated user to write their own document (including `linkedin`).
