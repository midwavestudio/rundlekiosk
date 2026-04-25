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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Save a new check-in record. Returns the document ID. */
export async function saveCheckinRecord(
  record: Omit<CheckinRecord, 'id' | 'createdAt'>
): Promise<string> {
  const createdAt = record.checkInTime || new Date().toISOString();
  // Strip undefined fields so Firestore doesn't choke
  const payload: Record<string, unknown> = { createdAt };
  for (const [k, v] of Object.entries(record)) {
    if (v !== undefined) payload[k] = v;
  }

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
  memStore.unshift({ id, ...record, createdAt });
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
      // Simple descending query — single-field index, auto-created by Firestore.
      // Date filtering is done in JS to avoid composite index requirements.
      const snap = await db
        .collection(COLLECTION)
        .orderBy('checkInTime', 'desc')
        .limit(cap)
        .get();

      let records = snap.docs.map(docToRecord);

      // Apply date filter in JS (avoids needing a composite index)
      if (opts.from || opts.to) {
        records = records.filter((r) => {
          if (!r.checkInTime) return !opts.from; // no checkInTime → include only when no from-filter
          const ymd = r.checkInTime.slice(0, 10); // ISO prefix YYYY-MM-DD (works for any timezone offset)
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
    if (Object.keys(updates).length > 0) {
      await updateCheckinRecord(existing.id, updates);
    }
    return { id: existing.id, created: false };
  }

  const id = await saveCheckinRecord(record);
  return { id, created: true };
}
