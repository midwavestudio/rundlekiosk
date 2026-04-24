'use client';

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import { ADMIN_ACCENT, ADMIN_TINT_BORDER } from '../lib/adminTheme';
import { EventDetailReadable } from '@/lib/event-log-detail-format';
import { loadReadEventIds, markEventRead, markEventsRead } from '@/lib/event-log-read';

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

function decodeBasicEntities(text: string): string {
  return text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

const btnSecondary: CSSProperties = {
  padding: '8px 14px',
  border: `1px solid ${ADMIN_TINT_BORDER}`,
  borderRadius: '8px',
  background: 'white',
  color: ADMIN_ACCENT,
  fontWeight: 600,
  fontSize: '13px',
  cursor: 'pointer',
};

export default function EventLogTab() {
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setReadIds(loadReadEventIds());
  }, []);

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

  const unreadCount = useMemo(
    () => events.reduce((n, ev) => (readIds.has(ev.id) ? n : n + 1), 0),
    [events, readIds]
  );

  const handleMarkRead = (id: string) => {
    setReadIds((prev) => markEventRead(id, prev));
  };

  const handleMarkAllShownRead = () => {
    if (events.length === 0) return;
    const ids = events.map((e) => e.id);
    setReadIds((prev) => markEventsRead(ids, prev));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'clamp(20px, 2.5vw, 28px)', color: '#333' }}>Error log</h2>
          <p style={{ margin: '4px 0 0', color: '#888', fontSize: '14px' }}>
            Check-in / check-out failures and kiosk errors (newest first). Read state is saved in this browser.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          {unreadCount > 0 && (
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#1d4ed8',
                background: '#eff6ff',
                padding: '6px 12px',
                borderRadius: '999px',
                border: '1px solid #bfdbfe',
              }}
            >
              {unreadCount} unread
            </span>
          )}
          <button type="button" onClick={handleMarkAllShownRead} disabled={events.length === 0 || unreadCount === 0} style={{ ...btnSecondary, opacity: events.length === 0 || unreadCount === 0 ? 0.45 : 1 }}>
            Mark all shown as read
          </button>
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
            const isRead = readIds.has(ev.id);
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
                  background: isRead ? '#fafafa' : '#fff',
                  borderLeft: isRead ? undefined : '4px solid #2563eb',
                  boxShadow: isRead ? undefined : '0 1px 0 rgba(37, 99, 235, 0.06)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'stretch',
                    background: expanded ? '#f3f4f6' : isRead ? '#fafafa' : '#fff',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (expanded) {
                        setExpandedId(null);
                      } else {
                        setExpandedId(ev.id);
                        handleMarkRead(ev.id);
                      }
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      padding: '12px 14px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                      {!isRead && (
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            padding: '2px 7px',
                            borderRadius: '6px',
                            background: '#2563eb',
                            color: '#fff',
                          }}
                        >
                          Unread
                        </span>
                      )}
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
                    <div style={{ fontSize: '15px', color: isRead ? '#4b5563' : '#111', lineHeight: 1.45 }}>
                      {decodeBasicEntities(ev.message)}
                    </div>
                    <span style={{ fontSize: '12px', color: '#999' }}>{expanded ? 'Hide detail ▲' : 'Show detail ▼'}</span>
                  </button>
                  {!isRead && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(ev.id)}
                      style={{
                        flexShrink: 0,
                        alignSelf: 'stretch',
                        padding: '10px 14px',
                        border: 'none',
                        borderLeft: '1px solid #e5e7eb',
                        background: 'rgba(37, 99, 235, 0.06)',
                        color: '#1d4ed8',
                        fontWeight: 600,
                        fontSize: '12px',
                        cursor: 'pointer',
                        maxWidth: '96px',
                        lineHeight: 1.25,
                      }}
                      title="Mark as read without opening details"
                    >
                      Mark read
                    </button>
                  )}
                </div>
                {expanded && (
                  <div
                    style={{
                      borderTop: '1px solid #e5e7eb',
                      background: '#fff',
                      padding: '14px 16px 16px',
                    }}
                  >
                    {ev.detailJson ? (
                      <EventDetailReadable detailJson={ev.detailJson} />
                    ) : (
                      <p style={{ margin: 0, fontSize: '14px', color: '#888', lineHeight: 1.5 }}>
                        No structured detail was stored for this event (older log entries may not include submitted
                        fields).
                      </p>
                    )}
                    <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #eef0f3' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkRead(ev.id);
                        }}
                        disabled={isRead}
                        style={{
                          ...btnSecondary,
                          opacity: isRead ? 0.5 : 1,
                          cursor: isRead ? 'default' : 'pointer',
                        }}
                      >
                        {isRead ? 'Marked as read' : 'Mark as read'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
