'use client';

import { useState, useEffect, useRef } from 'react';
import { buildGuestSyntheticEmail } from '@/lib/guest-email';
import { formatCloudbedsRoomNameLabel, kioskPersistRoomDisplayName } from '@/lib/room-display';

interface GuestCheckInProps {
  onBack: () => void;
  onOpenFeedback?: () => void;
}

function postKioskEvent(
  source: 'kiosk:check-in' | 'kiosk:check-in-rooms',
  message: string,
  detail?: Record<string, unknown>
) {
  if (typeof window === 'undefined') return;
  void fetch('/api/event-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, level: 'error', message, detail }),
  }).catch(() => {});
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

function decodeCloudbedsUserMessage(msg: string): string {
  return msg.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export default function GuestCheckIn({ onBack, onOpenFeedback }: GuestCheckInProps) {
  /** Prevents double-submit (parallel check-ins created duplicate Cloudbeds reservations). */
  const submitStartedRef = useRef(false);
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
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  // Fetch available rooms on component mount
  useEffect(() => {
    const fetchAvailableRooms = async () => {
      try {
        const kioskToday = kioskLocalDateYmd(new Date());
        const response = await fetch(
          `/api/available-rooms?date=${encodeURIComponent(kioskToday)}`
        );
        const data = await response.json();
        
        if (data.success) {
          setAvailableRooms(data.rooms);
        } else {
          console.error('Failed to fetch rooms:', data.error);
          setError('Unable to load available rooms. Please contact the front desk.');
          postKioskEvent(
            'kiosk:check-in-rooms',
            typeof data.error === 'string' ? data.error : 'Failed to load available rooms',
            { api: 'available-rooms', success: data.success === false }
          );
        }
      } catch (error) {
        console.error('Error fetching rooms:', error);
        setError('Unable to load available rooms. Please contact the front desk.');
        postKioskEvent('kiosk:check-in-rooms', 'Network or server error loading rooms', {
          api: 'available-rooms',
        });
      } finally {
        setLoadingRooms(false);
      }
    };

    fetchAvailableRooms();
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields individually for clear error messages.
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      setError('Please enter your first and last name.');
      return;
    }
    if (!formData.clcNumber.trim()) {
      setError('Failed to check in: Please enter your CLC number.');
      return;
    }
    // Require a complete 10-digit phone number: formatted as (XXX) XXX-XXXX → 14 chars,
    // or at minimum 10 raw digits.
    const rawDigits = formData.phoneNumber.replace(/\D/g, '');
    if (!formData.phoneNumber.trim() || rawDigits.length < 10) {
      setError('A valid 10-digit phone number is required.');
      return;
    }
    if (!formData.roomNumber) {
      setError('Please select a room.');
      return;
    }

    if (submitStartedRef.current) return;
    submitStartedRef.current = true;

    setError('');

    // Snapshot the form values right away so background work is independent
    // from any later UI updates.
    const firstName = formData.firstName.trim();
    const lastName = formData.lastName.trim();
    const phoneNumber = formData.phoneNumber;
    const clcNumber = formData.clcNumber.trim();
    const roomNumber = formData.roomNumber;

    // Show success immediately — guest does not need to wait on any storage/network work.
    setSuccess(true);
    setTimeout(() => { onBack(); }, 2000);

    // Move all heavy and network work off this synchronous click path.
    window.setTimeout(() => {
      void (async () => {
        // Match dropdown value (Cloudbeds roomID) to the row so we persist human roomName for lists/exports.
        const selectedRoom = availableRooms.find((r) => String(r.roomID) === String(roomNumber));

        // Derive all date/time values from a single anchor so checkInTime and checkInDateYmd
        // are always consistent. Using kioskLocalDateYmd prevents UTC-offset date drift where
        // a late-night check-in (e.g. 10:59 PM local) would produce a next-day UTC date.
        const checkInAnchor = new Date();
        const checkInTime = checkInAnchor.toISOString();
        const checkInYmd = kioskLocalDateYmd(checkInAnchor);
        const checkOutNight = new Date(checkInAnchor);
        checkOutNight.setDate(checkOutNight.getDate() + 1);
        const checkOutYmd = kioskLocalDateYmd(checkOutNight);

        const checkInData: GuestData = {
          firstName,
          lastName,
          clcNumber,
          phoneNumber,
          class: 'TYE',
          checkInTime,
          roomNumber: kioskPersistRoomDisplayName(selectedRoom, roomNumber),
        };

        // Persist the guest record to arrivals first.
        try {
          const existingGuests = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
          existingGuests.push(checkInData);
          localStorage.setItem('checkedInGuests', JSON.stringify(existingGuests));
        } catch (storageErr) {
          console.warn('Could not pre-save guest to local storage:', storageErr);
        }

        const roomIdentifier = selectedRoom ? selectedRoom.roomID : roomNumber;
        console.log('Checking in with room:', { roomID: roomIdentifier, roomName: selectedRoom?.roomName });
        const placeholderReservationID = selectedRoom?.placeholderReservationID;

        const submittedFields = {
          firstName,
          lastName,
          phoneNumber,
          clcNumber,
          classType: 'TYE' as const,
          email: buildGuestSyntheticEmail(firstName, lastName),
          roomID: roomIdentifier,
          roomDisplayName: selectedRoom?.roomName,
          checkInDate: checkInYmd,
          checkOutDate: checkOutYmd,
          ...(placeholderReservationID ? { placeholderReservationID } : {}),
        };

        // Save to server-side store so all admin devices see this check-in.
        // IMPORTANT: if this fails, we log ALL guest data to the event log so no check-in is ever silently lost.
        let serverRecordId: string | null = null;
        try {
          const serverRes = await fetch('/api/checkin-records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...checkInData, checkInDateYmd: checkInYmd, source: 'kiosk' }),
          });
          const serverData = await serverRes.json();
          if (serverData.success) {
            serverRecordId = serverData.id as string;
          } else {
            // Server rejected the record — log every field so it can be manually recovered.
            postKioskEvent('kiosk:check-in', `Check-in record failed to save to database: ${serverData.error ?? 'unknown error'}`, {
              ...submittedFields,
              checkInTime,
              roomDisplayName: selectedRoom?.roomName ?? roomIdentifier,
              serverRecordFailure: true,
            });
          }
        } catch (serverErr: any) {
          // Network error reaching the server record API — log so data is never lost.
          postKioskEvent('kiosk:check-in', `Check-in record could not be saved (network error): ${serverErr?.message ?? 'unknown'}`, {
            ...submittedFields,
            checkInTime,
            roomDisplayName: selectedRoom?.roomName ?? roomIdentifier,
            serverRecordFailure: true,
          });
        }

        // Attempt Cloudbeds check-in with automatic retry (up to 3 attempts, exponential backoff).
        // Retries handle transient network errors, service worker interference in PWA mode,
        // and brief Cloudbeds API unavailability without ever losing a reservation.
        const cloudbedsCheckInBody = JSON.stringify({
          firstName,
          lastName,
          phoneNumber,
          roomName: roomIdentifier,
          roomNameHint: selectedRoom?.roomName,
          clcNumber,
          classType: 'TYE',
          email: buildGuestSyntheticEmail(firstName, lastName),
          checkInDate: checkInYmd,
          checkOutDate: checkOutYmd,
          ...(placeholderReservationID ? { placeholderReservationID } : {}),
        });

        const MAX_CHECKIN_ATTEMPTS = 3;
        let cloudbedsAttempt = 0;
        let cloudbedsSucceeded = false;

        while (cloudbedsAttempt < MAX_CHECKIN_ATTEMPTS && !cloudbedsSucceeded) {
          if (cloudbedsAttempt > 0) {
            // Exponential backoff: 2s, 4s before 2nd and 3rd attempts.
            await new Promise((r) => setTimeout(r, 2000 * cloudbedsAttempt));
          }
          cloudbedsAttempt += 1;
          try {
            const cloudbedsResponse = await fetch('/api/cloudbeds-checkin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: cloudbedsCheckInBody,
            });

            const responseText = await cloudbedsResponse.text();
            let cloudbedsResult: Record<string, unknown> = {};
            try {
              cloudbedsResult = JSON.parse(responseText) as Record<string, unknown>;
            } catch { /* non-JSON response — treat as failure below */ }

            if (!cloudbedsResponse.ok || cloudbedsResult.success !== true) {
              const errMsg =
                (typeof cloudbedsResult.error === 'string' && cloudbedsResult.error) ||
                (typeof cloudbedsResult.message === 'string' && cloudbedsResult.message) ||
                `Cloudbeds check-in failed (HTTP ${cloudbedsResponse.status})`;

              // Retry on any failure — after a failed postReservation the server may reuse an
              // existing booking only when guest + stay + same room match (network retry).
              // Same guest name on a different room always gets a new reservation.
              if (cloudbedsAttempt < MAX_CHECKIN_ATTEMPTS) {
                console.warn(`[CHECK-IN] Cloudbeds attempt ${cloudbedsAttempt} failed (retrying):`, errMsg);
                continue;
              }

              console.error('[CHECK-IN] Cloudbeds failure logged to admin, not shown to guest:', errMsg);
              postKioskEvent('kiosk:check-in', decodeCloudbedsUserMessage(errMsg), {
                ...submittedFields,
                cloudbedsFailure: true,
                attempts: cloudbedsAttempt,
              });
            } else {
              cloudbedsSucceeded = true;
              console.log(`Cloudbeds check-in successful (attempt ${cloudbedsAttempt}):`, cloudbedsResult);
              const guestID = cloudbedsResult.guestID as string | undefined;
              const reservationID = cloudbedsResult.reservationID as string | undefined;
              const reservationStatus = cloudbedsResult.reservationStatus as string | undefined;
              try {
                const stored: GuestData[] = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
                const idx = stored.findLastIndex((g) => g.checkInTime === checkInTime);
                if (idx >= 0) {
                  stored[idx] = { ...stored[idx], cloudbedsGuestID: guestID, cloudbedsReservationID: reservationID };
                  localStorage.setItem('checkedInGuests', JSON.stringify(stored));
                }
              } catch { /* non-fatal */ }
              if (serverRecordId) {
                fetch('/api/checkin-records', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    id: serverRecordId,
                    cloudbedsReservationID: reservationID,
                    cloudbedsGuestID: guestID,
                    ...(reservationStatus ? { reservationStatus } : {}),
                  }),
                }).catch(() => {});
              }
            }
          } catch (cloudbedsErr: any) {
            const errMsg = cloudbedsErr?.message || 'Network error during Cloudbeds check-in';
            if (cloudbedsAttempt < MAX_CHECKIN_ATTEMPTS) {
              console.warn(`[CHECK-IN] Network error on attempt ${cloudbedsAttempt} (retrying):`, errMsg);
              continue;
            }
            console.error('[CHECK-IN] Network error logged to admin, not shown to guest:', errMsg);
            postKioskEvent('kiosk:check-in', errMsg, {
              ...submittedFields,
              networkError: true,
              attempts: cloudbedsAttempt,
            });
          }
        }
      })();
    }, 0);
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
          {formData.phoneNumber && formData.phoneNumber.replace(/\D/g, '').length < 10 && (
            <span style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: '#ef4444', marginTop: '4px', display: 'block' }}>
              Please enter a complete 10-digit phone number.
            </span>
          )}
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
                  {formatCloudbedsRoomNameLabel(room.roomName)}{room.placeholderReservationID ? ' ★' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="submit"
          className="submit-button"
          disabled={
            loadingRooms ||
            availableRooms.length === 0 ||
            !formData.clcNumber.trim() ||
            formData.phoneNumber.replace(/\D/g, '').length < 10
          }
        >
          Complete Check-In
        </button>
      </form>

      <div className="kiosk-footer">
        <p>Please remember to check out</p>
        {onOpenFeedback && (
          <div className="kiosk-footer-feedback">
            <p>Any issues?</p>
            <button type="button" className="kiosk-feedback-button" onClick={onOpenFeedback}>
              💬 Leave us a message
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

