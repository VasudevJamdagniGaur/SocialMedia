# How to Deploy Firestore Security Rules

## Option 1: Firebase Console (Recommended - Easiest)

1. Go to https://console.firebase.google.com/
2. Select your project: `deitedatabase`
3. Click "Firestore Database" in the left sidebar
4. Click the "Rules" tab
5. Copy the contents of `firestore.rules` file
6. Paste into the Firebase Console editor
7. Click "Publish"

## Option 2: Firebase CLI

1. Login to Firebase:
   ```
   firebase login
   ```

2. Initialize Firebase in your project (if not already done):
   ```
   firebase init firestore
   ```
   - Select your project: `deitedatabase`
   - Use existing `firestore.rules` file: Yes
   - Use existing `firebase.json` file: Yes

3. Deploy the rules:
   ```
   firebase deploy --only firestore:rules
   ```

## What the Rules Do

The security rules allow:
- ✅ **reflectionImageCache**: Authenticated users to read/write only documents where `userId` matches their `request.auth.uid` (used so reflection images are loaded from Firebase instead of re-calling the API).
- ✅ Authenticated users to **read** the `users` collection (for counting active members)
- ✅ Users to **create/update** their own user document
- ✅ Authenticated users to **read** `usersMetadata` (for crew matching)
- ✅ Users to **read/write** their own subcollections (days, chats, reflections)
- ✅ Authenticated users to **read** community posts
- ✅ Users to **create** community posts and **update/delete** their own posts

## Fixing "Missing or insufficient permissions" for reflectionImageCache

If you see `getReflectionImageUrl failed: FirebaseError: Missing or insufficient permissions`, your Firestore rules do not yet allow access to the `reflectionImageCache` collection. Add this block to your existing rules (Firebase Console → Firestore Database → Rules):

```
match /reflectionImageCache/{docId} {
  allow read: if request.auth != null && resource.data.userId == request.auth.uid;
  allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
  allow update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
}
```

Then click **Publish**. After that, the app can read/write reflection image cache so it doesn’t re-call the Gemini API.

## After Deploying

Once the rules are deployed, refresh your app and the "Active Members" count should work correctly!

