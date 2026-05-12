import 'server-only';

/**
 * Server-side kiosk check-in record store.
 *
 * Persists every kiosk check-in (and checkout timestamp) to Firestore so the
 * admin Arrivals / Departures tabs can read live data across all devices, not
 * just from the local browser's localStorage.
 *
 * Falls back to an in-memory array when Firebase is not configured (dev / CI).
 * NOTE: the in-memory store is per-serverless-invocation on Vercel — configure
 * Firebase env vars to get durable cross-device persistence.
 */

import * as firebaseAdmin from 'firebase-admin';

export interface CheckinRecord {
  /** Firestore document ID (or in-memory generated ID). */
  id: string;
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  class: string;
  /** Stored display label (may be a Cloudbeds roomName or roomID). */
  roomNumber: string;
  /** ISO timestamp of check-in. */
  checkInTime: string;
  /**
   * Calendar date derived from check-in (YYYY-MM-DD, UTC date prefix of ISO string).
   * Used for indexed date-range queries in Firestore — see `firestore.indexes.json`.
   */
  checkInDateYmd?: string;
  /** ISO timestamp of checkout — set after the guest leaves. */
  checkOutTime?: string;
  cloudbedsReservationID?: string;
  cloudbedsGuestID?: string;
  /** 'kiosk' | 'admin' | 'bulk' — whichever flow created the record. */
  source?: string;
  /** ISO creation timestamp (same as checkInTime in most cases). */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Firebase initialisation (same pattern as lib/event-log-store.ts)
// ---------------------------------------------------------------------------

let _app: firebaseAdmin.app.App | null = null;

let _initError: string | null = null;

/**
 * Normalize a service-account private key from env (Vercel often stores it as one line with literal \n).
 * Also strips accidental wrapping quotes from copy-paste.
 */
function normalizePrivateKey(raw: string): string {
  let k = raw.trim();
  if (
    (k.startsWith('"') && k.endsWith('"')) ||
    (k.startsWith("'") && k.endsWith("'"))
  ) {
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
    _initError = 'Firebase Admin env vars (FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL) are missing or contain placeholder values. Data will NOT be persisted to Firestore.';
    console.error('[checkin-store]', _initError);
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
          // Explicitly set projectId at top level — required for some Admin SDK operations.
          projectId,
        });
    _initError = null;
    return _app;
  } catch (err: any) {
    _initError = `Firebase Admin initializeApp failed: ${err?.message ?? String(err)}`;
    console.error('[checkin-store]', _initError);
    return null;
  }
}

/**
 * Returns the current Firebase / Firestore connection status.
 * Use in admin health-check endpoints to surface misconfiguration quickly.
 */
export function getFirestoreStatus(): { connected: boolean; error: string | null } {
  const app = getAdminApp();
  if (!app) return { connected: false, error: _initError ?? 'Firebase Admin not initialized' };
  return { connected: true, error: null };
}

export type FirestoreHealth = {
  connected: boolean;
  error: string | null;
  /** Which step failed — helps distinguish bad PEM vs permission vs network. */
  phase: 'missing-env' | 'init-failed' | 'firestore-read' | 'ok';
};

/**
 * Verifies Admin SDK init *and* performs a lightweight Firestore read on
 * `kiosk_checkin_records`. Catches invalid private keys, wrong project, and
 * IAM / API issues that synchronous `getFirestoreStatus()` cannot see.
 */
export async function probeFirestoreHealth(): Promise<FirestoreHealth> {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  if (
    !projectId || projectId.includes('your_') ||
    !privateKey || privateKey.includes('your_') ||
    !clientEmail
  ) {
    return {
      connected: false,
      error:
        'Missing or placeholder Firebase Admin env vars. Set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL in Vercel.',
      phase: 'missing-env',
    };
  }

  const app = getAdminApp();
  if (!app) {
    return {
      connected: false,
      error: _initError ?? 'Firebase Admin failed to initialize (check private key format).',
      phase: 'init-failed',
    };
  }

  const db = firebaseAdmin.firestore(app);
  try {
    await db.collection(COLLECTION).limit(1).get();
    return { connected: true, error: null, phase: 'ok' };
  } catch (err: unknown) {
    const e = err as { message?: string; code?: number | string };
    const msg = e?.message ?? String(err);
    console.error('[checkin-store] Firestore probe failed:', msg);
    return {
      connected: false,
      error: msg,
      phase: 'firestore-read',
    };
  }
}

function getDb(): firebaseAdmin.firestore.Firestore | null {
  const app = getAdminApp();
  return app ? firebaseAdmin.firestore(app) : null;
}

const COLLECTION = 'kiosk_checkin_records';

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

const memStore: CheckinRecord[] = [];
const MAX_MEM = 1000;

function memId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function docToRecord(d: FirebaseFirestore.DocumentSnapshot): CheckinRecord {
  const data = d.data() as Omit<CheckinRecord, 'id'>;
  return { id: d.id, ...data };
}

/** YYYY-MM-DD from ISO check-in time (UTC calendar date; matches indexed `checkInDateYmd`). */
function deriveCheckInDateYmd(checkInTimeIso: string): string | undefined {
  if (!checkInTimeIso || checkInTimeIso.length < 10) return undefined;
  const prefix = checkInTimeIso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Save a new check-in record. Returns the document ID. */
export async function saveCheckinRecord(
  record: Omit<CheckinRecord, 'id' | 'createdAt'>
): Promise<string> {
  const createdAt = record.checkInTime || new Date().toISOString();
  const checkInDateYmd =
    record.checkInDateYmd ?? deriveCheckInDateYmd(record.checkInTime) ?? undefined;
  // Strip undefined fields so Firestore doesn't choke
  const payload: Record<string, unknown> = { createdAt };
  for (const [k, v] of Object.entries(record)) {
    if (v !== undefined) payload[k] = v;
  }
  if (checkInDateYmd) payload.checkInDateYmd = checkInDateYmd;

  const db = getDb();
  if (db) {
    try {
      const ref = await db.collection(COLLECTION).add(payload);
      return ref.id;
    } catch (err) {
      console.error('[checkin-store] Firestore add failed — using in-memory store.', err);
    }
  }

  const id = memId();
  const ymd = checkInDateYmd ?? deriveCheckInDateYmd(record.checkInTime);
  memStore.unshift({ id, ...record, createdAt, ...(ymd ? { checkInDateYmd: ymd } : {}) });
  while (memStore.length > MAX_MEM) memStore.pop();
  return id;
}

/** Update an existing record (e.g. add checkOutTime or Cloudbeds IDs). */
export async function updateCheckinRecord(
  id: string,
  updates: Partial<Omit<CheckinRecord, 'id' | 'createdAt'>>
): Promise<void> {
  // Strip undefined fields
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) clean[k] = v;
  }

  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION).doc(id).update(clean);
      return;
    } catch (err) {
      console.error('[checkin-store] Firestore update failed — updating in-memory.', err);
    }
  }
  const idx = memStore.findIndex((r) => r.id === id);
  if (idx >= 0) Object.assign(memStore[idx], updates);
}

/** Delete a check-in record by document ID. */
export async function deleteCheckinRecord(id: string): Promise<void> {
  const db = getDb();
  if (db) {
    await db.collection(COLLECTION).doc(id).delete();
    return;
  }

  const idx = memStore.findIndex((r) => r.id === id);
  if (idx >= 0) memStore.splice(idx, 1);
}

/**
 * Find an existing record by Cloudbeds reservation ID.
 * Returns null if not found. Uses a simple equality query (no composite index needed).
 */
export async function findByReservationID(
  reservationID: string
): Promise<CheckinRecord | null> {
  const db = getDb();
  if (db) {
    try {
      // Simple equality — auto-indexed, no composite index required
      const snap = await db
        .collection(COLLECTION)
        .where('cloudbedsReservationID', '==', reservationID)
        .limit(1)
        .get();
      if (!snap.empty) return docToRecord(snap.docs[0]);
      return null;
    } catch (err) {
      console.error('[checkin-store] findByReservationID failed.', err);
    }
  }
  return memStore.find((r) => r.cloudbedsReservationID === reservationID) ?? null;
}

/** Delete all matching records by Cloudbeds reservation ID. */
export async function deleteByReservationID(reservationID: string): Promise<boolean> {
  const db = getDb();
  if (db) {
    const snap = await db
      .collection(COLLECTION)
      .where('cloudbedsReservationID', '==', reservationID)
      .get();
    if (snap.empty) return false;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    return true;
  }
  const before = memStore.length;
  for (let i = memStore.length - 1; i >= 0; i--) {
    if (memStore[i].cloudbedsReservationID === reservationID) memStore.splice(i, 1);
  }
  return memStore.length < before;
}

/**
 * Search active (not yet checked-out) records by partial name match.
 *
 * Fetches a recent page from Firestore and filters in JS because Firestore
 * does not support case-insensitive substring queries. The `limit` param
 * caps how many records are fetched before filtering (default 500).
 *
 * Returns records whose firstName or lastName contains the query token(s),
 * ordered most-recently checked-in first.
 */
export async function findActiveByName(
  query: string,
  limit = 500
): Promise<CheckinRecord[]> {
  const normalize = (s: string) => s.trim().toLowerCase();
  const q = normalize(query);
  if (q.length < 2) return [];

  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);

  function matches(record: CheckinRecord): boolean {
    if (record.checkOutTime) return false;
    const full = normalize(`${record.firstName} ${record.lastName}`);
    if (tokens.length === 0) return false;
    if (tokens.length === 1) {
      return (
        normalize(record.firstName).includes(tokens[0]) ||
        normalize(record.lastName).includes(tokens[0])
      );
    }
    return tokens.every((t) => full.includes(t));
  }

  const cap = Math.min(limit, 1000);
  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION)
        .orderBy('checkInTime', 'desc')
        .limit(cap)
        .get();
      const all = snap.docs.map(docToRecord).filter(matches);
      // Return only the single most-recent record per unique guest identity
      // (firstName + lastName) so the kiosk shows one card per person, not
      // every past stay they ever had.
      return dedupByName(all);
    } catch (err) {
      console.error('[checkin-store] findActiveByName Firestore failed — using in-memory.', err);
    }
  }
  return dedupByName(memStore.slice(0, cap).filter(matches));
}

/**
 * Keep only the most-recent record per unique first+last name combination.
 * The input must already be ordered most-recent-first.
 */
function dedupByName(records: CheckinRecord[]): CheckinRecord[] {
  const seen = new Set<string>();
  const out: CheckinRecord[] = [];
  for (const r of records) {
    const key = `${r.firstName.trim().toLowerCase()}|${r.lastName.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Find an existing record by firstName + lastName + checkInTime.
 * Used for dedup when cloudbedsReservationID is not yet known.
 */
export async function findByGuestKey(
  firstName: string,
  lastName: string,
  checkInTime: string
): Promise<CheckinRecord | null> {
  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION)
        .where('firstName', '==', firstName)
        .where('lastName', '==', lastName)
        .where('checkInTime', '==', checkInTime)
        .limit(1)
        .get();
      if (!snap.empty) return docToRecord(snap.docs[0]);
      return null;
    } catch (err) {
      console.error('[checkin-store] findByGuestKey failed.', err);
    }
  }
  return (
    memStore.find(
      (r) =>
        r.firstName === firstName &&
        r.lastName === lastName &&
        r.checkInTime === checkInTime
    ) ?? null
  );
}

/**
 * Find the most recent active (not yet checked-out) record for a guest by
 * name and check-in date (YYYY-MM-DD). Used as a fallback when the
 * cloudbedsReservationID is not yet linked on the stored record — e.g. when
 * Firestore was written at kiosk check-in time before the Cloudbeds reservation
 * ID was confirmed, or for same-day guests.
 *
 * Matching rules (all case-insensitive):
 *   • firstName matches AND lastName matches (or lastName is blank on either side)
 *   • checkInDateYmd OR the date prefix of checkInTime equals checkInDate
 */
export async function findByGuestName(
  firstName: string,
  lastName: string,
  checkInDate: string
): Promise<CheckinRecord | null> {
  const fn = firstName.trim().toLowerCase();
  const ln = lastName.trim().toLowerCase();
  const ymd = checkInDate.trim();

  function isMatch(r: CheckinRecord): boolean {
    if (r.checkOutTime) return false;
    const rfn = r.firstName.trim().toLowerCase();
    const rln = r.lastName.trim().toLowerCase();
    if (rfn !== fn) return false;
    if (ln && rln && rln !== ln) return false;
    const recordDate = r.checkInDateYmd ?? r.checkInTime?.slice(0, 10) ?? '';
    return recordDate === ymd;
  }

  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION)
        .where('firstName', '==', firstName.trim())
        .orderBy('checkInTime', 'desc')
        .limit(50)
        .get();
      const match = snap.docs.map(docToRecord).find(isMatch);
      if (match) return match;
    } catch (err) {
      console.error('[checkin-store] findByGuestName failed.', err);
    }
  }
  return memStore.find(isMatch) ?? null;
}

/**
 * Retrieve the most recent check-in records.
 * Optionally filter to a YYYY-MM-DD date range (applied in JS after fetching a large page).
 */
export async function getCheckinRecords(opts: {
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<CheckinRecord[]> {
  const cap = Math.min(opts.limit ?? 500, 1000);

  const db = getDb();
  if (db) {
    try {
      // Indexed date-range path (requires composite index in firestore.indexes.json).
      if (
        opts.from &&
        opts.to &&
        /^\d{4}-\d{2}-\d{2}$/.test(opts.from) &&
        /^\d{4}-\d{2}-\d{2}$/.test(opts.to)
      ) {
        try {
          const rangeSnap = await db
            .collection(COLLECTION)
            .where('checkInDateYmd', '>=', opts.from)
            .where('checkInDateYmd', '<=', opts.to)
            .orderBy('checkInDateYmd', 'desc')
            .orderBy('checkInTime', 'desc')
            .limit(cap)
            .get();
          return rangeSnap.docs.map(docToRecord);
        } catch (rangeErr) {
          console.warn(
            '[checkin-store] Indexed date-range query failed (missing index or old docs?). Falling back.',
            rangeErr
          );
        }
      }

      // Default: recent records by check-in time (single-field index, auto-created).
      const snap = await db
        .collection(COLLECTION)
        .orderBy('checkInTime', 'desc')
        .limit(cap)
        .get();

      let records = snap.docs.map(docToRecord);

      // Partial date filter (only from or only to) — filter in JS
      if (opts.from || opts.to) {
        records = records.filter((r) => {
          const ymd = r.checkInDateYmd ?? r.checkInTime?.slice(0, 10);
          if (!ymd) return !opts.from;
          if (opts.from && ymd < opts.from) return false;
          if (opts.to && ymd > opts.to) return false;
          return true;
        });
      }

      return records;
    } catch (err) {
      console.error('[checkin-store] Firestore getCheckinRecords failed — using in-memory store.', err);
    }
  }

  let results = [...memStore];
  if (opts.from || opts.to) {
    results = results.filter((r) => {
      const ymd = r.checkInTime?.slice(0, 10) ?? '';
      if (opts.from && ymd < opts.from) return false;
      if (opts.to && ymd > opts.to) return false;
      return true;
    });
  }
  return results.slice(0, cap);
}

/**
 * Upsert a record:
 * - If cloudbedsReservationID is provided, looks for an existing record with that ID.
 * - Otherwise, looks by firstName + lastName + checkInTime.
 * - If found, updates it and returns the existing ID.
 * - If not found, creates a new record and returns the new ID.
 */
export async function upsertCheckinRecord(
  record: Omit<CheckinRecord, 'id' | 'createdAt'>
): Promise<{ id: string; created: boolean }> {
  // Try to find existing
  let existing: CheckinRecord | null = null;

  if (record.cloudbedsReservationID) {
    existing = await findByReservationID(record.cloudbedsReservationID);
  }
  if (!existing && record.firstName && record.lastName && record.checkInTime) {
    existing = await findByGuestKey(record.firstName, record.lastName, record.checkInTime);
  }

  if (existing) {
    // Update: add any fields that are missing or newer (e.g. checkOutTime)
    const updates: Partial<CheckinRecord> = {};
    if (record.checkOutTime && !existing.checkOutTime) updates.checkOutTime = record.checkOutTime;
    if (record.cloudbedsReservationID && !existing.cloudbedsReservationID)
      updates.cloudbedsReservationID = record.cloudbedsReservationID;
    if (record.cloudbedsGuestID && !existing.cloudbedsGuestID)
      updates.cloudbedsGuestID = record.cloudbedsGuestID;
    if (record.roomNumber && !existing.roomNumber) updates.roomNumber = record.roomNumber;
    if (!existing.checkInDateYmd && existing.checkInTime) {
      const ymd = deriveCheckInDateYmd(existing.checkInTime);
      if (ymd) updates.checkInDateYmd = ymd;
    }
    if (Object.keys(updates).length > 0) {
      await updateCheckinRecord(existing.id, updates);
    }
    return { id: existing.id, created: false };
  }

  const id = await saveCheckinRecord(record);
  return { id, created: true };
}
