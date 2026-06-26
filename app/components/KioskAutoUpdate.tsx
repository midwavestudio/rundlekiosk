'use client';

import { useEffect, useRef } from 'react';

/**
 * Keeps the kiosk PWA fresh without interrupting an active guest session.
 *
 * - Reloads only after a new service worker activates AND the kiosk has been
 *   idle for a short period (no touches / typing).
 * - Skips reload on the first service-worker install (controllerchange on
 *   first visit used to cause immediate reload loops).
 * - Does not schedule periodic hard reloads — those reset check-in/out flows.
 */
const IDLE_BEFORE_RELOAD_MS = 60_000;
const SW_UPDATE_CHECK_MS = 60 * 60 * 1000;
const IDLE_POLL_MS = 5_000;

const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'touchstart',
  'keydown',
  'click',
  'scroll',
] as const;

export default function KioskAutoUpdate() {
  const lastActivityRef = useRef(Date.now());
  const pendingReloadRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, markActive, { passive: true });
    }

    const tryReloadWhenIdle = () => {
      if (!pendingReloadRef.current) return;
      if (Date.now() - lastActivityRef.current < IDLE_BEFORE_RELOAD_MS) return;
      pendingReloadRef.current = false;
      window.location.reload();
    };

    const idlePoll = window.setInterval(tryReloadWhenIdle, IDLE_POLL_MS);

    const scheduleReload = () => {
      pendingReloadRef.current = true;
      tryReloadWhenIdle();
    };

    const hadController = Boolean(navigator.serviceWorker?.controller);
    const sw = navigator.serviceWorker;

    let checkInterval: number | undefined;
    const onControllerChange = () => {
      if (!hadController) return;
      scheduleReload();
    };

    if (sw) {
      sw.addEventListener('controllerchange', onControllerChange);
      checkInterval = window.setInterval(() => {
        sw.ready.then((reg) => reg.update()).catch(() => {});
      }, SW_UPDATE_CHECK_MS);
    }

    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, markActive);
      }
      window.clearInterval(idlePoll);
      if (checkInterval !== undefined) window.clearInterval(checkInterval);
      sw?.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
