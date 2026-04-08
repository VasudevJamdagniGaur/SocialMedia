# Detea — Account deletion (Google Play Data Safety)

Public page and Cloud Function for users to request account deletion without opening the app.

## URLs (after deploy)

- **Deletion page (use in Play Console):**  
  `https://<YOUR_HOSTING_DOMAIN>/account-deletion/`  
  Example: `https://deitedatabase.web.app/account-deletion/`

- **API (same origin via Hosting rewrite):**  
  `POST https://<YOUR_HOSTING_DOMAIN>/deleteAccountRequest`

## One-time setup

1. **Firestore rules** — `deleteRequests` is denied to clients; only the Admin SDK (Functions) can write. Deploy rules:

   ```bash
   firebase deploy --only firestore:rules
   ```

2. **Functions** — build and deploy:

   ```bash
   cd functions
   npm run build
   cd ..
   firebase deploy --only functions:deleteAccountRequest
   ```

3. **Hosting** — the HTML lives at `public/account-deletion/index.html`. With Create React App, run a production build so it is copied into `build/`:

   ```bash
   npm run build
   firebase deploy --only hosting
   ```

   Or deploy everything:

   ```bash
   npm run build
   firebase deploy --only functions:deleteAccountRequest,hosting,firestore:rules
   ```

## Play Console

**Data Safety → Account deletion URL:** paste your public page URL, e.g.  
`https://deitedatabase.web.app/account-deletion/`

## Operations

- Review pending requests in Firebase Console → Firestore → collection **`deleteRequests`** (`status: "pending"`).
- Process deletions manually (or add an admin workflow later).

## Files touched

| File | Purpose |
|------|---------|
| `functions/src/deleteAccountRequest.ts` | HTTPS handler + Firestore write |
| `functions/src/index.ts` | Export function |
| `firebase.json` | Hosting rewrite `/deleteAccountRequest` → function |
| `public/account-deletion/index.html` | Public form |
| `firestore.rules` | Block client access to `deleteRequests` |

## Direct function URL (optional)

If you call the function without Hosting (e.g. testing):

`https://<REGION>-<PROJECT_ID>.cloudfunctions.net/deleteAccountRequest`

Update `ENDPOINT` in `index.html` only if you serve the page from a different origin than Firebase Hosting.
