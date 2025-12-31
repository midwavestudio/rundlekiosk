import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log('Available Rooms API called:', {
      hasApiKey: !!CLOUDBEDS_API_KEY,
      hasPropertyId: !!CLOUDBEDS_PROPERTY_ID,
      propertyId: CLOUDBEDS_PROPERTY_ID,
      checkIn: today,
      checkOut: tomorrow,
    });

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      console.warn('Cloudbeds API credentials not configured');
      return NextResponse.json({
        success: true,
        rooms: [
          { roomID: '101', roomName: '101', roomTypeName: 'Standard Room' },
          { roomID: '102', roomName: '102', roomTypeName: 'Standard Room' },
          { roomID: '103', roomName: '103', roomTypeName: 'Deluxe Room' },
        ],
        mockMode: true,
      });
    }

    // Step 1: Get all reservations for today to find which rooms are occupied
    let occupiedRoomIDs = new Set<string>();
    
    try {
      console.log('Fetching reservations to find occupied rooms...');
      const reservationsUrl = `${CLOUDBEDS_API_URL}/getReservations?propertyID=${CLOUDBEDS_PROPERTY_ID}&checkInFrom=${today}&checkInTo=${today}`;
      console.log('Reservations URL:', reservationsUrl);

      const reservationsResponse = await fetch(reservationsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (reservationsResponse.ok) {
        const reservationsData = await reservationsResponse.json();
        console.log('Reservations data:', JSON.stringify(reservationsData, null, 2));
        
        const reservations = reservationsData.data || [];
        
        // Extract occupied room IDs from reservations
        reservations.forEach((reservation: any) => {
          if (reservation.rooms && Array.isArray(reservation.rooms)) {
            reservation.rooms.forEach((room: any) => {
              if (room.roomID) {
                occupiedRoomIDs.add(room.roomID.toString());
              }
            });
          }
        });
        
        console.log('Occupied room IDs:', Array.from(occupiedRoomIDs));
      }
    } catch (error) {
      console.warn('Could not fetch reservations, will show all rooms:', error);
    }

    // Step 2: Get all physical rooms from the property
    let allRooms = [];
    let apiError = null;

    try {
      console.log('Calling Cloudbeds getRooms...');
      const roomsUrl = `${CLOUDBEDS_API_URL}/getRooms?propertyID=${CLOUDBEDS_PROPERTY_ID}`;
      console.log('URL:', roomsUrl);

      const response = await fetch(roomsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Response body:', responseText);

      if (!response.ok) {
        throw new Error(`Cloudbeds API returned ${response.status}: ${responseText}`);
      }

      const data = JSON.parse(responseText);
      console.log('Parsed data:', JSON.stringify(data, null, 2));
      
      allRooms = data.data || data;
      console.log('Total rooms found:', allRooms.length);

    } catch (error: any) {
      console.error('Error fetching rooms from Cloudbeds:', error);
      apiError = error.message;
    }

    // If no rooms found, return mock data
    if (!allRooms || allRooms.length === 0) {
      console.warn('No rooms found from Cloudbeds, returning mock data');
      return NextResponse.json({
        success: true,
        rooms: [
          { roomID: '101', roomName: '101', roomTypeName: 'Standard Room' },
          { roomID: '102', roomName: '102', roomTypeName: 'Standard Room' },
          { roomID: '103', roomName: '103', roomTypeName: 'Deluxe Room' },
          { roomID: '201', roomName: '201', roomTypeName: 'Deluxe Room' },
        ],
        mockMode: true,
        reason: apiError || 'No rooms returned from Cloudbeds API',
      });
    }

    // Step 3: Filter out occupied rooms to show only available ones
    const availableRooms = allRooms.filter((room: any) => {
      const roomID = (room.roomID || room.id)?.toString();
      return roomID && !occupiedRoomIDs.has(roomID);
    });

    console.log('Available rooms after filtering:', availableRooms.length);

    // Format rooms for the dropdown
    const formattedRooms = availableRooms.map((room: any) => ({
      roomID: room.roomID || room.id,
      roomName: room.roomName || room.name || `Room ${room.roomID || room.id}`,
      roomTypeName: room.roomTypeName || room.roomType || 'Standard Room',
    }));

    console.log('Returning formatted rooms:', formattedRooms);

    return NextResponse.json({
      success: true,
      rooms: formattedRooms,
      count: formattedRooms.length,
      totalRooms: allRooms.length,
      occupiedCount: occupiedRoomIDs.size,
    });

  } catch (error: any) {
    console.error('Get available rooms error:', error);
    console.error('Error stack:', error.stack);
    
    // Return mock rooms on error
    return NextResponse.json({
      success: true,
      rooms: [
        { roomID: '101', roomName: '101', roomTypeName: 'Standard Room' },
        { roomID: '102', roomName: '102', roomTypeName: 'Standard Room' },
        { roomID: '103', roomName: '103', roomTypeName: 'Deluxe Room' },
        { roomID: '201', roomName: '201', roomTypeName: 'Deluxe Room' },
      ],
      mockMode: true,
      error: error.message,
    });
  }
}
