'use client';

import { useState, useEffect, useRef } from 'react';
import { displayRoomNumberLabel } from '@/lib/room-display';

interface GuestCheckOutProps {
  onBack: () => void;
  onOpenFeedback?: () => void;
}

function postKioskEvent(message: string, detail?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  void fetch('/api/event-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'kiosk:check-out', level: 'error', message, detail }),
  }).catch(() => {});
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
  /**
   * 'cloudbeds' — found in live Cloudbeds checked-in list.
   * 'local'     — found in local kiosk records only (reservation may have been
   *               modified in Cloudbeds after check-in).
   */
  source?: 'cloudbeds' | 'local';
  /**
   * Firestore document ID of the local check-in record.
   * Present only when source === 'local'; used to record checkout time even
   * when Cloudbeds is unavailable.
   */
  localRecordID?: string;
}

function guestKey(g: CloudbedsGuest): string {
  return g.cloudbedsReservationID || `${g.displayName ?? ''}|${g.checkInDate}`;
}

function guestTitle(g: CloudbedsGuest): string {
  const combined = `${g.firstName ?? ''} ${g.lastName ?? ''}`.trim();
  if (combined) return combined;
  return (g.displayName ?? '').trim() || 'Guest';
}

/** StoredGuest fields when the guest never existed in kiosk `checkedInGuests` (Cloudbeds-only). */
function namesForKioskHistory(g: CloudbedsGuest): { firstName: string; lastName: string } {
  const fn = String(g.firstName ?? '').trim();
  const ln = String(g.lastName ?? '').trim();
  if (fn || ln) return { firstName: fn || ln || 'Guest', lastName: fn ? ln : '' };
  const dn = (g.displayName ?? '').trim();
  if (!dn) return { firstName: 'Guest', lastName: '' };
  const parts = dn.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] ?? '' };
}

/** Kiosk clock / property local calendar date (not UTC). */
function kioskLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmdLocal(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayDiffLocal(from: Date, to: Date): number {
  const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toDay = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((toDay.getTime() - fromDay.getTime()) / msPerDay);
}

function dayOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function formatCheckInDateLabel(checkInDate: string): string {
  const parsed = parseYmdLocal(checkInDate);
  if (!parsed) return checkInDate;

  const today = new Date();
  const diff = dayDiffLocal(parsed, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';

  return `${parsed.toLocaleDateString('en-US', { month: 'long' })} ${dayOrdinal(parsed.getDate())}`;
}

function formatDisplayDate(value?: string): string {
  if (!value) return '—';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;
  const m = dateOnly.exec(value.trim());
  if (m) {
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function GuestCheckOut({ onBack, onOpenFeedback }: GuestCheckOutProps) {
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
  /** Prevents double confirmation taps from firing duplicate checkout API calls / logs. */
  const checkoutInFlightRef = useRef(false);

  const persistCheckoutRecord = async (
    checkoutIso: string,
    guest: CloudbedsGuest
  ): Promise<void> => {
    const patchBody: Record<string, string> = {
      checkOutTime: checkoutIso,
      firstName: guest.firstName ?? '',
      lastName: guest.lastName ?? '',
      roomNumber: guest.roomNumber ?? '',
      checkInDate: guest.checkInDate ?? '',
    };
    if (guest.cloudbedsReservationID) {
      patchBody.reservationID = guest.cloudbedsReservationID;
    }
    if (guest.localRecordID) {
      patchBody.id = guest.localRecordID;
    }
    if (guest.cloudbedsGuestID) {
      patchBody.cloudbedsGuestID = guest.cloudbedsGuestID;
    }

    const patchRes = await fetch('/api/checkin-records', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    });
    const patchData = await patchRes.json().catch(() => ({}));
    if (!patchRes.ok || patchData?.success !== true) {
      throw new Error(
        patchData?.error || `Failed to save checkout record (${patchRes.status})`
      );
    }
  };

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
    if (!selectedGuest || checkoutInFlightRef.current) return;
    checkoutInFlightRef.current = true;

    setLoading(true);
    setError('');

    const checkoutAt = new Date();
    const checkoutIso = checkoutAt.toISOString();
    const isLocalGuest = selectedGuest.source === 'local';
    const checkoutPayload: Record<string, unknown> = {
      reservationID: selectedGuest.cloudbedsReservationID,
      checkoutAtIso: checkoutIso,
      checkoutDate: kioskLocalDateStr(checkoutAt),
      checkInDate: selectedGuest.checkInDate || undefined,
    };
    if (isLocalGuest) checkoutPayload.localFallbackCheckout = true;

    // Record the checkout time locally BEFORE calling Cloudbeds so it is
    // always persisted regardless of whether the Cloudbeds request succeeds.
    try {
      const raw = localStorage.getItem('checkedInGuests');
      const stored: any[] = JSON.parse(raw || '[]');
      const idx = stored.findIndex(
        (g: any) => String(g.cloudbedsReservationID) === selectedGuest.cloudbedsReservationID
      );
      const checkOutHistory = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
      if (idx >= 0) {
        checkOutHistory.push({ ...stored[idx], checkOutTime: checkoutIso });
      } else {
        const { firstName, lastName } = namesForKioskHistory(selectedGuest);
        checkOutHistory.push({
          firstName,
          lastName,
          clcNumber: '',
          phoneNumber: '',
          class: 'TYE',
          checkInTime: '',
          roomNumber: selectedGuest.roomNumber,
          cloudbedsReservationID: selectedGuest.cloudbedsReservationID,
          cloudbedsGuestID: selectedGuest.cloudbedsGuestID,
          checkOutTime: checkoutIso,
        });
      }
      localStorage.setItem('checkOutHistory', JSON.stringify(checkOutHistory));
      const updated = stored.filter(
        (g: any) => String(g.cloudbedsReservationID) !== selectedGuest.cloudbedsReservationID
      );
      localStorage.setItem('checkedInGuests', JSON.stringify(updated));
    } catch {
      // localStorage is not critical; ignore
    }

    // Update the server-side record immediately so admin Arrivals / Departures
    // show the checkout time even if the Cloudbeds call below fails.
    // Pass full guest context so the server can create a stub record if no
    // existing Firestore document is found (e.g. the Cloudbeds reservation was
    // modified after kiosk check-in and the record has no reservationID link).
    // Always persist this before Cloudbeds call — if this fails we still continue
    // checkout, but we emit an event so missing timestamps can be investigated.
    try {
      await persistCheckoutRecord(checkoutIso, selectedGuest);
    } catch (patchErr: any) {
      postKioskEvent('Failed to record checkout time to server', {
        reservationID: selectedGuest.cloudbedsReservationID,
        localRecordID: selectedGuest.localRecordID,
        checkoutIso,
        error: patchErr?.message ?? String(patchErr),
      });
    }

    // For guests found only in local records (source === 'local'), Cloudbeds may
    // not be able to process the checkout (reservation modified / unavailable).
    // We attempt the Cloudbeds call only when a reservation ID is available, and
    // treat a Cloudbeds failure as a local-only success so the guest isn't blocked.
    const hasReservationID = Boolean(selectedGuest.cloudbedsReservationID);

    try {
      if (!isLocalGuest || hasReservationID) {
        let checkoutServerResponded = false;
        try {
          const res = await fetch('/api/cloudbeds-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(checkoutPayload),
          });
          checkoutServerResponded = true;

          const text = await res.text();
          let data: {
            success?: boolean;
            error?: string;
            message?: string;
            daysStayed?: number;
            isSameDay?: boolean;
            localOnly?: boolean;
          } = {};
          try {
            data = JSON.parse(text);
          } catch {
            data = {};
          }

          if (!res.ok || data.success !== true) {
            // Local-fallback: Cloudbeds failure is expected — API skips admin error log;
            // do not post a duplicate kiosk event either.
            if (!isLocalGuest) {
              throw new Error(data.error || data.message || `Check-out failed (${res.status})`);
            }
          } else {
            setDaysStayed(typeof data.daysStayed === 'number' ? data.daysStayed : null);
            setIsSameDay(data.isSameDay === true);
          }
        } catch (err: unknown) {
          if (!isLocalGuest) {
            const msg =
              err instanceof Error && err.message
                ? err.message
                : 'Check-out failed. Please try again or contact the front desk.';
            setError(msg);
            // Server route already logged checkout failures — only log here when the
            // request never reached the API (network / offline kiosk).
            if (!checkoutServerResponded) {
              postKioskEvent(msg, {
                submittedRequest: checkoutPayload,
                selectedGuest: {
                  firstName: selectedGuest.firstName,
                  lastName: selectedGuest.lastName,
                  displayName: selectedGuest.displayName,
                  roomNumber: selectedGuest.roomNumber,
                  cloudbedsReservationID: selectedGuest.cloudbedsReservationID,
                  cloudbedsGuestID: selectedGuest.cloudbedsGuestID,
                  checkInDate: selectedGuest.checkInDate,
                  checkOutDate: selectedGuest.checkOutDate,
                },
                searchQuery: searchQuery.trim() || undefined,
              });
            }
            setLoading(false);
            return;
          }
          // Local guest + fetch/network failure before response — silent (checkout saved locally).
        }
      }

      // Success path — checkout time already recorded locally above.
      setSuccess(true);
      setLoading(false);
      setTimeout(() => {
        onBack();
      }, 2500);
    } finally {
      checkoutInFlightRef.current = false;
    }
  };

  if (success && selectedGuest) {
    return (
      <div className="kiosk-container">
        <div className="success-screen">
          <h1 className="animated-message" style={{ textAlign: 'center', margin: 0 }}>
            Thank you for staying with us!
          </h1>
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
        <p className="subtitle"><strong>Please let us know if your name doesn&apos;t show</strong></p>
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
            {guests[0]?.source === 'local' && (
              <p className="no-results-help" style={{ marginBottom: '8px' }}>
                Your reservation wasn&apos;t found in the live system — showing your last check-in on record.
              </p>
            )}
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
                        Checked in: {formatCheckInDateLabel(guest.checkInDate)}
                      </div>
                    )}
                    {guest.checkOutDate && (
                      <div className="guest-details">
                        Check-out: {formatDisplayDate(guest.checkOutDate)}
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
