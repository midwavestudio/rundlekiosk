import { NextRequest, NextResponse } from 'next/server';
import { upsertCheckinRecord } from '@/lib/checkin-store';

/**
 * POST /api/checkin-records/sync
 *
 * Accepts an array of check-in records from the kiosk's localStorage and
 * upserts them into the server-side store. Records are deduplicated by
 * cloudbedsReservationID (preferred) or firstName + lastName + checkInTime.
 *
 * This is called automatically by the kiosk on startup and periodically so
 * that the admin Arrivals / Departures tabs reflect data from all devices.
 *
 * Returns { success, results: Array<{ id, created }> }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const records: any[] = Array.isArray(body.records) ? body.records : [];

    if (records.length === 0) {
      return NextResponse.json({ success: true, results: [] });
    }

    const MAX_BATCH = 200;
    const batch = records.slice(0, MAX_BATCH);

    const results = await Promise.all(
      batch.map(async (r) => {
        try {
          const result = await upsertCheckinRecord({
            firstName: String(r.firstName ?? '').trim(),
            lastName: String(r.lastName ?? '').trim(),
            clcNumber: String(r.clcNumber ?? ''),
            phoneNumber: String(r.phoneNumber ?? ''),
            class: String(r.class ?? 'TYE'),
            roomNumber: String(r.roomNumber ?? ''),
            checkInTime: r.checkInTime ? String(r.checkInTime) : '',
            ...(r.checkOutTime ? { checkOutTime: String(r.checkOutTime) } : {}),
            ...(r.cloudbedsReservationID ? { cloudbedsReservationID: String(r.cloudbedsReservationID) } : {}),
            ...(r.cloudbedsGuestID ? { cloudbedsGuestID: String(r.cloudbedsGuestID) } : {}),
            source: r.source ? String(r.source) : 'kiosk-sync',
          });
          return result;
        } catch (err: any) {
          console.error('[checkin-records/sync] single record failed:', err?.message, r);
          return { id: null, created: false, error: err?.message };
        }
      })
    );

    const created = results.filter((r) => r.created).length;
    const updated = results.filter((r) => !r.created && r.id).length;
    console.log(`[checkin-records/sync] processed ${batch.length} records: ${created} created, ${updated} updated`);

    return NextResponse.json({ success: true, results, created, updated });
  } catch (err: any) {
    console.error('[checkin-records/sync POST]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}
