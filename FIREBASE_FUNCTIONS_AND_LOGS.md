# Where is the backend? Where are the logs?

## 1. Where is the backend code?

The **backend** (API that posts to LinkedIn) lives in the **`functions`** folder in this project.

- **Path:** `functions/src/index.ts` and `functions/src/linkedin.ts`
- The app calls `/api/linkedin/share`; Firebase Hosting sends that to the function named **`linkedInApi`**.

---

## 2. How do I deploy the backend?

You must deploy the functions so the app can use them.

1. Open a **terminal** in this project folder (where `firebase.json` is).
2. Run:
   ```bash
   firebase deploy --only functions
   ```
3. Wait until it says "Deploy complete".  
   If it asks you to log in, run `firebase login` first.

After this, your **hosted app** (e.g. on Firebase Hosting) will use the deployed backend.

---

## 3. Where are the logs?

Logs are in the **Firebase Console**, not in the app.

1. Open: **https://console.firebase.google.com**
2. Select **your project** (e.g. Deite).
3. In the left sidebar, click **Build** → **Functions**.
4. You’ll see a list of functions. Click **`linkedInApi`** (or the one that handles `/api/linkedin/...`).
5. Open the **Logs** tab.

There you’ll see messages like `[linkedin] share step 3.2b` or errors when something fails.

---

## 4. What if I see an error in the app?

When LinkedIn share fails, the **app now shows the error** in a toast (message at the bottom of the screen), for example:

- **"Could not reach server. Is the backend deployed?"**  
  → Deploy the backend (step 2 above) and try again.

- **"LinkedIn not connected or token expired"**  
  → Connect LinkedIn again (tap Connect / sign in with LinkedIn).

- **"LinkedIn post creation failed"** or **"LinkedIn image is still processing"**  
  → These come from the backend. You can look at the **Logs** (step 3) for more detail, or try again in a moment.

---

## 5. Running the app locally

- **App only:** `npm start` — the app will call the **deployed** backend (on Firebase), so you still need to deploy functions (step 2).
- **App + local backend:** Use the Firebase Emulator and run the functions locally; that’s optional and not required to get LinkedIn share working.
