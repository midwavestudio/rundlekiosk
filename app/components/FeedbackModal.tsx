'use client';

import { useState } from 'react';

interface FeedbackModalProps {
  onClose: () => void;
}

type Step = 'form' | 'success';

export default function FeedbackModal({ onClose }: FeedbackModalProps) {
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const MAX = 500;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!message.trim()) {
      setError('Please enter a message before sending.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), name: name.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Something went wrong.');
      }

      setStep('success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'white',
        borderRadius: '20px',
        padding: '40px',
        width: '100%',
        maxWidth: '520px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
        position: 'relative',
      }}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: '16px',
            right: '20px',
            background: 'none',
            border: 'none',
            fontSize: '24px',
            cursor: 'pointer',
            color: '#999',
            lineHeight: 1,
          }}
        >
          ×
        </button>

        {step === 'form' ? (
          <>
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
              <div style={{ fontSize: '40px', marginBottom: '10px' }}>💬</div>
              <h2 style={{ margin: 0, fontSize: '24px', color: '#333' }}>Leave us a message</h2>
              <p style={{ margin: '8px 0 0', color: '#666', fontSize: '15px' }}>
                Have feedback, a question, or spotted something off? Let us know.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#444', fontSize: '14px' }}>
                  Your Name / Room <span style={{ fontWeight: 400, color: '#999' }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jane Smith or Room 205"
                  maxLength={80}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    border: '2px solid #e5e7eb',
                    borderRadius: '10px',
                    fontSize: '16px',
                    boxSizing: 'border-box',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = '#8B6F47'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#e5e7eb'; }}
                />
              </div>

              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#444', fontSize: '14px' }}>
                  Message <span style={{ color: '#c0392b' }}>*</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
                  placeholder="Tell us what's on your mind…"
                  rows={5}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    border: '2px solid #e5e7eb',
                    borderRadius: '10px',
                    fontSize: '16px',
                    boxSizing: 'border-box',
                    resize: 'none',
                    fontFamily: 'inherit',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = '#8B6F47'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#e5e7eb'; }}
                />
                <div style={{ textAlign: 'right', fontSize: '12px', color: message.length >= MAX ? '#c0392b' : '#999', marginTop: '4px' }}>
                  {message.length} / {MAX}
                </div>
              </div>

              {error && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#c0392b',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  marginBottom: '16px',
                }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    flex: 1,
                    padding: '14px',
                    border: '2px solid #e5e7eb',
                    borderRadius: '10px',
                    background: 'white',
                    color: '#555',
                    fontSize: '16px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !message.trim()}
                  style={{
                    flex: 2,
                    padding: '14px',
                    border: 'none',
                    borderRadius: '10px',
                    background: submitting || !message.trim() ? '#c4a574' : '#8B6F47',
                    color: 'white',
                    fontSize: '16px',
                    fontWeight: 700,
                    cursor: submitting || !message.trim() ? 'not-allowed' : 'pointer',
                    transition: 'background 0.2s',
                  }}
                >
                  {submitting ? 'Sending…' : 'Send Message'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>✅</div>
            <h2 style={{ margin: 0, fontSize: '24px', color: '#333' }}>Message Sent!</h2>
            <p style={{ color: '#666', fontSize: '15px', margin: '12px 0 28px' }}>
              Thank you — our team will review your message shortly. If you need immediate help, please call the front desk at&nbsp;
              <a href="tel:+14062282800" style={{ color: '#8B6F47', fontWeight: 700, textDecoration: 'none' }}>
                (406)&nbsp;228-2800
              </a>.
            </p>
            <button
              onClick={onClose}
              style={{
                padding: '14px 40px',
                border: 'none',
                borderRadius: '10px',
                background: '#8B6F47',
                color: 'white',
                fontSize: '16px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
