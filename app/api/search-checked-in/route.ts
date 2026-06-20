import { NextRequest, NextResponse } from 'next/server';
import { findActiveByName } from '@/lib/checkin-store';

/**
 * Search currently checked-in reservations by name for kiosk checkout.
 *
 * Primary source: Cloudbeds getReservations (status=checked_in).
 * Secondary source: Firestore kiosk_checkin_records (ALWAYS merged in, not just
 * when Cloudbeds returns zero results). This ensures guests who checked in via
 * the kiosk can always find themselves at checkout even when:
 *   - The Cloudbeds check-in failed or was not completed
 *   - The reservation was modified after kiosk check-in
 *   - Cloudbeds returned partial results that don't include this guest
 *
 * Firestore results carry `source: 'local'` so the UI can display a contextual note.
 * Deduplication by reservationID prevents the same guest showing twice when
 * both sources return them.
 *
 * Important: Cloudbeds getReservations uses firstName / lastName filters (not guestName).
 * We keep requests small to avoid provider-side "could not accommodate your request" errors.
 *
 * After matching, we return at most one reservation per guest (latest stay by check-in
 * start date) so the kiosk does not list multiple past stays for the same person.
 */

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

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

/** Stay start for ordering “most recent” active reservation for the same guest. */
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
  const gid = String(
    r.guestID ?? r.guestList?.[0]?.guestID ?? r.guestList?.[0]?.guestId ?? ''
  ).trim();
  if (gid) return `gid:${gid}`;
  const gn = normalize(String(r.guestName ?? '').trim());
  if (gn) return `name:${gn}`;
  return `res:${String(r.reservationID ?? '')}`;
}

function isMoreRecentReservation(a: any, b: any): boolean {
  const sa = parseStayStartMs(a);
  const sb = parseStayStartMs(b);
  if (sa !== sb) return sa > sb;
  const ma =
    isoMs(a.dateModified ?? a.modified ?? a.lastModified) ||
    isoMs(a.dateCreated ?? a.createdDate ?? a.created);
  const mb =
    isoMs(b.dateModified ?? b.modified ?? b.lastModified) ||
    isoMs(b.dateCreated ?? b.createdDate ?? b.created);
  if (ma !== mb) return ma > mb;
  const ra = parseInt(String(a.reservationID ?? '0'), 10) || 0;
  const rb = parseInt(String(b.reservationID ?? '0'), 10) || 0;
  return ra > rb;
}

/** One row per guest: keep the reservation with the latest stay start (then modified / id). */
function keepMostRecentPerGuest(rows: any[]): any[] {
  const byKey = new Map<string, any>();
  for (const r of rows) {
    const key = guestDedupeKey(r);
    const prev = byKey.get(key);
    if (!prev || isMoreRecentReservation(r, prev)) {
      byKey.set(key, r);
    }
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
  const inHouse = rooms.find(
    (rm: any) => rm?.roomStatus === 'in_house' && rm?.roomName
  );
  if (inHouse?.roomName) return String(inHouse.roomName);
  const named = rooms.find((rm: any) => rm?.roomName);
  return named?.roomName ? String(named.roomName) : '';
}

function extractDisplayName(r: any): { firstName: string; lastName: string; displayName: string } {
  const gn = String(r.guestName ?? '').trim();
  let firstName = '';
  let lastName = '';
  if (!firstName && !lastName && gn) {
    const parts = gn.split(/\s+/).filter(Boolean);
    firstName = parts[0] ?? '';
    lastName = parts.slice(1).join(' ');
  }
  const displayName =
    gn || [firstName, lastName].filter(Boolean).join(' ').trim() || 'Guest';
  return { firstName, lastName, displayName };
}

async function fetchCheckedIn(
  apiBase: string,
  propertyID: string,
  headers: HeadersInit,
  filters: { firstName?: string; lastName?: string }
): Promise<any[]> {
  const params = new URLSearchParams({
    propertyID,
    status: 'checked_in',
    pageNumber: '1',
    pageSize: '100',
    includeAllRooms: 'true',
    sortByRecent: 'true',
  });
  if (filters.firstName) params.set('firstName', filters.firstName);
  if (filters.lastName) params.set('lastName', filters.lastName);
  const res = await fetch(`${apiBase}/getReservations?${params.toString()}`, {
    method: 'GET',
    headers,
  });
  if (!res.ok) {
    const txt = await res.text();
    console.warn('search-checked-in upstream warning:', res.status, txt);
    return [];
  }
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * GET /api/search-checked-in?name=John+Smith
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name')?.trim() ?? '';

  if (name.length < 2) {
    return NextResponse.json({ success: true, guests: [] });
  }

  const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
  const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
  const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
  const baseUrl = CLOUDBEDS_API_URL.replace(/\/v1\.\d+\/?$/, '');
  const apiBase = `${baseUrl.replace(/\/$/, '')}/v1.3`;

  if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
    // No Cloudbeds credentials — search Firestore only.
    try {
      const localRecords = await findActiveByName(name);
      const localGuests = localRecords.map((r) => ({
        firstName: r.firstName,
        lastName: r.lastName,
        displayName: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Guest',
        roomNumber: r.roomNumber ?? '',
        cloudbedsReservationID: r.cloudbedsReservationID ?? '',
        cloudbedsGuestID: r.cloudbedsGuestID ?? '',
        checkInDate: r.checkInDateYmd ?? r.checkInTime?.slice(0, 10) ?? '',
        checkOutDate: '',
        localRecordID: r.id,
        source: 'local' as const,
      }));
      return NextResponse.json({ success: true, guests: localGuests, mockMode: true });
    } catch {
      return NextResponse.json({ success: true, guests: [], mockMode: true });
    }
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
    'Content-Type': 'application/json',
  };

  // Run Cloudbeds search and Firestore search in parallel so neither blocks the other.
  // Firestore results are ALWAYS merged in (not just when Cloudbeds returns zero) so that
  // guests who checked in via the kiosk can always find themselves at checkout regardless
  // of whether the Cloudbeds reservation was successfully created / updated.
  const parts = name.split(/\s+/).filter(Boolean);

  const [cloudbedsResult, localResult] = await Promise.allSettled([
    // Cloudbeds search
    (async (): Promise<any[]> => {
      let rawList: any[] = [];
      if (parts.length >= 2) {
        rawList = await fetchCheckedIn(apiBase, CLOUDBEDS_PROPERTY_ID, headers, {
          firstName: parts[0],
          lastName: parts.slice(1).join(' '),
        });
      } else {
        const token = parts[0];
        const [asFirst, asLast] = await Promise.all([
          fetchCheckedIn(apiBase, CLOUDBEDS_PROPERTY_ID, headers, { firstName: token }),
          fetchCheckedIn(apiBase, CLOUDBEDS_PROPERTY_ID, headers, { lastName: token }),
        ]);
        rawList = uniqueByReservation([...asFirst, ...asLast]);
      }
      return rawList.filter((r) => reservationMatchesQuery(r, name));
    })(),
    // Firestore search (always run, not just as fallback)
    findActiveByName(name),
  ]);

  if (cloudbedsResult.status === 'rejected') {
    console.error('search-checked-in cloudbeds error:', cloudbedsResult.reason);
  }
  if (localResult.status === 'rejected') {
    console.error('search-checked-in firestore error:', localResult.reason);
  }

  const cloudbedsMatched = cloudbedsResult.status === 'fulfilled' ? cloudbedsResult.value : [];
  const firestoreRecords = localResult.status === 'fulfilled' ? localResult.value : [];

  // Build the Cloudbeds guest list
  const cloudbedsGuests = keepMostRecentPerGuest(cloudbedsMatched).map((r) => {
    const { firstName, lastName, displayName } = extractDisplayName(r);
    return {
      firstName,
      lastName,
      displayName,
      roomNumber: extractRoomName(r),
      cloudbedsReservationID: String(r.reservationID ?? ''),
      cloudbedsGuestID: String(r.guestID ?? ''),
      checkInDate: r.startDate ?? r.checkInDate ?? '',
      checkOutDate: r.endDate ?? r.checkOutDate ?? '',
      source: 'cloudbeds' as const,
    };
  });

  // Build Firestore guest list — exclude any reservation already returned by Cloudbeds
  // (matched by reservationID) so the same guest doesn't appear twice.
  const cloudbedsReservationIDs = new Set(
    cloudbedsGuests
      .map((g) => g.cloudbedsReservationID)
      .filter(Boolean)
  );

  const localGuests = firestoreRecords
    .filter((r) => {
      // Skip if already covered by Cloudbeds
      if (r.cloudbedsReservationID && cloudbedsReservationIDs.has(r.cloudbedsReservationID)) {
        return false;
      }
      return true;
    })
    .map((r) => ({
      firstName: r.firstName,
      lastName: r.lastName,
      displayName: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Guest',
      roomNumber: r.roomNumber ?? '',
      cloudbedsReservationID: r.cloudbedsReservationID ?? '',
      cloudbedsGuestID: r.cloudbedsGuestID ?? '',
      checkInDate: r.checkInDateYmd ?? r.checkInTime?.slice(0, 10) ?? '',
      checkOutDate: '',
      /** Firestore document ID — used to record checkout when no Cloudbeds reservation ID. */
      localRecordID: r.id,
      source: 'local' as const,
    }));

  // Cloudbeds results first (authoritative), then any additional Firestore-only guests.
  const guests = [...cloudbedsGuests, ...localGuests];

  return NextResponse.json({ success: true, guests });
}
