'use client';

import { useState, useEffect, useRef } from 'react';
import type { User, Auth } from 'firebase/auth';
import Dashboard from '../components/Dashboard';
import { ADMIN_BG, ADMIN_BORDER_STRONG, ADMIN_INPUT_BG, ADMIN_SURFACE, ADMIN_SURFACE_RAISED, ADMIN_CTA_GRADIENT } from '../lib/adminTheme';

const ALLOWED_ADMIN_EMAILS = new Set([
  'rundlekiosk@gmail.com',
  'rundlesuites@gmail.com',
  'midwavestudio@gmail.com',
]);

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

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
          apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY            || '',
          authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN        || '',
          projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID         || '',
          storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET     || '',
          messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
          appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID             || '',
        };

        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
          if (!cancelled) {
            setError('Firebase is not properly configured. Please check your environment variables.');
            setInitializing(false);
          }
          return;
        }

        const app  = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
        const auth = getAuth(app);
        authRef.current = auth;

        await setPersistence(auth, browserLocalPersistence);

        unsubscribe = onAuthStateChanged(auth, (nextUser) => {
          const normalizedUserEmail = normalizeEmail(nextUser?.email ?? '');
          const allowedUser = !nextUser || ALLOWED_ADMIN_EMAILS.has(normalizedUserEmail);

          if (nextUser && !allowedUser) {
            void auth.signOut();
            if (!cancelled) {
              setUser(null);
              setError('This account is not authorized for the admin dashboard.');
              setInitializing(false);
            }
            return;
          }

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
      const normalizedEmail = normalizeEmail(email);
      if (!ALLOWED_ADMIN_EMAILS.has(normalizedEmail)) {
        setError('This email is not authorized for the admin dashboard.');
        return;
      }

      const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import('firebase/auth');
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      } else {
        await signInWithEmailAndPassword(auth, normalizedEmail, password);
      }
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      let errorMessage = e.message ?? 'Sign-in failed';
      if      (e.code === 'auth/email-already-in-use') errorMessage = 'This email is already registered. Try signing in instead.';
      else if (e.code === 'auth/weak-password')        errorMessage = 'Password should be at least 6 characters.';
      else if (e.code === 'auth/user-not-found')       errorMessage = 'No account found with this email. Try creating an account.';
      else if (e.code === 'auth/wrong-password')       errorMessage = 'Incorrect password. Please try again.';
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
      <div className="admin-login-page" style={pageStyle}>
        <div style={cardStyle}>
          <div style={logoMarkStyle}>R</div>
          <h1 style={titleStyle}>Rundle Kiosk</h1>
          <p style={subtitleStyle}>Loading…</p>
        </div>
      </div>
    );
  }

  if (user) {
    return <Dashboard user={user} onLogout={handleLogout} />;
  }

  return (
    <div className="admin-login-page" style={pageStyle}>
      <div style={cardStyle}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={logoMarkStyle}>R</div>
          <h1 style={titleStyle}>Rundle Kiosk Admin</h1>
          <p style={subtitleStyle}>Staff Dashboard — Sign In Required</p>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(220, 38, 38, 0.12)',
            border: '1px solid rgba(220, 38, 38, 0.35)',
            color: '#f87171',
            padding: '12px 16px',
            borderRadius: '10px',
            marginBottom: '20px',
            fontSize: '14px',
            lineHeight: '1.5',
          }}>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={fieldGroupStyle}>
            <label htmlFor="email" style={labelStyle}>Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@rundlesuites.com"
              required
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#b87333'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(184,115,51,0.18)'; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>

          <div style={fieldGroupStyle}>
            <label htmlFor="password" style={labelStyle}>Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              minLength={6}
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#b87333'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(184,115,51,0.18)'; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '13px',
              background: loading ? 'rgba(184,115,51,0.5)' : '#b87333',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontSize: '15px',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '0.02em',
              transition: 'background 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginTop: '4px',
            }}
          >
            {loading ? (
              <>
                {isSignUp ? 'Creating Account' : 'Signing In'}
                <span style={{
                  display: 'inline-block',
                  width: '14px',
                  height: '14px',
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTop: '2px solid white',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
              </>
            ) : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {/* Toggle sign-up / sign-in */}
        <div style={{ textAlign: 'center', marginTop: '18px' }}>
          <button
            type="button"
            onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
            style={{
              background: 'transparent',
              color: 'rgba(184,115,51,0.8)',
              border: 'none',
              fontSize: '13px',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: '6px',
              width: 'auto',
            }}
          >
            {isSignUp
              ? 'Already have an account? Sign In'
              : "Don't have an account? Create One"}
          </button>
        </div>

        {/* Kiosk link */}
        <div style={{
          textAlign: 'center',
          marginTop: '24px',
          paddingTop: '20px',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          fontSize: '13px',
          color: 'rgba(240,240,240,0.35)',
        }}>
          <a href="/" style={{ color: '#b87333', textDecoration: 'none', fontWeight: 500 }}>
            ← Go to Guest Check-In Kiosk
          </a>
        </div>
      </div>
    </div>
  );
}

/* ── Style constants ───────────────────────────────────────── */

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: ADMIN_BG,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
};

const cardStyle: React.CSSProperties = {
  background: ADMIN_SURFACE,
  border: `1px solid ${ADMIN_BORDER_STRONG}`,
  borderRadius: '16px',
  boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 8px 24px rgba(0,0,0,0.4)',
  maxWidth: '400px',
  width: '100%',
  padding: '40px',
};

const logoMarkStyle: React.CSSProperties = {
  width: '52px',
  height: '52px',
  borderRadius: '13px',
  background: ADMIN_CTA_GRADIENT,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '24px',
  fontWeight: 800,
  color: 'white',
  margin: '0 auto 18px',
  letterSpacing: '-0.5px',
  boxShadow: '0 4px 18px rgba(184,115,51,0.45)',
};

const titleStyle: React.CSSProperties = {
  color: '#f0f0f0',
  fontSize: '22px',
  fontWeight: 700,
  margin: '0 0 4px',
  letterSpacing: '-0.01em',
  textAlign: 'center',
};

const subtitleStyle: React.CSSProperties = {
  color: 'rgba(240,240,240,0.45)',
  fontSize: '13px',
  margin: 0,
  textAlign: 'center',
};

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const labelStyle: React.CSSProperties = {
  color: 'rgba(240,240,240,0.6)',
  fontSize: '13px',
  fontWeight: 500,
  letterSpacing: '0.01em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  background: ADMIN_INPUT_BG,
  border: `1px solid ${ADMIN_BORDER_STRONG}`,
  borderRadius: '8px',
  fontSize: '15px',
  color: '#f0f0f0',
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};
