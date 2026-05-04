import { NextRequest, NextResponse } from 'next/server';
import { reservationLooksLikeTyeStayForStats } from '@/lib/cloudbeds-tye';
import { mergeReservationRoomRows } from '@/lib/cloudbeds-rate-preserve';
import { getCheckinRecords } from '@/lib/checkin-store';

export const dynamic = 'force-dynamic';

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

/** OTA / blocking pseudo-room types — exclude from sellable inventory + occupancy math */
function isExcludedSellableInventory(roomName: string, roomTypeName: string): boolean {
  const n = (roomName || '').toLowerCase();
  const t = (roomTypeName || '').toLowerCase();
  if (n.includes('remove be') || t.includes('remove be')) return true;
  if ((n.includes('expedia') || t.includes('expedia')) && (n.includes('remove') || t.includes('remove')))
    return true;
  return false;
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
  if (Array.isArray(j.data?.data)) return j.data.data;
  if (Array.isArray(j.reservations)) return j.reservations;
  if (Array.isArray(j)) return j;
  return [];
}

async function fetchSellableRoomIdSet(
  apiBase: string,
  propertyID: string,
  headers: HeadersInit
): Promise<Set<string>> {
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

      const id = roomID != null ? String(roomID).trim() : '';
      const name = roomName != null ? String(roomName) : '';
      const type = roomTypeName != null ? String(roomTypeName) : '';
      if (!id || isExcludedSellableInventory(name, type)) continue;
      if (!seen.has(id)) {
        seen.add(id);
        newCount++;
      }
    }
    if (newCount === 0) break;
    pageNumber++;
    if (pageNumber > maxPages) break;
  }
  return seen;
}

function extractPhysicalRoomIdsFromReservationRow(r: any): string[] {
  const ids: string[] = [];
  for (const row of mergeReservationRoomRows(r)) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as any).roomID ?? (row as any).roomId ?? (row as any).id;
    if (id != null && String(id).trim()) ids.push(String(id).trim());
  }
  const top = r?.roomID ?? r?.roomId;
  if (top != null && String(top).trim()) ids.push(String(top).trim());
  return [...new Set(ids)];
}

function reservationOccupiesSellableRoom(r: any, sellableIds: Set<string>): boolean {
  const ids = extractPhysicalRoomIdsFromReservationRow(r);
  if (ids.length === 0) return false;
  return ids.some((id) => sellableIds.has(id));
}

async function fetchStayingCheckedInStats(
  apiBase: string,
  propertyID: string,
  headers: HeadersInit,
  todayYmd: string,
  sellableRoomIds: Set<string>
): Promise<{ totalInHouseSellable: number; tyeInHouse: number }> {
  const seenReservation = new Set<string>();
  let totalInHouseSellable = 0;
  let tyeInHouse = 0;
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
    const list = extractReservationList(data);
    if (list.length === 0) break;

    for (const r of list) {
      const out = String(r.endDate ?? r.checkOutDate ?? '').trim();
      if (out && out < todayYmd) continue;
      const id = String(r.reservationID ?? '').trim();
      if (!id || seenReservation.has(id)) continue;
      seenReservation.add(id);

      if (reservationOccupiesSellableRoom(r, sellableRoomIds)) {
        totalInHouseSellable++;
      }
      if (reservationLooksLikeTyeStayForStats(r)) {
        tyeInHouse++;
      }
    }
    if (list.length < pageSize) break;
    pageNumber++;
    if (pageNumber > maxPages) break;
  }

  return { totalInHouseSellable, tyeInHouse };
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

    let inHouse = 0;
    let totalOccupiedSellable = 0;
    let totalRooms = 60;
    let available = 0;

    if (CLOUDBEDS_API_KEY && CLOUDBEDS_PROPERTY_ID) {
      const sellableIds = await fetchSellableRoomIdSet(apiV13, CLOUDBEDS_PROPERTY_ID, headers);
      totalRooms = Math.max(sellableIds.size, 1);

      const occupancy = await fetchStayingCheckedInStats(
        apiV13,
        CLOUDBEDS_PROPERTY_ID,
        headers,
        todayYmd,
        sellableIds
      );
      inHouse = occupancy.tyeInHouse;
      totalOccupiedSellable = occupancy.totalInHouseSellable;
      available = Math.max(totalRooms - totalOccupiedSellable, 0);
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
        available,
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
