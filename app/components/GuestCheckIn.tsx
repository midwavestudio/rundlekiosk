'use client';

import { useState, useEffect, useMemo } from 'react';
import { buildGuestSyntheticEmail } from '@/lib/guest-email';

interface GuestCheckInProps {
  onBack: () => void;
}

interface GuestData {
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  roomNumber: string;
  checkInTime: string;
  /** Always TYE for kiosk walk-in check-in */
  class: 'TYE';
  cloudbedsGuestID?: string;
  cloudbedsReservationID?: string;
}

interface Room {
  roomID: string;
  roomName: string;
  roomTypeName: string;
  /** Present when the room has a pre-created TYE placeholder reservation. */
  placeholderReservationID?: string;
}

/** Property-local calendar date from the kiosk (avoids UTC/server "tomorrow" drift on hosted APIs). */
function kioskLocalDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatStayNightLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function decodeCloudbedsUserMessage(msg: string): string {
  return msg.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export default function GuestCheckIn({ onBack }: GuestCheckInProps) {
  const [formData, setFormData] = useState<Omit<GuestData, 'class' | 'checkInTime'>>({
    firstName: '',
    lastName: '',
    clcNumber: '',
    phoneNumber: '',
    roomNumber: '',
  });
  const [success, setSuccess] = useState(false);
  /** When Cloudbeds could not book the physical room but created a paid confirmed stay (prior guest still in room). */
  const [successIsConfirmedOnly, setSuccessIsConfirmedOnly] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [captureDebugLog, setCaptureDebugLog] = useState(false);
  /** First night of stay: yesterday (late check-in) or tonight (default). */
  const [stayStartNight, setStayStartNight] = useState<'yesterday' | 'today'>('today');
  const [debugTrailForDeveloper, setDebugTrailForDeveloper] = useState<{
    requestRoom: string;
    response: any;
  } | null>(null);

  // Fetch available rooms on component mount
  useEffect(() => {
    const fetchAvailableRooms = async () => {
      try {
        const response = await fetch('/api/available-rooms');
        const data = await response.json();
        
        if (data.success) {
          setAvailableRooms(data.rooms);
        } else {
          console.error('Failed to fetch rooms:', data.error);
          setError('Unable to load available rooms. Please contact the front desk.');
        }
      } catch (error) {
        console.error('Error fetching rooms:', error);
        setError('Unable to load available rooms. Please contact the front desk.');
      } finally {
        setLoadingRooms(false);
      }
    };

    fetchAvailableRooms();
  }, []);

  const { yesterdayDate, todayDate, yesterdayYmd, todayYmd } = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      yesterdayDate: yesterday,
      todayDate: today,
      yesterdayYmd: kioskLocalDateYmd(yesterday),
      todayYmd: kioskLocalDateYmd(today),
    };
  }, []);

  const handleChange = (field: keyof Omit<GuestData, 'class' | 'checkInTime'>, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError('');
  };

  const formatPhoneNumber = (value: string) => {
    // Remove all non-numeric characters
    const cleaned = value.replace(/\D/g, '');
    
    // Format as (XXX) XXX-XXXX
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  };

  const handlePhoneChange = (value: string) => {
    const formatted = formatPhoneNumber(value);
    handleChange('phoneNumber', formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation (trim names so stray spaces do not break synthetic email / Cloudbeds)
    if (!formData.firstName.trim() || !formData.lastName.trim() || !formData.clcNumber || 
        !formData.phoneNumber || !formData.roomNumber) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let reservationConfirmedOnly = false;
      // Add timestamp (trim names for storage consistency with API)
      const checkInData: GuestData = {
        ...formData,
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        class: 'TYE',
        checkInTime: new Date().toISOString(),
      };

      // Call Cloudbeds API to create reservation and check in
      try {
        // Find the selected room (compare as strings so number/string from API doesn't break match)
        const selectedRoom = availableRooms.find(r => String(r.roomID) === String(formData.roomNumber));
        const roomIdentifier = selectedRoom ? selectedRoom.roomID : formData.roomNumber;
        
        console.log('Checking in with room:', { roomID: roomIdentifier, roomName: selectedRoom?.roomName });
        
        const checkInAnchor = new Date();
        if (stayStartNight === 'yesterday') {
          checkInAnchor.setDate(checkInAnchor.getDate() - 1);
        }
        const checkOutNight = new Date(checkInAnchor);
        checkOutNight.setDate(checkOutNight.getDate() + 1);
        const checkInYmd = kioskLocalDateYmd(checkInAnchor);
        const checkOutYmd = kioskLocalDateYmd(checkOutNight);
        // If the selected room has a pre-created TYE placeholder reservation, pass its ID.
        // The API will assign the placeholder to this guest instead of creating a new reservation.
        const placeholderReservationID = selectedRoom?.placeholderReservationID;

        const cloudbedsResponse = await fetch('/api/cloudbeds-checkin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            firstName: formData.firstName.trim(),
            lastName: formData.lastName.trim(),
            phoneNumber: formData.phoneNumber,
            roomName: roomIdentifier, // Cloudbeds room id from dropdown
            roomNameHint: selectedRoom?.roomName, // e.g. 308i — fallback if id shape differs in getRooms
            clcNumber: formData.clcNumber,
            classType: 'TYE',
            email: buildGuestSyntheticEmail(formData.firstName, formData.lastName),
            // One night: Cloudbeds rejects startDate === endDate ("could not accommodate…")
            checkInDate: checkInYmd,
            checkOutDate: checkOutYmd,
            // TYE placeholder path: skip postReservation and assign the existing booking
            ...(placeholderReservationID ? { placeholderReservationID } : {}),
            debug: captureDebugLog,
          }),
        });

        const responseText = await cloudbedsResponse.text();
        let cloudbedsResult: Record<string, unknown>;
        try {
          cloudbedsResult = JSON.parse(responseText) as Record<string, unknown>;
        } catch {
          throw new Error(
            cloudbedsResponse.ok
              ? 'Invalid response from check-in service'
              : `Check-in request failed (${cloudbedsResponse.status})`
          );
        }

        if (captureDebugLog && cloudbedsResult.debugTrail) {
          setDebugTrailForDeveloper({ requestRoom: roomIdentifier, response: cloudbedsResult });
        }

        if (!cloudbedsResponse.ok || cloudbedsResult.success !== true) {
          const apiMsg =
            (typeof cloudbedsResult.error === 'string' && cloudbedsResult.error) ||
            (typeof cloudbedsResult.message === 'string' && cloudbedsResult.message) ||
            '';
          throw new Error(
            decodeCloudbedsUserMessage(apiMsg || `Cloudbeds check-in failed (${cloudbedsResponse.status})`)
          );
        }

        console.log('Cloudbeds check-in successful:', cloudbedsResult);
        reservationConfirmedOnly = cloudbedsResult.reservationStatus === 'confirmed';
        setSuccessIsConfirmedOnly(reservationConfirmedOnly);
        checkInData.cloudbedsGuestID = cloudbedsResult.guestID as string | undefined;
        checkInData.cloudbedsReservationID = cloudbedsResult.reservationID as string | undefined;
      } catch (cloudbedsError: any) {
        throw cloudbedsError;
      }

      // Save to localStorage only for actual kiosk check-in — confirmed-only stays live in Cloudbeds until staff assigns the room.
      try {
        if (!reservationConfirmedOnly) {
          const existingGuests = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
          existingGuests.push(checkInData);
          localStorage.setItem('checkedInGuests', JSON.stringify(existingGuests));
        }
      } catch (storageErr) {
        console.warn('Could not save guest to local storage (check-in still completed):', storageErr);
      }

      setSuccess(true);
      
      // Return to home after 2 seconds
      setTimeout(() => {
        onBack();
      }, 2000);
    } catch (err: any) {
      const raw =
        typeof err?.message === 'string' && err.message.trim().length > 0
          ? err.message
          : 'Check-in failed. Please try again or contact the front desk.';
      setError(decodeCloudbedsUserMessage(raw));
      console.error('Check-in error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="kiosk-container">
        <div className="success-screen">
          <h1 className="animated-message">
            {successIsConfirmedOnly ? 'Reservation confirmed' : 'Enjoy your stay!'}
          </h1>
          {successIsConfirmedOnly && (
            <p style={{ marginTop: '16px', maxWidth: '420px', marginLeft: 'auto', marginRight: 'auto', fontSize: 'clamp(15px, 2.5vw, 18px)', lineHeight: 1.5, opacity: 0.95 }}>
              Your stay is paid and confirmed. The front desk will assign your room when it is available.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="kiosk-container">
      <div className="kiosk-header">
        <button className="back-link" onClick={onBack}>
          ← Back
        </button>
        <h1>Guest Check-In</h1>
        <p className="subtitle">Please fill in your information</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit} className="checkin-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="firstName">First Name *</label>
            <input
              type="text"
              id="firstName"
              value={formData.firstName}
              onChange={(e) => handleChange('firstName', e.target.value)}
              placeholder="John"
              required
              autoComplete="given-name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="lastName">Last Name *</label>
            <input
              type="text"
              id="lastName"
              value={formData.lastName}
              onChange={(e) => handleChange('lastName', e.target.value)}
              placeholder="Smith"
              required
              autoComplete="family-name"
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="clcNumber">CLC Number *</label>
          <input
            type="text"
            id="clcNumber"
            value={formData.clcNumber}
            onChange={(e) => handleChange('clcNumber', e.target.value)}
            placeholder="Enter your CLC number"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="phoneNumber">Phone Number *</label>
          <input
            type="tel"
            id="phoneNumber"
            value={formData.phoneNumber}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="(555) 123-4567"
            required
            autoComplete="tel"
          />
        </div>

        <div className="form-group">
          <label>Check-in night *</label>
          <p className="subtitle" style={{ marginTop: 0, marginBottom: '10px', fontSize: 'clamp(13px, 2vw, 15px)' }}>
            First night of the stay (checkout is the following calendar day).
          </p>
          <div className="class-selector">
            <button
              type="button"
              className={`class-button ${stayStartNight === 'yesterday' ? 'active' : ''}`}
              onClick={() => setStayStartNight('yesterday')}
            >
              Yesterday
              <span style={{ display: 'block', fontSize: '0.85em', opacity: 0.85, fontWeight: 400 }}>
                {formatStayNightLabel(yesterdayDate)} ({yesterdayYmd})
              </span>
            </button>
            <button
              type="button"
              className={`class-button ${stayStartNight === 'today' ? 'active' : ''}`}
              onClick={() => setStayStartNight('today')}
            >
              Today
              <span style={{ display: 'block', fontSize: '0.85em', opacity: 0.85, fontWeight: 400 }}>
                {formatStayNightLabel(todayDate)} ({todayYmd})
              </span>
            </button>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="roomNumber">Select Room Number *</label>
          {loadingRooms ? (
            <div style={{ padding: '12px', textAlign: 'center', color: '#666' }}>
              Loading available rooms...
            </div>
          ) : availableRooms.length === 0 ? (
            <div style={{ padding: '12px', textAlign: 'center', color: '#ef4444' }}>
              No rooms available. Please contact the front desk.
            </div>
          ) : (
            <select
              id="roomNumber"
              value={formData.roomNumber}
              onChange={(e) => handleChange('roomNumber', e.target.value)}
              required
              style={{
                width: '100%',
                padding: 'clamp(12px, 2vw, 16px)',
                border: '2px solid #e0e0e0',
                borderRadius: '10px',
                fontSize: 'clamp(16px, 2.5vw, 18px)',
                backgroundColor: 'white',
                cursor: 'pointer',
              }}
            >
              <option value="">-- Select a room --</option>
              {availableRooms.map((room) => (
                <option key={room.roomID} value={room.roomID}>
                  Room {room.roomName} ({room.roomTypeName}){room.placeholderReservationID ? ' ★' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: 'clamp(14px, 2vw, 16px)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={captureDebugLog}
            onChange={(e) => setCaptureDebugLog(e.target.checked)}
          />
          Capture response log for developer (use when room assignment is wrong)
        </label>

        <button type="submit" className="submit-button" disabled={loading || loadingRooms || availableRooms.length === 0}>
          {loading ? (
            <>
              Processing...
              <span className="loading"></span>
            </>
          ) : (
            'Complete Check-In'
          )}
        </button>
      </form>

      {debugTrailForDeveloper && (
        <div style={{ marginTop: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '8px', border: '1px solid #ddd' }}>
          <p style={{ margin: '0 0 8px 0', fontWeight: 600 }}>Response log for developer</p>
          <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#555' }}>
            Copy the text below and send it to your developer so they can see what Cloudbeds returned.
          </p>
          <textarea
            readOnly
            value={JSON.stringify(debugTrailForDeveloper, null, 2)}
            style={{ width: '100%', minHeight: '200px', fontFamily: 'monospace', fontSize: '12px', padding: '8px', boxSizing: 'border-box' }}
          />
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(debugTrailForDeveloper, null, 2));
              alert('Copied to clipboard. Send this to your developer.');
            }}
            style={{ marginTop: '8px', padding: '8px 16px', cursor: 'pointer' }}
          >
            Copy to clipboard
          </button>
          <button
            type="button"
            onClick={() => setDebugTrailForDeveloper(null)}
            style={{ marginTop: '8px', marginLeft: '8px', padding: '8px 16px', cursor: 'pointer' }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="kiosk-footer">
        <p>All fields marked with * are required</p>
      </div>
    </div>
  );
}

