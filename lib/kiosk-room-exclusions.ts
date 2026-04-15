/**
 * Rooms that must not appear in the guest kiosk room dropdown.
 * Matches Cloudbeds naming (case-insensitive).
 */

export function normalizeKioskRoomLabel(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** True if this physical room should not be offered for walk-in kiosk check-in (CON / conference). */
export function isConRoomExcludedFromKiosk(roomTypeName: string, roomName: string): boolean {
  const t = normalizeKioskRoomLabel(roomTypeName);
  const n = normalizeKioskRoomLabel(roomName);
  if (t === 'conference room' || t.includes('conference')) return true;
  if (n === 'con' || n === 'conference' || n.startsWith('con ')) return true;
  return false;
}
