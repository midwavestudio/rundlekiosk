'use client';

import { useState, useEffect, useRef } from 'react';
import { displayRoomNumberLabel } from '@/lib/room-display';

interface GuestCheckOutProps {
  onBack: () => void;
}

interface CloudbedsGuest {
  firstName: string;
  lastName: string;
  /** Full name from Cloudbeds (guestName); use when first/last are empty */
  displayName?: string;
  roomNumber: string;
  cloudbedsReservationID: string;
  cloudbedsGuestID: string;
  checkInDate: string;
  checkOutDate: string;
}

function guestKey(g: CloudbedsGuest): string {
  return g.cloudbedsReservationID || `${g.displayName ?? ''}|${g.checkInDate}`;
}

function guestTitle(g: CloudbedsGuest): string {
  const combined = `${g.firstName ?? ''} ${g.lastName ?? ''}`.trim();
  if (combined) return combined;
  return (g.displayName ?? '').trim() || 'Guest';
}

/** Kiosk clock / property local calendar date (not UTC). */
function kioskLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function GuestCheckOut({ onBack }: GuestCheckOutProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [guests, setGuests] = useState<CloudbedsGuest[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<CloudbedsGuest | null>(null);
  const [success, setSuccess] = useState(false);
  const [daysStayed, setDaysStayed] = useState<number | null>(null);
  const [isSameDay, setIsSameDay] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live search Cloudbeds whenever the query changes (debounced)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setGuests([]);
      setSearchError('');
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError('');
      try {
        const res = await fetch(
          `/api/search-checked-in?name=${encodeURIComponent(q)}`
        );
        const data = await res.json();
        if (data.success) {
          const list = Array.isArray(data.guests) ? data.guests : [];
          setGuests(list);
        } else {
          setSearchError('Search is temporarily unavailable. Please try again.');
          setGuests([]);
        }
      } catch {
        setSearchError('Could not connect. Please try again.');
        setGuests([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const handleCheckOut = async () => {
    if (!selectedGuest) return;

    setLoading(true);
    setError('');

    try {
      const checkoutAt = new Date();
      const res = await fetch('/api/cloudbeds-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservationID: selectedGuest.cloudbedsReservationID,
          checkoutAtIso: checkoutAt.toISOString(),
          checkoutDate: kioskLocalDateStr(checkoutAt),
          checkInDate: selectedGuest.checkInDate || undefined,
        }),
      });

      const text = await res.text();
      let data: {
        success?: boolean;
        error?: string;
        message?: string;
        daysStayed?: number;
        isSameDay?: boolean;
      } = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }

      if (!res.ok || data.success !== true) {
        throw new Error(data.error || data.message || `Check-out failed (${res.status})`);
      }

      setDaysStayed(typeof data.daysStayed === 'number' ? data.daysStayed : null);
      setIsSameDay(data.isSameDay === true);

      // Also clean up any matching localStorage record so it doesn't linger
      try {
        const raw = localStorage.getItem('checkedInGuests');
        const stored: any[] = JSON.parse(raw || '[]');
        const updated = stored.filter(
          (g: any) =>
            String(g.cloudbedsReservationID) !== selectedGuest.cloudbedsReservationID
        );
        localStorage.setItem('checkedInGuests', JSON.stringify(updated));
      } catch {
        // localStorage is not critical; ignore
      }

      setSuccess(true);
      setTimeout(() => {
        onBack();
      }, 2500);
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Check-out failed. Please try again or contact the front desk.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (success && selectedGuest) {
    return (
      <div className="kiosk-container">
        <div className="success-screen">
          <h1 className="animated-message">Thank you for staying with us!</h1>
          {isSameDay ? (
            <p className="subtitle" style={{ marginTop: '1rem' }}>
              Your room has been released. We hope to see you again soon!
            </p>
          ) : (
            daysStayed != null && daysStayed > 0 && (
              <p className="subtitle" style={{ marginTop: '1rem' }}>
                Your stay was {daysStayed} day{daysStayed === 1 ? '' : 's'} (based on your check-in and
                check-out time).
              </p>
            )
          )}
        </div>
      </div>
    );
  }

  const queryReady = searchQuery.trim().length >= 2;

  return (
    <div className="kiosk-container">
      <div className="kiosk-header">
        <button className="back-link" onClick={onBack}>
          ← Back
        </button>
        <h1>Guest Check-Out</h1>
        <p className="subtitle">Search by your name to check out</p>
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
            placeholder="Type your first or last name…"
            autoFocus
            autoComplete="off"
          />
        </div>

        {searchQuery.trim().length > 0 && searchQuery.trim().length < 2 && (
          <p className="no-results-help" style={{ marginTop: '8px' }}>
            Enter at least 2 characters to search.
          </p>
        )}

        {searching && (
          <p className="no-results-help" style={{ marginTop: '8px' }}>
            Searching…
          </p>
        )}

        {searchError && (
          <div className="no-results">
            <p>{searchError}</p>
          </div>
        )}

        {!searching && queryReady && guests.length === 0 && !searchError && (
          <div className="no-results">
            <p>No checked-in guests found matching &quot;{searchQuery.trim()}&quot;</p>
            <p className="no-results-help">
              Try your last name, or contact the front desk if you need help.
            </p>
          </div>
        )}

        {guests.length > 0 && (
          <div className="guest-list">
            <p className="guest-list-title">Select your stay:</p>
            {guests.map((guest) => {
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
                    <div className="guest-name">{guestTitle(guest)}</div>
                    <div className="guest-details">
                      {displayRoomNumberLabel(guest.roomNumber)}
                    </div>
                    {guest.checkInDate && (
                      <div className="guest-details">
                        Checked in: {guest.checkInDate}
                      </div>
                    )}
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
                Processing…
                <span className="loading"></span>
              </>
            ) : (
              'Confirm Check-Out'
            )}
          </button>
        )}
      </div>

      <div className="kiosk-footer">
        <p>Need help? Please contact the front desk &mdash; <a href="tel:+14062282800" style={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}>(406) 228-2800</a></p>
      </div>
    </div>
  );
}
