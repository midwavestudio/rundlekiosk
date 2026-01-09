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

    // Step 1: Get rooms to find room details (do this first)
    try {
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
        step: 1,
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

      // Step 2: Create guest
      const guestPayload = {
        propertyID: CLOUDBEDS_PROPERTY_ID,
        guestFirstName: firstName,
        guestLastName: lastName,
        guestPhone: phoneNumber,
        guestEmail: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@guest.com`,
        guestNotes: `Kiosk check-in on ${checkInDate}`,
      };

      const step2: any = {
        step: 2,
        action: 'postGuest (create guest)',
        payload: guestPayload,
        status: 0,
        response: '',
        parsed: null as any,
      };
      results.steps.push(step2);

      const guestResponse = await fetch(`${CLOUDBEDS_API_URL}/postGuest`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(guestPayload),
      });

      const guestText = await guestResponse.text();
      step2.status = guestResponse.status;
      step2.response = guestText;
      step2.parsed = (() => {
        try {
          return JSON.parse(guestText);
        } catch {
          return null;
        }
      })();

      if (!guestResponse.ok || !step2.parsed?.success) {
        results.success = false;
        results.error = 'Failed at step 2: postGuest';
        results.errorMessage = step2.parsed?.message || 'Unknown error creating guest';
        return NextResponse.json(results);
      }

      const guestData = JSON.parse(guestText);
      const guestID = guestData.data?.guestID || guestData.guestID;
      
      if (!guestID) {
        results.success = false;
        results.error = 'Failed at step 2: No guestID returned';
        return NextResponse.json(results);
      }
      
      results.guestID = guestID;

      // Step 3: Create reservation with the guest
      const reservationPayload = {
        propertyID: CLOUDBEDS_PROPERTY_ID,
        guestID: guestID,
        startDate: checkInDate,
        endDate: checkOutDate,
        adults: 1,
        children: 0,
        roomTypeName: roomTypeName,
        status: 'confirmed',
      };

      const step3: any = {
        step: 3,
        action: 'postReservation (create reservation)',
        payload: reservationPayload,
        status: 0,
        response: '',
        parsed: null as any,
      };
      results.steps.push(step3);

      const reservationResponse = await fetch(`${CLOUDBEDS_API_URL}/postReservation`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reservationPayload),
      });

      const reservationText = await reservationResponse.text();
      step3.status = reservationResponse.status;
      step3.response = reservationText;
      step3.parsed = (() => {
        try {
          return JSON.parse(reservationText);
        } catch {
          return null;
        }
      })();

      if (!reservationResponse.ok || !step3.parsed?.success) {
        results.success = false;
        results.error = 'Failed at step 3: postReservation';
        results.errorMessage = step3.parsed?.message || 'Unknown error creating reservation';
        return NextResponse.json(results);
      }

      const reservationData = JSON.parse(reservationText);
      const reservationID = reservationData.data?.reservationID || reservationData.reservationID;
      
      if (!reservationID) {
        results.success = false;
        results.error = 'Failed at step 3: No reservationID returned';
        return NextResponse.json(results);
      }
      
      results.reservationID = reservationID;

      // Step 4: Assign specific room
      const assignPayload = {
        propertyID: CLOUDBEDS_PROPERTY_ID,
        reservationID: reservationID,
        newRoomID: roomID,
      };

      const step4: any = {
        step: 4,
        action: 'postRoomAssign',
        payload: assignPayload,
        status: 0,
        response: '',
        parsed: null as any,
      };
      results.steps.push(step4);

      const assignResponse = await fetch(`${CLOUDBEDS_API_URL}/postRoomAssign`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(assignPayload),
      });

      const assignText = await assignResponse.text();
      step4.status = assignResponse.status;
      step4.response = assignText;
      step4.parsed = (() => {
        try {
          return JSON.parse(assignText);
        } catch {
          return null;
        }
      })();

      // Validate room assignment succeeded
      if (!assignResponse.ok || !step4.parsed?.success) {
        results.success = false;
        results.message = 'Room assignment failed at step 4';
        results.error = step4.parsed?.message || 'Failed to assign room to reservation';
        return NextResponse.json(results);
      }

      // Step 5: Check in
      const checkInPayload = {
        propertyID: CLOUDBEDS_PROPERTY_ID,
        reservationID: reservationID,
        status: 'checked_in',
      };

      const step5: any = {
        step: 5,
        action: 'putReservation (check-in)',
        payload: checkInPayload,
        status: 0,
        response: '',
        parsed: null as any,
      };
      results.steps.push(step5);

      const checkInResponse = await fetch(`${CLOUDBEDS_API_URL}/putReservation`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(checkInPayload),
      });

      const checkInText = await checkInResponse.text();
      step5.status = checkInResponse.status;
      step5.response = checkInText;
      step5.parsed = (() => {
        try {
          return JSON.parse(checkInText);
        } catch {
          return null;
        }
      })();

      // Validate check-in actually succeeded
      if (!checkInResponse.ok || !step5.parsed?.success) {
        results.success = false;
        results.message = 'Check-in failed at step 5';
        results.error = step5.parsed?.message || 'Failed to update reservation status to checked_in';
        return NextResponse.json(results);
      }

      results.success = true;
      results.message = 'Guest successfully checked in!';
      
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
