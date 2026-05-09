'use client';

import { useState, useEffect, useRef } from 'react';
import { buildGuestSyntheticEmail } from '@/lib/guest-email';
import { formatCloudbedsRoomNameLabel } from '@/lib/room-display';
import { ADMIN_ACCENT } from '../lib/adminTheme';

interface Room {
  roomID: string;
  roomName: string;
  roomTypeName: string;
  placeholderReservationID?: string;
}

interface FormData {
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  roomID: string;
  checkInDate: string;
  checkOutDate: string;
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  if (!y || !mo || !d) return ymd;
  const dt = new Date(y, mo - 1, d);
  dt.setDate(dt.getDate() + days);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

function decodeCloudbedsUserMessage(msg: string): string {
  return msg.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

const UNASSIGNED_ROOM_ID = '__UNASSIGNED__';

export default function AdminCheckInTab() {
  const submitStartedRef = useRef(false);
  const today = todayYmd();

  const [form, setForm] = useState<FormData>({
    firstName: '',
    lastName: '',
    clcNumber: '',
    phoneNumber: '',
    roomID: '',
    checkInDate: today,
    checkOutDate: addDaysYmd(today, 1),
  });

  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [roomsError, setRoomsError] = useState('');

  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [resultMsg, setResultMsg] = useState('');
  const [resultDetail, setResultDetail] = useState('');
  const [reservationStatus, setReservationStatus] = useState<'checked_in' | 'confirmed' | null>(null);
  /** Live progress message during submission ("Saving guest record…", "Creating reservation in Cloudbeds…", retry attempts). */
  const [submitProgress, setSubmitProgress] = useState('');

  // Fetch rooms whenever checkInDate changes (rooms vary by date)
  useEffect(() => {
    let cancelled = false;
    setLoadingRooms(true);
    setRoomsError('');

    const fetchRooms = async () => {
      try {
        const res = await fetch(`/api/available-rooms?date=${encodeURIComponent(form.checkInDate)}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          const filtered = Array.isArray(data.rooms)
            ? data.rooms.filter((r: Room) => {
                const id = String(r.roomID ?? '').trim().toUpperCase();
                const name = String(r.roomName ?? '').trim().toUpperCase().replace(/\s*\([^)]*\)\s*$/u, '');
                return id !== 'CON' && name !== 'CON' && !/^CON(?:$|[^A-Z0-9])/.test(name);
              })
            : [];
          setRooms(filtered);
        } else {
          setRoomsError('Could not load rooms. Check Cloudbeds connection.');
        }
      } catch {
        if (!cancelled) setRoomsError('Network error loading rooms.');
      } finally {
        if (!cancelled) setLoadingRooms(false);
      }
    };

    fetchRooms();
    return () => { cancelled = true; };
  }, [form.checkInDate]);

  const handleChange = (field: keyof FormData, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Always default checkout to next day when check-in date changes.
      if (field === 'checkInDate') {
        next.checkOutDate = addDaysYmd(value, 1);
        next.roomID = ''; // clear room when date changes
      }
      return next;
    });
    setStatus('idle');
  };

  const formatPhone = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  };

  const reset = () => {
    submitStartedRef.current = false;
    const newToday = todayYmd();
    setForm({
      firstName: '',
      lastName: '',
      clcNumber: '',
      phoneNumber: '',
      roomID: '',
      checkInDate: newToday,
      checkOutDate: addDaysYmd(newToday, 1),
    });
    setStatus('idle');
    setResultMsg('');
    setResultDetail('');
    setReservationStatus(null);
    setSubmitProgress('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitStartedRef.current) return;

    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    if (!firstName || !lastName || !form.clcNumber || !form.phoneNumber || !form.roomID) {
      setStatus('error');
      setResultMsg('Please fill in all fields and select a room.');
      return;
    }

    submitStartedRef.current = true;
    setStatus('submitting');
    setSubmitProgress('Saving guest record…');
    setResultMsg('');
    setResultDetail('');
    setReservationStatus(null);

    const isUnassigned = form.roomID === UNASSIGNED_ROOM_ID;
    const selectedRoom = isUnassigned ? null : rooms.find((r) => r.roomID === form.roomID);
    const email = buildGuestSyntheticEmail(firstName, lastName);
    const checkInTime = new Date().toISOString();

    // Step 1: Save the server-side check-in record FIRST so guest data is never lost,
    // even if Cloudbeds creation fails. Mirrors the kiosk pattern (see GuestCheckIn.tsx).
    let serverRecordId: string | null = null;
    try {
      const recordRes = await fetch('/api/checkin-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          clcNumber: form.clcNumber,
          phoneNumber: form.phoneNumber,
          class: 'TYE',
          roomNumber: isUnassigned ? 'Unassigned' : (selectedRoom?.roomName ?? form.roomID),
          checkInTime,
          checkInDateYmd: form.checkInDate,
          source: 'admin',
        }),
      });
      const recordData = await recordRes.json();
      if (recordData.success) serverRecordId = recordData.id as string;
    } catch {
      // Non-fatal — Cloudbeds attempt below still proceeds
    }

    // Step 2: Build the Cloudbeds request body
    let body: Record<string, unknown>;
    if (isUnassigned) {
      const typeHint = rooms[0]?.roomName ?? '';
      body = {
        firstName,
        lastName,
        phoneNumber: form.phoneNumber,
        clcNumber: form.clcNumber,
        classType: 'TYE',
        email,
        checkInDate: form.checkInDate,
        checkOutDate: form.checkOutDate,
        roomName: typeHint || 'UNASSIGNED',
        forceUnassigned: true,
      };
    } else {
      const placeholderReservationID = selectedRoom?.placeholderReservationID;
      body = {
        firstName,
        lastName,
        phoneNumber: form.phoneNumber,
        clcNumber: form.clcNumber,
        classType: 'TYE',
        email,
        checkInDate: form.checkInDate,
        checkOutDate: form.checkOutDate,
        roomName: selectedRoom ? selectedRoom.roomID : form.roomID,
        roomNameHint: selectedRoom?.roomName,
        ...(placeholderReservationID ? { placeholderReservationID } : {}),
      };
    }
    const requestBody = JSON.stringify(body);

    // Step 3: Call Cloudbeds with retry logic (mirrors kiosk pattern).
    // performCloudbedsCheckIn de-duplicates server-side via getReservations lookup,
    // so retrying after a 5xx will reuse an existing reservation rather than create a duplicate.
    const MAX_ATTEMPTS = 3;
    let attempt = 0;
    let lastErrorMsg = '';
    let lastErrorDetail = '';
    let cloudbedsData: any = null;
    let cloudbedsSucceeded = false;

    while (attempt < MAX_ATTEMPTS && !cloudbedsSucceeded) {
      if (attempt > 0) {
        setSubmitProgress(`Retrying Cloudbeds (attempt ${attempt + 1} of ${MAX_ATTEMPTS})…`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      } else {
        setSubmitProgress('Creating reservation in Cloudbeds…');
      }
      attempt += 1;

      try {
        // Client-side timeout (75s) protects against hung connections without
        // killing legitimate long fallback chains (server has maxDuration=60s).
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 75_000);
        const res = await fetch('/api/cloudbeds-checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
          signal: ac.signal,
        });
        clearTimeout(timer);

        const text = await res.text();
        let data: any = {};
        try { data = JSON.parse(text); } catch { /* non-JSON — treat as failure */ }

        if (res.ok && (data.success || data.mockMode)) {
          cloudbedsData = data;
          cloudbedsSucceeded = true;
          break;
        }

        lastErrorMsg =
          (typeof data.error === 'string' && data.error) ||
          (typeof data.message === 'string' && data.message) ||
          `Check-in failed (HTTP ${res.status})`;
        lastErrorDetail = typeof data.details === 'string' ? data.details : '';
      } catch (err: any) {
        lastErrorMsg = err?.name === 'AbortError'
          ? 'Cloudbeds request timed out — please try again.'
          : (err?.message ?? 'Network error');
        lastErrorDetail = '';
      }
    }

    // Step 4: Handle outcome
    if (cloudbedsSucceeded && cloudbedsData) {
      // PATCH server record with Cloudbeds IDs so admin lists show the linkage
      if (serverRecordId) {
        fetch('/api/checkin-records', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: serverRecordId,
            cloudbedsReservationID: cloudbedsData.reservationID,
            cloudbedsGuestID: cloudbedsData.guestID,
            ...(cloudbedsData.reservationStatus ? { reservationStatus: cloudbedsData.reservationStatus } : {}),
          }),
        }).catch(() => { /* non-fatal */ });
      }

      setReservationStatus(cloudbedsData.reservationStatus ?? null);
      setResultMsg(
        cloudbedsData.reservationStatus === 'confirmed'
          ? 'Reservation confirmed (unassigned). Staff must assign the room in Cloudbeds.'
          : `Check-in complete! Reservation ${cloudbedsData.reservationID ?? ''}`.trim()
      );
      setResultDetail(cloudbedsData.message ?? '');
      setStatus('success');
      setSubmitProgress('');
    } else {
      setResultMsg(decodeCloudbedsUserMessage(lastErrorMsg || 'Check-in failed.'));
      setResultDetail(
        (lastErrorDetail ? decodeCloudbedsUserMessage(lastErrorDetail) : '') +
        (serverRecordId ? ' Guest record was saved to admin records and can be retried.' : '')
      );
      setStatus('error');
      setSubmitProgress('');
      submitStartedRef.current = false;
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 13px',
    border: '1.5px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    boxSizing: 'border-box',
    outline: 'none',
    transition: 'border-color 0.15s',
    background: 'white',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: '#374151',
    marginBottom: '5px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  };

  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 0 };

  if (status === 'success') {
    const isConfirmedOnly = reservationStatus === 'confirmed';
    return (
      <div style={{ maxWidth: '520px', margin: '0 auto', paddingTop: '24px' }}>
        <div style={{
          background: isConfirmedOnly ? '#fffbeb' : '#f0fdf4',
          border: `2px solid ${isConfirmedOnly ? '#f59e0b' : '#22c55e'}`,
          borderRadius: '14px',
          padding: '32px 28px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '52px', marginBottom: '12px' }}>
            {isConfirmedOnly ? '🏷️' : '✅'}
          </div>
          <h2 style={{ margin: '0 0 10px', color: isConfirmedOnly ? '#92400e' : '#15803d', fontSize: '22px', fontWeight: 700 }}>
            {isConfirmedOnly ? 'Reservation Confirmed' : 'Check-In Complete'}
          </h2>
          <p style={{ margin: '0 0 6px', color: '#374151', fontSize: '15px' }}>{resultMsg}</p>
          {resultDetail && (
            <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: '13px' }}>{resultDetail}</p>
          )}
          {!resultDetail && <div style={{ marginBottom: '20px' }} />}
          <button
            onClick={reset}
            style={{
              padding: '10px 28px',
              background: ADMIN_ACCENT,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Check In Another Guest
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 700, color: '#111', letterSpacing: '-0.01em' }}>
          Admin Check-In
        </h2>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '13px' }}>
          Create a new Cloudbeds reservation from the admin. Supports any date and unassigned rooms.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Name row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>First Name *</label>
            <input
              style={inputStyle}
              type="text"
              value={form.firstName}
              onChange={(e) => handleChange('firstName', e.target.value)}
              placeholder="John"
              autoComplete="given-name"
              required
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Last Name *</label>
            <input
              style={inputStyle}
              type="text"
              value={form.lastName}
              onChange={(e) => handleChange('lastName', e.target.value)}
              placeholder="Smith"
              autoComplete="family-name"
              required
            />
          </div>
        </div>

        {/* CLC / Phone row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>CLC Number *</label>
            <input
              style={inputStyle}
              type="text"
              value={form.clcNumber}
              onChange={(e) => handleChange('clcNumber', e.target.value)}
              placeholder="CLC number"
              required
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Phone Number *</label>
            <input
              style={inputStyle}
              type="tel"
              value={form.phoneNumber}
              onChange={(e) => handleChange('phoneNumber', formatPhone(e.target.value))}
              placeholder="(555) 123-4567"
              autoComplete="tel"
              required
            />
          </div>
        </div>

        {/* Date row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Check-In Date *</label>
            <input
              style={inputStyle}
              type="date"
              value={form.checkInDate}
              onChange={(e) => handleChange('checkInDate', e.target.value)}
              required
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Check-Out Date *</label>
            <input
              style={inputStyle}
              type="date"
              value={form.checkOutDate}
              min={addDaysYmd(form.checkInDate, 1)}
              onChange={(e) => handleChange('checkOutDate', e.target.value)}
              required
            />
          </div>
        </div>

        {/* Room selector */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Room *</label>
          {loadingRooms ? (
            <div style={{ padding: '10px 0', color: '#9ca3af', fontSize: '13px' }}>Loading rooms for {form.checkInDate}…</div>
          ) : roomsError ? (
            <div style={{ padding: '10px 0', color: '#dc2626', fontSize: '13px' }}>{roomsError}</div>
          ) : (
            <select
              value={form.roomID}
              onChange={(e) => handleChange('roomID', e.target.value)}
              required
              style={{
                ...inputStyle,
                cursor: 'pointer',
                appearance: 'auto',
              }}
            >
              <option value="">— Select a room —</option>
              <option value={UNASSIGNED_ROOM_ID}>Unassigned (no room)</option>
              {rooms.map((room) => (
                <option key={room.roomID} value={room.roomID}>
                  {formatCloudbedsRoomNameLabel(room.roomName)}
                  {room.placeholderReservationID ? ' ★' : ''}
                </option>
              ))}
            </select>
          )}
          {form.roomID === UNASSIGNED_ROOM_ID && (
            <p style={{ margin: '5px 0 0', fontSize: '12px', color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px', padding: '6px 10px' }}>
              The reservation will be created without a physical room. Staff must assign a room in Cloudbeds.
            </p>
          )}
        </div>

        {/* Error banner */}
        {status === 'error' && (
          <div style={{
            background: '#fef2f2',
            border: '1.5px solid #fca5a5',
            borderRadius: '8px',
            padding: '10px 14px',
            color: '#991b1b',
            fontSize: '13px',
          }}>
            <strong>Error:</strong> {resultMsg}
            {resultDetail && <div style={{ marginTop: '4px', opacity: 0.75 }}>{resultDetail}</div>}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={status === 'submitting' || loadingRooms}
          style={{
            padding: '13px',
            background: status === 'submitting' ? '#a0855a' : ADMIN_ACCENT,
            color: 'white',
            border: 'none',
            borderRadius: '9px',
            fontSize: '15px',
            fontWeight: 700,
            cursor: status === 'submitting' ? 'not-allowed' : 'pointer',
            letterSpacing: '0.01em',
            transition: 'background 0.15s',
          }}
        >
          {status === 'submitting' ? (submitProgress || 'Creating reservation…') : 'Complete Check-In'}
        </button>
      </form>
    </div>
  );
}
