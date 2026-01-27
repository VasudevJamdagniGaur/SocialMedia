import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  updateProfile,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail
} from "firebase/auth";
import { auth } from "../firebase/config";
import { Capacitor } from '@capacitor/core';

// Lazy load Capacitor Firebase Auth (only works in native)
// We'll import it dynamically when needed to avoid errors in web builds
const getFirebaseAuthentication = async () => {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }
  
  try {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    return FirebaseAuthentication;
  } catch (e) {
    console.warn('⚠️ Capacitor Firebase Auth not available:', e);
    return null;
  }
};

// Lazy load Capacitor Browser plugin for external browser sign-in
const getBrowser = async () => {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }
  
  console.log('🔍 Attempting to load Browser plugin...');
  console.log('🔍 Capacitor platform:', Capacitor.getPlatform());
  console.log('🔍 Is native platform:', Capacitor.isNativePlatform());
  
  // Method 1: Try dynamic import (preferred for ES modules)
  try {
    console.log('📦 Attempting dynamic import of @capacitor/browser...');
    const browserModule = await import('@capacitor/browser');
    const Browser = browserModule.Browser;
    
    if (Browser) {
      console.log('✅ Browser plugin loaded successfully via dynamic import');
      return Browser;
    } else {
      console.warn('⚠️ Browser module imported but Browser is null');
    }
  } catch (importError) {
    console.error('❌ Dynamic import failed:', importError);
    console.error('❌ Error message:', importError.message);
    console.error('❌ Error stack:', importError.stack);
  }
  
  // Method 2: Try accessing via Capacitor.Plugins (native bridge)
  try {
    if (window.Capacitor?.Plugins?.Browser) {
      console.log('✅ Found Browser via Capacitor.Plugins');
      return window.Capacitor.Plugins.Browser;
    } else {
      console.warn('⚠️ Browser not found in Capacitor.Plugins');
      console.log('🔍 Available plugins:', Object.keys(window.Capacitor?.Plugins || {}));
    }
  } catch (pluginsError) {
    console.error('❌ Error accessing Capacitor.Plugins:', pluginsError);
  }
  
  // Method 3: Try accessing via window (some plugin registrations)
  try {
    if (window.Browser) {
      console.log('✅ Found Browser via window.Browser');
      return window.Browser;
    }
  } catch (windowError) {
    console.error('❌ Error accessing window.Browser:', windowError);
  }
  
  console.error('❌ All methods failed - Browser plugin not available');
  console.error('❌ This usually means:');
  console.error('   1. @capacitor/browser is not installed (run: npm install @capacitor/browser)');
  console.error('   2. Plugin not synced to Android (run: npx cap sync android)');
  console.error('   3. APK was built without syncing (rebuild after sync)');
  
  return null;
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

// Helper function to detect mobile/unsupported browsers
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// Check if popups are likely blocked or if we should use redirect
// Note: We prefer popup first for better UX (popup experience)
const shouldUseRedirect = () => {
  // For now, we'll try popup first on all devices
  // Only use redirect as fallback if popup fails
  return false; // Always try popup first
};

// Check if we're in a storage-partitioned environment that won't work with redirects
const isStoragePartitioned = () => {
  try {
    // Try to access sessionStorage
    const testKey = '__storage_test__';
    sessionStorage.setItem(testKey, 'test');
    const value = sessionStorage.getItem(testKey);
    sessionStorage.removeItem(testKey);
    
    // If we can't set or get, or value is null, storage is partitioned
    if (value !== 'test') {
      return true;
    }
    
    // Additional check: try localStorage as well
    try {
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
    } catch (e) {
      return true; // localStorage also blocked
    }
    
    return false;
  } catch (e) {
    return true; // Storage is completely blocked
  }
};

// Sign in with Google - Uses native Google Sign-In via @capacitor-firebase/authentication (no web OAuth redirects)
export const signInWithGoogle = async () => {
  try {
    console.log('🔐 Signing in with Google via native FirebaseAuthentication...');

    const NativeFirebaseAuth = await getFirebaseAuthentication();

    if (!NativeFirebaseAuth) {
      throw new Error('FirebaseAuthentication plugin not available on this platform.');
    }

    console.log('✅ FirebaseAuthentication plugin loaded');

    const result = await NativeFirebaseAuth.signInWithGoogle();

    console.log('📦 Native sign-in result:', result);

    const user = result?.user;
    const credential = result?.credential;

    if (!user) {
      return {
        success: false,
        error: 'Google sign-in did not return a user.',
        code: 'no-user'
      };
    }

    // Sync native auth state into Firebase JS SDK
    if (
      Capacitor.isNativePlatform() &&
      credential?.providerId === 'google.com' &&
      credential?.idToken
    ) {
      const firebaseCredential = GoogleAuthProvider.credential(
        credential.idToken,
        credential.accessToken || null
      );

      await signInWithCredential(auth, firebaseCredential);
    }

    console.log('✅ Google Sign-In successful:', user.uid);

    return {
      success: true,
      user: {
        uid: user.uid,
        email: user.email || null,
        displayName: user.displayName || null,
        photoURL: user.photoUrl || null
      }
    };
  } catch (error) {
    console.error('❌ Error signing in with Google:', error);

    return {
      success: false,
      error: error?.message || 'Google sign-in failed. Please try again.',
      code: error?.code || 'unknown-error'
    };
  }
};

// Handle redirect result - call this on app initialization
// Also handles cases where popup falls back to redirect on mobile
// Handles deep links when returning from external browser
// IMPORTANT: When using external browser, getRedirectResult won't work because
// redirect state is in browser's sessionStorage, not app's WebView
export const handleGoogleRedirect = async () => {
  try {
    // Check if we're returning via deep link
    const currentUrl = window.location.href;
    const isDeepLink = currentUrl.includes('therapist.deite.app://');
    const isOnAuthHandler = currentUrl.includes('__/auth/handler');
    const storedAppOrigin = localStorage.getItem('appOrigin');
    const appOrigin = storedAppOrigin || window.location.origin;
    const hasPendingSignIn = localStorage.getItem('googleSignInPending') === 'true';
    
    console.log('🔍 Checking for Google Sign-In result...', {
      isDeepLink,
      isOnAuthHandler,
      hasPendingSignIn,
      currentUrl: currentUrl.substring(0, 100)
    });
    
    if (isDeepLink) {
      console.log('🔗 Detected deep link return:', currentUrl);
      
      // Parse deep link URL to extract auth parameters
      // Firebase might include auth tokens in the URL
      const urlObj = new URL(currentUrl.replace('therapist.deite.app://', 'http://'));
      const code = urlObj.searchParams.get('code');
      const state = urlObj.searchParams.get('state');
      const error = urlObj.searchParams.get('error');
      
      if (error) {
        console.error('❌ Auth error in deep link:', error);
        return {
          success: false,
          error: `Authentication error: ${error}`,
          code: 'auth-error'
        };
      }
      
      console.log('📍 Deep link contains auth params:', { code: !!code, state: !!state });
      
      // Clear the deep link from URL bar for cleaner navigation
      if (isDeepLink) {
        window.history.replaceState({}, '', '/signup');
      }
    }
    
    if (isOnAuthHandler) {
      console.log('📍 Detected Firebase auth handler page - attempting to process result');
    }
    
    // FIRST: Try getRedirectResult (works for WebView redirects)
    // FIX: Enhanced error handling for storage-partitioned errors
    let result = null;
    try {
      result = await getRedirectResult(auth);
    if (result && result.user) {
      const user = result.user;
        console.log('✅ Google Sign-In successful via getRedirectResult:', user);
        
        // Clear any pending sign-in flags and backup state
        try {
          localStorage.removeItem('googleSignInPending');
          localStorage.removeItem('firebase_redirect_state_backup');
          localStorage.removeItem('googleSignInTimestamp');
        } catch (e) {
          // Ignore storage errors
        }
      
        // If we're on the auth handler page (Firebase domain), navigate back to app after getting result
      if (isOnAuthHandler && !window.location.origin.startsWith(appOrigin)) {
          console.log('📍 Redirecting from Firebase handler back to app:', appOrigin);
          // Navigate back to app's origin on the dashboard
        window.location.replace(`${appOrigin}/dashboard`);
          return { 
            success: true, 
            user: { 
              uid: user.uid, 
              email: user.email, 
              displayName: user.displayName, 
              photoURL: user.photoURL 
            }
          };
      }
      
      return {
        success: true,
        user: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL
        }
      };
      }
    } catch (redirectError) {
      // Check if this is the storage-partitioned error
      if (redirectError.message?.includes('missing initial state') || 
          redirectError.message?.includes('sessionStorage') ||
          redirectError.code === 'auth/argument-error') {
        console.warn('⚠️ Storage-partitioned error detected in getRedirectResult');
        console.warn('⚠️ This means sessionStorage was partitioned - checking auth state directly...');
        
        // CRITICAL WORKAROUND: Even if getRedirectResult fails due to storage partitioning,
        // Firebase may have successfully authenticated the user. Check auth state directly.
        // Firebase stores auth tokens server-side, so even if sessionStorage is partitioned,
        // the user might still be authenticated and we can detect that via auth.currentUser
        
        // Wait a moment for Firebase to complete authentication
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check if user is authenticated despite the error
        const authenticatedUser = auth.currentUser;
        if (authenticatedUser) {
          console.log('✅ User is authenticated despite storage error! (Firebase worked)');
          
          // Clear pending flags
          try {
            localStorage.removeItem('googleSignInPending');
            localStorage.removeItem('firebase_redirect_state_backup');
            localStorage.removeItem('googleSignInTimestamp');
          } catch (e) {
            // Ignore
          }
          
          // Navigate back to app if on handler page
          if (isOnAuthHandler && !window.location.origin.startsWith(appOrigin)) {
            window.location.replace(`${appOrigin}/dashboard`);
          }
          
          return {
            success: true,
            user: {
              uid: authenticatedUser.uid,
              email: authenticatedUser.email,
              displayName: authenticatedUser.displayName,
              photoURL: authenticatedUser.photoURL
            }
          };
        }
        
        // Try to recover using auth state listener (see below)
        // Don't return error yet - let the auth state check below handle it
      } else {
        console.warn('⚠️ getRedirectResult error:', redirectError.message);
      }
    }
    
    // SECOND: Check current auth state (works for WebView redirect flows)
    // FIX: Enhanced recovery for storage-partitioned scenarios
    // If user signed in via WebView redirect, Firebase auth state should be updated
    // We check this when app loads or resumes
    if (hasPendingSignIn || isDeepLink || isOnAuthHandler) {
      console.log('🔍 Checking current auth state (WebView redirect flow)...');
      
      // Check if we have a stored redirect state backup (indicates storage partitioning)
      const storedRedirectState = localStorage.getItem('firebase_redirect_state_backup');
      if (storedRedirectState) {
        try {
          const state = JSON.parse(storedRedirectState);
          const age = Date.now() - state.timestamp;
          console.log('📍 Found redirect state backup (storage partitioning detected), age:', age, 'ms');
          
          // If state is too old (more than 5 minutes), clean it up
          if (age > 5 * 60 * 1000) {
            localStorage.removeItem('firebase_redirect_state_backup');
            console.log('⚠️ Redirect state backup is too old, removed');
          }
        } catch (e) {
          console.warn('⚠️ Could not parse redirect state backup:', e);
        }
      }
      
      // CRITICAL WORKAROUND: Check auth state directly even if getRedirectResult failed
      // Firebase may have authenticated on the handler page despite storage-partitioned error
      let authCheckAttempts = 0;
      const maxAuthChecks = 10; // Check up to 5 seconds (10 * 500ms)
      
      while (authCheckAttempts < maxAuthChecks) {
        const currentUser = auth.currentUser;
        if (currentUser) {
          console.log('✅ User authenticated! (detected via auth state check)');
          
          // Clear pending flags and backup state
          try {
            localStorage.removeItem('googleSignInPending');
            localStorage.removeItem('firebase_redirect_state_backup');
            localStorage.removeItem('googleSignInTimestamp');
          } catch (e) {
            // Ignore storage errors
          }
          
          // If we're on the Firebase handler page, navigate back to app
          if (isOnAuthHandler && !window.location.origin.startsWith(appOrigin)) {
            console.log('📍 Redirecting from Firebase handler back to app:', appOrigin);
            window.location.replace(`${appOrigin}/dashboard`);
            return {
              success: true,
              user: {
                uid: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName,
                photoURL: currentUser.photoURL
              }
            };
          }
          
          return {
            success: true,
            user: {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL
            }
          };
        }
        
        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, 500));
        authCheckAttempts++;
      }
      
      // If we didn't find authenticated user after polling, continue with other checks
      if (authCheckAttempts >= maxAuthChecks) {
        console.log('⚠️ User not authenticated after polling, checking other methods...');
      }
      
      // If we still don't have a user, try listening for auth state change
      if (!auth.currentUser && (hasPendingSignIn || isDeepLink || isOnAuthHandler)) {
        console.log('⚠️ User not authenticated yet, but pending sign-in flag exists');
        console.log('⚠️ This may be a storage-partitioned scenario - will listen for auth state change');
        
        // Wait a moment and check again (Firebase might still be processing)
        // Also listen for auth state change as Firebase processes the sign-in
        return new Promise((resolve) => {
          let resolved = false;
          const maxWaitTime = 5000; // Wait up to 5 seconds
          const startTime = Date.now();
          
          const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user && (hasPendingSignIn || isDeepLink || isOnAuthHandler)) {
              console.log('✅ Auth state changed - user is now authenticated!');
              
              if (!resolved) {
                resolved = true;
                unsubscribe(); // Stop listening
                
                // Clear pending flags and backup state
                try {
                  localStorage.removeItem('googleSignInPending');
                  localStorage.removeItem('firebase_redirect_state_backup');
                  localStorage.removeItem('googleSignInTimestamp');
                } catch (e) {
                  // Ignore
                }
                
                resolve({
                  success: true,
                  user: {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    photoURL: user.photoURL
                  }
                });
              }
            }
          });
          
          // Also check periodically in case auth state listener doesn't fire
          const checkInterval = setInterval(() => {
            if (resolved) {
              clearInterval(checkInterval);
              return;
            }
            
            const elapsed = Date.now() - startTime;
            if (elapsed >= maxWaitTime) {
              clearInterval(checkInterval);
              unsubscribe();
              
              // Final check
              if (auth.currentUser) {
                const finalUser = auth.currentUser;
                resolved = true;
                try {
                  localStorage.removeItem('googleSignInPending');
                  localStorage.removeItem('firebase_redirect_state_backup');
                  localStorage.removeItem('googleSignInTimestamp');
                } catch (e) {}
                resolve({
                  success: true,
                  user: {
                    uid: finalUser.uid,
                    email: finalUser.email,
                    displayName: finalUser.displayName,
                    photoURL: finalUser.photoURL
                  }
                });
              } else {
                resolved = true;
                console.warn('⚠️ No sign-in detected after waiting');
                resolve({
                  success: false,
                  noRedirect: true,
                  message: 'Sign-in may have failed due to browser storage restrictions. Please try again or use email/password sign-up.',
                  storagePartitioned: true
                });
              }
            } else if (auth.currentUser && !resolved) {
              // Found user during periodic check
              const foundUser = auth.currentUser;
              clearInterval(checkInterval);
              unsubscribe();
              resolved = true;
              try {
                localStorage.removeItem('googleSignInPending');
                localStorage.removeItem('firebase_redirect_state_backup');
                localStorage.removeItem('googleSignInTimestamp');
              } catch (e) {}
              resolve({
                success: true,
                user: {
                  uid: foundUser.uid,
                  email: foundUser.email,
                  displayName: foundUser.displayName,
                  photoURL: foundUser.photoURL
                }
              });
            }
          }, 500); // Check every 500ms
        });
      }
    }
    
    // If we're on auth handler but no result, it might be a storage-partitioned error
    if (isOnAuthHandler) {
      console.warn('⚠️ On auth handler page but no redirect result - likely storage-partitioned error');
      // Navigate back to the app domain signup page
      if (!window.location.origin.startsWith(appOrigin)) {
        console.log('📍 Redirecting from Firebase handler back to app:', appOrigin);
        window.location.replace(`${appOrigin}/signup`);
      }
      return {
        success: false,
        error: 'Browser storage restrictions prevented sign-in. Please try using email/password sign-up instead.',
        code: 'storage-partitioned',
        isNormalLoad: false
      };
    }
    
    // No redirect result - user didn't come from a redirect
    return { success: false, noRedirect: true };
  } catch (error) {
    console.error("❌ Error handling Google redirect:", error);
    
    // Handle storage-partitioned specific errors (missing initial state)
    if (error.code === 'auth/argument-error' && 
        (error.message?.includes('initial state') || 
         error.message?.includes('sessionStorage') ||
         error.message?.includes('storage'))) {
      console.warn('⚠️ Storage-partitioned environment detected - missing initial state');
      
      // If we're on the auth handler page, navigate back to the app domain
      if (window.location.href.includes('__/auth/handler')) {
        console.log('🔄 Clearing auth handler URL due to storage error');
        if (!window.location.origin.startsWith(appOrigin)) {
          window.location.replace(`${appOrigin}/signup`);
        }
      }
      
      // Check if there's an error in the URL
      if (window.location.search.includes('error') || window.location.hash.includes('error')) {
        // If there's an error in the URL, this might be a failed redirect
        return {
          success: false,
          error: 'Google sign-in failed due to browser privacy settings. Please try using email/password sign-up instead.',
          code: 'storage-partitioned',
          isNormalLoad: false
        };
      }
      
      return { 
        success: false, 
        noRedirect: true, 
        isNormalLoad: !window.location.href.includes('__/auth/handler'),
        warning: 'Storage-partitioned environment detected'
      };
    }
    
    // If we're on auth handler page with any error, try to clear the URL
    if (window.location.href.includes('__/auth/handler')) {
      console.log('🔄 Clearing auth handler URL due to error');
      if (!window.location.origin.startsWith(appOrigin)) {
        window.location.replace(`${appOrigin}/signup`);
      }
    }
    
    // Other errors
    return {
      success: false,
      error: error.message,
      code: error.code
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
