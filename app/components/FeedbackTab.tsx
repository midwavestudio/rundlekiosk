'use client';

import { useState, useEffect, useCallback } from 'react';
import { ADMIN_ACCENT, ADMIN_TINT_BG, ADMIN_TINT_BORDER } from '../lib/adminTheme';

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

export default function FeedbackTab() {
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | FeedbackMessage['status']>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notesInput, setNotesInput] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

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

  const filtered = filter === 'all' ? messages : messages.filter((m) => m.status === filter);
  const newCount = messages.filter((m) => m.status === 'new').length;

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'clamp(20px, 2.5vw, 28px)', color: '#333' }}>
            Guest Feedback
            {newCount > 0 && (
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
                {newCount} new
              </span>
            )}
          </h2>
          <p style={{ margin: '4px 0 0', color: '#888', fontSize: '14px' }}>Messages submitted by guests through the kiosk</p>
        </div>
        <button
          onClick={fetchMessages}
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

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {(['all', 'new', 'reviewed', 'resolved'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 16px',
              borderRadius: '20px',
              border: filter === f ? `2px solid ${ADMIN_ACCENT}` : '2px solid #e5e7eb',
              background: filter === f ? ADMIN_TINT_BG : 'white',
              color: filter === f ? ADMIN_ACCENT : '#666',
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
        <div style={{ textAlign: 'center', padding: '60px', color: '#888' }}>Loading messages…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#c0392b' }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: '#aaa',
          background: '#f9fafb',
          borderRadius: '12px',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>💬</div>
          <p style={{ margin: 0, fontSize: '16px' }}>
            {filter === 'all' ? 'No feedback messages yet.' : `No ${filter} messages.`}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map((msg) => {
            const isExpanded = expandedId === msg.id;
            const sc = STATUS_COLORS[msg.status];
            const date = new Date(msg.submittedAt).toLocaleString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit',
            });

            return (
              <div
                key={msg.id}
                style={{
                  border: msg.status === 'new' ? `2px solid #f59e0b` : '2px solid #e5e7eb',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  background: 'white',
                  transition: 'box-shadow 0.2s',
                  boxShadow: isExpanded ? '0 4px 20px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                {/* Card header — always visible */}
                <div
                  style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}
                  onClick={() => setExpandedId(isExpanded ? null : msg.id)}
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
                        {STATUS_LABELS[msg.status]}
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
                  <span style={{ color: '#aaa', fontSize: '18px', flexShrink: 0, marginTop: '2px' }}>
                    {isExpanded ? '▲' : '▼'}
                  </span>
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

                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
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
