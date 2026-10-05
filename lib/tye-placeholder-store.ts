import 'server-only';

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
import { bustRoomsCache } from '@/lib/available-rooms-cache';

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
  /** Normalized "firstname|lastname" of the guest who claimed this block (pickup lock). */
  assignedGuestKey?: string;
  /** Display name of the guest who claimed this block */
  assignedGuestName?: string;
  /** Last time we checked Cloudbeds for external changes */
  lastSyncedAt?: string;
  /** Latest status value returned from Cloudbeds during sync */
  cloudbedsStatus?: string;
}

export const TYE_PLACEHOLDER_EMAIL = 'tye-placeholder@rundlesuites.internal';

/** Stable lock key so the same guest can retry without releasing the block to someone else. */
export function placeholderGuestKey(firstName: string, lastName: string): string {
  return `${String(firstName).trim().toLowerCase()}|${String(lastName).trim().toLowerCase()}`;
}

/** True when Cloudbeds still has the dummy TYE Block guest — the only safe time to putGuest. */
export function isTyePlaceholderDummyGuest(firstName: string, lastName: string, email?: string): boolean {
  const e = String(email ?? '').trim().toLowerCase();
  if (e === TYE_PLACEHOLDER_EMAIL) return true;
  const f = String(firstName).trim().toLowerCase();
  const l = String(lastName).trim().toLowerCase();
  if (f === 'tye' && (l === 'block' || l.includes('placeholder'))) return true;
  return false;
}

export type ClaimPlaceholderResult =
  | { ok: true; alreadyHeldByThisGuest: boolean }
  | { ok: false; status: PlaceholderStatus; assignedGuestName?: string };

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

// ---------------------------------------------------------------------------
// In-process cache for placeholder date queries — avoids repeated full-collection
// reads when the kiosk or admin calls available-rooms for the same date multiple
// times within a short window (e.g. page load + re-render).
// ---------------------------------------------------------------------------
interface PlaceholderDateCache {
  items: TyePlaceholder[];
  expiresAt: number;
}
const placeholderDateCache = new Map<string, PlaceholderDateCache>();
const PLACEHOLDER_CACHE_TTL_MS = 5 * 60_000; // 5 minutes

/** Invalidate all cached placeholder results (call after any write). */
export function bustPlaceholderCache() {
  placeholderDateCache.clear();
  bustRoomsCache();
}

/** Save a newly-created placeholder. Returns the document ID. */
export async function savePlaceholder(
  data: Omit<TyePlaceholder, 'id'>
): Promise<string> {
  bustPlaceholderCache();
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

/**
 * Admin TYE block creation: persist to Firestore when configured, or throw — no silent fallback to
 * memory when Firestore fails (avoids marking a block "created" without a durable record while a
 * Cloudbeds reservation still exists). When Firebase is not configured, uses the same in-memory store as dev.
 */
export async function saveTyeBlockPlaceholderOrThrow(
  data: Omit<TyePlaceholder, 'id'>
): Promise<string> {
  bustPlaceholderCache();
  const db = getDb();
  if (db) {
    const ref = await db.collection(COLLECTION).add({
      ...data,
      createdAt: data.createdAt ?? new Date().toISOString(),
    });
    return ref.id;
  }

  const id = nextMemoryId();
  memoryStore.set(id, { ...data, id });
  return id;
}

/** Return all placeholders for a specific check-in date, regardless of status. */
export async function getPlaceholdersByDate(
  forDate: string
): Promise<TyePlaceholder[]> {
  // Return cached result if still fresh
  const now = Date.now();
  const cached = placeholderDateCache.get(forDate);
  if (cached && now < cached.expiresAt) {
    return cached.items;
  }

  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION)
        .where('forDate', '==', forDate)
        .limit(200)
        .get();
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TyePlaceholder, 'id'>) }));
      placeholderDateCache.set(forDate, { items, expiresAt: now + PLACEHOLDER_CACHE_TTL_MS });
      return items;
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

/** Calendar arithmetic for YYYY-MM-DD at local noon (avoids DST midnight surprises). */
export function addCalendarDaysYmd(ymd: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return localDateYmd(d);
}

/**
 * Available placeholders whose stay overlaps [checkInYmd, checkOutYmd) (hotel-night window).
 * Loads a small day window around checkIn so blocks created for an adjacent calendar label
 * still match; callers should pass the kiosk/property check-in date when possible.
 */
export async function getAvailablePlaceholdersOverlappingStay(
  checkInYmd: string,
  checkOutYmd: string
): Promise<TyePlaceholder[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkInYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOutYmd)) {
    return [];
  }
  const dates = [
    addCalendarDaysYmd(checkInYmd, -1),
    checkInYmd,
    addCalendarDaysYmd(checkInYmd, 1),
  ];
  const uniq = [...new Set(dates)];
  const all = await getPlaceholdersForDates(uniq);
  return all.filter(
    (p) =>
      p.status === 'available' &&
      p.forDate < checkOutYmd &&
      checkInYmd < p.checkOutDate
  );
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
  bustPlaceholderCache();
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
  guestID: string,
  extra?: { guestKey?: string; guestName?: string }
): Promise<void> {
  await updatePlaceholder(id, {
    status: 'assigned',
    assignedAt: new Date().toISOString(),
    assignedGuestID: guestID,
    ...(extra?.guestKey ? { assignedGuestKey: extra.guestKey } : {}),
    ...(extra?.guestName ? { assignedGuestName: extra.guestName } : {}),
  });
}

/**
 * Atomically claim an available block so a second kiosk check-in cannot pick it up.
 * The same guest may retry (network / payment resume) without releasing the lock.
 */
export async function tryClaimPlaceholder(
  id: string,
  guestKey: string,
  guestName: string
): Promise<ClaimPlaceholderResult> {
  const assignedAt = new Date().toISOString();
  const claimFields = {
    status: 'assigned' as const,
    assignedAt,
    assignedGuestKey: guestKey,
    assignedGuestName: guestName,
  };

  const db = getDb();
  if (db) {
    const ref = db.collection(COLLECTION).doc(id);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        return { ok: false as const, status: 'cancelled' as PlaceholderStatus };
      }
      const data = snap.data() as Omit<TyePlaceholder, 'id'>;
      if (data.status === 'cancelled') {
        return { ok: false as const, status: data.status };
      }
      if (data.status === 'assigned' || data.status === 'externally_modified') {
        const held = String(data.assignedGuestKey ?? '').trim();
        if (held && held === guestKey) {
          return { ok: true as const, alreadyHeldByThisGuest: true };
        }
        return {
          ok: false as const,
          status: data.status,
          assignedGuestName: data.assignedGuestName,
        };
      }
      tx.update(ref, claimFields);
      return { ok: true as const, alreadyHeldByThisGuest: false };
    });
    if (result.ok) {
      bustPlaceholderCache();
    }
    return result;
  }

  const existing = memoryStore.get(id);
  if (!existing) return { ok: false, status: 'cancelled' };
  if (existing.status === 'cancelled') return { ok: false, status: existing.status };
  if (existing.status === 'assigned' || existing.status === 'externally_modified') {
    const held = String(existing.assignedGuestKey ?? '').trim();
    if (held && held === guestKey) return { ok: true, alreadyHeldByThisGuest: true };
    return { ok: false, status: existing.status, assignedGuestName: existing.assignedGuestName };
  }
  memoryStore.set(id, { ...existing, ...claimFields });
  bustPlaceholderCache();
  return { ok: true, alreadyHeldByThisGuest: false };
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

/** Return all placeholders for the given check-in dates (deduped). */
export async function getPlaceholdersForDates(dates: string[]): Promise<TyePlaceholder[]> {
  const uniq = [...new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
  if (uniq.length === 0) return [];
  const lists = await Promise.all(uniq.map((d) => getPlaceholdersByDate(d)));
  return lists.flat();
}

/** Return all placeholders for today and tomorrow. */
export async function getPlaceholdersForTodayAndTomorrow(): Promise<TyePlaceholder[]> {
  const now = new Date();
  const today = localDateYmd(now);
  const tomorrow = localDateYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  return getPlaceholdersForDates([today, tomorrow]);
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
