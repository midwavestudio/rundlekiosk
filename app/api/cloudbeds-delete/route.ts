import { NextRequest, NextResponse } from 'next/server';
import { reservationHasTyeRatePlan } from '@/lib/cloudbeds-tye';

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reservationID = searchParams.get('reservationID');

    if (!reservationID) {
      return NextResponse.json(
        { success: false, error: 'Reservation ID is required' },
        { status: 400 }
      );
    }

    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.3';

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      console.warn('Cloudbeds API credentials not configured');
      return NextResponse.json(
        { 
          success: true, 
          message: 'Reservation deleted (Cloudbeds not configured)',
          mockMode: true 
        },
        { status: 200 }
      );
    }

    // ── SAFETY GUARD: Only cancel reservations this kiosk created ──────────────────
    // Prevents accidental cancellation of OTA (Expedia, Booking.com) or direct bookings.
    {
      const baseUrl = CLOUDBEDS_API_URL.replace(/\/v1\.\d+\/?$/, '');
      const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;
      const grUrl = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(reservationID)}`;
      const grRes = await fetch(grUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${CLOUDBEDS_API_KEY}`, 'Content-Type': 'application/json' },
      });
      if (!grRes.ok) {
        return NextResponse.json(
          { success: false, error: `Could not verify ownership of reservation ${reservationID} (HTTP ${grRes.status}). Refusing to delete to prevent accidental changes to OTA bookings.` },
          { status: 502 }
        );
      }
      const grJson = await grRes.json();
      const grData = grJson?.data ?? grJson;
      if (!reservationHasTyeRatePlan(grData)) {
        const srcId = grData?.sourceID ?? grData?.source_id ?? '(unknown)';
        return NextResponse.json(
          { success: false, error: `Reservation ${reservationID} (sourceID: ${srcId}) was not created by this kiosk — cannot cancel OTA or direct bookings.` },
          { status: 403 }
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────────────

    // Cancel/delete the reservation in Cloudbeds
    // Note: Cloudbeds may use different endpoints for cancellation vs deletion
    // Using putReservation with status 'cancelled' as a safe approach
    const deleteParams = new URLSearchParams();
    deleteParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    deleteParams.append('reservationID', reservationID);
    deleteParams.append('status', 'cancelled');
    
    const deleteResponse = await fetch(`${CLOUDBEDS_API_URL}/putReservation`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: deleteParams.toString(),
    });

    if (!deleteResponse.ok) {
      const errorData = await deleteResponse.json().catch(() => ({}));
      console.error('Cloudbeds delete failed:', errorData);
      throw new Error('Failed to delete reservation in Cloudbeds');
    }

    return NextResponse.json({
      success: true,
      reservationID,
      message: 'Reservation successfully cancelled in Cloudbeds',
    });

  } catch (error: any) {
    console.error('Cloudbeds delete error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to delete reservation in Cloudbeds',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}



