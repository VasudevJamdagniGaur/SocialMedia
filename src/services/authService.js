import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail
} from "firebase/auth";
import { auth } from "../firebase/config";
import { Capacitor } from '@capacitor/core';

// --- Native Google Sign-In for Capacitor (no web OAuth / popup / redirect) ---
const getFirebaseAuthentication = async () => {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    return FirebaseAuthentication;
  } catch (e) {
    console.warn('FirebaseAuthentication plugin not available:', e);
    return null;
  }
};

/**
 * Native Google Sign-In for Android (and iOS) via @capacitor-firebase/authentication.
 * Opens the native account chooser, retrieves an ID token, and signs in to Firebase Auth.
 * Do NOT use signInWithPopup or signInWithRedirect — this is the only Google flow for the APK.
 */
export const signInWithGoogle = async () => {
  try {
    if (!Capacitor.isNativePlatform()) {
      return {
        success: false,
        error: 'Google Sign-In is only available in the native app. Please open the Android app.',
      };
    }

    const NativeFirebaseAuth = await getFirebaseAuthentication();
    if (!NativeFirebaseAuth) {
      throw new Error('FirebaseAuthentication plugin not available on this platform.');
    }

    const withTimeout = (promise, ms) =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Google sign-in timed out. Please try again.')), ms)
        ),
      ]);

    const result = await withTimeout(
      NativeFirebaseAuth.signInWithGoogle({
        skipNativeAuth: true,
        useCredentialManager: false,
      }),
      60000
    );
    const user = result?.user;
    const credential = result?.credential;
    const isNewUser = !!result?.additionalUserInfo?.isNewUser;

    if (!user) {
      throw new Error('No user returned from native Google sign-in.');
    }

    const idToken = credential?.idToken ?? credential?.id_token;
    if (!idToken) {
      throw new Error('Google sign-in did not return an ID token. Please try again.');
    }

    const accessToken = credential?.accessToken ?? credential?.access_token ?? null;
    const firebaseCredential = GoogleAuthProvider.credential(idToken, accessToken);
    await signInWithCredential(auth, firebaseCredential);

    return {
      success: true,
      isNewUser,
      user: {
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        photoURL: user.photoUrl ?? user.photoURL ?? null,
      },
    };
  } catch (e) {
    const msg = e?.message ?? (typeof e === 'string' ? e : '');
    const code = e?.code ?? '';
    if (code === '12501' || /cancel|cancelled|user_cancel/i.test(msg)) {
      return { success: false, error: 'Sign-in was cancelled.' };
    }
    if (/timeout|timed out/i.test(msg)) {
      return { success: false, error: 'Google sign-in timed out. Please try again.' };
    }
    const message = msg || 'Google sign-in failed. Please try again.';
    return { success: false, error: message };
  }
};

// Sign up new user
export const signUpUser = async (email, password, displayName) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Update the user's display name
    if (displayName) {
      await updateProfile(user, {
        displayName: displayName
      });
    }
    
    return {
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || displayName
      }
    };
  } catch (error) {
    console.error("Error signing up:", error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Check if email account exists
export const checkEmailExists = async (email) => {
  try {
    const signInMethods = await fetchSignInMethodsForEmail(auth, email);
    return {
      exists: signInMethods.length > 0,
      methods: signInMethods
    };
  } catch (error) {
    console.error("Error checking email:", error);
    // If there's an error, assume account doesn't exist
    return {
      exists: false,
      error: error.message
    };
  }
};

// Sign in existing user
export const signInUser = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    return {
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName
      }
    };
  } catch (error) {
    console.error("Error signing in:", error);
    return {
      success: false,
      error: error.message,
      errorCode: error.code // Include error code for better error handling
    };
  }
};

// Send password reset email
export const sendPasswordReset = async (email) => {
  try {
    await sendPasswordResetEmail(auth, email);
    return {
      success: true,
      message: 'Password reset email sent! Please check your inbox.'
    };
  } catch (error) {
    console.error("Error sending password reset email:", error);
    let errorMessage = 'Failed to send password reset email. Please try again.';
    
    // Provide user-friendly error messages
    if (error.code === 'auth/user-not-found') {
      errorMessage = 'No account found with this email address.';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email address.';
    } else if (error.code === 'auth/too-many-requests') {
      errorMessage = 'Too many requests. Please try again later.';
    }
    
    return {
      success: false,
      error: errorMessage
    };
  }
};

// Sign out user
export const signOutUser = async () => {
  try {
    await signOut(auth);
    return { success: true };
  } catch (error) {
    console.error("Error signing out:", error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Listen to authentication state changes
export const onAuthStateChange = (callback) => {
  return onAuthStateChanged(auth, callback);
};

// Get current user
export const getCurrentUser = () => {
  return auth.currentUser;
};
