'use client';

import { useState, useEffect, useMemo } from 'react';
import { resolveRoomNumberLabel } from '@/lib/room-display';

interface DeparturesTabProps {
  onCheckOut: (reservation: any) => void;
  onDelete?: (reservation: any) => void;
}

interface StoredGuest {
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  class: 'TYE' | 'MOW';
  /** May be missing for Cloudbeds-only kiosk checkouts (no kiosk arrival record). */
  checkInTime?: string;
  checkOutTime?: string;
  cloudbedsGuestID?: string;
  cloudbedsReservationID?: string;
  roomNumber?: string;
  _serverId?: string;
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
  checkInDate: string;
  checkInTime: string;
  checkInIso: string;
  checkOutDate: string;
  checkOutTime: string;
  checkOutIso: string;
  status: 'checked_in' | 'checked_out';
  cloudbedsReservationID?: string;
  cloudbedsGuestID?: string;
  rawData: StoredGuest;
}

interface EditGuestForm {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  clcNumber: string;
  class: 'TYE' | 'MOW';
  roomNumber: string;
}

interface RoomDirectoryEntry {
  roomID: string;
  roomName: string;
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

const SERVER_DATE_WINDOW_DAYS = 14;
const SERVER_RECORD_LIMIT = 250;
const SERVER_POLL_MS = 480_000;

function isoToLocalYmd(iso: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return localYmd(d);
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
  const headers = ['Name', 'CLC Number', 'Class', 'Phone', 'Room', 'Status', 'Check-In Date', 'Check-In Time', 'Check-Out Date', 'Check-Out Time', 'Reservation ID'];
  const lines = [
    headers.join(','),
    ...rows.map(r => [
      `"${r.guestName}"`,
      r.clcNumber,
      r.class,
      r.phoneNumber,
      r.roomNumber || '',
      r.status === 'checked_out' ? 'Checked Out' : 'Checked In',
      `"${r.checkInDate}"`,
      `"${r.checkInTime}"`,
      `"${r.checkOutDate}"`,
      `"${r.checkOutTime}"`,
      r.cloudbedsReservationID || '',
    ].join(','))
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `departures-${label}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

function confirmDeleteWithPhrase(message: string): boolean {
  const typed = prompt(`${message}\n\nEnter the passcode:`);
  if (typed === null) return false;
  if ((typed ?? '').trim().toLowerCase() !== 'gj') {
    alert('Deletion cancelled. Passcode did not match.');
    return false;
  }
  return true;
}

const AVATAR_COLORS = ['#667eea', '#764ba2', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4'];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function guestToRow(
  g: StoredGuest,
  stableKey: string,
  prefix: string,
  roomNameById: Record<string, string>
): Row {
  const checkInIso = g.checkInTime || '';
  return {
    id: `${prefix}:${stableKey}`,
    guestName: `${g.firstName} ${g.lastName}`.trim() || 'Guest',
    firstName: g.firstName,
    lastName: g.lastName,
    clcNumber: g.clcNumber || '—',
    phoneNumber: g.phoneNumber || '—',
    class: g.class || '—',
    roomNumber: resolveRoomNumberLabel(g.roomNumber, roomNameById),
    checkInDate: checkInIso ? fmtDate(checkInIso) : '—',
    checkInTime: checkInIso ? fmtTime(checkInIso) : '—',
    checkInIso,
    checkOutDate: g.checkOutTime ? fmtDate(g.checkOutTime) : '—',
    checkOutTime: g.checkOutTime ? fmtTime(g.checkOutTime) : '—',
    checkOutIso: g.checkOutTime || '',
    status: g.checkOutTime ? 'checked_out' : 'checked_in',
    cloudbedsReservationID: g.cloudbedsReservationID,
    cloudbedsGuestID: g.cloudbedsGuestID,
    rawData: g,
  };
}

function guestDedupeKey(g: StoredGuest): string {
  if (g.cloudbedsReservationID) return `res:${g.cloudbedsReservationID}`;
  if (g.checkInTime) return `time:${g.firstName}|${g.lastName}|${g.checkInTime}`;
  if (g.checkOutTime) return `out:${g.firstName}|${g.lastName}|${g.checkOutTime}`;
  return `name:${g.firstName}|${g.lastName}`;
}

function mergeGuestLists(local: StoredGuest[], server: StoredGuest[]): StoredGuest[] {
  const map = new Map<string, StoredGuest>();
  for (const g of local) map.set(guestDedupeKey(g), g);
  for (const g of server) map.set(guestDedupeKey(g), g); // server wins (has _serverId, fresh data)
  return Array.from(map.values());
}

export default function DeparturesTab({ onCheckOut, onDelete }: DeparturesTabProps) {
  const [checkedInGuests, setCheckedInGuests] = useState<StoredGuest[]>([]);
  const [checkOutHistory, setCheckOutHistory] = useState<StoredGuest[]>([]);
  const [roomNameById, setRoomNameById] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditGuestForm | null>(null);

  /** Activity date: check-outs that day; for “today” also all in-house (pending). */
  const [selectedDate, setSelectedDate] = useState<string>(() => localYmd(new Date()));

  const [exportFrom, setExportFrom] = useState(() => localYmd(new Date()));
  const [exportTo, setExportTo] = useState(() => localYmd(new Date()));
  const [showExportPanel, setShowExportPanel] = useState(false);
  /** When true, list is sorted by departure/check activity descending (latest at top). */
  const [newestFirst, setNewestFirst] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadLocal = () => {
      const g: StoredGuest[] = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
      const h: StoredGuest[] = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
      if (!cancelled) {
        setCheckedInGuests((prev) => mergeGuestLists(g, prev.filter((r) => r._serverId)));
        setCheckOutHistory((prev) => mergeGuestLists(h, prev.filter((r) => r._serverId)));
      }
    };

    const loadServer = async () => {
      try {
        const fromYmd = addCalendarDaysToYmd(selectedDate, -SERVER_DATE_WINDOW_DAYS);
        const toYmd = addCalendarDaysToYmd(selectedDate, SERVER_DATE_WINDOW_DAYS);
        const params = new URLSearchParams({
          from: fromYmd,
          to: toYmd,
          limit: String(SERVER_RECORD_LIMIT),
        });
        const res = await fetch(`/api/checkin-records?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data.success || !Array.isArray(data.records) || cancelled) return;

        const allRecords: StoredGuest[] = (data.records as any[]).map((r) => ({
          firstName: String(r.firstName ?? ''),
          lastName: String(r.lastName ?? ''),
          clcNumber: String(r.clcNumber ?? ''),
          phoneNumber: String(r.phoneNumber ?? ''),
          class: (r.class ?? 'TYE') as 'TYE' | 'MOW',
          checkInTime: r.checkInTime ? String(r.checkInTime) : undefined,
          checkOutTime: r.checkOutTime ? String(r.checkOutTime) : undefined,
          cloudbedsReservationID: r.cloudbedsReservationID ? String(r.cloudbedsReservationID) : undefined,
          cloudbedsGuestID: r.cloudbedsGuestID ? String(r.cloudbedsGuestID) : undefined,
          roomNumber: String(r.roomNumber ?? ''),
          _serverId: String(r.id),
        }));

        const active = allRecords.filter((r) => !r.checkOutTime);
        const history = allRecords.filter((r) => !!r.checkOutTime);

        const localGuests: StoredGuest[] = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
        const localHistory: StoredGuest[] = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');

        if (!cancelled) {
          setCheckedInGuests(mergeGuestLists(localGuests, active));
          setCheckOutHistory(mergeGuestLists(localHistory, history));
        }
      } catch {
        // Non-fatal — fall back to localStorage data
      }
    };

    loadLocal();
    loadServer();

    const localId = setInterval(loadLocal, 3000);
    const serverId = setInterval(loadServer, SERVER_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(localId);
      clearInterval(serverId);
    };
  }, [selectedDate]);

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
    const inRows = checkedInGuests.map((g) => guestToRow(g, guestDedupeKey(g), 'in', roomNameById));
    const outRows = checkOutHistory.map((g) => guestToRow(g, guestDedupeKey(g), 'out', roomNameById));
    return [...inRows, ...outRows];
  }, [checkedInGuests, checkOutHistory, roomNameById]);

  const dateFilteredRows = useMemo(() => {
    const todayYmd = localYmd(new Date());
    return rows.filter((r) => {
      if (r.status === 'checked_out') {
        return !!(r.checkOutIso && isoToLocalYmd(r.checkOutIso) === selectedDate);
      }
      // Pending (still in house): show only when viewing today — same idea as arrivals “today’s activity”.
      if (r.status === 'checked_in') {
        return selectedDate === todayYmd;
      }
      return false;
    });
  }, [rows, selectedDate]);

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return dateFilteredRows;
    const q = searchTerm.toLowerCase();
    return dateFilteredRows.filter(r =>
      r.guestName.toLowerCase().includes(q) ||
      r.clcNumber.toLowerCase().includes(q) ||
      r.phoneNumber.includes(q) ||
      r.roomNumber.toLowerCase().includes(q) ||
      (r.rawData.roomNumber || '').toLowerCase().includes(q)
    );
  }, [dateFilteredRows, searchTerm]);

  const sortedFilteredRows = useMemo(() => {
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const sortIso = (row: Row) => row.checkOutIso || row.checkInIso;
      const ta = new Date(sortIso(a)).getTime();
      const tb = new Date(sortIso(b)).getTime();
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
    if (selectedRow && !sortedFilteredRows.some((r) => r.id === selectedRow.id)) {
      setSelectedRow(null);
    }
  }, [sortedFilteredRows, selectedRow]);

  useEffect(() => {
    if (!selectedRow) {
      setIsEditing(false);
      setEditForm(null);
      return;
    }
    setEditForm({
      firstName: selectedRow.firstName || '',
      lastName: selectedRow.lastName || '',
      phoneNumber: selectedRow.phoneNumber === '—' ? '' : selectedRow.phoneNumber || '',
      clcNumber: selectedRow.clcNumber === '—' ? '' : selectedRow.clcNumber || '',
      class: selectedRow.class === 'MOW' ? 'MOW' : 'TYE',
      roomNumber: selectedRow.rawData.roomNumber || '',
    });
  }, [selectedRow]);

  const exportRows = useMemo(() => {
    if (!exportFrom || !exportTo) return rows;
    const from = new Date(exportFrom + 'T00:00:00');
    const to = new Date(exportTo + 'T23:59:59');
    return rows.filter(r => {
      const refIso = r.checkOutIso || r.checkInIso;
      return inDateRange(refIso, from, to);
    });
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
    const msg = row.status === 'checked_in'
      ? `Delete reservation for ${row.guestName}? This will also remove it from Cloudbeds.`
      : `${row.guestName} is already checked out. This will remove the record from this list and Cloudbeds if linked. Continue?`;
    if (!confirmDeleteWithPhrase(msg)) return;
    try {
      if (row.cloudbedsReservationID) {
        const res = await fetch(`/api/cloudbeds-delete?reservationID=${row.cloudbedsReservationID}`, { method: 'DELETE' });
        const result = await res.json();
        if (!result.success && !result.mockMode) throw new Error(result.error || 'Failed to delete from Cloudbeds');
      }
      if (row.rawData._serverId || row.cloudbedsReservationID) {
        const serverRes = await fetch('/api/checkin-records', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(row.rawData._serverId ? { id: row.rawData._serverId } : {}),
            ...(row.cloudbedsReservationID ? { reservationID: row.cloudbedsReservationID } : {}),
          }),
        });
        if (!serverRes.ok) {
          const data = await serverRes.json().catch(() => ({}));
          throw new Error(data?.error || 'Failed to remove check-in record');
        }
      }
      if (row.status === 'checked_in') {
        const isTargetActiveRecord = (g: StoredGuest) =>
          !!(
            row.rawData.cloudbedsReservationID &&
            g.cloudbedsReservationID &&
            g.cloudbedsReservationID === row.rawData.cloudbedsReservationID
          ) || (
            g.firstName === row.rawData.firstName &&
            g.lastName === row.rawData.lastName &&
            g.checkInTime === row.rawData.checkInTime
          );

        const stored: StoredGuest[] = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
        const next = stored.filter((g) => !isTargetActiveRecord(g));
        localStorage.setItem('checkedInGuests', JSON.stringify(next));
        setCheckedInGuests((prev) => prev.filter((g) => !isTargetActiveRecord(g)));
      } else {
        const stored: StoredGuest[] = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
        const next = stored.filter((g) => {
          if (
            row.rawData.cloudbedsReservationID &&
            g.cloudbedsReservationID === row.rawData.cloudbedsReservationID
          ) {
            return g.checkOutTime !== row.rawData.checkOutTime;
          }
          return !(
            g.firstName === row.rawData.firstName &&
            g.lastName === row.rawData.lastName &&
            g.checkInTime === row.rawData.checkInTime
          );
        });
        localStorage.setItem('checkOutHistory', JSON.stringify(next));
        setCheckOutHistory((prev) => prev.filter((g) => {
          if (
            row.rawData.cloudbedsReservationID &&
            g.cloudbedsReservationID === row.rawData.cloudbedsReservationID
          ) {
            return g.checkOutTime !== row.rawData.checkOutTime;
          }
          return !(
            g.firstName === row.rawData.firstName &&
            g.lastName === row.rawData.lastName &&
            g.checkInTime === row.rawData.checkInTime
          );
        }));
      }
      if (selectedRow?.id === row.id) setSelectedRow(null);
      if (onDelete) onDelete(row);
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedRow || !editForm) return;

    const nextGuest: StoredGuest = {
      ...selectedRow.rawData,
      firstName: editForm.firstName.trim(),
      lastName: editForm.lastName.trim(),
      phoneNumber: editForm.phoneNumber.trim(),
      clcNumber: editForm.clcNumber.trim(),
      class: editForm.class,
      roomNumber: editForm.roomNumber.trim(),
    };

    const matchGuest = (g: StoredGuest) => {
      if (
        selectedRow.rawData.cloudbedsReservationID &&
        g.cloudbedsReservationID === selectedRow.rawData.cloudbedsReservationID
      ) {
        return true;
      }
      return (
        g.firstName === selectedRow.rawData.firstName &&
        g.lastName === selectedRow.rawData.lastName &&
        g.checkInTime === selectedRow.rawData.checkInTime &&
        g.checkOutTime === selectedRow.rawData.checkOutTime
      );
    };

    if (selectedRow.status === 'checked_in') {
      const updated = checkedInGuests.map((g) => (matchGuest(g) ? nextGuest : g));
      setCheckedInGuests(updated);
      localStorage.setItem('checkedInGuests', JSON.stringify(updated));
    } else {
      const updated = checkOutHistory.map((g) => (matchGuest(g) ? nextGuest : g));
      setCheckOutHistory(updated);
      localStorage.setItem('checkOutHistory', JSON.stringify(updated));
    }

    setSelectedRow((prev) =>
      prev
        ? {
            ...prev,
            firstName: nextGuest.firstName,
            lastName: nextGuest.lastName,
            guestName: `${nextGuest.firstName} ${nextGuest.lastName}`.trim() || 'Guest',
            phoneNumber: nextGuest.phoneNumber || '—',
            clcNumber: nextGuest.clcNumber || '—',
            class: nextGuest.class || '—',
            roomNumber: resolveRoomNumberLabel(nextGuest.roomNumber, roomNameById),
            rawData: nextGuest,
          }
        : prev
    );

    setIsEditing(false);

    if (selectedRow.rawData._serverId || selectedRow.rawData.cloudbedsReservationID) {
      fetch('/api/checkin-records', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(selectedRow.rawData._serverId ? { id: selectedRow.rawData._serverId } : {}),
          ...(selectedRow.rawData.cloudbedsReservationID
            ? { reservationID: selectedRow.rawData.cloudbedsReservationID }
            : {}),
          firstName: nextGuest.firstName,
          lastName: nextGuest.lastName,
          phoneNumber: nextGuest.phoneNumber,
          clcNumber: nextGuest.clcNumber,
          class: nextGuest.class,
          roomNumber: nextGuest.roomNumber,
        }),
      }).catch(() => {});
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%', gap: 0 }}>
      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap', width: '100%' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#111', whiteSpace: 'nowrap' }}>
          Departures
          <span style={{ marginLeft: '8px', fontSize: '14px', fontWeight: 500, color: '#6b7280', background: '#f3f4f6', borderRadius: '12px', padding: '2px 10px' }}>
            {sortedFilteredRows.length}
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
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: showExportPanel ? '#8b5cf6' : '#f3f4f6', color: showExportPanel ? 'white' : '#374151', border: '1px solid #d1d5db', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
          >
            ↓ Export
          </button>
        </div>
      </div>

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
          aria-label={newestFirst ? 'Sort: latest departures first' : 'Sort: earliest departures first'}
          onClick={() => setNewestFirst((v) => !v)}
          title={newestFirst ? 'Showing latest first. Click for earliest first.' : 'Showing earliest first. Click for latest first.'}
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
            {exportRows.length} record{exportRows.length !== 1 ? 's' : ''}
            {exportFrom && exportTo ? ` · ${fmtDateRange(new Date(exportFrom + 'T00:00:00'), new Date(exportTo + 'T00:00:00'))}` : ''}
          </span>
          <button
            onClick={() => exportCSV(exportRows, `${exportFrom}-to-${exportTo}`)}
            disabled={exportRows.length === 0}
            style={{ padding: '7px 16px', background: exportRows.length > 0 ? '#8b5cf6' : '#e5e7eb', color: exportRows.length > 0 ? 'white' : '#9ca3af', border: 'none', borderRadius: '7px', cursor: exportRows.length > 0 ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: '13px' }}
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
            <div style={{ flex: '2 1 0', minWidth: '120px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Name</div>
            <div style={{ flex: '1 1 0', minWidth: '90px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>CLC Number</div>
            <div style={{ flex: '1 1 0', minWidth: '80px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Room</div>
            <div style={{ flex: '0.7 1 0', minWidth: '60px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Class</div>
            <div style={{ flex: '1.6 1 0', minWidth: '150px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Check-in</div>
            <div style={{ flex: '1.6 1 0', minWidth: '150px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Check-out</div>
            <div style={{ flex: '0.8 1 0', minWidth: '80px', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Status</div>
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
                    : 'No records for this date'}
                </div>
              </div>
            ) : (
              sortedFilteredRows.map((row, idx) => {
                const isSelected = selectedRow?.id === row.id;
                const isPending = row.status === 'checked_in';
                return (
                  <div
                    key={row.id}
                    onClick={() => setSelectedRow(isSelected ? null : row)}
                    style={{
                      display: 'flex', alignItems: 'center', padding: '10px 0',
                      borderBottom: idx < sortedFilteredRows.length - 1 ? '1px solid #f3f4f6' : 'none',
                      background: isSelected ? '#f5f0ff' : idx % 2 === 0 ? '#fff' : '#fafafa',
                      cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#faf5ff'; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#fafafa'; }}
                  >
                    {/* Avatar */}
                    <div style={{ width: '44px', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: avatarColor(row.guestName), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>
                        {initials(row.guestName)}
                      </div>
                    </div>

                    <div style={{ flex: '2 1 0', minWidth: '120px', padding: '0 12px' }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: '#111' }}>{row.guestName}</div>
                      <div style={{ fontSize: '12px', color: '#9ca3af' }}>Host: TYE</div>
                    </div>

                    <div style={{ flex: '1 1 0', minWidth: '90px', padding: '0 12px', fontSize: '14px', color: '#374151' }}>{row.clcNumber}</div>
                    <div style={{ flex: '1 1 0', minWidth: '80px', padding: '0 12px', fontSize: '14px', color: '#374151', fontWeight: 500 }}>{row.roomNumber}</div>
                    <div style={{ flex: '0.7 1 0', minWidth: '60px', padding: '0 12px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', background: '#fef3c7', color: '#92400e' }}>{row.class}</span>
                    </div>
                    <div style={{ flex: '1.6 1 0', minWidth: '150px', padding: '0 12px', fontSize: '13px', color: '#374151' }}>
                      <span style={{ whiteSpace: 'nowrap' }}>{row.checkInDate}</span>
                      <span style={{ color: '#9ca3af', margin: '0 4px' }}>·</span>
                      <span style={{ fontWeight: 600, color: '#111' }}>{row.checkInTime}</span>
                    </div>
                    <div style={{ flex: '1.6 1 0', minWidth: '150px', padding: '0 12px', fontSize: '13px', color: '#374151' }}>
                      {row.checkOutDate !== '—' ? (
                        <>
                          <span style={{ whiteSpace: 'nowrap' }}>{row.checkOutDate}</span>
                          <span style={{ color: '#9ca3af', margin: '0 4px' }}>·</span>
                          <span style={{ fontWeight: 600, color: '#111' }}>{row.checkOutTime}</span>
                        </>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </div>
                    <div style={{ flex: '0.8 1 0', minWidth: '80px', padding: '0 12px' }}>
                      {isPending ? (
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', background: '#fef3c7', color: '#92400e' }}>Pending</span>
                      ) : (
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', background: '#dbeafe', color: '#1e40af' }}>Signed Out</span>
                      )}
                    </div>

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
              {selectedRow.status === 'checked_out' ? (
                <span style={{ fontSize: '12px', fontWeight: 600, padding: '3px 10px', borderRadius: '12px', background: '#dbeafe', color: '#1e40af' }}>✓ Signed Out</span>
              ) : (
                <span style={{ fontSize: '12px', fontWeight: 600, padding: '3px 10px', borderRadius: '12px', background: '#fef3c7', color: '#92400e' }}>Pending Sign Out</span>
              )}
            </div>

            {isEditing && editForm ? (
              <>
                {[
                  { label: 'First Name', key: 'firstName' as const },
                  { label: 'Last Name', key: 'lastName' as const },
                  { label: 'Phone Number', key: 'phoneNumber' as const },
                  { label: 'CLC Number', key: 'clcNumber' as const },
                  { label: 'Room', key: 'roomNumber' as const },
                ].map(({ label, key }) => (
                  <div key={label}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
                    <input
                      value={editForm[key]}
                      onChange={(e) => setEditForm((prev) => (prev ? { ...prev, [key]: e.target.value } : prev))}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#374151' }}
                    />
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Class</div>
                  <select
                    value={editForm.class}
                    onChange={(e) => setEditForm((prev) => (prev ? { ...prev, class: e.target.value as 'TYE' | 'MOW' } : prev))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#374151' }}
                  >
                    <option value="TYE">TYE</option>
                    <option value="MOW">MOW</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                {[
                  { label: 'Full Name', value: selectedRow.guestName },
                  { label: 'Phone Number', value: selectedRow.phoneNumber },
                  { label: 'CLC Number', value: selectedRow.clcNumber },
                  { label: 'Room', value: selectedRow.roomNumber },
                  { label: 'Class', value: selectedRow.class },
                  { label: 'Signed In', value: `${selectedRow.checkInDate}, ${selectedRow.checkInTime}` },
                  { label: 'Signed Out', value: selectedRow.checkOutDate !== '—' ? `${selectedRow.checkOutDate}, ${selectedRow.checkOutTime}` : '—' },
                  ...(selectedRow.cloudbedsReservationID ? [{ label: 'Reservation ID', value: selectedRow.cloudbedsReservationID }] : []),
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
                    <div style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '14px', color: '#374151', background: '#fafafa', wordBreak: 'break-all' }}>{value}</div>
                  </div>
                ))}
              </>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              {isEditing ? (
                <>
                  <button
                    onClick={handleSaveEdit}
                    style={{ padding: '10px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
                  >
                    Save Changes
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    style={{ padding: '10px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  style={{ padding: '10px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
                >
                  Edit Guest
                </button>
              )}
              {selectedRow.status === 'checked_in' && (
                <button
                  onClick={() => onCheckOut({ ...selectedRow, rawData: selectedRow.rawData })}
                  style={{ padding: '10px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
                >
                  Sign Out
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
