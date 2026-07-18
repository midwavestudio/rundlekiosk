import { NextRequest, NextResponse } from 'next/server';

// ─── Imports from former sub-routes ─────────────────────────────────────────
import { probeFirestoreHealth, type FirestoreHealth } from '@/lib/checkin-store';
import { getTyeSourceIdSet, reservationHasTyeRatePlan } from '@/lib/cloudbeds-tye';
import { mergeReservationRoomRows } from '@/lib/cloudbeds-rate-preserve';
import { formatCloudbedsRoomNameLabel } from '@/lib/room-display';
import { getCheckinRecords, type CheckinRecord, updateCheckinRecord, findByReservationID } from '@/lib/checkin-store';
import { dedupePickerRoomsByDisplayLabel } from '@/lib/room-picker-dedupe';
import {
  getPlaceholdersForDates,
  getPlaceholdersByDate,
  getPlaceholderByReservationID,
  updatePlaceholder,
  saveTyeBlockPlaceholderOrThrow,
  type PlaceholderStatus,
} from '@/lib/tye-placeholder-store';
import { cancelTyeBlockReservationInCloudbeds, performCloudbedsCheckIn } from '@/lib/cloudbeds-checkin';
import { unwrapReservationFromGetReservation } from '@/lib/cloudbeds-rate-preserve';
import * as firebaseAdmin from 'firebase-admin';

export const dynamic = 'force-dynamic';

// ─── Shared helpers ──────────────────────────────────────────────────────────

function apiV13Base(): string {
  const raw = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
  const base = raw.replace(/\/v1\.\d+\/?$/, '');
  return `${base.replace(/\/$/, '')}/v1.3`;
}

function localYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function mergePlaceholderQueryDates(request: NextRequest): string[] {
  const now = new Date();
  const todayStr = localYmd(now);
  const tomorrowStr = localYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const set = new Set<string>([todayStr, tomorrowStr]);
  for (const d of request.nextUrl.searchParams.getAll('date')) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
  }
  return [...set].sort();
}

// ─── firebase-status cache ───────────────────────────────────────────────────
interface ProbeCache { result: FirestoreHealth; expiresAt: number; }
let probeCache: ProbeCache | null = null;

// ─── dashboard-stats cache ───────────────────────────────────────────────────
interface StatsCache { payload: object; expiresAt: number; }
let statsCache: StatsCache | null = null;
const STATS_CACHE_TTL_MS = 15 * 60_000;
const ACTIVE_TYE_WINDOW_DAYS = 45;

// ─── GET dispatcher ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action');

  switch (action) {
    case 'firebase-status': return handleFirebaseStatus();
    case 'dashboard-stats': return handleDashboardStats();
    case 'all-rooms':       return handleAllRooms();
    case 'sync-tye-placeholders': return handleSyncTyePlaceholdersGet(request);
    default:
      return NextResponse.json(
        { success: false, error: 'Unknown action. Use ?action=firebase-status|dashboard-stats|all-rooms|sync-tye-placeholders' },
        { status: 400 }
      );
  }
}

// ─── POST dispatcher ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action');

  switch (action) {
    case 'sync-tye-placeholders':   return handleSyncTyePlaceholdersPost(request);
    case 'create-tye-placeholders': return handleCreateTyePlaceholders(request);
    case 'cancel-tye-placeholder':  return handleCancelTyePlaceholder(request);
    case 'reassign-room':           return handleReassignRoom(request);
    case 'backfill-checkin-dates':  return handleBackfillCheckinDates();
    case 'retry-checkins':          return handleRetryCheckins();
    default:
      return NextResponse.json(
        { success: false, error: 'Unknown action. Use ?action=sync-tye-placeholders|create-tye-placeholders|cancel-tye-placeholder|reassign-room|backfill-checkin-dates|retry-checkins' },
        { status: 400 }
      );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// firebase-status
// ════════════════════════════════════════════════════════════════════════════

async function handleFirebaseStatus() {
  const now = Date.now();
  if (probeCache && now < probeCache.expiresAt) {
    const { result } = probeCache;
    return NextResponse.json(result, {
      status: result.connected ? 200 : 503,
      headers: { 'Cache-Control': 'private, max-age=600' },
    });
  }
  const status = await probeFirestoreHealth();
  const ttl = status.connected ? 10 * 60_000 : 2 * 60_000;
  probeCache = { result: status, expiresAt: now + ttl };
  return NextResponse.json(status, {
    status: status.connected ? 200 : 503,
    headers: { 'Cache-Control': 'private, max-age=600' },
  });
}

// ════════════════════════════════════════════════════════════════════════════
// dashboard-stats
// ════════════════════════════════════════════════════════════════════════════

function isoToLocalYmd(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return localYmd(d);
}

function isExcludedSellableInventory(roomName: string, roomTypeName: string): boolean {
  const n = (roomName || '').toLowerCase();
  const t = (roomTypeName || '').toLowerCase();
  if (n.includes('remove be') || t.includes('remove be')) return true;
  if ((n.includes('expedia') || t.includes('expedia')) && (n.includes('remove') || t.includes('remove'))) return true;
  return false;
}

function normalizeRoomKey(s: string): string {
  return String(s).trim().toLowerCase().replace(/^room\s*/i, '').replace(/^#/, '').replace(/\s+/g, '');
}

interface SellableInventory { ids: Set<string>; nameKeys: Set<string>; }

async function fetchSellableInventory(apiBase: string, propertyID: string, headers: HeadersInit): Promise<SellableInventory> {
  const ids = new Set<string>();
  const nameKeys = new Set<string>();
  const pageSize = 500;
  let pageNumber = 1;
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
      const roomTypeName = room.roomTypeName ?? room.roomType ?? room.room_type ?? room.typeName ?? room.type ?? 'Standard Room';
      const id = roomID != null ? String(roomID).trim() : '';
      const name = roomName != null ? String(roomName) : '';
      const type = roomTypeName != null ? String(roomTypeName) : '';
      if (!id || isExcludedSellableInventory(name, type)) continue;
      if (!ids.has(id)) { ids.add(id); newCount++; }
      const nk = normalizeRoomKey(name);
      if (nk) nameKeys.add(nk);
      const pretty = formatCloudbedsRoomNameLabel(name);
      if (pretty !== '—') { const pk = normalizeRoomKey(pretty); if (pk) nameKeys.add(pk); }
      const idAsKey = normalizeRoomKey(id);
      if (idAsKey) nameKeys.add(idAsKey);
    }
    if (newCount === 0) break;
    pageNumber++;
    if (pageNumber > 50) break;
  }
  return { ids, nameKeys };
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

function allReservationRoomRows(r: any): any[] {
  const rows = [...mergeReservationRoomRows(r)];
  const rl = r?.roomList;
  if (Array.isArray(rl)) { for (const x of rl) { if (x && typeof x === 'object') rows.push(x); } }
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
    if (pretty !== '—') { const pk = normalizeRoomKey(pretty); if (pk && sellable.nameKeys.has(pk)) return true; }
  }
  return false;
}

function reservationOccupiesSellableRoom(r: any, sellable: SellableInventory): boolean {
  for (const row of allReservationRoomRows(r)) { if (rowTouchesSellable(row, sellable)) return true; }
  const topFields = [r?.roomName, r?.assignedRoomName, r?.room?.roomName, r?.rooms?.[0]?.roomName, typeof r?.room === 'string' ? r.room : null].filter(Boolean) as string[];
  for (const n of topFields) {
    const nk = normalizeRoomKey(String(n));
    if (nk && sellable.nameKeys.has(nk)) return true;
    const pretty = formatCloudbedsRoomNameLabel(String(n));
    if (pretty !== '—') { const pk = normalizeRoomKey(pretty); if (pk && sellable.nameKeys.has(pk)) return true; }
  }
  return false;
}

function countActiveTyeInHouseFromRecords(records: CheckinRecord[], oldestCheckInMs: number): number {
  const seen = new Set<string>();
  let n = 0;
  for (const r of records) {
    if (String(r.class ?? '').toUpperCase() !== 'TYE' || r.checkOutTime) continue;
    const t = r.checkInTime ? new Date(r.checkInTime).getTime() : 0;
    if (t < oldestCheckInMs) continue;
    const key = r.cloudbedsReservationID ? `res:${r.cloudbedsReservationID}` : `g:${r.firstName}|${r.lastName}|${r.checkInTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    n++;
  }
  return n;
}

function countSellableOccupancyHintFromRecords(records: CheckinRecord[], sellable: SellableInventory): number {
  const seen = new Set<string>();
  let n = 0;
  for (const r of records) {
    if (r.checkOutTime) continue;
    if (String(r.class ?? '').toUpperCase() !== 'TYE') continue;
    const rawRoom = String(r.roomNumber ?? '').trim();
    const matchedById = Boolean(rawRoom && sellable.ids.has(rawRoom));
    const roomCandidates = [normalizeRoomKey(rawRoom), normalizeRoomKey(formatCloudbedsRoomNameLabel(rawRoom))].filter(Boolean);
    const matchedByName = roomCandidates.some((k) => sellable.nameKeys.has(k));
    if (!matchedById && !matchedByName) continue;
    const dedupe = r.cloudbedsReservationID ? `res:${r.cloudbedsReservationID}` : `g:${r.firstName}|${r.lastName}|${r.checkInTime}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    n++;
  }
  return n;
}

async function fetchStayingCheckedInStats(apiBase: string, propertyID: string, headers: HeadersInit, todayYmd: string, sellable: SellableInventory): Promise<{ totalInHouseSellable: number }> {
  const seenReservation = new Set<string>();
  let totalInHouseSellable = 0;
  let pageNumber = 1;
  for (;;) {
    const qs = new URLSearchParams({ propertyID, status: 'checked_in', pageNumber: String(pageNumber), pageSize: '500', includeAllRooms: 'true', sortByRecent: 'true' });
    const res = await fetch(`${apiBase}/getReservations?${qs}`, { method: 'GET', headers });
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
      if (reservationOccupiesSellableRoom(r, sellable)) totalInHouseSellable++;
    }
    if (list.length < 500) break;
    pageNumber++;
    if (pageNumber > 50) break;
  }
  return { totalInHouseSellable };
}

async function fetchTyeInHouseBySource(apiBase: string, propertyID: string, headers: HeadersInit, todayYmd: string): Promise<number> {
  const tyeSourceSet = getTyeSourceIdSet();
  const tyeSources = Array.from(tyeSourceSet).filter(Boolean);
  if (tyeSources.length === 0) return 0;
  const seenReservation = new Set<string>();
  for (const sourceID of tyeSources) {
    let pageNumber = 1;
    for (;;) {
      const qs = new URLSearchParams({ propertyID, status: 'checked_in', sourceID, pageNumber: String(pageNumber), pageSize: '500', includeAllRooms: 'true', sortByRecent: 'true' });
      const res = await fetch(`${apiBase}/getReservations?${qs}`, { method: 'GET', headers });
      if (!res.ok) break;
      const data = await res.json();
      const list = extractReservationList(data);
      if (list.length === 0) break;
      for (const r of list) {
        const out = String(r.endDate ?? r.checkOutDate ?? '').trim();
        if (out && out < todayYmd) continue;
        const id = String(r.reservationID ?? '').trim();
        if (!id || seenReservation.has(id)) continue;
        const rowSource = String(r.sourceID ?? r.source_id ?? r.sourceId ?? '').trim();
        if (rowSource && !tyeSourceSet.has(rowSource)) continue;
        seenReservation.add(id);
      }
      if (list.length < 500) break;
      pageNumber++;
      if (pageNumber > 50) break;
    }
  }
  return seenReservation.size;
}

async function fetchTyeInHouseCheckedInHeuristic(apiBase: string, propertyID: string, headers: HeadersInit, todayYmd: string): Promise<number> {
  const seenReservation = new Set<string>();
  let pageNumber = 1;
  for (;;) {
    const qs = new URLSearchParams({ propertyID, status: 'checked_in', pageNumber: String(pageNumber), pageSize: '500', includeAllRooms: 'true', sortByRecent: 'true' });
    const res = await fetch(`${apiBase}/getReservations?${qs}`, { method: 'GET', headers });
    if (!res.ok) break;
    const data = await res.json();
    const list = extractReservationList(data);
    if (list.length === 0) break;
    for (const r of list) {
      const out = String(r.endDate ?? r.checkOutDate ?? '').trim();
      if (out && out < todayYmd) continue;
      const id = String(r.reservationID ?? '').trim();
      if (!id || seenReservation.has(id)) continue;
      if (!reservationHasTyeRatePlan(r)) continue;
      seenReservation.add(id);
    }
    if (list.length < 500) break;
    pageNumber++;
    if (pageNumber > 50) break;
  }
  return seenReservation.size;
}

async function handleDashboardStats() {
  try {
    const now = Date.now();
    if (statsCache && now < statsCache.expiresAt) {
      return NextResponse.json(statsCache.payload, { headers: { 'Cache-Control': 'private, max-age=900' } });
    }
    const todayYmd = localYmd(new Date());
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
    const baseUrl = CLOUDBEDS_API_URL.replace(/\/v1\.\d+\/?$/, '');
    const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;
    const headers: HeadersInit = { Authorization: `Bearer ${CLOUDBEDS_API_KEY}`, 'Content-Type': 'application/json' };

    let inHouse = 0, totalOccupiedSellable = 0, totalRooms = 60, available = 0;
    const from = new Date();
    from.setDate(from.getDate() - ACTIVE_TYE_WINDOW_DAYS);
    const fromYmd = localYmd(from);
    const records = await getCheckinRecords({ from: fromYmd, to: todayYmd, limit: 500 });
    const arrivalsToday = records.filter((r) => isoToLocalYmd(r.checkInTime) === todayYmd).length;
    const departedToday = records.filter((r) => isoToLocalYmd(r.checkOutTime) === todayYmd).length;
    const oldestTyeMs = from.getTime();

    if (CLOUDBEDS_API_KEY && CLOUDBEDS_PROPERTY_ID) {
      const sellable = await fetchSellableInventory(apiV13, CLOUDBEDS_PROPERTY_ID, headers);
      totalRooms = Math.max(sellable.ids.size, 1);
      const occupancy = await fetchStayingCheckedInStats(apiV13, CLOUDBEDS_PROPERTY_ID, headers, todayYmd, sellable);
      const tyeSources = getTyeSourceIdSet();
      let tyeInHouseCloudbeds = await fetchTyeInHouseBySource(apiV13, CLOUDBEDS_PROPERTY_ID, headers, todayYmd);
      if (tyeSources.size === 0) {
        tyeInHouseCloudbeds = await fetchTyeInHouseCheckedInHeuristic(apiV13, CLOUDBEDS_PROPERTY_ID, headers, todayYmd);
      }
      inHouse = tyeInHouseCloudbeds;
      const occupancyFromFirestore = countSellableOccupancyHintFromRecords(records, sellable);
      totalOccupiedSellable = Math.max(occupancy.totalInHouseSellable, occupancyFromFirestore);
      available = Math.max(totalRooms - totalOccupiedSellable, 0);
    } else {
      inHouse = countActiveTyeInHouseFromRecords(records, oldestTyeMs);
    }

    const payload = { success: true, stats: { inHouse, totalRooms, available, arrivalsToday, departedToday } };
    statsCache = { payload, expiresAt: Date.now() + STATS_CACHE_TTL_MS };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=900' } });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? 'Could not load dashboard stats' }, { status: 500 });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// all-rooms
// ════════════════════════════════════════════════════════════════════════════

function formatRoom(room: any): { roomID: string; roomName: string; roomTypeName: string } {
  const roomID = room.roomID ?? room.id ?? room.room_id ?? room.roomId ?? room.roomName;
  const roomName = room.roomName ?? room.name ?? room.room_name ?? room.roomNumber ?? roomID;
  const roomTypeName = room.roomTypeName ?? room.roomType ?? room.room_type ?? room.typeName ?? room.type ?? 'Standard Room';
  return {
    roomID: roomID != null ? String(roomID) : 'unknown',
    roomName: roomName != null ? String(roomName) : 'Unknown',
    roomTypeName: roomTypeName != null ? String(roomTypeName) : 'Standard Room',
  };
}

async function fetchAllRooms(apiBase: string, propertyID: string, headers: HeadersInit): Promise<any[]> {
  const merged: any[] = [];
  const seen = new Set<string>();
  let pageNumber = 1;
  for (;;) {
    const url = `${apiBase}/getRooms?propertyID=${encodeURIComponent(propertyID)}&pageNumber=${pageNumber}&pageSize=500&includeRoomRelations=1`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) break;
    const data = await res.json();
    const batch = parseRoomsFromResponse(data);
    if (batch.length === 0) break;
    let newCount = 0;
    for (const room of batch) {
      const id = String(room?.roomID ?? room?.id ?? '');
      const key = id || `${room?.roomName ?? ''}-${room?.roomTypeID ?? ''}`;
      if (key && !seen.has(key)) { seen.add(key); merged.push(room); newCount++; }
    }
    if (newCount === 0) break;
    pageNumber++;
    if (pageNumber > 50) break;
  }
  return merged;
}

async function handleAllRooms() {
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json({ success: false, error: 'Cloudbeds credentials not configured' }, { status: 503 });
    }
    const baseUrl = CLOUDBEDS_API_URL.replace(/\/v1\.\d+\/?$/, '');
    const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;
    const headers: HeadersInit = { Authorization: `Bearer ${CLOUDBEDS_API_KEY}`, 'Content-Type': 'application/json' };
    const rawRooms = await fetchAllRooms(apiV13, CLOUDBEDS_PROPERTY_ID, headers);
    const formatted = rawRooms
      .map(formatRoom)
      .filter((r) => r.roomID !== 'unknown' && !r.roomName.includes('(Remove BE)') && !r.roomTypeName.includes('(Remove BE)'))
      .filter((r, i, arr) => arr.findIndex((x) => x.roomID === r.roomID) === i);
    const rooms = dedupePickerRoomsByDisplayLabel(formatted);
    return NextResponse.json({ success: true, rooms, count: rooms.length });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// sync-tye-placeholders (GET — read only)
// ════════════════════════════════════════════════════════════════════════════

async function handleSyncTyePlaceholdersGet(request: NextRequest) {
  try {
    const now = new Date();
    const todayStr = localYmd(now);
    const tomorrowStr = localYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const placeholders = await getPlaceholdersForDates(mergePlaceholderQueryDates(request));
    return NextResponse.json({
      success: true,
      today: todayStr,
      tomorrow: tomorrowStr,
      placeholders,
      counts: {
        available: placeholders.filter((p) => p.status === 'available').length,
        assigned: placeholders.filter((p) => p.status === 'assigned').length,
        externally_modified: placeholders.filter((p) => p.status === 'externally_modified').length,
        cancelled: placeholders.filter((p) => p.status === 'cancelled').length,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message ?? 'Internal server error' }, { status: 500 });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// sync-tye-placeholders (POST — triggers Cloudbeds sync)
// ════════════════════════════════════════════════════════════════════════════

function isObsoleteInteriorQueen100Duplicate(p: { roomName: string; roomTypeName: string }): boolean {
  const label = formatCloudbedsRoomNameLabel(p.roomName).toLowerCase();
  const type = p.roomTypeName.trim().toLowerCase().replace(/\s+/g, ' ');
  return label === '100' && type === 'interior queen';
}

function extractPrimaryRoomFromReservation(reservation: any): { roomID?: string; roomName?: string; roomTypeName?: string } {
  for (const key of ['assigned', 'rooms'] as const) {
    const arr = reservation?.[key];
    if (!Array.isArray(arr) || !arr[0] || typeof arr[0] !== 'object') continue;
    const r = arr[0] as Record<string, unknown>;
    const roomID = r.roomID != null ? String(r.roomID).trim() : '';
    const roomName = String(r.roomName ?? r.roomNumber ?? '').trim();
    const roomTypeName = String(r.roomTypeName ?? r.roomType ?? '').trim();
    return { ...(roomID ? { roomID } : {}), ...(roomName ? { roomName } : {}), ...(roomTypeName ? { roomTypeName } : {}) };
  }
  if (reservation?.roomID != null) {
    return { roomID: String(reservation.roomID).trim(), roomName: String(reservation.roomName ?? '').trim() || undefined, roomTypeName: String(reservation.roomTypeName ?? '').trim() || undefined };
  }
  return {};
}

async function handleSyncTyePlaceholdersPost(request: NextRequest) {
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
    const baseUrl = CLOUDBEDS_API_URL.replace(/\/v1\.\d+\/?$/, '');
    const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;
    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json({ success: false, error: 'Cloudbeds API credentials not configured' }, { status: 503 });
    }
    const headers = { Authorization: `Bearer ${CLOUDBEDS_API_KEY}`, 'Content-Type': 'application/json' };
    const placeholders = await getPlaceholdersForDates(mergePlaceholderQueryDates(request));
    if (placeholders.length === 0) {
      return NextResponse.json({ success: true, message: 'No placeholders to sync', changes: [] });
    }
    const changes: Array<{ placeholderID: string; reservationID: string; roomName: string; previousStatus: PlaceholderStatus; newStatus: PlaceholderStatus; cloudbedsStatus: string }> = [];
    const syncedAt = new Date().toISOString();

    for (const placeholder of placeholders) {
      if (placeholder.status === 'cancelled') continue;
      if (placeholder.status === 'available' && isObsoleteInteriorQueen100Duplicate(placeholder)) {
        await updatePlaceholder(placeholder.id, { lastSyncedAt: syncedAt, cloudbedsStatus: 'obsolete_duplicate_room_100', status: 'cancelled' });
        changes.push({ placeholderID: placeholder.id, reservationID: placeholder.reservationID, roomName: placeholder.roomName, previousStatus: placeholder.status, newStatus: 'cancelled', cloudbedsStatus: 'obsolete_duplicate_room_100' });
        continue;
      }
      try {
        const url = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(placeholder.reservationID)}`;
        const res = await fetch(url, { method: 'GET', headers });
        const rawText = await res.text();
        let data: any = {};
        try { data = JSON.parse(rawText); } catch { data = {}; }

        const messageStr = String(data?.message ?? '');
        const notFoundMsg = /not found|does not exist|invalid reservation|no reservation|unable to find|could not find/i.test(messageStr);
        const reservationGone = res.status === 404 || (res.ok && data.success === true && (data.data == null || data.data === '')) || (res.ok && data.success === false && notFoundMsg);

        if (reservationGone) {
          await updatePlaceholder(placeholder.id, { lastSyncedAt: syncedAt, cloudbedsStatus: 'gone', status: 'cancelled' } as any);
          changes.push({ placeholderID: placeholder.id, reservationID: placeholder.reservationID, roomName: placeholder.roomName, previousStatus: placeholder.status, newStatus: 'cancelled', cloudbedsStatus: 'gone' });
          continue;
        }
        if (!res.ok) continue;
        if (!data.success || !data.data) continue;

        const reservation = data.data;
        const cbStatus: string = String(reservation.status ?? reservation.reservationStatus ?? '').toLowerCase();
        const guestFirst: string = String(reservation.guestFirstName ?? reservation.guest?.firstName ?? '');
        const guestName: string = String(reservation.guestName ?? reservation.guest?.guestName ?? '');
        const isExternallyModified = (cbStatus !== 'confirmed' && cbStatus !== '') || (guestFirst.toLowerCase() !== 'tye' && guestFirst !== '' && !guestName.toLowerCase().includes('placeholder'));
        const isCancelled = cbStatus === 'cancelled' || cbStatus === 'canceled';

        let newStatus: PlaceholderStatus = placeholder.status;
        if (isCancelled) newStatus = 'cancelled';
        else if (isExternallyModified && placeholder.status === 'available') newStatus = 'externally_modified';

        const updates: Record<string, string> = { lastSyncedAt: syncedAt, cloudbedsStatus: cbStatus };
        if (newStatus !== placeholder.status) updates.status = newStatus;

        const liveRoom = extractPrimaryRoomFromReservation(reservation);
        if (liveRoom.roomID && liveRoom.roomID !== placeholder.roomID) updates.roomID = liveRoom.roomID;
        if (liveRoom.roomName && liveRoom.roomName !== placeholder.roomName) updates.roomName = liveRoom.roomName;
        if (liveRoom.roomTypeName && liveRoom.roomTypeName !== placeholder.roomTypeName) updates.roomTypeName = liveRoom.roomTypeName;

        await updatePlaceholder(placeholder.id, updates as any);
        if (newStatus !== placeholder.status) {
          changes.push({ placeholderID: placeholder.id, reservationID: placeholder.reservationID, roomName: placeholder.roomName, previousStatus: placeholder.status, newStatus, cloudbedsStatus: cbStatus });
        }
      } catch (err: any) {
        console.error(`Error syncing placeholder ${placeholder.reservationID}:`, err?.message);
      }
    }

    const now = new Date();
    const todayStr = localYmd(now);
    const tomorrowStr = localYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const refreshed = await getPlaceholdersForDates(mergePlaceholderQueryDates(request));
    return NextResponse.json({
      success: true, synced: placeholders.length, changes, syncedAt,
      today: todayStr, tomorrow: tomorrowStr, placeholders: refreshed,
      counts: { available: refreshed.filter((p) => p.status === 'available').length, assigned: refreshed.filter((p) => p.status === 'assigned').length, externally_modified: refreshed.filter((p) => p.status === 'externally_modified').length, cancelled: refreshed.filter((p) => p.status === 'cancelled').length },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message ?? 'Internal server error' }, { status: 500 });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// create-tye-placeholders
// ════════════════════════════════════════════════════════════════════════════

async function isPlaceholderReservationLiveInCloudbeds(apiV13: string, propertyID: string, apiKey: string, reservationID: string): Promise<boolean> {
  try {
    const url = `${apiV13}/getReservation?propertyID=${encodeURIComponent(propertyID)}&reservationID=${encodeURIComponent(reservationID)}`;
    const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
    if (!res.ok) return false;
    const parsed = await res.json();
    if (!parsed?.success) return false;
    const d = parsed.data ?? parsed;
    const status = String(d?.status ?? d?.reservationStatus ?? '').toLowerCase();
    if (status === 'cancelled' || status === 'canceled' || status === 'no_show') return false;
    return true;
  } catch { return false; }
}

function addOneDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return localYmd(dt);
}

async function handleCreateTyePlaceholders(request: NextRequest) {
  try {
    const cloudbedsApiKey = process.env.CLOUDBEDS_API_KEY;
    const cloudbedsPropertyId = process.env.CLOUDBEDS_PROPERTY_ID;
    if (!cloudbedsApiKey || !cloudbedsPropertyId) {
      return NextResponse.json({ success: false, error: 'Cloudbeds API credentials not configured' }, { status: 503 });
    }
    const cloudbedsApiUrl = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
    const baseUrl = cloudbedsApiUrl.replace(/\/v1\.\d+\/?$/, '');
    const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;

    const body = await request.json();
    const { roomIDs, dates: requestedDates, roomHints } = body as { roomIDs: string[]; dates?: string[]; roomHints?: Record<string, string> };
    if (!Array.isArray(roomIDs) || roomIDs.length === 0) {
      return NextResponse.json({ success: false, error: 'roomIDs must be a non-empty array' }, { status: 400 });
    }
    const now = new Date();
    const todayStr = localYmd(now);
    const dates: string[] = requestedDates && requestedDates.length > 0 ? requestedDates : [todayStr];
    const summary: Record<string, { created: string[]; skipped: string[]; failed: Array<{ roomID: string; error: string }> }> = {};

    for (const forDate of dates) {
      const checkOutDate = addOneDay(forDate);
      summary[forDate] = { created: [], skipped: [], failed: [] };
      for (const roomEntry of roomIDs) {
        const rid = String(roomEntry).trim();
        const hint = roomHints && typeof roomHints[rid] === 'string' && roomHints[rid].trim() !== '' ? roomHints[rid].trim() : undefined;
        const sameDatePlaceholders = await getPlaceholdersByDate(forDate);
        const matchingLocal = sameDatePlaceholders.filter((p) => {
          if (p.status === 'cancelled') return false;
          return String(p.roomID) === rid || (hint ? String(p.roomID) === hint : false);
        });
        if (matchingLocal.length > 0) {
          let hasLiveCloudbedsReservation = false;
          for (const placeholder of matchingLocal) {
            const stillLive = await isPlaceholderReservationLiveInCloudbeds(apiV13, cloudbedsPropertyId, cloudbedsApiKey, placeholder.reservationID);
            if (stillLive) { hasLiveCloudbedsReservation = true; break; }
            await updatePlaceholder(placeholder.id, { status: 'cancelled', cloudbedsStatus: 'cancelled', lastSyncedAt: new Date().toISOString() });
          }
          if (hasLiveCloudbedsReservation) { summary[forDate].skipped.push(rid); continue; }
        }
        let pendingCloudbedsReservationId: string | null = null;
        try {
          const result = await performCloudbedsCheckIn({ firstName: 'TYE', lastName: 'Block', phoneNumber: '000-000-0000', email: 'tye-placeholder@rundlesuites.internal', classType: 'TYE', roomName: rid, roomNameHint: hint, checkInDate: forDate, checkOutDate, stopAfterReservationCreate: true });
          pendingCloudbedsReservationId = result.reservationID;
          const storedRoomID = hint ?? rid;
          await saveTyeBlockPlaceholderOrThrow({ reservationID: result.reservationID, roomID: storedRoomID, roomName: result.roomName, roomTypeID: result.roomTypeID ?? '', roomTypeName: result.roomTypeName ?? 'Standard Room', forDate, checkOutDate, status: 'available', createdAt: new Date().toISOString(), ...(result.guestID ? { placeholderGuestID: result.guestID } : {}) });
          pendingCloudbedsReservationId = null;
          summary[forDate].created.push(rid);
        } catch (err: unknown) {
          let cancelledInCloudbeds = false;
          if (pendingCloudbedsReservationId) {
            cancelledInCloudbeds = await cancelTyeBlockReservationInCloudbeds(pendingCloudbedsReservationId);
          }
          let failMsg = err instanceof Error ? err.message : 'Unknown error';
          if (pendingCloudbedsReservationId) {
            failMsg = cancelledInCloudbeds ? `${failMsg} (The provisional Cloudbeds reservation for this room was cancelled.)` : `${failMsg} (Could not automatically cancel Cloudbeds reservation ${pendingCloudbedsReservationId} — cancel it in Cloudbeds if it still appears.)`;
          }
          summary[forDate].failed.push({ roomID: rid, error: failMsg });
        }
      }
    }

    const totalCreated = Object.values(summary).reduce((n, s) => n + s.created.length, 0);
    const totalFailed = Object.values(summary).reduce((n, s) => n + s.failed.length, 0);
    return NextResponse.json({ success: totalFailed === 0, summary, totalCreated, totalSkipped: Object.values(summary).reduce((n, s) => n + s.skipped.length, 0), totalFailed });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// cancel-tye-placeholder
// ════════════════════════════════════════════════════════════════════════════

async function getCloudbedsReservationState(reservationID: string): Promise<'active' | 'cancelled' | 'unknown'> {
  const apiKey = process.env.CLOUDBEDS_API_KEY;
  const propertyID = process.env.CLOUDBEDS_PROPERTY_ID;
  const apiUrl = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
  if (!apiKey || !propertyID) return 'unknown';
  const baseUrl = apiUrl.replace(/\/v1\.\d+\/?$/, '');
  const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;
  const url = `${apiV13}/getReservation?propertyID=${encodeURIComponent(propertyID)}&reservationID=${encodeURIComponent(reservationID)}`;
  try {
    const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
    if (!res.ok) return 'cancelled';
    const parsed = await res.json();
    if (!parsed?.success) return 'cancelled';
    const d = parsed.data ?? parsed;
    const status = String(d?.status ?? d?.reservationStatus ?? '').toLowerCase();
    if (status === 'cancelled' || status === 'canceled' || status === 'no_show') return 'cancelled';
    return 'active';
  } catch { return 'unknown'; }
}

async function handleCancelTyePlaceholder(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const reservationID = String(body?.reservationID ?? '').trim();
    if (!reservationID) return NextResponse.json({ success: false, error: 'reservationID is required' }, { status: 400 });

    const placeholder = await getPlaceholderByReservationID(reservationID);
    if (!placeholder) return NextResponse.json({ success: false, error: 'Placeholder reservation was not found in the app store.' }, { status: 404 });
    if (placeholder.status === 'assigned') return NextResponse.json({ success: false, error: 'This block is already assigned to a guest and cannot be cancelled from this tab.' }, { status: 409 });

    const cancelledInCloudbeds = await cancelTyeBlockReservationInCloudbeds(reservationID);
    if (!cancelledInCloudbeds) {
      const cloudbedsState = await getCloudbedsReservationState(reservationID);
      if (cloudbedsState !== 'cancelled') {
        return NextResponse.json({ success: false, error: 'Cloudbeds cancellation failed. The block was not changed locally to avoid a mismatch.' }, { status: 502 });
      }
    }
    await updatePlaceholder(placeholder.id, { status: 'cancelled', cloudbedsStatus: 'cancelled', lastSyncedAt: new Date().toISOString() });
    return NextResponse.json({ success: true, reservationID, message: 'Block cancelled in Cloudbeds and updated locally.' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// reassign-room
// ════════════════════════════════════════════════════════════════════════════

function extractFirstRoomLine(reservation: any): { reservationRoomID: string; subReservationID: string | null; roomTypeID: string | null } | null {
  const candidates: any[] = [];
  if (Array.isArray(reservation?.assigned)) candidates.push(...reservation.assigned);
  if (Array.isArray(reservation?.rooms)) candidates.push(...reservation.rooms);
  const gl = reservation?.guestList;
  if (gl && typeof gl === 'object' && !Array.isArray(gl)) {
    for (const entry of Object.values(gl) as any[]) {
      if (Array.isArray((entry as any)?.assignedRooms)) candidates.push(...(entry as any).assignedRooms);
    }
  }
  for (const r of candidates) {
    const id = r?.reservationRoomID ?? r?.reservationRoomId;
    if (id != null && String(id).trim() !== '') {
      return { reservationRoomID: String(id), subReservationID: r?.subReservationID ? String(r.subReservationID) : null, roomTypeID: r?.roomTypeID ?? r?.roomType?.roomTypeID ?? null };
    }
  }
  return null;
}

async function handleReassignRoom(request: NextRequest) {
  const log: any[] = [];
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json({ success: true, message: 'Room reassigned (mock mode — no credentials)', mockMode: true });
    }
    const body = await request.json();
    const { reservationID, newRoomID, newRoomName } = body as { reservationID?: string; newRoomID?: string; newRoomName?: string };
    if (!reservationID) return NextResponse.json({ success: false, error: 'reservationID is required' }, { status: 400 });
    if (!newRoomID) return NextResponse.json({ success: false, error: 'newRoomID is required' }, { status: 400 });
    if (!newRoomName) return NextResponse.json({ success: false, error: 'newRoomName is required' }, { status: 400 });

    const apiBase = apiV13Base();
    const authHeaders = { Authorization: `Bearer ${CLOUDBEDS_API_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' };

    const resUrl = `${apiBase}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(reservationID)}&includeAllRooms=true`;
    const resResp = await fetch(resUrl, { headers: { Authorization: `Bearer ${CLOUDBEDS_API_KEY}`, 'Content-Type': 'application/json' } });
    const resData = resResp.ok ? await resResp.json().catch(() => null) : null;
    log.push({ step: 'getReservation', success: resData?.success === true });

    const reservationRecord = unwrapReservationFromGetReservation(resData) ?? resData?.data ?? null;
    const roomLine = extractFirstRoomLine(reservationRecord);
    log.push({ step: 'extractRoomLine', roomLine });
    if (!roomLine) return NextResponse.json({ success: false, error: 'Could not find a room line (reservationRoomID) for this reservation.', debugLog: log }, { status: 422 });

    const { reservationRoomID, subReservationID, roomTypeID } = roomLine;
    const currentStatus = reservationRecord?.status ?? reservationRecord?.reservationStatus ?? '';
    if (currentStatus === 'checked_in') {
      const confirmParams = new URLSearchParams({ propertyID: CLOUDBEDS_PROPERTY_ID, reservationID, status: 'confirmed' });
      const confirmRes = await fetch(`${apiBase}/putReservation`, { method: 'PUT', headers: authHeaders, body: confirmParams.toString() });
      const confirmData: any = await confirmRes.json().catch(() => ({}));
      log.push({ step: 'reset_to_confirmed', ok: confirmRes.ok && confirmData.success === true });
    }

    const params = new URLSearchParams({ propertyID: CLOUDBEDS_PROPERTY_ID, reservationID, reservationRoomID, newRoomID, adjustPrice: 'true' });
    if (roomTypeID) params.append('roomTypeID', String(roomTypeID));
    if (subReservationID && subReservationID !== reservationID) params.append('subReservationID', subReservationID);
    const assignRes = await fetch(`${apiBase}/postRoomAssign`, { method: 'POST', headers: authHeaders, body: params.toString() });
    const assignRaw = await assignRes.text();
    let assignData: any = {};
    try { assignData = JSON.parse(assignRaw); } catch { assignData = {}; }
    const assignOk = assignRes.ok && assignData.success === true;
    log.push({ step: 'postRoomAssign', ok: assignOk, status: assignRes.status });
    if (!assignOk) return NextResponse.json({ success: false, error: assignData?.message ?? 'Cloudbeds postRoomAssign failed', debugLog: log }, { status: 422 });

    if (currentStatus === 'checked_in') {
      const ciParams = new URLSearchParams({ propertyID: CLOUDBEDS_PROPERTY_ID, reservationID, status: 'checked_in' });
      await fetch(`${apiBase}/putReservation`, { method: 'PUT', headers: authHeaders, body: ciParams.toString() });
    }

    let firestoreUpdated = false;
    try {
      const existing = await findByReservationID(reservationID);
      if (existing?.id) { await updateCheckinRecord(existing.id, { roomNumber: newRoomName }); firestoreUpdated = true; }
    } catch { /* non-fatal */ }

    return NextResponse.json({ success: true, reservationID, toRoomID: newRoomID, toRoomName: newRoomName, firestoreUpdated, message: `Room successfully changed to ${newRoomName}.${!firestoreUpdated ? ' (Check-in record not found in Firestore — Cloudbeds was updated.)' : ''}`, debugLog: log });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Failed to reassign room', debugLog: log }, { status: 500 });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// backfill-checkin-dates
// ════════════════════════════════════════════════════════════════════════════

function getFirestoreDb(): firebaseAdmin.firestore.Firestore | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  if (!projectId || !privateKey || !clientEmail) return null;
  try {
    const app = firebaseAdmin.apps.length ? (firebaseAdmin.apps[0] as firebaseAdmin.app.App) : firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert({ projectId, privateKey: privateKey.replace(/\\n/g, '\n'), clientEmail }), projectId });
    return firebaseAdmin.firestore(app);
  } catch { return null; }
}

async function handleBackfillCheckinDates() {
  const db = getFirestoreDb();
  if (!db) return NextResponse.json({ success: false, error: 'Firebase not configured' }, { status: 500 });
  let updated = 0, skipped = 0, errors = 0;
  let lastDoc: firebaseAdmin.firestore.QueryDocumentSnapshot | null = null;
  try {
    while (true) {
      let query = db.collection('kiosk_checkin_records').orderBy('checkInTime', 'desc').limit(500);
      if (lastDoc) query = query.startAfter(lastDoc) as typeof query;
      const snap = await query.get();
      if (snap.empty) break;
      const batch = db.batch();
      let batchHasWrites = false;
      for (const doc of snap.docs) {
        const data = doc.data();
        if (data.checkInDateYmd) { skipped++; continue; }
        const prefix = String(data.checkInTime ?? '').slice(0, 10);
        const ymd = /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : null;
        if (!ymd) { errors++; continue; }
        batch.update(doc.ref, { checkInDateYmd: ymd });
        updated++;
        batchHasWrites = true;
      }
      if (batchHasWrites) await batch.commit();
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < 500) break;
    }
    return NextResponse.json({ success: true, updated, skipped, errors });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? 'Backfill failed', updated, skipped, errors }, { status: 500 });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// retry-checkins — directly process pending check-ins (no internal HTTP roundtrip)
// ════════════════════════════════════════════════════════════════════════════

async function handleRetryCheckins() {
  const {
    getPendingCheckins,
    markPendingCheckinComplete,
    markPendingCheckinFailed,
    incrementPendingCheckinAttempt,
  } = await import('@/lib/pending-checkin-store');
  const { performCloudbedsCheckIn } = await import('@/lib/cloudbeds-checkin');
  const { updateCheckinRecord } = await import('@/lib/checkin-store');
  const { saveEventLog } = await import('@/lib/event-log-store');

  const MAX_ATTEMPTS = 5;
  let pending: Awaited<ReturnType<typeof getPendingCheckins>> = [];
  try {
    pending = await getPendingCheckins({ maxAge: 48 * 60 * 60 * 1000 });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to fetch pending check-ins: ' + (err?.message ?? String(err)) }, { status: 500 });
  }

  const results: Array<{ guest: string; room: string; status: string; message: string; reservationID?: string }> = [];

  for (const item of pending) {
    const guest = `${item.checkInParams.firstName ?? ''} ${item.checkInParams.lastName ?? ''}`.trim();
    const room = item.checkInParams.roomName ?? 'unknown';

    if (item.attempts >= MAX_ATTEMPTS) {
      results.push({ guest, room, status: 'skipped', message: `Max attempts (${MAX_ATTEMPTS}) reached` });
      continue;
    }
    if (
      item.status === 'processing' &&
      item.lastAttemptAt &&
      Date.now() - new Date(item.lastAttemptAt).getTime() < 90_000
    ) {
      results.push({ guest, room, status: 'skipped', message: 'Currently processing' });
      continue;
    }

    try {
      await incrementPendingCheckinAttempt(item.id).catch(() => {});
      const result = await performCloudbedsCheckIn({ ...item.checkInParams, debugLog: [] });
      await markPendingCheckinComplete(item.id, result.reservationID, result.guestID).catch(() => {});
      if (item.checkinRecordId && result.reservationID) {
        await updateCheckinRecord(item.checkinRecordId, {
          cloudbedsReservationID: result.reservationID,
          cloudbedsGuestID: result.guestID,
          ...(result.reservationStatus ? { reservationStatus: result.reservationStatus } as any : {}),
        }).catch(() => {});
      }
      void saveEventLog({ level: 'info', source: 'api:admin:retry-checkins', message: `Retry succeeded for ${guest} — reservation ${result.reservationID}`, detail: { pendingId: item.id, reservationID: result.reservationID } }).catch(() => {});
      results.push({ guest, room, status: 'succeeded', message: result.message, reservationID: result.reservationID });
    } catch (err: any) {
      const errMsg = err?.message ?? 'Unknown error';
      const newAttempts = (item.attempts ?? 0) + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        await markPendingCheckinFailed(item.id, errMsg, newAttempts).catch(() => {});
      }
      void saveEventLog({ level: 'error', source: 'api:admin:retry-checkins', message: `Retry failed for ${guest}: ${errMsg}`, detail: { pendingId: item.id, attempts: newAttempts } }).catch(() => {});
      results.push({ guest, room, status: 'failed', message: errMsg });
    }
  }

  return NextResponse.json({
    processed: pending.length,
    succeeded: results.filter(r => r.status === 'succeeded').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
  });
}
