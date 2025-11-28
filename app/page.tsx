'use client';

import { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import Dashboard from './components/Dashboard';

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
};

// Initialize Firebase
let app;
let auth;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
} catch (error) {
  console.error('Firebase initialization error:', error);
  // Create a mock auth object to prevent crashes
  auth = null as any;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    if (!auth) {
      setInitializing(false);
      setError('Firebase is not properly configured. Please check your environment variables.');
      return;
    }

    // Set persistence to LOCAL (stays logged in)
    setPersistence(auth, browserLocalPersistence).then(() => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        setUser(user);
        setInitializing(false);
      });

      return () => unsubscribe();
    }).catch((error) => {
      console.error('Auth persistence error:', error);
      setInitializing(false);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!auth) {
      setError('Firebase is not properly configured. Please check your environment variables.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (isSignUp) {
        // Create new account
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        // Sign in
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      // User-friendly error messages
      let errorMessage = err.message;
      if (err.code === 'auth/email-already-in-use') {
        errorMessage = 'This email is already registered. Try signing in instead.';
      } else if (err.code === 'auth/weak-password') {
        errorMessage = 'Password should be at least 6 characters.';
      } else if (err.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email. Try creating an account.';
      } else if (err.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password. Please try again.';
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    
    try {
      await signOut(auth);
    } catch (err: any) {
      console.error('Logout error:', err);
    }
  };

  // Show loading while checking auth state
  if (initializing) {
    return (
      <div className="container">
        <div className="logo">
          <div className="logo-icon">🏨</div>
          <h1>Rundle Kiosk</h1>
          <p className="subtitle">Loading...</p>
        </div>
      </div>
    );
  }

  // Show dashboard if logged in
  if (user) {
    return <Dashboard user={user} onLogout={handleLogout} />;
  }

  return (
    <div className="container">
      <div className="logo">
        <div className="logo-icon">🏨</div>
        <h1>Rundle Kiosk</h1>
        <p className="subtitle">Dual Check-In System</p>
      </div>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            required
            minLength={6}
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? (
            <>
              {isSignUp ? 'Creating Account' : 'Signing In'}
              <span className="loading"></span>
            </>
          ) : isSignUp ? (
            'Create Account'
          ) : (
            'Sign In'
          )}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: '20px' }}>
        <button
          onClick={() => {
            setIsSignUp(!isSignUp);
            setError('');
          }}
          style={{
            background: 'transparent',
            color: '#667eea',
            textDecoration: 'underline',
            padding: '10px',
          }}
        >
          {isSignUp
            ? 'Already have an account? Sign In'
            : "Don't have an account? Create One"}
        </button>
      </div>
    </div>
  );
}

