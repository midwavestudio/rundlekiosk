import { NextRequest, NextResponse } from 'next/server';
import { validateClcNumberRequired } from '@/lib/checkin-validation';
import {
  saveCheckinRecord,
  updateCheckinRecord,
  getCheckinRecords,
  findByReservationID,
  findByGuestName,
  findByGuestKey,
  upsertCheckinRecord,
  deleteCheckinRecord,
  deleteByReservationID,
  type CheckinRecord,
} from '@/lib/checkin-store';

// ---------------------------------------------------------------------------
// Server-side GET cache — avoids a Firestore read on every admin tab poll.
// Busted on any write (POST / PATCH / DELETE) so data stays consistent.
// ---------------------------------------------------------------------------
interface RecordsCache {
  records: CheckinRecord[];
  from: string;
  to: string;
  limit: number;
  expiresAt: number;
}
let recordsCache: RecordsCache | null = null;
const RECORDS_CACHE_TTL_MS = 60_000; // 1 minute

function bustRecordsCache() {
  recordsCache = null;
}

/**
 * GET /api/checkin-records?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=N
 *
 * Returns check-in records whose checkInTime falls within [from, to].
 * Both date params are optional; when omitted, returns the most-recent records.
 * `limit` is a safety cap for range exports (default 50 000); live polls default to 500.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') ?? '';
    const to = searchParams.get('to') ?? '';
    // When a date range is provided (export scenario), paginate up to 50 000
    // records (safety cap). Without a range (live poll) keep the 500-doc default.
    const hasRange = searchParams.has('from') && searchParams.has('to');
    const hardCap = hasRange ? 50_000 : 500;
    let limit = hasRange ? 50_000 : 500;
    if (searchParams.has('limit')) {
      const n = parseInt(searchParams.get('limit')!, 10);
      if (Number.isFinite(n)) limit = Math.min(Math.max(n, 1), hardCap);
    }

    const now = Date.now();
    if (
      recordsCache &&
      recordsCache.from === from &&
      recordsCache.to === to &&
      recordsCache.limit >= limit &&
      now < recordsCache.expiresAt
    ) {
      return NextResponse.json(
        { success: true, records: recordsCache.records.slice(0, limit) },
        { headers: { 'Cache-Control': 'private, max-age=60' } }
      );
    }

    const records = await getCheckinRecords({
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      limit,
    });
    recordsCache = { records, from, to, limit, expiresAt: now + RECORDS_CACHE_TTL_MS };

    return NextResponse.json(
      { success: true, records },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    );
  } catch (err: any) {
    console.error('[checkin-records GET]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/checkin-records
 * Body: Omit<CheckinRecord, 'id' | 'createdAt'>
 *
 * Creates a new check-in record. Returns { success, id }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.firstName && !body.lastName) {
      return NextResponse.json(
        { success: false, error: 'firstName or lastName is required' },
        { status: 400 }
      );
    }
    const clcValidation = validateClcNumberRequired(body.clcNumber);
    if (!clcValidation.ok) {
      return NextResponse.json(
        { success: false, error: clcValidation.error },
        { status: 400 }
      );
    }
    const id = await saveCheckinRecord({
      firstName: String(body.firstName ?? '').trim(),
      lastName: String(body.lastName ?? '').trim(),
      clcNumber: clcValidation.clcNumber,
      phoneNumber: String(body.phoneNumber ?? ''),
      class: String(body.class ?? 'TYE'),
      roomNumber: String(body.roomNumber ?? ''),
      checkInTime: body.checkInTime ? String(body.checkInTime) : new Date().toISOString(),
      // Honour the client-supplied local calendar date so late-night check-ins
      // (e.g. 10:59 PM local) are not shifted to the next UTC calendar day.
      ...(body.checkInDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(String(body.checkInDateYmd))
        ? { checkInDateYmd: String(body.checkInDateYmd) }
        : {}),
      ...(body.checkOutTime ? { checkOutTime: String(body.checkOutTime) } : {}),
      ...(body.cloudbedsReservationID ? { cloudbedsReservationID: String(body.cloudbedsReservationID) } : {}),
      ...(body.cloudbedsGuestID ? { cloudbedsGuestID: String(body.cloudbedsGuestID) } : {}),
      source: body.source ? String(body.source) : 'kiosk',
    });
    bustRecordsCache();
    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    console.error('[checkin-records POST]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/checkin-records
 * Body: { id?, reservationID?, ...updates }
 *
 * Updates an existing record identified by `id` (Firestore doc ID) or
 * `reservationID` (Cloudbeds reservation ID).
 *
 * When recording a checkout (checkOutTime is provided) and no existing record
 * is found, a new stub record is created so the checkout time is never lost —
 * this handles the case where the Cloudbeds reservation ID was modified after
 * kiosk check-in and the original Firestore record has no reservationID link.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    let { id } = body;

    // ── 1. Find the record to update ────────────────────────────────────────
    // Try in priority order so that checkout timestamps always land on the
    // right Firestore document:
    //   a) Explicit Firestore doc id (most precise)
    //   b) cloudbedsReservationID equality query
    //   c) Name + check-in date match (catches records created before the
    //      reservation ID was written, e.g. when Firestore save succeeded
    //      at check-in time but the Cloudbeds reservation was not yet linked)

    if (!id && body.reservationID) {
      const existing = await findByReservationID(String(body.reservationID));
      if (existing) id = existing.id;
    }

    if (!id && body.checkOutTime) {
      // Fallback: name + check-in date — covers kiosk records that were saved
      // without a reservationID (Cloudbeds call succeeded after Firestore write)
      // and same-day guests whose record has no reservationID linked yet.
      const firstName = String(body.firstName ?? '').trim();
      const lastName = String(body.lastName ?? '').trim();
      const rawCheckInDate = String(body.checkInDateYmd ?? body.checkInDate ?? '').trim();
      const checkInDate = /^\d{4}-\d{2}-\d{2}$/.test(rawCheckInDate) ? rawCheckInDate : '';
      if (firstName && checkInDate) {
        const byName = await findByGuestName(firstName, lastName, checkInDate);
        if (byName) id = byName.id;
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.checkInTime !== undefined) {
      const checkInTime = String(body.checkInTime);
      updates.checkInTime = checkInTime;
      const rawYmd = String(body.checkInDateYmd ?? '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawYmd)) {
        updates.checkInDateYmd = rawYmd;
      } else if (checkInTime.length >= 10) {
        const d = new Date(checkInTime);
        if (!Number.isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          updates.checkInDateYmd = `${y}-${m}-${day}`;
        }
      }
    } else if (body.checkInDateYmd !== undefined) {
      const rawYmd = String(body.checkInDateYmd).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawYmd)) updates.checkInDateYmd = rawYmd;
    }
    if (body.checkOutTime !== undefined) {
      const raw = body.checkOutTime;
      updates.checkOutTime = raw === null || raw === '' ? null : String(raw);
    }
    if (body.cloudbedsReservationID !== undefined) updates.cloudbedsReservationID = String(body.cloudbedsReservationID);
    if (body.cloudbedsGuestID !== undefined) updates.cloudbedsGuestID = String(body.cloudbedsGuestID);
    if (body.roomNumber !== undefined) updates.roomNumber = String(body.roomNumber);
    if (body.firstName !== undefined) updates.firstName = String(body.firstName);
    if (body.lastName !== undefined) updates.lastName = String(body.lastName);
    if (body.clcNumber !== undefined) updates.clcNumber = String(body.clcNumber);
    if (body.phoneNumber !== undefined) updates.phoneNumber = String(body.phoneNumber);
    if (body.class !== undefined) updates.class = String(body.class);
    if (body.reservationStatus !== undefined) updates.reservationStatus = String(body.reservationStatus);
    // Also stamp the reservationID onto the record if it wasn't there before
    if (body.reservationID && !updates.cloudbedsReservationID) {
      updates.cloudbedsReservationID = String(body.reservationID);
    }

    if (!id) {
      // No existing record found. If we have a checkout time to record, create a
      // stub so the departure is never silently lost. This covers:
      //   • Guests who checked in via Cloudbeds directly (not through the kiosk)
      //   • Guests whose reservation was created or modified after kiosk check-in
      if (body.checkOutTime) {
        // Use the real check-in date from Cloudbeds so the stub appears under
        // the correct date in the Arrivals tab, not under today's date.
        let checkInTime: string;
        if (body.checkInTime && String(body.checkInTime).length > 5) {
          checkInTime = String(body.checkInTime);
        } else if (body.checkInDate && /^\d{4}-\d{2}-\d{2}$/.test(String(body.checkInDate))) {
          // Use noon local-ish time (avoids UTC date boundary shifting)
          checkInTime = `${String(body.checkInDate)}T18:00:00.000Z`;
        } else {
          checkInTime = new Date().toISOString();
        }
        const checkInDateYmd = body.checkInDate && /^\d{4}-\d{2}-\d{2}$/.test(String(body.checkInDate))
          ? String(body.checkInDate)
          : checkInTime.slice(0, 10);
        const newId = await saveCheckinRecord({
          firstName: String(body.firstName ?? '').trim() || 'Unknown',
          lastName: String(body.lastName ?? '').trim(),
          clcNumber: String(body.clcNumber ?? ''),
          phoneNumber: String(body.phoneNumber ?? ''),
          class: String(body.class ?? 'TYE'),
          roomNumber: String(body.roomNumber ?? ''),
          checkInTime,
          checkInDateYmd,
          checkOutTime: String(body.checkOutTime),
          ...(body.reservationID ? { cloudbedsReservationID: String(body.reservationID) } : {}),
          ...(body.cloudbedsReservationID ? { cloudbedsReservationID: String(body.cloudbedsReservationID) } : {}),
          ...(body.cloudbedsGuestID ? { cloudbedsGuestID: String(body.cloudbedsGuestID) } : {}),
          source: 'kiosk:checkout-stub',
        });
        console.log('[checkin-records PATCH] No existing record — created checkout stub:', newId, {
          reservationID: body.reservationID,
          firstName: body.firstName,
          checkInDate: body.checkInDate,
        });
        return NextResponse.json({ success: true, id: newId, created: true });
      }
      return NextResponse.json(
        { success: false, error: 'Provide id or reservationID to identify the record' },
        { status: 400 }
      );
    }

    await updateCheckinRecord(id, updates);
    bustRecordsCache();
    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    console.error('[checkin-records PATCH]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/checkin-records
 * Body: { id?, reservationID?, firstName?, lastName?, checkInTime?, checkInDateYmd? }
 *
 * Deletes by Firestore doc id and/or Cloudbeds reservation ID, with fallbacks:
 * reservation lookup, then guest key (name + exact checkInTime), then name +
 * checkInDateYmd (YYYY-MM-DD). Invalid or locale display dates in checkInDate
 * are ignored — prefer checkInDateYmd from the client.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const rawId = body?.id ? String(body.id).trim() : '';
    let id =
      rawId &&
      rawId !== 'undefined' &&
      rawId !== 'null' &&
      rawId !== 'NaN'
        ? rawId
        : '';
    const reservationID = body?.reservationID ? String(body.reservationID).trim() : '';

    // Fallback identity for rows that don't carry a valid id/reservationID
    const firstName = body?.firstName ? String(body.firstName).trim() : '';
    const lastName = body?.lastName ? String(body.lastName).trim() : '';
    const checkInTime = body?.checkInTime ? String(body.checkInTime).trim() : '';
    const rawCheckInDate = String(body?.checkInDateYmd ?? body?.checkInDate ?? '').trim();
    const checkInDateYmd = /^\d{4}-\d{2}-\d{2}$/.test(rawCheckInDate) ? rawCheckInDate : '';

    // Resolve Firestore doc id: explicit id → reservation lookup → guest key (even if
    // reservationID was sent but wrong/stale) → name + calendar date (YYYY-MM-DD only).
    if (!id && reservationID) {
      const existing = await findByReservationID(reservationID);
      if (existing) id = existing.id;
    }
    if (!id && firstName && checkInTime) {
      const byKey = await findByGuestKey(firstName, lastName, checkInTime);
      if (byKey?.id) id = byKey.id;
    }
    if (!id && firstName && checkInDateYmd) {
      const byName = await findByGuestName(firstName, lastName, checkInDateYmd);
      if (byName?.id) id = byName.id;
    }

    const hasGuestHints = !!(firstName && (checkInTime || checkInDateYmd));
    if (!id && !reservationID && !hasGuestHints) {
      return NextResponse.json(
        { success: false, error: 'Provide id, reservationID, or guest identity fields to identify the record' },
        { status: 400 }
      );
    }

    let deleted = false;
    if (id) {
      await deleteCheckinRecord(id);
      deleted = true;
    }
    if (reservationID) {
      const byReservation = await deleteByReservationID(reservationID);
      deleted = deleted || byReservation;
    }
    bustRecordsCache();
    return NextResponse.json({ success: true, deleted });
  } catch (err: any) {
    console.error('[checkin-records DELETE]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}
