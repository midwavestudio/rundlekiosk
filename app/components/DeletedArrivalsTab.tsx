'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ClcNumberDisplay } from './ClcNumberDisplay';
import {
  ADMIN_ACCENT,
  ADMIN_BORDER_STRONG,
  ADMIN_INPUT_BG,
  ADMIN_SURFACE_RAISED,
  ADMIN_TEXT_PRIMARY,
} from '../lib/adminTheme';

interface DeletedArrival {
  id: string;
  firstName: string;
  lastName: string;
  clcNumber?: string;
  phoneNumber?: string;
  class?: string;
  roomNumber?: string;
  checkInTime?: string;
  checkInDateYmd?: string;
  checkOutTime?: string;
  cloudbedsReservationID?: string;
  cloudbedsGuestID?: string;
  reservationStatus?: string;
  deletedAt: string;
}

const AVATAR_COLORS = ['#667eea', '#764ba2', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4'];

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return iso;
  }
}

function guestName(r: DeletedArrival): string {
  return `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || 'Unknown guest';
}

function isoToLocalYmd(iso: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function writeRestoredGuestLocally(record: {
  id: string;
  firstName?: string;
  lastName?: string;
  clcNumber?: string;
  phoneNumber?: string;
  class?: string;
  roomNumber?: string;
  checkInTime?: string;
  checkInDateYmd?: string;
  checkOutTime?: string;
  cloudbedsReservationID?: string;
  cloudbedsGuestID?: string;
  reservationStatus?: string;
}) {
  const guest: {
    firstName: string;
    lastName: string;
    clcNumber: string;
    phoneNumber: string;
    class: 'TYE' | 'MOW';
    checkInTime: string;
    checkInDateYmd?: string;
    checkOutTime?: string;
    cloudbedsReservationID?: string;
    cloudbedsGuestID?: string;
    reservationStatus?: string;
    roomNumber: string;
    _serverId: string;
  } = {
    firstName: record.firstName ?? '',
    lastName: record.lastName ?? '',
    clcNumber: record.clcNumber ?? '',
    phoneNumber: record.phoneNumber ?? '',
    class: record.class === 'MOW' ? 'MOW' : 'TYE',
    checkInTime: record.checkInTime ?? '',
    ...(record.checkInDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(record.checkInDateYmd)
      ? { checkInDateYmd: record.checkInDateYmd }
      : {}),
    ...(record.checkOutTime ? { checkOutTime: record.checkOutTime } : {}),
    ...(record.cloudbedsReservationID
      ? { cloudbedsReservationID: record.cloudbedsReservationID }
      : {}),
    ...(record.cloudbedsGuestID ? { cloudbedsGuestID: record.cloudbedsGuestID } : {}),
    ...(record.reservationStatus ? { reservationStatus: record.reservationStatus } : {}),
    roomNumber: record.roomNumber ?? '',
    _serverId: record.id,
  };

  const storageKey = guest.checkOutTime ? 'checkOutHistory' : 'checkedInGuests';
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const list = Array.isArray(raw) ? raw : [];
    const next = list.filter((g: { cloudbedsReservationID?: string; firstName?: string; lastName?: string; checkInTime?: string }) => {
      if (guest.cloudbedsReservationID && g.cloudbedsReservationID === guest.cloudbedsReservationID) {
        return false;
      }
      return !(
        g.firstName === guest.firstName &&
        g.lastName === guest.lastName &&
        g.checkInTime === guest.checkInTime
      );
    });
    next.unshift(guest);
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Non-fatal: Arrivals will still pick the record up from the server.
  }

  const ymd = isoToLocalYmd(guest.checkInTime)
    ?? (guest.checkInDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(guest.checkInDateYmd)
      ? guest.checkInDateYmd
      : undefined);
  try {
    if (ymd) sessionStorage.setItem('arrivalsFocusDate', ymd);
  } catch {
    // Non-fatal: Arrivals will open on today if storage is unavailable.
  }
}

interface DeletedArrivalsTabProps {
  onRestored?: () => void;
}

export default function DeletedArrivalsTab({ onRestored }: DeletedArrivalsTabProps) {
  const [records, setRecords] = useState<DeletedArrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/checkin-records?action=deleted&limit=500', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      const list: DeletedArrival[] = Array.isArray(data.records) ? data.records : [];
      list.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
      setRecords(list);
    } catch {
      setError('Could not load deleted arrivals. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => {
      const hay = [
        guestName(r),
        r.clcNumber,
        r.phoneNumber,
        r.roomNumber,
        r.class,
        r.cloudbedsReservationID,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [records, searchTerm]);

  const handleRestore = async (row: DeletedArrival) => {
    const name = guestName(row);
    if (!confirm(`Restore ${name} to Arrivals?`)) return;
    setRestoringId(row.id);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/checkin-records?action=restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        record?: {
          id: string;
          firstName?: string;
          lastName?: string;
          clcNumber?: string;
          phoneNumber?: string;
          class?: string;
          roomNumber?: string;
          checkInTime?: string;
          checkInDateYmd?: string;
          checkOutTime?: string;
          cloudbedsReservationID?: string;
          cloudbedsGuestID?: string;
          reservationStatus?: string;
        };
      };
      if (!res.ok || data.success === false || !data.record) {
        throw new Error(data.error || 'Failed to restore arrival');
      }
      writeRestoredGuestLocally(data.record);
      setRecords((prev) => prev.filter((r) => r.id !== row.id));
      setSuccess(`${name} restored to Arrivals.`);
      onRestored?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to restore arrival';
      setError(message);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px', flexWrap: 'wrap', width: '100%' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: ADMIN_TEXT_PRIMARY, whiteSpace: 'nowrap' }}>
          Deleted arrivals
          <span
            style={{
              marginLeft: '8px',
              fontSize: '14px',
              fontWeight: 600,
              color: ADMIN_ACCENT,
              background: ADMIN_SURFACE_RAISED,
              border: `1px solid ${ADMIN_BORDER_STRONG}`,
              borderRadius: '12px',
              padding: '2px 10px',
            }}
          >
            {filtered.length}
          </span>
        </h2>
        <input
          type="text"
          placeholder="Search name, CLC, phone, room..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: '1 1 200px',
            minWidth: '160px',
            padding: '8px 12px',
            border: `1px solid ${ADMIN_BORDER_STRONG}`,
            borderRadius: '8px',
            fontSize: '14px',
            background: ADMIN_INPUT_BG,
            color: ADMIN_TEXT_PRIMARY,
          }}
        />
        <button
          type="button"
          onClick={() => void load()}
          style={{
            padding: '8px 14px',
            background: ADMIN_SURFACE_RAISED,
            color: ADMIN_TEXT_PRIMARY,
            border: `1px solid ${ADMIN_BORDER_STRONG}`,
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '13px',
          }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: '12px',
            fontSize: '13px',
            color: '#dc2626',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: '6px',
            padding: '8px 12px',
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            marginBottom: '12px',
            fontSize: '13px',
            color: '#166534',
            background: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: '6px',
            padding: '8px 12px',
          }}
        >
          {success}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: '#f9fafb',
            borderRadius: '8px 8px 0 0',
            border: '1px solid #e5e7eb',
            borderBottom: 'none',
            padding: '10px 0',
            userSelect: 'none',
          }}
        >
          <div style={{ width: '44px', flexShrink: 0 }} />
          <div style={headerCell(2, 120)}>Name</div>
          <div style={headerCell(1, 90)}>CLC Number</div>
          <div style={headerCell(1, 80)}>Room</div>
          <div style={headerCell(1.5, 140)}>Check-in</div>
          <div style={headerCell(1.5, 140)}>Deleted</div>
          <div style={{ ...headerCell(0, 88), flex: '0 0 88px', minWidth: '88px' }}>Restore</div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            border: '1px solid #e5e7eb',
            borderRadius: '0 0 8px 8px',
            background: 'white',
          }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af', fontSize: '14px' }}>
              Loading deleted arrivals…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af' }}>
              <div style={{ fontSize: '14px' }}>
                {searchTerm ? 'No deleted arrivals match your search' : 'No deleted arrivals yet'}
              </div>
            </div>
          ) : (
            filtered.map((row, idx) => {
              const name = guestName(row);
              return (
                <div
                  key={row.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: idx < filtered.length - 1 ? '1px solid #f3f4f6' : 'none',
                    background: idx % 2 === 0 ? '#fff' : '#fafafa',
                  }}
                >
                  <div style={{ width: '44px', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: avatarColor(name),
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 700,
                      }}
                    >
                      {initials(name)}
                    </div>
                  </div>
                  <div style={{ flex: '2 1 0', minWidth: '120px', padding: '0 12px' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: '#111' }}>{name}</div>
                    {row.class ? (
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{row.class}</div>
                    ) : null}
                  </div>
                  <div style={{ flex: '1 1 0', minWidth: '90px', padding: '0 12px', overflow: 'hidden' }}>
                    <ClcNumberDisplay value={row.clcNumber || '—'} color="#374151" truncate />
                  </div>
                  <div
                    style={{
                      flex: '1 1 0',
                      minWidth: '80px',
                      padding: '0 12px',
                      fontSize: '14px',
                      color: '#374151',
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={row.roomNumber || ''}
                  >
                    {row.roomNumber || '—'}
                  </div>
                  <div style={{ flex: '1.5 1 0', minWidth: '140px', padding: '0 12px', fontSize: '13px', color: '#374151' }}>
                    {row.checkInTime ? (
                      <>
                        <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(row.checkInTime)}</span>
                        <span style={{ color: '#9ca3af', margin: '0 4px' }}>·</span>
                        <span style={{ fontWeight: 600, color: '#111' }}>{fmtTime(row.checkInTime)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </div>
                  <div style={{ flex: '1.5 1 0', minWidth: '140px', padding: '0 12px', fontSize: '13px', color: '#374151' }}>
                    <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(row.deletedAt)}</span>
                    <span style={{ color: '#9ca3af', margin: '0 4px' }}>·</span>
                    <span style={{ fontWeight: 600, color: '#111' }}>{fmtTime(row.deletedAt)}</span>
                  </div>
                  <div
                    style={{
                      flex: '0 0 88px',
                      minWidth: '88px',
                      padding: '0 8px',
                      display: 'flex',
                      justifyContent: 'flex-start',
                    }}
                  >
                    <button
                      type="button"
                      disabled={restoringId === row.id}
                      onClick={() => void handleRestore(row)}
                      style={{
                        padding: '6px 10px',
                        background: restoringId === row.id ? '#e5e7eb' : ADMIN_ACCENT,
                        color: restoringId === row.id ? '#6b7280' : 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: restoringId === row.id ? 'wait' : 'pointer',
                        fontWeight: 700,
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {restoringId === row.id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function headerCell(flex: number, minWidth: number): CSSProperties {
  return {
    flex: `${flex} 1 0`,
    minWidth: `${minWidth}px`,
    padding: '0 12px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
}
