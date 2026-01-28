// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCSqIMCtPOB-ifWC8PUpM52rpFlrP4jbhY",
  authDomain: "deitedatabase.firebaseapp.com",
  projectId: "deitedatabase",
  storageBucket: "deitedatabase.firebasestorage.app",
  messagingSenderId: "300613626896",
  appId: "1:300613626896:web:eaa1c35b138a2a6c07ae95",
  measurementId: "G-CRK45CXML7"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Google Sign-In on Android uses native flow via @capacitor-firebase/authentication
// (no signInWithPopup, signInWithRedirect, or browser OAuth)

// Initialize Firestore and get a reference to the service
export const db = getFirestore(app);

// Initialize Analytics (optional)
export const analytics = getAnalytics(app);

export default app;
