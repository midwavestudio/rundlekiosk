import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const checkInDate = searchParams.get('checkInDate') || new Date().toISOString().split('T')[0];
    const checkOutDate = searchParams.get('checkOutDate') || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

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

    // Fetch available (unassigned) rooms from Cloudbeds
    const response = await fetch(`${CLOUDBEDS_API_URL}/getRoomsUnassigned?propertyID=${CLOUDBEDS_PROPERTY_ID}&checkIn=${checkInDate}&checkOut=${checkOutDate}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Cloudbeds get rooms failed:', errorData);
      throw new Error('Failed to fetch available rooms from Cloudbeds');
    }

    const data = await response.json();
    const rooms = data.data || [];

    return NextResponse.json({
      success: true,
      rooms: rooms.map((room: any) => ({
        roomID: room.roomID,
        roomName: room.roomName,
        roomTypeName: room.roomTypeName || 'Standard Room',
      })),
    });

  } catch (error: any) {
    console.error('Get available rooms error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to fetch available rooms',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}
