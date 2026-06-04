'use client';

import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import {
  ADMIN_BG,
  ADMIN_SURFACE,
  ADMIN_SURFACE_RAISED,
  ADMIN_SURFACE_HIGH,
  ADMIN_BORDER,
  ADMIN_BORDER_STRONG,
  ADMIN_ACCENT,
  ADMIN_ACCENT_SUBTLE,
  ADMIN_CTA_GRADIENT,
  ADMIN_TEXT_PRIMARY,
  ADMIN_TEXT_MUTED,
  ADMIN_TEXT_FAINT,
} from '../lib/adminTheme';
import ArrivalsTab from './ArrivalsTab';
import DeparturesTab from './DeparturesTab';
import CheckInModal from './CheckInModal';
import CheckOutModal from './CheckOutModal';
import TyePlaceholdersTab from './TyePlaceholdersTab';
import FeedbackTab from './FeedbackTab';
import EventLogTab from './EventLogTab';
import AdminCheckInTab from './AdminCheckInTab';
import { dedupeEvents } from '@/lib/event-log-dedupe';
import {
  loadReadEventIds,
  markEventsRead,
  recordErrorLogVisit,
  loadErrorLogLastVisited,
} from '@/lib/event-log-read';
import { loadReadFeedbackIds } from '@/lib/feedback-read';
import BackupButton from './BackupButton';

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
  source?: string;
  message?: string;
  detailJson?: string;
  occurredAt?: string;
}

interface FeedbackEntry {
  id: string;
}

type TabId = 'dashboard' | 'arrivals' | 'departures' | 'admin-checkin' | 'tye-placeholders' | 'feedback' | 'event-log';

const TAB_CONFIG: { id: TabId; label: string }[] = [
  { id: 'dashboard',        label: 'Dashboard'  },
  { id: 'arrivals',         label: 'Arrivals'   },
  { id: 'departures',       label: 'Departures' },
  { id: 'admin-checkin',    label: 'Check In'   },
  { id: 'tye-placeholders', label: 'Blocks'     },
  { id: 'feedback',         label: 'Messages'   },
  { id: 'event-log',        label: 'Error Log'  },
];

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [firestoreStatus, setFirestoreStatus] = useState<FirebaseStatus | null>(null);
  const [eventLogUnreadCount, setEventLogUnreadCount] = useState(0);
  const [feedbackUnreadCount, setFeedbackUnreadCount] = useState(0);

  useEffect(() => {
    fetch('/api/admin/firebase-status')
      .then((r) => r.json())
      .then((data: FirebaseStatus) => setFirestoreStatus(data))
      .catch(() =>
        setFirestoreStatus({ connected: false, error: 'Could not reach /api/admin/firebase-status', phase: undefined })
      );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshErrorBadge = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/event-log?limit=250');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const raw: EventLogEntry[] = Array.isArray(data.events) ? data.events : [];
        const events = dedupeEvents(raw.map((ev) => ({
          id: ev.id,
          source: String(ev.source ?? ''),
          message: String(ev.message ?? ''),
          detailJson: ev.detailJson,
          occurredAt: String(ev.occurredAt ?? ''),
        })));
        const readIds = loadReadEventIds();
        const lastVisited = loadErrorLogLastVisited();
        const lastVisitedTime = lastVisited ? new Date(lastVisited).getTime() : null;
        const unread = events.reduce((count, ev) => {
          if (readIds.has(ev.id)) return count;
          if (lastVisitedTime && new Date(ev.occurredAt ?? 0).getTime() <= lastVisitedTime) return count;
          return count + 1;
        }, 0);
        if (!cancelled) setEventLogUnreadCount(unread);
      } catch { /* ignore */ }
    };
    refreshErrorBadge();
    // 30-minute poll — badge counts don't need to be real-time.
    const pollId = setInterval(refreshErrorBadge, 30 * 60_000);
    return () => { cancelled = true; clearInterval(pollId); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshFeedbackBadge = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/feedback');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const messages: FeedbackEntry[] = Array.isArray(data.messages) ? data.messages : [];
        const readIds = loadReadFeedbackIds();
        const unread = messages.reduce((count, m) => (readIds.has(m.id) ? count : count + 1), 0);
        if (!cancelled) setFeedbackUnreadCount(unread);
      } catch { /* ignore */ }
    };
    refreshFeedbackBadge();
    // 30-minute poll — badge counts don't need to be real-time.
    const pollId = setInterval(refreshFeedbackBadge, 30 * 60_000);
    return () => { cancelled = true; clearInterval(pollId); };
  }, []);

  useEffect(() => {
    if (activeTab !== 'feedback') return;
    // Zero the nav badge immediately when the Messages tab is opened.
    // FeedbackTab will mark all loaded messages as read in localStorage; if any
    // are later marked unread, onUnreadCountChange will push the count back up.
    setFeedbackUnreadCount(0);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'event-log') return;
    recordErrorLogVisit();
    setEventLogUnreadCount(0);
    let cancelled = false;
    const markVisible = async () => {
      try {
        const res = await fetch('/api/event-log?limit=250');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const events: EventLogEntry[] = Array.isArray(data.events) ? data.events : [];
        if (!events.length || cancelled) return;
        markEventsRead(events.map((ev) => ev.id), loadReadEventIds());
      } catch { /* non-fatal */ }
    };
    markVisible();
    return () => { cancelled = true; };
  }, [activeTab]);

  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showCheckOutModal, setShowCheckOutModal] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<any>(null);

  const handleCheckIn  = (r: any) => { setSelectedReservation(r); setShowCheckInModal(true); };
  const handleCheckOut = (r: any) => { setSelectedReservation(r); setShowCheckOutModal(true); };

  const wideGuestTab = activeTab === 'arrivals' || activeTab === 'departures';

  const firestoreQuotaExceeded =
    !!firestoreStatus?.error &&
    (/RESOURCE_EXHAUSTED/i.test(firestoreStatus.error) || /Quota exceeded/i.test(firestoreStatus.error));

  return (
    <>
      <div
        className="admin-dashboard-shell"
        style={{
          width: '100%', maxWidth: '100%', minWidth: 0, minHeight: '100vh',
          background: ADMIN_BG,
          padding: wideGuestTab ? '8px 12px' : 'clamp(10px, 1.5vw, 20px)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{
          maxWidth: wideGuestTab ? 'min(1920px, 100%)' : '1440px',
          width: '100%',
          margin: '0 auto',
          background: ADMIN_SURFACE,
          borderRadius: '14px',
          overflow: 'hidden',
          border: `1px solid ${ADMIN_BORDER_STRONG}`,
          boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 8px 24px rgba(0,0,0,0.4)',
          height: wideGuestTab ? 'calc(100vh - 16px)' : 'calc(100vh - 20px)',
          display: 'flex',
          flexDirection: 'column',
        }}>

          {/* ── Header ─────────────────────────────────────────── */}
          <div style={{
            background: `linear-gradient(135deg, #1f2023 0%, #252729 100%)`,
            borderBottom: `1px solid ${ADMIN_BORDER_STRONG}`,
            padding: '0 24px',
            height: '58px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexShrink: 0,
          }}>
            {/* Left: logo + title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '9px',
                background: ADMIN_CTA_GRADIENT,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, fontSize: '17px', fontWeight: 800, color: 'white',
                boxShadow: '0 2px 10px rgba(184,115,51,0.45)',
              }}>
                R
              </div>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: ADMIN_TEXT_PRIMARY, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                  Rundle Kiosk
                </div>
                <div style={{ fontSize: '11px', color: ADMIN_TEXT_MUTED, letterSpacing: '0.01em' }}>
                  {user.email}
                </div>
              </div>
            </div>

            {/* Right: nav buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <a
                href="/"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '6px 14px', borderRadius: '7px',
                  border: `1px solid ${ADMIN_BORDER_STRONG}`,
                  color: ADMIN_TEXT_MUTED, textDecoration: 'none',
                  fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
              >
                ← Kiosk
              </a>
              <button
                type="button"
                onClick={onLogout}
                style={{
                  width: 'auto', flexShrink: 0,
                  background: ADMIN_ACCENT_SUBTLE,
                  color: ADMIN_ACCENT,
                  border: `1px solid rgba(184,115,51,0.4)`,
                  padding: '6px 16px', borderRadius: '7px',
                  cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                  whiteSpace: 'nowrap', transition: 'background 0.15s',
                }}
              >
                Sign out
              </button>
            </div>
          </div>

          {/* ── Firestore warning banner ────────────────────────── */}
          {firestoreStatus && !firestoreStatus.connected && (
            <div style={{
              background: 'rgba(220,38,38,0.08)', borderBottom: '1px solid rgba(220,38,38,0.22)',
              padding: '10px 24px', display: 'flex', alignItems: 'flex-start', gap: '10px',
              color: '#f87171', fontSize: '13px', lineHeight: '1.5', flexShrink: 0,
            }}>
              <span style={{ fontSize: '15px', flexShrink: 0, marginTop: '1px' }}>⚠</span>
              <div>
                <strong>
                  {firestoreQuotaExceeded
                    ? 'Firestore daily quota exceeded.'
                    : 'Firestore is not connected — check-in data will NOT persist between page loads.'}
                </strong>
                {firestoreStatus.error && (
                  <><br /><span style={{ opacity: 0.55 }}>Detail: {firestoreStatus.error}</span></>
                )}
              </div>
            </div>
          )}

          {/* ── Tab bar ──────────────────────────────────────────── */}
          <div style={{
            display: 'flex',
            borderBottom: `1px solid ${ADMIN_BORDER_STRONG}`,
            padding: '0 20px',
            background: ADMIN_SURFACE_RAISED,
            overflowX: 'auto', flexShrink: 0, gap: '2px',
          }}>
            {TAB_CONFIG.map(({ id, label }) => {
              const isActive = activeTab === id;
              const badge = id === 'event-log' ? eventLogUnreadCount : id === 'feedback' ? feedbackUnreadCount : 0;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  style={{
                    width: 'auto',
                    padding: '13px 18px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: isActive ? `2px solid ${ADMIN_ACCENT}` : '2px solid transparent',
                    color: isActive ? ADMIN_ACCENT : ADMIN_TEXT_MUTED,
                    fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer',
                    fontSize: '13px',
                    transition: 'color 0.15s',
                    display: 'inline-flex', alignItems: 'center', gap: '7px',
                    whiteSpace: 'nowrap', flexShrink: 0, letterSpacing: '0.01em',
                  }}
                >
                  {label}
                  {badge > 0 && (
                    <span style={{
                      minWidth: '18px', height: '18px', borderRadius: '999px',
                      background: '#e53e3e', color: 'white',
                      fontSize: '10px', fontWeight: 700, lineHeight: '18px',
                      padding: '0 5px', textAlign: 'center',
                    }}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Content ──────────────────────────────────────────── */}
          <div style={{
            padding: wideGuestTab ? '12px 16px 16px' : 'clamp(20px, 2.5vw, 36px)',
            flex: 1, minHeight: 0,
            display: 'flex', flexDirection: 'column',
            overflow: wideGuestTab ? 'hidden' : 'auto',
            overflowY: wideGuestTab ? 'hidden' : 'auto',
            color: ADMIN_TEXT_PRIMARY,
          }}>
            {activeTab === 'dashboard' && <DashboardTab firestoreStatus={firestoreStatus} />}
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
            {activeTab === 'admin-checkin'    && <AdminCheckInTab />}
            {activeTab === 'tye-placeholders' && <TyePlaceholdersTab />}
            {activeTab === 'feedback'         && <FeedbackTab onUnreadCountChange={setFeedbackUnreadCount} />}
            {activeTab === 'event-log'        && <EventLogTab />}
          </div>
        </div>
      </div>

      {showCheckInModal && selectedReservation && (
        <CheckInModal reservation={selectedReservation} onClose={() => { setShowCheckInModal(false); setSelectedReservation(null); }} />
      )}
      {showCheckOutModal && selectedReservation && (
        <CheckOutModal reservation={selectedReservation} onClose={() => { setShowCheckOutModal(false); setSelectedReservation(null); }} />
      )}
    </>
  );
}

// ─── Dashboard tab ────────────────────────────────────────────────────────────

function DashboardTab({ firestoreStatus }: { firestoreStatus: FirebaseStatus | null }) {
  interface DashboardStats { inHouse: number; available: number; arrivals: number; departed: number; }

  const [stats, setStats] = useState<DashboardStats>({ inHouse: 0, available: 60, arrivals: 0, departed: 0 });

  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
      try {
        const res = await fetch('/api/admin/dashboard-stats');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data.success || !data.stats || cancelled) return;
        const next = data.stats as { inHouse?: number; available?: number; arrivalsToday?: number; departedToday?: number; };
        setStats({
          inHouse:  Math.max(0, Number(next.inHouse ?? 0)),
          available: Math.max(0, Number(next.available ?? 0)),
          arrivals:  Math.max(0, Number(next.arrivalsToday ?? 0)),
          departed:  Math.max(0, Number(next.departedToday ?? 0)),
        });
      } catch { /* ignore */ }
    };
    loadStats();
    const id = setInterval(loadStats, 15 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div>
      <h2 style={{
        marginBottom: 'clamp(16px, 2.5vw, 28px)',
        color: ADMIN_TEXT_PRIMARY,
        fontSize: 'clamp(18px, 2vw, 22px)',
        fontWeight: 700, letterSpacing: '-0.01em',
      }}>
        Overview
      </h2>

      {/* Stats grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
        gap: 'clamp(10px, 1.5vw, 18px)',
        marginBottom: 'clamp(16px, 2.5vw, 28px)',
      }}>
        <StatCard label="In House (TYE)"  value={stats.inHouse}   color="#34d399" icon="🏨" />
        <StatCard label="Available"        value={stats.available} color="#60a5fa" icon="🔓" />
        <StatCard label="Arrivals Today"   value={stats.arrivals}  color={ADMIN_ACCENT} icon="→" />
        <StatCard label="Departed Today"   value={stats.departed}  color="#a78bfa" icon="←" />
      </div>

      {/* System status panel */}
      <div style={{
        background: ADMIN_SURFACE_RAISED,
        border: `1px solid ${ADMIN_BORDER_STRONG}`,
        borderRadius: '12px',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 20px',
          borderBottom: `1px solid ${ADMIN_BORDER}`,
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: ADMIN_ACCENT, flexShrink: 0 }} />
          <span style={{ fontSize: '11px', fontWeight: 700, color: ADMIN_TEXT_PRIMARY, textTransform: 'uppercase', letterSpacing: '0.09em' }}>
            System Status
          </span>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <StatusRow label="Cloudbeds PMS"             status="Connected"    />
          <StatusRow label="CLC Portal"                status="Demo Mode"    warning />
          <StatusRow label="Firebase Auth"             status="Active"       />
          <StatusRow
            label="Firestore (check-in records)"
            status={firestoreStatus === null ? 'Checking…' : firestoreStatus.connected ? 'Connected' : 'Not Connected'}
            warning={firestoreStatus !== null && !firestoreStatus.connected}
            error={firestoreStatus !== null && !firestoreStatus.connected}
          />
        </div>

        <div style={{ padding: '14px 20px 18px', borderTop: `1px solid ${ADMIN_BORDER}` }}>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: ADMIN_TEXT_MUTED }}>
            Download a full JSON backup of all check-in and departure records from Firestore.
          </p>
          <BackupButton />
        </div>
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <div style={{
      background: ADMIN_SURFACE_RAISED,
      border: `1px solid ${ADMIN_BORDER_STRONG}`,
      borderRadius: '12px',
      padding: 'clamp(16px, 2vw, 24px)',
      display: 'flex', flexDirection: 'column', gap: '10px',
      position: 'relative', overflow: 'hidden',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    }}>
      {/* Color bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
        background: color, opacity: 0.9,
      }} />
      {/* Faint watermark */}
      <div style={{
        position: 'absolute', right: '14px', top: '14px',
        fontSize: '28px', opacity: 0.22, userSelect: 'none', lineHeight: 1,
        color: '#ffffff',
      }}>
        {icon}
      </div>
      <div style={{
        fontSize: '11px', fontWeight: 600, color: ADMIN_TEXT_FAINT,
        textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: '6px',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 'clamp(30px, 4vw, 42px)', fontWeight: 800, color,
        lineHeight: 1, letterSpacing: '-0.03em',
      }}>
        {value}
      </div>
    </div>
  );
}

// ─── Status row ───────────────────────────────────────────────────────────────

function StatusRow({ label, status, warning, error }: { label: string; status: string; warning?: boolean; error?: boolean; }) {
  const bg    = error ? 'rgba(220,38,38,0.18)'  : warning ? 'rgba(245,158,11,0.15)' : 'rgba(52,211,153,0.12)';
  const color = error ? '#f87171'                : warning ? '#fbbf24'               : '#34d399';
  const dot   = error ? '#f87171'                : warning ? '#fbbf24'               : '#34d399';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: ADMIN_TEXT_PRIMARY, fontSize: '13.5px' }}>{label}</span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        padding: '3px 10px', borderRadius: '999px',
        fontSize: '11px', fontWeight: 600, background: bg, color, letterSpacing: '0.03em',
      }}>
        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: dot, display: 'inline-block' }} />
        {status}
      </span>
    </div>
  );
}
