import { NextRequest, NextResponse } from 'next/server';
import {
  saveCheckinRecord,
  updateCheckinRecord,
  getCheckinRecords,
  findByReservationID,
  upsertCheckinRecord,
  deleteCheckinRecord,
  deleteByReservationID,
} from '@/lib/checkin-store';

/**
 * GET /api/checkin-records?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=N
 *
 * Returns check-in records whose checkInTime falls within [from, to].
 * Both date params are optional; when omitted, returns the most-recent records.
 * `limit` caps Firestore reads (default 500, max 500); admin UI should pass a
 * smaller limit and a date window to stay under Spark daily quotas.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') ?? undefined;
    const to = searchParams.get('to') ?? undefined;
    let limit: number | undefined;
    if (searchParams.has('limit')) {
      const n = parseInt(searchParams.get('limit')!, 10);
      if (Number.isFinite(n)) limit = Math.min(Math.max(n, 1), 500);
    }
    const records = await getCheckinRecords({
      from,
      to,
      ...(limit !== undefined ? { limit } : {}),
    });
    return NextResponse.json({ success: true, records });
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
    const id = await saveCheckinRecord({
      firstName: String(body.firstName ?? '').trim(),
      lastName: String(body.lastName ?? '').trim(),
      clcNumber: String(body.clcNumber ?? ''),
      phoneNumber: String(body.phoneNumber ?? ''),
      class: String(body.class ?? 'TYE'),
      roomNumber: String(body.roomNumber ?? ''),
      checkInTime: body.checkInTime ? String(body.checkInTime) : new Date().toISOString(),
      ...(body.checkOutTime ? { checkOutTime: String(body.checkOutTime) } : {}),
      ...(body.cloudbedsReservationID ? { cloudbedsReservationID: String(body.cloudbedsReservationID) } : {}),
      ...(body.cloudbedsGuestID ? { cloudbedsGuestID: String(body.cloudbedsGuestID) } : {}),
      source: body.source ? String(body.source) : 'kiosk',
    });
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
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    let { id } = body;

    if (!id && body.reservationID) {
      const existing = await findByReservationID(String(body.reservationID));
      if (existing) id = existing.id;
    }

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Provide id or reservationID to identify the record' },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (body.checkOutTime !== undefined) updates.checkOutTime = String(body.checkOutTime);
    if (body.cloudbedsReservationID !== undefined) updates.cloudbedsReservationID = String(body.cloudbedsReservationID);
    if (body.cloudbedsGuestID !== undefined) updates.cloudbedsGuestID = String(body.cloudbedsGuestID);
    if (body.roomNumber !== undefined) updates.roomNumber = String(body.roomNumber);
    if (body.firstName !== undefined) updates.firstName = String(body.firstName);
    if (body.lastName !== undefined) updates.lastName = String(body.lastName);
    if (body.clcNumber !== undefined) updates.clcNumber = String(body.clcNumber);
    if (body.phoneNumber !== undefined) updates.phoneNumber = String(body.phoneNumber);
    if (body.class !== undefined) updates.class = String(body.class);

    await updateCheckinRecord(id, updates);
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
 * Body: { id? , reservationID? }
 *
 * Deletes a record by Firestore doc id or Cloudbeds reservation ID.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const id = body?.id ? String(body.id) : '';
    const reservationID = body?.reservationID ? String(body.reservationID) : '';

    if (!id && !reservationID) {
      return NextResponse.json(
        { success: false, error: 'Provide id or reservationID to identify the record' },
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
    return NextResponse.json({ success: true, deleted });
  } catch (err: any) {
    console.error('[checkin-records DELETE]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}
