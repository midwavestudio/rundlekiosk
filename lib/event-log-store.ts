import 'server-only';

/**
 * Append-only kiosk / API event log for admin review (check-in failures, checkout failures, etc.).
 * Persists to Firestore when configured; otherwise in-memory (dev / CI).
 */

import * as firebaseAdmin from 'firebase-admin';

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

let _app: firebaseAdmin.app.App | null = null;

function getAdminApp(): firebaseAdmin.app.App | null {
  if (_app) return _app;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (
    !projectId || projectId.includes('your_') ||
    !privateKey || privateKey.includes('your_') ||
    !clientEmail
  ) {
    return null;
  }

  try {
    _app = firebaseAdmin.apps.length
      ? (firebaseAdmin.apps[0] as firebaseAdmin.app.App)
      : firebaseAdmin.initializeApp({
          credential: firebaseAdmin.credential.cert({
            projectId,
            privateKey: privateKey.replace(/\\n/g, '\n'),
            clientEmail,
          }),
        });
    return _app;
  } catch {
    return null;
  }
}

function getDb(): firebaseAdmin.firestore.Firestore | null {
  const app = getAdminApp();
  if (!app) return null;
  return firebaseAdmin.firestore(app);
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

const COLLECTION = 'kiosk_event_log';

export async function saveEventLog(entry: {
  level: EventLogLevel;
  source: string;
  message: string;
  detail?: unknown;
  occurredAt?: string;
}): Promise<string> {
  const occurredAt = entry.occurredAt ?? new Date().toISOString();
  const detailJson = stringifyDetail(entry.detail);
  const payload = {
    level: entry.level,
    source: entry.source,
    message: entry.message.slice(0, 4000),
    ...(detailJson ? { detailJson } : {}),
    occurredAt,
  };

  const db = getDb();
  if (db) {
    try {
      const ref = await db.collection(COLLECTION).add(payload);
      return ref.id;
    } catch (err) {
      console.error('[event-log] Firestore add failed — using in-memory store.', err);
    }
  }

  const id = nextMemoryId();
  memoryStore.unshift({
    id,
    level: entry.level,
    source: entry.source,
    message: payload.message,
    detailJson,
    occurredAt,
  });
  while (memoryStore.length > MAX_MEMORY) memoryStore.pop();
  return id;
}

export async function getRecentEventLogs(limit = 200): Promise<EventLogEntry[]> {
  const cap = Math.min(Math.max(limit, 1), 500);
  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION)
        .orderBy('occurredAt', 'desc')
        .limit(cap)
        .get();
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          level: (data.level as EventLogLevel) || 'error',
          source: String(data.source ?? ''),
          message: String(data.message ?? ''),
          detailJson: data.detailJson != null ? String(data.detailJson) : undefined,
          occurredAt: String(data.occurredAt ?? ''),
        };
      });
    } catch (err) {
      console.error('[event-log] Firestore query failed — using in-memory store.', err);
    }
  }

  return memoryStore.slice(0, cap);
}
