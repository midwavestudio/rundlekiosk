/**
 * TYE Placeholder Reservation Store
 *
 * Stores placeholder reservation state in Firestore. Each document tracks a Cloudbeds
 * "placeholder" reservation created for a specific room and date. When a guest checks in,
 * the placeholder is claimed and its Cloudbeds record updated with real guest data.
 *
 * Falls back to an in-memory map when Firebase is not configured (dev / CI environments).
 */

import * as firebaseAdmin from 'firebase-admin';

export type PlaceholderStatus =
  | 'available'           // Placeholder is free — no real guest assigned yet
  | 'assigned'            // A guest has been assigned and checked in
  | 'externally_modified' // Staff changed it in Cloudbeds outside the app
  | 'cancelled';          // Reservation was cancelled in Cloudbeds

export interface TyePlaceholder {
  /** Firestore document ID */
  id: string;
  /** Cloudbeds reservation ID for the placeholder booking */
  reservationID: string;
  /** Cloudbeds internal room ID */
  roomID: string;
  /** Human-readable room name (e.g. "308i") */
  roomName: string;
  /** Cloudbeds room type ID */
  roomTypeID: string;
  /** Room type display name */
  roomTypeName: string;
  /** YYYY-MM-DD check-in date this placeholder covers */
  forDate: string;
  /** YYYY-MM-DD check-out date (always forDate + 1 day) */
  checkOutDate: string;
  status: PlaceholderStatus;
  createdAt: string;
  /** Cloudbeds guest ID of the dummy placeholder guest */
  placeholderGuestID?: string;
  /** When a real guest was assigned */
  assignedAt?: string;
  /** Cloudbeds guest ID of the real guest */
  assignedGuestID?: string;
  /** Last time we checked Cloudbeds for external changes */
  lastSyncedAt?: string;
  /** Latest status value returned from Cloudbeds during sync */
  cloudbedsStatus?: string;
}

// ---------------------------------------------------------------------------
// Firebase initialisation (mirrors lib/firebase.js but in TS)
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
    // Re-use existing app if Next.js hot-reload already initialised one.
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

// ---------------------------------------------------------------------------
// In-memory fallback (used when Firestore is unavailable)
// ---------------------------------------------------------------------------

const memoryStore = new Map<string, TyePlaceholder>();

function nextMemoryId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Public store API
// ---------------------------------------------------------------------------

const COLLECTION = 'tye_placeholders';

/** Save a newly-created placeholder. Returns the document ID. */
export async function savePlaceholder(
  data: Omit<TyePlaceholder, 'id'>
): Promise<string> {
  const db = getDb();
  if (db) {
    try {
      const ref = await db.collection(COLLECTION).add({
        ...data,
        createdAt: data.createdAt ?? new Date().toISOString(),
      });
      return ref.id;
    } catch (err) {
      console.error(
        '[tye_placeholders] Firestore add failed — using in-memory store. Create Firestore DB in Firebase console if you need persistence.',
        err
      );
    }
  }

  const id = nextMemoryId();
  memoryStore.set(id, { ...data, id });
  return id;
}

/** Return all placeholders for a specific check-in date, regardless of status. */
export async function getPlaceholdersByDate(
  forDate: string
): Promise<TyePlaceholder[]> {
  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION)
        .where('forDate', '==', forDate)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TyePlaceholder, 'id'>) }));
    } catch (err) {
      console.error(
        '[tye_placeholders] Firestore query failed — using in-memory store only for this process.',
        err
      );
    }
  }

  return Array.from(memoryStore.values()).filter((p) => p.forDate === forDate);
}

/** Return only 'available' placeholders for a given date. */
export async function getAvailablePlaceholdersByDate(
  forDate: string
): Promise<TyePlaceholder[]> {
  const all = await getPlaceholdersByDate(forDate);
  return all.filter((p) => p.status === 'available');
}

/** Look up a single placeholder by its Cloudbeds reservation ID. */
export async function getPlaceholderByReservationID(
  reservationID: string
): Promise<TyePlaceholder | null> {
  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION)
        .where('reservationID', '==', reservationID)
        .limit(1)
        .get();
      if (snap.empty) {
        /* may exist only in memory */
      } else {
        const doc = snap.docs[0];
        return { id: doc.id, ...(doc.data() as Omit<TyePlaceholder, 'id'>) };
      }
    } catch (err) {
      console.error('[tye_placeholders] Firestore getPlaceholderByReservationID failed:', err);
    }
  }

  for (const p of memoryStore.values()) {
    if (p.reservationID === reservationID) return p;
  }
  return null;
}

/** Update fields on an existing placeholder document. */
export async function updatePlaceholder(
  id: string,
  updates: Partial<Omit<TyePlaceholder, 'id'>>
): Promise<void> {
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION).doc(id).update(updates as Record<string, unknown>);
      return;
    } catch (err) {
      console.error('[tye_placeholders] Firestore update failed, merging in-memory if present:', err);
    }
  }

  const existing = memoryStore.get(id);
  if (existing) {
    memoryStore.set(id, { ...existing, ...updates });
  }
}

/** Mark a placeholder as assigned to a real guest. */
export async function assignPlaceholder(
  id: string,
  guestID: string
): Promise<void> {
  await updatePlaceholder(id, {
    status: 'assigned',
    assignedAt: new Date().toISOString(),
    assignedGuestID: guestID,
  });
}

/** Check whether a placeholder already exists for a given room + date combination. */
export async function placeholderExistsForRoom(
  roomID: string,
  forDate: string
): Promise<boolean> {
  const all = await getPlaceholdersByDate(forDate);
  return all.some(
    (p) =>
      String(p.roomID) === String(roomID) &&
      p.status !== 'cancelled'
  );
}

/** Return all placeholders for today and tomorrow. */
export async function getPlaceholdersForTodayAndTomorrow(): Promise<TyePlaceholder[]> {
  const now = new Date();
  const today = localDateYmd(now);
  const tomorrow = localDateYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const [todayList, tomorrowList] = await Promise.all([
    getPlaceholdersByDate(today),
    getPlaceholdersByDate(tomorrow),
  ]);
  return [...todayList, ...tomorrowList];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
