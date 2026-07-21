import 'server-only';

/**
 * Guest Feedback Store
 *
 * Stores guest-submitted feedback/messages in Firestore. Falls back to an
 * in-memory map when Firebase is not configured (dev / CI environments).
 */

import * as firebaseAdmin from 'firebase-admin';

export type FeedbackStatus = 'new' | 'reviewed' | 'resolved';

export interface FeedbackMessage {
  /** Firestore document ID */
  id: string;
  /** Guest's message */
  message: string;
  /** Optional name/room the guest provided */
  name?: string;
  /** ISO timestamp of submission */
  submittedAt: string;
  status: FeedbackStatus;
  /** Optional admin notes */
  notes?: string;
  /** ISO timestamp when an admin marked this message read (shared across devices). */
  readAt?: string;
}

// ---------------------------------------------------------------------------
// Firebase initialisation (mirrors lib/tye-placeholder-store.ts)
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
  if (!app) return null;
  return firebaseAdmin.firestore(app);
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

const memoryStore = new Map<string, FeedbackMessage>();

function nextMemoryId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Public store API
// ---------------------------------------------------------------------------

const COLLECTION = 'guest_feedback';

/** Save a new feedback message. Returns the document ID. */
export async function saveFeedback(
  data: Omit<FeedbackMessage, 'id'>
): Promise<string> {
  const db = getDb();
  if (db) {
    try {
      const ref = await db.collection(COLLECTION).add(data);
      return ref.id;
    } catch (err) {
      console.error('[feedback] Firestore add failed — using in-memory store.', err);
    }
  }

  const id = nextMemoryId();
  memoryStore.set(id, { ...data, id });
  return id;
}

/** Return all feedback messages ordered newest first (capped at 200). */
export async function getAllFeedback(limit = 200): Promise<FeedbackMessage[]> {
  const cap = Math.min(Math.max(limit, 1), 500);
  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION)
        .orderBy('submittedAt', 'desc')
        .limit(cap)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FeedbackMessage, 'id'>) }));
    } catch (err) {
      console.error('[feedback] Firestore query failed — using in-memory store.', err);
    }
  }

  return Array.from(memoryStore.values())
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
    .slice(0, cap);
}

type FeedbackUpdates = Partial<Pick<FeedbackMessage, 'status' | 'notes' | 'readAt'>> & {
  /** When true, clears shared read state so the message is unread on all devices. */
  clearReadAt?: boolean;
};

function applyFeedbackUpdates(
  existing: FeedbackMessage,
  updates: FeedbackUpdates
): FeedbackMessage {
  const next: FeedbackMessage = { ...existing };
  if (updates.status !== undefined) next.status = updates.status;
  if (updates.notes !== undefined) next.notes = updates.notes;
  if (updates.clearReadAt) {
    delete next.readAt;
  } else if (updates.readAt !== undefined) {
    next.readAt = updates.readAt;
  }
  return next;
}

function toFirestorePayload(updates: FeedbackUpdates): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.clearReadAt) {
    payload.readAt = firebaseAdmin.firestore.FieldValue.delete();
  } else if (updates.readAt !== undefined) {
    payload.readAt = updates.readAt;
  }
  return payload;
}

/** Update the status, notes, or shared read state on a feedback message. */
export async function updateFeedback(
  id: string,
  updates: FeedbackUpdates
): Promise<void> {
  const db = getDb();
  if (db) {
    try {
      const payload = toFirestorePayload(updates);
      if (Object.keys(payload).length === 0) return;
      await db.collection(COLLECTION).doc(id).update(payload);
      return;
    } catch (err) {
      console.error('[feedback] Firestore update failed, merging in-memory if present.', err);
    }
  }

  const existing = memoryStore.get(id);
  if (existing) {
    memoryStore.set(id, applyFeedbackUpdates(existing, updates));
  }
}

/** Mark one or more feedback messages as read or unread (shared across devices). */
export async function setFeedbackReadState(
  ids: string[],
  read: boolean
): Promise<void> {
  const uniqueIds = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  if (uniqueIds.length === 0) return;

  const updates: FeedbackUpdates = read
    ? { readAt: new Date().toISOString() }
    : { clearReadAt: true };

  const db = getDb();
  if (db) {
    try {
      const payload = toFirestorePayload(updates);
      // Firestore batches are capped at 500 writes.
      for (let i = 0; i < uniqueIds.length; i += 450) {
        const chunk = uniqueIds.slice(i, i + 450);
        const batch = db.batch();
        for (const id of chunk) {
          batch.update(db.collection(COLLECTION).doc(id), payload);
        }
        await batch.commit();
      }
      return;
    } catch (err) {
      console.error('[feedback] Firestore batch read-state update failed — using in-memory store.', err);
    }
  }

  for (const id of uniqueIds) {
    const existing = memoryStore.get(id);
    if (existing) {
      memoryStore.set(id, applyFeedbackUpdates(existing, updates));
    }
  }
}

/** Permanently remove a feedback message. */
export async function deleteFeedback(id: string): Promise<void> {
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION).doc(id).delete();
      return;
    } catch (err) {
      console.error('[feedback] Firestore delete failed — removing from in-memory store if present.', err);
    }
  }

  memoryStore.delete(id);
}
