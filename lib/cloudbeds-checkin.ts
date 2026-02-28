/**
 * Shared Cloudbeds check-in logic. Used by both POST /api/cloudbeds-checkin and bulk-checkin
 * so bulk can call this directly instead of fetching the app (avoids HTML/JSON errors on live).
 */

function getLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface PerformCheckInParams {
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  roomName: string;
  clcNumber?: string;
  classType?: string;
  email?: string;
  checkInDate?: string;
  checkOutDate?: string;
}

export interface PerformCheckInResult {
  success: true;
  guestID?: string;
  reservationID: string;
  roomName: string;
  message: string;
}

export async function performCloudbedsCheckIn(params: PerformCheckInParams): Promise<PerformCheckInResult> {
  const {
    firstName,
    lastName,
    phoneNumber,
    roomName,
    clcNumber,
    classType,
    email,
    checkInDate: bodyCheckIn,
    checkOutDate: bodyCheckOut,
  } = params;

  const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
  const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
  const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

  if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
    throw new Error('Cloudbeds not configured');
  }

  const now = new Date();
  const checkInDate = (bodyCheckIn && /^\d{4}-\d{2}-\d{2}$/.test(String(bodyCheckIn)))
    ? String(bodyCheckIn)
    : getLocalDateStr(now);
  const checkOutDate = (bodyCheckOut && /^\d{4}-\d{2}-\d{2}$/.test(String(bodyCheckOut)))
    ? String(bodyCheckOut)
    : getLocalDateStr(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  // Step 1: Get rooms and find matching room
  const roomsResponse = await fetch(`${CLOUDBEDS_API_URL}/getRooms?propertyID=${CLOUDBEDS_PROPERTY_ID}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  let roomTypeName = 'Standard Room';
  let roomTypeID: string | number | null = null;
  let actualRoomID: string | number | null = null;
  let selectedRoomName: string | null = null;

  if (!roomsResponse.ok) {
    throw new Error(`Failed to fetch rooms: ${roomsResponse.status}`);
  }

  const roomsData = await roomsResponse.json();
  let rooms: any[] = [];
  if (Array.isArray(roomsData.data) && roomsData.data.length > 0) {
    rooms = roomsData.data.flatMap((d: any) => (d && Array.isArray(d.rooms) ? d.rooms : (d.rooms ? [d.rooms] : [])));
  }
  if (rooms.length === 0 && roomsData.data?.[0]?.rooms) {
    rooms = roomsData.data[0].rooms;
  }
  if (rooms.length === 0 && Array.isArray(roomsData.data)) {
    rooms = roomsData.data;
  }
  if (rooms.length === 0 && Array.isArray(roomsData.rooms)) {
    rooms = roomsData.rooms;
  }
  if (rooms.length === 0 && Array.isArray(roomsData)) {
    rooms = roomsData;
  }
  if (rooms.length === 0 && roomsData.data) {
    rooms = [roomsData.data];
  }

  const roomKey = String(roomName).trim();
  const norm = (s: string) => s.replace(/^Room\s+/i, '').trim();
  const stripTrailingLetter = (s: string) => s.replace(/[a-zA-Z]+$/, '').trim();
  const digits = (s: string) => s.replace(/\D/g, '');
  const keyDigits = digits(roomKey);

  const selectedRoom = rooms.find((r: any) => {
    const idStr = r.roomID != null ? String(r.roomID) : '';
    const idAlt = r.id != null ? String(r.id) : '';
    const nameStr = (r.roomName != null ? String(r.roomName) : '').trim();
    const nameAlt = (r.name != null ? String(r.name) : '').trim();
    return (
      idStr === roomKey || idAlt === roomKey ||
      nameStr === roomKey || nameAlt === roomKey ||
      norm(nameStr) === roomKey || norm(nameAlt) === roomKey ||
      nameStr.endsWith(roomKey) || nameAlt.endsWith(roomKey) ||
      stripTrailingLetter(idStr) === roomKey || stripTrailingLetter(idAlt) === roomKey ||
      stripTrailingLetter(nameStr) === roomKey || stripTrailingLetter(nameAlt) === roomKey ||
      (keyDigits && (digits(idStr) === keyDigits || digits(idAlt) === keyDigits || digits(nameStr) === keyDigits || digits(nameAlt) === keyDigits))
    );
  });

  if (!selectedRoom) {
    throw new Error(`Room ${roomName} not found`);
  }

  roomTypeName = selectedRoom.roomTypeName || selectedRoom.roomType || 'Standard Room';
  roomTypeID = selectedRoom.roomTypeID || selectedRoom.roomType_id;
  actualRoomID = selectedRoom.roomID || selectedRoom.id;
  selectedRoomName = selectedRoom.roomName ?? selectedRoom.name ?? null;

  // Step 2: Get rate (prefer TYE)
  let rateID: string | number | null = null;
  let ratePlanID: string | number | null = null;
  try {
    const ratesUrl = `${CLOUDBEDS_API_URL}/getRatePlans?propertyID=${CLOUDBEDS_PROPERTY_ID}&startDate=${checkInDate}&endDate=${checkOutDate}`;
    const ratesResponse = await fetch(ratesUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    if (ratesResponse.ok) {
      const ratesData = await ratesResponse.json();
      const rates = ratesData.data || ratesData.rates || ratesData || [];
      const roomTypeStr = String(roomTypeID);
      const roomTypeNum = Number(roomTypeID);
      const allRatesForRoomType = rates.filter((rate: any) => {
        const rtID = rate.roomTypeID ?? rate.room_type_id ?? rate.roomType_id;
        return String(rtID) === roomTypeStr || Number(rtID) === roomTypeNum;
      });
      const tyeRate = allRatesForRoomType.find((rate: any) => {
        const planID = String(rate.ratePlanID ?? rate.rate_plan_id ?? rate.ratePlan_id ?? '');
        const planName = String(rate.ratePlanName ?? rate.name ?? '').toLowerCase();
        return planID === '227753' || Number(planID) === 227753 || planName.includes('tye');
      });
      if (tyeRate) {
        rateID = tyeRate.rateID ?? tyeRate.rate_id ?? tyeRate.id;
        ratePlanID = tyeRate.ratePlanID ?? tyeRate.rate_plan_id ?? tyeRate.ratePlan_id ?? 227753;
      } else if (allRatesForRoomType.length > 0) {
        const available = allRatesForRoomType.filter(
          (rate: any) => (rate.roomsAvailable == null || rate.roomsAvailable > 0) && !rate.roomBlocked
        );
        const fallback = available[0] ?? allRatesForRoomType[0];
        rateID = fallback.rateID ?? fallback.rate_id ?? fallback.id;
        ratePlanID = fallback.ratePlanID ?? fallback.rate_plan_id ?? fallback.ratePlan_id;
      }
    }
  } catch (_) {
    // continue without rate
  }

  const roomTypeIDStr = String(roomTypeID ?? '');
  const roomRateIDStr = rateID != null ? String(rateID) : ratePlanID != null ? String(ratePlanID) : '';

  // Step 3: Create reservation
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
  if (roomRateIDStr) reservationParams.append('rooms[0][roomRateID]', roomRateIDStr);
  reservationParams.append('adults[0][roomTypeID]', roomTypeIDStr);
  reservationParams.append('adults[0][quantity]', '1');
  reservationParams.append('children[0][roomTypeID]', roomTypeIDStr);
  reservationParams.append('children[0][quantity]', '0');
  reservationParams.append('sourceID', 's-945658-1');

  const reservationResponse = await fetch(`${CLOUDBEDS_API_URL}/postReservation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: reservationParams.toString(),
  });

  const responseText = await reservationResponse.text();
  if (!reservationResponse.ok) {
    let errorData: any = {};
    try {
      errorData = JSON.parse(responseText);
    } catch {
      errorData = { message: responseText };
    }
    throw new Error(
      errorData.message || responseText || 'Failed to create reservation in Cloudbeds'
    );
  }

  let reservationData: any = {};
  try {
    reservationData = JSON.parse(responseText);
  } catch {
    throw new Error(`Invalid response from Cloudbeds: ${responseText}`);
  }
  if (!reservationData.success) {
    throw new Error(reservationData.message || 'Reservation creation failed');
  }

  const reservationID = reservationData.data?.reservationID || reservationData.reservationID;
  const guestID = reservationData.data?.guestID || reservationData.guestID;
  if (!reservationID) {
    throw new Error('No reservationID returned from Cloudbeds');
  }

  // Step 4: Assign the selected room (must use v1.3 for postRoomAssign)
  const roomIdToAssign = actualRoomID != null ? String(actualRoomID) : String(roomName);
  const baseUrl = (CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2').replace(/\/v1\.\d+\/?$/, '');
  const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;
  const assignParams = new URLSearchParams();
  assignParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
  assignParams.append('reservationID', String(reservationID));
  assignParams.append('newRoomID', roomIdToAssign);
  const assignedRoomFromRes = reservationData.data?.rooms?.[0]?.roomID ?? reservationData.data?.roomID;
  if (assignedRoomFromRes != null && String(assignedRoomFromRes) !== roomIdToAssign) {
    assignParams.append('roomID', String(assignedRoomFromRes)); // current room so API reassigns to newRoomID
  } else {
    assignParams.append('roomID', roomIdToAssign); // target room (initial assign; some APIs expect roomID)
  }

  const roomAssignResponse = await fetch(`${apiV13}/postRoomAssign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: assignParams.toString(),
  });
  if (!roomAssignResponse.ok) {
    const assignErrorText = await roomAssignResponse.text();
    throw new Error(`Failed to assign room: ${assignErrorText}`);
  }
  const assignResult = await roomAssignResponse.json();
  if (!assignResult.success) {
    throw new Error(assignResult.message || 'Room assignment failed');
  }

  // Step 5: Set status to checked_in
  const checkInParams = new URLSearchParams();
  checkInParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
  checkInParams.append('reservationID', String(reservationID));
  checkInParams.append('status', 'checked_in');

  const checkInResponse = await fetch(`${apiV13}/putReservation`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: checkInParams.toString(),
  });
  if (!checkInResponse.ok) {
    const errorData = await checkInResponse.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to check in guest');
  }
  const checkInData = await checkInResponse.json();
  if (!checkInData.success) {
    throw new Error(checkInData.message || 'Check-in failed');
  }

  // Step 6: postRoomCheckIn (best effort)
  try {
    const roomCheckInParams = new URLSearchParams();
    roomCheckInParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    roomCheckInParams.append('reservationID', String(reservationID));
    roomCheckInParams.append('roomID', roomIdToAssign);
    await fetch(`${apiV13}/postRoomCheckIn`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: roomCheckInParams.toString(),
    });
  } catch (_) {
    // ignore
  }

  return {
    success: true,
    guestID,
    reservationID: String(reservationID),
    roomName,
    message: 'Guest successfully checked in to Cloudbeds',
  };
}
