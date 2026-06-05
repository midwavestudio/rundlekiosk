import { NextResponse } from 'next/server';
import * as firebaseAdmin from 'firebase-admin';

/**
 * POST /api/admin/backfill-checkin-dates
 *
 * One-time maintenance route: stamps `checkInDateYmd` (YYYY-MM-DD) on every
 * kiosk_checkin_records document that is missing the field.
 *
 * Without this field, the indexed date-range export query silently skips
 * records saved before the field was introduced, causing exports to start
 * from the date the field was first written rather than the actual earliest
 * record date.
 *
 * This route reads all documents in batches of 500 (Firestore batch limit),
 * derives checkInDateYmd from checkInTime, and writes it back using a
 * batched commit.  Documents that already have the field are skipped.
 *
 * Returns { updated, skipped, errors } so the caller can verify.
 */

const COLLECTION = 'kiosk_checkin_records';

function getDb(): firebaseAdmin.firestore.Firestore | null {
  const projectId  = process.env.FIREBASE_PROJECT_ID;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  if (!projectId || !privateKey || !clientEmail) return null;

  try {
    const app = firebaseAdmin.apps.length
      ? (firebaseAdmin.apps[0] as firebaseAdmin.app.App)
      : firebaseAdmin.initializeApp({
          credential: firebaseAdmin.credential.cert({
            projectId,
            privateKey: privateKey.replace(/\\n/g, '\n'),
            clientEmail,
          }),
          projectId,
        });
    return firebaseAdmin.firestore(app);
  } catch {
    return null;
  }
}

function deriveYmd(checkInTime: string): string | null {
  if (!checkInTime || checkInTime.length < 10) return null;
  const prefix = checkInTime.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : null;
}

export async function POST() {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ success: false, error: 'Firebase not configured' }, { status: 500 });
  }

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let lastDoc: firebaseAdmin.firestore.QueryDocumentSnapshot | null = null;
  const PAGE = 500;

  try {
    while (true) {
      let query = db.collection(COLLECTION).orderBy('checkInTime', 'desc').limit(PAGE);
      if (lastDoc) query = query.startAfter(lastDoc) as typeof query;

      const snap = await query.get();
      if (snap.empty) break;

      const batch = db.batch();
      let batchHasWrites = false;

      for (const doc of snap.docs) {
        const data = doc.data();
        if (data.checkInDateYmd) {
          skipped++;
          continue;
        }
        const ymd = deriveYmd(String(data.checkInTime ?? ''));
        if (!ymd) {
          errors++;
          continue;
        }
        batch.update(doc.ref, { checkInDateYmd: ymd });
        updated++;
        batchHasWrites = true;
      }

      if (batchHasWrites) await batch.commit();
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < PAGE) break;
    }

    return NextResponse.json({ success: true, updated, skipped, errors });
  } catch (err: any) {
    console.error('[backfill-checkin-dates]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Backfill failed', updated, skipped, errors },
      { status: 500 }
    );
  }
}
