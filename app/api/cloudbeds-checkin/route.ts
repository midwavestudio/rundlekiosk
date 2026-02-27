import { NextRequest, NextResponse } from 'next/server';

/** Returns YYYY-MM-DD in server local time (not UTC). Reservations must use today's local date. */
function getLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
    
    console.log('Check-in API configuration:', {
      hasApiKey: !!CLOUDBEDS_API_KEY,
      hasPropertyId: !!CLOUDBEDS_PROPERTY_ID,
      apiUrl: CLOUDBEDS_API_URL,
    });

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

    // Use LOCAL date for today/tomorrow so reservations are always for today (not UTC)
    const now = new Date();
    const checkInDate = getLocalDateStr(now);
    const checkOutDate = getLocalDateStr(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    console.log('Reservation dates (local):', { checkInDate, checkOutDate });

    // Step 1: Get the SELECTED room's details — we need its roomTypeID for postReservation
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
    let selectedRoomName: string | null = null; // e.g. "312", "200" for assign request
    
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
      const roomKey = String(roomName).trim();
      const selectedRoom = rooms.find((r: any) => {
        const idStr = r.roomID != null ? String(r.roomID) : '';
        const idAlt = r.id != null ? String(r.id) : '';
        const nameStr = r.roomName != null ? String(r.roomName) : '';
        const nameAlt = r.name != null ? String(r.name) : '';
        const matches = idStr === roomKey || idAlt === roomKey || nameStr === roomKey || nameAlt === roomKey;
        if (matches) {
          console.log('Found matching room:', r);
        }
        return matches;
      });
      
      if (selectedRoom) {
        roomTypeName = selectedRoom.roomTypeName || selectedRoom.roomType || 'Standard Room';
        roomTypeID = selectedRoom.roomTypeID || selectedRoom.roomType_id;
        actualRoomID = selectedRoom.roomID || selectedRoom.id;
        selectedRoomName = selectedRoom.roomName ?? selectedRoom.name ?? null;
        console.log('Found room details:', { roomTypeName, roomTypeID, actualRoomID, selectedRoomName });
      } else {
        console.warn('Room not found:', roomName);
        throw new Error(`Room ${roomName} not found`);
      }
    }

    // Step 2: Get rate for THIS room type from getRatePlans — we need rateID for postReservation
    // (e.g. Interior Queen + TYE → rateID 1594322; roomTypeID 517732. Must pass the pair that match the selected room.)
    let rateID = null;
    let ratePlanID = null;
    try {
      const ratesUrl = `${CLOUDBEDS_API_URL}/getRatePlans?propertyID=${CLOUDBEDS_PROPERTY_ID}&startDate=${checkInDate}&endDate=${checkOutDate}`;
      console.log('Fetching rates from:', ratesUrl);
      const ratesResponse = await fetch(ratesUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (ratesResponse.ok) {
        const ratesData = await ratesResponse.json();
        const rates = ratesData.data || ratesData.rates || ratesData || [];
        const roomTypeStr = String(roomTypeID);
        const roomTypeNum = Number(roomTypeID);
        
        // Any rate for this room type (for fallback)
        const ratesForRoomType = rates.filter((rate: any) => {
          const rtID = rate.roomTypeID ?? rate.room_type_id ?? rate.roomType_id;
          return (String(rtID) === roomTypeStr || Number(rtID) === roomTypeNum) &&
            (rate.roomsAvailable == null || rate.roomsAvailable > 0) &&
            !rate.roomBlocked;
        });
        
        // Prefer TYE rate (ratePlanID 227753) for this room type
        const tyeRate = ratesForRoomType.find((rate: any) => {
          const planID = String(rate.ratePlanID ?? rate.rate_plan_id ?? rate.ratePlan_id ?? '');
          return planID === '227753' || Number(planID) === 227753;
        });
        
        if (tyeRate) {
          rateID = tyeRate.rateID ?? tyeRate.rate_id ?? tyeRate.id;
          ratePlanID = tyeRate.ratePlanID ?? tyeRate.rate_plan_id ?? tyeRate.ratePlan_id ?? '227753';
          console.log('Using TYE rate for', roomTypeName, 'rateID:', rateID);
        } else if (ratesForRoomType.length > 0) {
          const fallback = ratesForRoomType[0];
          rateID = fallback.rateID ?? fallback.rate_id ?? fallback.id;
          ratePlanID = fallback.ratePlanID ?? fallback.rate_plan_id ?? fallback.ratePlan_id;
          console.log('TYE rate not available for', roomTypeName, '— using fallback rate:', rateID, fallback.name ?? fallback.rateName);
        } else {
          console.warn('No rates for room type:', roomTypeName, roomTypeID, 'rates count:', rates.length);
        }
      } else {
        const errorText = await ratesResponse.text();
        console.error('Failed to fetch rates:', ratesResponse.status, errorText);
      }
    } catch (error: any) {
      console.error('Error fetching rates:', error.message, error.stack);
    }

    if (!rateID && !ratePlanID) {
      throw new Error(`No rate available for ${roomTypeName}. Please contact staff.`);
    }

    // Step 3: Create reservation — pass roomTypeID and rateID that correspond to the SELECTED room
    // (from getRooms for the selected room, and getRatePlans for that room type — e.g. Interior Queen + TYE rate)
    const roomTypeIDStr = String(roomTypeID ?? '');
    const roomRateIDStr = rateID != null ? String(rateID) : (ratePlanID != null ? String(ratePlanID) : '');
    const postReservationRoomPayload = {
      'rooms[0][roomTypeID]': roomTypeIDStr,
      'rooms[0][quantity]': '1',
      'rooms[0][roomRateID]': roomRateIDStr,
      'adults[0][roomTypeID]': roomTypeIDStr,
      'adults[0][quantity]': '1',
      'children[0][roomTypeID]': roomTypeIDStr,
      'children[0][quantity]': '0',
    };
    console.log('postReservation room/rate (for selected room):', {
      roomTypeName,
      roomTypeID: roomTypeIDStr,
      roomRateID: roomRateIDStr,
      payload: postReservationRoomPayload,
    });

    const reservationParams = new URLSearchParams();
    reservationParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    reservationParams.append('startDate', checkInDate);
    reservationParams.append('endDate', checkOutDate);
    reservationParams.append('guestFirstName', firstName);
    reservationParams.append('guestLastName', lastName);
    reservationParams.append('guestCountry', 'US');
    reservationParams.append('guestZip', '00000');
    reservationParams.append('guestEmail', email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@guest.com`);
    reservationParams.append('guestPhone', phoneNumber || '000-000-0000');
    reservationParams.append('paymentMethod', 'CLC');

    reservationParams.append('rooms[0][roomTypeID]', roomTypeIDStr);
    reservationParams.append('rooms[0][quantity]', '1');
    if (roomRateIDStr) {
      reservationParams.append('rooms[0][roomRateID]', roomRateIDStr);
    }
    reservationParams.append('adults[0][roomTypeID]', roomTypeIDStr);
    reservationParams.append('adults[0][quantity]', '1');
    reservationParams.append('children[0][roomTypeID]', roomTypeIDStr);
    reservationParams.append('children[0][quantity]', '0');
    reservationParams.append('sourceID', 's-945658-1');

    console.log('Reservation params:', reservationParams.toString());
    
    const reservationResponse = await fetch(`${CLOUDBEDS_API_URL}/postReservation`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: reservationParams.toString(),
    });

    const responseText = await reservationResponse.text();
    console.log('Reservation response status:', reservationResponse.status);
    console.log('Reservation response body:', responseText);

    if (!reservationResponse.ok) {
      let errorData: any = {};
      try {
        errorData = JSON.parse(responseText);
      } catch {
        errorData = { message: responseText };
      }
      console.error('Cloudbeds reservation creation failed:', {
        status: reservationResponse.status,
        statusText: reservationResponse.statusText,
        error: errorData,
      });
      throw new Error(`Failed to create reservation in Cloudbeds: ${errorData.message || responseText || 'Unknown error'}`);
    }

    let reservationData: any = {};
    try {
      reservationData = JSON.parse(responseText);
    } catch {
      throw new Error(`Invalid response from Cloudbeds: ${responseText}`);
    }
    
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

    // Step 4: Assign the SELECTED room to the reservation (so guest gets the room from the dropdown)
    const roomIdToAssign = actualRoomID != null ? String(actualRoomID) : String(roomName);
    const assignApiUrl = (process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2').replace(/\/v1\.2\/?$/, '/v1.3');
    console.log('Assigning selected room to reservation:', { reservationID, newRoomID: roomIdToAssign, roomName: selectedRoomName ?? roomName });
    
    const assignParams = new URLSearchParams();
    assignParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    assignParams.append('reservationID', String(reservationID));
    assignParams.append('newRoomID', roomIdToAssign);
    assignParams.append('roomID', roomIdToAssign);
    if (selectedRoomName) assignParams.append('roomName', selectedRoomName);
    
    const roomAssignResponse = await fetch(`${assignApiUrl}/postRoomAssign`, {
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

    // Step 5: Set reservation to checked_in (in house) — use v1.3 so status updates correctly
    const apiV13 = (process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2').replace(/\/v1\.2\/?$/, '/v1.3');
    console.log('Setting reservation status to checked_in (in house)...');
    const checkInParams = new URLSearchParams();
    checkInParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    checkInParams.append('reservationID', String(reservationID));
    checkInParams.append('status', 'checked_in');
    
    const checkInResponse = await fetch(`${apiV13}/putReservation`, {
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
    console.log('putReservation status=checked_in OK');

    // Step 6: postRoomCheckIn so the reservation shows as In House (not just Confirmed)
    try {
      const roomCheckInParams = new URLSearchParams();
      roomCheckInParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      roomCheckInParams.append('reservationID', String(reservationID));
      roomCheckInParams.append('roomID', roomIdToAssign);
      const roomCheckInRes = await fetch(`${apiV13}/postRoomCheckIn`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: roomCheckInParams.toString(),
      });
      if (roomCheckInRes.ok) {
        const roomCheckInData = await roomCheckInRes.json();
        if (roomCheckInData.success) {
          console.log('postRoomCheckIn OK — reservation is In House');
        } else {
          console.warn('postRoomCheckIn success:false', roomCheckInData);
        }
      } else {
        const errText = await roomCheckInRes.text();
        console.warn('postRoomCheckIn failed:', roomCheckInRes.status, errText);
      }
    } catch (e: any) {
      console.warn('postRoomCheckIn error (continuing):', e?.message);
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

