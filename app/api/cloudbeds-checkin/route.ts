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

    // Step 1: Get the room details to find the room type and roomID
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
        throw new Error(`Room ${roomName} not found`);
      }
    }

    // Step 2: Create reservation with guest info (creates both guest and reservation)
    // IMPORTANT: v1.2 API requires application/x-www-form-urlencoded format
    // with nested array structure for adults/children per room type
    // Format based on Cloudbeds developer example
    console.log('Creating reservation with room type:', roomTypeName, 'roomTypeID:', roomTypeID);
    const reservationParams = new URLSearchParams();
    reservationParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    reservationParams.append('startDate', checkInDate);
    reservationParams.append('endDate', checkOutDate);
    reservationParams.append('guestFirstName', firstName);
    reservationParams.append('guestLastName', lastName);
    reservationParams.append('guestCountry', 'US'); // United States - required parameter
    reservationParams.append('guestZip', '00000'); // Required parameter - default zip
    reservationParams.append('guestEmail', email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@guest.com`);
    reservationParams.append('guestPhone', phoneNumber || '000-000-0000');
    reservationParams.append('paymentMethod', 'CLC'); // CLC payment method for BNSF crew
    reservationParams.append('rateID', 'TYE'); // TYE rate for BNSF crew lodging
    // Nested array structure for rooms, adults, and children per room type
    reservationParams.append('rooms[0][roomTypeID]', roomTypeID || '');
    reservationParams.append('rooms[0][quantity]', '1');
    reservationParams.append('adults[0][roomTypeID]', roomTypeID || '');
    reservationParams.append('adults[0][quantity]', '1');
    reservationParams.append('children[0][roomTypeID]', roomTypeID || '');
    reservationParams.append('children[0][quantity]', '0');
    reservationParams.append('sourceID', 's-2-1'); // Walk-in source (TYE)
    
    const reservationResponse = await fetch(`${CLOUDBEDS_API_URL}/postReservation`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: reservationParams.toString(),
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
    const guestID = reservationData.data?.guestID || reservationData.guestID;
    if (!reservationID) {
      throw new Error('No reservationID returned from Cloudbeds');
    }
    console.log('Reservation created with ID:', reservationID, 'guestID:', guestID);

    // Step 3: Assign the specific room to the reservation
    console.log('Assigning room ID:', actualRoomID, 'roomName:', roomName);
    
    const assignParams = new URLSearchParams();
    assignParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    assignParams.append('reservationID', String(reservationID));
    if (actualRoomID) {
      assignParams.append('newRoomID', actualRoomID);
    } else {
      assignParams.append('roomName', roomName);
    }
    
    const roomAssignResponse = await fetch(`${CLOUDBEDS_API_URL}/postRoomAssign`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: assignParams.toString(),
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

    // Step 4: Check in the guest (set status to checked_in)
    console.log('Checking in guest...');
    const checkInParams = new URLSearchParams();
    checkInParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    checkInParams.append('reservationID', String(reservationID));
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

