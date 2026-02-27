import { NextRequest, NextResponse } from 'next/server';
import { performCloudbedsCheckIn } from '@/lib/cloudbeds-checkin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { firstName, lastName, phoneNumber, roomName, clcNumber, classType, email, reservationID: existingReservationID, checkInDate: bodyCheckIn, checkOutDate: bodyCheckOut } = body;

    console.log('Check-in API called with:', { firstName, lastName, roomName, clcNumber, classType });

    if (!firstName || !lastName || !roomName) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
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
        console.error('Cloudbeds check-in failed:', errorData);
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
        clcNumber,
        classType,
        email,
        checkInDate: bodyCheckIn,
        checkOutDate: bodyCheckOut,
      });
      return NextResponse.json({
        success: true,
        guestID: result.guestID,
        reservationID: result.reservationID,
        roomName: result.roomName,
        message: result.message,
      });
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
    console.error('Cloudbeds check-in error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to check in to Cloudbeds',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}

