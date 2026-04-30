/** Browser persistence for which error-log entries the admin has marked as read. */

const STORAGE_KEY = 'rundlekiosk_event_log_read_ids';
const LAST_VISITED_KEY = 'rundlekiosk_event_log_last_visited';
const MAX_IDS = 4000;

export function loadReadEventIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function persistReadEventIds(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const arr = [...ids];
    const trimmed = arr.length > MAX_IDS ? arr.slice(-MAX_IDS) : arr;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota or private mode */
  }
}

export function markEventRead(id: string, current: Set<string>): Set<string> {
  const next = new Set(current);
  next.add(id);
  persistReadEventIds(next);
  return next;
}

export function markEventsRead(ids: Iterable<string>, current: Set<string>): Set<string> {
  const next = new Set(current);
  for (const id of ids) next.add(id);
  persistReadEventIds(next);
  return next;
}

/**
 * Record the ISO timestamp of when the admin last visited the error log tab.
 * Events that occurred before this timestamp are treated as already-seen.
 */
export function recordErrorLogVisit(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAST_VISITED_KEY, new Date().toISOString());
  } catch {
    /* quota or private mode */
  }
}

/**
 * Return the ISO timestamp of the last error log visit, or null if never visited.
 */
export function loadErrorLogLastVisited(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(LAST_VISITED_KEY);
  } catch {
    return null;
  }
}
