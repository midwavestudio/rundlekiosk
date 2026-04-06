import { NextRequest, NextResponse } from 'next/server';
import { settleReservationFolio } from '@/lib/cloudbeds-checkin';
import {
  getPlaceholderByReservationID,
  assignPlaceholder,
} from '@/lib/tye-placeholder-store';
import { buildGuestSyntheticEmail } from '@/lib/guest-email';

/**
 * POST /api/assign-placeholder
 *
 * Converts a TYE placeholder reservation into a real guest stay.
 *
 * Flow:
 *   1. Validate the placeholder exists and is still 'available' in our store.
 *   2. putGuest  – replace the dummy guest data with the real guest's info.
 *   3. putReservation – add notes (CLC number) and keep status = confirmed.
 *   4. settleReservationFolio – post CLC payment against the outstanding balance.
 *   5. putReservation status=checked_in + postRoomCheckIn (same retry logic as the
 *      regular check-in path).
 *   6. Mark the placeholder as 'assigned' in our store.
 *
 * Body (JSON):
 *   placeholderReservationID  string   Cloudbeds reservation ID of the placeholder
 *   firstName                 string
 *   lastName                  string
 *   phoneNumber               string
 *   clcNumber                 string
 *   email?                    string   Auto-generated if omitted
 */
export async function POST(request: NextRequest) {
  const debugLog: Array<{ step: string; request?: unknown; response?: unknown; error?: string }> = [];
  const log = (step: string, req?: unknown, res?: unknown, err?: string) => {
    debugLog.push({ step, request: req, response: res, error: err });
  };

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
    const {
      placeholderReservationID,
      firstName,
      lastName,
      phoneNumber,
      clcNumber,
      email: providedEmail,
    } = body as {
      placeholderReservationID: string;
      firstName: string;
      lastName: string;
      phoneNumber?: string;
      clcNumber?: string;
      email?: string;
    };

    if (!placeholderReservationID || !firstName?.trim() || !lastName?.trim()) {
      return NextResponse.json(
        { success: false, error: 'placeholderReservationID, firstName, and lastName are required' },
        { status: 400 }
      );
    }

    const guestFirst = String(firstName).trim();
    const guestLast = String(lastName).trim();
    const guestPhone = phoneNumber || '000-000-0000';
    const guestEmail =
      providedEmail?.trim() ||
      buildGuestSyntheticEmail(guestFirst, guestLast);

    // -----------------------------------------------------------------------
    // Step 1: Verify our store knows this reservation and it is still available
    // -----------------------------------------------------------------------
    const placeholder = await getPlaceholderByReservationID(placeholderReservationID);
    log('1_store_lookup', { placeholderReservationID }, placeholder ?? 'not found');

    if (!placeholder) {
      return NextResponse.json(
        {
          success: false,
          error: 'Placeholder reservation not found in the app store. It may not have been created via this app.',
          debugTrail: debugLog,
        },
        { status: 404 }
      );
    }

    if (placeholder.status !== 'available') {
      return NextResponse.json(
        {
          success: false,
          error: `Placeholder is no longer available (current status: ${placeholder.status}). Please select a different room.`,
          debugTrail: debugLog,
        },
        { status: 409 }
      );
    }

    const headers = {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    const jsonHeaders = {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/json',
    };
    const reservationID = placeholderReservationID;

    // -----------------------------------------------------------------------
    // Step 2: Fetch current reservation to get guestID
    // -----------------------------------------------------------------------
    const grUrl = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(reservationID)}`;
    log('2_getReservation_request', { url: grUrl });
    const grRes = await fetch(grUrl, { method: 'GET', headers: jsonHeaders });
    const grText = await grRes.text();
    let grData: any = {};
    try { grData = JSON.parse(grText); } catch { /* ignore */ }
    log('2_getReservation_response', { status: grRes.status, body: grData });

    const reservation = grData.data ?? grData;
    const guestID: string = String(
      reservation.guestID ??
        reservation.guest?.guestID ??
        reservation.guests?.[0]?.guestID ??
        ''
    );
    const subReservationID: string = String(
      reservation.subReservationID ??
        reservation.rooms?.[0]?.subReservationID ??
        reservationID
    );
    const assignedRoomID: string = String(
      reservation.rooms?.[0]?.roomID ??
        reservation.roomID ??
        placeholder.roomID
    );

    // -----------------------------------------------------------------------
    // Step 3: putGuest — replace dummy guest data with the real guest
    // -----------------------------------------------------------------------
    if (guestID) {
      const putGuestParams = new URLSearchParams();
      putGuestParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      putGuestParams.append('guestID', guestID);
      putGuestParams.append('firstName', guestFirst);
      putGuestParams.append('lastName', guestLast);
      putGuestParams.append('email', guestEmail);
      putGuestParams.append('phone', guestPhone);
      putGuestParams.append('country', 'US');

      log('3_putGuest_request', {
        guestID,
        firstName: guestFirst,
        lastName: guestLast,
        email: guestEmail,
      });
      const pgRes = await fetch(`${apiV13}/putGuest`, {
        method: 'PUT',
        headers,
        body: putGuestParams.toString(),
      });
      const pgText = await pgRes.text();
      let pgData: any = {};
      try { pgData = JSON.parse(pgText); } catch { /* ignore */ }
      log('3_putGuest_response', { status: pgRes.status, body: pgData });

      if (!pgRes.ok) {
        // Non-fatal: guest update failure should not block check-in
        console.warn('putGuest failed:', pgData);
      }
    } else {
      log('3_putGuest_skip', { reason: 'No guestID found in getReservation response' });
    }

    // -----------------------------------------------------------------------
    // Step 4: putReservation — add CLC notes (keep status as-is for now)
    // -----------------------------------------------------------------------
    const putResParams = new URLSearchParams();
    putResParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    putResParams.append('reservationID', reservationID);
    if (clcNumber) {
      putResParams.append('notes', `CLC: ${clcNumber} | TYE Kiosk Check-In`);
    }

    log('4_putReservation_notes_request', { clcNumber });
    const prRes = await fetch(`${apiV13}/putReservation`, {
      method: 'PUT',
      headers,
      body: putResParams.toString(),
    });
    const prText = await prRes.text();
    let prData: any = {};
    try { prData = JSON.parse(prText); } catch { /* ignore */ }
    log('4_putReservation_notes_response', { status: prRes.status, body: prData });

    // -----------------------------------------------------------------------
    // Step 5: Settle folio — post CLC payment for the outstanding balance
    // -----------------------------------------------------------------------
    await settleReservationFolio(
      apiV13,
      CLOUDBEDS_PROPERTY_ID,
      CLOUDBEDS_API_KEY,
      reservationID,
      `${guestFirst} ${guestLast}`,
      log
    );

    // -----------------------------------------------------------------------
    // Step 6: putReservation status=checked_in (with postRoomCheckIn retries)
    // -----------------------------------------------------------------------
    const putCheckedInParams = new URLSearchParams();
    putCheckedInParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    putCheckedInParams.append('reservationID', reservationID);
    putCheckedInParams.append('status', 'checked_in');

    log('6_putReservation_checkin_request', { reservationID, status: 'checked_in' });
    let ciRes = await fetch(`${apiV13}/putReservation`, {
      method: 'PUT',
      headers,
      body: putCheckedInParams.toString(),
    });
    let ciText = await ciRes.text();
    let ciData: any = {};
    try { ciData = JSON.parse(ciText); } catch { /* ignore */ }
    log('6_putReservation_checkin_response', { status: ciRes.status, body: ciData });

    if (!ciRes.ok || ciData.success !== true) {
      // Retry via postRoomCheckIn then re-attempt putReservation
      const rcVariants = [
        { subReservationID, roomID: assignedRoomID },
        { subReservationID },
        { roomID: assignedRoomID },
      ];
      for (const variant of rcVariants) {
        const rcParams = new URLSearchParams();
        rcParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
        rcParams.append('reservationID', reservationID);
        if (variant.subReservationID) rcParams.append('subReservationID', variant.subReservationID);
        if (variant.roomID) rcParams.append('roomID', variant.roomID);

        log('6b_postRoomCheckIn_request', variant);
        const rcRes = await fetch(`${apiV13}/postRoomCheckIn`, {
          method: 'POST',
          headers,
          body: rcParams.toString(),
        });
        const rcText = await rcRes.text();
        let rcData: any = {};
        try { rcData = JSON.parse(rcText); } catch { /* ignore */ }
        log('6b_postRoomCheckIn_response', { status: rcRes.status, body: rcData });

        if (rcRes.ok && rcData.success === true) {
          // Retry the status update
          ciRes = await fetch(`${apiV13}/putReservation`, {
            method: 'PUT',
            headers,
            body: putCheckedInParams.toString(),
          });
          ciText = await ciRes.text();
          try { ciData = JSON.parse(ciText); } catch { ciData = {}; }
          log('6c_putReservation_checkin_retry_response', { status: ciRes.status, body: ciData });
          if (ciRes.ok && ciData.success === true) break;
        }
      }
    }

    if (!ciRes.ok || ciData.success !== true) {
      throw new Error(ciData?.message ?? 'Failed to set reservation status to checked_in');
    }

    // Best-effort final room check-in
    try {
      const finalRcParams = new URLSearchParams();
      finalRcParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      finalRcParams.append('reservationID', reservationID);
      finalRcParams.append('subReservationID', subReservationID);
      if (assignedRoomID) finalRcParams.append('roomID', assignedRoomID);
      await fetch(`${apiV13}/postRoomCheckIn`, { method: 'POST', headers, body: finalRcParams.toString() });
    } catch { /* ignore */ }

    // -----------------------------------------------------------------------
    // Step 7: Mark placeholder as assigned in our store
    // -----------------------------------------------------------------------
    await assignPlaceholder(placeholder.id, guestID || 'unknown');
    log('7_placeholder_assigned', { placeholderID: placeholder.id, guestID });

    return NextResponse.json({
      success: true,
      reservationID,
      guestID: guestID || undefined,
      roomName: placeholder.roomName,
      message: 'Placeholder assigned and guest successfully checked in',
      debugTrail: debugLog,
    });
  } catch (error: any) {
    console.error('assign-placeholder error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message ?? 'Failed to assign placeholder',
        debugTrail: debugLog,
      },
      { status: 500 }
    );
  }
}
