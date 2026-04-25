'use client';

import { useEffect } from 'react';

/**
 * KioskDataSync — invisible background component mounted in the kiosk layout.
 *
 * Pushes all localStorage check-in and checkout records to the server-side
 * Firestore store every time it runs, so the admin Arrivals / Departures tabs
 * reflect real data regardless of which device the guest checked in on.
 *
 * Runs immediately on mount, then every 5 minutes.
 */
export default function KioskDataSync() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sync = async () => {
      try {
        const checkedIn: any[] = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
        const checkOutHistory: any[] = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');

        // Merge both lists — checkout history records just have checkOutTime set
        const all = [...checkedIn, ...checkOutHistory];
        if (all.length === 0) return;

        const res = await fetch('/api/checkin-records/sync', {
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
          console.log(
            `[KioskDataSync] synced ${all.length} records: ${data.created ?? 0} created, ${data.updated ?? 0} updated`
          );
        }
      } catch (err) {
        // Non-fatal — kiosk continues to work even if sync fails
        console.warn('[KioskDataSync] sync error (non-fatal):', err);
      }
    };

    // Run immediately on mount
    sync();

    // Then every 5 minutes
    const interval = window.setInterval(sync, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  return null;
}
