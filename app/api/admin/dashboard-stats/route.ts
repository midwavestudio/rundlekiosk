import { NextRequest, NextResponse } from 'next/server';
import { reservationHasTyeRatePlan } from '@/lib/cloudbeds-tye';
import { getCheckinRecords } from '@/lib/checkin-store';

export const dynamic = 'force-dynamic';

type Reservation = {
  reservationID?: string | number;
  endDate?: string;
  checkOutDate?: string;
};

function localYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoToLocalYmd(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return localYmd(d);
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

function extractReservationList(j: any): any[] {
  if (!j) return [];
  if (Array.isArray(j.data)) return j.data;
  if (Array.isArray(j.data?.reservations)) return j.data.reservations;
  if (Array.isArray(j.reservations)) return j.reservations;
  if (Array.isArray(j)) return j;
  return [];
}

async function fetchAllRoomsCount(apiBase: string, propertyID: string, headers: HeadersInit): Promise<number> {
  const seen = new Set<string>();
  const pageSize = 500;
  let pageNumber = 1;
  const maxPages = 50;

  for (;;) {
    const url = `${apiBase}/getRooms?propertyID=${encodeURIComponent(propertyID)}&pageNumber=${pageNumber}&pageSize=${pageSize}&includeRoomRelations=1`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) break;
    const data = await res.json();
    const batch = parseRoomsFromResponse(data);
    if (batch.length === 0) break;

    let newCount = 0;
    for (const room of batch) {
      const roomID = room.roomID ?? room.id ?? room.room_id ?? room.roomId ?? room.roomName;
      const roomName = room.roomName ?? room.name ?? room.room_name ?? room.roomNumber ?? roomID;
      const roomTypeName =
        room.roomTypeName ?? room.roomType ?? room.room_type ?? room.typeName ?? room.type ?? 'Standard Room';

      const id = roomID != null ? String(roomID) : '';
      const name = roomName != null ? String(roomName) : '';
      const type = roomTypeName != null ? String(roomTypeName) : '';
      if (!id || name.includes('(Remove BE)') || type.includes('(Remove BE)')) continue;
      if (!seen.has(id)) {
        seen.add(id);
        newCount++;
      }
    }
    if (newCount === 0) break;
    pageNumber++;
    if (pageNumber > maxPages) break;
  }
  return seen.size;
}

async function fetchStayingCheckedInOccupancy(
  apiBase: string,
  propertyID: string,
  headers: HeadersInit,
  todayYmd: string
): Promise<{ totalInHouse: number; tyeInHouse: number }> {
  const seenTotal = new Set<string>();
  const seenTye = new Set<string>();
  const pageSize = 500;
  let pageNumber = 1;
  const maxPages = 50;

  for (;;) {
    const qs = new URLSearchParams({
      propertyID,
      status: 'checked_in',
      pageNumber: String(pageNumber),
      pageSize: String(pageSize),
      includeAllRooms: 'true',
      sortByRecent: 'true',
    });
    const url = `${apiBase}/getReservations?${qs.toString()}`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) break;
    const data = await res.json();
    const list = extractReservationList(data) as Reservation[];
    if (list.length === 0) break;

    let newTotal = 0;
    for (const r of list) {
      const out = String(r.endDate ?? r.checkOutDate ?? '').trim();
      if (out && out < todayYmd) continue;
      const id = String(r.reservationID ?? '').trim();
      if (!id || seenTotal.has(id)) continue;
      seenTotal.add(id);
      newTotal++;
      if (reservationHasTyeRatePlan(r)) seenTye.add(id);
    }
    if (newTotal === 0 && list.length < pageSize) break;
    if (list.length < pageSize) break;
    pageNumber++;
    if (pageNumber > maxPages) break;
  }

  return { totalInHouse: seenTotal.size, tyeInHouse: seenTye.size };
}

export async function GET(_request: NextRequest) {
  try {
    const todayYmd = localYmd(new Date());

    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

    const baseUrl = CLOUDBEDS_API_URL.replace(/\/v1\.\d+\/?$/, '');
    const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;
    const headers: HeadersInit = {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/json',
    };

    /** TYE rate plan / TYE source — shown on the In House stat card */
    let inHouse = 0;
    /** All checked-in stays still on-property — drives Available rooms */
    let totalOccupied = 0;
    let totalRooms = 60;

    if (CLOUDBEDS_API_KEY && CLOUDBEDS_PROPERTY_ID) {
      const [occupancy, roomCount] = await Promise.all([
        fetchStayingCheckedInOccupancy(apiV13, CLOUDBEDS_PROPERTY_ID, headers, todayYmd),
        fetchAllRoomsCount(apiV13, CLOUDBEDS_PROPERTY_ID, headers),
      ]);
      inHouse = occupancy.tyeInHouse;
      totalOccupied = occupancy.totalInHouse;
      if (roomCount > 0) totalRooms = roomCount;
    }

    const from = new Date();
    from.setDate(from.getDate() - 45);
    const records = await getCheckinRecords({ from: localYmd(from), to: todayYmd, limit: 1000 });
    const arrivalsToday = records.filter((r) => isoToLocalYmd(r.checkInTime) === todayYmd).length;
    const departedToday = records.filter((r) => isoToLocalYmd(r.checkOutTime) === todayYmd).length;

    return NextResponse.json({
      success: true,
      stats: {
        inHouse,
        totalRooms,
        available: Math.max(totalRooms - totalOccupied, 0),
        arrivalsToday,
        departedToday,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Could not load dashboard stats' },
      { status: 500 }
    );
  }
}

