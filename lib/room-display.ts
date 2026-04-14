/**
 * Human-facing room label for kiosk/admin lists. Stored `roomNumber` may be a Cloudbeds
 * `roomID` (long numeric string) from older check-ins; we avoid showing those when we can tell.
 */
export function displayRoomNumberLabel(stored: string | undefined): string {
  if (stored == null || stored === '') return '—';
  const s = String(stored).trim();
  if (s === '—') return '—';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return '—';
  if (/^\d{6,}$/.test(s)) return '—';
  return s;
}
