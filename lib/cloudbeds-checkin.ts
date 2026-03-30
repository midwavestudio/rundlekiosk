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

function parseRoomsArrayFromGetRoomsJson(roomsData: any): any[] {
  let rooms: any[] = [];
  if (Array.isArray(roomsData.data) && roomsData.data.length > 0) {
    rooms = roomsData.data.flatMap((d: any) => (d && Array.isArray(d.rooms) ? d.rooms : d.rooms ? [d.rooms] : []));
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
  return rooms;
}

function findRoomByKey(rooms: any[], roomKey: string): any | undefined {
  const norm = (s: string) => s.replace(/^Room\s+/i, '').trim();
  const stripTrailingLetter = (s: string) => s.replace(/[a-zA-Z]+$/, '').trim();
  const digits = (s: string) => s.replace(/\D/g, '');
  const keyDigits = digits(roomKey);
  return rooms.find((r: any) => {
    const idStr = r.roomID != null ? String(r.roomID) : '';
    const idAlt = r.id != null ? String(r.id) : '';
    const nameStr = (r.roomName != null ? String(r.roomName) : '').trim();
    const nameAlt = (r.name != null ? String(r.name) : '').trim();
    return (
      idStr === roomKey ||
      idAlt === roomKey ||
      nameStr === roomKey ||
      nameAlt === roomKey ||
      norm(nameStr) === roomKey ||
      norm(nameAlt) === roomKey ||
      nameStr.endsWith(roomKey) ||
      nameAlt.endsWith(roomKey) ||
      stripTrailingLetter(idStr) === roomKey ||
      stripTrailingLetter(idAlt) === roomKey ||
      stripTrailingLetter(nameStr) === roomKey ||
      stripTrailingLetter(nameAlt) === roomKey ||
      (keyDigits &&
        (digits(idStr) === keyDigits ||
          digits(idAlt) === keyDigits ||
          digits(nameStr) === keyDigits ||
          digits(nameAlt) === keyDigits))
    );
  });
}

/** Identifies the unassigned room *line* on the reservation for postRoomAssign (not the physical room id from getRooms). */
function extractReservationRoomLineId(root: any): string | null {
  const data = root?.data;
  const bases = [root, data, Array.isArray(data) ? data[0] : null].filter(Boolean);
  for (const b of bases) {
    const lists = [b.unassigned, b.unassignedRooms].filter(Boolean);
    for (const arr of lists) {
      if (!Array.isArray(arr) || !arr[0]) continue;
      const id = arr[0]?.reservationRoomID ?? arr[0]?.reservationRoomId;
      if (id != null && String(id).trim() !== '') return String(id);
    }
  }
  const d = root?.data ?? root;
  const gl = d?.guestList;
  if (gl && typeof gl === 'object') {
    for (const g of Object.values(gl) as any[]) {
      const ur = g?.unassignedRooms;
      if (Array.isArray(ur) && ur[0]?.reservationRoomID != null && String(ur[0].reservationRoomID).trim() !== '') {
        return String(ur[0].reservationRoomID);
      }
      const rms = g?.rooms;
      if (Array.isArray(rms) && rms[0]?.reservationRoomID != null && String(rms[0].reservationRoomID).trim() !== '') {
        return String(rms[0].reservationRoomID);
      }
    }
  }
  return null;
}

/** True when getReservation shows a physical room already on the booking (postReservation may still echo unassigned[]). */
function reservationAlreadyHasPhysicalRoom(root: any): boolean {
  const d = root?.data ?? root;
  const assigned = d?.assigned;
  if (Array.isArray(assigned) && assigned.length > 0) {
    const a = assigned[0];
    if (a?.roomID != null && String(a.roomID).trim() !== '') return true;
  }
  const gl = d?.guestList;
  if (gl && typeof gl === 'object') {
    for (const g of Object.values(gl) as any[]) {
      if (g?.assignedRoom === true && g?.roomID != null && String(g.roomID).trim() !== '') return true;
    }
  }
  return false;
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
  /** If provided, request/response trail for each step is pushed here (for debugging room-assignment issues). */
  debugLog?: Array<{ step: string; request?: unknown; response?: unknown; error?: string }>;
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
    debugLog,
  } = params;

  const log = (step: string, request?: unknown, response?: unknown, error?: string) => {
    debugLog?.push({ step, request, response, error });
  };

  const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
  const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
  const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
  const baseUrl = (CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2').replace(/\/v1\.\d+\/?$/, '');
  const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;

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

  // Step 1: Get rooms and find matching room (use same API minor version as postReservation/postRoomAssign)
  const getRoomsUrl = `${apiV13}/getRooms?propertyID=${CLOUDBEDS_PROPERTY_ID}`;
  log('1_getRooms_request', { url: getRoomsUrl, method: 'GET' });
  const roomsResponse = await fetch(getRoomsUrl, {
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
  const rooms = parseRoomsArrayFromGetRoomsJson(roomsData);

  const roomListSummary: any[] = rooms.slice(0, 50).map((r: any) => ({
    roomID: r.roomID ?? r.id,
    roomName: r.roomName ?? r.name,
    roomTypeID: r.roomTypeID ?? r.roomType_id,
  }));
  if (rooms.length > 50) {
    roomListSummary.push({ _note: `... and ${rooms.length - 50} more rooms` });
  }
  log('1_getRooms_response', {
    status: roomsResponse.status,
    roomCount: rooms.length,
    rooms: roomListSummary,
    rawDataKeys: roomsData.data ? Object.keys(roomsData) : [],
  });

  const roomKey = String(roomName).trim();

  const selectedRoom = findRoomByKey(rooms, roomKey);

  if (!selectedRoom) {
    log('2_room_match', { roomKey, found: false, error: `Room ${roomName} not found` });
    throw new Error(`Room ${roomName} not found`);
  }

  roomTypeName = selectedRoom.roomTypeName || selectedRoom.roomType || 'Standard Room';
  roomTypeID = selectedRoom.roomTypeID || selectedRoom.roomType_id;
  actualRoomID = selectedRoom.roomID || selectedRoom.id;
  selectedRoomName = selectedRoom.roomName ?? selectedRoom.name ?? null;
  log('2_room_match', {
    roomKey,
    found: true,
    actualRoomID,
    selectedRoomName,
    roomTypeID,
    roomTypeName,
  });

  // Same room for the stay window — Cloudbeds uses this list for assignable inventory; IDs may differ from the full property list.
  let roomIdForStayPeriod: string | null = null;
  try {
    const stayUrl = `${apiV13}/getRooms?propertyID=${CLOUDBEDS_PROPERTY_ID}&startDate=${encodeURIComponent(checkInDate)}&endDate=${encodeURIComponent(checkOutDate)}`;
    log('1b_getRooms_stay_dates_request', { url: stayUrl, method: 'GET' });
    const stayResp = await fetch(stayUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const stayData = await stayResp.json();
    const stayRooms = parseRoomsArrayFromGetRoomsJson(stayData);
    const stayRoom = findRoomByKey(stayRooms, roomKey);
    if (stayRoom && (stayRoom.roomID != null || stayRoom.id != null)) {
      roomIdForStayPeriod = String(stayRoom.roomID ?? stayRoom.id);
    }
    log('1b_getRooms_stay_dates_response', {
      status: stayResp.status,
      roomCount: stayRooms.length,
      matchedRoomId: roomIdForStayPeriod,
    });
  } catch (e: any) {
    log('1b_getRooms_stay_dates_error', undefined, undefined, e?.message);
  }

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
  // Prefer stay-window room id from getRooms(startDate,endDate); Cloudbeds uses that inventory for the booking dates.
  const roomIdForCreate = roomIdForStayPeriod ?? actualRoomID;
  // Book a specific physical room when allowed (MyBookings / property settings). Reduces unassigned + postRoomAssign needs.
  if (process.env.CLOUDBEDS_SKIP_POST_RESERVATION_ROOM_ID !== '1' && roomIdForCreate != null) {
    const rid = String(roomIdForCreate);
    reservationParams.append('rooms[0][roomID]', rid);
    reservationParams.append('adults[0][roomID]', rid);
    reservationParams.append('children[0][roomID]', rid);
  }

  log('3_postReservation_request', {
    url: `${apiV13}/postReservation`,
    body: {
      roomTypeID: roomTypeIDStr,
      roomID: roomIdForCreate != null ? String(roomIdForCreate) : undefined,
      roomRateID: roomRateIDStr || undefined,
      startDate: checkInDate,
      endDate: checkOutDate,
      guestFirstName: firstName,
      guestLastName: lastName,
    },
  });

  const reservationResponse = await fetch(`${apiV13}/postReservation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: reservationParams.toString(),
  });

  const responseText = await reservationResponse.text();
  log('3_postReservation_response', {
    status: reservationResponse.status,
    body: (() => {
      try {
        return JSON.parse(responseText);
      } catch {
        return responseText;
      }
    })(),
  });
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
  const subReservationID = reservationData.unassigned?.[0]?.subReservationID || reservationID;
  let hasUnassigned = !!(reservationData.unassigned && reservationData.unassigned.length > 0);
  const assignedRooms = reservationData.assigned || [];
  if (!reservationID) {
    throw new Error('No reservationID returned from Cloudbeds');
  }

  log('3a_postReservation_room_status', {
    hasUnassigned,
    unassignedCount: reservationData.unassigned?.length || 0,
    assignedCount: assignedRooms.length,
    needsRoomAssignment: hasUnassigned,
  });

  // postRoomAssign needs the unassigned *line* id (reservationRoomID). postReservation often still lists unassigned[]
  // even after rooms[0][roomID] succeeded — getReservation is the source of truth.
  let reservationRoomLineId: string | null = extractReservationRoomLineId(reservationData);
  if (hasUnassigned) {
    try {
      const grUrl = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(String(reservationID))}`;
      log('3b_getReservation_request', { url: grUrl, method: 'GET' });
      const grResp = await fetch(grUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      const grText = await grResp.text();
      let grParsed: any = null;
      try {
        grParsed = JSON.parse(grText);
      } catch {
        grParsed = null;
      }
      log('3b_getReservation_response', { status: grResp.status, body: grParsed ?? grText });
      if (grResp.ok && grParsed?.success) {
        reservationRoomLineId = extractReservationRoomLineId(grParsed) ?? reservationRoomLineId;
        if (reservationAlreadyHasPhysicalRoom(grParsed)) {
          hasUnassigned = false;
          log('3d_reconciled_room_status', {
            postReservationSaidUnassigned: true,
            getReservationShowsAssignedRoom: true,
            skipPostRoomAssign: true,
          });
        }
      }
    } catch (e: any) {
      log('3b_getReservation_error', undefined, undefined, e?.message);
    }
    log('3c_reservation_room_line_id', { reservationRoomLineId, needsPostRoomAssign: hasUnassigned });
  }

  // Step 4: Post CLC payment so balance is zero
  const grandTotalRaw =
    reservationData.data?.grandTotal ??
    reservationData.grandTotal ??
    ((Array.isArray(reservationData.unassigned) && reservationData.unassigned[0]?.roomTotal)
      ? reservationData.unassigned[0].roomTotal
      : 0);
  const grandTotal = Number(grandTotalRaw) || 0;

  if (grandTotal > 0) {
    // Cloudbeds postPayment `type` must match getPaymentMethods `method` (e.g. CLC), not the word "payment".
    let clcPaymentTypeID: string | null = null;
    let paymentMethodsRaw: any = null;
    
    try {
      const url = `${apiV13}/getPaymentMethods?propertyID=${CLOUDBEDS_PROPERTY_ID}`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      const text = await resp.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      log('4a_getPaymentMethods', { endpoint: '/getPaymentMethods', url, status: resp.status }, parsed ?? text);
      
      if (resp.ok && parsed) {
        // Cloudbeds getPaymentMethods v1.3 returns:
        // { success: true, data: { propertyID, methods: [ { method, code, name, ... } ], gateway: {...} } }
        // For postPayment, use `method` as `type` (e.g. 'CLC', 'cash', 'bill').
        paymentMethodsRaw = parsed.data ?? parsed.paymentMethods ?? parsed;
        const methods = Array.isArray(paymentMethodsRaw?.methods) ? paymentMethodsRaw.methods : [];
        const found = methods.find((m: any) => {
          const name = String(m.name ?? '').toLowerCase();
          const code = String(m.code ?? '').toLowerCase();
          const method = String(m.method ?? '').toLowerCase();
          return name === 'clc' || code === 'clc' || method === 'clc';
        });
        if (found) {
          // postPayment `type` must be the method from getPaymentMethods (e.g. "CLC", "cash"), not "payment".
          clcPaymentTypeID = String(found.method ?? found.code ?? 'CLC');
        }
      }
    } catch (e: any) {
      log('4a_getPaymentMethods_error', undefined, undefined, e?.message);
    }

    if (!clcPaymentTypeID) {
      // If we can't find it, fail loudly so we don't create unpaid reservations.
      throw new Error('Unable to locate Cloudbeds payment method "CLC" from getPaymentMethods. Ensure CLC is configured in Cloudbeds Settings → Payment Methods.');
    }

    const paymentAmountStr = grandTotal.toFixed(2);
    // OpenAPI: `type` is the payment method from getPaymentMethods (not the literal "payment").
    const postPaymentType =
      process.env.CLOUDBEDS_POST_PAYMENT_TYPE || clcPaymentTypeID;
    const paymentParams = new URLSearchParams();
    paymentParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    paymentParams.append('reservationID', String(reservationID));
    paymentParams.append('type', postPaymentType);
    paymentParams.append('amount', paymentAmountStr);
    paymentParams.append('description', `CLC Direct Bill - ${firstName} ${lastName}`);

    log('4_postPayment_request', {
      url: `${apiV13}/postPayment`,
      body: {
        propertyID: CLOUDBEDS_PROPERTY_ID,
        reservationID: String(reservationID),
        type: postPaymentType,
        amount: paymentAmountStr,
        description: `CLC Direct Bill - ${firstName} ${lastName}`,
      },
    });

    const paymentResponse = await fetch(`${apiV13}/postPayment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: paymentParams.toString(),
    });
    const paymentText = await paymentResponse.text();
    let paymentResult: any;
    try {
      paymentResult = JSON.parse(paymentText);
    } catch {
      paymentResult = { success: false, message: paymentText };
    }
    log('4_postPayment_response', { status: paymentResponse.status, body: paymentResult });

    if (!paymentResponse.ok || !paymentResult.success) {
      // Log the failure but don't hard-fail check-in — reservation + room still need to complete.
      console.error('[cloudbeds-checkin] postPayment failed:', paymentResult.message);
      log('4_postPayment_failed', { message: paymentResult.message });
    }
  }

  // Refresh reservation after payment (reservationRoomID may appear; room may show as assigned only now).
  if (hasUnassigned) {
    try {
      const grUrl = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(String(reservationID))}`;
      log('4b_getReservation_after_payment_request', { url: grUrl, method: 'GET' });
      const grResp = await fetch(grUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      const grText = await grResp.text();
      let grParsed: any = null;
      try {
        grParsed = JSON.parse(grText);
      } catch {
        grParsed = null;
      }
      log('4b_getReservation_after_payment_response', { status: grResp.status, body: grParsed ?? grText });
      if (grResp.ok && grParsed?.success) {
        reservationRoomLineId = extractReservationRoomLineId(grParsed) ?? reservationRoomLineId;
        if (reservationAlreadyHasPhysicalRoom(grParsed)) {
          hasUnassigned = false;
          log('4b_reconciled_room_status', { getReservationShowsAssignedRoom: true, skipPostRoomAssign: true });
        }
      }
    } catch (e: any) {
      log('4b_getReservation_after_payment_error', undefined, undefined, e?.message);
    }
  }

  // Step 5: Assign physical room (postRoomAssign). Prefer reservationRoomID (unassigned line) + newRoomID.
  // postReservation already created the correct room type + dates; putReservation with rooms[] was
  // redundant and triggered Cloudbeds "could not accommodate your request" (availability re-check).
  if (hasUnassigned) {
    const lineSubReservationID = String(subReservationID);
    const roomNameForAssign = selectedRoomName ? String(selectedRoomName).trim() : '';
    const roomIdsToTry = [...new Set([roomIdForStayPeriod, actualRoomID].filter((x) => x != null).map(String))];

    type AssignAttempt = { step: string; params: URLSearchParams };
    const mk = (fields: Record<string, string>): URLSearchParams => {
      const p = new URLSearchParams();
      p.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      for (const [k, v] of Object.entries(fields)) {
        if (v !== '') p.append(k, v);
      }
      return p;
    };

    let assignOk = false;
    let lastAssignMessage = '';

    assignAttempts: for (const internalId of roomIdsToTry) {
      const attempts: AssignAttempt[] = [];

      if (reservationRoomLineId) {
        attempts.push({
          step: `5_postRoomAssign_reservationRoomID_subRes_internal_${internalId}`,
          params: mk({
            reservationID: String(reservationID),
            reservationRoomID: reservationRoomLineId,
            subReservationID: lineSubReservationID,
            newRoomID: internalId,
            roomTypeID: String(roomTypeID),
            adjustPrice: 'true',
          }),
        });
        attempts.push({
          step: `5_postRoomAssign_reservationRoomID_subRes_internal_noAdjust_${internalId}`,
          params: mk({
            reservationID: String(reservationID),
            reservationRoomID: reservationRoomLineId,
            subReservationID: lineSubReservationID,
            newRoomID: internalId,
            roomTypeID: String(roomTypeID),
          }),
        });
        attempts.push({
          step: `5_postRoomAssign_reservationRoomID_only_internal_${internalId}`,
          params: mk({
            reservationID: String(reservationID),
            reservationRoomID: reservationRoomLineId,
            newRoomID: internalId,
            roomTypeID: String(roomTypeID),
            adjustPrice: 'true',
          }),
        });
        if (roomNameForAssign && roomNameForAssign !== internalId) {
          attempts.push({
            step: `5_postRoomAssign_reservationRoomID_subRes_roomName_${internalId}`,
            params: mk({
              reservationID: String(reservationID),
              reservationRoomID: reservationRoomLineId,
              subReservationID: lineSubReservationID,
              newRoomID: roomNameForAssign,
              roomTypeID: String(roomTypeID),
            }),
          });
        }
      }

      attempts.push({
        step: `5a_postRoomAssign_subRes_internalID_${internalId}`,
        params: mk({
          reservationID: String(reservationID),
          subReservationID: lineSubReservationID,
          newRoomID: internalId,
          roomTypeID: String(roomTypeID),
        }),
      });
      if (roomNameForAssign && roomNameForAssign !== internalId) {
        attempts.push({
          step: `5b_postRoomAssign_subRes_roomName_${internalId}`,
          params: mk({
            reservationID: String(reservationID),
            subReservationID: lineSubReservationID,
            newRoomID: roomNameForAssign,
            roomTypeID: String(roomTypeID),
          }),
        });
      }
      attempts.push({
        step: `5c_postRoomAssign_resOnly_internalID_${internalId}`,
        params: mk({
          reservationID: String(reservationID),
          newRoomID: internalId,
          roomTypeID: String(roomTypeID),
        }),
      });
      if (roomNameForAssign && roomNameForAssign !== internalId) {
        attempts.push({
          step: `5d_postRoomAssign_resOnly_roomName_${internalId}`,
          params: mk({
            reservationID: String(reservationID),
            newRoomID: roomNameForAssign,
            roomTypeID: String(roomTypeID),
          }),
        });
      }

      for (const { step, params } of attempts) {
        const bodyObj = Object.fromEntries(params.entries());
        log(`${step}_request`, { url: `${apiV13}/postRoomAssign`, body: bodyObj });

        const assignResponse = await fetch(`${apiV13}/postRoomAssign`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });
        const assignText = await assignResponse.text();
        let assignResult: any;
        try {
          assignResult = JSON.parse(assignText);
        } catch {
          assignResult = { success: false, message: assignText };
        }
        log(`${step}_response`, { status: assignResponse.status, body: assignResult });

        if (assignResult.success) {
          assignOk = true;
          console.log('[cloudbeds-checkin] Physical room assigned via postRoomAssign', step);
          break assignAttempts;
        }
        lastAssignMessage = assignResult.message || lastAssignMessage;
      }
    }

    if (!assignOk) {
      console.warn('[cloudbeds-checkin] postRoomAssign failed (will still try check-in):', lastAssignMessage);
      log('5_postRoomAssign_failed_continuing', { message: lastAssignMessage });
    }
  }

  const roomIdForCheckIn = String(roomIdForStayPeriod ?? actualRoomID);

  const putReservationCheckedIn = async (): Promise<{ ok: boolean; data: any; status: number }> => {
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
    const checkInText = await checkInResponse.text();
    let checkInData: any;
    try {
      checkInData = JSON.parse(checkInText);
    } catch {
      checkInData = {};
    }
    return {
      ok: checkInResponse.ok && checkInData.success === true,
      data: checkInData,
      status: checkInResponse.status,
    };
  };

  const postRoomCheckInWith = async (variant: { subReservationID?: string; roomID?: string }) => {
    const roomCheckInParams = new URLSearchParams();
    roomCheckInParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    roomCheckInParams.append('reservationID', String(reservationID));
    if (variant.subReservationID) roomCheckInParams.append('subReservationID', variant.subReservationID);
    if (variant.roomID) roomCheckInParams.append('roomID', variant.roomID);
    const rcResp = await fetch(`${apiV13}/postRoomCheckIn`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: roomCheckInParams.toString(),
    });
    const rcText = await rcResp.text();
    let rcData: any;
    try {
      rcData = JSON.parse(rcText);
    } catch {
      rcData = {};
    }
    return { ok: rcResp.ok && rcData.success === true, data: rcData, status: rcResp.status };
  };

  // Step 6: Set reservation status to checked_in. If Cloudbeds rejects (e.g. guest not checked in at room),
  // postRoomCheckIn then retry putReservation.
  let checkInResult = await putReservationCheckedIn();
  log('6_putReservation_checkin_response', { status: checkInResult.status, body: checkInResult.data });

  if (!checkInResult.ok) {
    const subRes = String(subReservationID);
    const roomCheckInVariants = [
      { subReservationID: subRes, roomID: roomIdForCheckIn },
      { subReservationID: subRes },
      { roomID: roomIdForCheckIn },
    ];
    for (const v of roomCheckInVariants) {
      const rc = await postRoomCheckInWith(v);
      log('6b_postRoomCheckIn_retry', { variant: v, status: rc.status, body: rc.data });
      if (rc.ok) {
        checkInResult = await putReservationCheckedIn();
        log('6_putReservation_checkin_after_postRoomCheckIn', { status: checkInResult.status, body: checkInResult.data });
        if (checkInResult.ok) break;
      }
    }
  }

  if (!checkInResult.ok) {
    throw new Error(checkInResult.data?.message || 'Check-in failed');
  }

  // Step 7: postRoomCheckIn (best effort) — room-level check-in if not already completed
  try {
    await postRoomCheckInWith({ subReservationID: String(subReservationID), roomID: roomIdForCheckIn });
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
