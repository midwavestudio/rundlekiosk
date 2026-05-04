'use client';

import { useState } from 'react';

/**
 * BackupButton — triggers a full download of all check-in records as JSON.
 *
 * Calls GET /api/checkin-records/backup which returns the file directly from
 * Firestore. No existing data is modified; this is purely a read operation.
 */
export default function BackupButton() {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleBackup = async () => {
    if (state === 'loading') return;
    setState('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/checkin-records/backup');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server returned ${res.status}`);
      }

      // Extract filename from Content-Disposition if present
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? 'checkin-records-backup.json';

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setState('done');
      setTimeout(() => setState('idle'), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Download failed');
      setState('error');
      setTimeout(() => setState('idle'), 5000);
    }
  };

  const isLoading = state === 'loading';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <button
        type="button"
        onClick={handleBackup}
        disabled={isLoading}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '7px',
          padding: '8px 16px',
          borderRadius: '8px',
          border: '1.5px solid #d1d5db',
          background: state === 'done' ? '#d1fae5' : '#fff',
          color: state === 'done' ? '#065f46' : '#374151',
          fontSize: '13px',
          fontWeight: 600,
          cursor: isLoading ? 'not-allowed' : 'pointer',
          opacity: isLoading ? 0.65 : 1,
          transition: 'background 0.2s, color 0.2s',
          whiteSpace: 'nowrap',
          width: 'fit-content',
        }}
        title="Download a full JSON backup of all check-in and departure records"
      >
        {isLoading ? (
          <>
            <span
              style={{
                display: 'inline-block',
                width: '13px',
                height: '13px',
                border: '2px solid #9ca3af',
                borderTopColor: '#374151',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
              }}
            />
            Exporting…
          </>
        ) : state === 'done' ? (
          <>&#10003; Backup downloaded</>
        ) : (
          <>&#11015; Download Backup</>
        )}
      </button>

      {state === 'error' && (
        <p style={{ margin: 0, fontSize: '12px', color: '#dc2626' }}>
          {errorMsg}
        </p>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
