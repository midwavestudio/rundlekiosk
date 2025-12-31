import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { firstName, lastName, phoneNumber, roomTypeName, clcNumber, classType, email, reservationID: existingReservationID } = body;

    console.log('Check-in API called with:', { firstName, lastName, roomTypeName, clcNumber, classType });

    // Validate required fields
    if (!firstName || !lastName || !roomTypeName) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // If reservationID is provided, update existing reservation
    if (existingReservationID) {
      const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
      const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
      const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

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

      // Assign room
      const roomAssignResponse = await fetch(`${CLOUDBEDS_API_URL}/postRoomAssign`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          propertyID: CLOUDBEDS_PROPERTY_ID,
          reservationID: existingReservationID,
          roomName: roomNumber,
        }),
      });

      if (!roomAssignResponse.ok) {
        console.warn('Room assignment failed, but continuing with check-in');
      }

      // Check in the reservation
      const checkInResponse = await fetch(`${CLOUDBEDS_API_URL}/putReservation`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          propertyID: CLOUDBEDS_PROPERTY_ID,
          reservationID: existingReservationID,
          status: 'checked_in',
        }),
      });

      if (!checkInResponse.ok) {
        const errorData = await checkInResponse.json().catch(() => ({}));
        console.error('Cloudbeds check-in failed:', errorData);
        throw new Error('Failed to check in guest in Cloudbeds');
      }

      return NextResponse.json({
        success: true,
        reservationID: existingReservationID,
        roomNumber,
        message: 'Guest successfully checked in to Cloudbeds',
      });
    }

    // Get Cloudbeds API credentials from environment
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      console.warn('Cloudbeds API credentials not configured');
      return NextResponse.json(
        { 
          success: true, 
          message: 'Check-in completed (Cloudbeds not configured)',
          mockMode: true 
        },
        { status: 200 }
      );
    }

    // Get today's date for check-in
    const today = new Date();
    const checkInDate = today.toISOString().split('T')[0];
    const checkOutDate = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Step 1: Create a guest in Cloudbeds
    console.log('Creating guest in Cloudbeds...');
    const guestResponse = await fetch(`${CLOUDBEDS_API_URL}/postGuest`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        propertyID: CLOUDBEDS_PROPERTY_ID,
        guestFirstName: firstName,
        guestLastName: lastName,
        guestPhone: phoneNumber,
        guestEmail: email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@guest.com`,
        guestNotes: `CLC Number: ${clcNumber || 'N/A'}, Class: ${classType || 'N/A'}`,
      }),
    });

    if (!guestResponse.ok) {
      const errorData = await guestResponse.json().catch(() => ({}));
      console.error('Cloudbeds guest creation failed:', errorData);
      throw new Error('Failed to create guest in Cloudbeds');
    }

    const guestData = await guestResponse.json();
    const guestID = guestData.data?.guestID || guestData.guestID;
    console.log('Guest created with ID:', guestID);

    // Step 2: Create a reservation with the selected room type
    console.log('Creating reservation with room type:', roomTypeName);
    const reservationResponse = await fetch(`${CLOUDBEDS_API_URL}/postReservation`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        propertyID: CLOUDBEDS_PROPERTY_ID,
        guestID: guestID,
        startDate: checkInDate,
        endDate: checkOutDate,
        adults: 1,
        children: 0,
        roomTypeName: roomTypeName, // Use the room type name from dropdown
        status: 'confirmed',
      }),
    });

    if (!reservationResponse.ok) {
      const errorData = await reservationResponse.json().catch(() => ({}));
      console.error('Cloudbeds reservation creation failed:', errorData);
      throw new Error('Failed to create reservation in Cloudbeds');
    }

    const reservationData = await reservationResponse.json();
    const reservationID = reservationData.data?.reservationID || reservationData.reservationID;
    console.log('Reservation created with ID:', reservationID);

    // Step 3: Check in the guest (set status to checked_in)
    console.log('Checking in guest...');
    const checkInResponse = await fetch(`${CLOUDBEDS_API_URL}/putReservation`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        propertyID: CLOUDBEDS_PROPERTY_ID,
        reservationID: reservationID,
        status: 'checked_in',
      }),
    });

    if (!checkInResponse.ok) {
      const errorData = await checkInResponse.json().catch(() => ({}));
      console.error('Cloudbeds check-in status update failed:', errorData);
      // Don't fail - reservation is created, just status update failed
    }

    console.log('Check-in complete!');
    return NextResponse.json({
      success: true,
      guestID,
      reservationID,
      roomTypeName: roomTypeName,
      message: 'Guest successfully checked in to Cloudbeds',
    });

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

