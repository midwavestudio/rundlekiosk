'use client';

import { useState, useEffect, useRef } from 'react';
import type { User, Auth } from 'firebase/auth';
import Dashboard from '../components/Dashboard';

/**
 * Firebase client SDK must not run at module scope — Next.js pre-renders this page on the
 * server where browser-only APIs are missing, which caused TypeError: e[o] is not a function
 * during page generation. We lazy-import firebase/* only inside useEffect (client-only).
 */
export default function AdminPage() {
  const authRef = useRef<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { initializeApp, getApps, getApp } = await import('firebase/app');
        const {
          getAuth,
          onAuthStateChanged,
          setPersistence,
          browserLocalPersistence,
        } = await import('firebase/auth');

        const firebaseConfig = {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
          storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
          messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
          appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
        };

        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
          if (!cancelled) {
            setError('Firebase is not properly configured. Please check your environment variables.');
            setInitializing(false);
          }
          return;
        }

        const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
        const auth = getAuth(app);
        authRef.current = auth;

        await setPersistence(auth, browserLocalPersistence);

        unsubscribe = onAuthStateChanged(auth, (nextUser) => {
          if (!cancelled) {
            setUser(nextUser);
            setInitializing(false);
          }
        });
      } catch (err) {
        console.error('Firebase initialization error:', err);
        if (!cancelled) {
          setError('Firebase failed to initialize. Please check your environment variables.');
          setInitializing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const auth = authRef.current;
    if (!auth) {
      setError('Firebase is not properly configured. Please check your environment variables.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import(
        'firebase/auth'
      );
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      let errorMessage = e.message ?? 'Sign-in failed';
      if (e.code === 'auth/email-already-in-use') {
        errorMessage = 'This email is already registered. Try signing in instead.';
      } else if (e.code === 'auth/weak-password') {
        errorMessage = 'Password should be at least 6 characters.';
      } else if (e.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email. Try creating an account.';
      } else if (e.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password. Please try again.';
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    const auth = authRef.current;
    if (!auth) return;

    try {
      const { signOut } = await import('firebase/auth');
      await signOut(auth);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  if (initializing) {
    return (
      <div className="container">
        <div className="logo">
          <div className="logo-icon">🏨</div>
          <h1>Rundle Kiosk Admin</h1>
          <p className="subtitle">Loading...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return <Dashboard user={user} onLogout={handleLogout} />;
  }

  return (
    <div className="container">
      <div className="logo">
        <div className="logo-icon">🔐</div>
        <h1>Rundle Kiosk Admin</h1>
        <p className="subtitle">Staff Dashboard - Sign In Required</p>
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
            placeholder="staff@rundlesuites.com"
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
          type="button"
          onClick={() => {
            setIsSignUp(!isSignUp);
            setError('');
          }}
          style={{
            background: 'transparent',
            color: '#8B6F47',
            textDecoration: 'underline',
            padding: '10px',
          }}
        >
          {isSignUp
            ? 'Already have an account? Sign In'
            : "Don't have an account? Create One"}
        </button>
      </div>

      <div
        style={{
          textAlign: 'center',
          marginTop: '30px',
          padding: '15px',
          background: '#f5f5f5',
          borderRadius: '8px',
          fontSize: '14px',
          color: '#666',
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>Guest Kiosk:</strong>{' '}
          <a href="/" style={{ color: '#8B6F47' }}>
            Go to Guest Check-In/Out
          </a>
        </p>
      </div>
    </div>
  );
}
