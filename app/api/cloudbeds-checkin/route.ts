import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { firstName, lastName, phoneNumber, roomName, clcNumber, classType, email, reservationID: existingReservationID } = body;

    console.log('Check-in API called with:', { firstName, lastName, roomName, clcNumber, classType });

    // Validate required fields
    if (!firstName || !lastName || !roomName) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // If reservationID is provided, update existing reservation
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
        roomName: roomName,
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

    // Step 2: Get the room details to find the room type and roomID
    console.log('Fetching room details for room:', roomName);
    const roomsResponse = await fetch(`${CLOUDBEDS_API_URL}/getRooms?propertyID=${CLOUDBEDS_PROPERTY_ID}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    let roomTypeName = 'Standard Room'; // Default fallback
    let roomTypeID = null;
    let actualRoomID = null;
    
    if (roomsResponse.ok) {
      const roomsData = await roomsResponse.json();
      console.log('Rooms data structure:', JSON.stringify(roomsData, null, 2));
      
      // Handle nested structure: data[0].rooms
      let rooms = [];
      if (roomsData.data && Array.isArray(roomsData.data) && roomsData.data.length > 0 && roomsData.data[0].rooms) {
        rooms = roomsData.data[0].rooms;
      } else {
        rooms = roomsData.data || [];
      }
      
      console.log('Searching for room:', roomName, 'in', rooms.length, 'rooms');
      
      const selectedRoom = rooms.find((r: any) => {
        const matches = (r.roomName === roomName || r.name === roomName || r.roomID === roomName || r.id === roomName);
        if (matches) {
          console.log('Found matching room:', r);
        }
        return matches;
      });
      
      if (selectedRoom) {
        roomTypeName = selectedRoom.roomTypeName || selectedRoom.roomType || 'Standard Room';
        roomTypeID = selectedRoom.roomTypeID || selectedRoom.roomType_id;
        actualRoomID = selectedRoom.roomID || selectedRoom.id;
        console.log('Found room details:', { roomTypeName, roomTypeID, actualRoomID });
      } else {
        console.warn('Room not found:', roomName);
      }
    }

    // Step 3: Create a reservation with the room type
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
        roomTypeName: roomTypeName,
        status: 'confirmed',
      }),
    });

    if (!reservationResponse.ok) {
      const errorData = await reservationResponse.json().catch(() => ({}));
      console.error('Cloudbeds reservation creation failed:', errorData);
      throw new Error(`Failed to create reservation in Cloudbeds: ${errorData.message || 'Unknown error'}`);
    }

    const reservationData = await reservationResponse.json();
    if (!reservationData.success) {
      console.error('Reservation creation returned success:false:', reservationData);
      throw new Error(`Reservation creation failed: ${reservationData.message || 'Unknown error'}`);
    }
    
    const reservationID = reservationData.data?.reservationID || reservationData.reservationID;
    if (!reservationID) {
      throw new Error('No reservationID returned from Cloudbeds');
    }
    console.log('Reservation created with ID:', reservationID);

    // Step 4: Assign the specific room to the reservation
    console.log('Assigning room ID:', actualRoomID, 'roomName:', roomName);
    
    const assignPayload: any = {
      propertyID: CLOUDBEDS_PROPERTY_ID,
      reservationID: reservationID,
    };
    
    // Use newRoomID parameter (required by Cloudbeds API) if we have it, otherwise fall back to roomName
    if (actualRoomID) {
      assignPayload.newRoomID = actualRoomID;
    } else {
      assignPayload.roomName = roomName;
    }
    
    console.log('Room assign payload:', JSON.stringify(assignPayload));
    
    const roomAssignResponse = await fetch(`${CLOUDBEDS_API_URL}/postRoomAssign`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(assignPayload),
    });

    if (!roomAssignResponse.ok) {
      const assignErrorText = await roomAssignResponse.text();
      console.error('Room assignment failed:', roomAssignResponse.status, assignErrorText);
      throw new Error(`Failed to assign room: ${assignErrorText}`);
    }
    
    const assignResult = await roomAssignResponse.json();
    if (!assignResult.success) {
      console.error('Room assignment returned success:false:', assignResult);
      throw new Error(`Room assignment failed: ${assignResult.message || 'Unknown error'}`);
    }
    console.log('Room assigned successfully:', assignResult);

    // Step 5: Check in the guest (set status to checked_in)
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
      throw new Error(`Failed to check in guest: ${errorData.message || 'Unknown error'}`);
    }

    const checkInData = await checkInResponse.json();
    if (!checkInData.success) {
      console.error('Check-in returned success:false:', checkInData);
      throw new Error(`Check-in failed: ${checkInData.message || 'Unknown error'}`);
    }

    console.log('Check-in complete!');
    return NextResponse.json({
      success: true,
      guestID,
      reservationID,
      roomName: roomName,
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

