/**
 * Firebase Web App Configuration
 * This file contains the Firebase client SDK configuration for the web app
 */

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBcIyLp-a9YK_XLFgZv2KkldQuHNx6redI",
  authDomain: "kiosk-rundle.firebaseapp.com",
  projectId: "kiosk-rundle",
  storageBucket: "kiosk-rundle.firebasestorage.app",
  messagingSenderId: "960821255140",
  appId: "1:960821255140:web:42c45d0846fb78481445f1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;







