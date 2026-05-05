import { NextRequest, NextResponse } from 'next/server';
import { getTyeSourceIdSet } from '@/lib/cloudbeds-tye';
import { mergeReservationRoomRows } from '@/lib/cloudbeds-rate-preserve';
import { formatCloudbedsRoomNameLabel } from '@/lib/room-display';
import { getCheckinRecords, type CheckinRecord } from '@/lib/checkin-store';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Server-side stats cache — avoids hammering Firestore + Cloudbeds on every
// dashboard poll. Stats are stale-tolerant; 5 min TTL is fine.
// ---------------------------------------------------------------------------
interface StatsCache {
  payload: object;
  expiresAt: number;
}
let statsCache: StatsCache | null = null;
const STATS_CACHE_TTL_MS = 5 * 60_000; // 5 minutes

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

function normalizeRoomKey(s: string): string {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/^room\s*/i, '')
    .replace(/^#/, '')
    .replace(/\s+/g, '');
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
  if (!j || j.success === false) return [];
  if (Array.isArray(j.data)) return j.data;
  if (Array.isArray(j.data?.reservations)) return j.data.reservations;
  if (Array.isArray(j.data?.data)) return j.data.data;
  if (j.data && typeof j.data === 'object' && !Array.isArray(j.data)) {
    const inner = (j.data as any).reservations ?? (j.data as any).list ?? (j.data as any).results;
    if (Array.isArray(inner)) return inner;
  }
  if (Array.isArray(j.reservations)) return j.reservations;
  if (Array.isArray(j)) return j;
  return [];
}

/** IDs + normalized room labels from getRooms for matching sparse getReservations list rows. */
interface SellableInventory {
  ids: Set<string>;
  nameKeys: Set<string>;
}

async function fetchSellableInventory(
  apiBase: string,
  propertyID: string,
  headers: HeadersInit
): Promise<SellableInventory> {
  const ids = new Set<string>();
  const nameKeys = new Set<string>();
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

      if (!ids.has(id)) {
        ids.add(id);
        newCount++;
      }
      const nk = normalizeRoomKey(name);
      if (nk) nameKeys.add(nk);
      const pretty = formatCloudbedsRoomNameLabel(name);
      if (pretty !== '—') {
        const pk = normalizeRoomKey(pretty);
        if (pk) nameKeys.add(pk);
      }
      const idAsKey = normalizeRoomKey(id);
      if (idAsKey) nameKeys.add(idAsKey);
    }
    if (newCount === 0) break;
    pageNumber++;
    if (pageNumber > maxPages) break;
  }
  return { ids, nameKeys };
}

/** Assigned / rooms / roomList — list payloads differ by endpoint/version. */
function allReservationRoomRows(r: any): any[] {
  const rows = [...mergeReservationRoomRows(r)];
  const rl = r?.roomList;
  if (Array.isArray(rl)) {
    for (const x of rl) {
      if (x && typeof x === 'object') rows.push(x);
    }
  }
  return rows;
}

function rowTouchesSellable(row: any, sellable: SellableInventory): boolean {
  if (!row || typeof row !== 'object') return false;
  const idCandidates = [row.roomID, row.roomId, row.id].filter((x) => x != null && String(x).trim() !== '');
  for (const raw of idCandidates) {
    const id = String(raw).trim();
    if (sellable.ids.has(id)) return true;
    const nk = normalizeRoomKey(id);
    if (nk && sellable.nameKeys.has(nk)) return true;
  }
  const nameCandidates = [row.roomName, row.name, row.roomNumber, row.roomLabel].filter(Boolean).map(String);
  for (const n of nameCandidates) {
    const nk = normalizeRoomKey(n);
    if (nk && sellable.nameKeys.has(nk)) return true;
    const pretty = formatCloudbedsRoomNameLabel(n);
    if (pretty !== '—') {
      const pk = normalizeRoomKey(pretty);
      if (pk && sellable.nameKeys.has(pk)) return true;
    }
  }
  return false;
}

function reservationOccupiesSellableRoom(r: any, sellable: SellableInventory): boolean {
  for (const row of allReservationRoomRows(r)) {
    if (rowTouchesSellable(row, sellable)) return true;
  }
  const topFields = [
    r?.roomName,
    r?.assignedRoomName,
    r?.room?.roomName,
    r?.rooms?.[0]?.roomName,
    typeof r?.room === 'string' ? r.room : null,
  ].filter(Boolean) as string[];
  for (const n of topFields) {
    const nk = normalizeRoomKey(String(n));
    if (nk && sellable.nameKeys.has(nk)) return true;
    const pretty = formatCloudbedsRoomNameLabel(String(n));
    if (pretty !== '—') {
      const pk = normalizeRoomKey(pretty);
      if (pk && sellable.nameKeys.has(pk)) return true;
    }
  }
  return false;
}

const ACTIVE_TYE_WINDOW_DAYS = 45;

/** Firestore is authoritative for kiosk TYE when Cloudbeds list rows omit rate/email (TYE shows 0 otherwise). */
function countActiveTyeInHouseFromRecords(records: CheckinRecord[], oldestCheckInMs: number): number {
  const seen = new Set<string>();
  let n = 0;
  for (const r of records) {
    if (String(r.class ?? '').toUpperCase() !== 'TYE' || r.checkOutTime) continue;
    const t = r.checkInTime ? new Date(r.checkInTime).getTime() : 0;
    if (t < oldestCheckInMs) continue;
    const key = r.cloudbedsReservationID
      ? `res:${r.cloudbedsReservationID}`
      : `g:${r.firstName}|${r.lastName}|${r.checkInTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    n++;
  }
  return n;
}

/**
 * Kiosk Firestore rows store human room labels; when Cloudbeds list payloads omit room IDs,
 * occupancy from the API undercounts. Count active TYE guests whose room label maps to sellable inventory.
 */
function countSellableOccupancyHintFromRecords(records: CheckinRecord[], sellable: SellableInventory): number {
  const seen = new Set<string>();
  let n = 0;
  for (const r of records) {
    if (r.checkOutTime) continue;
    if (String(r.class ?? '').toUpperCase() !== 'TYE') continue;
    const rawRoom = String(r.roomNumber ?? '').trim();
    const matchedById = Boolean(rawRoom && sellable.ids.has(rawRoom));
    const roomCandidates = [
      normalizeRoomKey(rawRoom),
      normalizeRoomKey(formatCloudbedsRoomNameLabel(rawRoom)),
    ].filter(Boolean);
    const matchedByName = roomCandidates.some((k) => sellable.nameKeys.has(k));
    if (!matchedById && !matchedByName) continue;
    const dedupe = r.cloudbedsReservationID
      ? `res:${r.cloudbedsReservationID}`
      : `g:${r.firstName}|${r.lastName}|${r.checkInTime}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    n++;
  }
  return n;
}

async function fetchStayingCheckedInStats(
  apiBase: string,
  propertyID: string,
  headers: HeadersInit,
  todayYmd: string,
  sellable: SellableInventory
): Promise<{ totalInHouseSellable: number }> {
  const seenReservation = new Set<string>();
  let totalInHouseSellable = 0;
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

      if (reservationOccupiesSellableRoom(r, sellable)) {
        totalInHouseSellable++;
      }
    }
    if (list.length < pageSize) break;
    pageNumber++;
    if (pageNumber > maxPages) break;
  }

  return { totalInHouseSellable };
}

/**
 * Count in-house TYE reservations using only checked-in rows filtered by known TYE source IDs.
 * This avoids scanning/classifying all checked-in reservations with heuristic matching.
 */
async function fetchTyeInHouseBySource(
  apiBase: string,
  propertyID: string,
  headers: HeadersInit,
  todayYmd: string
): Promise<number> {
  const tyeSources = Array.from(getTyeSourceIdSet()).filter(Boolean);
  if (tyeSources.length === 0) return 0;

  const seenReservation = new Set<string>();
  const pageSize = 500;
  const maxPages = 50;

  for (const sourceID of tyeSources) {
    let pageNumber = 1;
    for (;;) {
      const qs = new URLSearchParams({
        propertyID,
        status: 'checked_in',
        sourceID,
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
      }

      if (list.length < pageSize) break;
      pageNumber++;
      if (pageNumber > maxPages) break;
    }
  }

  return seenReservation.size;
}

export async function GET(_request: NextRequest) {
  try {
    const now = Date.now();
    if (statsCache && now < statsCache.expiresAt) {
      return NextResponse.json(statsCache.payload, {
        headers: { 'Cache-Control': 'private, max-age=300' },
      });
    }

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

    const from = new Date();
    from.setDate(from.getDate() - ACTIVE_TYE_WINDOW_DAYS);
    const fromYmd = localYmd(from);
    const records = await getCheckinRecords({ from: fromYmd, to: todayYmd, limit: 1000 });
    const arrivalsToday = records.filter((r) => isoToLocalYmd(r.checkInTime) === todayYmd).length;
    const departedToday = records.filter((r) => isoToLocalYmd(r.checkOutTime) === todayYmd).length;

    const oldestTyeMs = from.getTime();

    if (CLOUDBEDS_API_KEY && CLOUDBEDS_PROPERTY_ID) {
      const sellable = await fetchSellableInventory(apiV13, CLOUDBEDS_PROPERTY_ID, headers);
      totalRooms = Math.max(sellable.ids.size, 1);

      const occupancy = await fetchStayingCheckedInStats(
        apiV13,
        CLOUDBEDS_PROPERTY_ID,
        headers,
        todayYmd,
        sellable
      );
      const tyeInHouseCloudbeds = await fetchTyeInHouseBySource(
        apiV13,
        CLOUDBEDS_PROPERTY_ID,
        headers,
        todayYmd
      );
      const tyeFromFirestore = countActiveTyeInHouseFromRecords(records, oldestTyeMs);
      inHouse = Math.max(tyeInHouseCloudbeds, tyeFromFirestore);
      const occupancyFromFirestore = countSellableOccupancyHintFromRecords(records, sellable);
      totalOccupiedSellable = Math.max(occupancy.totalInHouseSellable, occupancyFromFirestore);
      available = Math.max(totalRooms - totalOccupiedSellable, 0);
    } else {
      inHouse = countActiveTyeInHouseFromRecords(records, oldestTyeMs);
    }

    const payload = {
      success: true,
      stats: {
        inHouse,
        totalRooms,
        available,
        arrivalsToday,
        departedToday,
      },
    };
    statsCache = { payload, expiresAt: Date.now() + STATS_CACHE_TTL_MS };

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, max-age=300' },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Could not load dashboard stats' },
      { status: 500 }
    );
  }
}
