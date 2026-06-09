import { NextRequest, NextResponse } from 'next/server';
import { unwrapReservationFromGetReservation } from '@/lib/cloudbeds-rate-preserve';
import { updateCheckinRecord, findByReservationID } from '@/lib/checkin-store';

/**
 * POST /api/admin/reassign-room
 *
 * Moves a checked-in (or confirmed) Cloudbeds reservation from its current
 * physical room to a new room, then updates the Firestore check-in record to
 * reflect the corrected room number.
 *
 * Use case: guest checked in via kiosk choosing room 314 but Cloudbeds created
 * the reservation in room 225 due to a room-assignment mismatch.
 *
 * Body (JSON):
 *   reservationID   string  Required. Cloudbeds reservation ID.
 *   newRoomID       string  Required. Cloudbeds room ID to move to.
 *   newRoomName     string  Required. Human-readable room name (e.g. "314").
 *                           Used to update the Firestore record.
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

/** Extract the first reservationRoomID from the reservation record. */
function extractFirstRoomLine(reservation: any): { reservationRoomID: string; subReservationID: string | null; roomTypeID: string | null } | null {
  const candidates: any[] = [];

  if (Array.isArray(reservation?.assigned)) candidates.push(...reservation.assigned);
  if (Array.isArray(reservation?.rooms)) candidates.push(...reservation.rooms);

  const gl = reservation?.guestList;
  if (gl && typeof gl === 'object' && !Array.isArray(gl)) {
    for (const entry of Object.values(gl) as any[]) {
      if (Array.isArray((entry as any)?.assignedRooms)) {
        candidates.push(...(entry as any).assignedRooms);
      }
    }
  }

  for (const r of candidates) {
    const id = r?.reservationRoomID ?? r?.reservationRoomId;
    if (id != null && String(id).trim() !== '') {
      return {
        reservationRoomID: String(id),
        subReservationID: r?.subReservationID ? String(r.subReservationID) : null,
        roomTypeID: r?.roomTypeID ?? r?.roomType?.roomTypeID ?? null,
      };
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
        { success: true, message: 'Room reassigned (mock mode — no credentials)', mockMode: true },
      );
    }

    const body = await request.json();
    const { reservationID, newRoomID, newRoomName } = body as {
      reservationID?: string;
      newRoomID?: string;
      newRoomName?: string;
    };

    if (!reservationID) {
      return NextResponse.json({ success: false, error: 'reservationID is required' }, { status: 400 });
    }
    if (!newRoomID) {
      return NextResponse.json({ success: false, error: 'newRoomID is required' }, { status: 400 });
    }
    if (!newRoomName) {
      return NextResponse.json({ success: false, error: 'newRoomName is required' }, { status: 400 });
    }

    const apiBase = apiV13Base();
    const authHeaders = {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    // ── Step 1: Fetch the reservation to get the room line ID ────────────────
    const resData = await getReservationDetails(apiBase, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY, reservationID);
    log.push({ step: 'getReservation', success: resData?.success === true });

    const reservationRecord = unwrapReservationFromGetReservation(resData) ?? resData?.data ?? null;
    const roomLine = extractFirstRoomLine(reservationRecord);
    log.push({ step: 'extractRoomLine', roomLine });

    if (!roomLine) {
      return NextResponse.json(
        {
          success: false,
          error: 'Could not find a room line (reservationRoomID) for this reservation. It may have no assigned room.',
          debugLog: log,
        },
        { status: 422 }
      );
    }

    const { reservationRoomID, subReservationID, roomTypeID } = roomLine;

    // ── Step 2: If checked_in, reset to confirmed so Cloudbeds allows the move ──
    const currentStatus = reservationRecord?.status ?? reservationRecord?.reservationStatus ?? '';
    if (currentStatus === 'checked_in') {
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
      // Non-fatal — proceed regardless so the room assignment still tries
    }

    // ── Step 3: postRoomAssign to move to the new room ───────────────────────
    const params = new URLSearchParams();
    params.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    params.append('reservationID', reservationID);
    params.append('reservationRoomID', reservationRoomID);
    params.append('newRoomID', newRoomID);
    if (roomTypeID) params.append('roomTypeID', String(roomTypeID));
    if (subReservationID && subReservationID !== reservationID) {
      params.append('subReservationID', subReservationID);
    }
    params.append('adjustPrice', 'true');

    log.push({ step: 'postRoomAssign_request', reservationRoomID, newRoomID, roomTypeID, subReservationID });

    const assignRes = await fetch(`${apiBase}/postRoomAssign`, {
      method: 'POST',
      headers: authHeaders,
      body: params.toString(),
    });
    const assignRaw = await assignRes.text();
    let assignData: any = {};
    try { assignData = JSON.parse(assignRaw); } catch { assignData = {}; }
    const assignOk = assignRes.ok && assignData.success === true;
    log.push({ step: 'postRoomAssign_response', ok: assignOk, status: assignRes.status, data: assignData });

    if (!assignOk) {
      const msg = assignData?.message ?? assignRaw ?? 'Cloudbeds postRoomAssign failed';
      console.error('reassign-room: postRoomAssign failed', log);
      return NextResponse.json({ success: false, error: msg, debugLog: log }, { status: 422 });
    }

    // ── Step 4: Restore checked_in status ────────────────────────────────────
    if (currentStatus === 'checked_in') {
      const ciParams = new URLSearchParams();
      ciParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      ciParams.append('reservationID', reservationID);
      ciParams.append('status', 'checked_in');
      log.push({ step: 'restore_checked_in_request' });
      const ciRes = await fetch(`${apiBase}/putReservation`, {
        method: 'PUT',
        headers: authHeaders,
        body: ciParams.toString(),
      });
      const ciData: any = await ciRes.json().catch(() => ({}));
      log.push({ step: 'restore_checked_in_response', ok: ciRes.ok && ciData.success === true, data: ciData });
      // Non-fatal — room is already moved, status can be fixed manually if this fails
    }

    // ── Step 5: Update Firestore check-in record ──────────────────────────────
    let firestoreUpdated = false;
    try {
      const existing = await findByReservationID(reservationID);
      if (existing?.id) {
        await updateCheckinRecord(existing.id, { roomNumber: newRoomName });
        firestoreUpdated = true;
        log.push({ step: 'firestore_update', docId: existing.id, roomNumber: newRoomName });
      } else {
        log.push({ step: 'firestore_update', skipped: true, reason: 'No Firestore record found for this reservationID' });
      }
    } catch (fsErr: any) {
      log.push({ step: 'firestore_update', error: fsErr?.message ?? 'Firestore update failed' });
      // Non-fatal — Cloudbeds is the source of truth; Firestore is display-only
    }

    console.log('reassign-room: success', JSON.stringify(log));

    return NextResponse.json({
      success: true,
      reservationID,
      fromRoomLine: reservationRoomID,
      toRoomID: newRoomID,
      toRoomName: newRoomName,
      firestoreUpdated,
      message: `Room successfully changed to ${newRoomName}.${!firestoreUpdated ? ' (Check-in record not found in Firestore — Cloudbeds was updated.)' : ''}`,
      debugLog: log,
    });
  } catch (error: any) {
    console.error('reassign-room error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to reassign room', debugLog: log },
      { status: 500 }
    );
  }
}
