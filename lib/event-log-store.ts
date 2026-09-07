import 'server-only';

/**
 * Append-only kiosk / API event log for admin review (check-in failures, checkout failures, etc.).
 * Firestore persistence is disabled to reduce cloud read/write costs. Logs are kept in-memory
 * for the current server process and appear in Vercel function logs via console.error/warn.
 */

export type EventLogLevel = 'error' | 'warn' | 'info';

export interface EventLogEntry {
  id: string;
  level: EventLogLevel;
  /** e.g. api:cloudbeds-checkin, kiosk:check-in */
  source: string;
  message: string;
  /** JSON string (truncated if very large) for structured context */
  detailJson?: string;
  occurredAt: string;
}


const memoryStore: EventLogEntry[] = [];
const MAX_MEMORY = 500;

function nextMemoryId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stringifyDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  try {
    let s = JSON.stringify(detail);
    if (s.length > 15000) s = `${s.slice(0, 15000)}…[truncated]`;
    return s;
  } catch {
    return String(detail).slice(0, 15000);
  }
}

// Event log Firestore writes are disabled to reduce cloud costs.
// Logs are kept in-memory for the current server process and visible in the
// admin Error Log tab within the same session. They do not persist across
// deployments or server restarts.

export async function saveEventLog(entry: {
  level: EventLogLevel;
  source: string;
  message: string;
  detail?: unknown;
  occurredAt?: string;
}): Promise<string> {
  const occurredAt = entry.occurredAt ?? new Date().toISOString();
  const detailJson = stringifyDetail(entry.detail);
  const message = entry.message.slice(0, 4000);

  // Always write to console so errors appear in Vercel function logs.
  if (entry.level === 'error') {
    console.error(`[event-log] ${entry.source}: ${message}`, detailJson ? JSON.parse(detailJson) : '');
  } else if (entry.level === 'warn') {
    console.warn(`[event-log] ${entry.source}: ${message}`);
  }

  // Store in-memory only (no Firestore write).
  const id = nextMemoryId();
  memoryStore.unshift({
    id,
    level: entry.level,
    source: entry.source,
    message,
    detailJson,
    occurredAt,
  });
  while (memoryStore.length > MAX_MEMORY) memoryStore.pop();
  return id;
}

export async function getRecentEventLogs(limit = 200): Promise<EventLogEntry[]> {
  const cap = Math.min(Math.max(limit, 1), 500);
  // Return in-memory logs only (Firestore reads disabled to reduce cloud costs).
  return memoryStore.slice(0, cap);
}
