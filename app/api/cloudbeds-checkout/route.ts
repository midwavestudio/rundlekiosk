import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { reservationID } = body;

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
          message: 'Check-out completed (Cloudbeds not configured)',
          mockMode: true 
        },
        { status: 200 }
      );
    }

    // Check out the reservation
    const checkOutResponse = await fetch(`${CLOUDBEDS_API_URL}/putReservation`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        propertyID: CLOUDBEDS_PROPERTY_ID,
        reservationID: reservationID,
        status: 'checked_out',
      }),
    });

    if (!checkOutResponse.ok) {
      const errorData = await checkOutResponse.json().catch(() => ({}));
      console.error('Cloudbeds check-out failed:', errorData);
      throw new Error('Failed to check out guest in Cloudbeds');
    }

    return NextResponse.json({
      success: true,
      reservationID,
      message: 'Guest successfully checked out from Cloudbeds',
    });

  } catch (error: any) {
    console.error('Cloudbeds check-out error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to check out from Cloudbeds',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}

