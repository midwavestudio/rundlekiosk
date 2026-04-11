import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/all-rooms
 *
 * Returns EVERY physical room configured in the Cloudbeds property, with NO
 * availability/occupancy filtering. This is intended for admin tools (e.g. the
 * Blocks page) that need to see all rooms so staff can choose which ones to
 * pre-block — regardless of what is booked tonight.
 *
 * Each room returned:
 *   roomID       – Cloudbeds internal room ID
 *   roomName     – human-readable room name (e.g. "301", "Bath King 220")
 *   roomTypeName – room type label
 */
export async function GET(_request: NextRequest) {
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL =
      process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json({ success: false, error: 'Cloudbeds credentials not configured' }, { status: 503 });
    }

    const baseUrl = CLOUDBEDS_API_URL.replace(/\/v1\.\d+\/?$/, '');
    const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;
    const headers: HeadersInit = {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/json',
    };

    // Paginate through all rooms (Cloudbeds default pageSize is 20).
    const rooms = await fetchAllRooms(apiV13, CLOUDBEDS_PROPERTY_ID, headers);

    const formatted = rooms
      .map(formatRoom)
      .filter(
        (r) =>
          r.roomID !== 'unknown' &&
          !r.roomName.includes('(Remove BE)') &&
          !r.roomTypeName.includes('(Remove BE)')
      )
      // Deduplicate by roomID
      .filter((r, i, arr) => arr.findIndex((x) => x.roomID === r.roomID) === i);

    return NextResponse.json({ success: true, rooms: formatted, count: formatted.length });
  } catch (err: any) {
    console.error('admin/all-rooms error:', err);
    return NextResponse.json({ success: false, error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

function formatRoom(room: any): { roomID: string; roomName: string; roomTypeName: string } {
  const roomID = room.roomID ?? room.id ?? room.room_id ?? room.roomId ?? room.roomName;
  const roomName = room.roomName ?? room.name ?? room.room_name ?? room.roomNumber ?? roomID;
  const roomTypeName =
    room.roomTypeName ?? room.roomType ?? room.room_type ?? room.typeName ?? room.type ?? 'Standard Room';
  return {
    roomID: roomID != null ? String(roomID) : 'unknown',
    roomName: roomName != null ? String(roomName) : 'Unknown',
    roomTypeName: roomTypeName != null ? String(roomTypeName) : 'Standard Room',
  };
}

async function fetchAllRooms(apiBase: string, propertyID: string, headers: HeadersInit): Promise<any[]> {
  const merged: any[] = [];
  const seen = new Set<string>();
  const pageSize = 500;
  let pageNumber = 1;
  const maxPages = 50;

  for (;;) {
    const url = `${apiBase}/getRooms?propertyID=${encodeURIComponent(propertyID)}&pageNumber=${pageNumber}&pageSize=${pageSize}&includeRoomRelations=1`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      if (pageNumber === 1) break;
      break;
    }
    const data = await res.json();
    const batch = parseRoomsFromResponse(data);
    if (batch.length === 0) break;

    let newCount = 0;
    for (const room of batch) {
      const id = String(room?.roomID ?? room?.id ?? '');
      const key = id || `${room?.roomName ?? ''}-${room?.roomTypeID ?? ''}`;
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(room);
        newCount++;
      }
    }
    if (newCount === 0) break;
    pageNumber++;
    if (pageNumber > maxPages) break;
  }
  return merged;
}

function parseRoomsFromResponse(data: any): any[] {
  let rooms: any[] = [];
  if (Array.isArray(data.data) && data.data.length > 0) {
    rooms = data.data.flatMap((d: any) =>
      d && Array.isArray(d.rooms) ? d.rooms : d.rooms ? [d.rooms] : []
    );
  }
  if (rooms.length === 0 && data.data?.[0]?.rooms) rooms = data.data[0].rooms;
  if (rooms.length === 0 && Array.isArray(data.data)) rooms = data.data;
  if (rooms.length === 0 && Array.isArray(data.rooms)) rooms = data.rooms;
  if (rooms.length === 0 && Array.isArray(data)) rooms = data;
  if (rooms.length === 0 && data.data) rooms = [data.data];
  return rooms;
}
