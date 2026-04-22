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

/** Return all feedback messages ordered newest first. */
export async function getAllFeedback(): Promise<FeedbackMessage[]> {
  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION)
        .orderBy('submittedAt', 'desc')
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FeedbackMessage, 'id'>) }));
    } catch (err) {
      console.error('[feedback] Firestore query failed — using in-memory store.', err);
    }
  }

  return Array.from(memoryStore.values()).sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );
}

/** Update the status or notes on a feedback message. */
export async function updateFeedback(
  id: string,
  updates: Partial<Pick<FeedbackMessage, 'status' | 'notes'>>
): Promise<void> {
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION).doc(id).update(updates as Record<string, unknown>);
      return;
    } catch (err) {
      console.error('[feedback] Firestore update failed, merging in-memory if present.', err);
    }
  }

  const existing = memoryStore.get(id);
  if (existing) {
    memoryStore.set(id, { ...existing, ...updates });
  }
}
