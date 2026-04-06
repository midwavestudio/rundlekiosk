import { NextRequest, NextResponse } from 'next/server';
import { savePlaceholder, placeholderExistsForRoom } from '@/lib/tye-placeholder-store';

/**
 * POST /api/admin/create-tye-placeholders
 *
 * Creates "placeholder" reservations in Cloudbeds for a list of rooms on a given date
 * (defaults to today and tomorrow). Each placeholder uses a generic dummy guest profile
 * ("TYE Placeholder") with TYE source/rate, confirmed status, and no posted payment.
 *
 * The rooms are blocked in Cloudbeds' inventory so the public booking engine cannot sell
 * them. When a walk-in guest arrives, the app assigns a placeholder to them instead of
 * creating a brand-new reservation.
 *
 * Body (JSON):
 *   roomIDs   string[]   Cloudbeds room IDs to create placeholders for
 *   dates?    string[]   YYYY-MM-DD dates to create for (defaults to today + tomorrow)
 *
 * Returns a summary of created / skipped / failed rooms per date.
 */
export async function POST(request: NextRequest) {
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
    const baseUrl = CLOUDBEDS_API_URL.replace(/\/v1\.\d+\/?$/, '');
    const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json(
        { success: false, error: 'Cloudbeds API credentials not configured' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { roomIDs, dates: requestedDates } = body as {
      roomIDs: string[];
      dates?: string[];
    };

    if (!Array.isArray(roomIDs) || roomIDs.length === 0) {
      return NextResponse.json(
        { success: false, error: 'roomIDs must be a non-empty array' },
        { status: 400 }
      );
    }

    // Default dates: today + tomorrow
    const now = new Date();
    const todayStr = localDateYmd(now);
    const tomorrowStr = localDateYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const dates: string[] = requestedDates && requestedDates.length > 0
      ? requestedDates
      : [todayStr, tomorrowStr];

    const headers = {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    // Fetch full room list once so we have roomTypeID / roomTypeName for each roomID.
    const roomMeta = await fetchRoomMeta(apiV13, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY);

    // Fetch the TYE rate plan ID once.
    const tyeRatePlanID = await resolveTyeRatePlanID(apiV13, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY, todayStr, tomorrowStr);

    const summary: Record<string, {
      created: string[];
      skipped: string[];
      failed: Array<{ roomID: string; error: string }>;
    }> = {};

    for (const forDate of dates) {
      const checkOutDate = addOneDay(forDate);
      summary[forDate] = { created: [], skipped: [], failed: [] };

      for (const roomID of roomIDs) {
        // Skip if a non-cancelled placeholder already exists for this room + date.
        const alreadyExists = await placeholderExistsForRoom(roomID, forDate);
        if (alreadyExists) {
          summary[forDate].skipped.push(roomID);
          continue;
        }

        const meta = roomMeta.get(String(roomID));
        const roomTypeID = meta?.roomTypeID ?? '';
        const roomTypeName = meta?.roomTypeName ?? 'Standard Room';
        const roomName = meta?.roomName ?? roomID;

        if (!roomTypeID) {
          summary[forDate].failed.push({ roomID, error: 'Room not found in Cloudbeds getRooms' });
          continue;
        }

        try {
          const reservationID = await createPlaceholderReservation({
            apiV13,
            headers,
            propertyID: CLOUDBEDS_PROPERTY_ID,
            roomID,
            roomTypeID,
            roomName,
            forDate,
            checkOutDate,
            tyeRatePlanID,
          });

          const docID = await savePlaceholder({
            reservationID,
            roomID,
            roomName,
            roomTypeID,
            roomTypeName,
            forDate,
            checkOutDate,
            status: 'available',
            createdAt: new Date().toISOString(),
          });

          summary[forDate].created.push(roomID);
          console.log(`TYE placeholder created: room ${roomName} date ${forDate} reservationID ${reservationID} docID ${docID}`);
        } catch (err: any) {
          summary[forDate].failed.push({ roomID, error: err?.message ?? 'Unknown error' });
          console.error(`Failed to create placeholder for room ${roomID} on ${forDate}:`, err);
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
  } catch (error: any) {
    console.error('create-tye-placeholders error:', error);
    return NextResponse.json(
      { success: false, error: error.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

interface RoomMeta {
  roomID: string;
  roomName: string;
  roomTypeID: string;
  roomTypeName: string;
}

async function fetchRoomMeta(
  apiV13: string,
  propertyID: string,
  apiKey: string
): Promise<Map<string, RoomMeta>> {
  const map = new Map<string, RoomMeta>();
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  let pageNumber = 1;
  const pageSize = 500;
  const seen = new Set<string>();

  for (;;) {
    const url = `${apiV13}/getRooms?propertyID=${encodeURIComponent(propertyID)}&pageNumber=${pageNumber}&pageSize=${pageSize}&includeRoomRelations=1`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) break;
    const data = await res.json();

    const rooms: any[] = [];
    if (Array.isArray(data.data)) {
      for (const group of data.data) {
        if (Array.isArray(group.rooms)) rooms.push(...group.rooms);
      }
    }
    if (rooms.length === 0) break;

    let newCount = 0;
    for (const room of rooms) {
      const id = String(room.roomID ?? room.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      map.set(id, {
        roomID: id,
        roomName: String(room.roomName ?? room.name ?? id),
        roomTypeID: String(room.roomTypeID ?? room.roomType_id ?? ''),
        roomTypeName: String(room.roomTypeName ?? room.roomType ?? 'Standard Room'),
      });
      newCount++;
    }
    if (newCount === 0) break;
    pageNumber++;
    if (pageNumber > 50) break;
  }
  return map;
}

/**
 * Resolve the TYE rate plan ID. Looks for a rate plan whose name includes "TYE" or
 * has ID 227753 (the known TYE plan at Rundle Suites). Falls back to the first available plan.
 */
async function resolveTyeRatePlanID(
  apiV13: string,
  propertyID: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<string | null> {
  try {
    const url = `${apiV13}/getRatePlans?propertyID=${encodeURIComponent(propertyID)}&startDate=${startDate}&endDate=${endDate}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return '227753';
    const data = await res.json();
    const plans: any[] = Array.isArray(data.data) ? data.data : [];
    const tye = plans.find(
      (p: any) =>
        String(p.ratePlanID ?? p.id ?? '') === '227753' ||
        String(p.ratePlanName ?? p.name ?? '').toLowerCase().includes('tye')
    );
    if (tye) return String(tye.ratePlanID ?? tye.id);
    if (plans.length > 0) return String(plans[0].ratePlanID ?? plans[0].id ?? '');
  } catch { /* ignore */ }
  return '227753';
}

interface CreatePlaceholderParams {
  apiV13: string;
  headers: Record<string, string>;
  propertyID: string;
  roomID: string;
  roomTypeID: string;
  roomName: string;
  forDate: string;
  checkOutDate: string;
  tyeRatePlanID: string | null;
}

/**
 * Creates a confirmed reservation in Cloudbeds with a generic "TYE Placeholder" guest.
 * Returns the Cloudbeds reservationID.
 */
async function createPlaceholderReservation(p: CreatePlaceholderParams): Promise<string> {
  const params = new URLSearchParams();
  params.append('propertyID', p.propertyID);
  params.append('startDate', p.forDate);
  params.append('endDate', p.checkOutDate);

  // Dummy guest — will be replaced when a real guest checks in.
  params.append('guestFirstName', 'TYE');
  params.append('guestLastName', 'Placeholder');
  params.append('guestEmail', 'tye-placeholder@rundlesuites.internal');
  params.append('guestPhone', '000-000-0000');
  params.append('guestCountry', 'US');
  params.append('guestZip', '00000');

  params.append('paymentMethod', 'CLC');
  params.append('rooms[0][roomTypeID]', p.roomTypeID);
  params.append('rooms[0][roomID]', p.roomID);
  params.append('rooms[0][quantity]', '1');
  if (p.tyeRatePlanID) {
    params.append('rooms[0][roomRateID]', p.tyeRatePlanID);
  }
  params.append('adults[0][roomTypeID]', p.roomTypeID);
  params.append('adults[0][quantity]', '1');
  params.append('children[0][roomTypeID]', p.roomTypeID);
  params.append('children[0][quantity]', '0');

  // TYE source code keeps Cloudbeds reports consistent.
  params.append('sourceID', 's-945658-1');

  const res = await fetch(`${p.apiV13}/postReservation`, {
    method: 'POST',
    headers: p.headers,
    body: params.toString(),
  });

  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { message: text }; }

  if (!res.ok || !data.success) {
    throw new Error(data.message ?? `postReservation failed (${res.status})`);
  }

  const reservationID = data.data?.reservationID ?? data.reservationID;
  if (!reservationID) throw new Error('No reservationID in postReservation response');

  return String(reservationID);
}
