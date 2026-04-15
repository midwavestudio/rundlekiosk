import { NextRequest, NextResponse } from 'next/server';
import { settleReservationFolio, evictRoomOccupant, getLocalDateStr } from '@/lib/cloudbeds-checkin';
import {
  getPlaceholderByReservationID,
  assignPlaceholder,
} from '@/lib/tye-placeholder-store';
import { buildGuestSyntheticEmail } from '@/lib/guest-email';

function parseReservationFromGetReservationJson(grData: any): any {
  return (
    grData?.data?.data ??
    grData?.data?.reservation ??
    grData?.data ??
    grData
  );
}

/** Primary guest id from getReservation — shapes differ by API/property. */
function extractGuestIdFromReservation(res: any): string {
  if (!res || typeof res !== 'object') return '';
  if (res.guestID) return String(res.guestID).trim();
  if (res.guest?.guestID) return String(res.guest.guestID).trim();
  if (Array.isArray(res.guests) && res.guests[0]?.guestID) return String(res.guests[0].guestID).trim();
  const gl = res.guestList;
  if (gl && typeof gl === 'object' && !Array.isArray(gl)) {
    const vals = Object.values(gl) as any[];
    const main = vals.find(
      (e) => e?.isMainGuest === true || e?.isMainGuest === '1' || e?.primaryGuest === true || e?.isPrimaryGuest === true
    );
    if (main?.guestID) return String(main.guestID).trim();
    for (const entry of vals) {
      if (entry?.guestID) return String(entry.guestID).trim();
    }
  }
  if (Array.isArray(res.assigned)) {
    for (const a of res.assigned) {
      if (a?.guestID) return String(a.guestID).trim();
    }
  }
  if (Array.isArray(res.rooms)) {
    for (const rm of res.rooms) {
      if (rm?.guestID) return String(rm.guestID).trim();
    }
  }
  return '';
}

function reservationShowsGuestName(res: any, first: string, last: string): boolean {
  if (!res || typeof res !== 'object') return false;
  const f = first.trim().toLowerCase();
  const l = last.trim().toLowerCase();
  const rf = String(res.guestFirstName ?? res.guest?.guestFirstName ?? res.guest?.firstName ?? '').trim().toLowerCase();
  const rl = String(res.guestLastName ?? res.guest?.guestLastName ?? res.guest?.lastName ?? '').trim().toLowerCase();
  if (rf === f && rl === l) return true;
  const combined = String(res.guestName ?? res.guest?.guestName ?? '').trim().toLowerCase();
  if (combined === `${f} ${l}` || combined === `${f}, ${l}`) return true;
  return false;
}

/**
 * POST /api/assign-placeholder
 *
 * Converts a TYE placeholder reservation into a real guest stay.
 *
 * Flow:
 *   1. Validate the placeholder exists and is still 'available' in our store.
 *   2. putGuest  – replace the dummy guest data with the real guest's info.
 *   3. putReservation – add notes (CLC number) and keep status = confirmed.
 *   4. settleReservationFolio – post CLC payment (placeholder mode: do not abort the whole flow
 *      when Cloudbeds invoice lags after postPayment — guest/room/check-in must still complete).
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

    if (!grRes.ok) {
      throw new Error(`Unable to load reservation from Cloudbeds (HTTP ${grRes.status})`);
    }
    if (grData.success === false) {
      throw new Error(String(grData.message || 'getReservation returned success: false'));
    }

    const reservation = parseReservationFromGetReservationJson(grData);
    if (!reservation || typeof reservation !== 'object') {
      throw new Error('getReservation returned no reservation body — cannot assign guest');
    }

    const fromApi = extractGuestIdFromReservation(reservation);
    const fromStore = String(placeholder.placeholderGuestID ?? '').trim();
    const guestID: string = fromApi || fromStore;
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
    // Step 3: putGuest / postGuest — must succeed and show on getReservation before any payment.
    // Previously we continued to settle the folio even when both paths failed silently.
    // -----------------------------------------------------------------------
    let resolvedGuestID = '';

    const tryPutGuestId = async (gid: string): Promise<boolean> => {
      if (!gid) return false;
      const putGuestParams = new URLSearchParams();
      putGuestParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      putGuestParams.append('guestID', gid);
      putGuestParams.append('guestFirstName', guestFirst);
      putGuestParams.append('guestLastName', guestLast);
      putGuestParams.append('guestEmail', guestEmail);
      putGuestParams.append('guestPhone', guestPhone);
      putGuestParams.append('guestCountry', 'US');
      putGuestParams.append('guestZip', '00000');

      log('3_putGuest_request', { guestID: gid, guestFirstName: guestFirst, guestLastName: guestLast, guestEmail });
      const pgRes = await fetch(`${apiV13}/putGuest`, {
        method: 'PUT',
        headers,
        body: putGuestParams.toString(),
      });
      const pgData: any = await pgRes.json().catch(() => ({}));
      log('3_putGuest_response', { status: pgRes.status, body: pgData });
      return pgRes.ok && pgData.success !== false;
    };

    const tryPostGuestAndLink = async (): Promise<boolean> => {
      const newGuestParams = new URLSearchParams();
      newGuestParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      newGuestParams.append('reservationID', reservationID);
      newGuestParams.append('guestFirstName', guestFirst);
      newGuestParams.append('guestLastName', guestLast);
      newGuestParams.append('guestEmail', guestEmail);
      newGuestParams.append('guestPhone', guestPhone);
      newGuestParams.append('guestCountry', 'US');

      log('3b_postGuest_request', { reservationID, guestFirstName: guestFirst, guestLastName: guestLast, guestEmail });
      const ngRes = await fetch(`${apiV13}/postGuest`, {
        method: 'POST',
        headers,
        body: newGuestParams.toString(),
      });
      const ngData: any = await ngRes.json().catch(() => ({}));
      log('3b_postGuest_response', { status: ngRes.status, body: ngData });

      const newGuestID = String(ngData.guestID ?? ngData.data?.guestID ?? '').trim();
      if (!ngRes.ok || ngData.success === false || !newGuestID) {
        return false;
      }

      const linkParams = new URLSearchParams();
      linkParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      linkParams.append('reservationID', reservationID);
      linkParams.append('guestID', newGuestID);

      log('3c_putReservation_link_guest_request', { reservationID, newGuestID });
      const lkRes = await fetch(`${apiV13}/putReservation`, {
        method: 'PUT',
        headers,
        body: linkParams.toString(),
      });
      const lkData: any = await lkRes.json().catch(() => ({}));
      log('3c_putReservation_link_guest_response', { status: lkRes.status, body: lkData });
      if (!lkRes.ok || lkData.success === false) {
        return false;
      }
      resolvedGuestID = newGuestID;
      return true;
    };

    const guestIdsToTry = [...new Set([guestID, fromStore].filter((x) => String(x).trim() !== ''))] as string[];

    let guestApplied = false;
    for (const gid of guestIdsToTry) {
      if (await tryPutGuestId(gid)) {
        resolvedGuestID = gid;
        guestApplied = true;
        break;
      }
    }

    if (!guestApplied) {
      guestApplied = await tryPostGuestAndLink();
    }

    const verifyReservationGuest = async (): Promise<boolean> => {
      const u = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(reservationID)}`;
      const r = await fetch(u, { method: 'GET', headers: jsonHeaders });
      const t = await r.text();
      let j: any = {};
      try {
        j = JSON.parse(t);
      } catch {
        return false;
      }
      const res = parseReservationFromGetReservationJson(j);
      return reservationShowsGuestName(res, guestFirst, guestLast);
    };

    let verified = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (await verifyReservationGuest()) {
        verified = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 450));
    }

    if (!guestApplied || !verified) {
      throw new Error(
        'Could not save the guest on this reservation in Cloudbeds, so payment was not applied. Please try again or see the front desk. ' +
          (!guestApplied ? '(Guest profile update failed.)' : '(Reservation still shows the placeholder guest — try again in a moment.)')
      );
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
      log,
      { trustStaleInvoiceAfterSuccessfulPayment: true }
    );

    // -----------------------------------------------------------------------
    // Step 5b: postRoomAssign — ensure the physical room is assigned before
    // attempting check-in. Placeholder reservations are created via
    // stopAfterReservationCreate so they may be unassigned in Cloudbeds.
    // We use postRoomAssign (not putRoomAssignment) to match the standard
    // check-in path in lib/cloudbeds-checkin.ts.
    // -----------------------------------------------------------------------
    const roomToAssign = assignedRoomID || placeholder.roomID;
    if (roomToAssign && roomToAssign !== 'undefined' && roomToAssign !== '') {
      // Fetch the reservation's unassigned room line ID so postRoomAssign can target it.
      let reservationRoomLineId: string | null = null;
      try {
        const grUrl2 = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(reservationID)}`;
        const grRes2 = await fetch(grUrl2, { method: 'GET', headers: jsonHeaders });
        const grData2: any = await grRes2.json().catch(() => ({}));
        log('5b_getReservation_for_assign', { status: grRes2.status, body: grData2 });
        // Extract reservationRoomID from unassigned[] or guestList
        const extractLineId = (root: any): string | null => {
          const data = root?.data;
          const bases = [root, data, Array.isArray(data) ? data[0] : null].filter(Boolean);
          for (const b of bases) {
            for (const arr of [b.unassigned, b.unassignedRooms].filter(Boolean)) {
              if (!Array.isArray(arr) || !arr[0]) continue;
              const id = arr[0]?.reservationRoomID ?? arr[0]?.reservationRoomId;
              if (id != null && String(id).trim() !== '') return String(id);
            }
          }
          const d = root?.data ?? root;
          const gl = d?.guestList;
          if (gl && typeof gl === 'object') {
            for (const g of Object.values(gl) as any[]) {
              const ur = (g as any)?.unassignedRooms;
              if (Array.isArray(ur) && ur[0]?.reservationRoomID != null) return String(ur[0].reservationRoomID);
            }
          }
          return null;
        };
        reservationRoomLineId = extractLineId(grData2);
      } catch (e: any) {
        log('5b_getReservation_for_assign_error', undefined, undefined, e?.message);
      }

      // Try postRoomAssign variants (same ordering as lib/cloudbeds-checkin.ts)
      const assignVariants: Array<Record<string, string>> = [];
      if (reservationRoomLineId) {
        assignVariants.push({ reservationID, reservationRoomID: reservationRoomLineId, subReservationID, newRoomID: roomToAssign, adjustPrice: 'true' });
        assignVariants.push({ reservationID, reservationRoomID: reservationRoomLineId, newRoomID: roomToAssign });
      }
      assignVariants.push({ reservationID, subReservationID, newRoomID: roomToAssign });
      assignVariants.push({ reservationID, newRoomID: roomToAssign });

      let assignOk = false;
      for (const fields of assignVariants) {
        const raParams = new URLSearchParams();
        raParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
        for (const [k, v] of Object.entries(fields)) {
          if (v && v !== 'undefined') raParams.append(k, v);
        }
        log('5b_postRoomAssign_request', { fields });
        const raRes = await fetch(`${apiV13}/postRoomAssign`, {
          method: 'POST',
          headers,
          body: raParams.toString(),
        });
        const raData: any = await raRes.json().catch(() => ({}));
        log('5b_postRoomAssign_response', { status: raRes.status, body: raData });
        if (raRes.ok && raData.success === true) {
          assignOk = true;
          break;
        }
      }
      if (!assignOk) {
        console.warn('postRoomAssign failed (non-fatal) — will still attempt check-in');
      }
    }

    // Folio can change after room assignment (same as lib/cloudbeds-checkin.ts). Without this second
    // settle, Cloudbeds often rejects checked_in with "collect the full amount prior to checking in"
    // even though we paid before postRoomAssign.
    await settleReservationFolio(
      apiV13,
      CLOUDBEDS_PROPERTY_ID,
      CLOUDBEDS_API_KEY,
      reservationID,
      `${guestFirst} ${guestLast}`,
      log,
      { trustStaleInvoiceAfterSuccessfulPayment: true }
    );

    // -----------------------------------------------------------------------
    // Step 6: postRoomCheckIn FIRST, then putReservation status=checked_in.
    //
    // Cloudbeds rejects putReservation→checked_in with "One or more rooms
    // cannot be checked in. Please ensure previous reservations have been
    // checked out." when the physical room still shows the previous occupant
    // as in-house. Calling postRoomCheckIn first forces Cloudbeds to process
    // the room-level transition before the reservation-level status change.
    //
    // If that error persists while getReservation still shows confirmed, we
    // treat the flow as success: guest + payment are already done; physical
    // checked_in must wait until staff checks out the prior guest (same as
    // walk-in "confirmed only" when the room is not free).
    // -----------------------------------------------------------------------
    let deferredPhysicalCheckIn = false;

    const doPostRoomCheckIn = async (variant: { subReservationID?: string; roomID?: string }) => {
      const p = new URLSearchParams();
      p.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      p.append('reservationID', reservationID);
      if (variant.subReservationID && variant.subReservationID !== reservationID) p.append('subReservationID', variant.subReservationID);
      if (variant.roomID && variant.roomID !== 'undefined') p.append('roomID', variant.roomID);
      log('6_postRoomCheckIn_request', variant);
      const r = await fetch(`${apiV13}/postRoomCheckIn`, { method: 'POST', headers, body: p.toString() });
      const d: any = await r.json().catch(() => ({}));
      log('6_postRoomCheckIn_response', { status: r.status, body: d });
      return { ok: r.ok && d.success === true, data: d };
    };

    const doPutCheckedIn = async () => {
      const p = new URLSearchParams();
      p.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      p.append('reservationID', reservationID);
      p.append('status', 'checked_in');
      log('6_putReservation_checkin_request', { reservationID, status: 'checked_in' });
      const r = await fetch(`${apiV13}/putReservation`, { method: 'PUT', headers, body: p.toString() });
      const d: any = await r.json().catch(() => ({}));
      log('6_putReservation_checkin_response', { status: r.status, body: d });
      return { ok: r.ok && d.success === true, data: d };
    };

    // Try postRoomCheckIn first (clears "previous reservation" block)
    const checkInVariants = [
      { subReservationID, roomID: assignedRoomID },
      { subReservationID },
      { roomID: assignedRoomID },
      {},
    ];
    for (const v of checkInVariants) {
      const rc = await doPostRoomCheckIn(v);
      if (rc.ok) break; // at least one succeeded — proceed to putReservation
    }

    // Now attempt putReservation status=checked_in
    let ciResult = await doPutCheckedIn();

    if (!ciResult.ok) {
      // If still failing, retry postRoomCheckIn variants then putReservation again
      for (const v of checkInVariants) {
        const rc = await doPostRoomCheckIn(v);
        if (rc.ok) {
          ciResult = await doPutCheckedIn();
          if (ciResult.ok) break;
        }
      }
    }

    if (!ciResult.ok) {
      const balProbe = String(ciResult.data?.message ?? '').replace(/&#(\d+);/g, (_: string, n: string) =>
        String.fromCharCode(Number(n))
      );
      if (/remaining balance|full amount|collect the full amount|prior to checking in/i.test(balProbe)) {
        log('6_settle_recover_after_checkin_balance_rejection', { message: balProbe });
        await settleReservationFolio(
          apiV13,
          CLOUDBEDS_PROPERTY_ID,
          CLOUDBEDS_API_KEY,
          reservationID,
          `${guestFirst} ${guestLast}`,
          log,
          { trustStaleInvoiceAfterSuccessfulPayment: true }
        );
        ciResult = await doPutCheckedIn();
      }
    }

    if (!ciResult.ok) {
      const rawMsg: string = ciResult.data?.message ?? 'Failed to set reservation status to checked_in';
      const decoded = rawMsg.replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(Number(n)));
      const soundsLikeRoomConflict =
        /cannot be checked in|previous reservations have been checked out|checked out/i.test(decoded);

      // Cloudbeds sometimes returns this warning even after the guest is already checked in
      // (status/replication lag). If getReservation shows checked_in, treat as success — no user-facing error.
      if (soundsLikeRoomConflict) {
        try {
          const verifyUrl = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(reservationID)}`;
          const vRes = await fetch(verifyUrl, { method: 'GET', headers: jsonHeaders });
          const vJson: any = await vRes.json().catch(() => ({}));
          const resRoot = vJson?.data ?? vJson;
          const st = String(resRoot?.status ?? resRoot?.reservationStatus ?? '').toLowerCase();
          log('6_verify_status_after_checkin_error', { status: st, body: vJson });
          if (st === 'checked_in') {
            ciResult = { ok: true, data: { message: 'Reconciled: reservation already checked in per getReservation', reconciled: true } };
          } else if (st === 'confirmed' || st === 'not_confirmed') {
            // Before deferring, try to evict whoever is still physically in the room and retry check-in.
            const todayForEvict = getLocalDateStr(new Date());
            const evict = await evictRoomOccupant(
              apiV13,
              CLOUDBEDS_PROPERTY_ID,
              CLOUDBEDS_API_KEY,
              assignedRoomID || placeholder.roomID || '',
              placeholder.roomName || '',
              todayForEvict,
              (step, data) => log(`6_ph_evict_${step}`, data),
            );
            log('6_evict_occupant_result', {
              evicted: evict.evicted,
              occupantReservationID: evict.occupantReservationID,
              occupantSetToConfirmed: evict.occupantSetToConfirmed,
              strategy: evict.occupantSetToConfirmed ? 'confirmed_and_unassigned' : 'checked_out',
            });

            if (evict.evicted) {
              // Retry postRoomCheckIn then putReservation checked_in
              for (const v of checkInVariants) {
                const rc = await doPostRoomCheckIn(v);
                if (rc.ok) break;
              }
              ciResult = await doPutCheckedIn();
              log('6_retry_after_eviction', { ok: ciResult.ok, body: ciResult.data });
            }

            if (!ciResult.ok) {
              // Still failing after eviction attempt — defer as before
              deferredPhysicalCheckIn = true;
              ciResult = {
                ok: true,
                data: {
                  deferredRoomCheckIn: true,
                  message:
                    'Guest details and payment are saved. Physical check-in is waiting because this room still has a prior guest in Cloudbeds — staff can check the new guest in when the room is free.',
                },
              };
              log('6_defer_physical_checkin_prior_guest_in_room', { reservationStatus: st, reservationID, evictAttempted: true });
            }
          }
        } catch {
          /* fall through to throw */
        }
      }

      if (!ciResult.ok) {
        throw new Error(decoded);
      }
    }

    // -----------------------------------------------------------------------
    // Step 7: Mark placeholder as assigned in our store
    // -----------------------------------------------------------------------
    await assignPlaceholder(placeholder.id, resolvedGuestID || 'unknown');
    log('7_placeholder_assigned', { placeholderID: placeholder.id, guestID: resolvedGuestID });
    // Best-effort: room-level check-in (skip when we deliberately deferred — would fail the same way)
    if (!deferredPhysicalCheckIn) {
      try {
        await doPostRoomCheckIn({ subReservationID, roomID: assignedRoomID });
      } catch {
        /* ignore */
      }
    }

    return NextResponse.json({
      success: true,
      reservationID,
      guestID: resolvedGuestID || undefined,
      roomName: placeholder.roomName,
      reservationStatus: deferredPhysicalCheckIn ? 'confirmed' : 'checked_in',
      message: deferredPhysicalCheckIn
        ? 'Your stay is paid and confirmed. Check-in will finish when the room is free — the front desk can complete it in Cloudbeds after the prior guest departs.'
        : 'Placeholder assigned and guest successfully checked in',
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
