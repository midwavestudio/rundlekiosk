import { NextRequest, NextResponse } from 'next/server';
import { getAvailablePlaceholdersByDate } from '@/lib/tye-placeholder-store';

export const dynamic = 'force-dynamic';

/**
 * Merge every `data[].rooms` array from getRooms — Cloudbeds returns one object per room type;
 * using only `data[0].rooms` hides all other types (e.g. only Queen + first type showed in the dropdown).
 */
function parseAllRoomsFromGetRoomsJson(roomsData: any): any[] {
  let rooms: any[] = [];
  if (Array.isArray(roomsData.data) && roomsData.data.length > 0) {
    rooms = roomsData.data.flatMap((d: any) =>
      d && Array.isArray(d.rooms) ? d.rooms : d.rooms ? [d.rooms] : []
    );
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

/**
 * Cloudbeds getRooms defaults to pageSize=20. Properties with more than 20 physical rooms
 * only return the first page — remaining room types never appear in the kiosk dropdown.
 */
async function fetchAllRoomsPages(
  getRoomsBase: string,
  propertyID: string,
  headers: HeadersInit
): Promise<any[]> {
  const merged: any[] = [];
  const seen = new Set<string>();
  const pageSize = 500;
  let pageNumber = 1;
  const maxPages = 50;

  for (;;) {
    const url = `${getRoomsBase}/getRooms?propertyID=${encodeURIComponent(propertyID)}&pageNumber=${pageNumber}&pageSize=${pageSize}&includeRoomRelations=1`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      if (pageNumber === 1) return [];
      break;
    }
    const roomsData = await res.json();
    const batch = parseAllRoomsFromGetRoomsJson(roomsData);
    if (batch.length === 0) break;

    let newCount = 0;
    for (const room of batch) {
      const id = String(room?.roomID ?? room?.id ?? '');
      const key = id || `${room?.roomName ?? ''}-${room?.roomTypeID ?? ''}`;
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(room);
        newCount += 1;
      }
    }
    // If API keeps returning the same page (all duplicates), stop to avoid spinning.
    if (newCount === 0) break;

    pageNumber += 1;
    if (pageNumber > maxPages) break;
  }
  return merged;
}

/**
 * Rooms actually free for checkIn→checkOut (Cloudbeds inventory). This is the authoritative
 * source for walk-in / block selection — unlike "all getRooms minus checked_in", which misses
 * occupied rooms when assignments live under different API fields or statuses.
 */
async function fetchAllUnassignedRooms(
  apiV13: string,
  propertyID: string,
  headers: HeadersInit,
  checkIn: string,
  checkOut: string
): Promise<any[]> {
  const merged: any[] = [];
  const seen = new Set<string>();
  const pageSize = 500;
  let pageNumber = 1;
  const maxPages = 50;

  for (;;) {
    const url = `${apiV13}/getRoomsUnassigned?propertyID=${encodeURIComponent(propertyID)}&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}&pageNumber=${pageNumber}&pageSize=${pageSize}`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      if (pageNumber === 1) {
        console.warn('getRoomsUnassigned failed:', res.status, await res.text().catch(() => ''));
      }
      break;
    }
    const roomsData = await res.json();
    const batch = parseAllRoomsFromGetRoomsJson(roomsData);
    if (batch.length === 0) break;

    let newCount = 0;
    for (const room of batch) {
      const id = String(room?.roomID ?? room?.id ?? '');
      const key = id || `${room?.roomName ?? ''}-${room?.roomTypeID ?? ''}`;
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(room);
        newCount += 1;
      }
    }
    // Do not stop when batch.length < pageSize — Cloudbeds often returns far fewer than
    // the requested pageSize per page; stopping early omitted later pages and hid rooms
    // (e.g. 201) from the check-in dropdown while they still appeared in Cloudbeds UI.
    if (newCount === 0) break;
    pageNumber += 1;
    if (pageNumber > maxPages) break;
  }
  return merged;
}

/** Returns YYYY-MM-DD in server local time (not UTC). */
function getLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Cloudbeds list responses vary: data[], data.reservations, or top-level array. */
function extractReservationList(j: any): any[] {
  if (!j) return [];
  if (Array.isArray(j.data)) return j.data;
  if (Array.isArray(j.data?.reservations)) return j.data.reservations;
  if (Array.isArray(j.data?.data)) return j.data.data;
  if (Array.isArray(j.reservations)) return j.reservations;
  if (Array.isArray(j)) return j;
  return [];
}

/**
 * All checked-in reservations can span many pages — a single fetch misses most in-house guests,
 * so occupied rooms incorrectly appear as "available".
 */
/** List endpoint may put room lines under `rooms`, `assigned`, or top-level — merge like cloudbeds-checkout. */
function mergeReservationRoomRows(reservation: any): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const key of ['assigned', 'rooms'] as const) {
    const arr = reservation?.[key];
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      if (!r || typeof r !== 'object') continue;
      const id = `${r.subReservationID ?? ''}|${r.roomID ?? ''}|${r.reservationRoomID ?? ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
  }
  return out;
}

async function fetchOccupiedRoomKeysFromCheckedIn(
  apiV13: string,
  propertyID: string,
  headers: HeadersInit,
  referenceDateYmd: string
): Promise<{ ids: Set<string>; names: Set<string> }> {
  const occupiedRoomIDs = new Set<string>();
  /** Lowercased trimmed display names — Cloudbeds sometimes varies casing/spacing. */
  const occupiedRoomNames = new Set<string>();

  const normName = (s: string) => s.trim().toLowerCase();

  const addFromReservation = (res: any) => {
    for (const r of mergeReservationRoomRows(res)) {
      if (r.roomID) occupiedRoomIDs.add(String(r.roomID).trim());
      if (r.roomName) occupiedRoomNames.add(normName(String(r.roomName)));
      const rn = r.roomNumber ?? r.room_number;
      if (rn != null && String(rn).trim() !== '') occupiedRoomNames.add(normName(String(rn)));
    }
    if (res.roomID) occupiedRoomIDs.add(String(res.roomID).trim());
    if (res.roomName) occupiedRoomNames.add(normName(String(res.roomName)));
  };

  let pageNumber = 1;
  const pageSize = 500;
  const maxPages = 50;

  for (;;) {
    const url = `${apiV13}/getReservations?propertyID=${encodeURIComponent(propertyID)}&status=checked_in&pageNumber=${pageNumber}&pageSize=${pageSize}`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      if (pageNumber === 1) console.warn('getReservations checked_in failed:', res.status);
      break;
    }
    const j = await res.json();
    const list: any[] = extractReservationList(j);
    if (list.length === 0) break;

    const staying = list.filter((r: any) => {
      const out = r.endDate ?? r.checkOutDate;
      return out && String(out) >= referenceDateYmd;
    });
    staying.forEach(addFromReservation);

    if (list.length < pageSize) break;
    pageNumber += 1;
    if (pageNumber > maxPages) break;
  }

  return { ids: occupiedRoomIDs, names: occupiedRoomNames };
}

/**
 * Merges TYE placeholder rooms into the available-rooms list.
 *
 * Placeholder reservations are in "confirmed" status in Cloudbeds so they appear
 * as upcoming arrivals and their rooms get filtered out of getRooms results. We
 * re-add them here so guests can select a placeholder room at the kiosk.
 * Each placeholder room is annotated with `placeholderReservationID` so the
 * check-in flow can skip postReservation and go directly to assign-placeholder.
 */
async function mergePlaceholderRooms(
  existingRooms: Array<{ roomID: string; roomName: string; roomTypeName: string }>,
  forDate: string
): Promise<Array<{ roomID: string; roomName: string; roomTypeName: string; placeholderReservationID?: string }>> {
  try {
    const placeholders = await getAvailablePlaceholdersByDate(forDate);
    if (placeholders.length === 0) return existingRooms;

    const existingIDs = new Set(existingRooms.map((r) => r.roomID));
    const toAdd = placeholders
      .filter((p) => !existingIDs.has(p.roomID))
      .map((p) => ({
        roomID: p.roomID,
        roomName: p.roomName,
        roomTypeName: p.roomTypeName,
        placeholderReservationID: p.reservationID,
      }));

    // For rooms already in the list, annotate them with the placeholder ID.
    const annotated = existingRooms.map((room) => {
      const ph = placeholders.find((p) => p.roomID === room.roomID);
      return ph ? { ...room, placeholderReservationID: ph.reservationID } : room;
    });

    return [...annotated, ...toAdd];
  } catch (err) {
    // Placeholder merge is non-fatal — return the original list unchanged.
    console.warn('mergePlaceholderRooms error (non-fatal):', err);
    return existingRooms;
  }
}

export async function GET(request: NextRequest) {
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
    const baseUrl = CLOUDBEDS_API_URL.replace(/\/v1\.\d+\/?$/, '');
    const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;

    // Optional ?date=YYYY-MM-DD for testing; otherwise use today (local)
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const now = dateParam ? new Date(dateParam + 'T12:00:00') : new Date();
    const today = getLocalDateStr(now);
    const tomorrow = getLocalDateStr(new Date(now.getTime() + 24 * 60 * 60 * 1000));

    console.log('Available Rooms API:', {
      hasApiKey: !!CLOUDBEDS_API_KEY,
      propertyId: CLOUDBEDS_PROPERTY_ID,
      checkIn: today,
      checkOut: tomorrow,
      dateParam: dateParam || '(today)',
    });

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      console.warn('Cloudbeds API credentials not configured');
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
        reason: 'Cloudbeds credentials missing (set CLOUDBEDS_API_KEY and CLOUDBEDS_PROPERTY_ID)',
      });
    }

    /** Format a raw Cloudbeds room object to our { roomID, roomName, roomTypeName } shape */
    function formatRoom(room: any) {
      const roomID = room.roomID ?? room.id ?? room.room_id ?? room.roomId ?? room.roomName;
      const roomName = room.roomName ?? room.name ?? room.room_name ?? room.roomNumber ?? roomID;
      const roomTypeName = room.roomTypeName ?? room.roomType ?? room.room_type ?? room.typeName ?? room.type ?? 'Standard Room';
      return {
        roomID: roomID != null ? String(roomID) : 'unknown',
        roomName: roomName != null ? String(roomName) : 'Unknown',
        roomTypeName: roomTypeName != null ? String(roomTypeName) : 'Standard Room',
      };
    }

    // Return full room inventory for the picker (all rooms), not just unassigned rooms.
    // This allows staff/guests to select a room even when Cloudbeds marks it unavailable;
    // downstream check-in logic already handles assignment edge cases gracefully.
    let apiError: string | null = null;
    const headers: HeadersInit = {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/json',
    };
    let allRooms: any[] = [];
    try {
      allRooms = await fetchAllRoomsPages(apiV13, CLOUDBEDS_PROPERTY_ID, headers);
      if (allRooms.length === 0) {
        const legacyBase = `${baseUrl.replace(/\/$/, '')}/v1.2`;
        allRooms = await fetchAllRoomsPages(legacyBase, CLOUDBEDS_PROPERTY_ID, headers);
      }
      if (allRooms.length === 0) {
        apiError = 'getRooms returned no rooms';
      }
    } catch (e: any) {
      apiError = e?.message ?? 'Unknown error';
    }

    if (allRooms.length > 0) {
      let rooms = allRooms
        .filter((room: any) => room && room.roomBlocked !== true)
        .map(formatRoom)
        .filter((r: any) => r.roomID !== 'unknown' && !r.roomName.includes('(Remove BE)') && !r.roomTypeName.includes('(Remove BE)'))
        .filter((r, i, arr) => arr.findIndex((x) => x.roomID === r.roomID) === i);
      rooms = await mergePlaceholderRooms(rooms, today);
      return NextResponse.json({
        success: true,
        rooms,
        count: rooms.length,
        method: 'getRooms_all',
        checkIn: today,
        checkOut: tomorrow,
      });
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
