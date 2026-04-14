/**
 * getReservation JSON shape varies: data may be the reservation, nested data.data, or data[0].
 */
export function unwrapReservationFromGetReservation(resData: any): any | null {
  if (!resData || resData.success === false) return null;
  const raw = resData.data;
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  if (typeof raw !== 'object') return null;
  const nested = (raw as any).data ?? (raw as any).reservation;
  if (
    nested &&
    typeof nested === 'object' &&
    !Array.isArray(nested) &&
    ((nested as any).reservationID != null ||
      (nested as any).startDate != null ||
      (nested as any).assigned != null ||
      (nested as any).rooms != null)
  ) {
    return nested;
  }
  return raw as any;
}

/**
 * According to Cloudbeds API v1.3 docs, putReservation ONLY reprices when a `rooms[]` array is
 * included in the request body (it interprets any rooms[] as a room-modification request and
 * re-evaluates pricing for the new room configuration).  A call that only sends `status` or
 * `checkoutDate` — with NO rooms[] fields — does NOT modify pricing.
 *
 * The previous approach of sending `rooms[0][roomRateID]` / `rooms[0][ratePlanID]` was wrong:
 * those are not valid putReservation field names (the valid rate field is `rooms[0][rateID]`),
 * and any partial rooms[] triggers the repricing path.
 *
 * Therefore the correct fix is to NEVER include any `rooms[*]` keys when only updating
 * status or checkoutDate.  This function is intentionally a no-op — it returns an empty
 * object so callers spread nothing.  It is kept so call-sites remain readable.
 */
export function extractRatePreservationFields(
  _activeRoom: any,
  _reservationRecord: any
): Record<string, string> {
  void _activeRoom;
  void _reservationRecord;
  // Intentionally empty — see comment above.
  return {};
}

/** getReservation uses `assigned`; list endpoints may use `rooms` — merge for lookup. */
export function mergeReservationRoomRows(reservation: any): any[] {
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

export function pickActiveRoom(rooms: any[]): any | null {
  if (rooms.length === 0) return null;
  const inHouse = rooms.find((r: any) => r?.roomStatus === 'in_house');
  if (inHouse) return inHouse;
  return rooms[0];
}
