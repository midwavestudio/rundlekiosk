'use client';

import { useState, useEffect, useMemo } from 'react';
import { resolveRoomNumberLabel } from '@/lib/room-display';

interface ArrivalsTabProps {
  onCheckIn: (reservation: any) => void;
  onDelete?: (reservation: any) => void;
}

interface CheckedInGuest {
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  class: 'TYE' | 'MOW';
  checkInTime: string;
  checkOutTime?: string;
  cloudbedsGuestID?: string;
  cloudbedsReservationID?: string;
  roomNumber?: string;
}

interface Row {
  id: string;
  guestName: string;
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  class: string;
  roomNumber: string;
  checkInDate: string;      // display date string
  checkInTime: string;      // display time string
  checkInIso: string;       // raw ISO for sorting / export
  /** Present when this row is from check-out history (guest has left). */
  checkOutIso?: string;
  fromHistory?: boolean;
  cloudbedsReservationID?: string;
  cloudbedsGuestID?: string;
  rawData: CheckedInGuest;
}

interface RoomDirectoryEntry {
  roomID: string;
  roomName: string;
}

/** Calendar day in local timezone (matches `<input type="date">`). */
function localYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addCalendarDaysToYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localYmd(dt);
}

function isoToLocalYmd(iso: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return localYmd(d);
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

function fmtTime(iso: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
  catch { return iso; }
}

function fmtDateRange(from: Date, to: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(from)} – ${fmt(to)}`;
}

function inDateRange(iso: string, from: Date, to: Date): boolean {
  if (!iso) return false;
  try {
    const d = new Date(iso);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const toDay = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return day >= fromDay && day <= toDay;
  } catch { return false; }
}

function exportCSV(rows: Row[], label: string) {
  const headers = ['Name', 'CLC Number', 'Class', 'Phone', 'Room', 'Check-In Date', 'Check-In Time', 'Check-Out Date', 'Check-Out Time', 'Reservation ID'];
  const lines = [
    headers.join(','),
    ...rows.map(r => [
      `"${r.guestName}"`,
      r.clcNumber,
      r.class,
      r.phoneNumber,
      r.roomNumber || '',
      `"${r.checkInDate}"`,
      `"${r.checkInTime}"`,
      r.checkOutIso ? `"${fmtDate(r.checkOutIso)}"` : '',
      r.checkOutIso ? `"${fmtTime(r.checkOutIso)}"` : '',
      r.cloudbedsReservationID || '',
    ].join(','))
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `arrivals-${label}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

const AVATAR_COLORS = ['#667eea', '#764ba2', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4'];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function guestMatchKey(g: Pick<CheckedInGuest, 'firstName' | 'lastName' | 'checkInTime'>): string {
  return `${g.firstName}|${g.lastName}|${g.checkInTime}`;
}

export default function ArrivalsTab({ onCheckIn, onDelete }: ArrivalsTabProps) {
  const [checkedInGuests, setCheckedInGuests] = useState<CheckedInGuest[]>([]);
  const [checkOutHistory, setCheckOutHistory] = useState<CheckedInGuest[]>([]);
  const [roomNameById, setRoomNameById] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);

  /** Which calendar day’s check-ins to list (local) — defaults to today. */
  const [selectedDate, setSelectedDate] = useState<string>(() => localYmd(new Date()));

  const [exportFrom, setExportFrom] = useState(() => localYmd(new Date()));
  const [exportTo, setExportTo] = useState(() => localYmd(new Date()));
  const [showExportPanel, setShowExportPanel] = useState(false);
  /** When true, list is sorted by check-in time descending (latest at top). */
  const [newestFirst, setNewestFirst] = useState(true);

  useEffect(() => {
    const load = () => {
      const g = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
      const h = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
      setCheckedInGuests(g);
      setCheckOutHistory(Array.isArray(h) ? h : []);
    };
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadRoomDirectory = async () => {
      try {
        const res = await fetch('/api/admin/all-rooms');
        const data = await res.json();
        if (!res.ok || !data?.success || !Array.isArray(data.rooms) || cancelled) return;
        const next: Record<string, string> = {};
        for (const room of data.rooms as RoomDirectoryEntry[]) {
          const id = String(room?.roomID ?? '').trim();
          const name = String(room?.roomName ?? '').trim();
          if (id && name) next[id] = name;
        }
        setRoomNameById(next);
      } catch {
        // Non-fatal: keep fallback display behavior.
      }
    };
    loadRoomDirectory();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: Row[] = useMemo(() => {
    const activeKeys = new Set(checkedInGuests.map((g) => guestMatchKey(g)));
    const historyGuests = checkOutHistory.filter((g) => !activeKeys.has(guestMatchKey(g)));

    const toRow = (g: CheckedInGuest, id: string, fromHistory: boolean): Row => ({
      id,
      guestName: `${g.firstName} ${g.lastName}`.trim(),
      firstName: g.firstName,
      lastName: g.lastName,
      clcNumber: g.clcNumber || '—',
      phoneNumber: g.phoneNumber || '—',
      class: g.class || '—',
      roomNumber: resolveRoomNumberLabel(g.roomNumber, roomNameById),
      checkInDate: fmtDate(g.checkInTime),
      checkInTime: fmtTime(g.checkInTime),
      checkInIso: g.checkInTime,
      checkOutIso: g.checkOutTime,
      fromHistory,
      cloudbedsReservationID: g.cloudbedsReservationID,
      cloudbedsGuestID: g.cloudbedsGuestID,
      rawData: g,
    });

    const activeRows = checkedInGuests.map((g, i) => toRow(g, `guest-${i}`, false));
    const historyRows = historyGuests.map((g, i) =>
      toRow(g, `hist-${guestMatchKey(g)}-${String(g.checkOutTime ?? '')}-${i}`, true)
    );
    return [...activeRows, ...historyRows];
  }, [checkedInGuests, checkOutHistory, roomNameById]);

  /** Only guests whose check-in falls on the selected local calendar day. */
  const rowsForSelectedDate = useMemo(
    () => rows.filter((r) => isoToLocalYmd(r.checkInIso) === selectedDate),
    [rows, selectedDate]
  );

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return rowsForSelectedDate;
    const q = searchTerm.toLowerCase();
    return rowsForSelectedDate.filter(r =>
      r.guestName.toLowerCase().includes(q) ||
      r.clcNumber.toLowerCase().includes(q) ||
      r.phoneNumber.includes(q) ||
      r.roomNumber.toLowerCase().includes(q) ||
      (r.rawData.roomNumber || '').toLowerCase().includes(q)
    );
  }, [rowsForSelectedDate, searchTerm]);

  const sortedFilteredRows = useMemo(() => {
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const ta = new Date(a.checkInIso).getTime();
      const tb = new Date(b.checkInIso).getTime();
      const aBad = Number.isNaN(ta);
      const bBad = Number.isNaN(tb);
      if (aBad && bBad) return 0;
      if (aBad) return 1;
      if (bBad) return -1;
      return newestFirst ? tb - ta : ta - tb;
    });
    return copy;
  }, [filteredRows, newestFirst]);

  useEffect(() => {
    if (selectedRow && !filteredRows.some((r) => r.id === selectedRow.id)) {
      setSelectedRow(null);
    }
  }, [filteredRows, selectedRow]);

  const exportRows = useMemo(() => {
    if (!exportFrom || !exportTo) return rows;
    const from = new Date(exportFrom + 'T00:00:00');
    const to = new Date(exportTo + 'T23:59:59');
    return rows.filter((r) => inDateRange(r.checkInIso, from, to));
  }, [rows, exportFrom, exportTo]);

  const toggleExportPanel = () => {
    setShowExportPanel((v) => {
      if (!v) {
        setExportFrom(selectedDate);
        setExportTo(selectedDate);
      }
      return !v;
    });
  };

  const handleDelete = async (row: Row) => {
    const msg = row.fromHistory
      ? `Remove ${row.guestName} from this list? (They are already checked out; this only deletes the local history record.)`
      : `Delete reservation for ${row.guestName}? This will also remove it from Cloudbeds.`;
    if (!confirm(msg)) return;
    try {
      if (!row.fromHistory && row.cloudbedsReservationID) {
        const res = await fetch(`/api/cloudbeds-delete?reservationID=${row.cloudbedsReservationID}`, { method: 'DELETE' });
        const result = await res.json();
        if (!result.success && !result.mockMode) throw new Error(result.error || 'Failed to delete from Cloudbeds');
      }
      if (row.fromHistory) {
        const history: CheckedInGuest[] = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
        const updated = history.filter((g) => {
          if (
            row.rawData.cloudbedsReservationID &&
            g.cloudbedsReservationID === row.rawData.cloudbedsReservationID
          ) {
            return g.checkOutTime !== row.rawData.checkOutTime;
          }
          return !(
            g.firstName === row.rawData.firstName &&
            g.lastName === row.rawData.lastName &&
            g.checkInTime === row.rawData.checkInTime &&
            g.checkOutTime === row.rawData.checkOutTime
          );
        });
        localStorage.setItem('checkOutHistory', JSON.stringify(updated));
        setCheckOutHistory(updated);
      } else {
        const stored: CheckedInGuest[] = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
        const updated = stored.filter(
          (g) =>
            !(
              g.firstName === row.rawData.firstName &&
              g.lastName === row.rawData.lastName &&
              g.checkInTime === row.rawData.checkInTime
            )
        );
        localStorage.setItem('checkedInGuests', JSON.stringify(updated));
        setCheckedInGuests(updated);
      }
      if (selectedRow?.id === row.id) setSelectedRow(null);
      if (onDelete) onDelete(row);
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%', gap: 0 }}>
      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap', width: '100%' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#111', whiteSpace: 'nowrap' }}>
          Arrivals
          <span style={{ marginLeft: '8px', fontSize: '14px', fontWeight: 500, color: '#6b7280', background: '#f3f4f6', borderRadius: '12px', padding: '2px 10px' }}>
            {filteredRows.length}
          </span>
        </h2>

        <input
          type="text"
          placeholder="Search name, CLC, phone, room…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ flex: '1 1 200px', minWidth: '160px', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
        />

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={toggleExportPanel}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: showExportPanel ? '#667eea' : '#f3f4f6', color: showExportPanel ? 'white' : '#374151', border: '1px solid #d1d5db', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
          >
            ↓ Export
          </button>
        </div>
      </div>

      {/* ── Date filter (defaults to today, local timezone) ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap',
        marginBottom: '14px',
        padding: '10px 14px',
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: '10px',
        width: '100%',
        boxSizing: 'border-box',
      }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>Date</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setSelectedDate((d) => addCalendarDaysToYmd(d, -1))}
            style={{
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              background: 'white',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
              color: '#374151',
            }}
          >
            ‹
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit' }}
          />
          <button
            type="button"
            aria-label="Next day"
            onClick={() => setSelectedDate((d) => addCalendarDaysToYmd(d, 1))}
            style={{
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              background: 'white',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
              color: '#374151',
            }}
          >
            ›
          </button>
        </div>
        <span style={{ width: '1px', height: '24px', background: '#e5e7eb', flexShrink: 0 }} aria-hidden />
        <button
          type="button"
          aria-pressed={newestFirst}
          aria-label={newestFirst ? 'Sort: latest check-ins first' : 'Sort: earliest check-ins first'}
          onClick={() => setNewestFirst((v) => !v)}
          title={newestFirst ? 'Showing latest check-ins first. Click for earliest first.' : 'Showing earliest check-ins first. Click for latest first.'}
          style={{
            padding: '8px 14px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            background: 'white',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '13px',
            color: '#374151',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span aria-hidden>{newestFirst ? '↓' : '↑'}</span>
          {newestFirst ? 'Latest first' : 'Earliest first'}
        </button>
      </div>

      {/* ── Export Panel ── */}
      {showExportPanel && (
        <div style={{ marginBottom: '14px', padding: '14px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Export date range:</span>
          <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }} />
          <span style={{ color: '#6b7280' }}>to</span>
          <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }} />
          <span style={{ fontSize: '13px', color: '#6b7280' }}>
            {exportRows.length} guest{exportRows.length !== 1 ? 's' : ''}
            {exportFrom && exportTo ? ` · ${fmtDateRange(new Date(exportFrom + 'T00:00:00'), new Date(exportTo + 'T00:00:00'))}` : ''}
          </span>
          <button
            onClick={() => exportCSV(exportRows, `${exportFrom}-to-${exportTo}`)}
            disabled={exportRows.length === 0}
            style={{ padding: '7px 16px', background: exportRows.length > 0 ? '#667eea' : '#e5e7eb', color: exportRows.length > 0 ? 'white' : '#9ca3af', border: 'none', borderRadius: '7px', cursor: exportRows.length > 0 ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: '13px' }}
          >
            Download CSV
          </button>
        </div>
      )}

      {/* ── Main area: table + optional detail panel ── */}
      <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0, width: '100%', alignItems: 'stretch' }}>
        {/* Table */}
        <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', background: '#f9fafb', borderRadius: '8px 8px 0 0', border: '1px solid #e5e7eb', borderBottom: 'none', padding: '10px 0', userSelect: 'none' }}>
            <div style={{ width: '44px', flexShrink: 0 }} />
            <div style={{ flex: '2 1 0', minWidth: '120px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</div>
            <div style={{ flex: '1 1 0', minWidth: '90px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>CLC Number</div>
            <div style={{ flex: '1 1 0', minWidth: '80px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Room</div>
            <div style={{ flex: '0.7 1 0', minWidth: '60px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Class</div>
            <div style={{ flex: '1.5 1 0', minWidth: '140px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Check-in</div>
            <div style={{ flex: '1.5 1 0', minWidth: '140px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Check-out</div>
            <div style={{ width: '48px', flexShrink: 0 }} />
          </div>

          {/* Rows */}
          <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '0 0 8px 8px', background: 'white' }}>
            {sortedFilteredRows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af' }}>
                <div style={{ fontSize: '40px', marginBottom: '8px' }}>📭</div>
                <div style={{ fontSize: '14px' }}>
                  {searchTerm
                    ? 'No guests match your search for this date'
                    : 'No check-ins for this date'}
                </div>
              </div>
            ) : (
              sortedFilteredRows.map((row, idx) => {
                const isSelected = selectedRow?.id === row.id;
                return (
                  <div
                    key={row.id}
                    onClick={() => setSelectedRow(isSelected ? null : row)}
                    style={{
                      display: 'flex', alignItems: 'center', padding: '10px 0',
                      borderBottom: idx < sortedFilteredRows.length - 1 ? '1px solid #f3f4f6' : 'none',
                      background: isSelected ? '#eef2ff' : idx % 2 === 0 ? '#fff' : '#fafafa',
                      cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f5f7ff'; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#fafafa'; }}
                  >
                    {/* Avatar */}
                    <div style={{ width: '44px', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: avatarColor(row.guestName), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>
                        {initials(row.guestName)}
                      </div>
                    </div>

                    {/* Name + Host */}
                    <div style={{ flex: '2 1 0', minWidth: '120px', padding: '0 12px' }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: '#111' }}>{row.guestName}</div>
                      <div style={{ fontSize: '12px', color: '#9ca3af' }}>Host: TYE</div>
                    </div>

                    <div style={{ flex: '1 1 0', minWidth: '90px', padding: '0 12px', fontSize: '14px', color: '#374151' }}>{row.clcNumber}</div>
                    <div style={{ flex: '1 1 0', minWidth: '80px', padding: '0 12px', fontSize: '14px', color: '#374151', fontWeight: 500 }}>{row.roomNumber}</div>
                    <div style={{ flex: '0.7 1 0', minWidth: '60px', padding: '0 12px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', background: '#fef3c7', color: '#92400e' }}>{row.class}</span>
                    </div>
                    <div style={{ flex: '1.5 1 0', minWidth: '140px', padding: '0 12px', fontSize: '13px', color: '#374151' }}>
                      <span style={{ whiteSpace: 'nowrap' }}>{row.checkInDate}</span>
                      <span style={{ color: '#9ca3af', margin: '0 4px' }}>·</span>
                      <span style={{ fontWeight: 600, color: '#111' }}>{row.checkInTime}</span>
                    </div>
                    <div style={{ flex: '1.5 1 0', minWidth: '140px', padding: '0 12px', fontSize: '13px', color: '#374151' }}>
                      {row.checkOutIso ? (
                        <>
                          <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(row.checkOutIso)}</span>
                          <span style={{ color: '#9ca3af', margin: '0 4px' }}>·</span>
                          <span style={{ fontWeight: 600, color: '#111' }}>{fmtTime(row.checkOutIso)}</span>
                        </>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </div>

                    {/* Sign out action */}
                    <div style={{ width: '48px', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(row); }}
                        title="Delete"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '16px', padding: '4px', borderRadius: '4px' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Detail Panel ── */}
        {selectedRow && (
          <div style={{ width: 'min(340px, 32vw)', flexShrink: 0, border: '1px solid #e5e7eb', borderRadius: '10px', background: 'white', padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Avatar + name */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', paddingBottom: '16px', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: avatarColor(selectedRow.guestName), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 700 }}>
                {initials(selectedRow.guestName)}
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: '17px', color: '#111' }}>{selectedRow.guestName}</div>
                <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '2px' }}>Host: TYE</div>
              </div>
            </div>

            {/* Fields */}
            {[
              { label: 'Full Name', value: selectedRow.guestName },
              { label: 'Phone Number', value: selectedRow.phoneNumber },
              { label: 'CLC Number', value: selectedRow.clcNumber },
              { label: 'Room', value: selectedRow.roomNumber },
              { label: 'Class', value: selectedRow.class },
              { label: 'Signed In', value: `${selectedRow.checkInDate}, ${selectedRow.checkInTime}` },
              ...(selectedRow.checkOutIso
                ? [{ label: 'Checked Out', value: `${fmtDate(selectedRow.checkOutIso)}, ${fmtTime(selectedRow.checkOutIso)}` }]
                : []),
              ...(selectedRow.cloudbedsReservationID ? [{ label: 'Reservation ID', value: selectedRow.cloudbedsReservationID }] : []),
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
                <div style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '14px', color: '#374151', background: '#fafafa', wordBreak: 'break-all' }}>{value}</div>
              </div>
            ))}

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              {!selectedRow.fromHistory && (
              <button
                onClick={() => onCheckIn({ ...selectedRow, rawData: selectedRow.rawData })}
                style={{ padding: '10px', background: '#667eea', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
              >
                View / Check In
              </button>
              )}
              <button
                onClick={() => handleDelete(selectedRow)}
                style={{ padding: '10px', background: 'white', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
