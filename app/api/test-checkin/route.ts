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

      // Step 2: Get TYE rateID for this room type
      let tyeRateID = null;
      let tyeRateData = null;
      const step2: any = {
        step: 2,
        action: 'getRatePlans (find TYE rate)',
        url: '',
        status: 0,
        response: '',
        parsed: null as any,
        tyeRateFound: false,
      };
      
      try {
        const ratesUrl = `${CLOUDBEDS_API_URL}/getRatePlans?propertyID=${CLOUDBEDS_PROPERTY_ID}&startDate=${checkInDate}&endDate=${checkOutDate}`;
        step2.url = ratesUrl;
        const ratesResponse = await fetch(ratesUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
            'Content-Type': 'application/json',
          },
        });
        
        step2.status = ratesResponse.status;
        const ratesText = await ratesResponse.text();
        step2.response = ratesText;
        step2.parsed = (() => {
          try {
            return JSON.parse(ratesText);
          } catch {
            return null;
          }
        })();
        
        if (ratesResponse.ok && step2.parsed?.success && step2.parsed.data) {
          // Find TYE rate (ratePlanID: 227753) for this specific room type
          const tyeRate = step2.parsed.data.find((rate: any) => 
            rate.ratePlanID === '227753' && 
            rate.roomTypeID === roomTypeID
          );
          if (tyeRate) {
            tyeRateID = tyeRate.rateID;
            tyeRateData = tyeRate;
            step2.tyeRateFound = true;
            step2.tyeRateID = tyeRateID;
            step2.tyeRateData = tyeRate;
            step2.roomsAvailable = tyeRate.roomsAvailable;
          }
        }
      } catch (error: any) {
        step2.error = error.message;
        console.warn('Could not fetch TYE rate:', error);
      }
      
      results.steps.push(step2);

      if (!tyeRateID) {
        results.success = false;
        results.error = 'TYE rate not found for this room type';
        results.message = `TYE rate not available for ${roomTypeName} on ${checkInDate}. Please contact staff.`;
        return NextResponse.json(results);
      }

      if (tyeRateData && tyeRateData.roomsAvailable === 0) {
        results.success = false;
        results.error = 'TYE rate not available - no rooms available';
        results.message = `TYE rate exists but no rooms available for ${roomTypeName} on ${checkInDate}. Please select a different room.`;
        return NextResponse.json(results);
      }

      // Step 3: Create reservation with guest info (creates both guest + reservation)
      // IMPORTANT: v1.2 API requires application/x-www-form-urlencoded format
      // with nested array structure for adults/children per room type
      // Format based on Cloudbeds developer example
      const reservationParams = new URLSearchParams();
      reservationParams.append('propertyID', CLOUDBEDS_PROPERTY_ID || '');
      reservationParams.append('startDate', checkInDate);
      reservationParams.append('endDate', checkOutDate);
      reservationParams.append('guestFirstName', firstName);
      reservationParams.append('guestLastName', lastName);
      reservationParams.append('guestCountry', 'US'); // United States - required parameter
      reservationParams.append('guestZip', '00000'); // Required parameter - default zip
      reservationParams.append('guestEmail', `${firstName.toLowerCase()}.${lastName.toLowerCase()}@guest.com`);
      reservationParams.append('guestPhone', phoneNumber);
      reservationParams.append('paymentMethod', 'CLC'); // CLC payment method for BNSF crew
      reservationParams.append('roomRateID', tyeRateID); // TYE rate ID for this specific room type
      // Nested array structure for rooms, adults, and children per room type
      reservationParams.append('rooms[0][roomTypeID]', roomTypeID || '');
      reservationParams.append('rooms[0][quantity]', '1');
      reservationParams.append('adults[0][roomTypeID]', roomTypeID || '');
      reservationParams.append('adults[0][quantity]', '1');
      reservationParams.append('children[0][roomTypeID]', roomTypeID || '');
      reservationParams.append('children[0][quantity]', '0');
      reservationParams.append('sourceID', 's-945658-1'); // TYE source (primary source requires -1)

      const step3: any = {
        step: 3,
        action: 'postReservation (create guest + reservation)',
        payload: Object.fromEntries(reservationParams),
        status: 0,
        response: '',
        parsed: null as any,
      };
      results.steps.push(step3);

      const reservationResponse = await fetch(`${CLOUDBEDS_API_URL}/postReservation`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: reservationParams.toString(),
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
      const guestID = reservationData.data?.guestID || reservationData.guestID;
      
      if (!reservationID) {
        results.success = false;
        results.error = 'Failed at step 3: No reservationID returned';
        return NextResponse.json(results);
      }
      
      results.reservationID = reservationID;
      results.guestID = guestID;

      // Step 4: Assign specific room
      const assignParams = new URLSearchParams();
      assignParams.append('propertyID', CLOUDBEDS_PROPERTY_ID || '');
      assignParams.append('reservationID', String(reservationID));
      assignParams.append('newRoomID', roomID);

      const step4: any = {
        step: 4,
        action: 'postRoomAssign',
        payload: Object.fromEntries(assignParams),
        status: 0,
        response: '',
        parsed: null as any,
      };
      results.steps.push(step3);

      const assignResponse = await fetch(`${CLOUDBEDS_API_URL}/postRoomAssign`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: assignParams.toString(),
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
      const checkInParams = new URLSearchParams();
      checkInParams.append('propertyID', CLOUDBEDS_PROPERTY_ID || '');
      checkInParams.append('reservationID', String(reservationID));
      checkInParams.append('status', 'checked_in');

      const step5: any = {
        step: 5,
        action: 'putReservation (check-in)',
        payload: Object.fromEntries(checkInParams),
        status: 0,
        response: '',
        parsed: null as any,
      };
      results.steps.push(step4);

      const checkInResponse = await fetch(`${CLOUDBEDS_API_URL}/putReservation`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: checkInParams.toString(),
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
