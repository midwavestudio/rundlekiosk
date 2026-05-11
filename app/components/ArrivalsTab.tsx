'use client';

import { useState, useEffect, useMemo } from 'react';
import { resolveRoomNumberLabel } from '@/lib/room-display';
import {
  ADMIN_TEXT_PRIMARY,
  ADMIN_SURFACE_RAISED,
  ADMIN_BORDER_STRONG,
  ADMIN_INPUT_BG,
  ADMIN_ACCENT,
} from '../lib/adminTheme';

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
  /** Firestore document ID — present on records fetched from the server. */
  _serverId?: string;
}

interface Row {
  id: string;
  markKey: string;
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

/** Wider window than a single day so server merge still works when browsing nearby dates. */
const SERVER_DATE_WINDOW_DAYS = 14;
/**
 * Max Firestore document reads per poll (one read per doc returned).
 * ~900 check-ins/month can cluster in this window during busy stretches.
 */
const SERVER_RECORD_LIMIT = 250;
/**
 * Poll interval — tuned so worst-case reads stay under Firestore’s ~50k free reads/day
 * on Blaze (250 docs × 86400s / 480000ms ≈ 45k) with headroom for other API traffic.
 */
const SERVER_POLL_MS = 480_000;

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

function guestMatchKey(g: Pick<CheckedInGuest, 'firstName' | 'lastName' | 'checkInTime'>): string {
  return `${g.firstName}|${g.lastName}|${g.checkInTime}`;
}

/** Stable key for row-level "checked visually" UI state. */
function rowMarkKey(g: CheckedInGuest): string {
  if (g.cloudbedsReservationID) return `res:${g.cloudbedsReservationID}`;
  return `time:${guestMatchKey(g)}`;
}

/** Stable dedup key used to merge local + server records without duplicates.
 *
 * Two records represent the same check-in if and only if they share the same
 * Cloudbeds reservation ID, OR they share the same guest name + check-in
 * timestamp (the timestamp is always set at submission time so it is always
 * present). We intentionally do NOT fall back to name-only matching because
 * the same guest can legitimately check in more than once (different dates,
 * different rooms) and a name-only key would collapse those into one row.
 */
function guestDedupeKey(g: CheckedInGuest): string {
  if (g.cloudbedsReservationID) return `res:${g.cloudbedsReservationID}`;
  return `time:${g.firstName}|${g.lastName}|${g.checkInTime}`;
}

/**
 * Merge two guest arrays, preferring the record with more info (server record wins
 * when keys match because it has _serverId and up-to-date checkOutTime).
 */
function mergeGuestLists(
  local: CheckedInGuest[],
  server: CheckedInGuest[]
): CheckedInGuest[] {
  const map = new Map<string, CheckedInGuest>();
  for (const g of local) map.set(guestDedupeKey(g), g);
  // Server records win (have _serverId, fresher checkOutTime)
  for (const g of server) map.set(guestDedupeKey(g), g);
  return Array.from(map.values());
}

export default function ArrivalsTab({ onCheckIn, onDelete }: ArrivalsTabProps) {
  const [checkedInGuests, setCheckedInGuests] = useState<CheckedInGuest[]>([]);
  const [checkOutHistory, setCheckOutHistory] = useState<CheckedInGuest[]>([]);
  const [roomNameById, setRoomNameById] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditGuestForm | null>(null);
  const [creatingReservation, setCreatingReservation] = useState(false);
  const [createReservationResult, setCreateReservationResult] = useState<{ ok: boolean; message: string } | null>(null);

  /** Which calendar day’s check-ins to list (local) — defaults to today. */
  const [selectedDate, setSelectedDate] = useState<string>(() => localYmd(new Date()));

  const [exportFrom, setExportFrom] = useState(() => localYmd(new Date()));
  const [exportTo, setExportTo] = useState(() => localYmd(new Date()));
  const [showExportPanel, setShowExportPanel] = useState(false);
  /** When true, list is sorted by check-in time descending (latest at top). */
  const [newestFirst, setNewestFirst] = useState(true);
  /** Visual-only "already checked by me" marker, grouped by selected date. */
  const [mutedRowsByDate, setMutedRowsByDate] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem('arrivalsMutedRowsByDate');
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    let cancelled = false;

    const loadLocal = () => {
      const g: CheckedInGuest[] = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
      const h: CheckedInGuest[] = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
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

        const allRecords: CheckedInGuest[] = (data.records as any[]).map((r) => ({
          firstName: String(r.firstName ?? ''),
          lastName: String(r.lastName ?? ''),
          clcNumber: String(r.clcNumber ?? ''),
          phoneNumber: String(r.phoneNumber ?? ''),
          class: (r.class ?? 'TYE') as 'TYE' | 'MOW',
          checkInTime: String(r.checkInTime ?? ''),
          checkOutTime: r.checkOutTime ? String(r.checkOutTime) : undefined,
          cloudbedsReservationID: r.cloudbedsReservationID ? String(r.cloudbedsReservationID) : undefined,
          cloudbedsGuestID: r.cloudbedsGuestID ? String(r.cloudbedsGuestID) : undefined,
          roomNumber: String(r.roomNumber ?? ''),
          ...(r.id != null && String(r.id).trim() !== '' ? { _serverId: String(r.id) } : {}),
        }));

        const active = allRecords.filter((r) => !r.checkOutTime);
        const history = allRecords.filter((r) => !!r.checkOutTime);

        // Merge: local-only records (no _serverId, not yet synced) kept alongside server records
        const localGuests: CheckedInGuest[] = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
        const localHistory: CheckedInGuest[] = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');

        if (!cancelled) {
          setCheckedInGuests(mergeGuestLists(localGuests, active));
          setCheckOutHistory(mergeGuestLists(localHistory, history));
        }
      } catch {
        // Non-fatal — fall back to localStorage data
      }
    };

    // Initial load: local first (instant), then server
    loadLocal();
    loadServer();

    // Local: 3s; server: wide date window + low limit to avoid Firestore quota exhaustion
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
    // Build checkout history dedup keys so stale localStorage "active" records
    // that the server has already moved to history (with checkOutTime) are shown
    // as checked-out rather than appearing twice or hiding the checkout time.
    const historyKeys = new Set(checkOutHistory.map((g) => guestDedupeKey(g)));

    // Filter active guests: exclude any whose key already appears in history (server won).
    const activeGuests = checkedInGuests.filter((g) => !historyKeys.has(guestDedupeKey(g)));

    // Use the same dedup key as mergeGuestLists so that a guest who appears in both
    // checkedInGuests (stale localStorage) and checkOutHistory (server-updated record with
    // checkOutTime) is correctly shown as checked-out rather than silently suppressed.
    const activeKeys = new Set(activeGuests.map((g) => guestDedupeKey(g)));
    const historyGuests = checkOutHistory.filter((g) => !activeKeys.has(guestDedupeKey(g)));

    const toRow = (g: CheckedInGuest, id: string, fromHistory: boolean): Row => ({
      id,
      markKey: rowMarkKey(g),
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

    const activeRows = activeGuests.map((g, i) => toRow(g, `guest-${i}`, false));
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
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rowsForSelectedDate;
    // When a search term is active, search across all loaded dates so guests can be found
    // regardless of which day is selected in the date picker.
    return rows.filter(r =>
      r.guestName.toLowerCase().includes(q) ||
      r.clcNumber.toLowerCase().includes(q) ||
      r.phoneNumber.includes(q) ||
      r.roomNumber.toLowerCase().includes(q) ||
      (r.rawData.roomNumber || '').toLowerCase().includes(q)
    );
  }, [rows, rowsForSelectedDate, searchTerm]);

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

  const mutedMarkKeySet = useMemo(
    () => new Set(mutedRowsByDate[selectedDate] ?? []),
    [mutedRowsByDate, selectedDate]
  );

  const toggleMutedRow = (markKey: string) => {
    setMutedRowsByDate((prev) => {
      const current = new Set(prev[selectedDate] ?? []);
      if (current.has(markKey)) current.delete(markKey);
      else current.add(markKey);
      const next = { ...prev, [selectedDate]: Array.from(current) };
      try {
        localStorage.setItem('arrivalsMutedRowsByDate', JSON.stringify(next));
      } catch {
        // Non-fatal: visual marker remains for this session.
      }
      return next;
    });
  };

  const resetMutedRows = () => {
    setMutedRowsByDate((prev) => {
      if (!prev[selectedDate]?.length) return prev;
      const next = { ...prev, [selectedDate]: [] };
      try {
        localStorage.setItem('arrivalsMutedRowsByDate', JSON.stringify(next));
      } catch {
        // Ignore storage errors; in-memory state is still reset.
      }
      return next;
    });
  };

  useEffect(() => {
    if (selectedRow && !filteredRows.some((r) => r.id === selectedRow.id)) {
      setSelectedRow(null);
    }
  }, [filteredRows, selectedRow]);

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
      ? `${row.guestName} is already checked out. This will remove the record from this list. Continue?`
      : `Delete reservation for ${row.guestName}? This will also remove it from Cloudbeds.`;
    if (!confirmDeleteWithPhrase(msg)) return;
    try {
      if (!row.fromHistory && row.cloudbedsReservationID) {
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
            firstName: row.rawData.firstName,
            lastName: row.rawData.lastName,
            checkInTime: row.rawData.checkInTime,
            checkInDate: row.checkInDate,
          }),
        });
        if (!serverRes.ok) {
          const data = await serverRes.json().catch(() => ({}));
          throw new Error(data?.error || 'Failed to remove check-in record');
        }
      }
      if (row.fromHistory) {
        const isTargetHistoryRecord = (g: CheckedInGuest) => {
          if (
            row.rawData.cloudbedsReservationID &&
            g.cloudbedsReservationID === row.rawData.cloudbedsReservationID
          ) {
            return g.checkOutTime === row.rawData.checkOutTime;
          }
          return (
            g.firstName === row.rawData.firstName &&
            g.lastName === row.rawData.lastName &&
            g.checkInTime === row.rawData.checkInTime &&
            g.checkOutTime === row.rawData.checkOutTime
          );
        };

        const history: CheckedInGuest[] = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
        const updatedHistory = history.filter((g) => !isTargetHistoryRecord(g));
        localStorage.setItem('checkOutHistory', JSON.stringify(updatedHistory));
        setCheckOutHistory((prev) => prev.filter((g) => !isTargetHistoryRecord(g)));
      } else {
        const isTargetActiveRecord = (g: CheckedInGuest) =>
          !!(
            row.rawData.cloudbedsReservationID &&
            g.cloudbedsReservationID &&
            g.cloudbedsReservationID === row.rawData.cloudbedsReservationID
          ) || (
            g.firstName === row.rawData.firstName &&
            g.lastName === row.rawData.lastName &&
            g.checkInTime === row.rawData.checkInTime
          );

        const stored: CheckedInGuest[] = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
        const updatedStored = stored.filter((g) => !isTargetActiveRecord(g));
        localStorage.setItem('checkedInGuests', JSON.stringify(updatedStored));
        setCheckedInGuests((prev) => prev.filter((g) => !isTargetActiveRecord(g)));
      }
      if (selectedRow?.id === row.id) setSelectedRow(null);
      if (onDelete) onDelete(row);
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedRow || !editForm) return;

    const nextGuest: CheckedInGuest = {
      ...selectedRow.rawData,
      firstName: editForm.firstName.trim(),
      lastName: editForm.lastName.trim(),
      phoneNumber: editForm.phoneNumber.trim(),
      clcNumber: editForm.clcNumber.trim(),
      class: editForm.class,
      roomNumber: editForm.roomNumber.trim(),
    };

    const matchGuest = (g: CheckedInGuest) => {
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

    if (selectedRow.fromHistory) {
      const updated = checkOutHistory.map((g) => (matchGuest(g) ? nextGuest : g));
      setCheckOutHistory(updated);
      localStorage.setItem('checkOutHistory', JSON.stringify(updated));
    } else {
      const updated = checkedInGuests.map((g) => (matchGuest(g) ? nextGuest : g));
      setCheckedInGuests(updated);
      localStorage.setItem('checkedInGuests', JSON.stringify(updated));
    }

    setSelectedRow((prev) =>
      prev
        ? {
            ...prev,
            firstName: nextGuest.firstName,
            lastName: nextGuest.lastName,
            guestName: `${nextGuest.firstName} ${nextGuest.lastName}`.trim(),
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

  /** Create a Cloudbeds reservation for a guest who checked in but didn't get one. */
  const handleCreateCloudbedsReservation = async (row: Row) => {
    if (creatingReservation) return;
    setCreatingReservation(true);
    setCreateReservationResult(null);
    try {
      const checkInDateYmd = row.rawData.checkInTime
        ? localYmd(new Date(row.rawData.checkInTime))
        : localYmd(new Date());
      const checkOutDateYmd = (() => {
        const d = new Date(checkInDateYmd);
        d.setDate(d.getDate() + 1);
        return localYmd(d);
      })();

      // Use the room number from the record. It may be a room name or ID.
      const roomName = row.rawData.roomNumber || row.roomNumber || '';
      const forceUnassigned = !roomName || roomName.toLowerCase() === 'unassigned';

      const body: Record<string, unknown> = {
        firstName: row.firstName,
        lastName: row.lastName,
        phoneNumber: row.phoneNumber,
        clcNumber: row.clcNumber,
        classType: row.class || 'TYE',
        checkInDate: checkInDateYmd,
        checkOutDate: checkOutDateYmd,
        ...(forceUnassigned
          ? { roomName: 'UNASSIGNED', forceUnassigned: true }
          : { roomName, roomNameHint: roomName }),
      };

      const res = await fetch('/api/cloudbeds-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        const reservationID = data.reservationID as string | undefined;

        // Patch the Firestore record with the new reservation ID
        if (reservationID) {
          const patchBody: Record<string, unknown> = {
            cloudbedsReservationID: reservationID,
            ...(data.guestID ? { cloudbedsGuestID: data.guestID } : {}),
            ...(data.reservationStatus ? { reservationStatus: data.reservationStatus } : {}),
          };
          if (row.rawData._serverId) {
            patchBody.id = row.rawData._serverId;
          } else if (row.rawData.cloudbedsReservationID) {
            patchBody.reservationID = row.rawData.cloudbedsReservationID;
          } else {
            // No existing ID — use name + date to find the record
            patchBody.firstName = row.firstName;
            patchBody.lastName = row.lastName;
            patchBody.checkInDate = checkInDateYmd;
          }
          fetch('/api/checkin-records', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchBody),
          }).catch(() => {});

          // Update local state so the UI reflects the new reservation ID
          const updateGuest = (g: CheckedInGuest): CheckedInGuest => {
            const nameMatch = g.firstName === row.firstName && g.lastName === row.lastName;
            const timeMatch = g.checkInTime === row.rawData.checkInTime;
            if (!nameMatch || !timeMatch) return g;
            return { ...g, cloudbedsReservationID: reservationID, cloudbedsGuestID: data.guestID ?? g.cloudbedsGuestID };
          };
          setCheckedInGuests((prev) => prev.map(updateGuest));
          setSelectedRow((prev) =>
            prev && prev.id === row.id
              ? { ...prev, cloudbedsReservationID: reservationID, rawData: updateGuest(prev.rawData) }
              : prev
          );
        }

        setCreateReservationResult({
          ok: true,
          message: reservationID
            ? `Reservation created: ${reservationID}${data.reservationStatus === 'confirmed' ? ' (confirmed, unassigned — staff must assign room in Cloudbeds)' : ''}`
            : 'Reservation created in Cloudbeds.',
        });
      } else {
        setCreateReservationResult({
          ok: false,
          message: typeof data.error === 'string' ? data.error : 'Failed to create reservation in Cloudbeds.',
        });
      }
    } catch (err: any) {
      setCreateReservationResult({ ok: false, message: err?.message ?? 'Network error' });
    } finally {
      setCreatingReservation(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%', gap: 0 }}>
      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap', width: '100%' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: ADMIN_TEXT_PRIMARY, whiteSpace: 'nowrap' }}>
          Arrivals
          <span style={{ marginLeft: '8px', fontSize: '14px', fontWeight: 600, color: ADMIN_ACCENT, background: ADMIN_SURFACE_RAISED, border: `1px solid ${ADMIN_BORDER_STRONG}`, borderRadius: '12px', padding: '2px 10px' }}>
            {filteredRows.length}
          </span>
        </h2>

        <input
          type="text"
          placeholder="Search name, CLC, phone, room…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ flex: '1 1 200px', minWidth: '160px', padding: '8px 12px', border: `1px solid ${ADMIN_BORDER_STRONG}`, borderRadius: '8px', fontSize: '14px', background: ADMIN_INPUT_BG, color: ADMIN_TEXT_PRIMARY }}
        />

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={toggleExportPanel}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: showExportPanel ? '#667eea' : ADMIN_SURFACE_RAISED, color: showExportPanel ? 'white' : ADMIN_TEXT_PRIMARY, border: `1px solid ${ADMIN_BORDER_STRONG}`, borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
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
        <button
          type="button"
          onClick={resetMutedRows}
          disabled={!mutedRowsByDate[selectedDate]?.length}
          title="Reset checked row highlight markers"
          style={{
            padding: '8px 14px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            background: mutedRowsByDate[selectedDate]?.length ? '#fff' : '#f3f4f6',
            cursor: mutedRowsByDate[selectedDate]?.length ? 'pointer' : 'not-allowed',
            fontWeight: 600,
            fontSize: '13px',
            color: mutedRowsByDate[selectedDate]?.length ? '#374151' : '#9ca3af',
          }}
        >
          Reset Row Marks
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
                    ? 'No guests match your search'
                    : 'No check-ins for this date'}
                </div>
              </div>
            ) : (
              sortedFilteredRows.map((row, idx) => {
                const isSelected = selectedRow?.id === row.id;
                const isMuted = mutedMarkKeySet.has(row.markKey);
                const rowBackground = isMuted
                  ? '#e5e7eb'
                  : isSelected
                    ? '#eef2ff'
                    : idx % 2 === 0
                      ? '#fff'
                      : '#fafafa';
                const primaryText = isMuted ? '#6b7280' : '#111';
                const secondaryText = isMuted ? '#9ca3af' : '#374151';
                return (
                  <div
                    key={row.id}
                    style={{
                      display: 'flex', alignItems: 'center', padding: '10px 0',
                      borderBottom: idx < sortedFilteredRows.length - 1 ? '1px solid #f3f4f6' : 'none',
                      background: rowBackground,
                      cursor: 'default', transition: 'background 0.15s',
                      opacity: isMuted ? 0.8 : 1,
                    }}
                    onClick={() => toggleMutedRow(row.markKey)}
                  >
                    {/* Avatar */}
                    <div style={{ width: '44px', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: avatarColor(row.guestName), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, opacity: isMuted ? 0.65 : 1 }}>
                        {initials(row.guestName)}
                      </div>
                    </div>

                    {/* Name + Host */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRow(isSelected ? null : row);
                        setCreateReservationResult(null);
                      }}
                      style={{ flex: '2 1 0', minWidth: '120px', padding: '0 12px', cursor: 'pointer' }}
                      title="Open guest details"
                    >
                      <div style={{ fontWeight: 600, fontSize: '14px', color: primaryText }}>{row.guestName}</div>
                      <div style={{ fontSize: '12px', color: '#9ca3af' }}>Host: TYE</div>
                    </div>

                    <div style={{ flex: '1 1 0', minWidth: '90px', padding: '0 12px', fontSize: '14px', color: secondaryText }}>{row.clcNumber}</div>
                    <div style={{ flex: '1 1 0', minWidth: '80px', padding: '0 12px', fontSize: '14px', color: secondaryText, fontWeight: 500 }}>{row.roomNumber}</div>
                    <div style={{ flex: '1.5 1 0', minWidth: '140px', padding: '0 12px', fontSize: '13px', color: secondaryText }}>
                      <span style={{ whiteSpace: 'nowrap' }}>{row.checkInDate}</span>
                      <span style={{ color: '#9ca3af', margin: '0 4px' }}>·</span>
                      <span style={{ fontWeight: 600, color: primaryText }}>{row.checkInTime}</span>
                    </div>
                    <div style={{ flex: '1.5 1 0', minWidth: '140px', padding: '0 12px', fontSize: '13px', color: secondaryText }}>
                      {row.checkOutIso ? (
                        <>
                          <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(row.checkOutIso)}</span>
                          <span style={{ color: '#9ca3af', margin: '0 4px' }}>·</span>
                          <span style={{ fontWeight: 600, color: primaryText }}>{fmtTime(row.checkOutIso)}</span>
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

              {/* Create Cloudbeds reservation for guests who are missing one */}
              {!selectedRow.fromHistory && !selectedRow.cloudbedsReservationID && !isEditing && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button
                    onClick={() => {
                      setCreateReservationResult(null);
                      handleCreateCloudbedsReservation(selectedRow);
                    }}
                    disabled={creatingReservation}
                    style={{
                      padding: '10px',
                      background: creatingReservation ? '#9ca3af' : '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: creatingReservation ? 'not-allowed' : 'pointer',
                      fontWeight: 600,
                      fontSize: '14px',
                    }}
                  >
                    {creatingReservation ? 'Creating Reservation…' : 'Create Cloudbeds Reservation'}
                  </button>
                  {createReservationResult && (
                    <div style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 500,
                      background: createReservationResult.ok ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${createReservationResult.ok ? '#86efac' : '#fca5a5'}`,
                      color: createReservationResult.ok ? '#15803d' : '#991b1b',
                      wordBreak: 'break-all',
                    }}>
                      {createReservationResult.message}
                    </div>
                  )}
                </div>
              )}

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
