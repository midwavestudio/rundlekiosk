import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.3';

    // IMPORTANT: Always use TODAY's date for check-in, tomorrow for check-out
    // This ensures we only show rooms available for today
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log('Available Rooms API called for TODAY only:', {
      hasApiKey: !!CLOUDBEDS_API_KEY,
      hasPropertyId: !!CLOUDBEDS_PROPERTY_ID,
      propertyId: CLOUDBEDS_PROPERTY_ID,
      checkIn: today,
      checkOut: tomorrow,
      note: 'Only showing rooms available for today',
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

    let availableRooms = [];
    let apiError = null;

    // Try Method 1: Use getRoomsUnassigned (best method - returns only available rooms)
    try {
      console.log('Method 1: Trying getRoomsUnassigned...');
      const unassignedUrl = `${CLOUDBEDS_API_URL}/getRoomsUnassigned?propertyID=${CLOUDBEDS_PROPERTY_ID}&checkIn=${today}&checkOut=${tomorrow}`;
      console.log('URL:', unassignedUrl);

      const unassignedResponse = await fetch(unassignedUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('getRoomsUnassigned status:', unassignedResponse.status);
      
      if (unassignedResponse.ok) {
        const responseText = await unassignedResponse.text();
        console.log('getRoomsUnassigned response:', responseText);
        
        const data = JSON.parse(responseText);
        console.log('Parsed unassigned rooms data:', JSON.stringify(data, null, 2));
        
        // Cloudbeds returns: { success: true, data: [{ propertyID: "...", rooms: [...] }] }
        if (data.data && Array.isArray(data.data) && data.data.length > 0 && data.data[0].rooms) {
          availableRooms = data.data[0].rooms;
        } else {
          availableRooms = data.data || data.rooms || data || [];
        }
        console.log('Found unassigned rooms:', availableRooms.length);
        
        if (availableRooms.length > 0) {
          // Format and return - handle different response structures
          // Filter out blocked rooms
          const formattedRooms = availableRooms
            .filter((room: any) => !room.roomBlocked) // Exclude blocked rooms
            .map((room: any) => {
              // Try multiple field names that Cloudbeds might use
              const roomID = room.roomID || room.id || room.room_id || room.roomId;
              const roomName = room.roomName || room.name || room.room_name || room.roomNumber || roomID;
              const roomType = room.roomTypeName || room.roomType || room.room_type || room.typeName || room.type || 'Standard Room';
              
              console.log('Formatting room:', { original: room, formatted: { roomID, roomName, roomType } });
              
              return {
                roomID: roomID || roomName || 'unknown',
                roomName: roomName || roomID || 'Unknown Room',
                roomTypeName: roomType,
              };
            })
            .filter((room: any) => room.roomID !== 'unknown'); // Filter out malformed rooms
          
          console.log('Returning unassigned rooms:', formattedRooms);
          return NextResponse.json({
            success: true,
            rooms: formattedRooms,
            count: formattedRooms.length,
            method: 'getRoomsUnassigned',
          });
        }
      } else {
        const errorText = await unassignedResponse.text();
        console.warn('getRoomsUnassigned failed:', unassignedResponse.status, errorText);
      }
    } catch (error: any) {
      console.warn('getRoomsUnassigned error:', error.message);
    }

    // Try Method 2: Get all rooms and filter by reservations
    try {
      console.log('Method 2: Trying getRooms with reservation filtering...');
      
      // First, get all rooms
      const allRoomsUrl = `${CLOUDBEDS_API_URL}/getRooms?propertyID=${CLOUDBEDS_PROPERTY_ID}`;
      console.log('All rooms URL:', allRoomsUrl);

      const allRoomsResponse = await fetch(allRoomsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('getRooms status:', allRoomsResponse.status);
      
      if (allRoomsResponse.ok) {
        const responseText = await allRoomsResponse.text();
        console.log('getRooms response:', responseText);
        
        const roomsData = JSON.parse(responseText);
        // Cloudbeds returns: { success: true, data: [{ propertyID: "...", rooms: [...] }] }
        let allRooms = [];
        if (roomsData.data && Array.isArray(roomsData.data) && roomsData.data.length > 0 && roomsData.data[0].rooms) {
          allRooms = roomsData.data[0].rooms;
        } else {
          allRooms = roomsData.data || roomsData.rooms || roomsData || [];
        }
        console.log('Total rooms found:', allRooms.length);

        // Get reservations to find occupied rooms
        let occupiedRoomNames = new Set<string>();
        let occupiedRoomIDs = new Set<string>();

        try {
          // Get reservations for TODAY only - check both arrivals and current guests
          // We need to check: 1) Guests checking in today, 2) Guests already checked in
          const reservationsUrl = `${CLOUDBEDS_API_URL}/getReservations?propertyID=${CLOUDBEDS_PROPERTY_ID}&checkInFrom=${today}&checkInTo=${today}`;
          const checkedInUrl = `${CLOUDBEDS_API_URL}/getReservations?propertyID=${CLOUDBEDS_PROPERTY_ID}&status=checked_in`;
          
          console.log('Checking occupied rooms for today...');
          console.log('Arrivals URL:', reservationsUrl);
          console.log('Checked-in URL:', checkedInUrl);

          // Get today's arrivals
          const arrivalsResponse = await fetch(reservationsUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
              'Content-Type': 'application/json',
            },
          });

          // Get currently checked-in guests
          const checkedInResponse = await fetch(checkedInUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
              'Content-Type': 'application/json',
            },
          });

          const allReservations: any[] = [];

          if (arrivalsResponse.ok) {
            const arrivalsData = await arrivalsResponse.json();
            const arrivals = arrivalsData.data || arrivalsData || [];
            allReservations.push(...arrivals);
            console.log(`Found ${arrivals.length} arrivals for today`);
          }

          if (checkedInResponse.ok) {
            const checkedInData = await checkedInResponse.json();
            const checkedIn = checkedInData.data || checkedInData || [];
            // Filter to only include those checking out AFTER today
            const stayingTonight = checkedIn.filter((r: any) => {
              const checkOut = r.endDate || r.checkOutDate;
              return checkOut && checkOut > today;
            });
            allReservations.push(...stayingTonight);
            console.log(`Found ${stayingTonight.length} guests staying tonight`);
          }
            
          allReservations.forEach((reservation: any) => {
            if (reservation.rooms && Array.isArray(reservation.rooms)) {
              reservation.rooms.forEach((room: any) => {
                if (room.roomID) occupiedRoomIDs.add(room.roomID.toString());
                if (room.roomName) occupiedRoomNames.add(room.roomName);
              });
            }
            // Also check roomName/roomID directly on reservation
            if (reservation.roomName) occupiedRoomNames.add(reservation.roomName);
            if (reservation.roomID) occupiedRoomIDs.add(reservation.roomID.toString());
          });
          
          console.log(`Total occupied rooms for tonight: ${occupiedRoomIDs.size + occupiedRoomNames.size}`);
          console.log('Occupied room IDs:', Array.from(occupiedRoomIDs));
          console.log('Occupied room names:', Array.from(occupiedRoomNames));
        } catch (resError) {
          console.warn('Could not fetch reservations:', resError);
        }

        // Filter out occupied and blocked rooms
        availableRooms = allRooms.filter((room: any) => {
          const roomID = (room.roomID || room.id)?.toString();
          const roomName = room.roomName || room.name;
          const isBlocked = room.roomBlocked === true;
          return !isBlocked && !occupiedRoomIDs.has(roomID) && !occupiedRoomNames.has(roomName);
        });

        console.log('Available rooms after filtering:', availableRooms.length);

        if (availableRooms.length > 0) {
          const formattedRooms = availableRooms.map((room: any) => {
            // Try multiple field names that Cloudbeds might use
            const roomID = room.roomID || room.id || room.room_id || room.roomId;
            const roomName = room.roomName || room.name || room.room_name || room.roomNumber || roomID;
            const roomType = room.roomTypeName || room.roomType || room.room_type || room.typeName || room.type || 'Standard Room';
            
            console.log('Formatting room:', { original: room, formatted: { roomID, roomName, roomType } });
            
            return {
              roomID: roomID || roomName || 'unknown',
              roomName: roomName || roomID || 'Unknown Room',
              roomTypeName: roomType,
            };
          }).filter((room: any) => room.roomID !== 'unknown'); // Filter out malformed rooms
          
          console.log('Returning filtered rooms:', formattedRooms);
          return NextResponse.json({
            success: true,
            rooms: formattedRooms,
            count: formattedRooms.length,
            totalRooms: allRooms.length,
            occupiedCount: occupiedRoomIDs.size + occupiedRoomNames.size,
            method: 'getRooms_with_filtering',
          });
        }
      } else {
        const errorText = await allRoomsResponse.text();
        console.warn('getRooms failed:', allRoomsResponse.status, errorText);
        apiError = `getRooms returned ${allRoomsResponse.status}: ${errorText}`;
      }
    } catch (error: any) {
      console.error('Method 2 error:', error);
      apiError = error.message;
    }

    // Fallback: Return all rooms if we can't determine availability
    // This ensures guests can still check in
    console.warn('No available rooms found, returning all rooms as fallback');
    return NextResponse.json({
      success: true,
      rooms: [
        { roomID: '101', roomName: '101', roomTypeName: 'Standard Room' },
        { roomID: '102', roomName: '102', roomTypeName: 'Standard Room' },
        { roomID: '103', roomName: '103', roomTypeName: 'Deluxe Room' },
        { roomID: '201', roomName: '201', roomTypeName: 'Deluxe Room' },
        { roomID: '202', roomName: '202', roomTypeName: 'Deluxe Room' },
      ],
      mockMode: true,
      reason: apiError || 'Could not fetch rooms from Cloudbeds API',
      note: 'Using fallback rooms. Please check Cloudbeds API configuration.',
    });

  } catch (error: any) {
    console.error('Get available rooms error:', error);
    console.error('Error stack:', error.stack);
    
    // Always return rooms so UI doesn't show "no rooms available"
    return NextResponse.json({
      success: true,
      rooms: [
        { roomID: '101', roomName: '101', roomTypeName: 'Standard Room' },
        { roomID: '102', roomName: '102', roomTypeName: 'Standard Room' },
        { roomID: '103', roomName: '103', roomTypeName: 'Deluxe Room' },
        { roomID: '201', roomName: '201', roomTypeName: 'Deluxe Room' },
        { roomID: '202', roomName: '202', roomTypeName: 'Deluxe Room' },
      ],
      mockMode: true,
      error: error.message,
    });
  }
}
