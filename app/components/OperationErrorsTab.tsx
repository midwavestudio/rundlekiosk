'use client';

import { useCallback, useEffect, useState } from 'react';
import { ADMIN_ACCENT } from '@/app/lib/adminTheme';
import {
  clearKioskErrors,
  clearCheckinAttempts,
  getKioskErrors,
  getCheckinAttempts,
  type KioskErrorEntry,
  type CheckinAttempt,
  type CheckinAttemptStatus,
} from '@/lib/kiosk-error-log';

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<CheckinAttemptStatus, { bg: string; color: string; label: string }> = {
  pending:         { bg: '#fef3c7', color: '#92400e', label: 'Pending' },
  success:         { bg: '#d1fae5', color: '#065f46', label: 'Success' },
  partial_success: { bg: '#dbeafe', color: '#1e40af', label: 'Confirmed (no room yet)' },
  cloudbeds_error: { bg: '#fee2e2', color: '#991b1b', label: 'Cloudbeds Error' },
};

function StatusBadge({ status }: { status: CheckinAttemptStatus }) {
  const s = STATUS_STYLES[status] ?? { bg: '#f3f4f6', color: '#374151', label: status };
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 700,
        background: s.bg,
        color: s.color,
        letterSpacing: '0.02em',
      }}
    >
      {s.label}
    </span>
  );
}

// ── Attempt card ──────────────────────────────────────────────────────────────

function AttemptCard({ a }: { a: CheckinAttempt }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article
      style={{
        border: `1px solid ${a.status === 'cloudbeds_error' ? '#fca5a5' : '#e5e7eb'}`,
        borderLeft: `4px solid ${a.status === 'cloudbeds_error' ? '#ef4444' : a.status === 'success' ? '#10b981' : a.status === 'partial_success' ? '#3b82f6' : '#f59e0b'}`,
        borderRadius: '10px',
        padding: '14px 16px',
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
        <StatusBadge status={a.status} />
        <span style={{ fontWeight: 600, fontSize: '15px', color: '#111' }}>
          {a.firstName} {a.lastName}
        </span>
        <span style={{ fontSize: '13px', color: '#6b7280' }}>
          CLC: {a.clcNumber}
        </span>
        <span style={{ fontSize: '13px', color: '#6b7280' }}>
          Room: {a.roomName ?? a.roomID}
        </span>
        <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto' }}>
          {new Date(a.submittedAt).toLocaleString()}
        </span>
      </div>

      {a.outcome && (
        <p style={{ margin: '8px 0 0', fontSize: '14px', color: a.status === 'cloudbeds_error' ? '#b91c1c' : '#374151' }}>
          {a.outcome}
        </p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          marginTop: '8px',
          background: 'none',
          border: 'none',
          color: ADMIN_ACCENT,
          cursor: 'pointer',
          fontSize: '12px',
          padding: 0,
          fontWeight: 600,
        }}
      >
        {expanded ? 'Hide details ▲' : 'Show details ▼'}
      </button>

      {expanded && (
        <pre
          style={{
            marginTop: '10px',
            padding: '12px',
            background: '#f3f4f6',
            borderRadius: '8px',
            fontSize: '12px',
            overflow: 'auto',
            maxHeight: '260px',
            lineHeight: 1.4,
          }}
        >
          {JSON.stringify(
            {
              phone: a.phoneNumber,
              roomTypeName: a.roomTypeName,
              stayStartNight: a.stayStartNight,
              checkInDate: a.checkInDate,
              checkOutDate: a.checkOutDate,
              placeholderReservationID: a.placeholderReservationID,
              cloudbedsReservationID: a.cloudbedsReservationID,
              cloudbedsGuestID: a.cloudbedsGuestID,
              errorMessage: a.errorMessage,
            },
            null,
            2
          )}
        </pre>
      )}
    </article>
  );
}

// ── Error card ─────────────────────────────────────────────────────────────────

function ErrorCard({ e }: { e: KioskErrorEntry }) {
  return (
    <article
      style={{
        border: '1px solid #e5e7eb',
        borderLeft: '4px solid #f59e0b',
        borderRadius: '10px',
        padding: '14px 16px',
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'baseline' }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: ADMIN_ACCENT,
          }}
        >
          {e.source.replace(/-/g, ' ')}
        </span>
        <span style={{ fontSize: '12px', color: '#9ca3af' }}>
          {new Date(e.timestamp).toLocaleString()}
        </span>
      </div>
      <p style={{ margin: '8px 0 0', color: '#111', fontSize: '14px', lineHeight: 1.45 }}>{e.message}</p>
      {e.detail && Object.keys(e.detail).length > 0 && (
        <pre
          style={{
            marginTop: '10px',
            padding: '12px',
            background: '#f3f4f6',
            borderRadius: '8px',
            fontSize: '12px',
            overflow: 'auto',
            maxHeight: '240px',
            lineHeight: 1.4,
          }}
        >
          {JSON.stringify(e.detail, null, 2)}
        </pre>
      )}
    </article>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function OperationErrorsTab() {
  const [attempts, setAttempts] = useState<CheckinAttempt[]>([]);
  const [errors, setErrors] = useState<KioskErrorEntry[]>([]);

  const refresh = useCallback(() => {
    setAttempts(getCheckinAttempts());
    setErrors(getKioskErrors());
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleClearAttempts = () => {
    if (!window.confirm('Clear all check-in attempt records on this device?')) return;
    clearCheckinAttempts();
    refresh();
  };

  const handleClearErrors = () => {
    if (!window.confirm('Clear all error log entries on this device?')) return;
    clearKioskErrors();
    refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>

      {/* ── Section 1: All check-in attempts ───────────────────────────────── */}
      <section>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div>
            <h2 style={{ margin: 0, color: '#111', fontSize: 'clamp(20px, 2.5vw, 26px)' }}>
              All check-in attempts
            </h2>
            <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: '13px', maxWidth: '680px' }}>
              Every guest check-in submission is recorded here immediately — regardless of whether
              Cloudbeds processed it successfully or not. Use this to confirm who attempted to check in.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClearAttempts}
            style={{
              padding: '9px 16px',
              borderRadius: '8px',
              border: `2px solid ${ADMIN_ACCENT}`,
              background: 'white',
              color: ADMIN_ACCENT,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              flexShrink: 0,
            }}
          >
            Clear attempts
          </button>
        </div>

        {attempts.length === 0 ? (
          <div
            style={{
              padding: '24px',
              background: '#f9fafb',
              borderRadius: '10px',
              color: '#9ca3af',
              textAlign: 'center',
              fontSize: '14px',
            }}
          >
            No check-in attempts recorded yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {attempts.map((a) => (
              <AttemptCard key={a.id} a={a} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Operation error log ────────────────────────────────── */}
      <section>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div>
            <h2 style={{ margin: 0, color: '#111', fontSize: 'clamp(20px, 2.5vw, 26px)' }}>
              Operation error log
            </h2>
            <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: '13px', maxWidth: '680px' }}>
              Detailed errors from failed check-ins, check-outs, room loads, and uncaught client errors,
              plus staff alerts when the selected room could not be booked but Cloudbeds still
              created a confirmed stay. Cloudbeds error responses and form context are included where available.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClearErrors}
            style={{
              padding: '9px 16px',
              borderRadius: '8px',
              border: `2px solid ${ADMIN_ACCENT}`,
              background: 'white',
              color: ADMIN_ACCENT,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              flexShrink: 0,
            }}
          >
            Clear errors
          </button>
        </div>

        {errors.length === 0 ? (
          <div
            style={{
              padding: '24px',
              background: '#f9fafb',
              borderRadius: '10px',
              color: '#9ca3af',
              textAlign: 'center',
              fontSize: '14px',
            }}
          >
            No errors logged yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {errors.map((e) => (
              <ErrorCard key={e.id} e={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
