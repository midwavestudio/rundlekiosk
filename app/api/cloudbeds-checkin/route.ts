import { NextRequest, NextResponse } from 'next/server';
import { performCloudbedsCheckIn } from '@/lib/cloudbeds-checkin';
import { validateClcNumberRequired } from '@/lib/checkin-validation';
import { saveEventLog } from '@/lib/event-log-store';
import {
  savePendingCheckin,
  markPendingCheckinComplete,
  markPendingCheckinFailed,
  incrementPendingCheckinAttempt,
} from '@/lib/pending-checkin-store';
import { updateCheckinRecord } from '@/lib/checkin-store';

// Allow up to 300 seconds for Cloudbeds API calls (postReservation + payment + room assign + check-in).
// The check-in flow makes many sequential Cloudbeds calls (getRooms paginated, getRatePlans, postReservation,
// invoice polling up to 14 rounds, postPayment, postRoomAssign multiple attempts, putReservation checked_in).
// 60s was insufficient and caused silent failures where the function was killed mid-execution, leaving the
// guest with no Cloudbeds reservation. Vercel Pro supports up to 300s for serverless functions.
export const maxDuration = 300;

/** Kiosk/API request fields stored on failures so the admin error log shows what was submitted. */
function pickCheckInRequestForLog(body: Record<string, unknown>) {
  return {
    firstName: body.firstName != null ? String(body.firstName).trim() : null,
    lastName: body.lastName != null ? String(body.lastName).trim() : null,
    phoneNumber: body.phoneNumber != null ? String(body.phoneNumber) : null,
    clcNumber: body.clcNumber != null ? String(body.clcNumber) : null,
    classType: body.classType != null ? String(body.classType) : null,
    email: body.email != null ? String(body.email) : null,
    roomName: body.roomName != null ? String(body.roomName) : null,
    roomNameHint: body.roomNameHint != null ? String(body.roomNameHint) : null,
    checkInDate: body.checkInDate != null ? String(body.checkInDate) : null,
    checkOutDate: body.checkOutDate != null ? String(body.checkOutDate) : null,
    placeholderReservationID:
      body.placeholderReservationID != null ? String(body.placeholderReservationID) : null,
    reservationID: body.reservationID != null ? String(body.reservationID) : null,
  };
}

/** Structured admin-facing error log for check-in failures. Visible in server logs / hosting dashboard. */
function logCheckInFailure(context: {
  guest?: string;
  room?: string;
  reservationID?: string;
  error: string;
  debugTrail?: unknown;
  submittedRequest?: Record<string, unknown> | null;
}) {
  console.error(
    '[CHECK-IN FAILURE] Review required:',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      guest: context.guest ?? 'unknown',
      room: context.room ?? 'unknown',
      reservationID: context.reservationID ?? 'none',
      error: context.error,
      submittedRequest: context.submittedRequest ?? null,
      debugTrail: context.debugTrail ?? [],
    }, null, 2)
  );
  void saveEventLog({
    level: 'error',
    source: 'api:cloudbeds-checkin',
    message: context.error,
    detail: {
      submittedRequest: context.submittedRequest ?? null,
      guest: context.guest ?? null,
      room: context.room ?? null,
      reservationID: context.reservationID ?? null,
      debugTrail: context.debugTrail ?? null,
    },
  }).catch(() => {});
}

export async function POST(request: NextRequest) {
  let debugLog: Array<{ step: string; request?: unknown; response?: unknown; error?: string }> | undefined;
  // Hoisted so the outer catch can include guest context in the admin error log.
  let guestLabel = 'unknown';
  let roomLabel = 'unknown';
  let submittedRequestLog: Record<string, unknown> | null = null;
  // pendingId is set as soon as we persist the pending record — used in catch to mark failed.
  let pendingId: string | null = null;

  try {
    const body = await request.json();
    submittedRequestLog = pickCheckInRequestForLog(body as Record<string, unknown>);
    const {
      firstName,
      lastName,
      phoneNumber,
      roomName,
      roomNameHint,
      clcNumber,
      classType,
      email,
      reservationID: existingReservationID,
      placeholderReservationID,
      checkInDate: bodyCheckIn,
      checkOutDate: bodyCheckOut,
      forceUnassigned,
      debug: enableDebug,
      // Passed by the retry worker so it can link back to the pending record
      pendingCheckinId: bodyPendingId,
      // Passed so we can patch the kiosk record on success
      checkinRecordId: bodyCheckinRecordId,
    } = body;

    if (firstName || lastName) guestLabel = `${firstName ?? ''} ${lastName ?? ''}`.trim();
    if (roomName) roomLabel = String(roomName);

    console.log('Check-in API called with:', { firstName, lastName, roomName, clcNumber, classType, checkInDate: bodyCheckIn, checkOutDate: bodyCheckOut, forceUnassigned: !!forceUnassigned });
    // Always collect debug steps so failures in the admin Error Log include a full trace.
    debugLog = [];

    // forceUnassigned requests don't need a physical roomName — validate name fields only.
    if (!String(firstName ?? '').trim() || !String(lastName ?? '').trim() || (!roomName && !forceUnassigned)) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const clcValidation = validateClcNumberRequired(clcNumber);
    if (!clcValidation.ok) {
      return NextResponse.json(
        { success: false, error: clcValidation.error },
        { status: 400 }
      );
    }
    const validatedClcNumber = clcValidation.clcNumber;

    // TYE Placeholder path — room was pre-created as a placeholder reservation.
    // Delegate to assign-placeholder which updates the guest, posts payment, and checks in.
    if (placeholderReservationID) {
      const assignBody = {
        placeholderReservationID,
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        phoneNumber,
        clcNumber: validatedClcNumber,
        email,
      };
      const assignRes = await fetch(
        `${getAppBaseUrl(request)}/api/assign-placeholder`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(assignBody),
        }
      );
      const assignData = await assignRes.json();
      if (!assignRes.ok || assignData.success !== true) {
        const assignErr = assignData.error ?? 'Placeholder assignment failed';
        logCheckInFailure({
          guest: `${firstName} ${lastName}`,
          room: roomName,
          reservationID: placeholderReservationID,
          error: assignErr,
          debugTrail: assignData.debugTrail,
          submittedRequest: submittedRequestLog,
        });
        return NextResponse.json(
          {
            success: false,
            error: assignErr,
            debugTrail: assignData.debugTrail,
          },
          { status: assignRes.ok ? 500 : assignRes.status }
        );
      }
      return NextResponse.json({
        success: true,
        reservationID: assignData.reservationID,
        guestID: assignData.guestID,
        roomName: assignData.roomName,
        message: assignData.message,
        placeholderAssigned: true,
        ...(assignData.reservationStatus ? { reservationStatus: assignData.reservationStatus } : {}),
        debugTrail: enableDebug ? assignData.debugTrail : undefined,
      });
    }

    // If reservationID is provided, update existing reservation (status-only path)
    if (existingReservationID) {
      const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
      const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
      const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.3';

      if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
        return NextResponse.json(
          { 
            success: true, 
            message: 'Check-in updated (Cloudbeds not configured)',
            mockMode: true 
          },
          { status: 200 }
        );
      }

      // Check in the reservation (just update status)
      const checkInParams = new URLSearchParams();
      checkInParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      checkInParams.append('reservationID', existingReservationID);
      checkInParams.append('status', 'checked_in');
      
      const checkInResponse = await fetch(`${CLOUDBEDS_API_URL}/putReservation`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: checkInParams.toString(),
      });

      if (!checkInResponse.ok) {
        const errorData = await checkInResponse.json().catch(() => ({}));
        const errMsg = errorData?.message ?? `HTTP ${checkInResponse.status}`;
        // Single log via outer catch — do not call logCheckInFailure here (would duplicate with catch below).
        throw new Error(`putReservation status=checked_in failed: ${errMsg}`);
      }

      return NextResponse.json({
        success: true,
        reservationID: existingReservationID,
        roomName: roomName,
        message: 'Guest successfully checked in to Cloudbeds',
      });
    }

    // Create new reservation and check in (shared logic with bulk-checkin).
    // No server-side retry loop here — performCloudbedsCheckIn handles fallback attempts internally.
    // Kiosk retries may create a second reservation only when the first attempt never reached Cloudbeds.
    const checkInParams = {
      firstName,
      lastName,
      phoneNumber,
      roomName: roomName ?? '',
      roomNameHint,
      clcNumber: validatedClcNumber,
      classType,
      email,
      checkInDate: bodyCheckIn,
      checkOutDate: bodyCheckOut,
      forceUnassigned: !!forceUnassigned,
      allowOverbooking: body.allowOverbooking === true,
      debugLog,
    };

    // -----------------------------------------------------------------
    // Persist a "pending" record BEFORE calling Cloudbeds.
    // This ensures that even if the function is killed by a timeout, we
    // have a durable record of the check-in attempt that the retry cron
    // can pick up and complete automatically.
    // -----------------------------------------------------------------
    if (bodyPendingId) {
      // This call was made by the retry worker — reuse the existing pending record.
      pendingId = String(bodyPendingId);
      await incrementPendingCheckinAttempt(pendingId).catch(() => {});
    } else {
      pendingId = await savePendingCheckin(
        {
          firstName,
          lastName,
          phoneNumber,
          roomName: roomName ?? '',
          roomNameHint,
          clcNumber: validatedClcNumber,
          classType,
          email,
          checkInDate: bodyCheckIn,
          checkOutDate: bodyCheckOut,
          forceUnassigned: !!forceUnassigned,
          allowOverbooking: body.allowOverbooking === true,
        },
        {
          checkinRecordId: bodyCheckinRecordId ?? undefined,
          source: 'kiosk',
        }
      ).catch((err) => {
        // Non-fatal: if we can't save the pending record, proceed anyway —
        // worst case we lose the retry safety net but the check-in itself still runs.
        console.error('[cloudbeds-checkin] Failed to save pending record:', err?.message);
        return null;
      });
    }

    try {
      const result = await performCloudbedsCheckIn(checkInParams);
      const response: Record<string, unknown> = {
        success: true,
        guestID: result.guestID,
        reservationID: result.reservationID,
        roomName: result.roomName,
        message: result.message,
        pendingCheckinId: pendingId,
      };
      if (result.reservationStatus) response.reservationStatus = result.reservationStatus;
      if (debugLog && debugLog.length > 0) response.debugTrail = debugLog;

      // Mark the pending record as completed and patch the kiosk record.
      if (pendingId) {
        markPendingCheckinComplete(pendingId, result.reservationID, result.guestID).catch(() => {});
      }
      // Patch the Firestore kiosk record with Cloudbeds IDs — use a real await with error
      // handling so the IDs are reliably persisted (previously was a fire-and-forget .catch(() => {})).
      const recordIdToPatch = bodyCheckinRecordId ?? null;
      if (recordIdToPatch && result.reservationID) {
        try {
          await updateCheckinRecord(String(recordIdToPatch), {
            cloudbedsReservationID: result.reservationID,
            cloudbedsGuestID: result.guestID,
            ...(result.reservationStatus ? { reservationStatus: result.reservationStatus } as any : {}),
          });
        } catch (patchErr: any) {
          // Log but don't fail the response — the pending record has the IDs so retry can re-patch.
          console.error('[cloudbeds-checkin] Failed to patch kiosk record with Cloudbeds IDs:', patchErr?.message);
          void saveEventLog({
            level: 'error',
            source: 'api:cloudbeds-checkin',
            message: `Failed to patch kiosk record ${recordIdToPatch} with Cloudbeds IDs: ${patchErr?.message}`,
            detail: { recordIdToPatch, reservationID: result.reservationID },
          }).catch(() => {});
        }
      }

      return NextResponse.json(response);
    } catch (createError: any) {
      if (createError?.message === 'Cloudbeds not configured') {
        return NextResponse.json(
          { success: true, message: 'Check-in completed (Cloudbeds not configured)', mockMode: true },
          { status: 200 }
        );
      }
      throw createError;
    }

  } catch (error: any) {
    const errMsg = error.message || 'Failed to check in to Cloudbeds';
    logCheckInFailure({
      guest: guestLabel,
      room: roomLabel,
      error: errMsg,
      debugTrail: debugLog,
      submittedRequest: submittedRequestLog,
    });

    // Mark the pending record as failed so the retry cron can pick it up.
    if (pendingId) {
      markPendingCheckinFailed(pendingId, errMsg, 1).catch(() => {});
    }

    const errResponse: Record<string, unknown> = {
      success: false,
      error: errMsg,
      details: error.toString(),
      pendingCheckinId: pendingId,
    };
    if (debugLog && debugLog.length > 0) errResponse.debugTrail = debugLog;
    return NextResponse.json(errResponse, { status: 500 });
  }
}

/** Derive the app's base URL from the incoming request so internal fetch calls work in all environments. */
function getAppBaseUrl(request: NextRequest): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
