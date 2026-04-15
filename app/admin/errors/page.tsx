'use client';

import { useState, useEffect, useRef } from 'react';
import type { User, Auth } from 'firebase/auth';
import Link from 'next/link';
import OperationErrorsTab from '@/app/components/OperationErrorsTab';
import { ADMIN_GRADIENT } from '@/app/lib/adminTheme';

export default function AdminErrorsPage() {
  const authRef = useRef<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { initializeApp, getApps, getApp } = await import('firebase/app');
        const { getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence } = await import(
          'firebase/auth'
        );

        const firebaseConfig = {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
          storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
          messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
          appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
        };

        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
          if (!cancelled) setInitializing(false);
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
      } catch {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (initializing) {
    return (
      <div className="container">
        <p className="subtitle">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container">
        <div className="logo">
          <div className="logo-icon">📋</div>
          <h1>Operation error log</h1>
          <p className="subtitle">Sign in on the admin dashboard to view this page.</p>
        </div>
        <p style={{ textAlign: 'center' }}>
          <Link href="/admin" style={{ color: '#8B6F47', fontWeight: 600 }}>
            Go to admin sign-in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: ADMIN_GRADIENT,
        padding: 'clamp(15px, 3vw, 40px)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: '1000px',
          margin: '0 auto',
          background: 'white',
          borderRadius: '20px',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
        }}
      >
        <div
          style={{
            background: ADMIN_GRADIENT,
            padding: '16px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <h1 style={{ margin: 0, color: 'white', fontSize: '20px' }}>Operation error log</h1>
          <Link
            href="/admin"
            style={{
              color: 'white',
              fontWeight: 600,
              textDecoration: 'underline',
              fontSize: '14px',
            }}
          >
            ← Back to dashboard
          </Link>
        </div>
        <div style={{ padding: 'clamp(20px, 3vw, 36px)' }}>
          <OperationErrorsTab />
        </div>
      </div>
    </div>
  );
}
