'use client';

import { useState, useEffect, useMemo } from 'react';

interface GuestCheckOutProps {
  onBack: () => void;
}

/** Matches what GuestCheckIn saves to localStorage (fields may be missing on older entries). */
interface CheckedInGuest {
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  roomNumber?: string;
  class: 'TYE' | 'MOW' | '';
  checkInTime: string;
  cloudbedsGuestID?: string;
  cloudbedsReservationID?: string;
}

function guestKey(g: CheckedInGuest): string {
  return `${g.firstName}|${g.lastName}|${g.checkInTime}`;
}

function roomLabel(g: CheckedInGuest): string {
  if (g.roomNumber && String(g.roomNumber).trim() !== '') {
    return String(g.roomNumber);
  }
  return '—';
}

export default function GuestCheckOut({ onBack }: GuestCheckOutProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [checkedInGuests, setCheckedInGuests] = useState<CheckedInGuest[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<CheckedInGuest | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('checkedInGuests');
      const guests = JSON.parse(raw || '[]') as CheckedInGuest[];
      setCheckedInGuests(Array.isArray(guests) ? guests : []);
    } catch {
      setCheckedInGuests([]);
    }
  }, []);

  const filteredGuests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) {
      return [];
    }
    const qDigits = q.replace(/\D/g, '');
    return checkedInGuests.filter((guest) => {
      const fn = (guest.firstName || '').toLowerCase();
      const ln = (guest.lastName || '').toLowerCase();
      const full = `${fn} ${ln}`.trim();
      const room = (guest.roomNumber != null ? String(guest.roomNumber) : '').toLowerCase();
      const roomDigits = room.replace(/\D/g, '');
      return (
        full.includes(q) ||
        fn.includes(q) ||
        ln.includes(q) ||
        room.includes(q) ||
        (qDigits.length > 0 && roomDigits.includes(qDigits))
      );
    });
  }, [searchQuery, checkedInGuests]);

  const handleCheckOut = async () => {
    if (!selectedGuest) return;

    setLoading(true);
    setError('');

    try {
      const reservationId = selectedGuest.cloudbedsReservationID;
      if (reservationId) {
        const res = await fetch('/api/cloudbeds-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reservationID: reservationId }),
        });
        const text = await res.text();
        let data: { success?: boolean; error?: string; message?: string } = {};
        try {
          data = JSON.parse(text);
        } catch {
          data = {};
        }
        if (!res.ok || data.success !== true) {
          throw new Error(data.error || data.message || `Check-out failed (${res.status})`);
        }
      }

      const checkOutData = {
        ...selectedGuest,
        checkOutTime: new Date().toISOString(),
      };

      const updatedGuests = checkedInGuests.filter(
        (g) => guestKey(g) !== guestKey(selectedGuest)
      );
      try {
        localStorage.setItem('checkedInGuests', JSON.stringify(updatedGuests));
      } catch (e) {
        console.warn('Could not update checked-in list in storage:', e);
      }

      try {
        const checkOutHistory = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
        checkOutHistory.push(checkOutData);
        localStorage.setItem('checkOutHistory', JSON.stringify(checkOutHistory));
      } catch (e) {
        console.warn('Could not save checkout history:', e);
      }

      setSuccess(true);

      setTimeout(() => {
        onBack();
      }, 2000);
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Check-out failed. Please try again or contact the front desk.';
      setError(msg);
      console.error('Check-out error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (success && selectedGuest) {
    return (
      <div className="kiosk-container">
        <div className="success-screen">
          <h1 className="animated-message">Thank you for staying with us!</h1>
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
        <h1>Guest Check-Out</h1>
        <p className="subtitle">Search by your name or room number</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="checkout-search">
        <div className="form-group">
          <label htmlFor="search">Search</label>
          <input
            type="text"
            id="search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setError('');
              setSelectedGuest(null);
            }}
            placeholder="Type first name, last name, or room (e.g. 219)…"
            autoFocus
            autoComplete="off"
          />
        </div>

        {searchQuery.trim().length >= 2 && filteredGuests.length === 0 && checkedInGuests.length > 0 && (
          <div className="no-results">
            <p>No guests found matching &quot;{searchQuery.trim()}&quot;</p>
            <p className="no-results-help">
              Try another spelling, or search by room number. Contact the front desk if you need help.
            </p>
          </div>
        )}

        {searchQuery.trim().length > 0 && searchQuery.trim().length < 2 && (
          <p className="no-results-help" style={{ marginTop: '8px' }}>
            Enter at least 2 characters to search.
          </p>
        )}

        {filteredGuests.length > 0 && (
          <div className="guest-list">
            <p className="guest-list-title">Select your stay:</p>
            {filteredGuests.map((guest) => {
              const selected =
                selectedGuest !== null && guestKey(selectedGuest) === guestKey(guest);
              return (
                <button
                  key={guestKey(guest)}
                  type="button"
                  className={`guest-card ${selected ? 'selected' : ''}`}
                  onClick={() => setSelectedGuest(guest)}
                >
                  <div className="guest-info">
                    <div className="guest-name">
                      {guest.firstName} {guest.lastName}
                    </div>
                    <div className="guest-details">
                      Room: {roomLabel(guest)} • CLC: {guest.clcNumber} • Class: {guest.class || '—'}
                    </div>
                    <div className="guest-details">
                      Checked in: {new Date(guest.checkInTime).toLocaleString()}
                    </div>
                  </div>
                  {selected && <div className="selected-check">Selected</div>}
                </button>
              );
            })}
          </div>
        )}

        {selectedGuest && (
          <button
            className="submit-button checkout-confirm"
            type="button"
            onClick={handleCheckOut}
            disabled={loading}
          >
            {loading ? (
              <>
                Processing...
                <span className="loading"></span>
              </>
            ) : (
              'Confirm Check-Out'
            )}
          </button>
        )}

        {checkedInGuests.length === 0 && !searchQuery && (
          <div className="no-guests">
            <p>No guests are currently checked in on this kiosk.</p>
            <p className="no-guests-help">
              If you checked in at the front desk only, please see staff to check out.
            </p>
          </div>
        )}
      </div>

      <div className="kiosk-footer">
        <p>Need help? Please contact the front desk</p>
      </div>
    </div>
  );
}
