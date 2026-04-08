import { NextRequest, NextResponse } from 'next/server';
import { performCloudbedsCheckIn } from '@/lib/cloudbeds-checkin';
import { savePlaceholder, placeholderExistsForRoom } from '@/lib/tye-placeholder-store';

/**
 * POST /api/admin/create-tye-placeholders
 *
 * Creates placeholder reservations using the **same** Cloudbeds path as kiosk walk-in check-in
 * (`performCloudbedsCheckIn`): same room resolution, TYE rate selection, sourceID, and
 * postReservation body — then stops before payment or check-in (`stopAfterReservationCreate`).
 *
 * Body (JSON):
 *   roomIDs   string[]   Cloudbeds room IDs to create placeholders for
 *   dates?    string[]   YYYY-MM-DD dates (defaults to today + tomorrow)
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.CLOUDBEDS_API_KEY || !process.env.CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json(
        { success: false, error: 'Cloudbeds API credentials not configured' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { roomIDs, dates: requestedDates, roomHints } = body as {
      roomIDs: string[];
      dates?: string[];
      /** roomID → display name (optional), same role as kiosk `roomNameHint` */
      roomHints?: Record<string, string>;
    };

    if (!Array.isArray(roomIDs) || roomIDs.length === 0) {
      return NextResponse.json(
        { success: false, error: 'roomIDs must be a non-empty array' },
        { status: 400 }
      );
    }

    const now = new Date();
    const todayStr = localDateYmd(now);
    const tomorrowStr = localDateYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const dates: string[] =
      requestedDates && requestedDates.length > 0 ? requestedDates : [todayStr, tomorrowStr];

    const summary: Record<
      string,
      { created: string[]; skipped: string[]; failed: Array<{ roomID: string; error: string }> }
    > = {};

    for (const forDate of dates) {
      const checkOutDate = addOneDay(forDate);
      summary[forDate] = { created: [], skipped: [], failed: [] };

      for (const roomID of roomIDs) {
        const rid = String(roomID).trim();

        const alreadyExists = await placeholderExistsForRoom(rid, forDate);
        if (alreadyExists) {
          summary[forDate].skipped.push(rid);
          continue;
        }

        try {
          const hint =
            roomHints && typeof roomHints[rid] === 'string' && roomHints[rid].trim() !== ''
              ? roomHints[rid].trim()
              : undefined;

          const result = await performCloudbedsCheckIn({
            firstName: 'TYE',
            lastName: 'Placeholder',
            phoneNumber: '000-000-0000',
            email: 'tye-placeholder@rundlesuites.internal',
            classType: 'TYE',
            roomName: rid,
            roomNameHint: hint,
            checkInDate: forDate,
            checkOutDate,
            stopAfterReservationCreate: true,
          });

          try {
            await savePlaceholder({
              reservationID: result.reservationID,
              roomID: rid,
              roomName: result.roomName,
              roomTypeID: result.roomTypeID ?? '',
              roomTypeName: result.roomTypeName ?? 'Standard Room',
              forDate,
              checkOutDate,
              status: 'available',
              createdAt: new Date().toISOString(),
            });
          } catch (storeErr: unknown) {
            console.error('savePlaceholder failed (reservation exists in Cloudbeds):', storeErr);
          }

          summary[forDate].created.push(rid);
          console.log(
            `TYE placeholder via performCloudbedsCheckIn: room ${result.roomName} date ${forDate} reservationID ${result.reservationID}`
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          summary[forDate].failed.push({ roomID: rid, error: message });
          console.error(`Failed to create placeholder for room ${rid} on ${forDate}:`, err);
        }
      }
    }

    const totalCreated = Object.values(summary).reduce((n, s) => n + s.created.length, 0);
    const totalFailed = Object.values(summary).reduce((n, s) => n + s.failed.length, 0);

    return NextResponse.json({
      success: totalFailed === 0,
      summary,
      totalCreated,
      totalSkipped: Object.values(summary).reduce((n, s) => n + s.skipped.length, 0),
      totalFailed,
    });
  } catch (error: unknown) {
    console.error('create-tye-placeholders error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function localDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addOneDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return localDateYmd(dt);
}
