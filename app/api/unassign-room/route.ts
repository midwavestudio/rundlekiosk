import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/unassign-room
 *
 * Unassigns a physical room from a Cloudbeds reservation without checking the guest out.
 * The reservation (and all guest data) remains intact — only the physical room assignment
 * is removed. This frees the room in Cloudbeds so a new guest can check in on the same day.
 *
 * Use case: Same-day turnaround — guest checks out, room is unassigned so the next guest
 * can be checked into that same room on the same calendar date.
 *
 * Cloudbeds API docs (postRoomAssign v1.3):
 *   "reservationRoomID: Must be set if you want to unassign a room."
 *   "newRoomID: Empty field must be sent if you want to unassign a room."
 *
 * Body (JSON):
 *   reservationID          string  Required. Cloudbeds reservation ID.
 *   reservationRoomID?     string  Optional. The room line ID. If not provided, fetched via getReservation.
 *   subReservationID?      string  Optional.
 */

function apiV13Base(): string {
  const raw = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
  const baseUrl = raw.replace(/\/v1\.\d+\/?$/, '');
  return `${baseUrl.replace(/\/$/, '')}/v1.3`;
}

async function getReservationDetails(
  apiBase: string,
  propertyID: string,
  apiKey: string,
  reservationID: string
): Promise<any | null> {
  const url = `${apiBase}/getReservation?propertyID=${encodeURIComponent(propertyID)}&reservationID=${encodeURIComponent(reservationID)}&includeAllRooms=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  try { return JSON.parse(await res.text()); } catch { return null; }
}

function extractReservationRoomID(reservation: any): string | null {
  if (Array.isArray(reservation?.assigned)) {
    for (const r of reservation.assigned) {
      const id = r?.reservationRoomID ?? r?.reservationRoomId;
      if (id != null && String(id).trim() !== '') return String(id);
    }
  }
  if (Array.isArray(reservation?.rooms)) {
    for (const r of reservation.rooms) {
      const id = r?.reservationRoomID ?? r?.reservationRoomId;
      if (id != null && String(id).trim() !== '') return String(id);
    }
  }
  const gl = reservation?.guestList;
  if (gl && typeof gl === 'object' && !Array.isArray(gl)) {
    for (const entry of Object.values(gl) as any[]) {
      const id = (entry as any)?.reservationRoomID ?? (entry as any)?.reservationRoomId;
      if (id != null && String(id).trim() !== '') return String(id);
      if (Array.isArray((entry as any)?.assignedRooms)) {
        for (const r of (entry as any).assignedRooms) {
          const rid = r?.reservationRoomID ?? r?.reservationRoomId;
          if (rid != null && String(rid).trim() !== '') return String(rid);
        }
      }
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const log: any[] = [];

  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json(
        { success: true, message: 'Room unassigned (mock mode — no credentials)', mockMode: true },
      );
    }

    const body = await request.json();
    const {
      reservationID,
      reservationRoomID: bodyReservationRoomID,
      subReservationID: bodySubReservationID,
    } = body as {
      reservationID?: string;
      reservationRoomID?: string;
      subReservationID?: string;
    };

    if (!reservationID) {
      return NextResponse.json({ success: false, error: 'reservationID is required' }, { status: 400 });
    }

    const apiBase = apiV13Base();

    // Resolve reservationRoomID — use provided value or fetch from Cloudbeds
    let reservationRoomID = bodyReservationRoomID?.trim() || null;
    let subReservationID = bodySubReservationID?.trim() || null;

    if (!reservationRoomID) {
      const resData = await getReservationDetails(apiBase, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY, reservationID);
      log.push({ step: 'getReservation', success: resData?.success === true });

      const reservationRecord = resData?.data ?? null;
      reservationRoomID = extractReservationRoomID(reservationRecord);

      // Also resolve subReservationID if not provided
      if (!subReservationID) {
        const assigned = reservationRecord?.assigned;
        if (Array.isArray(assigned) && assigned[0]?.subReservationID) {
          subReservationID = String(assigned[0].subReservationID);
        } else if (Array.isArray(reservationRecord?.rooms) && reservationRecord.rooms[0]?.subReservationID) {
          subReservationID = String(reservationRecord.rooms[0].subReservationID);
        }
      }
    }

    if (!reservationRoomID) {
      log.push({ step: 'unassign_skip', reason: 'No reservationRoomID found — room may already be unassigned' });
      return NextResponse.json(
        {
          success: false,
          error: 'Could not find a room line ID (reservationRoomID) for this reservation. The room may already be unassigned.',
          debugLog: log,
        },
        { status: 422 }
      );
    }

    const authHeaders = {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    // Step 1: Reset reservation to confirmed so Cloudbeds allows room to be unassigned.
    // A checked_in reservation cannot have its room removed directly.
    const confirmParams = new URLSearchParams();
    confirmParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    confirmParams.append('reservationID', reservationID);
    confirmParams.append('status', 'confirmed');
    log.push({ step: 'reset_to_confirmed_request', reservationID });
    const confirmRes = await fetch(`${apiBase}/putReservation`, {
      method: 'PUT',
      headers: authHeaders,
      body: confirmParams.toString(),
    });
    const confirmData: any = await confirmRes.json().catch(() => ({}));
    log.push({ step: 'reset_to_confirmed_response', ok: confirmRes.ok && confirmData.success === true, data: confirmData });
    // Non-fatal — proceed regardless

    // Step 2: postRoomAssign with newRoomID='' to unassign
    // IMPORTANT: newRoomID must be sent as empty string (not omitted) per Cloudbeds API docs.
    const params = new URLSearchParams();
    params.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    params.append('reservationID', reservationID);
    params.append('reservationRoomID', reservationRoomID);
    params.append('newRoomID', ''); // empty = unassign per Cloudbeds API docs
    if (subReservationID && subReservationID !== reservationID) {
      params.append('subReservationID', subReservationID);
    }

    log.push({ step: 'postRoomAssign_unassign_request', reservationRoomID, subReservationID });

    const res = await fetch(`${apiBase}/postRoomAssign`, {
      method: 'POST',
      headers: authHeaders,
      body: params.toString(),
    });

    const raw = await res.text();
    let data: any = {};
    try { data = JSON.parse(raw); } catch { data = {}; }

    const ok = res.ok && data.success === true;
    log.push({ step: 'postRoomAssign_unassign_response', ok, status: res.status, data });

    if (!ok) {
      const msg = data?.message ?? raw ?? 'Failed to unassign room';
      console.error('unassign-room: postRoomAssign failed', log);
      return NextResponse.json(
        { success: false, error: msg, debugLog: log },
        { status: 422 }
      );
    }

    console.log('unassign-room: success', JSON.stringify(log));

    return NextResponse.json({
      success: true,
      reservationID,
      reservationRoomID,
      message: 'Room successfully unassigned. The reservation remains intact and can still be set to checked_out.',
      debugLog: log,
    });
  } catch (error: any) {
    console.error('unassign-room error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to unassign room', debugLog: log },
      { status: 500 }
    );
  }
}
