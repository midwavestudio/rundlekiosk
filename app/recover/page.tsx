'use client';

import { useState, useEffect } from 'react';

interface SyncResult {
  total: number;
  created: number;
  updated: number;
  failed: number;
  records: { name: string; checkInTime: string; status: 'created' | 'updated' | 'failed' }[];
}

export default function RecoverPage() {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'syncing' | 'done' | 'error'>('idle');
  const [localCount, setLocalCount] = useState<{ checkedIn: number; history: number } | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Scan localStorage on load to show what's available
  useEffect(() => {
    try {
      const checkedIn = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
      const history = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
      setLocalCount({ checkedIn: checkedIn.length, history: history.length });
    } catch {
      setLocalCount({ checkedIn: 0, history: 0 });
    }
  }, []);

  const handleSync = async () => {
    setStatus('scanning');
    setErrorMsg('');
    setResult(null);

    let checkedIn: any[] = [];
    let history: any[] = [];
    try {
      checkedIn = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
      history = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
    } catch (e) {
      setStatus('error');
      setErrorMsg('Could not read localStorage. Make sure you are on the kiosk device.');
      return;
    }

    const all = [...checkedIn, ...history];
    if (all.length === 0) {
      setStatus('done');
      setResult({ total: 0, created: 0, updated: 0, failed: 0, records: [] });
      return;
    }

    setStatus('syncing');

    try {
      const res = await fetch('/api/checkin-records/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: all }),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Sync failed');

      const records: SyncResult['records'] = data.results.map((r: any, i: number) => {
        const raw = all[i] ?? {};
        const name = `${raw.firstName ?? ''} ${raw.lastName ?? ''}`.trim() || 'Guest';
        const checkInTime = raw.checkInTime
          ? new Date(raw.checkInTime).toLocaleString('en-US', {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
            })
          : '—';
        const status: 'created' | 'updated' | 'failed' =
          r.error ? 'failed' : r.created ? 'created' : 'updated';
        return { name, checkInTime, status };
      });

      setResult({
        total: all.length,
        created: data.created ?? 0,
        updated: data.updated ?? 0,
        failed: records.filter((r) => r.status === 'failed').length,
        records,
      });
      setStatus('done');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err?.message || 'Unknown error');
    }
  };

  const total = (localCount?.checkedIn ?? 0) + (localCount?.history ?? 0);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      boxSizing: 'border-box',
    }}>
      <div style={{
        background: 'white',
        borderRadius: '20px',
        padding: '40px',
        maxWidth: '560px',
        width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: 700, color: '#111' }}>
          Kiosk Data Recovery
        </h1>
        <p style={{ margin: '0 0 32px', color: '#6b7280', fontSize: '15px' }}>
          Open this page <strong>on the kiosk iPad</strong> to upload all local check-in records to Firestore so they appear in the admin dashboard.
        </p>

        {/* Local data summary */}
        {localCount !== null && status === 'idle' && (
          <div style={{
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '24px',
          }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '12px' }}>
              Records found on this device
            </div>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              <Pill label="Active check-ins" count={localCount.checkedIn} color="#667eea" />
              <Pill label="Checkout history" count={localCount.history} color="#8b5cf6" />
              <Pill label="Total" count={total} color="#10b981" />
            </div>
            {total === 0 && (
              <p style={{ margin: '12px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                No local records found. Either this is not the kiosk device, or data was already synced.
              </p>
            )}
          </div>
        )}

        {/* Action button */}
        {status === 'idle' && (
          <button
            onClick={handleSync}
            disabled={total === 0}
            style={{
              width: '100%',
              padding: '16px',
              background: total > 0 ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#e5e7eb',
              color: total > 0 ? 'white' : '#9ca3af',
              border: 'none',
              borderRadius: '12px',
              fontSize: '16px',
              fontWeight: 700,
              cursor: total > 0 ? 'pointer' : 'not-allowed',
              boxShadow: total > 0 ? '0 4px 14px rgba(102,126,234,0.4)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            Upload {total > 0 ? `${total} record${total !== 1 ? 's' : ''} to Firestore` : 'No records to upload'}
          </button>
        )}

        {/* Scanning / syncing states */}
        {(status === 'scanning' || status === 'syncing') && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Spinner />
            <p style={{ margin: '16px 0 0', color: '#6b7280', fontSize: '15px' }}>
              {status === 'scanning' ? 'Reading local data…' : `Uploading ${total} record${total !== 1 ? 's' : ''} to Firestore…`}
            </p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '16px',
          }}>
            <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: '6px' }}>Sync failed</div>
            <div style={{ color: '#dc2626', fontSize: '14px' }}>{errorMsg}</div>
          </div>
        )}
        {status === 'error' && (
          <button
            onClick={() => setStatus('idle')}
            style={{
              width: '100%', padding: '12px', background: '#f3f4f6', border: 'none',
              borderRadius: '10px', cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: '#374151',
            }}
          >
            Try again
          </button>
        )}

        {/* Done */}
        {status === 'done' && result && (
          <div>
            <div style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '20px',
              display: 'flex',
              gap: '16px',
              flexWrap: 'wrap',
            }}>
              <Pill label="Created" count={result.created} color="#10b981" />
              <Pill label="Updated" count={result.updated} color="#3b82f6" />
              {result.failed > 0 && <Pill label="Failed" count={result.failed} color="#ef4444" />}
            </div>

            {result.total === 0 ? (
              <p style={{ color: '#6b7280', textAlign: 'center', margin: 0 }}>
                Nothing to sync — localStorage is empty on this device.
              </p>
            ) : (
              <>
                <p style={{ fontSize: '14px', color: '#374151', fontWeight: 600, marginBottom: '10px' }}>
                  Records synced:
                </p>
                <div style={{
                  maxHeight: '280px', overflowY: 'auto',
                  border: '1px solid #e5e7eb', borderRadius: '10px',
                }}>
                  {result.records.map((r, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 14px',
                        borderBottom: i < result.records.length - 1 ? '1px solid #f3f4f6' : 'none',
                        background: i % 2 === 0 ? '#fff' : '#fafafa',
                      }}
                    >
                      <span style={{
                        fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px',
                        background:
                          r.status === 'created' ? '#d1fae5' :
                          r.status === 'updated' ? '#dbeafe' : '#fee2e2',
                        color:
                          r.status === 'created' ? '#065f46' :
                          r.status === 'updated' ? '#1e40af' : '#991b1b',
                        flexShrink: 0,
                        minWidth: '52px',
                        textAlign: 'center',
                      }}>
                        {r.status}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: '14px', color: '#111', flex: 1 }}>{r.name}</span>
                      <span style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap' }}>{r.checkInTime}</span>
                    </div>
                  ))}
                </div>
                <p style={{ marginTop: '16px', fontSize: '13px', color: '#6b7280', textAlign: 'center' }}>
                  All done — check the <strong>Arrivals</strong> tab in the admin dashboard.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Pill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
      <span style={{ fontSize: '24px', fontWeight: 700, color }}>{count}</span>
      <span style={{ fontSize: '12px', color: '#6b7280' }}>{label}</span>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: '40px', height: '40px', margin: '0 auto',
      border: '4px solid #e5e7eb',
      borderTop: '4px solid #667eea',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
