'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

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
  available: 'Available',
  assigned: 'Assigned',
  externally_modified: 'Modified externally',
  cancelled: 'Cancelled',
};

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

function buildDateQuery(selectedDates: string[]): string {
  const params = new URLSearchParams();
  for (const d of selectedDates) params.append('date', d);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
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

  /** YYYY-MM-DD dates for which to create placeholders (default: today once server date is known). */
  const initialClientToday = useRef(localYmd(new Date()));
  const [selectedDates, setSelectedDates] = useState<string[]>(() => [initialClientToday.current]);
  const serverTodaySynced = useRef(false);
  const [customDateInput, setCustomDateInput] = useState('');

  // Action state
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      // POST runs a Cloudbeds sync first so deleted / cancelled reservations clear stale checkmarks.
      const res = await fetch(
        `/api/admin/sync-tye-placeholders${buildDateQuery(selectedDates)}`,
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
  }, [selectedDates]);

  /**
   * Earliest selected block date drives availability: same rules as the kiosk
   * (/api/available-rooms) — rooms that are checked-in / in-house are excluded.
   */
  const availabilityDate = useMemo(() => {
    if (selectedDates.length === 0) return initialClientToday.current;
    return [...selectedDates].sort()[0];
  }, [selectedDates]);

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
    setSelectedDates((prev) => {
      if (prev.length === 1 && prev[0] === initialClientToday.current) {
        return [summary.today];
      }
      return prev;
    });
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

  /** Today / tomorrow, selected creation dates, and any date that already has placeholder rows. */
  const tableSectionDates = useMemo(() => {
    const s = new Set<string>(placeholderDatesSorted);
    if (today) s.add(today);
    if (tomorrow) s.add(tomorrow);
    for (const d of selectedDates) s.add(d);
    return [...s].sort();
  }, [placeholderDatesSorted, today, tomorrow, selectedDates]);

  const filteredRooms = allRooms.filter((r) => {
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

  const toggleCreateDate = (ymd: string) => {
    setSelectedDates((prev) => {
      const has = prev.includes(ymd);
      if (has && prev.length === 1) return prev;
      if (has) return prev.filter((x) => x !== ymd);
      return [...prev, ymd].sort();
    });
    setError('');
    setStatusMessage('');
  };

  const addCustomCreateDate = () => {
    const v = customDateInput.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      setError('Pick a valid date.');
      return;
    }
    setSelectedDates((prev) => (prev.includes(v) ? prev : [...prev, v].sort()));
    setCustomDateInput('');
    setError('');
    setStatusMessage('');
  };

  const handleCreate = async () => {
    if (selectedDates.length === 0) {
      setError('Select at least one date.');
      return;
    }
    if (selectedRoomIDs.size === 0) {
      setError('Select at least one room to block.');
      return;
    }
    setCreating(true);
    setStatusMessage('');
    setError('');
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
          dates: [...selectedDates].sort(),
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

      const failedDetails: string[] = [];
      if (data.summary && typeof data.summary === 'object') {
        for (const [, day] of Object.entries(data.summary) as [string, any][]) {
          if (day?.failed?.length) {
            for (const f of day.failed) {
              failedDetails.push(`Room ${f.roomID}: ${f.error}`);
            }
          }
        }
      }

      if ((data.totalCreated ?? 0) > 0) {
        setStatusMessage(
          `Done — created ${data.totalCreated} placeholder reservation(s) in Cloudbeds.` +
            (data.totalSkipped > 0 ? ` Skipped ${data.totalSkipped} (already blocked).` : '') +
            (data.totalFailed > 0 ? ` ${data.totalFailed} could not be created.` : '')
        );
        if (failedDetails.length > 0) {
          setError(failedDetails.slice(0, 5).join(' · ') + (failedDetails.length > 5 ? ' …' : ''));
        } else {
          setError('');
        }
        setSelectedRoomIDs(new Set());
        await Promise.all([fetchSummary(), fetchRooms()]);
      } else if ((data.totalFailed ?? 0) > 0 || failedDetails.length > 0) {
        setError(
          failedDetails.length > 0
            ? failedDetails.join(' · ')
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
    try {
      const res = await fetch(
        `/api/admin/sync-tye-placeholders${buildDateQuery(selectedDates)}`,
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

  const canCreate = !creating && totalSelected > 0 && selectedDates.length > 0;

  const GRAD = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  const CARD = { background: '#fff', borderRadius: '14px', boxShadow: '0 2px 12px rgba(102,126,234,0.10)', border: '1px solid #e5e7eb' };

  return (
    <div style={{ fontFamily: 'inherit' }}>
      {/* ── Page header ─────────────────────────────────────────── */}
      <div style={{
        background: GRAD,
        borderRadius: '14px',
        padding: '18px 24px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        boxShadow: '0 4px 20px rgba(102,126,234,0.3)',
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' }}>TYE Blocks</h2>
          <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.8)', fontSize: '13px' }}>
            Create placeholder reservations · default date is <strong>today</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          style={{
            padding: '9px 20px',
            background: syncing ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.18)',
            color: '#fff',
            border: '1.5px solid rgba(255,255,255,0.5)',
            borderRadius: '9px',
            cursor: syncing ? 'not-allowed' : 'pointer',
            fontWeight: 700,
            fontSize: '14px',
            backdropFilter: 'blur(4px)',
            transition: 'background 0.15s',
          }}
        >
          {syncing ? '↻ Syncing…' : '↻ Sync with Cloudbeds'}
        </button>
      </div>

      {/* ── Status chips ────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap' }}>
        {Object.entries(counts).map(([status, count]) => (
          <div key={status} style={{
            padding: '10px 18px',
            borderRadius: '12px',
            background: '#fff',
            border: `2px solid ${STATUS_COLORS[status] ?? '#e5e7eb'}20`,
            minWidth: '100px',
            textAlign: 'center',
            boxShadow: `0 2px 8px ${STATUS_COLORS[status] ?? '#e5e7eb'}25`,
          }}>
            <div style={{ fontSize: '28px', fontWeight: 800, color: STATUS_COLORS[status], lineHeight: 1 }}>{count}</div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{STATUS_LABELS[status] ?? status}</div>
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

      {/* ── Main layout: control panel + room grid side-by-side ─── */}
      <div style={{ display: 'flex', gap: '18px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '28px' }}>

        {/* Left panel: dates + actions */}
        <div style={{ flex: '0 0 250px', minWidth: '210px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Date selector */}
          <div style={{ ...CARD, overflow: 'hidden' }}>
            <div style={{ background: GRAD, padding: '10px 16px' }}>
              <span style={{ fontWeight: 700, fontSize: '12px', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Dates to block</span>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { label: 'Today', ymd: today },
                { label: 'Tomorrow', ymd: tomorrow },
              ].map(({ label, ymd }) => (
                <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: ymd ? 'pointer' : 'default', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={ymd ? selectedDates.includes(ymd) : false}
                    onChange={() => ymd && toggleCreateDate(ymd)}
                    disabled={!ymd}
                    style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#667eea' }}
                  />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>{label}</span>
                  {ymd && <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{ymd}</span>}
                </label>
              ))}

              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '10px' }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '7px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Other date</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="date"
                    value={customDateInput}
                    onChange={(e) => setCustomDateInput(e.target.value)}
                    style={{ flex: 1, padding: '7px 9px', border: '1.5px solid #d1d5db', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={addCustomCreateDate}
                    disabled={!customDateInput.trim()}
                    style={{
                      padding: '7px 12px',
                      background: customDateInput.trim() ? GRAD : '#e5e7eb',
                      color: customDateInput.trim() ? 'white' : '#9ca3af',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: customDateInput.trim() ? 'pointer' : 'not-allowed',
                      fontWeight: 700,
                      fontSize: '13px',
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {selectedDates.length > 0 && (
                <div style={{ marginTop: '10px', padding: '8px 12px', background: '#eef2ff', borderRadius: '8px', fontSize: '12px', color: '#4338ca', fontWeight: 600 }}>
                  Selected: {[...selectedDates].sort().join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* Action button */}
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            style={{
              padding: '13px 20px',
              background: canCreate ? GRAD : '#e5e7eb',
              color: canCreate ? 'white' : '#9ca3af',
              border: 'none',
              borderRadius: '12px',
              cursor: canCreate ? 'pointer' : 'not-allowed',
              fontWeight: 800,
              fontSize: '15px',
              boxShadow: canCreate ? '0 4px 14px rgba(102,126,234,0.45)' : 'none',
              transition: 'all 0.2s',
              textAlign: 'center',
              letterSpacing: '-0.2px',
            }}
          >
            {creating
              ? '⏳ Creating…'
              : canCreate
              ? `Block ${totalSelected} room${totalSelected === 1 ? '' : 's'}${selectedDates.length > 1 ? ` × ${selectedDates.length} dates` : ''}`
              : 'Select rooms below'}
          </button>

          {/* Legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', padding: '12px 14px', ...CARD }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#9ca3af', marginBottom: '2px' }}>Legend</div>
            {[
              { bg: '#eef2ff', border: '#667eea', label: 'Selected for blocking' },
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
            <div style={{ background: GRAD, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Available rooms · {availabilityDate}
              </span>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>
                {isLoading ? 'Loading…' : <><strong style={{ color: '#fff' }}>{totalSelected}</strong> / {allRooms.length} selected</>}
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
                  background: allFilteredSelected ? '#fef2f2' : '#eef2ff',
                  color: allFilteredSelected ? '#dc2626' : '#4f46e5',
                  border: `1.5px solid ${allFilteredSelected ? '#fca5a5' : '#c7d2fe'}`,
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
                  {allRooms.length === 0 ? 'No available rooms found in Cloudbeds.' : 'No rooms match the filter.'}
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
                        background: GRAD,
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
                        const blockedOnSelected = selectedDates.filter((d) => blockedByDate.get(d)?.has(rid));
                        const anyBlockedOnSelected = blockedOnSelected.length > 0;
                        const allBlockedOnSelected = selectedDates.length > 0 && selectedDates.every((d) => blockedByDate.get(d)?.has(rid));
                        const tooltip = blockedOnSelected.length > 0 ? `Already blocked on: ${blockedOnSelected.join(', ')}` : `Room ${room.roomName}`;
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
                                ? '2.5px solid #667eea'
                                : allBlockedOnSelected
                                ? '2.5px solid #22c55e'
                                : '2px solid #e5e7eb',
                              borderRadius: '10px',
                              background: selected
                                ? 'linear-gradient(135deg,#eef2ff,#e0e7ff)'
                                : allBlockedOnSelected
                                ? 'linear-gradient(135deg,#f0fdf4,#dcfce7)'
                                : '#fff',
                              color: selected ? '#4f46e5' : allBlockedOnSelected ? '#15803d' : '#374151',
                              cursor: 'pointer',
                              fontWeight: 800,
                              fontSize: '15px',
                              textAlign: 'center',
                              transition: 'all 0.12s',
                              boxShadow: selected
                                ? '0 0 0 3px rgba(102,126,234,0.2), 0 2px 6px rgba(102,126,234,0.2)'
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
                                background: GRAD, border: '2px solid #fff',
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
            <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 700, color: '#667eea', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</h4>
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
