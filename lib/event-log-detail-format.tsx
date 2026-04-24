import type { CSSProperties, ReactNode } from 'react';

const KEY_LABELS: Record<string, string> = {
  submittedRequest: 'Submitted request',
  selectedGuest: 'Guest on kiosk',
  searchQuery: 'Search query',
  firstName: 'First name',
  lastName: 'Last name',
  displayName: 'Display name',
  phoneNumber: 'Phone',
  clcNumber: 'CLC number',
  classType: 'Class',
  email: 'Email',
  roomID: 'Room ID',
  roomName: 'Room',
  roomNameHint: 'Room name hint',
  roomDisplayName: 'Room name',
  roomNumber: 'Room number',
  checkInDate: 'Check-in date',
  checkOutDate: 'Check-out date',
  checkoutDate: 'Checkout date',
  checkoutAtIso: 'Checkout time (ISO)',
  placeholderReservationID: 'Placeholder reservation',
  reservationID: 'Reservation ID',
  cloudbedsReservationID: 'Cloudbeds reservation ID',
  cloudbedsGuestID: 'Cloudbeds guest ID',
  guest: 'Guest',
  room: 'Room',
  cloudbedsFailure: 'Cloudbeds rejected request',
  networkError: 'Network error',
  isSameDay: 'Same-day stay',
  debugTrail: 'API trace',
  debugLog: 'API trace',
};

function labelForKey(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function isDebugStepArray(arr: unknown[]): boolean {
  if (arr.length === 0) return false;
  return arr.every(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof (item as { step?: unknown }).step === 'string'
  );
}

function formatDebugSteps(arr: unknown[]): ReactNode {
  return (
    <ol
      style={{
        margin: '6px 0 0',
        paddingLeft: '1.1rem',
        color: '#444',
        fontSize: '13px',
        lineHeight: 1.5,
      }}
    >
      {arr.map((raw, i) => {
        const row = raw as Record<string, unknown>;
        const step = typeof row.step === 'string' ? row.step.replace(/_/g, ' ') : `Step ${i + 1}`;
        const ok = row.ok;
        const note = typeof row.note === 'string' ? row.note : typeof row.reason === 'string' ? row.reason : '';
        const suffix =
          typeof ok === 'boolean' ? (ok ? ' — ok' : ' — failed') : note ? ` — ${note}` : '';
        return (
          <li key={i} style={{ marginBottom: '4px' }}>
            {step}
            {suffix}
          </li>
        );
      })}
    </ol>
  );
}

function renderScalar(v: unknown): ReactNode {
  if (v === null || v === undefined) {
    return <span style={{ color: '#9ca3af' }}>—</span>;
  }
  if (typeof v === 'boolean') {
    return v ? 'Yes' : 'No';
  }
  if (typeof v === 'number' || typeof v === 'string') {
    return String(v);
  }
  return null;
}

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 34%) 1fr',
  gap: '8px 16px',
  padding: '6px 0',
  borderBottom: '1px solid #eef0f3',
  fontSize: '14px',
  lineHeight: 1.45,
};
const dtStyle: CSSProperties = { color: '#6b7280', fontWeight: 500 };
const ddStyle: CSSProperties = { color: '#111827', wordBreak: 'break-word' };

function ObjectRows({ obj, depth }: { obj: Record<string, unknown>; depth: number }): ReactNode {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    return <p style={{ margin: 0, color: '#9ca3af', fontSize: '13px' }}>No fields.</p>;
  }

  return (
    <dl style={{ margin: 0 }}>
      {entries.map(([key, value]) => {
        const label = labelForKey(key);

        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          return (
            <div key={key} style={{ paddingTop: depth === 0 ? 8 : 4 }}>
              <div style={{ ...dtStyle, marginBottom: 6, fontSize: depth === 0 ? '13px' : '12px' }}>{label}</div>
              <div
                style={{
                  paddingLeft: depth === 0 ? 0 : 8,
                  borderLeft: depth > 0 ? '2px solid #e5e7eb' : undefined,
                  marginLeft: depth > 0 ? 4 : 0,
                }}
              >
                <ObjectRows obj={value as Record<string, unknown>} depth={depth + 1} />
              </div>
            </div>
          );
        }

        if (Array.isArray(value) && (key === 'debugTrail' || key === 'debugLog') && isDebugStepArray(value)) {
          return (
            <div key={key} style={{ padding: '8px 0', borderBottom: '1px solid #eef0f3' }}>
              <div style={{ ...dtStyle, marginBottom: 4 }}>{label}</div>
              {formatDebugSteps(value)}
            </div>
          );
        }

        if (Array.isArray(value)) {
          if (value.length === 0) {
            return (
              <div key={key} style={rowStyle}>
                <dt style={dtStyle}>{label}</dt>
                <dd style={ddStyle}>—</dd>
              </div>
            );
          }
          if (value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
            return (
              <div key={key} style={{ padding: '8px 0', borderBottom: '1px solid #eef0f3' }}>
                <div style={{ ...dtStyle, marginBottom: 6 }}>{label}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {value.map((item, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '8px 10px',
                        background: '#f9fafb',
                        borderRadius: 8,
                        border: '1px solid #eef0f3',
                      }}
                    >
                      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: 6 }}>Entry {i + 1}</div>
                      <ObjectRows obj={item as Record<string, unknown>} depth={depth + 1} />
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div key={key} style={{ padding: '8px 0', borderBottom: '1px solid #eef0f3' }}>
              <div style={{ ...dtStyle, marginBottom: 4 }}>{label}</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', color: '#374151', fontSize: '13px', listStyle: 'none' }}>
                {value.map((item, i) => (
                  <li key={i} style={{ marginBottom: 10 }}>
                    {item === null || item === undefined ? (
                      '—'
                    ) : typeof item === 'object' && !Array.isArray(item) ? (
                      <div style={{ marginLeft: -4 }}>
                        <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: 4 }}>Item {i + 1}</div>
                        <ObjectRows obj={item as Record<string, unknown>} depth={depth + 1} />
                      </div>
                    ) : (
                      String(item)
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        }

        const scalar = renderScalar(value);
        if (scalar !== null) {
          return (
            <div key={key} style={rowStyle}>
              <dt style={dtStyle}>{label}</dt>
              <dd style={ddStyle}>{scalar}</dd>
            </div>
          );
        }

        return (
          <div key={key} style={rowStyle}>
            <dt style={dtStyle}>{label}</dt>
            <dd style={ddStyle}>{String(value)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Renders stored event `detail` JSON as labeled rows (no raw JSON dump). */
export function EventDetailReadable({ detailJson }: { detailJson: string }): ReactNode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(detailJson);
  } catch {
    return (
      <p style={{ margin: 0, fontSize: '14px', color: '#6b7280', lineHeight: 1.5 }}>
        {detailJson.slice(0, 2000)}
        {detailJson.length > 2000 ? '…' : ''}
      </p>
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return <p style={{ margin: 0, fontSize: '14px', color: '#374151' }}>{String(parsed)}</p>;
  }

  return <ObjectRows obj={parsed as Record<string, unknown>} depth={0} />;
}
