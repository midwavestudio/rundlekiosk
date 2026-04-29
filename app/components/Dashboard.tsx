'use client';

import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { ADMIN_ACCENT, ADMIN_GRADIENT } from '../lib/adminTheme';
import ArrivalsTab from './ArrivalsTab';
import DeparturesTab from './DeparturesTab';
import CheckInModal from './CheckInModal';
import CheckOutModal from './CheckOutModal';
import BulkCheckInTab from './BulkCheckInTab';
import TyePlaceholdersTab from './TyePlaceholdersTab';
import FeedbackTab from './FeedbackTab';
import EventLogTab from './EventLogTab';

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

interface FirebaseStatus {
  connected: boolean;
  error: string | null;
  phase?: 'missing-env' | 'init-failed' | 'firestore-read' | 'ok';
}

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'arrivals' | 'departures' | 'bulk-checkin' | 'tye-placeholders' | 'feedback' | 'event-log'
  >('dashboard');
  const [firestoreStatus, setFirestoreStatus] = useState<FirebaseStatus | null>(null);

  useEffect(() => {
    fetch('/api/admin/firebase-status')
      .then((r) => r.json())
      .then((data: FirebaseStatus) => setFirestoreStatus(data))
      .catch(() =>
        setFirestoreStatus({
          connected: false,
          error: 'Could not reach /api/admin/firebase-status',
          phase: undefined,
        })
      );
  }, []);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showCheckOutModal, setShowCheckOutModal] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<any>(null);

  const handleCheckIn = (reservation: any) => {
    setSelectedReservation(reservation);
    setShowCheckInModal(true);
  };

  const handleCheckOut = (reservation: any) => {
    setSelectedReservation(reservation);
    setShowCheckOutModal(true);
  };

  const wideGuestTab = activeTab === 'arrivals' || activeTab === 'departures';

  const firestoreQuotaExceeded =
    !!firestoreStatus?.error &&
    (/RESOURCE_EXHAUSTED/i.test(firestoreStatus.error) ||
      /Quota exceeded/i.test(firestoreStatus.error));

  return (
    <>
      {/* `body` is `display:flex; justify-content:center` in globals.css — without width:100% this shell shrink-wraps to ~login width. */}
      <div
        className="admin-dashboard-shell"
        style={{
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          minHeight: '100vh',
          background: ADMIN_GRADIENT,
          padding: wideGuestTab ? '8px 12px' : 'clamp(15px, 3vw, 40px)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{
          maxWidth: wideGuestTab ? 'min(1920px, 100%)' : '1400px',
          width: '100%',
          margin: '0 auto',
          background: 'white',
          borderRadius: '20px',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          height: wideGuestTab ? 'calc(100vh - 16px)' : 'calc(100vh - 30px)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Header */}
          <div style={{
            background: ADMIN_GRADIENT,
            padding: '20px 30px',
            color: 'white',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <a
                href="/"
                title="Back to guest kiosk"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '38px',
                  height: '38px',
                  borderRadius: '9999px',
                  border: '2px solid rgba(255,255,255,0.85)',
                  color: 'white',
                  textDecoration: 'none',
                  background: 'rgba(255,255,255,0.12)',
                  fontSize: '20px',
                  lineHeight: 1,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
                aria-label="Back to guest kiosk"
              >
                ←
              </a>
              <div>
                <h1 style={{ margin: 0, fontSize: '24px' }}>🏨 Rundle Kiosk</h1>
                <p style={{ margin: '5px 0 0 0', opacity: 0.9, fontSize: '14px' }}>
                  {user.email}
                </p>
              </div>
            </div>
            <button
              onClick={onLogout}
              style={{
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                border: '2px solid white',
                padding: '10px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Sign Out
            </button>
          </div>

          {/* Firestore disconnected warning banner */}
          {firestoreStatus && !firestoreStatus.connected && (
            <div style={{
              background: '#fef2f2',
              borderBottom: '2px solid #fca5a5',
              padding: '10px 24px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              color: '#991b1b',
              fontSize: '13px',
              lineHeight: '1.5',
            }}>
              <span style={{ fontSize: '18px', flexShrink: 0 }}>⚠️</span>
              <div>
                <strong>
                  {firestoreQuotaExceeded
                    ? 'Firestore daily quota exceeded — Google is temporarily blocking reads and writes for this project.'
                    : 'Firestore is not connected — check-in data will NOT persist between page loads.'}
                </strong>
                <br />
                {firestoreQuotaExceeded && (
                  <>
                    On the <strong>Spark (free)</strong> plan, Firestore has a fixed number of reads per day. The admin
                    dashboard used to poll very often; that has been reduced in the latest deploy. In{' '}
                    <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" style={{ color: '#7f1d1d', textDecoration: 'underline' }}>
                      Firebase Console
                    </a>
                    , open your project → <strong>Usage and billing</strong> → upgrade to <strong>Blaze</strong> (pay-as-you-go)
                    for higher limits, or wait until the daily quota resets.
                  </>
                )}
                {firestoreStatus.phase === 'missing-env' && (
                  <>
                    The Firebase Admin SDK variables (<code>FIREBASE_PROJECT_ID</code>,{' '}
                    <code>FIREBASE_PRIVATE_KEY</code>, <code>FIREBASE_CLIENT_EMAIL</code>) must be set in{' '}
                    Vercel under <em>Settings → Environment Variables</em>, then redeploy.
                  </>
                )}
                {(firestoreStatus.phase === 'init-failed' ||
                  (firestoreStatus.phase === 'firestore-read' && !firestoreQuotaExceeded)) && (
                  <>
                    Variables may be listed in Vercel, but the server cannot authenticate or read Firestore. This is usually a{' '}
                    <strong>bad <code>FIREBASE_PRIVATE_KEY</code> value</strong> (often shown as “Needs Attention”) or IAM/API access for the service account.
                    Paste the full key as <strong>one line</strong> with literal <code>\n</code> characters between PEM lines — do not wrap the whole value in extra quotes.
                  </>
                )}
                {!firestoreStatus.phase && firestoreStatus.error?.includes('Could not reach') && (
                  <>
                    Could not verify Firestore from this browser — check your network or try refreshing after deploy.
                  </>
                )}
                <br />
                {!firestoreQuotaExceeded &&
                  'Until Firestore connects, Arrivals and Departures stay empty across devices after cold starts.'}
                {firestoreStatus.error && (
                  <>
                    <br />
                    <span style={{ opacity: 0.75 }}>
                      Server detail ({firestoreStatus.phase ?? 'unknown'}): {firestoreStatus.error}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div style={{
            display: 'flex',
            borderBottom: '2px solid #f0f0f0',
            padding: '0 20px'
          }}>
            {['dashboard', 'arrivals', 'departures', 'bulk-checkin', 'tye-placeholders', 'feedback', 'event-log'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                style={{
                  padding: '15px 25px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab ? `3px solid ${ADMIN_ACCENT}` : '3px solid transparent',
                  color: activeTab === tab ? ADMIN_ACCENT : '#666',
                  fontWeight: activeTab === tab ? '600' : '400',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  fontSize: '16px',
                  transition: 'all 0.3s'
                }}
              >
                {tab === 'bulk-checkin'
                  ? 'Bulk Check-In'
                  : tab === 'tye-placeholders'
                    ? 'Blocks'
                    : tab === 'event-log'
                      ? 'Error Log'
                      : tab}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ 
            padding: wideGuestTab ? '12px 16px 16px' : 'clamp(20px, 3vw, 40px)', 
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: wideGuestTab ? 'hidden' : 'auto',
            overflowY: wideGuestTab ? 'hidden' : 'auto',
          }}>
            {activeTab === 'dashboard' && (
              <DashboardTab firestoreStatus={firestoreStatus} />
            )}
          {activeTab === 'arrivals' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <ArrivalsTab onCheckIn={handleCheckIn} />
            </div>
          )}
          {activeTab === 'departures' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <DeparturesTab onCheckOut={handleCheckOut} />
            </div>
          )}
          {activeTab === 'bulk-checkin' && (
            <BulkCheckInTab />
          )}
          {activeTab === 'tye-placeholders' && (
            <TyePlaceholdersTab />
          )}
          {activeTab === 'feedback' && (
            <FeedbackTab />
          )}
          {activeTab === 'event-log' && (
            <EventLogTab />
          )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showCheckInModal && selectedReservation && (
        <CheckInModal
          reservation={selectedReservation}
          onClose={() => {
            setShowCheckInModal(false);
            setSelectedReservation(null);
          }}
        />
      )}

      {showCheckOutModal && selectedReservation && (
        <CheckOutModal
          reservation={selectedReservation}
          onClose={() => {
            setShowCheckOutModal(false);
            setSelectedReservation(null);
          }}
        />
      )}
    </>
  );
}

function DashboardTab({ firestoreStatus }: { firestoreStatus: FirebaseStatus | null }) {
  // Get real stats from localStorage
  const checkedInGuests = typeof window !== 'undefined' 
    ? JSON.parse(localStorage.getItem('checkedInGuests') || '[]')
    : [];
  const checkOutHistory = typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('checkOutHistory') || '[]')
    : [];
  
  // Today's check-ins
  const today = new Date().toDateString();
  const todayCheckIns = checkedInGuests.filter((guest: any) => {
    const checkInDate = new Date(guest.checkInTime).toDateString();
    return checkInDate === today;
  });
  
  // Today's check-outs
  const todayCheckOuts = checkOutHistory.filter((guest: any) => {
    if (!guest.checkOutTime) return false;
    const checkOutDate = new Date(guest.checkOutTime).toDateString();
    return checkOutDate === today;
  });

  const stats = {
    occupied: checkedInGuests.length,
    available: 60 - checkedInGuests.length, // Assuming 60 total rooms
    arrivals: todayCheckIns.length,
    departures: todayCheckOuts.length
  };

  return (
    <div>
      <h2 style={{ 
        marginBottom: 'clamp(20px, 3vw, 40px)', 
        color: '#333',
        fontSize: 'clamp(24px, 3vw, 32px)'
      }}>Dashboard Overview</h2>
      
      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
        gap: 'clamp(15px, 2vw, 25px)',
        marginBottom: 'clamp(20px, 3vw, 40px)'
      }}>
        <StatCard icon="✓" label="Occupied" value={stats.occupied} color="#10b981" />
        <StatCard icon="🏠" label="Available" value={stats.available} color="#3b82f6" />
        <StatCard icon="↓" label="Arrivals Today" value={stats.arrivals} color="#f59e0b" />
        <StatCard icon="↑" label="Departures Today" value={stats.departures} color="#8b5cf6" />
      </div>

      {/* System Status */}
      <div style={{
        background: '#f9fafb',
        padding: '20px',
        borderRadius: '12px',
        marginTop: '20px'
      }}>
        <h3 style={{ marginBottom: '15px', color: '#333' }}>System Status</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <StatusRow label="Cloudbeds PMS" status="Connected" />
          <StatusRow label="CLC Portal" status="Demo Mode" warning />
          <StatusRow label="Firebase Auth" status="Active" />
          <StatusRow
            label="Firestore (check-in records)"
            status={
              firestoreStatus === null
                ? 'Checking…'
                : firestoreStatus.connected
                  ? 'Connected'
                  : 'NOT CONNECTED'
            }
            warning={firestoreStatus !== null && !firestoreStatus.connected}
            error={firestoreStatus !== null && !firestoreStatus.connected}
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: any) {
  return (
    <div style={{
      background: 'white',
      border: `2px solid ${color}20`,
      borderRadius: '12px',
      padding: 'clamp(16px, 2.5vw, 28px)',
      textAlign: 'center',
      minHeight: '140px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    }}>
      <div style={{ fontSize: 'clamp(28px, 4vw, 40px)', marginBottom: '10px' }}>{icon}</div>
      <div style={{ 
        fontSize: 'clamp(32px, 5vw, 48px)', 
        fontWeight: 'bold', 
        color, 
        marginBottom: '5px',
        lineHeight: 1
      }}>
        {value}
      </div>
      <div style={{ fontSize: 'clamp(13px, 1.5vw, 16px)', color: '#666' }}>{label}</div>
    </div>
  );
}

function StatusRow({ label, status, warning, error }: { label: string; status: string; warning?: boolean; error?: boolean }) {
  const bg = error ? '#fee2e2' : warning ? '#fef3c7' : '#d1fae5';
  const color = error ? '#991b1b' : warning ? '#92400e' : '#065f46';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{
        padding: '4px 12px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '600',
        background: bg,
        color,
      }}>
        {status}
      </span>
    </div>
  );
}

