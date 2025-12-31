import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const checkInDate = searchParams.get('checkInDate') || new Date().toISOString().split('T')[0];
    const checkOutDate = searchParams.get('checkOutDate') || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

    console.log('Available Rooms API called:', {
      checkInDate,
      checkOutDate,
      hasApiKey: !!CLOUDBEDS_API_KEY,
      hasPropertyId: !!CLOUDBEDS_PROPERTY_ID,
    });

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      console.warn('Cloudbeds API credentials not configured');
      // Return mock rooms for testing
      return NextResponse.json({
        success: true,
        rooms: [
          { roomID: '101', roomName: '101', roomTypeName: 'Standard Room' },
          { roomID: '102', roomName: '102', roomTypeName: 'Standard Room' },
          { roomID: '201', roomName: '201', roomTypeName: 'Deluxe Room' },
          { roomID: '202', roomName: '202', roomTypeName: 'Deluxe Room' },
        ],
        mockMode: true,
      });
    }

    // Try to fetch available (unassigned) rooms from Cloudbeds
    let rooms = [];
    let apiError = null;

    try {
      console.log('Calling Cloudbeds getRoomsUnassigned...');
      const unassignedUrl = `${CLOUDBEDS_API_URL}/getRoomsUnassigned?propertyID=${CLOUDBEDS_PROPERTY_ID}&checkIn=${checkInDate}&checkOut=${checkOutDate}`;
      console.log('URL:', unassignedUrl);

      const response = await fetch(unassignedUrl, {
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
      
      rooms = data.data || data.rooms || [];
      console.log('Extracted rooms:', rooms.length);

      // If no unassigned rooms found, try to get ALL rooms
      if (!rooms || rooms.length === 0) {
        console.log('No unassigned rooms found, fetching all rooms...');
        const allRoomsUrl = `${CLOUDBEDS_API_URL}/getRooms?propertyID=${CLOUDBEDS_PROPERTY_ID}`;
        console.log('All rooms URL:', allRoomsUrl);

        const allRoomsResponse = await fetch(allRoomsUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        if (allRoomsResponse.ok) {
          const allRoomsData = await allRoomsResponse.json();
          console.log('All rooms data:', JSON.stringify(allRoomsData, null, 2));
          rooms = allRoomsData.data || allRoomsData.rooms || [];
          console.log('Total rooms found:', rooms.length);
        }
      }
    } catch (error: any) {
      console.error('Error fetching rooms from Cloudbeds:', error);
      apiError = error.message;
    }

    // If still no rooms, return mock data with explanation
    if (!rooms || rooms.length === 0) {
      console.warn('No rooms found from Cloudbeds, returning mock data');
      return NextResponse.json({
        success: true,
        rooms: [
          { roomID: '101', roomName: '101', roomTypeName: 'Standard Room' },
          { roomID: '102', roomName: '102', roomTypeName: 'Standard Room' },
          { roomID: '103', roomName: '103', roomTypeName: 'Standard Room' },
          { roomID: '201', roomName: '201', roomTypeName: 'Deluxe Room' },
          { roomID: '202', roomName: '202', roomTypeName: 'Deluxe Room' },
          { roomID: '203', roomName: '203', roomTypeName: 'Deluxe Room' },
        ],
        mockMode: true,
        reason: apiError || 'No rooms returned from Cloudbeds API',
      });
    }

    const formattedRooms = rooms.map((room: any) => ({
      roomID: room.roomID || room.id || room.roomName,
      roomName: room.roomName || room.name || room.roomID,
      roomTypeName: room.roomTypeName || room.roomType || room.type || 'Standard Room',
    }));

    console.log('Returning formatted rooms:', formattedRooms);

    return NextResponse.json({
      success: true,
      rooms: formattedRooms,
      count: formattedRooms.length,
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
        { roomID: '103', roomName: '103', roomTypeName: 'Standard Room' },
        { roomID: '201', roomName: '201', roomTypeName: 'Deluxe Room' },
        { roomID: '202', roomName: '202', roomTypeName: 'Deluxe Room' },
        { roomID: '203', roomName: '203', roomTypeName: 'Deluxe Room' },
      ],
      mockMode: true,
      error: error.message,
    });
  }
}
