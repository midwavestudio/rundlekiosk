import { NextRequest, NextResponse } from 'next/server';
import { validateClcNumberRequired } from '@/lib/checkin-validation';
import {
  saveCheckinRecord,
  updateCheckinRecord,
  getCheckinRecords,
  findByReservationID,
  findByGuestName,
  findByGuestKey,
  findActiveByName,
  upsertCheckinRecord,
  deleteCheckinRecord,
  deleteByReservationID,
  type CheckinRecord,
} from '@/lib/checkin-store';

// ---------------------------------------------------------------------------
// Server-side GET cache — avoids a Firestore read on every admin tab poll.
// Busted on any write (POST / PATCH / DELETE) so data stays consistent.
// ---------------------------------------------------------------------------
interface RecordsCache {
  records: CheckinRecord[];
  from: string;
  to: string;
  limit: number;
  expiresAt: number;
}
let recordsCache: RecordsCache | null = null;
const RECORDS_CACHE_TTL_MS = 60_000; // 1 minute

function bustRecordsCache() {
  recordsCache = null;
}

/**
 * GET /api/checkin-records
 *  - ?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=N  → list records
 *  - ?action=backup                           → download all records as JSON file
 *  - ?action=search&name=John+Smith           → search checked-in guests
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'backup') return handleBackup();
  if (action === 'search') return handleSearch(request);

  try {
    const from = searchParams.get('from') ?? '';
    const to = searchParams.get('to') ?? '';
    // When a date range is provided (export scenario), paginate up to 50 000
    // records (safety cap). Without a range (live poll) keep the 500-doc default.
    const hasRange = searchParams.has('from') && searchParams.has('to');
    const hardCap = hasRange ? 50_000 : 500;
    let limit = hasRange ? 50_000 : 500;
    if (searchParams.has('limit')) {
      const n = parseInt(searchParams.get('limit')!, 10);
      if (Number.isFinite(n)) limit = Math.min(Math.max(n, 1), hardCap);
    }

    const now = Date.now();
    if (
      recordsCache &&
      recordsCache.from === from &&
      recordsCache.to === to &&
      recordsCache.limit >= limit &&
      now < recordsCache.expiresAt
    ) {
      return NextResponse.json(
        { success: true, records: recordsCache.records.slice(0, limit) },
        { headers: { 'Cache-Control': 'private, max-age=60' } }
      );
    }

    const records = await getCheckinRecords({
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      limit,
    });
    recordsCache = { records, from, to, limit, expiresAt: now + RECORDS_CACHE_TTL_MS };

    return NextResponse.json(
      { success: true, records },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    );
  } catch (err: any) {
    console.error('[checkin-records GET]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/checkin-records
 *  - ?action=sync  → bulk upsert records from kiosk localStorage
 *  - (no action)   → create a single new check-in record
 */
export async function POST(request: NextRequest) {
  const action = new URL(request.url).searchParams.get('action');
  if (action === 'sync') return handleSync(request);

  try {
    const body = await request.json();
    if (!body.firstName && !body.lastName) {
      return NextResponse.json(
        { success: false, error: 'firstName or lastName is required' },
        { status: 400 }
      );
    }
    const clcValidation = validateClcNumberRequired(body.clcNumber);
    if (!clcValidation.ok) {
      return NextResponse.json(
        { success: false, error: clcValidation.error },
        { status: 400 }
      );
    }
    const id = await saveCheckinRecord({
      firstName: String(body.firstName ?? '').trim(),
      lastName: String(body.lastName ?? '').trim(),
      clcNumber: clcValidation.clcNumber,
      phoneNumber: String(body.phoneNumber ?? ''),
      class: String(body.class ?? 'TYE'),
      roomNumber: String(body.roomNumber ?? ''),
      checkInTime: body.checkInTime ? String(body.checkInTime) : new Date().toISOString(),
      // Honour the client-supplied local calendar date so late-night check-ins
      // (e.g. 10:59 PM local) are not shifted to the next UTC calendar day.
      ...(body.checkInDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(String(body.checkInDateYmd))
        ? { checkInDateYmd: String(body.checkInDateYmd) }
        : {}),
      ...(body.checkOutTime ? { checkOutTime: String(body.checkOutTime) } : {}),
      ...(body.cloudbedsReservationID ? { cloudbedsReservationID: String(body.cloudbedsReservationID) } : {}),
      ...(body.cloudbedsGuestID ? { cloudbedsGuestID: String(body.cloudbedsGuestID) } : {}),
      source: body.source ? String(body.source) : 'kiosk',
    });
    bustRecordsCache();
    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    console.error('[checkin-records POST]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/checkin-records
 * Body: { id?, reservationID?, ...updates }
 *
 * Updates an existing record identified by `id` (Firestore doc ID) or
 * `reservationID` (Cloudbeds reservation ID).
 *
 * When recording a checkout (checkOutTime is provided) and no existing record
 * is found, a new stub record is created so the checkout time is never lost —
 * this handles the case where the Cloudbeds reservation ID was modified after
 * kiosk check-in and the original Firestore record has no reservationID link.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    let { id } = body;

    // ── 1. Find the record to update ────────────────────────────────────────
    // Try in priority order so that checkout timestamps always land on the
    // right Firestore document:
    //   a) Explicit Firestore doc id (most precise)
    //   b) cloudbedsReservationID equality query
    //   c) Name + check-in date match (catches records created before the
    //      reservation ID was written, e.g. when Firestore save succeeded
    //      at check-in time but the Cloudbeds reservation was not yet linked)

    if (!id && body.reservationID) {
      const existing = await findByReservationID(String(body.reservationID));
      if (existing) id = existing.id;
    }

    if (!id && body.checkOutTime) {
      // Fallback: name + check-in date — covers kiosk records that were saved
      // without a reservationID (Cloudbeds call succeeded after Firestore write)
      // and same-day guests whose record has no reservationID linked yet.
      const firstName = String(body.firstName ?? '').trim();
      const lastName = String(body.lastName ?? '').trim();
      const rawCheckInDate = String(body.checkInDateYmd ?? body.checkInDate ?? '').trim();
      const checkInDate = /^\d{4}-\d{2}-\d{2}$/.test(rawCheckInDate) ? rawCheckInDate : '';
      if (firstName && checkInDate) {
        const byName = await findByGuestName(firstName, lastName, checkInDate);
        if (byName) id = byName.id;
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.checkInTime !== undefined) {
      const checkInTime = String(body.checkInTime);
      updates.checkInTime = checkInTime;
      const rawYmd = String(body.checkInDateYmd ?? '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawYmd)) {
        updates.checkInDateYmd = rawYmd;
      } else if (checkInTime.length >= 10) {
        const d = new Date(checkInTime);
        if (!Number.isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          updates.checkInDateYmd = `${y}-${m}-${day}`;
        }
      }
    } else if (body.checkInDateYmd !== undefined) {
      const rawYmd = String(body.checkInDateYmd).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawYmd)) updates.checkInDateYmd = rawYmd;
    }
    if (body.checkOutTime !== undefined) {
      const raw = body.checkOutTime;
      updates.checkOutTime = raw === null || raw === '' ? null : String(raw);
    }
    if (body.cloudbedsReservationID !== undefined) updates.cloudbedsReservationID = String(body.cloudbedsReservationID);
    if (body.cloudbedsGuestID !== undefined) updates.cloudbedsGuestID = String(body.cloudbedsGuestID);
    if (body.roomNumber !== undefined) updates.roomNumber = String(body.roomNumber);
    if (body.firstName !== undefined) updates.firstName = String(body.firstName);
    if (body.lastName !== undefined) updates.lastName = String(body.lastName);
    if (body.clcNumber !== undefined) updates.clcNumber = String(body.clcNumber);
    if (body.phoneNumber !== undefined) updates.phoneNumber = String(body.phoneNumber);
    if (body.class !== undefined) updates.class = String(body.class);
    if (body.reservationStatus !== undefined) updates.reservationStatus = String(body.reservationStatus);
    // Also stamp the reservationID onto the record if it wasn't there before
    if (body.reservationID && !updates.cloudbedsReservationID) {
      updates.cloudbedsReservationID = String(body.reservationID);
    }

    if (!id) {
      // No existing record found. If we have a checkout time to record, create a
      // stub so the departure is never silently lost. This covers:
      //   • Guests who checked in via Cloudbeds directly (not through the kiosk)
      //   • Guests whose reservation was created or modified after kiosk check-in
      if (body.checkOutTime) {
        // Use the real check-in date from Cloudbeds so the stub appears under
        // the correct date in the Arrivals tab, not under today's date.
        let checkInTime: string;
        if (body.checkInTime && String(body.checkInTime).length > 5) {
          checkInTime = String(body.checkInTime);
        } else if (body.checkInDate && /^\d{4}-\d{2}-\d{2}$/.test(String(body.checkInDate))) {
          // Use noon local-ish time (avoids UTC date boundary shifting)
          checkInTime = `${String(body.checkInDate)}T18:00:00.000Z`;
        } else {
          checkInTime = new Date().toISOString();
        }
        const checkInDateYmd = body.checkInDate && /^\d{4}-\d{2}-\d{2}$/.test(String(body.checkInDate))
          ? String(body.checkInDate)
          : checkInTime.slice(0, 10);
        const newId = await saveCheckinRecord({
          firstName: String(body.firstName ?? '').trim() || 'Unknown',
          lastName: String(body.lastName ?? '').trim(),
          clcNumber: String(body.clcNumber ?? ''),
          phoneNumber: String(body.phoneNumber ?? ''),
          class: String(body.class ?? 'TYE'),
          roomNumber: String(body.roomNumber ?? ''),
          checkInTime,
          checkInDateYmd,
          checkOutTime: String(body.checkOutTime),
          ...(body.reservationID ? { cloudbedsReservationID: String(body.reservationID) } : {}),
          ...(body.cloudbedsReservationID ? { cloudbedsReservationID: String(body.cloudbedsReservationID) } : {}),
          ...(body.cloudbedsGuestID ? { cloudbedsGuestID: String(body.cloudbedsGuestID) } : {}),
          source: 'kiosk:checkout-stub',
        });
        console.log('[checkin-records PATCH] No existing record — created checkout stub:', newId, {
          reservationID: body.reservationID,
          firstName: body.firstName,
          checkInDate: body.checkInDate,
        });
        return NextResponse.json({ success: true, id: newId, created: true });
      }
      return NextResponse.json(
        { success: false, error: 'Provide id or reservationID to identify the record' },
        { status: 400 }
      );
    }

    await updateCheckinRecord(id, updates);
    bustRecordsCache();
    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    console.error('[checkin-records PATCH]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/checkin-records
 * Body: { id?, reservationID?, firstName?, lastName?, checkInTime?, checkInDateYmd? }
 *
 * Deletes by Firestore doc id and/or Cloudbeds reservation ID, with fallbacks:
 * reservation lookup, then guest key (name + exact checkInTime), then name +
 * checkInDateYmd (YYYY-MM-DD). Invalid or locale display dates in checkInDate
 * are ignored — prefer checkInDateYmd from the client.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const rawId = body?.id ? String(body.id).trim() : '';
    let id =
      rawId &&
      rawId !== 'undefined' &&
      rawId !== 'null' &&
      rawId !== 'NaN'
        ? rawId
        : '';
    const reservationID = body?.reservationID ? String(body.reservationID).trim() : '';

    // Fallback identity for rows that don't carry a valid id/reservationID
    const firstName = body?.firstName ? String(body.firstName).trim() : '';
    const lastName = body?.lastName ? String(body.lastName).trim() : '';
    const checkInTime = body?.checkInTime ? String(body.checkInTime).trim() : '';
    const rawCheckInDate = String(body?.checkInDateYmd ?? body?.checkInDate ?? '').trim();
    const checkInDateYmd = /^\d{4}-\d{2}-\d{2}$/.test(rawCheckInDate) ? rawCheckInDate : '';

    // Resolve Firestore doc id: explicit id → reservation lookup → guest key (even if
    // reservationID was sent but wrong/stale) → name + calendar date (YYYY-MM-DD only).
    if (!id && reservationID) {
      const existing = await findByReservationID(reservationID);
      if (existing) id = existing.id;
    }
    if (!id && firstName && checkInTime) {
      const byKey = await findByGuestKey(firstName, lastName, checkInTime);
      if (byKey?.id) id = byKey.id;
    }
    if (!id && firstName && checkInDateYmd) {
      const byName = await findByGuestName(firstName, lastName, checkInDateYmd);
      if (byName?.id) id = byName.id;
    }

    const hasGuestHints = !!(firstName && (checkInTime || checkInDateYmd));
    if (!id && !reservationID && !hasGuestHints) {
      return NextResponse.json(
        { success: false, error: 'Provide id, reservationID, or guest identity fields to identify the record' },
        { status: 400 }
      );
    }

    let deleted = false;
    if (id) {
      await deleteCheckinRecord(id);
      deleted = true;
    }
    if (reservationID) {
      const byReservation = await deleteByReservationID(reservationID);
      deleted = deleted || byReservation;
    }
    bustRecordsCache();
    return NextResponse.json({ success: true, deleted });
  } catch (err: any) {
    console.error('[checkin-records DELETE]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}

// ─── ?action=backup ──────────────────────────────────────────────────────────

async function handleBackup() {
  try {
    const records = await getCheckinRecords({ limit: 1000 });
    const now = new Date();
    const stamp = now.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
    const filename = `checkin-records-backup-${stamp}.json`;
    const payload = JSON.stringify({ exportedAt: now.toISOString(), count: records.length, records }, null, 2);
    return new NextResponse(payload, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? 'Server error' }, { status: 500 });
  }
}

// ─── ?action=sync ────────────────────────────────────────────────────────────

async function handleSync(request: NextRequest) {
  try {
    const body = await request.json();
    const records: any[] = Array.isArray(body.records) ? body.records : [];
    if (records.length === 0) return NextResponse.json({ success: true, results: [] });
    const batch = records.slice(0, 200);
    const results = await Promise.all(
      batch.map(async (r) => {
        try {
          return await upsertCheckinRecord({
            firstName: String(r.firstName ?? '').trim(),
            lastName: String(r.lastName ?? '').trim(),
            clcNumber: String(r.clcNumber ?? ''),
            phoneNumber: String(r.phoneNumber ?? ''),
            class: String(r.class ?? 'TYE'),
            roomNumber: String(r.roomNumber ?? ''),
            checkInTime: r.checkInTime ? String(r.checkInTime) : '',
            ...(r.checkOutTime ? { checkOutTime: String(r.checkOutTime) } : {}),
            ...(r.cloudbedsReservationID ? { cloudbedsReservationID: String(r.cloudbedsReservationID) } : {}),
            ...(r.cloudbedsGuestID ? { cloudbedsGuestID: String(r.cloudbedsGuestID) } : {}),
            source: r.source ? String(r.source) : 'kiosk-sync',
          });
        } catch (err: any) {
          return { id: null, created: false, error: err?.message };
        }
      })
    );
    const created = results.filter((r) => r.created).length;
    const updated = results.filter((r) => !r.created && r.id).length;
    return NextResponse.json({ success: true, results, created, updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? 'Server error' }, { status: 500 });
  }
}

// ─── ?action=search ──────────────────────────────────────────────────────────

function normalize(s: string): string { return s.trim().toLowerCase(); }

function uniqueByReservation(rows: any[]): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = String(r?.reservationID ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

function isoMs(v: unknown): number {
  const t = String(v ?? '').trim();
  if (!t) return 0;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseStayStartMs(r: any): number {
  const raw = r.startDate ?? r.checkInDate ?? '';
  const t = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(`${t.slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return isoMs(raw);
}

function guestDedupeKey(r: any): string {
  const gid = String(r.guestID ?? r.guestList?.[0]?.guestID ?? r.guestList?.[0]?.guestId ?? '').trim();
  if (gid) return `gid:${gid}`;
  const gn = normalize(String(r.guestName ?? '').trim());
  if (gn) return `name:${gn}`;
  return `res:${String(r.reservationID ?? '')}`;
}

function isMoreRecentReservation(a: any, b: any): boolean {
  const sa = parseStayStartMs(a);
  const sb = parseStayStartMs(b);
  if (sa !== sb) return sa > sb;
  const ma = isoMs(a.dateModified ?? a.modified ?? a.lastModified) || isoMs(a.dateCreated ?? a.createdDate ?? a.created);
  const mb = isoMs(b.dateModified ?? b.modified ?? b.lastModified) || isoMs(b.dateCreated ?? b.createdDate ?? b.created);
  if (ma !== mb) return ma > mb;
  const ra = parseInt(String(a.reservationID ?? '0'), 10) || 0;
  const rb = parseInt(String(b.reservationID ?? '0'), 10) || 0;
  return ra > rb;
}

function keepMostRecentPerGuest(rows: any[]): any[] {
  const byKey = new Map<string, any>();
  for (const r of rows) {
    const key = guestDedupeKey(r);
    const prev = byKey.get(key);
    if (!prev || isMoreRecentReservation(r, prev)) byKey.set(key, r);
  }
  return Array.from(byKey.values());
}

function reservationMatchesQuery(r: any, query: string): boolean {
  const q = normalize(query);
  if (q.length < 2) return false;
  const hay = String(r?.guestName ?? '').toLowerCase().trim();
  if (!hay) return false;
  if (hay.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length <= 1) return false;
  return tokens.every((t) => hay.includes(t));
}

function extractRoomName(r: any): string {
  if (r.roomName) return String(r.roomName);
  const rooms = Array.isArray(r.rooms) ? r.rooms : [];
  const inHouse = rooms.find((rm: any) => rm?.roomStatus === 'in_house' && rm?.roomName);
  if (inHouse?.roomName) return String(inHouse.roomName);
  const named = rooms.find((rm: any) => rm?.roomName);
  return named?.roomName ? String(named.roomName) : '';
}

function extractDisplayName(r: any): { firstName: string; lastName: string; displayName: string } {
  const gn = String(r.guestName ?? '').trim();
  const parts = gn.split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ');
  const displayName = gn || [firstName, lastName].filter(Boolean).join(' ').trim() || 'Guest';
  return { firstName, lastName, displayName };
}

async function fetchCheckedInFromCloudbeds(apiBase: string, propertyID: string, headers: HeadersInit, filters: { firstName?: string; lastName?: string }): Promise<any[]> {
  const params = new URLSearchParams({ propertyID, status: 'checked_in', pageNumber: '1', pageSize: '100', includeAllRooms: 'true', sortByRecent: 'true' });
  if (filters.firstName) params.set('firstName', filters.firstName);
  if (filters.lastName) params.set('lastName', filters.lastName);
  const res = await fetch(`${apiBase}/getReservations?${params}`, { method: 'GET', headers });
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

async function handleSearch(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name')?.trim() ?? '';
  if (name.length < 2) return NextResponse.json({ success: true, guests: [] });

  const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
  const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
  const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
  const baseUrl = CLOUDBEDS_API_URL.replace(/\/v1\.\d+\/?$/, '');
  const apiBase = `${baseUrl.replace(/\/$/, '')}/v1.3`;

  if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
    try {
      const localRecords = await findActiveByName(name);
      const localGuests = localRecords.map((r) => ({
        firstName: r.firstName, lastName: r.lastName,
        displayName: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Guest',
        roomNumber: r.roomNumber ?? '', cloudbedsReservationID: r.cloudbedsReservationID ?? '',
        cloudbedsGuestID: r.cloudbedsGuestID ?? '',
        checkInDate: r.checkInDateYmd ?? r.checkInTime?.slice(0, 10) ?? '',
        checkOutDate: '', localRecordID: r.id, source: 'local' as const,
      }));
      return NextResponse.json({ success: true, guests: localGuests, mockMode: true });
    } catch { return NextResponse.json({ success: true, guests: [], mockMode: true }); }
  }

  const headers: HeadersInit = { Authorization: `Bearer ${CLOUDBEDS_API_KEY}`, 'Content-Type': 'application/json' };
  const parts = name.split(/\s+/).filter(Boolean);

  const [cloudbedsResult, localResult] = await Promise.allSettled([
    (async (): Promise<any[]> => {
      let rawList: any[] = [];
      if (parts.length >= 2) {
        rawList = await fetchCheckedInFromCloudbeds(apiBase, CLOUDBEDS_PROPERTY_ID, headers, { firstName: parts[0], lastName: parts.slice(1).join(' ') });
      } else {
        const token = parts[0];
        const [asFirst, asLast] = await Promise.all([
          fetchCheckedInFromCloudbeds(apiBase, CLOUDBEDS_PROPERTY_ID, headers, { firstName: token }),
          fetchCheckedInFromCloudbeds(apiBase, CLOUDBEDS_PROPERTY_ID, headers, { lastName: token }),
        ]);
        rawList = uniqueByReservation([...asFirst, ...asLast]);
      }
      return rawList.filter((r) => reservationMatchesQuery(r, name));
    })(),
    findActiveByName(name),
  ]);

  const cloudbedsMatched = cloudbedsResult.status === 'fulfilled' ? cloudbedsResult.value : [];
  const firestoreRecords = localResult.status === 'fulfilled' ? localResult.value : [];

  const cloudbedsGuests = keepMostRecentPerGuest(cloudbedsMatched).map((r) => {
    const { firstName, lastName, displayName } = extractDisplayName(r);
    return { firstName, lastName, displayName, roomNumber: extractRoomName(r), cloudbedsReservationID: String(r.reservationID ?? ''), cloudbedsGuestID: String(r.guestID ?? ''), checkInDate: r.startDate ?? r.checkInDate ?? '', checkOutDate: r.endDate ?? r.checkOutDate ?? '', source: 'cloudbeds' as const };
  });

  const cloudbedsReservationIDs = new Set(cloudbedsGuests.map((g) => g.cloudbedsReservationID).filter(Boolean));
  const localGuests = firestoreRecords
    .filter((r) => !(r.cloudbedsReservationID && cloudbedsReservationIDs.has(r.cloudbedsReservationID)))
    .map((r) => ({
      firstName: r.firstName, lastName: r.lastName,
      displayName: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Guest',
      roomNumber: r.roomNumber ?? '', cloudbedsReservationID: r.cloudbedsReservationID ?? '',
      cloudbedsGuestID: r.cloudbedsGuestID ?? '',
      checkInDate: r.checkInDateYmd ?? r.checkInTime?.slice(0, 10) ?? '',
      checkOutDate: '', localRecordID: r.id, source: 'local' as const,
    }));

  return NextResponse.json({ success: true, guests: [...cloudbedsGuests, ...localGuests] });
}
