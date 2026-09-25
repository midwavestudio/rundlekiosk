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
  checkOutTime?: string;
  cloudbedsReservationID?: string;
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

export default function DeletedArrivalsTab() {
  const [records, setRecords] = useState<DeletedArrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

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
