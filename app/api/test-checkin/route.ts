import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { firstName, lastName, phoneNumber, roomName } = body;

    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

    const today = new Date();
    const checkInDate = today.toISOString().split('T')[0];
    const checkOutDate = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const results: any = {
      input: body,
      config: {
        hasApiKey: !!CLOUDBEDS_API_KEY,
        propertyId: CLOUDBEDS_PROPERTY_ID,
        dates: { checkInDate, checkOutDate },
      },
      steps: [],
    };

    // Step 1: Create guest
    try {
      // Try form-data format for postGuest
      const guestParams = new URLSearchParams({
        propertyID: CLOUDBEDS_PROPERTY_ID,
        guestFirstName: firstName,
        guestLastName: lastName,
        guestPhone: phoneNumber,
        guestEmail: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@guest.com`,
      });

      results.steps.push({
        step: 1,
        action: 'postGuest',
        payload: Object.fromEntries(guestParams),
      });

      const guestResponse = await fetch(`${CLOUDBEDS_API_URL}/postGuest`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: guestParams.toString(),
      });

      const guestText = await guestResponse.text();
      results.steps[0].status = guestResponse.status;
      results.steps[0].response = guestText;
      results.steps[0].parsed = (() => {
        try {
          return JSON.parse(guestText);
        } catch {
          return null;
        }
      })();

      if (!guestResponse.ok) {
        results.error = 'Failed at step 1: postGuest';
        return NextResponse.json(results);
      }

      const guestData = JSON.parse(guestText);
      const guestID = guestData.data?.guestID || guestData.guestID;
      results.guestID = guestID;

      // Step 2: Get rooms to find room details
      const roomsResponse = await fetch(`${CLOUDBEDS_API_URL}/getRooms?propertyID=${CLOUDBEDS_PROPERTY_ID}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      const roomsText = await roomsResponse.text();
      const roomsData = JSON.parse(roomsText);

      let rooms = [];
      if (roomsData.data && Array.isArray(roomsData.data) && roomsData.data.length > 0 && roomsData.data[0].rooms) {
        rooms = roomsData.data[0].rooms;
      }

      const selectedRoom = rooms.find((r: any) => r.roomID === roomName || r.roomName === roomName);
      
      results.steps.push({
        step: 2,
        action: 'getRooms (find room details)',
        searchedFor: roomName,
        foundRoom: selectedRoom,
        totalRooms: rooms.length,
      });

      if (!selectedRoom) {
        results.error = 'Room not found';
        return NextResponse.json(results);
      }

      const roomTypeName = selectedRoom.roomTypeName;
      const roomTypeID = selectedRoom.roomTypeID;
      const roomID = selectedRoom.roomID;

      // Step 3: Create reservation
      const reservationParams = new URLSearchParams({
        propertyID: CLOUDBEDS_PROPERTY_ID,
        guestID: guestID.toString(),
        startDate: checkInDate,
        endDate: checkOutDate,
        adults: '1',
        children: '0',
        roomTypeName: roomTypeName,
        status: 'confirmed',
      });

      results.steps.push({
        step: 3,
        action: 'postReservation',
        payload: Object.fromEntries(reservationParams),
      });

      const reservationResponse = await fetch(`${CLOUDBEDS_API_URL}/postReservation`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: reservationParams.toString(),
      });

      const reservationText = await reservationResponse.text();
      results.steps[2].status = reservationResponse.status;
      results.steps[2].response = reservationText;
      results.steps[2].parsed = (() => {
        try {
          return JSON.parse(reservationText);
        } catch {
          return null;
        }
      })();

      if (!reservationResponse.ok) {
        results.error = 'Failed at step 3: postReservation';
        return NextResponse.json(results);
      }

      const reservationData = JSON.parse(reservationText);
      const reservationID = reservationData.data?.reservationID || reservationData.reservationID;
      results.reservationID = reservationID;

      // Step 4: Assign room
      const assignParams = new URLSearchParams({
        propertyID: CLOUDBEDS_PROPERTY_ID,
        reservationID: reservationID.toString(),
        roomID: roomID,
      });

      results.steps.push({
        step: 4,
        action: 'postRoomAssign',
        payload: Object.fromEntries(assignParams),
      });

      const assignResponse = await fetch(`${CLOUDBEDS_API_URL}/postRoomAssign`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: assignParams.toString(),
      });

      const assignText = await assignResponse.text();
      results.steps[3].status = assignResponse.status;
      results.steps[3].response = assignText;
      results.steps[3].parsed = (() => {
        try {
          return JSON.parse(assignText);
        } catch {
          return null;
        }
      })();

      // Step 5: Check in
      const checkInParams = new URLSearchParams({
        propertyID: CLOUDBEDS_PROPERTY_ID,
        reservationID: reservationID.toString(),
        status: 'checked_in',
      });

      results.steps.push({
        step: 5,
        action: 'putReservation (check-in)',
        payload: Object.fromEntries(checkInParams),
      });

      const checkInResponse = await fetch(`${CLOUDBEDS_API_URL}/putReservation`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: checkInParams.toString(),
      });

      const checkInText = await checkInResponse.text();
      results.steps[4].status = checkInResponse.status;
      results.steps[4].response = checkInText;
      results.steps[4].parsed = (() => {
        try {
          return JSON.parse(checkInText);
        } catch {
          return null;
        }
      })();

      results.success = true;
      results.message = 'All steps completed';
      
    } catch (error: any) {
      results.error = error.message;
      results.stack = error.stack;
    }

    return NextResponse.json(results);
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack,
    });
  }
}
