/**
 * Cloudbeds often appends descriptors to `roomName`, e.g. "209 (Queen)".
 * Strip those for UI while leaving real room codes like "308i" intact.
 */
function normalizeRoomLabelForDisplay(s: string): string {
  let t = s.trim();
  t = t.replace(/^room\s+/i, '').trim();
  for (let i = 0; i < 8; i++) {
    const next = t.replace(/\s*\([^)]*\)\s*$/u, '').trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

/** API `roomName` values only — strips descriptors without applying internal-ID heuristics. */
export function formatCloudbedsRoomNameLabel(name: string | undefined): string {
  if (name == null || name === '') return '—';
  const cleaned = normalizeRoomLabelForDisplay(String(name));
  return cleaned === '' ? '—' : cleaned;
}

/** Value saved on kiosk check-in — strips descriptors from API `roomName`, falls back to raw selection when needed. */
export function kioskPersistRoomDisplayName(
  selectedRoom: { roomName?: string } | undefined,
  fallbackWhenNoName: string
): string {
  const raw = selectedRoom?.roomName;
  if (raw != null && String(raw).trim() !== '') {
    const f = formatCloudbedsRoomNameLabel(String(raw));
    return f !== '—' ? f : String(raw).trim();
  }
  return fallbackWhenNoName.trim();
}

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
  const cleaned = normalizeRoomLabelForDisplay(s);
  return cleaned === '' ? '—' : cleaned;
}

/**
 * Resolves persisted room identifiers to human room labels.
 * Supports exact `roomID`, and legacy `roomID-suffix` values like "517734-1".
 */
export function resolveRoomNumberLabel(
  stored: string | undefined,
  roomNameById: Record<string, string>
): string {
  if (!stored) return '—';

  const raw = String(stored).trim();
  const direct = roomNameById[raw];
  if (direct) {
    const cleaned = normalizeRoomLabelForDisplay(direct);
    return cleaned === '' ? '—' : cleaned;
  }

  const idPrefix = raw.match(/^(\d{4,})-\d+$/)?.[1];
  if (idPrefix && roomNameById[idPrefix]) {
    const cleaned = normalizeRoomLabelForDisplay(roomNameById[idPrefix]);
    return cleaned === '' ? '—' : cleaned;
  }

  const base = displayRoomNumberLabel(raw);
  // Treat numeric-id suffixes as internal IDs when we cannot resolve them.
  if (/^\d{4,}-\d+$/.test(raw)) return '—';
  return base;
}
