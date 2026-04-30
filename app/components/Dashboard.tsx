'use client';

import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { ADMIN_ACCENT, ADMIN_GRADIENT } from '../lib/adminTheme';
import ArrivalsTab from './ArrivalsTab';
import DeparturesTab from './DeparturesTab';
import CheckInModal from './CheckInModal';
import CheckOutModal from './CheckOutModal';
import TyePlaceholdersTab from './TyePlaceholdersTab';
import FeedbackTab from './FeedbackTab';
import EventLogTab from './EventLogTab';
import { loadReadEventIds, markEventsRead, recordErrorLogVisit, loadErrorLogLastVisited } from '@/lib/event-log-read';
import { loadReadFeedbackIds, markFeedbacksRead } from '@/lib/feedback-read';

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

interface FirebaseStatus {
  connected: boolean;
  error: string | null;
  phase?: 'missing-env' | 'init-failed' | 'firestore-read' | 'ok';
}

interface EventLogEntry {
  id: string;
  occurredAt?: string;
}

interface FeedbackEntry {
  id: string;
}

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'arrivals' | 'departures' | 'tye-placeholders' | 'feedback' | 'event-log'
  >('dashboard');
  const [firestoreStatus, setFirestoreStatus] = useState<FirebaseStatus | null>(null);
  const [eventLogUnreadCount, setEventLogUnreadCount] = useState(0);
  const [feedbackUnreadCount, setFeedbackUnreadCount] = useState(0);

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

  useEffect(() => {
    let cancelled = false;

    const refreshErrorBadge = async () => {
      try {
        const res = await fetch('/api/event-log?limit=250');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const events: EventLogEntry[] = Array.isArray(data.events) ? data.events : [];

        const readIds = loadReadEventIds();
        const lastVisited = loadErrorLogLastVisited();
        const lastVisitedTime = lastVisited ? new Date(lastVisited).getTime() : null;

        const unread = events.reduce((count, ev) => {
          if (readIds.has(ev.id)) return count;
          // Treat events that existed before the last visit as already seen
          if (lastVisitedTime && new Date(ev.occurredAt ?? 0).getTime() <= lastVisitedTime) return count;
          return count + 1;
        }, 0);
        if (!cancelled) setEventLogUnreadCount(unread);
      } catch {
        // Ignore transient fetch errors and keep prior badge count.
      }
    };

    refreshErrorBadge();
    const pollId = setInterval(refreshErrorBadge, 15000);
    return () => {
      cancelled = true;
      clearInterval(pollId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshFeedbackBadge = async () => {
      try {
        const res = await fetch('/api/feedback');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const messages: FeedbackEntry[] = Array.isArray(data.messages) ? data.messages : [];
        const readIds = loadReadFeedbackIds();
        const unread = messages.reduce((count, m) => (readIds.has(m.id) ? count : count + 1), 0);
        if (!cancelled) setFeedbackUnreadCount(unread);
      } catch {
        // Ignore transient fetch errors and keep prior badge count.
      }
    };

    refreshFeedbackBadge();
    const pollId = setInterval(refreshFeedbackBadge, 15000);
    return () => {
      cancelled = true;
      clearInterval(pollId);
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'event-log') return;

    // Record the visit so the badge knows events up to now are not "new"
    recordErrorLogVisit();
    setEventLogUnreadCount(0);

    let cancelled = false;

    const markVisibleErrorsAsRead = async () => {
      try {
        const res = await fetch('/api/event-log?limit=250');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const events: EventLogEntry[] = Array.isArray(data.events) ? data.events : [];
        if (events.length === 0 || cancelled) return;

        const existingRead = loadReadEventIds();
        markEventsRead(events.map((ev) => ev.id), existingRead);
      } catch {
        // Non-fatal; IDs will still be excluded by the timestamp cutoff.
      }
    };

    markVisibleErrorsAsRead();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'feedback') return;

    let cancelled = false;
    const markVisibleFeedbackAsRead = async () => {
      try {
        const res = await fetch('/api/feedback');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const messages: FeedbackEntry[] = Array.isArray(data.messages) ? data.messages : [];
        if (messages.length === 0 || cancelled) {
          if (!cancelled) setFeedbackUnreadCount(0);
          return;
        }
        const existingRead = loadReadFeedbackIds();
        markFeedbacksRead(messages.map((m) => m.id), existingRead);
        if (!cancelled) setFeedbackUnreadCount(0);
      } catch {
        // Non-fatal; badge will refresh on next poll.
      }
    };

    markVisibleFeedbackAsRead();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);
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
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0,0,0,0.08)',
          height: wideGuestTab ? 'calc(100vh - 16px)' : 'calc(100vh - 30px)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Header */}
          <div style={{
            background: ADMIN_GRADIENT,
            padding: '14px 24px',
            color: 'white',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <a
                href="/"
                title="Back to guest kiosk"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '34px',
                  height: '34px',
                  borderRadius: '9999px',
                  border: '1.5px solid rgba(255,255,255,0.7)',
                  color: 'white',
                  textDecoration: 'none',
                  background: 'rgba(255,255,255,0.1)',
                  fontSize: '18px',
                  lineHeight: 1,
                  fontWeight: 700,
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }}
                aria-label="Back to guest kiosk"
              >
                ←
              </a>
              <div>
                <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, letterSpacing: '-0.01em' }}>Rundle Kiosk</h1>
                <p style={{ margin: '2px 0 0', opacity: 0.75, fontSize: '12px', letterSpacing: '0.01em' }}>
                  {user.email}
                </p>
              </div>
            </div>
            <button
              onClick={onLogout}
              style={{
                width: 'auto',
                background: 'rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.92)',
                border: '1px solid rgba(255,255,255,0.4)',
                padding: '6px 14px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
                transition: 'background 0.15s',
              }}
            >
              Sign out
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
            borderBottom: '1px solid #e8e8e8',
            padding: '0 20px',
            background: '#fafafa',
            overflowX: 'auto',
          }}>
            {['dashboard', 'arrivals', 'departures', 'tye-placeholders', 'feedback', 'event-log'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                style={{
                  width: 'auto',
                  padding: '12px 18px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab ? `2px solid ${ADMIN_ACCENT}` : '2px solid transparent',
                  color: activeTab === tab ? ADMIN_ACCENT : '#6b7280',
                  fontWeight: activeTab === tab ? 600 : 400,
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'color 0.15s',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                <span>
                  {tab === 'tye-placeholders'
                    ? 'Blocks'
                    : tab === 'feedback'
                      ? 'Messages'
                      : tab === 'event-log'
                        ? 'Error Log'
                        : tab === 'dashboard'
                          ? 'Dashboard'
                          : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </span>
                {tab === 'event-log' && eventLogUnreadCount > 0 && (
                  <span
                    style={{
                      minWidth: '20px',
                      height: '20px',
                      borderRadius: '999px',
                      background: '#dc2626',
                      color: 'white',
                      fontSize: '11px',
                      fontWeight: 700,
                      lineHeight: '20px',
                      padding: '0 6px',
                      textAlign: 'center',
                    }}
                    aria-label={`${eventLogUnreadCount} new errors`}
                    title={`${eventLogUnreadCount} new errors`}
                  >
                    {eventLogUnreadCount}
                  </span>
                )}
                {tab === 'feedback' && feedbackUnreadCount > 0 && (
                  <span
                    style={{
                      minWidth: '20px',
                      height: '20px',
                      borderRadius: '999px',
                      background: '#dc2626',
                      color: 'white',
                      fontSize: '11px',
                      fontWeight: 700,
                      lineHeight: '20px',
                      padding: '0 6px',
                      textAlign: 'center',
                    }}
                    aria-label={`${feedbackUnreadCount} new feedback messages`}
                    title={`${feedbackUnreadCount} new feedback messages`}
                  >
                    {feedbackUnreadCount}
                  </span>
                )}
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
  interface DashboardStats {
    inHouse: number;
    available: number;
    arrivals: number;
    departed: number;
  }

  const [stats, setStats] = useState<DashboardStats>({
    inHouse: 0,
    available: 60,
    arrivals: 0,
    departed: 0,
  });

  useEffect(() => {
    let cancelled = false;

    const loadStats = async () => {
      try {
        const res = await fetch('/api/admin/dashboard-stats');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data.success || !data.stats || cancelled) return;
        const next = data.stats as {
          inHouse?: number;
          available?: number;
          arrivalsToday?: number;
          departedToday?: number;
        };
        setStats({
          inHouse: Math.max(0, Number(next.inHouse ?? 0)),
          available: Math.max(0, Number(next.available ?? 0)),
          arrivals: Math.max(0, Number(next.arrivalsToday ?? 0)),
          departed: Math.max(0, Number(next.departedToday ?? 0)),
        });
      } catch {
        // Keep last known stats on transient errors.
      }
    };

    loadStats();
    const localId = setInterval(loadStats, 30000);
    return () => {
      cancelled = true;
      clearInterval(localId);
    };
  }, []);

  return (
    <div>
      <h2 style={{ 
        marginBottom: 'clamp(16px, 2.5vw, 32px)', 
        color: '#111',
        fontSize: 'clamp(20px, 2.5vw, 26px)',
        fontWeight: 700,
        letterSpacing: '-0.01em',
      }}>Overview</h2>
      
      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
        gap: 'clamp(12px, 1.5vw, 20px)',
        marginBottom: 'clamp(16px, 2.5vw, 32px)',
      }}>
        <StatCard label="In House" value={stats.inHouse} color="#10b981" />
        <StatCard label="Available" value={stats.available} color="#3b82f6" />
        <StatCard label="Arrivals Today" value={stats.arrivals} color="#f59e0b" />
        <StatCard label="Departed Today" value={stats.departed} color="#8b5cf6" />
      </div>

      {/* System Status */}
      <div style={{
        background: '#f8f9fa',
        border: '1px solid #eaecef',
        padding: '20px 24px',
        borderRadius: '12px',
      }}>
        <h3 style={{ margin: '0 0 14px', color: '#374151', fontSize: '14px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>System Status</h3>
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
                  : 'Not Connected'
            }
            warning={firestoreStatus !== null && !firestoreStatus.connected}
            error={firestoreStatus !== null && !firestoreStatus.connected}
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: 'white',
      border: '1px solid #eaecef',
      borderTop: `3px solid ${color}`,
      borderRadius: '10px',
      padding: 'clamp(14px, 2vw, 22px)',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ 
        fontSize: 'clamp(28px, 4vw, 40px)', 
        fontWeight: 700, 
        color, 
        lineHeight: 1,
        letterSpacing: '-0.02em',
      }}>
        {value}
      </div>
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

