'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ADMIN_ACCENT,
  ADMIN_GRADIENT,
  ADMIN_TINT_BG,
  ADMIN_TINT_BORDER,
  ADMIN_TINT_SOLID,
  ADMIN_TINT_TEXT,
} from '../lib/adminTheme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AvailableRoom {
  roomID: string;
  roomName: string;
  roomTypeName: string;
  /** Present when already has a placeholder reservation */
  placeholderReservationID?: string;
}

interface Placeholder {
  id: string;
  reservationID: string;
  roomID: string;
  roomName: string;
  roomTypeName: string;
  forDate: string;
  checkOutDate: string;
  status: 'available' | 'assigned' | 'externally_modified' | 'cancelled';
  createdAt: string;
  assignedAt?: string;
  lastSyncedAt?: string;
  cloudbedsStatus?: string;
}

interface PlaceholderSummary {
  success: boolean;
  today: string;
  tomorrow: string;
  placeholders: Placeholder[];
  counts: { available: number; assigned: number; externally_modified: number; cancelled: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  available: '#16a34a',
  assigned: '#2563eb',
  externally_modified: '#d97706',
  cancelled: '#dc2626',
};

const STATUS_LABELS: Record<string, string> = {
  available: 'Avail.',
  assigned: 'Assigned',
  externally_modified: 'External',
  cancelled: 'Cancel.',
};

function normalizeRoomTypeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Room classes omitted from the Blocks picker (matches Cloudbeds labels; casing-insensitive). */
function isExcludedFromBlockPicker(roomTypeName: string): boolean {
  const n = normalizeRoomTypeName(roomTypeName);
  return (
    n === 'queen' ||
    n === 'interior queen' ||
    n === 'interior single king' ||
    n === 'interior double queen' ||
    n === 'conference room' ||
    n.startsWith('copper suite') ||
    n.startsWith('silver suite')
  );
}

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateHeading(ymd: string, today: string, tomorrow: string): string {
  if (ymd === today) return `Today (${ymd})`;
  if (ymd === tomorrow) return `Tomorrow (${ymd})`;
  try {
    return (
      new Date(ymd + 'T12:00:00').toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }) + ` (${ymd})`
    );
  } catch {
    return ymd;
  }
}

function buildDateQuery(forDate: string): string {
  if (!forDate.trim()) return '';
  const params = new URLSearchParams();
  params.append('date', forDate);
  return `?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TyePlaceholdersTab() {
  // Placeholder store data
  const [summary, setSummary] = useState<PlaceholderSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Room picker state
  const [allRooms, setAllRooms] = useState<AvailableRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [selectedRoomIDs, setSelectedRoomIDs] = useState<Set<string>>(new Set());
  const [roomFilter, setRoomFilter] = useState('');

  /** Single YYYY-MM-DD date for blocks (default: today once server date is known). */
  const initialClientToday = useRef(localYmd(new Date()));
  const [selectedBlockDate, setSelectedBlockDate] = useState<string>(() => initialClientToday.current);
  const serverTodaySynced = useRef(false);

  // Action state
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  /** Per-room/date failures from the last Block action (API summary.failed). */
  const [blockFailures, setBlockFailures] = useState<
    Array<{ date: string; room: string; error: string }>
  >([]);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      // POST runs a Cloudbeds sync first so deleted / cancelled reservations clear stale checkmarks.
      const res = await fetch(
        `/api/admin/sync-tye-placeholders${buildDateQuery(selectedBlockDate)}`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (data.success) setSummary(data);
      else setError(data.error ?? 'Failed to load placeholder summary');
    } catch (err: any) {
      setError(err?.message ?? 'Network error loading summary');
    } finally {
      setLoadingSummary(false);
    }
  }, [selectedBlockDate]);

  /**
   * Selected block date drives availability: same rules as the kiosk
   * (/api/available-rooms) — rooms that are checked-in / in-house are excluded.
   */
  const availabilityDate = selectedBlockDate.trim() || initialClientToday.current;

  const fetchRooms = useCallback(async () => {
    setLoadingRooms(true);
    try {
      const qs = new URLSearchParams();
      qs.set('date', availabilityDate);
      const res = await fetch(`/api/available-rooms?${qs.toString()}`);
      const data = await res.json();
      if (data.rooms) {
        setAllRooms(data.rooms as AvailableRoom[]);
      } else {
        setError(data.error ?? 'Failed to load rooms');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Network error loading rooms');
    } finally {
      setLoadingRooms(false);
    }
  }, [availabilityDate]);

  useEffect(() => {
    fetchSummary();
    fetchRooms();
  }, [fetchSummary, fetchRooms]);

  useEffect(() => {
    if (!summary?.today || serverTodaySynced.current) return;
    setSelectedBlockDate((prev) =>
      prev === initialClientToday.current ? summary.today : prev
    );
    serverTodaySynced.current = true;
  }, [summary?.today]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const today = summary?.today ?? '';
  const tomorrow = summary?.tomorrow ?? '';
  const placeholders = useMemo(
    () => summary?.placeholders ?? [],
    [summary?.placeholders]
  );
  const counts = summary?.counts ?? { available: 0, assigned: 0, externally_modified: 0, cancelled: 0 };

  /**
   * Rooms that still count as an active "block" for the grid checkmark.
   * Exclude cancelled (removed in Cloudbeds / store) and assigned (guest already picked up the room).
   */
  const blockedByDate = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const p of placeholders) {
      if (p.status === 'cancelled' || p.status === 'assigned') continue;
      const set = m.get(p.forDate) ?? new Set<string>();
      set.add(String(p.roomID));
      m.set(p.forDate, set);
    }
    return m;
  }, [placeholders]);

  const placeholderDatesSorted = useMemo(() => {
    const s = new Set(placeholders.map((p) => p.forDate));
    return [...s].sort();
  }, [placeholders]);

  /** Today / tomorrow, selected block date, and any date that already has placeholder rows. */
  const tableSectionDates = useMemo(() => {
    const s = new Set<string>(placeholderDatesSorted);
    if (today) s.add(today);
    if (tomorrow) s.add(tomorrow);
    if (selectedBlockDate.trim()) s.add(selectedBlockDate.trim());
    return [...s].sort();
  }, [placeholderDatesSorted, today, tomorrow, selectedBlockDate]);

  const eligibleRooms = useMemo(
    () => allRooms.filter((r) => !isExcludedFromBlockPicker(r.roomTypeName)),
    [allRooms]
  );

  const filteredRooms = eligibleRooms.filter((r) => {
    if (!roomFilter.trim()) return true;
    const q = roomFilter.toLowerCase();
    return (
      r.roomName.toLowerCase().includes(q) ||
      r.roomTypeName.toLowerCase().includes(q)
    );
  });

  /** Cloudbeds room types as section headers; rooms sorted naturally within each type. */
  const roomsByTypeSections = useMemo(() => {
    const grouped: Record<string, AvailableRoom[]> = {};
    for (const room of filteredRooms) {
      const type = room.roomTypeName || 'Other';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(room);
    }
    return Object.keys(grouped)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((typeName) => {
        const rooms = grouped[typeName]
          .slice()
          .sort((a, b) =>
            String(a.roomName).localeCompare(String(b.roomName), undefined, {
              numeric: true,
              sensitivity: 'base',
            })
          );
        return { typeName, rooms };
      });
  }, [filteredRooms]);

  const totalSelected = selectedRoomIDs.size;
  const allFilteredSelected =
    filteredRooms.length > 0 &&
    filteredRooms.every((r) => selectedRoomIDs.has(String(r.roomID)));

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const toggleRoom = (roomID: string) => {
    const key = String(roomID);
    setSelectedRoomIDs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setError('');
    setStatusMessage('');
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedRoomIDs((prev) => {
        const next = new Set(prev);
        filteredRooms.forEach((r) => next.delete(String(r.roomID)));
        return next;
      });
    } else {
      setSelectedRoomIDs((prev) => {
        const next = new Set(prev);
        filteredRooms.forEach((r) => next.add(String(r.roomID)));
        return next;
      });
    }
  };

  /** Bulk select / deselect every room in one Cloudbeds room-type section (respects current filter). */
  const toggleSelectRoomsInType = (roomsInSection: AvailableRoom[]) => {
    if (roomsInSection.length === 0) return;
    const allInSectionSelected = roomsInSection.every((r) =>
      selectedRoomIDs.has(String(r.roomID))
    );
    setSelectedRoomIDs((prev) => {
      const next = new Set(prev);
      if (allInSectionSelected) {
        roomsInSection.forEach((r) => next.delete(String(r.roomID)));
      } else {
        roomsInSection.forEach((r) => next.add(String(r.roomID)));
      }
      return next;
    });
    setError('');
    setStatusMessage('');
  };

  const handleCreate = async () => {
    if (!selectedBlockDate.trim()) {
      setError('Select a date to block.');
      return;
    }
    if (selectedRoomIDs.size === 0) {
      setError('Select at least one room to block.');
      return;
    }
    setCreating(true);
    setStatusMessage('');
    setError('');
    setBlockFailures([]);
    try {
      // performCloudbedsCheckIn matches rooms by name (not by numeric ID).
      // We send roomNames as the primary key so the create API can find each room
      // in the full Cloudbeds room list, and include the roomID as a secondary hint.
      const selectedRoomEntries = Array.from(selectedRoomIDs).map((id) => {
        const room = allRooms.find((r) => String(r.roomID) === id);
        return { roomID: id, roomName: room?.roomName ?? id };
      });

      const res = await fetch('/api/admin/create-tye-placeholders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Primary: room names (what performCloudbedsCheckIn uses to find rooms)
          roomIDs: selectedRoomEntries.map((e) => e.roomName),
          dates: [selectedBlockDate.trim()],
          // Secondary: numeric room IDs as hints for room matching
          roomHints: Object.fromEntries(
            selectedRoomEntries.map((e) => [e.roomName, e.roomID] as const)
          ),
        }),
      });
      const raw = await res.text();
      let data: Record<string, any> = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        setError(raw.slice(0, 200) || `Invalid response (${res.status})`);
        return;
      }

      if (!res.ok) {
        setError(
          typeof data.error === 'string'
            ? data.error
            : `Request failed (${res.status}). Check Cloudbeds credentials on the server.`
        );
        return;
      }

      const failedRows: Array<{ date: string; room: string; error: string }> = [];
      if (data.summary && typeof data.summary === 'object') {
        for (const [dateStr, day] of Object.entries(data.summary) as [string, any][]) {
          if (day?.failed?.length) {
            for (const f of day.failed) {
              failedRows.push({
                date: dateStr,
                room: String(f.roomID),
                error: String(f.error ?? 'Unknown error'),
              });
            }
          }
        }
      }
      setBlockFailures(failedRows);

      if ((data.totalCreated ?? 0) > 0) {
        setStatusMessage(
          `Done — created ${data.totalCreated} placeholder reservation(s) in Cloudbeds.` +
            (data.totalSkipped > 0 ? ` Skipped ${data.totalSkipped} (already blocked).` : '') +
            (data.totalFailed > 0 ? ` ${data.totalFailed} could not be created.` : '')
        );
        if (failedRows.length === 0) {
          setSelectedRoomIDs(new Set());
        }
        await Promise.all([fetchSummary(), fetchRooms()]);
      } else if ((data.totalFailed ?? 0) > 0 || failedRows.length > 0) {
        setError(
          failedRows.length > 0
            ? ''
            : data.error ?? 'No reservations were created. See server logs or verify Cloudbeds API access.'
        );
      } else if ((data.totalSkipped ?? 0) > 0) {
        setStatusMessage(`All selected rooms were already blocked (${data.totalSkipped}). Nothing new to create.`);
        await Promise.all([fetchSummary(), fetchRooms()]);
      } else {
        setError(
          data.error ?? 'No reservations were created. Verify CLOUDBEDS_API_KEY and property settings.'
        );
      }
    } catch (err: any) {
      setError(err?.message ?? 'Network error');
    } finally {
      setCreating(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setStatusMessage('');
    setError('');
    setBlockFailures([]);
    try {
      const res = await fetch(
        `/api/admin/sync-tye-placeholders${buildDateQuery(selectedBlockDate)}`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (data.success) {
        setStatusMessage(
          data.changes?.length > 0
            ? `Sync complete — ${data.changes.length} placeholder(s) updated.`
            : `Sync complete — all ${data.synced ?? 0} placeholder(s) are up to date.`
        );
        if (data.placeholders && data.counts) {
          setSummary({
            success: true,
            today: data.today,
            tomorrow: data.tomorrow,
            placeholders: data.placeholders,
            counts: data.counts,
          });
        }
        await fetchRooms();
      } else {
        setError(data.error ?? 'Sync failed');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Network error');
    } finally {
      setSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isLoading = loadingSummary || loadingRooms;

  const canCreate = !creating && totalSelected > 0 && selectedBlockDate.trim().length > 0;

  const setBlockDate = (ymd: string) => {
    setSelectedBlockDate(ymd);
    setError('');
    setStatusMessage('');
  };

  const CARD = {
    background: '#fff',
    borderRadius: '14px',
    boxShadow: '0 2px 12px rgba(139,111,71,0.12)',
    border: '1px solid #e5e7eb',
  };

  return (
    <div style={{ fontFamily: 'inherit' }}>
      {/* ── Page header (compact) ───────────────────────────────── */}
      <div style={{
        background: ADMIN_GRADIENT,
        borderRadius: '10px',
        padding: '8px 14px',
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
        boxShadow: '0 2px 10px rgba(91, 71, 45, 0.22)',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#fff', letterSpacing: '-0.2px' }}>TYE Blocks</h2>
          <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '12px' }}>
            Placeholders · default <strong>today</strong>
          </span>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          style={{
            padding: '6px 12px',
            background: syncing ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.18)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.45)',
            borderRadius: '8px',
            cursor: syncing ? 'not-allowed' : 'pointer',
            fontWeight: 700,
            fontSize: '12px',
            backdropFilter: 'blur(4px)',
            transition: 'background 0.15s',
          }}
        >
          {syncing ? '↻ Sync…' : '↻ Sync'}
        </button>
      </div>

      {/* ── Status chips (compact) ─────────────────────────────── */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'stretch' }}>
        {Object.entries(counts).map(([status, count]) => (
          <div key={status} style={{
            padding: '4px 10px',
            borderRadius: '8px',
            background: '#fff',
            border: `1px solid ${STATUS_COLORS[status] ?? '#e5e7eb'}40`,
            minWidth: '0',
            textAlign: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <span style={{ fontSize: '18px', fontWeight: 800, color: STATUS_COLORS[status], lineHeight: 1 }}>{count}</span>
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{STATUS_LABELS[status] ?? status}</span>
          </div>
        ))}
      </div>

      {/* ── Alerts ──────────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '10px', color: '#dc2626', marginBottom: '14px', fontSize: '14px', fontWeight: 500 }}>
          {error}
        </div>
      )}
      {statusMessage && (
        <div style={{ padding: '12px 16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '10px', color: '#15803d', marginBottom: '14px', fontSize: '14px', fontWeight: 500 }}>
          {statusMessage}
        </div>
      )}
      {blockFailures.length > 0 && (
        <div
          role="alert"
          style={{
            padding: '14px 18px',
            background: '#fff7ed',
            border: '2px solid #ea580c',
            borderRadius: '10px',
            marginBottom: '14px',
          }}
        >
          <div style={{ fontWeight: 800, color: '#9a3412', marginBottom: '10px', fontSize: '15px' }}>
            Block could not be created for {blockFailures.length}{' '}
            {blockFailures.length === 1 ? 'room / date' : 'rooms / dates'}:
          </div>
          <ul style={{ margin: 0, paddingLeft: '22px', color: '#7c2d12', fontSize: '14px', lineHeight: 1.55 }}>
            {blockFailures.map((f, i) => (
              <li key={`${f.date}-${f.room}-${i}`}>
                <strong>Room {f.room}</strong> — date <strong>{f.date}</strong>
                <div style={{ marginTop: '2px', fontWeight: 500 }}>{f.error}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Main layout: control panel + room grid side-by-side ─── */}
      <div style={{ display: 'flex', gap: '18px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '28px' }}>

        {/* Left panel: dates + actions */}
        <div style={{ flex: '0 0 250px', minWidth: '210px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Date selector */}
          <div style={{ ...CARD, overflow: 'hidden' }}>
            <div style={{ background: ADMIN_GRADIENT, padding: '10px 16px' }}>
              <span style={{ fontWeight: 700, fontSize: '12px', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Date to block</span>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { label: 'Today', ymd: today },
                { label: 'Tomorrow', ymd: tomorrow },
              ].map(({ label, ymd }) => (
                <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: ymd ? 'pointer' : 'default', userSelect: 'none' }}>
                  <input
                    type="radio"
                    name="tye-block-date"
                    checked={!!ymd && selectedBlockDate === ymd}
                    onChange={() => ymd && setBlockDate(ymd)}
                    disabled={!ymd}
                    style={{ width: '17px', height: '17px', cursor: ymd ? 'pointer' : 'default', accentColor: ADMIN_ACCENT }}
                  />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>{label}</span>
                  {ymd && <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{ymd}</span>}
                </label>
              ))}

              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '10px' }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '7px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pick a date</div>
                <input
                  type="date"
                  value={selectedBlockDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) setBlockDate(v);
                  }}
                  style={{ width: '100%', padding: '7px 9px', border: '1.5px solid #d1d5db', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginTop: '4px', padding: '8px 12px', background: ADMIN_TINT_SOLID, borderRadius: '8px', fontSize: '12px', color: ADMIN_TINT_TEXT, fontWeight: 600 }}>
                Blocking: {selectedBlockDate}
              </div>
            </div>
          </div>

          {/* Action button */}
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            style={{
              padding: '13px 20px',
              background: canCreate ? ADMIN_GRADIENT : '#e5e7eb',
              color: canCreate ? 'white' : '#9ca3af',
              border: 'none',
              borderRadius: '12px',
              cursor: canCreate ? 'pointer' : 'not-allowed',
              fontWeight: 800,
              fontSize: '15px',
              boxShadow: canCreate ? '0 4px 14px rgba(139, 111, 71, 0.4)' : 'none',
              transition: 'all 0.2s',
              textAlign: 'center',
              letterSpacing: '-0.2px',
            }}
          >
            {creating
              ? '⏳ Creating…'
              : canCreate
              ? `Block ${totalSelected} room${totalSelected === 1 ? '' : 's'} · ${selectedBlockDate}`
              : 'Select rooms below'}
          </button>

          {/* Legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', padding: '12px 14px', ...CARD }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#9ca3af', marginBottom: '2px' }}>Legend</div>
            {[
              { bg: ADMIN_TINT_SOLID, border: ADMIN_TINT_BORDER, label: 'Selected for blocking' },
              { bg: '#f0fdf4', border: '#22c55e', label: 'Already blocked' },
            ].map(({ bg, border, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '4px', background: bg, border: `2px solid ${border}`, flexShrink: 0 }} />
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Right panel: room grid */}
        <div style={{ flex: '1 1 0', minWidth: '320px' }}>
          <div style={{ ...CARD, overflow: 'hidden' }}>
            {/* Grid header */}
            <div style={{ background: ADMIN_GRADIENT, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Available rooms · {availabilityDate}
              </span>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>
                {isLoading ? 'Loading…' : <><strong style={{ color: '#fff' }}>{totalSelected}</strong> / {eligibleRooms.length} selected</>}
              </span>
            </div>

            {/* Toolbar */}
            <div style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: '10px 14px', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                value={roomFilter}
                onChange={(e) => setRoomFilter(e.target.value)}
                placeholder="Filter rooms…"
                style={{ flex: '1 1 160px', padding: '8px 12px', border: '1.5px solid #d1d5db', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
              />
              <button
                type="button"
                onClick={toggleSelectAll}
                disabled={isLoading || filteredRooms.length === 0}
                style={{
                  padding: '8px 16px',
                  background: allFilteredSelected ? '#fef2f2' : ADMIN_TINT_SOLID,
                  color: allFilteredSelected ? '#dc2626' : ADMIN_TINT_TEXT,
                  border: `1.5px solid ${allFilteredSelected ? '#fca5a5' : ADMIN_TINT_BORDER}`,
                  borderRadius: '8px',
                  cursor: isLoading || filteredRooms.length === 0 ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  fontSize: '13px',
                  whiteSpace: 'nowrap',
                }}
              >
                {allFilteredSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            {/* Room sections */}
            <div style={{ padding: '16px 14px 12px' }}>
              {isLoading ? (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: '48px 0', fontSize: '14px' }}>Loading rooms from Cloudbeds…</div>
              ) : filteredRooms.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: '48px 0', fontSize: '14px' }}>
                  {allRooms.length === 0
                    ? 'No available rooms found in Cloudbeds.'
                    : eligibleRooms.length === 0
                      ? 'No rooms to show — these room classes are not used for blocks here.'
                      : 'No rooms match the filter.'}
                </div>
              ) : (
                roomsByTypeSections.map(({ typeName, rooms }) => (
                  <div key={typeName} style={{ marginBottom: '20px' }}>
                    {/* Section header — single line, no "Select type" button */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '10px',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                      onClick={() => toggleSelectRoomsInType(rooms)}
                      title={`Click to ${rooms.every((r) => selectedRoomIDs.has(String(r.roomID))) ? 'deselect' : 'select'} all ${typeName}`}
                    >
                      <span style={{
                        display: 'inline-block',
                        height: '3px',
                        width: '18px',
                        borderRadius: '2px',
                        background: ADMIN_GRADIENT,
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#374151',
                        textTransform: 'uppercase',
                        letterSpacing: '0.07em',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {typeName}
                      </span>
                      <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500, flexShrink: 0 }}>
                        {rooms.length}
                      </span>
                      <div style={{ flex: 1, height: '1px', background: '#f0f0f0' }} />
                    </div>

                    {/* Room grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(68px, 1fr))', gap: '8px' }}>
                      {rooms.map((room) => {
                        const rid = String(room.roomID);
                        const selected = selectedRoomIDs.has(rid);
                        const blockedOnSelected =
                          selectedBlockDate && blockedByDate.get(selectedBlockDate)?.has(rid)
                            ? [selectedBlockDate]
                            : [];
                        const anyBlockedOnSelected = blockedOnSelected.length > 0;
                        const allBlockedOnSelected =
                          !!selectedBlockDate && !!blockedByDate.get(selectedBlockDate)?.has(rid);
                        const tooltip = anyBlockedOnSelected
                          ? `Already blocked on: ${selectedBlockDate}`
                          : `Room ${room.roomName}`;
                        return (
                          <button
                            type="button"
                            key={rid}
                            onClick={() => toggleRoom(rid)}
                            title={tooltip}
                            style={{
                              position: 'relative',
                              width: '100%',
                              minHeight: '54px',
                              boxSizing: 'border-box',
                              padding: '8px 6px',
                              border: selected
                                ? `2.5px solid ${ADMIN_ACCENT}`
                                : allBlockedOnSelected
                                ? '2.5px solid #22c55e'
                                : '2px solid #e5e7eb',
                              borderRadius: '10px',
                              background: selected
                                ? ADMIN_TINT_BG
                                : allBlockedOnSelected
                                ? 'linear-gradient(135deg,#f0fdf4,#dcfce7)'
                                : '#fff',
                              color: selected ? ADMIN_TINT_TEXT : allBlockedOnSelected ? '#15803d' : '#374151',
                              cursor: 'pointer',
                              fontWeight: 800,
                              fontSize: '15px',
                              textAlign: 'center',
                              transition: 'all 0.12s',
                              boxShadow: selected
                                ? '0 0 0 3px rgba(139,111,71,0.2), 0 2px 6px rgba(139,111,71,0.18)'
                                : '0 1px 3px rgba(0,0,0,0.06)',
                            }}
                          >
                            {room.roomName}
                            {anyBlockedOnSelected && (
                              <span style={{
                                position: 'absolute', top: '-6px', right: '-6px',
                                width: '18px', height: '18px', borderRadius: '50%',
                                background: '#22c55e', border: '2px solid #fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '10px', color: 'white', fontWeight: 900,
                              }}>✓</span>
                            )}
                            {selected && !anyBlockedOnSelected && (
                              <span style={{
                                position: 'absolute', top: '-6px', right: '-6px',
                                width: '18px', height: '18px', borderRadius: '50%',
                                background: ADMIN_GRADIENT, border: '2px solid #fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '10px', color: 'white', fontWeight: 900,
                              }}>★</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Block status tables ─────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <span style={{ fontSize: '16px', fontWeight: 800, color: '#111', letterSpacing: '-0.3px' }}>Existing Blocks</span>
        <div style={{ flex: 1, height: '2px', background: 'linear-gradient(to right, #e5e7eb, transparent)' }} />
      </div>
      {tableSectionDates.map((forDate) => {
        const list = placeholders.filter((p) => p.forDate === forDate);
        const label = formatDateHeading(forDate, today, tomorrow);
        return (
          <div key={forDate} style={{ marginBottom: '18px' }}>
            <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 700, color: ADMIN_ACCENT, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</h4>
            {list.length === 0 ? (
              <p style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '13px', margin: 0 }}>No blocks for this date.</p>
            ) : (
              <div style={{ overflowX: 'auto', ...CARD }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      {['Room', 'Type', 'Reservation ID', 'Status', 'Created'].map((h) => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#374151', fontSize: '11px', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p, i) => (
                      <tr key={p.id} style={{ borderBottom: i < list.length - 1 ? '1px solid #f3f4f6' : 'none', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ padding: '9px 14px', fontWeight: 800, color: '#111' }}>{p.roomName}</td>
                        <td style={{ padding: '9px 14px', color: '#6b7280' }}>{p.roomTypeName}</td>
                        <td style={{ padding: '9px 14px', fontFamily: 'monospace', fontSize: '12px', color: '#374151' }}>{p.reservationID}</td>
                        <td style={{ padding: '9px 14px' }}>
                          <span style={{
                            display: 'inline-block', padding: '3px 10px', borderRadius: '20px',
                            fontSize: '11px', fontWeight: 700, color: 'white',
                            background: STATUS_COLORS[p.status] ?? '#9ca3af',
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                          }}>
                            {STATUS_LABELS[p.status] ?? p.status}
                          </span>
                        </td>
                        <td style={{ padding: '9px 14px', color: '#9ca3af', fontSize: '12px', whiteSpace: 'nowrap' }}>
                          {p.createdAt ? new Date(p.createdAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* Webhook note */}
      <div style={{ marginTop: '6px', padding: '11px 16px', background: 'linear-gradient(135deg,#fffbeb,#fef9ec)', border: '1px solid #fde68a', borderRadius: '10px', fontSize: '13px', color: '#92400e' }}>
        <strong>Tip:</strong> Register <code style={{ fontSize: '12px', background: '#fde68a40', padding: '1px 5px', borderRadius: '3px' }}>POST /api/webhooks/cloudbeds</code> in Cloudbeds for real-time status updates. Without it, use <strong>↻ Sync</strong> to pull the latest from Cloudbeds.
      </div>
    </div>
  );
}
