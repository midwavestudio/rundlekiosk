'use client';

import { useEffect } from 'react';
import { appendKioskError } from '@/lib/kiosk-error-log';

/**
 * Captures uncaught JS errors and unhandled promise rejections on the guest kiosk
 * and records them for the admin Operation error log (same localStorage).
 */
export default function KioskGlobalErrorLogger() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      appendKioskError({
        source: 'global',
        message: ev.message || 'window error',
        detail: {
          filename: ev.filename,
          lineno: ev.lineno,
          colno: ev.colno,
          stack: ev.error instanceof Error ? ev.error.stack : String(ev.error ?? ''),
        },
      });
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason;
      appendKioskError({
        source: 'global',
        message:
          reason instanceof Error
            ? reason.message || 'Unhandled promise rejection'
            : String(reason ?? 'Unhandled promise rejection'),
        detail: {
          stack: reason instanceof Error ? reason.stack : undefined,
          reason: reason instanceof Error ? undefined : reason,
        },
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
