import { NextRequest, NextResponse } from 'next/server';
import {
  saveCheckinRecord,
  updateCheckinRecord,
  getCheckinRecords,
  findByReservationID,
  upsertCheckinRecord,
} from '@/lib/checkin-store';

/**
 * GET /api/checkin-records?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns check-in records whose checkInTime falls within [from, to].
 * Both params are optional; when omitted, returns the 500 most-recent records.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') ?? undefined;
    const to = searchParams.get('to') ?? undefined;
    const records = await getCheckinRecords({ from, to });
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
