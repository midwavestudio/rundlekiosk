import { mergeReservationRoomRows } from '@/lib/cloudbeds-rate-preserve';

let cachedPlanIds: Set<string> | null = null;
let cachedSourceIds: Set<string> | null = null;

function parseCommaIds(raw: string | undefined, fallback: string): Set<string> {
  const text = (raw ?? fallback).trim();
  const set = new Set<string>();
  for (const part of text.split(',')) {
    const p = part.trim();
    if (!p) continue;
    set.add(p);
    const n = Number(p);
    if (Number.isFinite(n)) set.add(String(n));
  }
  return set;
}

/** Rate plan IDs that identify TYE stays (comma-separated). Default matches kiosk lookup in Cloudbeds. */
export function getTyeRatePlanIdSet(): Set<string> {
  if (!cachedPlanIds) {
    cachedPlanIds = parseCommaIds(process.env.CLOUDBEDS_TYE_RATE_PLAN_IDS, '227753');
  }
  return cachedPlanIds;
}

/** Reservation source IDs used for TYE kiosk bookings (comma-separated). */
export function getTyeSourceIdSet(): Set<string> {
  if (!cachedSourceIds) {
    cachedSourceIds = parseCommaIds(process.env.CLOUDBEDS_TYE_SOURCE_IDS, 's-945658-1');
  }
  return cachedSourceIds;
}

function planIdMatches(id: unknown, tyeIds: Set<string>): boolean {
  if (id == null || id === '') return false;
  const s = String(id).trim();
  if (tyeIds.has(s)) return true;
  const n = Number(s);
  return Number.isFinite(n) && tyeIds.has(String(n));
}

function planNameLooksTye(name: unknown): boolean {
  return String(name ?? '').toLowerCase().includes('tye');
}

/** Kiosk walk-in guests use buildGuestSyntheticEmail → *@guest.com — list payloads often omit rate plan IDs. */
function guestEmailLooksKioskSynthetic(obj: Record<string, unknown>): boolean {
  const raw =
    obj.guestEmail ??
    obj.email ??
    (Array.isArray(obj.guestList) && obj.guestList[0] && typeof obj.guestList[0] === 'object'
      ? (obj.guestList[0] as Record<string, unknown>).guestEmail ??
        (obj.guestList[0] as Record<string, unknown>).email
      : undefined);
  const e = String(raw ?? '').trim().toLowerCase();
  return e.endsWith('@guest.com');
}

function scanRateRow(obj: Record<string, unknown>, tyeIds: Set<string>): boolean {
  const pid =
    obj.ratePlanID ?? obj.rate_plan_id ?? obj.ratePlan_id ?? obj.roomRatePlanID ?? obj.room_rate_plan_id;
  const pname =
    obj.ratePlanName ?? obj.rate_plan_name ?? obj.ratePlan ?? obj.planName ?? obj.roomRatePlan;
  if (planIdMatches(pid, tyeIds)) return true;
  if (planNameLooksTye(pname)) return true;
  return false;
}

/**
 * True when the Cloudbeds reservation appears to be on the TYE rate plan / TYE booking source.
 * List and detail payloads differ; we check top-level hints, room lines, and guest list.
 *
 * Exported for server routes (e.g. dashboard in-house count) that need the same TYE
 * classification as the kiosk without duplicating heuristics.
 */
export function reservationHasTyeRatePlan(reservation: any): boolean {
  if (!reservation || typeof reservation !== 'object') return false;
  const tyeIds = getTyeRatePlanIdSet();
  const tyeSources = getTyeSourceIdSet();

  const src = reservation.sourceID ?? reservation.source_id ?? reservation.sourceId;
  if (src != null && tyeSources.has(String(src).trim())) return true;

  if (guestEmailLooksKioskSynthetic(reservation as Record<string, unknown>)) return true;

  if (scanRateRow(reservation as Record<string, unknown>, tyeIds)) return true;

  for (const row of mergeReservationRoomRows(reservation)) {
    if (scanRateRow(row as Record<string, unknown>, tyeIds)) return true;
  }

  const guests = reservation.guestList ?? reservation.guests;
  if (Array.isArray(guests)) {
    for (const g of guests) {
      if (g && typeof g === 'object') {
        if (guestEmailLooksKioskSynthetic(g as Record<string, unknown>)) return true;
        if (scanRateRow(g as Record<string, unknown>, tyeIds)) return true;
      }
    }
  }

  return false;
}

/**
 * Dashboard stats: getReservations list rows often omit rate plan fields; treat synthetic kiosk
 * email appearing anywhere in the payload as a TYE stay.
 */
export function reservationLooksLikeTyeStayForStats(reservation: any): boolean {
  if (reservationHasTyeRatePlan(reservation)) return true;
  try {
    return JSON.stringify(reservation).toLowerCase().includes('@guest.com');
  } catch {
    return false;
  }
}
