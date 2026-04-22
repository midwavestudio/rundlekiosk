'use client';

import { useEffect } from 'react';

/**
 * Keeps the kiosk PWA fresh when running under Guided Access on an iPad.
 *
 * Two complementary strategies:
 *
 * 1. Service-worker update detection — whenever the browser installs a new
 *    service worker (triggered by a deploy), `controllerchange` fires and we
 *    reload immediately. Because `skipWaiting: true` is set in next.config.js
 *    the new SW activates right away, so no manual prompt is needed.
 *
 * 2. Periodic hard-reload every 30 minutes — catches edge cases where the SW
 *    update event was missed (e.g. the iPad was asleep) and also clears any
 *    stale React state that may have built up during a long kiosk session.
 */
export default function KioskAutoUpdate() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // --- Strategy 1: react to a new SW taking control ---
    const sw = navigator.serviceWorker;
    if (sw) {
      const onControllerChange = () => {
        // A new service worker just activated — reload to serve fresh assets.
        window.location.reload();
      };
      sw.addEventListener('controllerchange', onControllerChange);

      // Proactively check for a new SW every 30 minutes as well.
      const checkInterval = window.setInterval(() => {
        sw.ready.then((reg) => reg.update()).catch(() => {/* network offline, ignore */});
      }, 30 * 60 * 1000);

      return () => {
        sw.removeEventListener('controllerchange', onControllerChange);
        window.clearInterval(checkInterval);
      };
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // --- Strategy 2: hard reload every 30 minutes as a safety net ---
    const THIRTY_MIN = 30 * 60 * 1000;
    const reloadTimer = window.setTimeout(() => {
      window.location.reload();
    }, THIRTY_MIN);

    return () => window.clearTimeout(reloadTimer);
  }, []);

  return null;
}
