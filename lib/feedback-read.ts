/** Browser persistence for feedback messages an admin has already read. */

const STORAGE_KEY = 'rundlekiosk_feedback_read_ids';
const MAX_IDS = 4000;

export function loadReadFeedbackIds(): Set<string> {
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

function persistReadFeedbackIds(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const arr = [...ids];
    const trimmed = arr.length > MAX_IDS ? arr.slice(-MAX_IDS) : arr;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota/private mode */
  }
}

export function markFeedbackRead(id: string, current: Set<string>): Set<string> {
  const next = new Set(current);
  next.add(id);
  persistReadFeedbackIds(next);
  return next;
}

export function markFeedbacksRead(ids: Iterable<string>, current: Set<string>): Set<string> {
  const next = new Set(current);
  for (const id of ids) next.add(id);
  persistReadFeedbackIds(next);
  return next;
}

export function removeFeedbackReadId(id: string, current: Set<string>): Set<string> {
  const next = new Set(current);
  next.delete(id);
  persistReadFeedbackIds(next);
  return next;
}

