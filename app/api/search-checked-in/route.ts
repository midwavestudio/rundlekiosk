import { NextRequest, NextResponse } from 'next/server';

/**
 * Search currently checked-in reservations by name for kiosk checkout.
 *
 * Important: Cloudbeds getReservations uses firstName / lastName filters (not guestName).
 * We keep requests small to avoid provider-side "could not accommodate your request" errors.
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
    return NextResponse.json({ success: true, guests: [], mockMode: true });
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const parts = name.split(/\s+/).filter(Boolean);
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

    const matched = rawList.filter((r) => reservationMatchesQuery(r, name));

    const guests = matched.map((r) => {
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
      };
    });

    return NextResponse.json({ success: true, guests });
  } catch (err) {
    console.error('search-checked-in error:', err);
    // Keep kiosk flow smooth: return empty list instead of surfacing provider internals to guests.
    return NextResponse.json({ success: true, guests: [] });
  }
}
