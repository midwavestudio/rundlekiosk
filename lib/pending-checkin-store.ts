import 'server-only';

/**
 * Durable queue for Cloudbeds check-in attempts.
 *
 * Every kiosk check-in writes a "pending" record here BEFORE calling Cloudbeds.
 * If the Cloudbeds call succeeds, the record is updated to "completed".
 * If it times out or fails after all retries, the record stays "pending" or
 * becomes "failed" so the cron retry job can pick it up automatically.
 *
 * This prevents the production data-loss scenario where the Vercel function
 * was killed mid-execution (exceeding the old 60s limit), leaving the guest
 * with no Cloudbeds reservation while the kiosk had already shown success.
 */

import * as firebaseAdmin from 'firebase-admin';

export type PendingCheckinStatus = 'pending' | 'completed' | 'failed' | 'processing';

export interface PendingCheckin {
  id: string;
  status: PendingCheckinStatus;
  /** The full params sent to performCloudbedsCheckIn / the check-in API */
  checkInParams: {
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    roomName: string;
    roomNameHint?: string;
    clcNumber?: string;
    classType?: string;
    email?: string;
    checkInDate?: string;
    checkOutDate?: string;
    forceUnassigned?: boolean;
    allowOverbooking?: boolean;
    placeholderReservationID?: string;
  };
  /** The Firestore document ID of the kiosk_checkin_records document (for patching IDs on success) */
  checkinRecordId?: string;
  /** Cloudbeds reservation ID — populated on success */
  cloudbedsReservationID?: string;
  cloudbedsGuestID?: string;
  /** ISO timestamp of the initial attempt */
  createdAt: string;
  /** ISO timestamp of the last attempt */
  lastAttemptAt?: string;
  /** Number of attempts made */
  attempts: number;
  /** Last error message */
  lastError?: string;
  /** Source: 'kiosk' | 'admin' */
  source?: string;
}

// ---------------------------------------------------------------------------
// Firebase init (reuses existing pattern from checkin-store.ts)
// ---------------------------------------------------------------------------

let _app: firebaseAdmin.app.App | null = null;
let _initError: string | null = null;

function normalizePrivateKey(raw: string): string {
  let k = raw.trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  return k.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
}

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
    _initError = 'Firebase Admin env vars missing — pending check-in queue will not persist across restarts.';
    return null;
  }
  try {
    _app = firebaseAdmin.apps.length
      ? (firebaseAdmin.apps[0] as firebaseAdmin.app.App)
      : firebaseAdmin.initializeApp({
          credential: firebaseAdmin.credential.cert({
            projectId,
            privateKey: normalizePrivateKey(privateKey),
            clientEmail,
          }),
          projectId,
        });
    _initError = null;
    return _app;
  } catch (err: any) {
    _initError = `Firebase Admin initializeApp failed: ${err?.message ?? String(err)}`;
    return null;
  }
}

function getDb(): firebaseAdmin.firestore.Firestore | null {
  const app = getAdminApp();
  return app ? firebaseAdmin.firestore(app) : null;
}

const COLLECTION = 'pending_cloudbeds_checkins';

// In-memory fallback (per-invocation only — data lost on Vercel cold start)
const memStore: PendingCheckin[] = [];

function memId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Save a new pending check-in. Returns the document ID. */
export async function savePendingCheckin(
  params: PendingCheckin['checkInParams'],
  opts: { checkinRecordId?: string; source?: string } = {}
): Promise<string> {
  const now = new Date().toISOString();
  const record: Omit<PendingCheckin, 'id'> = {
    status: 'pending',
    checkInParams: params,
    checkinRecordId: opts.checkinRecordId,
    createdAt: now,
    attempts: 0,
    source: opts.source ?? 'kiosk',
  };

  const db = getDb();
  if (db) {
    try {
      const ref = await db.collection(COLLECTION).add(record);
      return ref.id;
    } catch (err) {
      console.error('[pending-checkin-store] Firestore add failed — using in-memory.', err);
    }
  }

  const id = memId();
  memStore.unshift({ id, ...record });
  return id;
}

/** Mark a pending check-in as completed (Cloudbeds succeeded). */
export async function markPendingCheckinComplete(
  id: string,
  cloudbedsReservationID: string,
  cloudbedsGuestID?: string
): Promise<void> {
  const update = {
    status: 'completed' as PendingCheckinStatus,
    cloudbedsReservationID,
    cloudbedsGuestID,
    lastAttemptAt: new Date().toISOString(),
  };
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION).doc(id).update(update);
      return;
    } catch (err) {
      console.error('[pending-checkin-store] Firestore update (complete) failed.', err);
    }
  }
  const idx = memStore.findIndex((r) => r.id === id);
  if (idx >= 0) Object.assign(memStore[idx], update);
}

/** Mark a pending check-in as failed after all retries exhausted. */
export async function markPendingCheckinFailed(
  id: string,
  error: string,
  attempts: number
): Promise<void> {
  const update = {
    status: 'failed' as PendingCheckinStatus,
    lastError: error,
    attempts,
    lastAttemptAt: new Date().toISOString(),
  };
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION).doc(id).update(update);
      return;
    } catch (err) {
      console.error('[pending-checkin-store] Firestore update (failed) failed.', err);
    }
  }
  const idx = memStore.findIndex((r) => r.id === id);
  if (idx >= 0) Object.assign(memStore[idx], update);
}

/** Increment attempt counter and record last error (called before each retry). */
export async function incrementPendingCheckinAttempt(
  id: string,
  error?: string
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  if (db) {
    try {
      const ref = db.collection(COLLECTION).doc(id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const current = (snap.data()?.attempts ?? 0) as number;
        const update: Record<string, unknown> = {
          attempts: current + 1,
          lastAttemptAt: now,
          status: 'processing' as PendingCheckinStatus,
        };
        if (error) update.lastError = error;
        tx.update(ref, update);
      });
      return;
    } catch (err) {
      console.error('[pending-checkin-store] Firestore incrementAttempt failed.', err);
    }
  }
  const idx = memStore.findIndex((r) => r.id === id);
  if (idx >= 0) {
    memStore[idx].attempts += 1;
    memStore[idx].lastAttemptAt = now;
    memStore[idx].status = 'processing';
    if (error) memStore[idx].lastError = error;
  }
}

/** Fetch all pending or failed check-ins that need to be retried. */
export async function getPendingCheckins(opts: { maxAge?: number } = {}): Promise<PendingCheckin[]> {
  const cutoff = opts.maxAge
    ? new Date(Date.now() - opts.maxAge).toISOString()
    : new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // default: last 48 hours

  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION)
        .where('status', 'in', ['pending', 'failed', 'processing'])
        .where('createdAt', '>=', cutoff)
        .orderBy('createdAt', 'asc')
        .limit(100)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PendingCheckin));
    } catch (err) {
      console.error('[pending-checkin-store] Firestore getPendingCheckins failed.', err);
    }
  }
  return memStore.filter(
    (r) => ['pending', 'failed', 'processing'].includes(r.status) && r.createdAt >= cutoff
  );
}

/** Get a single pending check-in by ID. */
export async function getPendingCheckinById(id: string): Promise<PendingCheckin | null> {
  const db = getDb();
  if (db) {
    try {
      const doc = await db.collection(COLLECTION).doc(id).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() } as PendingCheckin;
    } catch (err) {
      console.error('[pending-checkin-store] Firestore get by ID failed.', err);
    }
  }
  return memStore.find((r) => r.id === id) ?? null;
}
