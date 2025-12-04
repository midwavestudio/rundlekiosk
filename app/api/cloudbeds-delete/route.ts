import { NextRequest, NextResponse } from 'next/server';

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
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

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

    // Cancel/delete the reservation in Cloudbeds
    // Note: Cloudbeds may use different endpoints for cancellation vs deletion
    // Using putReservation with status 'cancelled' as a safe approach
    const deleteResponse = await fetch(`${CLOUDBEDS_API_URL}/putReservation`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        propertyID: CLOUDBEDS_PROPERTY_ID,
        reservationID: reservationID,
        status: 'cancelled',
      }),
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



