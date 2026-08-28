/**
 * Shared in-process cache for the /api/available-rooms response.
 *
 * Extracted to a separate module so that admin operations (create/cancel TYE
 * placeholders) can bust the cache immediately — ensuring the next kiosk
 * request reflects the new placeholder rather than waiting up to 10 minutes
 * for the TTL to expire and missing the placeholderReservationID.
 */

interface RoomsCache {
  rooms: unknown[];
  expiresAt: number;
}

export const roomsCache = new Map<string, RoomsCache>();
export const ROOMS_CACHE_TTL_MS = 10 * 60_000; // 10 minutes

/** Invalidate every cached rooms-list entry. Call after any placeholder create/cancel. */
export function bustRoomsCache(): void {
  roomsCache.clear();
}
