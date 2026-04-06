'use client';

import { useState, useEffect, useCallback } from 'react';

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
  counts: {
    available: number;
    assigned: number;
    externally_modified: number;
    cancelled: number;
  };
}

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

export default function TyePlaceholdersTab() {
  const [summary, setSummary] = useState<PlaceholderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  // Room IDs input for creating placeholders
  const [roomIDsInput, setRoomIDsInput] = useState('');

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/sync-tye-placeholders');
      const data = await res.json();
      if (data.success) {
        setSummary(data);
      } else {
        setError(data.error ?? 'Failed to load placeholder summary');
      }
    } catch (err: any) {
      setError(err.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

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
      setError(err.message ?? 'Network error');
    } finally {
      setSyncing(false);
    }
  };

  const handleCreate = async () => {
    const roomIDs = roomIDsInput
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (roomIDs.length === 0) {
      setError('Enter at least one room ID.');
      return;
    }

    setCreating(true);
    setStatusMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/create-tye-placeholders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomIDs }),
      });
      const data = await res.json();
      if (data.success || data.totalCreated > 0) {
        setStatusMessage(
          `Created ${data.totalCreated} placeholder(s). Skipped ${data.totalSkipped}. Failed ${data.totalFailed}.`
        );
        setRoomIDsInput('');
        await fetchSummary();
      } else {
        setError(
          data.error ??
            `Created ${data.totalCreated}, failed ${data.totalFailed}. Check Cloudbeds API credentials.`
        );
      }
    } catch (err: any) {
      setError(err.message ?? 'Network error');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
        Loading placeholder data…
      </div>
    );
  }

  const today = summary?.today ?? '';
  const tomorrow = summary?.tomorrow ?? '';
  const placeholders = summary?.placeholders ?? [];
  const counts = summary?.counts ?? { available: 0, assigned: 0, externally_modified: 0, cancelled: 0 };

  const todayPlaceholders = placeholders.filter((p) => p.forDate === today);
  const tomorrowPlaceholders = placeholders.filter((p) => p.forDate === tomorrow);

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: '6px' }}>TYE Placeholder Reservations</h2>
      <p style={{ color: '#666', marginTop: 0, marginBottom: '24px', fontSize: '14px' }}>
        Pre-created Cloudbeds reservations that occupy rooms in inventory. When a walk-in guest
        arrives, a placeholder is assigned to them — no new reservation needed.
      </p>

      {/* Status counts */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {Object.entries(counts).map(([status, count]) => (
          <div
            key={status}
            style={{
              padding: '12px 20px',
              borderRadius: '10px',
              background: '#f8f8f8',
              border: `2px solid ${STATUS_COLORS[status] ?? '#ccc'}`,
              minWidth: '120px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '28px', fontWeight: 700, color: STATUS_COLORS[status] }}>{count}</div>
            <div style={{ fontSize: '13px', color: '#555', marginTop: '4px' }}>
              {STATUS_LABELS[status] ?? status}
            </div>
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

      {/* Actions */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '32px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 300px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 600 }}>
            Room IDs to create placeholders for (today + tomorrow)
          </label>
          <input
            type="text"
            value={roomIDsInput}
            onChange={(e) => setRoomIDsInput(e.target.value)}
            placeholder="e.g. 1234, 5678, 9012"
            style={{
              width: '100%',
              padding: '10px 14px',
              border: '2px solid #e0e0e0',
              borderRadius: '8px',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
          <p style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
            Use Cloudbeds internal room IDs (not room names). Separate multiple IDs with spaces or commas.
          </p>
        </div>

        <button
          onClick={handleCreate}
          disabled={creating || !roomIDsInput.trim()}
          style={{
            padding: '12px 24px',
            background: creating ? '#9ca3af' : '#667eea',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: creating ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: '14px',
            whiteSpace: 'nowrap',
          }}
        >
          {creating ? 'Creating…' : 'Create Placeholders'}
        </button>

        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            padding: '12px 24px',
            background: syncing ? '#9ca3af' : '#f3f4f6',
            color: syncing ? 'white' : '#374151',
            border: '2px solid #e5e7eb',
            borderRadius: '8px',
            cursor: syncing ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: '14px',
            whiteSpace: 'nowrap',
          }}
        >
          {syncing ? 'Syncing…' : 'Sync with Cloudbeds'}
        </button>
      </div>

      {/* Placeholder tables */}
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
                    {['Room', 'Type', 'Reservation ID', 'Status', 'Cloudbeds Status', 'Created', 'Last Synced'].map((h) => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{p.roomName}</td>
                      <td style={{ padding: '10px 12px', color: '#555' }}>{p.roomTypeName}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '12px', color: '#374151' }}>
                        {p.reservationID}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: 'white',
                            background: STATUS_COLORS[p.status] ?? '#9ca3af',
                          }}
                        >
                          {STATUS_LABELS[p.status] ?? p.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#555', fontSize: '12px' }}>
                        {p.cloudbedsStatus ?? '—'}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#555', fontSize: '12px' }}>
                        {p.createdAt ? new Date(p.createdAt).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#555', fontSize: '12px' }}>
                        {p.lastSyncedAt ? new Date(p.lastSyncedAt).toLocaleString() : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: '16px', padding: '16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '13px', color: '#92400e' }}>
        <strong>Webhook setup:</strong> Register <code>POST /api/webhooks/cloudbeds</code> in your Cloudbeds property settings under Webhooks to receive real-time updates when a placeholder is modified externally. Without a webhook, use the <em>Sync with Cloudbeds</em> button to manually check for external changes.
      </div>
    </div>
  );
}
