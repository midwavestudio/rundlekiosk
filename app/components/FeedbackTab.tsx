'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ADMIN_ACCENT,
  ADMIN_TINT_BG,
  ADMIN_TINT_BORDER,
  ADMIN_TEXT_PRIMARY,
  ADMIN_TEXT_MUTED,
  ADMIN_SURFACE_RAISED,
  ADMIN_BORDER_STRONG,
} from '../lib/adminTheme';
import { loadReadFeedbackIds, markFeedbackRead, markFeedbacksRead, removeFeedbackReadId } from '@/lib/feedback-read';

interface FeedbackMessage {
  id: string;
  message: string;
  name?: string;
  submittedAt: string;
  status: 'new' | 'reviewed' | 'resolved';
  notes?: string;
}

const STATUS_LABELS: Record<FeedbackMessage['status'], string> = {
  new: 'New',
  reviewed: 'Reviewed',
  resolved: 'Resolved',
};

const STATUS_COLORS: Record<FeedbackMessage['status'], { bg: string; color: string }> = {
  new: { bg: '#fef3c7', color: '#92400e' },
  reviewed: { bg: '#dbeafe', color: '#1e40af' },
  resolved: { bg: '#d1fae5', color: '#065f46' },
};

interface FeedbackTabProps {
  /** Keeps the Messages tab badge in the dashboard nav in sync. */
  onUnreadCountChange?: (count: number) => void;
}

export default function FeedbackTab({ onUnreadCountChange }: FeedbackTabProps) {
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | FeedbackMessage['status']>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notesInput, setNotesInput] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/feedback');
      if (!res.ok) throw new Error('Failed to load messages.');
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch {
      setError('Could not load feedback messages. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);
  useEffect(() => { setReadIds(loadReadFeedbackIds()); }, []);

  // Mark all loaded messages as read when the tab is open and messages finish loading.
  // This resets the badge. If a message is later marked unread, the badge reappears
  // when the user navigates away because readIds will not contain that id.
  useEffect(() => {
    if (loading || messages.length === 0) return;
    setReadIds((prev) => markFeedbacksRead(messages.map((m) => m.id), prev));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    if (!onUnreadCountChange || loading) return;
    const unread = messages.reduce((n, m) => (readIds.has(m.id) ? n : n + 1), 0);
    onUnreadCountChange(unread);
  }, [messages, readIds, onUnreadCountChange, loading]);

  const handleMarkUnread = (id: string) => {
    setReadIds((prev) => removeFeedbackReadId(id, prev));
  };

  async function updateMessage(id: string, status: FeedbackMessage['status'], notes?: string) {
    setSaving(id);
    try {
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, notes }),
      });
      if (!res.ok) throw new Error();
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status, notes: notes ?? m.notes } : m))
      );
    } catch {
      alert('Failed to update message. Please try again.');
    } finally {
      setSaving(null);
    }
  }

  async function deleteMessage(id: string) {
    if (!confirm('Delete this message permanently? This cannot be undone.')) return;
    setSaving(id);
    try {
      const res = await fetch(`/api/feedback?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setMessages((prev) => prev.filter((m) => m.id !== id));
      setReadIds((prev) => removeFeedbackReadId(id, prev));
      setExpandedId((ex) => (ex === id ? null : ex));
    } catch {
      alert('Failed to delete message. Please try again.');
    } finally {
      setSaving(null);
    }
  }

  const filtered = filter === 'all' ? messages : messages.filter((m) => m.status === filter);
  const unreadCount = messages.reduce((n, m) => (readIds.has(m.id) ? n : n + 1), 0);

  const handleMarkAllShownRead = () => {
    if (messages.length === 0) return;
    setReadIds((prev) => markFeedbacksRead(messages.map((m) => m.id), prev));
  };

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'clamp(20px, 2.5vw, 28px)', color: ADMIN_TEXT_PRIMARY }}>
            Messages
            {unreadCount > 0 && (
              <span style={{
                marginLeft: '10px',
                background: '#f59e0b',
                color: 'white',
                fontSize: '13px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '12px',
                verticalAlign: 'middle',
              }}>
                {unreadCount} unread
              </span>
            )}
          </h2>
          <p style={{ margin: '4px 0 0', color: ADMIN_TEXT_MUTED, fontSize: '14px' }}>Messages submitted by guests through the kiosk</p>
        </div>
        <button
          onClick={handleMarkAllShownRead}
          disabled={messages.length === 0 || unreadCount === 0}
          style={{
            padding: '9px 18px',
            border: `2px solid ${ADMIN_TINT_BORDER}`,
            borderRadius: '8px',
            background: ADMIN_TINT_BG,
            color: ADMIN_ACCENT,
            fontWeight: 600,
            fontSize: '14px',
            cursor: messages.length === 0 || unreadCount === 0 ? 'not-allowed' : 'pointer',
            opacity: messages.length === 0 || unreadCount === 0 ? 0.5 : 1,
          }}
        >
          Mark all shown as read
        </button>
        <button
          onClick={fetchMessages}
          style={{
            padding: '9px 18px',
            border: `2px solid ${ADMIN_TINT_BORDER}`,
            borderRadius: '8px',
            background: ADMIN_TINT_BG,
            color: ADMIN_ACCENT,
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {(['all', 'new', 'reviewed', 'resolved'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 16px',
              borderRadius: '20px',
              border: filter === f ? `2px solid ${ADMIN_ACCENT}` : `2px solid ${ADMIN_BORDER_STRONG}`,
              background: filter === f ? ADMIN_TINT_BG : ADMIN_SURFACE_RAISED,
              color: filter === f ? ADMIN_ACCENT : ADMIN_TEXT_MUTED,
              fontWeight: filter === f ? 700 : 400,
              fontSize: '14px',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {f === 'all' ? `All (${messages.length})` : `${STATUS_LABELS[f]} (${messages.filter((m) => m.status === f).length})`}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: ADMIN_TEXT_MUTED }}>Loading messages…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#c0392b' }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: ADMIN_TEXT_MUTED,
          background: ADMIN_SURFACE_RAISED,
          borderRadius: '12px',
          border: `1px solid ${ADMIN_BORDER_STRONG}`,
        }}>
          <div style={{ fontSize: '40px', marginBottom: '12px', opacity: 0.9 }}>💬</div>
          <p style={{ margin: 0, fontSize: '16px', color: ADMIN_TEXT_PRIMARY }}>
            {filter === 'all' ? 'No feedback messages yet.' : `No ${filter} messages.`}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map((msg) => {
            const isExpanded = expandedId === msg.id;
            const isRead = readIds.has(msg.id);
            const showReadBadge = msg.status === 'new' && isRead;
            const sc = showReadBadge
              ? { bg: '#f3f4f6', color: '#6b7280' }
              : STATUS_COLORS[msg.status];
            const statusLabel = showReadBadge ? 'Read' : STATUS_LABELS[msg.status];
            const date = new Date(msg.submittedAt).toLocaleString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit',
            });

            return (
              <div
                key={msg.id}
                style={{
                  border: isRead ? '2px solid #e5e7eb' : `2px solid #f59e0b`,
                  borderRadius: '12px',
                  overflow: 'hidden',
                  background: isRead ? '#fafafa' : 'white',
                  transition: 'box-shadow 0.2s',
                  boxShadow: isExpanded ? '0 4px 20px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                {/* Card header — always visible */}
                <div
                  style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}
                  onClick={() => {
                    const nextExpanded = isExpanded ? null : msg.id;
                    setExpandedId(nextExpanded);
                    if (nextExpanded) {
                      setReadIds((prev) => markFeedbackRead(msg.id, prev));
                    }
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <span style={{
                        padding: '3px 10px',
                        borderRadius: '10px',
                        fontSize: '12px',
                        fontWeight: 700,
                        background: sc.bg,
                        color: sc.color,
                        whiteSpace: 'nowrap',
                      }}>
                        {statusLabel}
                      </span>
                      <span style={{ fontSize: '13px', color: '#999' }}>{date}</span>
                      {msg.name && (
                        <span style={{ fontSize: '13px', color: '#555', fontWeight: 600 }}>
                          👤 {msg.name}
                        </span>
                      )}
                    </div>
                    <p style={{
                      margin: 0,
                      color: '#333',
                      fontSize: '15px',
                      lineHeight: 1.5,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: isExpanded ? 'unset' : 2,
                      WebkitBoxOrient: 'vertical',
                    }}>
                      {msg.message}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    {isRead && (
                      <button
                        type="button"
                        disabled={saving === msg.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkUnread(msg.id);
                        }}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '8px',
                          border: `1px solid ${ADMIN_TINT_BORDER}`,
                          background: ADMIN_TINT_BG,
                          color: ADMIN_ACCENT,
                          fontWeight: 600,
                          fontSize: '12px',
                          cursor: saving === msg.id ? 'not-allowed' : 'pointer',
                          opacity: saving === msg.id ? 0.5 : 1,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Mark unread
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={saving === msg.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteMessage(msg.id);
                      }}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '8px',
                        border: '1px solid #fecaca',
                        background: '#fff',
                        color: '#b91c1c',
                        fontWeight: 600,
                        fontSize: '12px',
                        cursor: saving === msg.id ? 'not-allowed' : 'pointer',
                        opacity: saving === msg.id ? 0.5 : 1,
                      }}
                    >
                      Delete
                    </button>
                    <span style={{ color: ADMIN_TEXT_MUTED, fontSize: '18px', marginTop: '2px' }}>
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </div>
                </div>

                {/* Expanded actions */}
                {isExpanded && (
                  <div style={{ padding: '16px 20px', borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
                    <label style={{ display: 'block', fontWeight: 600, fontSize: '13px', color: '#555', marginBottom: '6px' }}>
                      Admin Notes
                    </label>
                    <textarea
                      value={notesInput[msg.id] ?? msg.notes ?? ''}
                      onChange={(e) => setNotesInput((prev) => ({ ...prev, [msg.id]: e.target.value }))}
                      placeholder="Add internal notes…"
                      rows={2}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '2px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontFamily: 'inherit',
                        boxSizing: 'border-box',
                        resize: 'vertical',
                        outline: 'none',
                      }}
                      onFocus={(e) => { e.target.style.borderColor = ADMIN_ACCENT; }}
                      onBlur={(e) => { e.target.style.borderColor = '#e5e7eb'; }}
                    />

                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {isRead ? (
                        <button
                          type="button"
                          disabled={saving === msg.id}
                          onClick={() => handleMarkUnread(msg.id)}
                          style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: `2px solid ${ADMIN_TINT_BORDER}`,
                            background: ADMIN_TINT_BG,
                            color: ADMIN_ACCENT,
                            fontWeight: 600,
                            fontSize: '13px',
                            cursor: saving === msg.id ? 'not-allowed' : 'pointer',
                            opacity: saving === msg.id ? 0.7 : 1,
                          }}
                        >
                          Mark as unread
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={saving === msg.id}
                          onClick={() => setReadIds((prev) => markFeedbackRead(msg.id, prev))}
                          style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: '2px solid #e5e7eb',
                            background: 'white',
                            color: '#374151',
                            fontWeight: 600,
                            fontSize: '13px',
                            cursor: saving === msg.id ? 'not-allowed' : 'pointer',
                            opacity: saving === msg.id ? 0.7 : 1,
                          }}
                        >
                          Mark as read
                        </button>
                      )}
                      {(['new', 'reviewed', 'resolved'] as const).filter((s) => s !== msg.status).map((s) => (
                        <button
                          key={s}
                          disabled={saving === msg.id}
                          onClick={() => updateMessage(msg.id, s, notesInput[msg.id] ?? msg.notes)}
                          style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: `2px solid ${STATUS_COLORS[s].bg}`,
                            background: STATUS_COLORS[s].bg,
                            color: STATUS_COLORS[s].color,
                            fontWeight: 600,
                            fontSize: '13px',
                            cursor: saving === msg.id ? 'not-allowed' : 'pointer',
                            opacity: saving === msg.id ? 0.7 : 1,
                          }}
                        >
                          Mark {STATUS_LABELS[s]}
                        </button>
                      ))}
                      <button
                        disabled={saving === msg.id}
                        onClick={() => updateMessage(msg.id, msg.status, notesInput[msg.id] ?? msg.notes)}
                        style={{
                          padding: '8px 16px',
                          borderRadius: '8px',
                          border: `2px solid ${ADMIN_TINT_BORDER}`,
                          background: 'white',
                          color: ADMIN_ACCENT,
                          fontWeight: 600,
                          fontSize: '13px',
                          cursor: saving === msg.id ? 'not-allowed' : 'pointer',
                          opacity: saving === msg.id ? 0.7 : 1,
                          marginLeft: 'auto',
                        }}
                      >
                        {saving === msg.id ? 'Saving…' : 'Save Notes'}
                      </button>
                      <button
                        disabled={saving === msg.id}
                        onClick={() => deleteMessage(msg.id)}
                        style={{
                          padding: '8px 16px',
                          borderRadius: '8px',
                          border: '2px solid #fecaca',
                          background: '#fef2f2',
                          color: '#b91c1c',
                          fontWeight: 600,
                          fontSize: '13px',
                          cursor: saving === msg.id ? 'not-allowed' : 'pointer',
                          opacity: saving === msg.id ? 0.7 : 1,
                        }}
                      >
                        Delete
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
