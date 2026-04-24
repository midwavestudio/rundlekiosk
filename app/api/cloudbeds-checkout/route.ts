import { NextRequest, NextResponse } from 'next/server';
import {
  mergeReservationRoomRows,
  pickActiveRoom,
  unwrapReservationFromGetReservation,
} from '@/lib/cloudbeds-rate-preserve';
import { saveEventLog } from '@/lib/event-log-store';

/** Structured admin-facing error log for checkout failures. Visible in server logs / hosting dashboard. */
function logCheckOutFailure(context: {
  reservationID?: string;
  checkoutDate?: string;
  isSameDay?: boolean;
  error: string;
  debugLog?: unknown;
  submittedRequest?: Record<string, unknown> | null;
}) {
  console.error(
    '[CHECK-OUT FAILURE] Review required:',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      reservationID: context.reservationID ?? 'unknown',
      checkoutDate: context.checkoutDate ?? 'unknown',
      isSameDay: context.isSameDay ?? false,
      error: context.error,
      submittedRequest: context.submittedRequest ?? null,
      debugLog: context.debugLog ?? [],
    }, null, 2)
  );
  void saveEventLog({
    level: 'error',
    source: 'api:cloudbeds-checkout',
    message: context.error,
    detail: {
      submittedRequest: context.submittedRequest ?? null,
      reservationID: context.reservationID ?? null,
      checkoutDate: context.checkoutDate ?? null,
      isSameDay: context.isSameDay ?? null,
      debugLog: context.debugLog ?? null,
    },
  }).catch(() => {});
}

/**
 * Cloudbeds checkout route with same-day unassign workaround.
 *
 * Problem: Cloudbeds does not allow checking in a new guest to a room on the same day
 * another guest checks out of that room. The "previous reservation" block prevents it.
 *
 * Solution (same-day checkout path):
 *   1. Detect same-day checkout (checkInDate === checkoutDate, i.e. guest checked in today).
 *   2. Unassign the physical room (confirmed → postRoomAssign newRoomID='').
 *   3. putReservation checkoutDate — required before Cloudbeds will accept checked_out.
 *   4. putReservation status=checked_out (reservation + guest data remain intact).
 *
 * Normal checkout path (multi-day stay):
 *   1. putReservation with checkoutDate (plus optional rooms[0][roomRateID]/ratePlanID from
 *      getReservation when present — avoids repricing to base rate; do not send full rooms[] with
 *      room changes — that re-runs availability and often fails).
 *   2. postRoomCheckOut, then putReservation status=checked_out if needed.
 *
 * Additional notes:
 *   - getReservation returns assigned rooms under `assigned` (and sometimes `rooms`).
 *     Using only `rooms` leaves the list empty → no roomID/subReservationID → checkout fails.
 *   - putReservation (v1.3) accepts top-level `checkoutDate` only — do not send `startDate`.
 *   - postRoomAssign unassign requires reservationRoomID + newRoomID='' per Cloudbeds v1.3 docs.
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
  fields: Record<string, string | undefined>,
  /** Keys whose empty-string value should be preserved (e.g. newRoomID='' to unassign). */
  keepEmptyKeys?: string[]
): Promise<{ ok: boolean; status: number; data: any; raw: string }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    const keep = keepEmptyKeys?.includes(k);
    if (v !== undefined && v !== null && (v !== '' || keep)) params.append(k, v ?? '');
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

/** YYYY-MM-DD from ISO or date-only strings (getReservations / kiosk may send full ISO). */
function normalizeYmd(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return undefined;
}

function reservationScheduledCheckoutYmd(res: any): string | undefined {
  if (!res || typeof res !== 'object') return undefined;
  return normalizeYmd(
    res.endDate ?? res.checkoutDate ?? res.departureDate ?? res.scheduledCheckout ?? res.scheduledCheckoutDate
  );
}

/** Checkout date cannot be before stay start (YYYY-MM-DD). */
function clampCheckoutDate(startYmd: string | undefined, requestedYmd: string): string {
  if (!startYmd || !/^\d{4}-\d{2}-\d{2}$/.test(startYmd)) return requestedYmd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedYmd)) return requestedYmd;
  return requestedYmd < startYmd ? startYmd : requestedYmd;
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

/**
 * Extract the reservationRoomID (line ID) from a reservation — needed for postRoomAssign unassign.
 * Cloudbeds docs: "reservationRoomID must be set if you want to unassign a room."
 */
function extractReservationRoomID(reservation: any): string | null {
  // Try assigned[] first (preferred — getReservation with includeAllRooms=true)
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
  // guestList shape (some property configurations)
  const gl = reservation?.guestList;
  if (gl && typeof gl === 'object' && !Array.isArray(gl)) {
    for (const entry of Object.values(gl) as any[]) {
      const id = entry?.reservationRoomID ?? entry?.reservationRoomId;
      if (id != null && String(id).trim() !== '') return String(id);
      // Also check nested assignedRooms
      if (Array.isArray(entry?.assignedRooms)) {
        for (const r of entry.assignedRooms) {
          const rid = r?.reservationRoomID ?? r?.reservationRoomId;
          if (rid != null && String(rid).trim() !== '') return String(rid);
        }
      }
    }
  }
  return null;
}

/**
 * Unassign a physical room from a reservation so it can be re-used on the same day.
 *
 * Cloudbeds will reject postRoomAssign while the reservation is in checked_in status
 * ("You must update the check out date prior to checking out the guest" surfaces when
 * trying to change status directly too). Unassign sequence (caller then sets checkoutDate + checked_out):
 *
 *   1. putReservation status=confirmed  — moves the reservation back to a mutable state
 *   2. postRoomAssign newRoomID=''      — physically unassigns the room (frees it)
 *
 * postRoomAssign docs (v1.3):
 *   "reservationRoomID: Must be set if you want to unassign a room."
 *   "newRoomID: Empty field must be sent if you want to unassign a room."
 *
 * IMPORTANT: newRoomID must be sent as an empty string — not omitted. The postForm
 * helper is called with keepEmptyKeys=['newRoomID'] to ensure the empty value is sent.
 *
 * Returns { ok, tried } where tried=false means no reservationRoomID was found.
 */
async function unassignRoom(
  apiBase: string,
  apiKey: string,
  propertyID: string,
  reservationID: string,
  reservationRecord: any,
  activeRoom: any,
  log: any[]
): Promise<{ ok: boolean; tried: boolean }> {
  const putUrl = `${apiBase}/putReservation`;

  // ── Step A: Reset to confirmed so Cloudbeds allows the room to be unassigned ──
  // A checked_in reservation cannot have its room unassigned directly.
  // Send ONLY status — no rooms[] fields, which would trigger repricing.
  const resetToConfirmed = await putForm(putUrl, apiKey, {
    propertyID,
    reservationID,
    status: 'confirmed',
  });
  log.push({ step: 'unassign_reset_confirmed', ok: resetToConfirmed.ok, data: resetToConfirmed.data });
  // Non-fatal — continue even if this fails (some reservations may already allow unassign)

  // ── Step B: Resolve reservationRoomID (line ID) ──
  // Re-fetch the reservation after the status change so we get the latest room line data.
  let reservationRoomID =
    extractReservationRoomID(reservationRecord) ??
    (activeRoom?.reservationRoomID != null ? String(activeRoom.reservationRoomID) : null) ??
    (activeRoom?.reservationRoomId != null ? String(activeRoom.reservationRoomId) : null);

  if (!reservationRoomID) {
    log.push({ step: 'unassign_skip', reason: 'No reservationRoomID found — cannot unassign' });
    return { ok: false, tried: false };
  }

  const subReservationID =
    activeRoom?.subReservationID != null ? String(activeRoom.subReservationID) : undefined;

  // ── Step C: postRoomAssign with newRoomID='' ──
  // MUST use keepEmptyKeys so the empty string is included in the form body.
  const unassignFields: Record<string, string | undefined> = {
    propertyID,
    reservationID,
    reservationRoomID,
    newRoomID: '', // empty = unassign per Cloudbeds API docs
    ...(subReservationID && subReservationID !== reservationID ? { subReservationID } : {}),
  };

  log.push({ step: 'unassign_request', reservationRoomID, subReservationID });

  const unassignRes = await postForm(
    `${apiBase}/postRoomAssign`,
    apiKey,
    unassignFields,
    ['newRoomID'] // preserve empty string so Cloudbeds receives newRoomID=
  );
  log.push({ step: 'unassign_response', ok: unassignRes.ok, status: unassignRes.status, data: unassignRes.data });

  return { ok: unassignRes.ok, tried: true };
}

export async function POST(request: NextRequest) {
  let submittedRequestLog: Record<string, unknown> | null = null;
  try {
    const body = await request.json();
    const { reservationID, checkoutAtIso, checkoutDate: bodyCheckoutDate, checkInDate: bodyCheckInDate } = body;
    submittedRequestLog = {
      reservationID: reservationID != null ? String(reservationID) : null,
      checkoutAtIso: typeof checkoutAtIso === 'string' ? checkoutAtIso : null,
      checkoutDate:
        typeof bodyCheckoutDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bodyCheckoutDate.trim())
          ? bodyCheckoutDate.trim()
          : bodyCheckoutDate != null
            ? String(bodyCheckoutDate)
            : null,
      checkInDate: bodyCheckInDate != null ? String(bodyCheckInDate) : null,
    };

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

    const reservationRecord = unwrapReservationFromGetReservation(resData) ?? resData?.data ?? null;
    const checkInYmdFromBody = normalizeYmd(bodyCheckInDate);
    const startYmd =
      normalizeYmd(reservationRecord?.startDate) ??
      normalizeYmd(reservationRecord?.checkInDate) ??
      checkInYmdFromBody;

    checkoutDate = clampCheckoutDate(startYmd, checkoutDate);

    const rooms: any[] = mergeReservationRoomRows(reservationRecord ?? {});
    const activeRoom = pickActiveRoom(rooms);
    const roomID = activeRoom?.roomID != null ? String(activeRoom.roomID) : undefined;
    const subReservationID = activeRoom?.subReservationID != null ? String(activeRoom.subReservationID) : undefined;
    const schedOut = reservationScheduledCheckoutYmd(reservationRecord);

    // Late checkouts (after the reservation's scheduled checkout date) should not rewrite
    // reservation length/rates. Keep the original scheduled checkout date in Cloudbeds.
    if (schedOut && checkoutDate > schedOut) {
      log.push({
        step: 'late_checkout_preserve_scheduled_date',
        requestedCheckoutDate: checkoutDate,
        preservedCheckoutDate: schedOut,
      });
      checkoutDate = schedOut;
    }

    log.push({ step: 'room_info', roomID, subReservationID, checkoutDate, startYmd, schedOut });

    // ── Detect same-day checkout ──
    // A same-day checkout occurs when the guest checks in and out on the same calendar date.
    // We detect it three ways (any one is sufficient):
    //   1. startDate from Cloudbeds matches today's checkout date
    //   2. The caller passed a checkInDate that matches today's checkout date
    //   3. The reservation status is checked_in AND startDate is today (covers TYE/same-day blocks)
    const isSameDay =
      (!!startYmd && startYmd === checkoutDate) ||
      (!!checkInYmdFromBody && checkInYmdFromBody === checkoutDate);
    log.push({ step: 'same_day_detection', isSameDay, startYmd, checkInYmdFromBody, checkoutDate });

    let lastMessage = '';
    let checkoutSucceeded = false;
    let roomUnassigned = false;

    if (isSameDay) {
      // ── SAME-DAY PATH ──
      // Sequence:
      //   A) putReservation status=confirmed  (inside unassignRoom — unlocks room from checked_in)
      //   B) postRoomAssign newRoomID=''       (physically unassigns room → frees it for re-use)
      //   C) putReservation status=checked_out (marks reservation closed; guest data preserved)

      const unassignResult = await unassignRoom(
        apiBase,
        CLOUDBEDS_API_KEY,
        CLOUDBEDS_PROPERTY_ID,
        String(reservationID),
        reservationRecord ?? {},
        activeRoom,
        log
      );
      roomUnassigned = unassignResult.ok;

      if (!unassignResult.ok) {
        if (unassignResult.tried) {
          // postRoomAssign call was made but failed — log a warning and still attempt status update
          console.warn('cloudbeds-checkout: same-day room unassign failed (non-fatal) — proceeding to checked_out status', log);
        } else {
          // No reservationRoomID found — still attempt checked_out; room may already be unassigned
          console.warn('cloudbeds-checkout: no reservationRoomID found for unassign — proceeding to checked_out status', log);
        }
      }

      // Step C: Finalize checkout.
      // After unassign the reservation sits on "confirmed". For same-day stays the reservation's
      // endDate is already today (since startDate === checkoutDate), so we should NOT send
      // checkoutDate — that would reprice to base rate.  Go straight to status=checked_out.
      // Only add checkoutDate if it isn't already on the reservation.
      const schedOutSameDay = reservationScheduledCheckoutYmd(reservationRecord);
      const sameDayDateAlreadyCorrect = !!schedOutSameDay && schedOutSameDay === checkoutDate;

      if (!sameDayDateAlreadyCorrect) {
        const dateFirst = await putForm(putUrl, CLOUDBEDS_API_KEY, {
          propertyID: CLOUDBEDS_PROPERTY_ID,
          reservationID: String(reservationID),
          checkoutDate,
        });
        log.push({ step: 'sameday_putReservation_checkoutDate', ok: dateFirst.ok, data: dateFirst.data });
        if (!dateFirst.ok) {
          log.push({ step: 'sameday_checkoutDate_note', note: 'Date put failed — proceeding to status anyway' });
        }
      } else {
        log.push({ step: 'sameday_checkoutDate_already_correct', schedOutSameDay, note: 'Skipping date put to avoid repricing' });
      }

      const statusPut = await putForm(putUrl, CLOUDBEDS_API_KEY, {
        propertyID: CLOUDBEDS_PROPERTY_ID,
        reservationID: String(reservationID),
        status: 'checked_out',
      });
      log.push({ step: 'sameday_putReservation_checked_out', ok: statusPut.ok, data: statusPut.data });
      if (statusPut.ok) {
        checkoutSucceeded = true;
      } else {
        lastMessage = decodeHtmlEntities(statusPut.data?.message ?? statusPut.raw ?? '');
        // Fallback: combined call (some accounts accept this when sequential calls fail)
        const combined = await putForm(putUrl, CLOUDBEDS_API_KEY, {
          propertyID: CLOUDBEDS_PROPERTY_ID,
          reservationID: String(reservationID),
          checkoutDate,
          status: 'checked_out',
        });
        log.push({ step: 'sameday_putReservation_combined', ok: combined.ok, data: combined.data });
        if (combined.ok) {
          checkoutSucceeded = true;
        } else {
          lastMessage = decodeHtmlEntities(combined.data?.message ?? combined.raw ?? lastMessage);
          if (!checkoutSucceeded && /check.?out date|prior to checking/i.test(lastMessage)) {
            log.push({ step: 'sameday_fallback_resequence', note: lastMessage });
            await putForm(putUrl, CLOUDBEDS_API_KEY, {
              propertyID: CLOUDBEDS_PROPERTY_ID,
              reservationID: String(reservationID),
              checkoutDate,
            });
            const retryStatus = await putForm(putUrl, CLOUDBEDS_API_KEY, {
              propertyID: CLOUDBEDS_PROPERTY_ID,
              reservationID: String(reservationID),
              status: 'checked_out',
            });
            log.push({ step: 'sameday_fallback_putStatus', ok: retryStatus.ok, data: retryStatus.data });
            if (retryStatus.ok) {
              checkoutSucceeded = true;
            } else {
              lastMessage = decodeHtmlEntities(retryStatus.data?.message ?? retryStatus.raw ?? lastMessage);
            }
          }
        }
        if (!checkoutSucceeded && /already checked.?out|no change|already/i.test(lastMessage)) {
          checkoutSucceeded = true;
          log.push({ step: 'sameday_already_checked_out', note: lastMessage });
        }
      }
    } else {
      // ── NORMAL MULTI-DAY PATH ──
      //
      // IMPORTANT — putReservation with `checkoutDate` recalculates daily rates for the new stay
      // window and can change TYE to base rate.  Only send it when the date on the reservation
      // differs from what we want to check out at.  If Cloudbeds already has the right date,
      // skip entirely and go straight to postRoomCheckOut / status=checked_out.

      const dateAlreadyCorrect = !!schedOut && schedOut === checkoutDate;
      let dateUpdated = dateAlreadyCorrect;

      if (dateAlreadyCorrect) {
        log.push({ step: 'checkout_date_already_correct', schedOut, note: 'Skipping putReservation checkoutDate to avoid repricing' });
      }

      if (!dateUpdated) {
        // Date needs changing — must tell Cloudbeds the new checkout date.
        const topLevelDate = await putForm(putUrl, CLOUDBEDS_API_KEY, {
          propertyID: CLOUDBEDS_PROPERTY_ID,
          reservationID: String(reservationID),
          checkoutDate,
        });
        log.push({ step: 'putReservation_checkoutDate_only', ok: topLevelDate.ok, data: topLevelDate.data });
        if (topLevelDate.ok) {
          dateUpdated = true;
        } else {
          lastMessage = topLevelDate.data?.message ?? topLevelDate.raw ?? '';
          const alreadySet =
            /already/i.test(lastMessage) ||
            /no change/i.test(lastMessage) ||
            /same date/i.test(lastMessage);
          if (alreadySet) {
            dateUpdated = true;
            log.push({ step: 'putReservation_alreadySet', note: lastMessage });
          }
        }
      }

      let multiDayFinishedViaCombinedPut = false;
      if (!dateUpdated) {
        // Last resort: combined call (some Cloudbeds accounts only accept this)
        const combinedOut = await putForm(putUrl, CLOUDBEDS_API_KEY, {
          propertyID: CLOUDBEDS_PROPERTY_ID,
          reservationID: String(reservationID),
          checkoutDate,
          status: 'checked_out',
        });
        log.push({ step: 'multiday_putReservation_checkoutDate_and_checked_out', ok: combinedOut.ok, data: combinedOut.data });
        if (combinedOut.ok) {
          checkoutSucceeded = true;
          multiDayFinishedViaCombinedPut = true;
        } else {
          lastMessage = combinedOut.data?.message ?? combinedOut.raw ?? lastMessage;
        }
      }

      if (!dateUpdated && !multiDayFinishedViaCombinedPut) {
        const msg = decodeHtmlEntities(lastMessage || 'Could not set checkout date in Cloudbeds.');
        console.error('cloudbeds-checkout: checkout date update failed', log);
        return NextResponse.json(
          { success: false, error: msg, debugLog: log },
          { status: 422 }
        );
      }

      // 2) Room checkout via postRoomCheckOut (preferred — does not reprice)
      if (!multiDayFinishedViaCombinedPut && (roomID || subReservationID)) {
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

      // 3) Fallback: status-only put (no rooms[], no checkoutDate — does not reprice)
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
    }

    if (!checkoutSucceeded) {
      const msg = decodeHtmlEntities(lastMessage || 'Check-out could not be completed.');
      logCheckOutFailure({
        reservationID: String(reservationID),
        checkoutDate,
        isSameDay,
        error: msg,
        debugLog: log,
        submittedRequest: submittedRequestLog,
      });
      return NextResponse.json(
        { success: false, error: msg, debugLog: log },
        { status: 422 }
      );
    }

    const startForDays = startYmd ?? checkInYmdFromBody ?? checkoutDate;
    const daysStayed = computeDaysStayed(startForDays, checkoutDate);

    console.log('cloudbeds-checkout: success', JSON.stringify(log));

    return NextResponse.json({
      success: true,
      reservationID,
      checkoutDate,
      daysStayed,
      isSameDay,
      roomUnassigned: isSameDay ? roomUnassigned : undefined,
      checkOutAt: new Date(checkOutMs).toISOString(),
    });
  } catch (error: any) {
    logCheckOutFailure({
      error: error.message || 'Unhandled exception in checkout',
      submittedRequest: submittedRequestLog,
    });
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to check out from Cloudbeds' },
      { status: 500 }
    );
  }
}
