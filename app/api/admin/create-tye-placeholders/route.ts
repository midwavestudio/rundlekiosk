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

    const summary: Record<string, {
      created: string[];
      skipped: string[];
      failed: Array<{ roomID: string; error: string }>;
    }> = {};

    for (const forDate of dates) {
      const checkOutDate = addOneDay(forDate);
      summary[forDate] = { created: [], skipped: [], failed: [] };

      for (const roomID of roomIDs) {
        const rid = String(roomID).trim();
        // Skip if a non-cancelled placeholder already exists for this room + date.
        const alreadyExists = await placeholderExistsForRoom(rid, forDate);
        if (alreadyExists) {
          summary[forDate].skipped.push(rid);
          continue;
        }

        let meta = roomMeta.get(rid);
        if (!meta) {
          for (const [, m] of roomMeta) {
            if (String(m.roomName).trim() === rid) {
              meta = m;
              break;
            }
          }
        }
        const roomTypeID = meta?.roomTypeID ?? '';
        const roomTypeName = meta?.roomTypeName ?? 'Standard Room';
        const roomName = meta?.roomName ?? roomID;

        if (!roomTypeID) {
          summary[forDate].failed.push({ roomID: rid, error: 'Room not found in Cloudbeds getRooms' });
          continue;
        }

        // Same as performCloudbedsCheckIn: rate must match room type; rooms[0][roomRateID] expects rateID when present.
        const roomRateIDStr = await resolveTyeRoomRateStr(
          apiV13,
          CLOUDBEDS_PROPERTY_ID,
          CLOUDBEDS_API_KEY,
          roomTypeID,
          forDate,
          checkOutDate
        );

        try {
          const reservationID = await createPlaceholderReservation({
            apiV13,
            headers,
            propertyID: CLOUDBEDS_PROPERTY_ID,
            roomID: String(meta?.roomID ?? rid),
            roomTypeID,
            roomName,
            forDate,
            checkOutDate,
            roomRateIDStr,
          });

          try {
            const docID = await savePlaceholder({
              reservationID,
              roomID: String(meta?.roomID ?? rid),
              roomName,
              roomTypeID,
              roomTypeName,
              forDate,
              checkOutDate,
              status: 'available',
              createdAt: new Date().toISOString(),
            });
            console.log(`TYE placeholder created: room ${roomName} date ${forDate} reservationID ${reservationID} docID ${docID}`);
          } catch (storeErr: any) {
            // Reservation exists in Cloudbeds — still count success; kiosk can use Cloudbeds as source of truth.
            console.error('savePlaceholder failed (reservation exists in Cloudbeds):', storeErr);
          }

          summary[forDate].created.push(rid);
        } catch (err: any) {
          summary[forDate].failed.push({ roomID: rid, error: err?.message ?? 'Unknown error' });
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
 * Same TYE rate resolution as lib/cloudbeds-checkin performCloudbedsCheckIn — Cloudbeds expects
 * rooms[0][roomRateID] to be the rate line id (rateID), not only the rate plan id.
 */
async function resolveTyeRoomRateStr(
  apiV13: string,
  propertyID: string,
  apiKey: string,
  roomTypeID: string,
  startDate: string,
  endDate: string
): Promise<string> {
  try {
    const url = `${apiV13}/getRatePlans?propertyID=${encodeURIComponent(propertyID)}&startDate=${startDate}&endDate=${endDate}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return '';
    const ratesData = await res.json();
    const rates = ratesData.data || ratesData.rates || ratesData || [];
    const arr = Array.isArray(rates) ? rates : [];
    const roomTypeStr = String(roomTypeID);
    const roomTypeNum = Number(roomTypeID);
    const allRatesForRoomType = arr.filter((rate: any) => {
      const rtID = rate.roomTypeID ?? rate.room_type_id ?? rate.roomType_id;
      return String(rtID) === roomTypeStr || Number(rtID) === roomTypeNum;
    });
    const tyeRate = allRatesForRoomType.find((rate: any) => {
      const planID = String(rate.ratePlanID ?? rate.rate_plan_id ?? rate.ratePlan_id ?? '');
      const planName = String(rate.ratePlanName ?? rate.name ?? '').toLowerCase();
      return planID === '227753' || Number(planID) === 227753 || planName.includes('tye');
    });
    let rateID: string | number | null = null;
    let ratePlanID: string | number | null = null;
    if (tyeRate) {
      rateID = tyeRate.rateID ?? tyeRate.rate_id ?? tyeRate.id;
      ratePlanID = tyeRate.ratePlanID ?? tyeRate.rate_plan_id ?? tyeRate.ratePlan_id ?? 227753;
    } else if (allRatesForRoomType.length > 0) {
      const available = allRatesForRoomType.filter(
        (rate: any) => (rate.roomsAvailable == null || rate.roomsAvailable > 0) && !rate.roomBlocked
      );
      const fallback = available[0] ?? allRatesForRoomType[0];
      rateID = fallback.rateID ?? fallback.rate_id ?? fallback.id;
      ratePlanID = fallback.ratePlanID ?? fallback.rate_plan_id ?? fallback.ratePlan_id;
    }
    return rateID != null ? String(rateID) : ratePlanID != null ? String(ratePlanID) : '';
  } catch {
    return '';
  }
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
  roomRateIDStr: string;
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
  if (p.roomRateIDStr) {
    params.append('rooms[0][roomRateID]', p.roomRateIDStr);
  }
  params.append('adults[0][roomTypeID]', p.roomTypeID);
  params.append('adults[0][quantity]', '1');
  params.append('adults[0][roomID]', p.roomID);
  params.append('children[0][roomTypeID]', p.roomTypeID);
  params.append('children[0][quantity]', '0');
  params.append('children[0][roomID]', p.roomID);

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
