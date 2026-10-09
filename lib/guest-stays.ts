/**
 * Stay identity helpers shared by Arrivals and kiosk check-out.
 *
 * A guest can have several stays. Those stays must not share a check-out time,
 * and check-out search must offer only the latest one.
 */

export interface StayLike {
  firstName?: string;
  lastName?: string;
  checkInTime?: string;
  checkInDateYmd?: string;
  checkOutTime?: string;
  cloudbedsReservationID?: string;
  roomNumber?: string;
  _serverId?: string;
}

export interface NamedStay {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  checkInDate?: string;
  source?: string;
}

/** Order-insensitive identity so "Jonathan Fernstrom" and "Fernstrom Jonathan" match. */
export function personKey(stay: {
  firstName?: string;
  lastName?: string;
  displayName?: string;
}): string {
  const combined = `${stay.firstName ?? ''} ${stay.lastName ?? ''}`.trim() || (stay.displayName ?? '').trim();
  return combined
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Recency for a check-in timestamp or a YYYY-MM-DD property date. */
export function stayRecencyMs(checkIn: string | undefined): number {
  const t = (checkIn ?? '').trim();
  if (!t) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Date.parse(`${t}T12:00:00Z`) || 0;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * One open stay per person: the latest check-in.
 * On a tie, a live Cloudbeds stay wins over a local-only record.
 */
export function keepLatestStayPerPerson<T extends NamedStay>(stays: T[]): T[] {
  const best = new Map<string, T>();
  for (const stay of stays) {
    const key = personKey(stay);
    if (!key) continue;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, stay);
      continue;
    }
    const nextMs = stayRecencyMs(stay.checkInDate);
    const prevMs = stayRecencyMs(prev.checkInDate);
    if (nextMs > prevMs) {
      best.set(key, stay);
      continue;
    }
    if (nextMs === prevMs && stay.source === 'cloudbeds' && prev.source !== 'cloudbeds') {
      best.set(key, stay);
    }
  }
  return Array.from(best.values());
}

function localYmdFromIso(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function stayDay(stay: StayLike): string {
  const fromIso = stay.checkInTime ? localYmdFromIso(stay.checkInTime) : '';
  if (fromIso) return fromIso;
  return stay.checkInDateYmd ?? '';
}

function samePerson(a: StayLike, b: StayLike): boolean {
  const left = personKey(a);
  const right = personKey(b);
  return Boolean(left) && left === right;
}

/**
 * Two records are the same stay when they share a reservation, the same
 * check-in timestamp, or the same person + calendar day + room.
 * Different reservation IDs are always different stays.
 */
export function isSameStay(a: StayLike, b: StayLike): boolean {
  const aRes = (a.cloudbedsReservationID ?? '').trim();
  const bRes = (b.cloudbedsReservationID ?? '').trim();
  if (aRes && bRes) return aRes === bRes;
  if (!samePerson(a, b)) return false;
  if (a.checkInTime && b.checkInTime && a.checkInTime === b.checkInTime) return true;
  const dayA = stayDay(a);
  const dayB = stayDay(b);
  if (!dayA || dayA !== dayB) return false;
  const roomA = (a.roomNumber ?? '').trim().toLowerCase();
  const roomB = (b.roomNumber ?? '').trim().toLowerCase();
  if (roomA && roomB && roomA !== roomB) return false;
  return true;
}

function preferPrimary<T extends StayLike>(current: T, candidate: T): T {
  const currentOut = Boolean(current.checkOutTime);
  const candidateOut = Boolean(candidate.checkOutTime);
  if (currentOut !== candidateOut) return candidateOut ? candidate : current;
  if (Boolean(current._serverId) !== Boolean(candidate._serverId)) {
    return candidate._serverId ? candidate : current;
  }
  const score = (stay: StayLike) =>
    (stay.cloudbedsReservationID ? 2 : 0) + (stay.roomNumber ? 1 : 0) + (stay.checkInTime ? 1 : 0);
  return score(candidate) > score(current) ? candidate : current;
}

/** Keep the richer record, and fill a missing check-out from the other copy of the same stay. */
export function mergeStayPair<T extends StayLike>(current: T, candidate: T): T {
  const primary = preferPrimary(current, candidate);
  const secondary = primary === current ? candidate : current;
  const merged = { ...primary };
  if (!merged.checkOutTime && secondary.checkOutTime) merged.checkOutTime = secondary.checkOutTime;
  if (!merged.roomNumber && secondary.roomNumber) merged.roomNumber = secondary.roomNumber;
  if (!merged.cloudbedsReservationID && secondary.cloudbedsReservationID) {
    merged.cloudbedsReservationID = secondary.cloudbedsReservationID;
  }
  if (!merged._serverId && secondary._serverId) merged._serverId = secondary._serverId;
  if (!merged.checkInTime && secondary.checkInTime) merged.checkInTime = secondary.checkInTime;
  if (!merged.checkInDateYmd && secondary.checkInDateYmd) merged.checkInDateYmd = secondary.checkInDateYmd;
  return merged;
}

/** Collapse duplicate copies of one stay. Distinct stays (different reservation, day, or room) stay separate. */
export function collapseStays<T extends StayLike>(records: T[]): T[] {
  const out: T[] = [];
  for (const record of records) {
    const idx = out.findIndex((existing) => isSameStay(existing, record));
    if (idx === -1) out.push(record);
    else out[idx] = mergeStayPair(out[idx], record);
  }
  return out;
}
