import { NextRequest, NextResponse } from 'next/server';
import { performCloudbedsCheckIn } from '@/lib/cloudbeds-checkin';

/** Structured admin-facing error log for check-in failures. Visible in server logs / hosting dashboard. */
function logCheckInFailure(context: {
  guest?: string;
  room?: string;
  reservationID?: string;
  error: string;
  debugTrail?: unknown;
}) {
  console.error(
    '[CHECK-IN FAILURE] Review required:',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      guest: context.guest ?? 'unknown',
      room: context.room ?? 'unknown',
      reservationID: context.reservationID ?? 'none',
      error: context.error,
      debugTrail: context.debugTrail ?? [],
    }, null, 2)
  );
}

/** Guest flow succeeded in Cloudbeds but physical room could not be booked / check-in deferred — staff should review. */
function logCheckInStaffAlert(context: {
  guest: string;
  room: string;
  reservationID: string;
  message?: string;
  flow: 'walk_in' | 'tye_placeholder';
}) {
  console.warn(
    '[CHECK-IN STAFF ALERT] Requested room unavailable or check-in deferred — confirmed reservation without that room:',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...context,
    })
  );
}

export async function POST(request: NextRequest) {
  let debugLog: Array<{ step: string; request?: unknown; response?: unknown; error?: string }> | undefined;
  try {
    const body = await request.json();
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
      debug: enableDebug,
    } = body;

    console.log('Check-in API called with:', { firstName, lastName, roomName, clcNumber, classType });
    debugLog = enableDebug === true ? [] : undefined;

    if (!String(firstName ?? '').trim() || !String(lastName ?? '').trim() || !roomName) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // TYE Placeholder path — room was pre-created as a placeholder reservation.
    // Delegate to assign-placeholder which updates the guest, posts payment, and checks in.
    if (placeholderReservationID) {
      const assignBody = {
        placeholderReservationID,
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        phoneNumber,
        clcNumber,
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
      if (assignData.reservationStatus === 'confirmed') {
        logCheckInStaffAlert({
          guest: `${String(firstName).trim()} ${String(lastName).trim()}`,
          room: String(roomName),
          reservationID: String(assignData.reservationID ?? placeholderReservationID),
          message: typeof assignData.message === 'string' ? assignData.message : undefined,
          flow: 'tye_placeholder',
        });
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
        logCheckInFailure({
          guest: `${firstName} ${lastName}`,
          room: roomName,
          reservationID: existingReservationID,
          error: `putReservation status=checked_in failed: ${errMsg}`,
          debugTrail: errorData,
        });
        throw new Error('Failed to check in guest in Cloudbeds');
      }

      return NextResponse.json({
        success: true,
        reservationID: existingReservationID,
        roomName: roomName,
        message: 'Guest successfully checked in to Cloudbeds',
      });
    }

    // Create new reservation and check in (shared logic with bulk-checkin)
    try {
      const result = await performCloudbedsCheckIn({
        firstName,
        lastName,
        phoneNumber,
        roomName,
        roomNameHint,
        clcNumber,
        classType,
        email,
        checkInDate: bodyCheckIn,
        checkOutDate: bodyCheckOut,
        debugLog,
      });
      if (result.reservationStatus === 'confirmed') {
        logCheckInStaffAlert({
          guest: `${String(firstName).trim()} ${String(lastName).trim()}`,
          room: String(roomName),
          reservationID: String(result.reservationID),
          message: result.message,
          flow: 'walk_in',
        });
      }
      const response: Record<string, unknown> = {
        success: true,
        guestID: result.guestID,
        reservationID: result.reservationID,
        roomName: result.roomName,
        message: result.message,
      };
      if (result.reservationStatus) response.reservationStatus = result.reservationStatus;
      if (debugLog && debugLog.length > 0) response.debugTrail = debugLog;
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
      error: errMsg,
      debugTrail: debugLog,
    });
    const errResponse: Record<string, unknown> = {
      success: false,
      error: errMsg,
      details: error.toString(),
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

