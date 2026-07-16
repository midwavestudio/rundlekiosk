'use client';

import { useEffect } from 'react';

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const LAST_SYNC_KEY = 'kioskDataSync_lastSyncHash';

/** Cheap content fingerprint — avoids a full JSON.stringify diff on every tick. */
function recordsHash(all: any[]): string {
  return all.length + ':' + (all[all.length - 1]?.checkInTime ?? '') + ':' + (all[0]?.checkOutTime ?? '');
}

/**
 * KioskDataSync — invisible background component mounted in the kiosk layout.
 *
 * Pushes all localStorage check-in and checkout records to the server-side
 * Firestore store every time it runs, so the admin Arrivals / Departures tabs
 * reflect real data regardless of which device the guest checked in on.
 *
 * Skips the network call entirely when the local data fingerprint has not
 * changed since the last successful sync, eliminating unnecessary Firestore
 * reads when the kiosk has been idle.
 *
 * Runs immediately on mount, then every 30 minutes.
 */
export default function KioskDataSync() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sync = async (force = false) => {
      try {
        const checkedIn: any[] = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
        const checkOutHistory: any[] = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');

        const all = [...checkedIn, ...checkOutHistory];
        if (all.length === 0) return;

        // Skip the round-trip when nothing has changed since the last sync.
        const hash = recordsHash(all);
        const lastHash = sessionStorage.getItem(LAST_SYNC_KEY);
        if (!force && hash === lastHash) {
          console.log('[KioskDataSync] no changes since last sync — skipping');
          return;
        }

        const res = await fetch('/api/checkin-records?action=sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: all }),
        });

        if (!res.ok) {
          console.warn('[KioskDataSync] sync returned non-OK status:', res.status);
          return;
        }

        const data = await res.json();
        if (data.success) {
          sessionStorage.setItem(LAST_SYNC_KEY, hash);
          console.log(
            `[KioskDataSync] synced ${all.length} records: ${data.created ?? 0} created, ${data.updated ?? 0} updated`
          );
        }
      } catch (err) {
        // Non-fatal — kiosk continues to work even if sync fails
        console.warn('[KioskDataSync] sync error (non-fatal):', err);
      }
    };

    // Run immediately on mount (force=true so a fresh page load always syncs once).
    sync(true);

    const interval = window.setInterval(() => sync(), SYNC_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  return null;
}
