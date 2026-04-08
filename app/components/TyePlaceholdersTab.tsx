'use client';

import { useState, useEffect, useCallback } from 'react';

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
      const res = await fetch('/api/admin/sync-tye-placeholders');
      const data = await res.json();
      if (data.success) setSummary(data);
      else setError(data.error ?? 'Failed to load placeholder summary');
    } catch (err: any) {
      setError(err?.message ?? 'Network error loading summary');
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  /** Load the full room list including which rooms already have placeholders. */
  const fetchRooms = useCallback(async () => {
    setLoadingRooms(true);
    try {
      // /api/available-rooms already annotates rooms with placeholderReservationID when one exists.
      // We use ?all=1 on the tye-placeholders endpoint separately so we can show ALL Cloudbeds
      // rooms here, not just "available" ones — this way staff can see every room and decide
      // which to block. We still skip rooms that are actively occupied.
      const res = await fetch('/api/available-rooms');
      const data = await res.json();
      if (data.rooms) {
        setAllRooms(data.rooms as AvailableRoom[]);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Network error loading rooms');
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    fetchRooms();
  }, [fetchSummary, fetchRooms]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const today = summary?.today ?? '';
  const tomorrow = summary?.tomorrow ?? '';
  const placeholders = summary?.placeholders ?? [];
  const counts = summary?.counts ?? { available: 0, assigned: 0, externally_modified: 0, cancelled: 0 };

  const todayPlaceholders = placeholders.filter((p) => p.forDate === today);
  const tomorrowPlaceholders = placeholders.filter((p) => p.forDate === tomorrow);

  /** Room IDs that already have a placeholder for today (always string keys). */
  const alreadyBlockedTodayIDs = new Set(
    todayPlaceholders
      .filter((p) => p.status !== 'cancelled')
      .map((p) => String(p.roomID))
  );
  const alreadyBlockedTomorrowIDs = new Set(
    tomorrowPlaceholders
      .filter((p) => p.status !== 'cancelled')
      .map((p) => String(p.roomID))
  );

  const filteredRooms = allRooms.filter((r) => {
    if (!roomFilter.trim()) return true;
    const q = roomFilter.toLowerCase();
    return (
      r.roomName.toLowerCase().includes(q) ||
      r.roomTypeName.toLowerCase().includes(q)
    );
  });

  // Group filtered rooms by type for easier scanning
  const roomsByType: Record<string, AvailableRoom[]> = {};
  for (const room of filteredRooms) {
    const type = room.roomTypeName || 'Other';
    if (!roomsByType[type]) roomsByType[type] = [];
    roomsByType[type].push(room);
  }

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

  const handleCreate = async () => {
    if (selectedRoomIDs.size === 0) {
      setError('Select at least one room to block.');
      return;
    }
    setCreating(true);
    setStatusMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/create-tye-placeholders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomIDs: Array.from(selectedRoomIDs).map(String),
          // Same as kiosk GuestCheckIn `roomNameHint` — helps Cloudbeds match the physical room.
          roomHints: Object.fromEntries(
            Array.from(selectedRoomIDs).map((id) => {
              const room = allRooms.find((r) => String(r.roomID) === id);
              return [id, room?.roomName ?? ''] as const;
            }).filter(([, name]) => name.trim() !== '')
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
      const res = await fetch('/api/admin/sync-tye-placeholders', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setStatusMessage(
          data.changes.length > 0
            ? `Sync complete — ${data.changes.length} placeholder(s) updated.`
            : `Sync complete — all ${data.synced} placeholder(s) are up to date.`
        );
        await fetchSummary();
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

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ marginTop: 0, marginBottom: '6px' }}>TYE Placeholder Reservations</h2>
        <p style={{ color: '#666', marginTop: 0, fontSize: '14px' }}>
          Select available rooms below to block them as TYE placeholders in Cloudbeds for today and tomorrow.
          Walk-in guests will be assigned to a placeholder instead of creating a new reservation.
        </p>
      </div>

      {/* Status count chips */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {Object.entries(counts).map(([status, count]) => (
          <div key={status} style={{
            padding: '10px 18px',
            borderRadius: '10px',
            background: '#f8f8f8',
            border: `2px solid ${STATUS_COLORS[status] ?? '#ccc'}`,
            minWidth: '110px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '26px', fontWeight: 700, color: STATUS_COLORS[status] }}>{count}</div>
            <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>{STATUS_LABELS[status] ?? status}</div>
          </div>
        ))}
      </div>

      {/* Messages */}
      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#dc2626', marginBottom: '16px' }}>
          {error}
        </div>
      )}
      {statusMessage && (
        <div style={{ padding: '12px 16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', color: '#16a34a', marginBottom: '16px' }}>
          {statusMessage}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Room Picker                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div style={{
        border: '2px solid #e5e7eb',
        borderRadius: '12px',
        overflow: 'hidden',
        marginBottom: '24px',
      }}>
        {/* Picker toolbar */}
        <div style={{
          background: '#f9fafb',
          borderBottom: '2px solid #e5e7eb',
          padding: '14px 18px',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: '1 1 180px' }}>
            <input
              type="text"
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value)}
              placeholder="Filter rooms…"
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="button"
            onClick={toggleSelectAll}
            disabled={isLoading || filteredRooms.length === 0}
            style={{
              padding: '8px 16px',
              background: allFilteredSelected ? '#fef2f2' : '#eff6ff',
              color: allFilteredSelected ? '#dc2626' : '#2563eb',
              border: `2px solid ${allFilteredSelected ? '#fca5a5' : '#bfdbfe'}`,
              borderRadius: '8px',
              cursor: isLoading || filteredRooms.length === 0 ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              whiteSpace: 'nowrap',
            }}
          >
            {allFilteredSelected ? 'Deselect All' : 'Select All'}
          </button>

          <div style={{ fontSize: '13px', color: '#6b7280', whiteSpace: 'nowrap' }}>
            {isLoading ? 'Loading…' : (
              <>
                <strong style={{ color: totalSelected > 0 ? '#667eea' : '#374151' }}>
                  {totalSelected}
                </strong>
                {' of '}
                {allRooms.length} rooms selected
              </>
            )}
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || totalSelected === 0}
            style={{
              padding: '10px 22px',
              background: creating || totalSelected === 0 ? '#9ca3af' : '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: creating || totalSelected === 0 ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              fontSize: '14px',
              whiteSpace: 'nowrap',
              boxShadow: totalSelected > 0 && !creating ? '0 2px 8px rgba(102,126,234,0.4)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {creating
              ? 'Creating in Cloudbeds…'
              : totalSelected > 0
              ? 'Block for TYE'
              : 'Select rooms to block'}
          </button>
        </div>

        {/* Room grid */}
        <div style={{ padding: '16px 18px', maxHeight: '420px', overflowY: 'auto' }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0' }}>
              Loading rooms from Cloudbeds…
            </div>
          ) : filteredRooms.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0' }}>
              {allRooms.length === 0 ? 'No available rooms found in Cloudbeds.' : 'No rooms match the filter.'}
            </div>
          ) : (
            Object.entries(roomsByType).map(([typeName, rooms]) => (
              <div key={typeName} style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                  {typeName} ({rooms.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {rooms.map((room) => {
                    const rid = String(room.roomID);
                    const selected = selectedRoomIDs.has(rid);
                    const blockedToday = alreadyBlockedTodayIDs.has(rid);
                    const blockedTomorrow = alreadyBlockedTomorrowIDs.has(rid);
                    const fullyBlocked = blockedToday && blockedTomorrow;

                    return (
                      <button
                        type="button"
                        key={rid}
                        onClick={() => toggleRoom(rid)}
                        title={fullyBlocked ? 'Already blocked for today and tomorrow' : `Room ID: ${rid}`}
                        style={{
                          position: 'relative',
                          padding: '10px 14px',
                          minWidth: '72px',
                          border: `2px solid ${selected ? '#667eea' : fullyBlocked ? '#86efac' : '#e5e7eb'}`,
                          borderRadius: '10px',
                          background: selected ? '#eef2ff' : fullyBlocked ? '#f0fdf4' : 'white',
                          color: selected ? '#4f46e5' : fullyBlocked ? '#15803d' : '#374151',
                          cursor: 'pointer',
                          fontWeight: 700,
                          fontSize: '15px',
                          textAlign: 'center',
                          transition: 'all 0.15s',
                          boxShadow: selected ? '0 0 0 3px rgba(102,126,234,0.2)' : 'none',
                        }}
                      >
                        {room.roomName}
                        {(blockedToday || blockedTomorrow) && (
                          <span style={{
                            position: 'absolute',
                            top: '-6px',
                            right: '-6px',
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            background: '#16a34a',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            color: 'white',
                            fontWeight: 900,
                          }}>
                            ✓
                          </span>
                        )}
                        {selected && (
                          <span style={{
                            position: 'absolute',
                            bottom: '-6px',
                            right: '-6px',
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            background: '#667eea',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '9px',
                            color: 'white',
                            fontWeight: 900,
                          }}>
                            ★
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Legend */}
        <div style={{
          borderTop: '1px solid #f0f0f0',
          padding: '10px 18px',
          background: '#fafafa',
          display: 'flex',
          gap: '20px',
          fontSize: '12px',
          color: '#6b7280',
          flexWrap: 'wrap',
        }}>
          <span><span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', background: '#667eea', marginRight: '5px', verticalAlign: 'middle' }} />Selected to block</span>
          <span><span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', background: '#16a34a', marginRight: '5px', verticalAlign: 'middle' }} />Already blocked (TYE)</span>
          <span style={{ color: '#9ca3af' }}>Only rooms currently available in Cloudbeds are shown.</span>
        </div>
      </div>

      {/* Sync button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '32px' }}>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          style={{
            padding: '10px 22px',
            background: syncing ? '#9ca3af' : '#f3f4f6',
            color: syncing ? 'white' : '#374151',
            border: '2px solid #e5e7eb',
            borderRadius: '8px',
            cursor: syncing ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: '14px',
          }}
        >
          {syncing ? 'Syncing…' : 'Sync with Cloudbeds'}
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Placeholder tables                                                  */}
      {/* ------------------------------------------------------------------ */}
      {[
        { label: `Today (${today})`, list: todayPlaceholders },
        { label: `Tomorrow (${tomorrow})`, list: tomorrowPlaceholders },
      ].map(({ label, list }) => (
        <div key={label} style={{ marginBottom: '32px' }}>
          <h3 style={{ marginBottom: '12px' }}>{label}</h3>
          {list.length === 0 ? (
            <p style={{ color: '#888', fontStyle: 'italic' }}>No placeholders for this date.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                    {['Room', 'Type', 'Reservation ID', 'Status', 'Created'].map((h) => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>{p.roomName}</td>
                      <td style={{ padding: '10px 12px', color: '#555' }}>{p.roomTypeName}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '12px', color: '#374151' }}>
                        {p.reservationID}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: 'white',
                          background: STATUS_COLORS[p.status] ?? '#9ca3af',
                        }}>
                          {STATUS_LABELS[p.status] ?? p.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#555', fontSize: '12px' }}>
                        {p.createdAt ? new Date(p.createdAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* Webhook note */}
      <div style={{ padding: '14px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '13px', color: '#92400e' }}>
        <strong>Webhook tip:</strong> Register <code>POST /api/webhooks/cloudbeds</code> in Cloudbeds property settings to get real-time updates when a placeholder is touched externally. Without it, use <em>Sync with Cloudbeds</em> to detect external changes.
      </div>
    </div>
  );
}
