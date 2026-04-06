import { NextRequest, NextResponse } from 'next/server';

/**
 * Cloudbeds requires the reservation checkout date to be updated **before** any checkout
 * action (postRoomCheckOut or status=checked_out). Calling room checkout first returns:
 * "You must update the check out date prior to checking out the guest."
 *
 * getReservation returns assigned rooms under `assigned` (and sometimes `rooms`).
 * Using only `rooms` leaves the list empty → no roomID/subReservationID → checkout fails.
 *
 * putReservation (v1.3) accepts top-level `checkoutDate` only — do not send `startDate`
 * (not in the published schema; can cause the update to fail).
 */

function getLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function apiV13Base(): string {
  const raw = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
  const baseUrl = raw.replace(/\/v1\.\d+\/?$/, '');
  return `${baseUrl.replace(/\/$/, '')}/v1.3`;
}

async function postForm(
  url: string,
  apiKey: string,
  fields: Record<string, string | undefined>
): Promise<{ ok: boolean; status: number; data: any; raw: string }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') params.append(k, v);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const raw = await res.text();
  let data: any = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  const ok = res.ok && data.success === true;
  return { ok, status: res.status, data, raw };
}

async function putForm(
  url: string,
  apiKey: string,
  fields: Record<string, string | undefined>
): Promise<{ ok: boolean; status: number; data: any; raw: string }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') params.append(k, v);
  }
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const raw = await res.text();
  let data: any = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  const ok = res.ok && data.success === true;
  return { ok, status: res.status, data, raw };
}

async function getReservationDetails(
  apiBase: string,
  propertyID: string,
  apiKey: string,
  reservationID: string
): Promise<any | null> {
  const url = `${apiBase}/getReservation?propertyID=${encodeURIComponent(propertyID)}&reservationID=${encodeURIComponent(reservationID)}&includeAllRooms=true`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  try {
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

/** Checkout date cannot be before stay start (YYYY-MM-DD). */
function clampCheckoutDate(startYmd: string | undefined, requestedYmd: string): string {
  if (!startYmd || !/^\d{4}-\d{2}-\d{2}$/.test(startYmd)) return requestedYmd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedYmd)) return requestedYmd;
  return requestedYmd < startYmd ? startYmd : requestedYmd;
}

/** getReservation uses `assigned`; getReservations list may use `rooms` — merge for lookup. */
function mergeReservationRoomRows(reservation: any): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const key of ['assigned', 'rooms'] as const) {
    const arr = reservation?.[key];
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      if (!r || typeof r !== 'object') continue;
      const id = `${r.subReservationID ?? ''}|${r.roomID ?? ''}|${r.reservationRoomID ?? ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
  }
  return out;
}

function pickActiveRoom(rooms: any[]): any | null {
  if (rooms.length === 0) return null;
  const inHouse = rooms.find((r: any) => r?.roomStatus === 'in_house');
  if (inHouse) return inHouse;
  return rooms[0];
}

/**
 * Fallback: set checkout on the room line (putReservation rooms[] schema).
 */
function buildRoomLineCheckoutFields(
  propertyID: string,
  reservationID: string,
  room: any,
  reservation: any,
  checkoutDateYmd: string
): Record<string, string> | null {
  if (!room || !reservation) return null;
  const roomTypeID = room.roomTypeID != null ? String(room.roomTypeID) : '';
  let checkinYmd = '';
  const rc = room.roomCheckIn ?? room.startDate;
  if (rc != null && String(rc).trim() !== '') {
    const s = String(rc).trim();
    checkinYmd = s.length >= 10 ? s.slice(0, 10) : '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkinYmd)) {
    const sd = reservation.startDate ?? reservation.checkInDate;
    if (sd && /^\d{4}-\d{2}-\d{2}$/.test(String(sd).slice(0, 10))) {
      checkinYmd = String(sd).slice(0, 10);
    }
  }
  if (!roomTypeID || !/^\d{4}-\d{2}-\d{2}$/.test(checkinYmd)) return null;

  const adults = String(room.adults ?? reservation.adults ?? 1);
  const children = String(room.children ?? reservation.children ?? 0);

  const fields: Record<string, string> = {
    propertyID,
    reservationID,
    'rooms[0][roomTypeID]': roomTypeID,
    'rooms[0][checkinDate]': checkinYmd,
    'rooms[0][checkoutDate]': checkoutDateYmd,
    'rooms[0][adults]': adults,
    'rooms[0][children]': children,
  };
  if (room.subReservationID) {
    fields['rooms[0][subReservationID]'] = String(room.subReservationID);
  }
  return fields;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function computeDaysStayed(checkInDateYmd: string, checkoutDateYmd: string): number {
  try {
    const a = new Date(checkInDateYmd + 'T12:00:00').getTime();
    const b = new Date(checkoutDateYmd + 'T12:00:00').getTime();
    const nights = Math.round((b - a) / 86_400_000);
    return Math.max(1, nights);
  } catch {
    return 1;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { reservationID, checkoutAtIso, checkoutDate: bodyCheckoutDate, checkInDate: bodyCheckInDate } = body;

    if (!reservationID) {
      return NextResponse.json({ success: false, error: 'Reservation ID is required' }, { status: 400 });
    }

    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json({ success: true, message: 'Check-out completed (mock)', mockMode: true, daysStayed: 1 });
    }

    const apiBase = apiV13Base();
    const putUrl = `${apiBase}/putReservation`;

    const checkOutMs = typeof checkoutAtIso === 'string' ? Date.parse(checkoutAtIso) || Date.now() : Date.now();
    let checkoutDate =
      typeof bodyCheckoutDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bodyCheckoutDate.trim())
        ? bodyCheckoutDate.trim()
        : getLocalDateStr(new Date(checkOutMs));

    const log: any[] = [];

    const resData = await getReservationDetails(apiBase, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY, String(reservationID));
    log.push({ step: 'getReservation', success: resData?.success === true });

    const reservationRecord = resData?.data ?? null;
    const startYmd = reservationRecord?.startDate
      ? String(reservationRecord.startDate).slice(0, 10)
      : bodyCheckInDate && /^\d{4}-\d{2}-\d{2}$/.test(String(bodyCheckInDate).trim())
        ? String(bodyCheckInDate).trim()
        : undefined;

    checkoutDate = clampCheckoutDate(startYmd, checkoutDate);

    const rooms: any[] = mergeReservationRoomRows(reservationRecord ?? {});
    const activeRoom = pickActiveRoom(rooms);
    const roomID = activeRoom?.roomID != null ? String(activeRoom.roomID) : undefined;
    const subReservationID = activeRoom?.subReservationID != null ? String(activeRoom.subReservationID) : undefined;

    log.push({ step: 'room_info', roomID, subReservationID, checkoutDate, startYmd });

    let lastMessage = '';

    // ── 1) REQUIRED FIRST: update checkout date (putReservation accepts checkoutDate only at top level)
    let dateUpdated = false;

    const dateFields: Record<string, string | undefined> = {
      propertyID: CLOUDBEDS_PROPERTY_ID,
      reservationID: String(reservationID),
      checkoutDate,
    };

    const topLevelDate = await putForm(putUrl, CLOUDBEDS_API_KEY, dateFields);
    log.push({ step: 'putReservation_checkoutDate_only', ok: topLevelDate.ok, data: topLevelDate.data });
    if (topLevelDate.ok) {
      dateUpdated = true;
    } else {
      lastMessage = topLevelDate.data?.message ?? topLevelDate.raw ?? '';

      // If Cloudbeds says the date is already correct / no change needed, that's fine —
      // treat it as success so postRoomCheckOut can proceed.
      const alreadySet =
        /already/i.test(lastMessage) ||
        /no change/i.test(lastMessage) ||
        /same date/i.test(lastMessage);
      if (alreadySet) {
        dateUpdated = true;
        log.push({ step: 'putReservation_alreadySet', note: lastMessage });
      }
    }

    // Fallback: try with rooms[0] date fields
    if (!dateUpdated) {
      const roomLine = buildRoomLineCheckoutFields(
        CLOUDBEDS_PROPERTY_ID,
        String(reservationID),
        activeRoom,
        reservationRecord ?? {},
        checkoutDate
      );
      if (roomLine) {
        const roomPut = await putForm(putUrl, CLOUDBEDS_API_KEY, roomLine);
        log.push({ step: 'putReservation_rooms0_checkoutDate', ok: roomPut.ok, data: roomPut.data });
        if (roomPut.ok) {
          dateUpdated = true;
        } else {
          const msg2 = roomPut.data?.message ?? roomPut.raw ?? '';
          const alreadySet2 =
            /already/i.test(msg2) ||
            /no change/i.test(msg2) ||
            /same date/i.test(msg2);
          if (alreadySet2) {
            dateUpdated = true;
            log.push({ step: 'putReservation_rooms0_alreadySet', note: msg2 });
          } else {
            lastMessage = msg2 || lastMessage;
          }
        }
      }
    }

    if (!dateUpdated) {
      const msg = decodeHtmlEntities(lastMessage || 'Could not set checkout date in Cloudbeds.');
      console.error('cloudbeds-checkout: checkout date update failed', log);
      return NextResponse.json(
        { success: false, error: msg, debugLog: log },
        { status: 422 }
      );
    }

    // ── 2) Room checkout (after date is set) ──
    let checkoutSucceeded = false;
    if (roomID || subReservationID) {
      const roomOut = await postForm(`${apiBase}/postRoomCheckOut`, CLOUDBEDS_API_KEY, {
        propertyID: CLOUDBEDS_PROPERTY_ID,
        reservationID: String(reservationID),
        ...(subReservationID ? { subReservationID } : {}),
        ...(roomID ? { roomID } : {}),
      });
      log.push({ step: 'postRoomCheckOut', ok: roomOut.ok, data: roomOut.data });
      if (roomOut.ok) {
        checkoutSucceeded = true;
      } else {
        lastMessage = roomOut.data?.message ?? roomOut.raw ?? '';
      }
    }

    // ── 3) Ensure reservation status is checked_out ──
    if (!checkoutSucceeded) {
      const statusPut = await putForm(putUrl, CLOUDBEDS_API_KEY, {
        propertyID: CLOUDBEDS_PROPERTY_ID,
        reservationID: String(reservationID),
        status: 'checked_out',
      });
      log.push({ step: 'putReservation_status_checked_out', ok: statusPut.ok, data: statusPut.data });
      if (statusPut.ok) {
        checkoutSucceeded = true;
      } else {
        lastMessage = statusPut.data?.message ?? statusPut.raw ?? lastMessage;
      }
    }

    if (!checkoutSucceeded) {
      const msg = decodeHtmlEntities(lastMessage || 'Check-out could not be completed.');
      console.error('cloudbeds-checkout: room checkout / status failed', log);
      return NextResponse.json(
        { success: false, error: msg, debugLog: log },
        { status: 422 }
      );
    }

    const reservationStartDate: string = reservationRecord?.startDate ?? bodyCheckInDate ?? checkoutDate;
    const startForDays = /^\d{4}-\d{2}-\d{2}$/.test(String(reservationStartDate).slice(0, 10))
      ? String(reservationStartDate).slice(0, 10)
      : checkoutDate;
    const daysStayed = computeDaysStayed(startForDays, checkoutDate);

    console.log('cloudbeds-checkout: success', JSON.stringify(log));

    return NextResponse.json({
      success: true,
      reservationID,
      checkoutDate,
      daysStayed,
      checkOutAt: new Date(checkOutMs).toISOString(),
    });
  } catch (error: any) {
    console.error('Cloudbeds check-out error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to check out from Cloudbeds' },
      { status: 500 }
    );
  }
}
