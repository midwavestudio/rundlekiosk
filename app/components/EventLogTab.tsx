'use client';

import { useState, useEffect, useCallback } from 'react';
import { ADMIN_ACCENT, ADMIN_TINT_BORDER } from '../lib/adminTheme';

interface EventLogEntry {
  id: string;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
  detailJson?: string;
  occurredAt: string;
}

const LEVEL_STYLE: Record<string, { bg: string; color: string }> = {
  error: { bg: '#fee2e2', color: '#991b1b' },
  warn: { bg: '#fef3c7', color: '#92400e' },
  info: { bg: '#e0f2fe', color: '#075985' },
};

export default function EventLogTab() {
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/event-log?limit=250');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      setError('Could not load the error log. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'clamp(20px, 2.5vw, 28px)', color: '#333' }}>Error log</h2>
          <p style={{ margin: '4px 0 0', color: '#888', fontSize: '14px' }}>
            Check-in / check-out failures and kiosk errors (newest first)
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          style={{
            padding: '9px 18px',
            border: `2px solid ${ADMIN_TINT_BORDER}`,
            borderRadius: '8px',
            background: 'white',
            color: ADMIN_ACCENT,
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#888' }}>Loading…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '32px', color: '#b91c1c' }}>{error}</div>
      ) : events.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#aaa', background: '#f9fafb', borderRadius: '12px' }}>
          No logged events yet. Failures from the kiosk or Cloudbeds APIs will appear here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {events.map((ev) => {
            const ls = LEVEL_STYLE[ev.level] ?? LEVEL_STYLE.error;
            const expanded = expandedId === ev.id;
            let detailPretty = '';
            if (ev.detailJson) {
              try {
                detailPretty = JSON.stringify(JSON.parse(ev.detailJson), null, 2);
              } catch {
                detailPretty = ev.detailJson;
              }
            }
            const when = new Date(ev.occurredAt).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              second: '2-digit',
            });

            return (
              <div
                key={ev.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  background: '#fff',
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : ev.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 14px',
                    border: 'none',
                    background: expanded ? '#fafafa' : '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        background: ls.bg,
                        color: ls.color,
                      }}
                    >
                      {ev.level}
                    </span>
                    <span style={{ fontSize: '12px', color: '#888' }}>{when}</span>
                    <span style={{ fontSize: '12px', color: '#555', fontFamily: 'ui-monospace, monospace' }}>{ev.source}</span>
                  </div>
                  <div style={{ fontSize: '15px', color: '#111', lineHeight: 1.45 }}>{ev.message}</div>
                  <span style={{ fontSize: '12px', color: '#999' }}>{expanded ? 'Hide detail ▲' : 'Show detail ▼'}</span>
                </button>
                {expanded && detailPretty && (
                  <pre
                    style={{
                      margin: 0,
                      padding: '12px 14px',
                      background: '#1e1e1e',
                      color: '#e5e5e5',
                      fontSize: '12px',
                      lineHeight: 1.45,
                      overflow: 'auto',
                      maxHeight: '280px',
                      borderTop: '1px solid #333',
                    }}
                  >
                    {detailPretty}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
