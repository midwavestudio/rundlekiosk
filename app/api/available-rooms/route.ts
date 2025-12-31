import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

    console.log('Available Rooms API called:', {
      hasApiKey: !!CLOUDBEDS_API_KEY,
      hasPropertyId: !!CLOUDBEDS_PROPERTY_ID,
      propertyId: CLOUDBEDS_PROPERTY_ID,
    });

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      console.warn('Cloudbeds API credentials not configured');
      return NextResponse.json({
        success: true,
        rooms: [
          { roomTypeID: '1', roomTypeName: 'Standard Room', roomName: 'Standard Room' },
          { roomTypeID: '2', roomTypeName: 'Deluxe Room', roomName: 'Deluxe Room' },
        ],
        mockMode: true,
      });
    }

    // Fetch Room Types (Accommodation Types) from Cloudbeds
    let roomTypes = [];
    let apiError = null;

    try {
      console.log('Calling Cloudbeds getRoomTypes...');
      const roomTypesUrl = `${CLOUDBEDS_API_URL}/getRoomTypes?propertyID=${CLOUDBEDS_PROPERTY_ID}`;
      console.log('URL:', roomTypesUrl);

      const response = await fetch(roomTypesUrl, {
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
      
      // Cloudbeds returns room types in data.data or data array
      roomTypes = data.data || data;
      console.log('Extracted room types:', roomTypes.length);

    } catch (error: any) {
      console.error('Error fetching room types from Cloudbeds:', error);
      apiError = error.message;
    }

    // If no room types found, return mock data
    if (!roomTypes || roomTypes.length === 0) {
      console.warn('No room types found from Cloudbeds, returning mock data');
      return NextResponse.json({
        success: true,
        rooms: [
          { roomTypeID: '1', roomTypeName: 'Standard Room', roomName: 'Standard Room' },
          { roomTypeID: '2', roomTypeName: 'Deluxe Room', roomName: 'Deluxe Room' },
          { roomTypeID: '3', roomTypeName: 'Suite', roomName: 'Suite' },
        ],
        mockMode: true,
        reason: apiError || 'No room types returned from Cloudbeds API',
      });
    }

    // Format room types for the dropdown
    const formattedRooms = roomTypes.map((roomType: any) => ({
      roomTypeID: roomType.roomTypeID || roomType.id,
      roomTypeName: roomType.roomTypeName || roomType.name || 'Unknown Room Type',
      roomName: roomType.roomTypeName || roomType.name || 'Unknown Room Type',
      maxGuests: roomType.maxGuests || 2,
      propertyRoomTypeID: roomType.propertyRoomTypeID,
    }));

    console.log('Returning formatted room types:', formattedRooms);

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
        { roomTypeID: '1', roomTypeName: 'Standard Room', roomName: 'Standard Room' },
        { roomTypeID: '2', roomTypeName: 'Deluxe Room', roomName: 'Deluxe Room' },
        { roomTypeID: '3', roomTypeName: 'Suite', roomName: 'Suite' },
      ],
      mockMode: true,
      error: error.message,
    });
  }
}
