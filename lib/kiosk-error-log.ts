const STORAGE_KEY = 'kioskOperationErrorLog';
const ATTEMPTS_KEY = 'kioskCheckinAttempts';
const MAX_ENTRIES = 200;

export type KioskErrorSource =
  | 'check-in'
  | 'check-out'
  | 'rooms'
  | 'global'
  | 'admin-check-in'
  | 'admin-check-out';

export interface KioskErrorEntry {
  id: string;
  timestamp: string;
  source: KioskErrorSource;
  message: string;
  detail?: Record<string, unknown>;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function appendKioskError(
  entry: Omit<KioskErrorEntry, 'id' | 'timestamp'> & { timestamp?: string }
): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: KioskErrorEntry[] = raw ? JSON.parse(raw) : [];
    const next: KioskErrorEntry = {
      id: newId(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
      source: entry.source,
      message: entry.message,
      detail: entry.detail,
    };
    list.unshift(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    // ignore quota / private mode
  }
}

export function getKioskErrors(): KioskErrorEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: KioskErrorEntry[] = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function clearKioskErrors(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Check-in attempt log — records EVERY submission regardless of outcome
// ---------------------------------------------------------------------------

export type CheckinAttemptStatus = 'pending' | 'success' | 'cloudbeds_error' | 'partial_success';

export interface CheckinAttempt {
  id: string;
  submittedAt: string;
  status: CheckinAttemptStatus;
  /** Human-readable outcome message filled in after Cloudbeds responds */
  outcome?: string;
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  roomID: string;
  roomName?: string;
  roomTypeName?: string;
  stayStartNight: 'today' | 'yesterday';
  checkInDate: string;
  checkOutDate: string;
  placeholderReservationID?: string;
  cloudbedsReservationID?: string;
  cloudbedsGuestID?: string;
  errorMessage?: string;
  errorStack?: string;
}

export function recordCheckinAttempt(attempt: Omit<CheckinAttempt, 'id' | 'submittedAt'>): string {
  const id = newId();
  if (typeof window === 'undefined') return id;
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    const list: CheckinAttempt[] = raw ? JSON.parse(raw) : [];
    list.unshift({ ...attempt, id, submittedAt: new Date().toISOString() });
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* ignore */
  }
  return id;
}

export function updateCheckinAttempt(
  id: string,
  patch: Partial<Pick<CheckinAttempt, 'status' | 'outcome' | 'cloudbedsReservationID' | 'cloudbedsGuestID' | 'errorMessage' | 'errorStack'>>
): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    const list: CheckinAttempt[] = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex((a) => a.id === id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...patch };
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(list));
    }
  } catch {
    /* ignore */
  }
}

export function getCheckinAttempts(): CheckinAttempt[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    const list: CheckinAttempt[] = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function clearCheckinAttempts(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(ATTEMPTS_KEY);
  } catch {
    /* ignore */
  }
}
