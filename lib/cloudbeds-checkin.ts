/**
 * Shared Cloudbeds check-in logic. Used by both POST /api/cloudbeds-checkin and bulk-checkin
 * so bulk can call this directly instead of fetching the app (avoids HTML/JSON errors on live).
 */

import { buildGuestSyntheticEmail } from '@/lib/guest-email';
import { validateClcNumberRequired } from '@/lib/checkin-validation';
import { unwrapReservationFromGetReservation } from '@/lib/cloudbeds-rate-preserve';
import { resolveDuplicateRoomMatches } from '@/lib/room-picker-dedupe';

function getLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Next calendar day as YYYY-MM-DD (for a valid 1-night Cloudbeds stay window). */
function addOneCalendarDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return getLocalDateStr(dt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fields that reflect **amount still owed** after payments. Never use `grandTotal` / `total` here —
 * they usually stay equal to the room total and caused repeated full CLC posts (one per loop round).
 */
const OUTSTANDING_BALANCE_KEYS = [
  'balance',
  'totalBalance',
  'amountDue',
  'remainingBalance',
  'balanceDue',
  'amountOwing',
  'outstandingBalance',
  'dueAmount',
  'remainingAmount',
] as const;

/** Broader keys only for postReservation hint when folio APIs still return nothing. */
const POST_RESERVATION_HINT_KEYS = [
  ...OUTSTANDING_BALANCE_KEYS,
  'grandTotal',
  'total',
  'subTotal',
  'roomTotal',
  'totalAmount',
] as const;

/**
 * First meaningful outstanding amount on an object. If an outstanding key is present and is ~0, returns 0
 * (folio cleared). If keys are absent, returns null.
 */
function pickOutstandingFromObject(obj: unknown): number | null {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  for (const k of OUTSTANDING_BALANCE_KEYS) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (Number.isNaN(n)) continue;
    if (n <= 0.01) return 0;
    return n;
  }
  return null;
}

function pickHintAmountFromObject(obj: unknown): number | null {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  for (const k of POST_RESERVATION_HINT_KEYS) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (!Number.isNaN(n) && n > 0.01) return n;
  }
  return null;
}

/** Collect nested objects Cloudbeds may put invoice / balance data under. */
function collectBalanceScanRoots(data: unknown): unknown[] {
  const roots: unknown[] = [];
  if (data == null) return roots;
  roots.push(data);
  if (typeof data === 'object' && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    for (const k of ['invoice', 'summary', 'totals', 'Invoice', 'Summary', 'balanceDetail', 'reservation']) {
      if (o[k] != null && typeof o[k] === 'object') roots.push(o[k]);
    }
  }
  if (Array.isArray(data) && data[0] != null && typeof data[0] === 'object') roots.push(data[0]);
  return roots;
}

/** Walk roots in order; prefer first definitive outstanding (including 0). Never max() across roots — nested `totals.grandTotal` must not override top-level `balance`. */
function firstOutstandingFromScanRoots(roots: unknown[]): number | null {
  for (const r of roots) {
    const n = pickOutstandingFromObject(r);
    if (n !== null) return n;
  }
  return null;
}

function coalesceOutstandingTopLevel(data: unknown): number | null {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  for (const k of OUTSTANDING_BALANCE_KEYS) {
    const v = d[k];
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (Number.isNaN(n)) continue;
    return n;
  }
  return null;
}

/**
 * Outstanding balance from invoice (preferred) or getReservation.
 * Handles nested invoice payloads and alternate field names (past-dated stays sometimes differ).
 */
async function readOutstandingBalance(
  apiV13: string,
  propertyID: string,
  apiKey: string,
  reservationID: string
): Promise<number> {
  try {
    const u = `${apiV13}/getReservationInvoiceInformation?propertyID=${encodeURIComponent(propertyID)}&reservationID=${encodeURIComponent(reservationID)}`;
    const r = await fetch(u, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    const j = await r.json();
    const data = j.data ?? j;
    const fromRoots = firstOutstandingFromScanRoots(collectBalanceScanRoots(data));
    if (fromRoots !== null) return fromRoots;
    const top = coalesceOutstandingTopLevel(data);
    if (top !== null) return top;
  } catch {
    /* fall through */
  }
  try {
    const u = `${apiV13}/getReservation?propertyID=${encodeURIComponent(propertyID)}&reservationID=${encodeURIComponent(reservationID)}`;
    const r = await fetch(u, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    const j = await r.json();
    const d = j.data ?? j;
    const resRoots = collectBalanceScanRoots(d);
    const fromNested = firstOutstandingFromScanRoots(resRoots);
    if (fromNested !== null) return fromNested;
    const top = coalesceOutstandingTopLevel(d);
    if (top !== null) return top;
  } catch {
    /* ignore */
  }
  return 0;
}

/** Poll invoice/folio until balance appears (postReservation is often async; past start dates can lag more). */
async function readOutstandingBalanceWithPoll(
  apiV13: string,
  propertyID: string,
  apiKey: string,
  reservationID: string,
  opts: { maxAttempts: number; delayMs: number },
  log: (step: string, request?: unknown, response?: unknown, error?: string) => void
): Promise<number> {
  let last = 0;
  for (let a = 0; a < opts.maxAttempts; a++) {
    last = await readOutstandingBalance(apiV13, propertyID, apiKey, reservationID);
    if (last > 0.01) {
      if (a > 0) log('4_settleFolio_balance_poll_hit', { attempt: a + 1, balance: last });
      return last;
    }
    if (a < opts.maxAttempts - 1) await sleep(opts.delayMs);
  }
  log('4_settleFolio_balance_poll_exhausted', { attempts: opts.maxAttempts, lastBalance: last });
  return last;
}

/** Amount Cloudbeds echoed on postReservation when invoice APIs still return 0 (used once — avoids double payment on second settle). */
function extractPostReservationAmountHint(reservationData: unknown): number | null {
  if (reservationData == null || typeof reservationData !== 'object') return null;
  const roots: unknown[] = [reservationData, (reservationData as any).data].filter(Boolean);
  for (const r of roots) {
    const n = pickHintAmountFromObject(r);
    if (n != null) return n;
  }
  return null;
}

/** Ordered payment method `type` values for postPayment (must match getPaymentMethods `method`). */
async function resolvePaymentTypesToTry(
  apiV13: string,
  propertyID: string,
  apiKey: string
): Promise<string[]> {
  const envType = process.env.CLOUDBEDS_POST_PAYMENT_TYPE?.trim();
  const ordered: string[] = [];
  if (envType) ordered.push(envType);
  try {
    const url = `${apiV13}/getPaymentMethods?propertyID=${encodeURIComponent(propertyID)}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    const parsed = await resp.json();
    const paymentMethodsRaw = parsed?.data ?? parsed?.paymentMethods ?? parsed;
    const methods = Array.isArray(paymentMethodsRaw?.methods) ? paymentMethodsRaw.methods : [];
    const byPreference = (name: string) =>
      methods.find((m: any) => {
        const n = String(m.name ?? '').toLowerCase();
        const c = String(m.code ?? '').toLowerCase();
        const method = String(m.method ?? '').toLowerCase();
        return n === name || c === name || method === name;
      });
    const pushMethod = (m: any) => {
      const t = String(m?.method ?? m?.code ?? '').trim();
      if (t && !ordered.includes(t)) ordered.push(t);
    };
    const clc = byPreference('clc');
    if (clc) pushMethod(clc);
    const cash = byPreference('cash');
    if (cash) pushMethod(cash);
    for (const m of methods) pushMethod(m);
  } catch {
    /* ignore */
  }
  if (!ordered.includes('cash')) ordered.push('cash');
  if (!ordered.includes('CLC')) ordered.push('CLC');
  return [...new Set(ordered)];
}

async function postPaymentWithType(
  apiV13: string,
  propertyID: string,
  apiKey: string,
  reservationID: string,
  amount: number,
  paymentType: string,
  description: string
): Promise<{ ok: boolean; data: any; raw: string }> {
  const paymentParams = new URLSearchParams();
  paymentParams.append('propertyID', propertyID);
  paymentParams.append('reservationID', String(reservationID));
  paymentParams.append('type', paymentType);
  paymentParams.append('amount', amount.toFixed(2));
  paymentParams.append('description', description);
  const paymentResponse = await fetch(`${apiV13}/postPayment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: paymentParams.toString(),
  });
  const paymentText = await paymentResponse.text();
  let paymentResult: any;
  try {
    paymentResult = JSON.parse(paymentText);
  } catch {
    paymentResult = { success: false, message: paymentText };
  }
  const ok = paymentResponse.ok && paymentResult.success === true;
  return { ok, data: paymentResult, raw: paymentText };
}

export type SettleReservationFolioOptions = {
  /** From postReservation only, first settle: invoice still reads $0 — use hint once to avoid double-charging. */
  amountDueHint?: number | null;
  /**
   * After a successful postPayment, getReservationInvoiceInformation often still returns the same
   * "due" (stale total vs balance). The strict duplicate guard would abort check-in / assign even
   * though CLC posted. When true: poll longer, then exit successfully if payment succeeded — do not
   * throw for stale invoice reads (used by TYE assign-placeholder and performCloudbedsCheckIn).
   */
  trustStaleInvoiceAfterSuccessfulPayment?: boolean;
  /**
   * Shared state across multiple settleReservationFolio calls in one flow.
   * Prevents duplicate posts when later calls read stale due values.
   */
  settleState?: {
    lastPostedAmount?: number | null;
  };
};

/**
 * Pay down folio until Cloudbeds reports no meaningful balance — required before checked_in when
 * property enforces "collect full amount prior to checking in".
 *
 * `amountDueHint` (from postReservation only, first settle): used when invoice still reads $0 so we
 * still post CLC. Omit on later settles to avoid double-charging the same hint.
 */
export async function settleReservationFolio(
  apiV13: string,
  propertyID: string,
  apiKey: string,
  reservationID: string,
  guestLabel: string,
  log: (step: string, request?: unknown, response?: unknown, error?: string) => void,
  options?: SettleReservationFolioOptions
): Promise<void> {
  const types = await resolvePaymentTypesToTry(apiV13, propertyID, apiKey);
  const hint =
    options?.amountDueHint != null && Number(options.amountDueHint) > 0.01
      ? Number(options.amountDueHint)
      : null;
  log('4_settleFolio_start', { reservationID, types, amountDueHint: hint });

  /** If folio still shows the same dollars due after a successful post, Cloudbeds is likely exposing grandTotal-like fields as "due" — stop before duplicate CLC lines. */
  let amountPostedSuccessfully: number | null = null;
  const previouslyPostedAmount =
    options?.settleState?.lastPostedAmount != null
      ? Number(options.settleState.lastPostedAmount)
      : null;

  for (let round = 0; round < 4; round++) {
    let balance =
      round === 0
        ? await readOutstandingBalanceWithPoll(
            apiV13,
            propertyID,
            apiKey,
            reservationID,
            { maxAttempts: 14, delayMs: 400 },
            log
          )
        : await readOutstandingBalance(apiV13, propertyID, apiKey, reservationID);
    if (balance <= 0.01 && hint != null && round === 0) {
      log('4_settleFolio_using_postReservation_amount_hint', { amountDueHint: hint });
      balance = hint;
    }
    if (balance <= 0.01) {
      log('4_settleFolio_done', { round, balance });
      return;
    }
    if (
      options?.trustStaleInvoiceAfterSuccessfulPayment &&
      previouslyPostedAmount != null &&
      Math.abs(balance - previouslyPostedAmount) < 0.05
    ) {
      for (let p = 0; p < 10; p++) {
        await sleep(400);
        const b = await readOutstandingBalance(apiV13, propertyID, apiKey, reservationID);
        if (b <= 0.02) {
          log('4_settleFolio_prior_post_stale_resolved_after_poll', {
            attempts: p + 1,
            balance: b,
            lastPostedAmount: previouslyPostedAmount,
          });
          return;
        }
      }
      log('4_settleFolio_prior_post_trust_exit_stale_invoice', {
        balance,
        lastPostedAmount: previouslyPostedAmount,
      });
      return;
    }
    if (amountPostedSuccessfully != null && Math.abs(balance - amountPostedSuccessfully) < 0.05) {
      log('4_settleFolio_stale_same_due_after_payment', { balance, lastPostedAmount: amountPostedSuccessfully });
      if (options?.trustStaleInvoiceAfterSuccessfulPayment) {
        for (let p = 0; p < 15; p++) {
          await sleep(400);
          const b = await readOutstandingBalance(apiV13, propertyID, apiKey, reservationID);
          if (b <= 0.02) {
            log('4_settleFolio_stale_resolved_after_poll', { attempts: p + 1, balance: b });
            return;
          }
        }
        log('4_settleFolio_trust_post_exit_stale_invoice', {
          balance,
          note: 'postPayment succeeded; invoice still echoes prior due — continuing assign flow',
        });
        return;
      }
      throw new Error(
        'Automatic payment stopped: the folio still shows the same amount due after CLC was posted, which would create duplicate charges. In Cloudbeds, remove duplicate CLC lines on this reservation if needed, then finish from the dashboard or try again.'
      );
    }
    let paidThisRound = false;
    for (const paymentType of types) {
      const desc = `Kiosk CLC / folio — ${guestLabel}`;
      const r = await postPaymentWithType(
        apiV13,
        propertyID,
        apiKey,
        reservationID,
        balance,
        paymentType,
        desc
      );
      log('4_settleFolio_postPayment', {
        round,
        paymentType,
        amount: balance.toFixed(2),
        ok: r.ok,
        body: r.data,
      });
      if (r.ok) {
        paidThisRound = true;
        amountPostedSuccessfully = balance;
        if (options?.settleState) options.settleState.lastPostedAmount = balance;
        await sleep(500);
        break;
      }
    }
    if (!paidThisRound) {
      log('4_settleFolio_no_method_succeeded', { round, balance });
      break;
    }
  }

  const finalBal = await readOutstandingBalance(apiV13, propertyID, apiKey, reservationID);
  if (finalBal > 0.01) {
    if (
      options?.trustStaleInvoiceAfterSuccessfulPayment &&
      amountPostedSuccessfully != null
    ) {
      log('4_settleFolio_trust_exit_despite_final_invoice', {
        finalBal,
        lastPostedAmount: amountPostedSuccessfully,
      });
      return;
    }
    throw new Error(
      `There is a remaining balance on this reservation (${finalBal.toFixed(2)}). Payment could not be posted automatically — check Cloudbeds payment methods (CLC/cash) or contact support.`
    );
  }
}

function parseRoomsArrayFromGetRoomsJson(roomsData: any): any[] {
  let rooms: any[] = [];
  if (Array.isArray(roomsData.data) && roomsData.data.length > 0) {
    rooms = roomsData.data.flatMap((d: any) => (d && Array.isArray(d.rooms) ? d.rooms : d.rooms ? [d.rooms] : []));
  }
  if (rooms.length === 0 && roomsData.data?.[0]?.rooms) {
    rooms = roomsData.data[0].rooms;
  }
  if (rooms.length === 0 && Array.isArray(roomsData.data)) {
    rooms = roomsData.data;
  }
  if (rooms.length === 0 && Array.isArray(roomsData.rooms)) {
    rooms = roomsData.rooms;
  }
  if (rooms.length === 0 && Array.isArray(roomsData)) {
    rooms = roomsData;
  }
  if (rooms.length === 0 && roomsData.data) {
    rooms = [roomsData.data];
  }
  return rooms;
}

/**
 * Cloudbeds getRooms defaults to ~20 rooms per page. Check-in used a single unpaginated call, so rooms
 * beyond the first page (e.g. 308i) were missing → "Room … not found" even though the kiosk listed them.
 */
async function fetchAllRoomsPagesMerged(
  apiBase: string,
  propertyID: string,
  apiKey: string,
  opts?: { startDate?: string; endDate?: string }
): Promise<any[]> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const merged: any[] = [];
  const seen = new Set<string>();
  const pageSize = 500;
  let pageNumber = 1;
  const maxPages = 50;

  for (;;) {
    const params = new URLSearchParams({
      propertyID,
      pageNumber: String(pageNumber),
      pageSize: String(pageSize),
      includeRoomRelations: '1',
    });
    if (opts?.startDate) params.set('startDate', opts.startDate);
    if (opts?.endDate) params.set('endDate', opts.endDate);

    const url = `${apiBase}/getRooms?${params.toString()}`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      if (pageNumber === 1) return [];
      break;
    }
    const roomsData = await res.json();
    const batch = parseRoomsArrayFromGetRoomsJson(roomsData);
    if (batch.length === 0) break;

    let newCount = 0;
    for (const room of batch) {
      const id = String(room?.roomID ?? room?.id ?? '');
      const key = id || `${room?.roomName ?? ''}-${room?.roomTypeID ?? ''}`;
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(room);
        newCount += 1;
      }
    }
    if (newCount === 0) break;
    pageNumber += 1;
    if (pageNumber > maxPages) break;
  }
  return merged;
}

function findRoomByKey(rooms: any[], roomKey: string): any | undefined {
  const norm = (s: string) => s.replace(/^Room\s+/i, '').trim();
  const stripTrailingLetter = (s: string) => s.replace(/[a-zA-Z]+$/, '').trim();
  const digits = (s: string) => s.replace(/\D/g, '');
  const keyDigits = digits(roomKey);
  const looseIdMatch = (a: string, b: string) =>
    a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase();
  const keyLower = roomKey.toLowerCase();

  // Run matching in descending priority tiers so that an exact ID/name match always
  // wins over a weaker suffix or digits-only match. Previously all checks were in a
  // single ||  chain, which meant a room earlier in the API response array could
  // steal a match via the digits fallback even when a correct exact match existed
  // further down the list (e.g. room 207's ID digits matching key "305").

  const tier1Matches = rooms.filter((r: any) => {
    const idStr = r.roomID != null ? String(r.roomID) : '';
    const idAlt = r.id != null ? String(r.id) : '';
    const nameStr = (r.roomName != null ? String(r.roomName) : '').trim();
    const nameAlt = (r.name != null ? String(r.name) : '').trim();
    return (
      idStr === roomKey ||
      idAlt === roomKey ||
      looseIdMatch(idStr, roomKey) ||
      looseIdMatch(idAlt, roomKey) ||
      nameStr.toLowerCase() === keyLower ||
      nameAlt.toLowerCase() === keyLower ||
      nameStr === roomKey ||
      nameAlt === roomKey
    );
  });
  const tier1 = resolveDuplicateRoomMatches(tier1Matches, roomKey);
  if (tier1) return tier1;

  const tier2Matches = rooms.filter((r: any) => {
    const idStr = r.roomID != null ? String(r.roomID) : '';
    const idAlt = r.id != null ? String(r.id) : '';
    const nameStr = (r.roomName != null ? String(r.roomName) : '').trim();
    const nameAlt = (r.name != null ? String(r.name) : '').trim();
    return (
      norm(nameStr) === roomKey ||
      norm(nameAlt) === roomKey ||
      nameStr.endsWith(roomKey) ||
      nameAlt.endsWith(roomKey) ||
      stripTrailingLetter(idStr) === roomKey ||
      stripTrailingLetter(idAlt) === roomKey ||
      stripTrailingLetter(nameStr) === roomKey ||
      stripTrailingLetter(nameAlt) === roomKey
    );
  });
  const tier2 = resolveDuplicateRoomMatches(tier2Matches, roomKey);
  if (tier2) return tier2;

  // Tier 3: digits-only fallback — only reached when no exact or normalised match
  // exists. Skipped entirely when the key contains no digits to avoid false positives.
  if (!keyDigits) return undefined;
  const tier3Matches = rooms.filter((r: any) => {
    const idStr = r.roomID != null ? String(r.roomID) : '';
    const idAlt = r.id != null ? String(r.id) : '';
    const nameStr = (r.roomName != null ? String(r.roomName) : '').trim();
    const nameAlt = (r.name != null ? String(r.name) : '').trim();
    return (
      digits(idStr) === keyDigits ||
      digits(idAlt) === keyDigits ||
      digits(nameStr) === keyDigits ||
      digits(nameAlt) === keyDigits
    );
  });
  return resolveDuplicateRoomMatches(tier3Matches, roomKey);
}

/** Raw rows from GET getRatePlans (v1.2 base URL). */
async function fetchCloudbedsRatePlansRows(
  apiV12Base: string,
  propertyID: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<any[]> {
  const ratesUrl = `${apiV12Base}/getRatePlans?propertyID=${propertyID}&startDate=${startDate}&endDate=${endDate}`;
  try {
    const ratesResponse = await fetch(ratesUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!ratesResponse.ok) return [];
    const ratesData = await ratesResponse.json();
    return ratesData.data || ratesData.rates || ratesData || [];
  } catch {
    return [];
  }
}

/** Rates for one room type + the TYE row (plan 227753 or name contains "tye"). */
function findTyeRateForRoomType(rates: any[], roomTypeID: string | number | null): {
  allRatesForRoomType: any[];
  tyeRate: any | undefined;
} {
  const roomTypeStr = String(roomTypeID);
  const roomTypeNum = Number(roomTypeID);
  const allRatesForRoomType = rates.filter((rate: any) => {
    const rtID = rate.roomTypeID ?? rate.room_type_id ?? rate.roomType_id;
    return String(rtID) === roomTypeStr || Number(rtID) === roomTypeNum;
  });
  const tyeRate = allRatesForRoomType.find((rate: any) => {
    const planID = String(rate.ratePlanID ?? rate.rate_plan_id ?? rate.ratePlan_id ?? '');
    const planName = String(rate.ratePlanName ?? rate.name ?? '').toLowerCase();
    return planID === '227753' || Number(planID) === 227753 || planName.includes('tye');
  });
  return { allRatesForRoomType, tyeRate };
}


/** Identifies the unassigned room *line* on the reservation for postRoomAssign (not the physical room id from getRooms). */
function extractReservationRoomLineId(root: any): string | null {
  const data = root?.data;
  const bases = [root, data, Array.isArray(data) ? data[0] : null].filter(Boolean);
  for (const b of bases) {
    const lists = [b.unassigned, b.unassignedRooms].filter(Boolean);
    for (const arr of lists) {
      if (!Array.isArray(arr) || !arr[0]) continue;
      const id = arr[0]?.reservationRoomID ?? arr[0]?.reservationRoomId;
      if (id != null && String(id).trim() !== '') return String(id);
    }
  }
  const d = root?.data ?? root;
  const gl = d?.guestList;
  if (gl && typeof gl === 'object') {
    for (const g of Object.values(gl) as any[]) {
      const ur = g?.unassignedRooms;
      if (Array.isArray(ur) && ur[0]?.reservationRoomID != null && String(ur[0].reservationRoomID).trim() !== '') {
        return String(ur[0].reservationRoomID);
      }
      const rms = g?.rooms;
      if (Array.isArray(rms) && rms[0]?.reservationRoomID != null && String(rms[0].reservationRoomID).trim() !== '') {
        return String(rms[0].reservationRoomID);
      }
    }
  }
  return null;
}

/** True when getReservation shows a physical room already on the booking (postReservation may still echo unassigned[]). */
function reservationAlreadyHasPhysicalRoom(root: any): boolean {
  const d = root?.data ?? root;
  const assigned = d?.assigned;
  if (Array.isArray(assigned) && assigned.length > 0) {
    const a = assigned[0];
    if (a?.roomID != null && String(a.roomID).trim() !== '') return true;
  }
  const gl = d?.guestList;
  if (gl && typeof gl === 'object') {
    for (const g of Object.values(gl) as any[]) {
      if (g?.assignedRoom === true && g?.roomID != null && String(g.roomID).trim() !== '') return true;
    }
  }
  return false;
}

/** All physical room IDs Cloudbeds reports on the reservation (assigned lines + guest rooms). */
function extractAssignedRoomIdsFromGetReservationRoot(root: any): string[] {
  const ids: string[] = [];
  const d = root?.data ?? root;
  const assigned = d?.assigned;
  if (Array.isArray(assigned)) {
    for (const a of assigned) {
      if (a?.roomID != null && String(a.roomID).trim() !== '') ids.push(String(a.roomID));
    }
  }
  const gl = d?.guestList;
  if (gl && typeof gl === 'object') {
    for (const g of Object.values(gl) as any[]) {
      if (g?.roomID != null && String(g.roomID).trim() !== '') ids.push(String(g.roomID));
      const rms = g?.rooms;
      if (Array.isArray(rms)) {
        for (const r of rms) {
          if (r?.roomID != null && String(r.roomID).trim() !== '') ids.push(String(r.roomID));
        }
      }
    }
  }
  return [...new Set(ids.map((x) => String(x)))];
}

async function getReservationAssignedRoomIds(
  apiV13: string,
  propertyID: string,
  apiKey: string,
  reservationID: string
): Promise<string[]> {
  const url = `${apiV13}/getReservation?propertyID=${encodeURIComponent(propertyID)}&reservationID=${encodeURIComponent(reservationID)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!res.ok || !parsed?.success) return [];
  return extractAssignedRoomIdsFromGetReservationRoot(parsed);
}

async function cancelCloudbedsReservation(
  apiV13: string,
  propertyID: string,
  apiKey: string,
  reservationID: string
): Promise<boolean> {
  try {
    const p = new URLSearchParams();
    p.append('propertyID', propertyID);
    p.append('reservationID', String(reservationID));
    p.append('status', 'cancelled');
    const r = await fetch(`${apiV13}/putReservation`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: p.toString(),
    });
    const text = await r.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    return r.ok && parsed.success === true;
  } catch (e) {
    console.error('[cloudbeds-checkin] cancelCloudbedsReservation failed:', e);
    return false;
  }
}

/**
 * TYE blocks must land on the requested physical room. Poll getReservation until the expected
 * room ID appears, another room appears (mismatch → fail), or attempts exhaust.
 */
async function verifyPlaceholderReservationRoomOrCancel(
  apiV13: string,
  propertyID: string,
  apiKey: string,
  reservationID: string,
  expectedRoomId: string,
  roomLabel: string,
  checkInDate: string,
  log: (step: string, request?: unknown, response?: unknown, error?: string) => void
): Promise<void> {
  const expected = String(expectedRoomId).trim();
  if (!expected) {
    await cancelCloudbedsReservation(apiV13, propertyID, apiKey, reservationID);
    throw new Error(
      `Could not determine a physical room ID for "${roomLabel}" — no TYE block was created.`
    );
  }

  const matchesExpected = (got: string) => {
    const a = String(got).trim();
    const b = expected;
    if (a === b) return true;
    const na = Number(a);
    const nb = Number(b);
    return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb;
  };

  const maxAttempts = 6;
  const delayMs = 450;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ids = await getReservationAssignedRoomIds(apiV13, propertyID, apiKey, reservationID);
    log('tye_verify_room_poll', { attempt: attempt + 1, reservationID, expected, assignedRoomIds: ids });

    if (ids.some((id) => matchesExpected(id))) {
      return;
    }
    if (ids.length > 0) {
      await cancelCloudbedsReservation(apiV13, propertyID, apiKey, reservationID);
      throw new Error(
        `Room "${roomLabel}" was not available for ${checkInDate} — Cloudbeds assigned a different room (${ids.join(', ')}). The draft reservation was cancelled; no block was saved.`
      );
    }
    if (attempt < maxAttempts - 1) await sleep(delayMs);
  }

  await cancelCloudbedsReservation(apiV13, propertyID, apiKey, reservationID);
  throw new Error(
    `Room "${roomLabel}" could not be confirmed on the reservation for ${checkInDate} (no physical room on the booking after creation). The draft reservation was cancelled; no block was saved.`
  );
}

/** Cloudbeds getReservations uses firstName / lastName and checkInFrom / checkInTo — not guestFirstName / startDate. */
function rowMatchesGuestName(row: any, guestFirstName: string, guestLastName: string): boolean {
  const fn = guestFirstName.trim().toLowerCase();
  const ln = guestLastName.trim().toLowerCase();
  const a = String(row?.guestFirstName ?? row?.firstName ?? '').trim().toLowerCase();
  const b = String(row?.guestLastName ?? row?.lastName ?? '').trim().toLowerCase();
  if (a === fn && b === ln) return true;
  const gn = String(row?.guestName ?? '').trim().toLowerCase();
  const full = `${fn} ${ln}`.trim();
  return gn === full || (gn.includes(fn) && gn.includes(ln));
}

function reservationOverlapsStayWindow(row: any, checkInDate: string, checkOutDate: string): boolean {
  const start = String(row?.startDate ?? row?.checkInDate ?? '').slice(0, 10);
  const end = String(row?.endDate ?? row?.checkOutDate ?? '').slice(0, 10);
  if (!start) return false;
  if (end && end <= checkInDate) return false;
  if (start >= checkOutDate) return false;
  return true;
}

async function fetchGuestReservationsForStayWindow(
  apiV13: string,
  propertyID: string,
  apiKey: string,
  guestFirstName: string,
  guestLastName: string,
  checkInFrom: string,
  checkInTo: string,
  log?: (step: string, request?: unknown, response?: unknown, error?: string) => void
): Promise<any[]> {
  const aggregated: any[] = [];
  const seenIds = new Set<string>();
  let pageNumber = 1;
  const pageSize = 100;
  const maxPages = 15;
  for (; pageNumber <= maxPages; pageNumber++) {
    const params = new URLSearchParams({
      propertyID,
      firstName: guestFirstName,
      lastName: guestLastName,
      checkInFrom,
      checkInTo,
      statuses: 'confirmed,checked_in,not_confirmed',
      pageNumber: String(pageNumber),
      pageSize: String(pageSize),
      includeAllRooms: 'true',
      sortByRecent: 'true',
    });
    const url = `${apiV13}/getReservations?${params.toString()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      log?.('guest_stay_lookup_http_error', { pageNumber, status: res.status });
      break;
    }
    const j = await res.json();
    const list = Array.isArray(j?.data) ? j.data : Array.isArray(j?.reservations) ? j.reservations : [];
    for (const row of list) {
      const id = String(row?.reservationID ?? '').trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      aggregated.push(row);
    }
    if (list.length < pageSize) break;
  }
  return aggregated;
}

/** Room IDs assigned on a getReservations list row (assigned[] / rooms[] / top-level roomID). */
function reservationAssignedRoomIds(row: any): string[] {
  const ids = new Set<string>();
  const push = (v: unknown) => {
    if (v == null || String(v).trim() === '') return;
    ids.add(String(v).trim());
  };
  for (const key of ['assigned', 'rooms'] as const) {
    const arr = row?.[key];
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      if (r && typeof r === 'object') push((r as { roomID?: unknown }).roomID);
    }
  }
  push(row?.roomID);
  return [...ids];
}

/**
 * Match an existing Cloudbeds booking for retry recovery only — same guest, same stay,
 * and the same physical room. Does not match name-only (allows two check-ins for the
 * same guest name on different rooms, or back-to-back stays).
 */
function pickMatchingReservationForSameRoomStay(
  rows: any[],
  guestFirstName: string,
  guestLastName: string,
  checkInDate: string,
  checkOutDate: string,
  targetRoomId: string | null | undefined
): any | null {
  const roomId = targetRoomId != null ? String(targetRoomId).trim() : '';
  if (!roomId) return null;

  const candidates = rows.filter(
    (r) =>
      rowMatchesGuestName(r, guestFirstName, guestLastName) &&
      reservationOverlapsStayWindow(r, checkInDate, checkOutDate) &&
      reservationAssignedRoomIds(r).includes(roomId)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const ta = String(a?.reservationID ?? '');
    const tb = String(b?.reservationID ?? '');
    return tb.localeCompare(ta, undefined, { numeric: true });
  });
  return candidates[0];
}

/** Shape compatible with postReservation JSON so the rest of performCloudbedsCheckIn can run. */
async function loadReservationPayloadFromCloudbeds(
  apiV13: string,
  propertyID: string,
  apiKey: string,
  reservationID: string
): Promise<any | null> {
  const grUrl = `${apiV13}/getReservation?propertyID=${encodeURIComponent(propertyID)}&reservationID=${encodeURIComponent(reservationID)}`;
  const grResp = await fetch(grUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  if (!grResp.ok) return null;
  const grJson = await grResp.json();
  const u = unwrapReservationFromGetReservation(grJson);
  if (!u || u.reservationID == null) return null;
  const rid = String(u.reservationID);
  const gid = u.guestID != null ? String(u.guestID) : undefined;
  return {
    success: true,
    data: { reservationID: rid, guestID: gid },
    reservationID: rid,
    guestID: gid,
    unassigned: u.unassigned,
    assigned: u.assigned,
    assignedRooms: u.assigned,
  };
}

export interface PerformCheckInParams {
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  roomName: string;
  /** Human room label from kiosk (e.g. "308i") — used if roomName id doesn't match getRooms rows. */
  roomNameHint?: string;
  clcNumber?: string;
  classType?: string;
  email?: string;
  checkInDate?: string;
  checkOutDate?: string;
  /**
   * When true: run the same room list + TYE rate + postReservation path as kiosk walk-in,
   * then return without folio payment, room assignment, or check-in. Used for TYE placeholder bookings.
   */
  stopAfterReservationCreate?: boolean;
  /**
   * When true: skip all room-specific attempts and create a reservation with no physical room
   * (unassigned). Used by the admin check-in panel when staff explicitly selects "Unassigned".
   * The reservation is confirmed + paid; staff assigns the room in Cloudbeds later.
   */
  forceUnassigned?: boolean;
  /**
   * When true: every postReservation attempt includes allowOverbooking=1 (also the default
   * for kiosk walk-in check-ins so inventory/overbooking blocks do not prevent a booking).
   */
  allowOverbooking?: boolean;
  /** If provided, request/response trail for each step is pushed here (for debugging room-assignment issues). */
  debugLog?: Array<{ step: string; request?: unknown; response?: unknown; error?: string }>;
}

export interface PerformCheckInResult {
  success: true;
  guestID?: string;
  reservationID: string;
  roomName: string;
  message: string;
  /** Present when stopAfterReservationCreate completed (placeholder flow). */
  roomTypeID?: string;
  roomTypeName?: string;
  /** When the physical room was not bookable but an unassigned reservation was created and paid (stay confirmed, not checked in). */
  reservationStatus?: 'checked_in' | 'confirmed';
}

export async function performCloudbedsCheckIn(params: PerformCheckInParams): Promise<PerformCheckInResult> {
  const {
    firstName,
    lastName,
    phoneNumber,
    roomName,
    roomNameHint,
    clcNumber,
    classType,
    email,
    checkInDate: bodyCheckIn,
    checkOutDate: bodyCheckOut,
    stopAfterReservationCreate,
    forceUnassigned,
    allowOverbooking: allowOverbookingParam,
    debugLog,
  } = params;

  // CLC is required for real guest check-ins but not for block/placeholder reservations
  // (stopAfterReservationCreate is set exclusively by the Blocks tab).
  if (!stopAfterReservationCreate) {
    const clcValidation = validateClcNumberRequired(clcNumber);
    if (!clcValidation.ok) {
      throw new Error(clcValidation.error);
    }
  }

  const guestFirstName = String(firstName).trim().replace(/\s+/g, ' ');
  const guestLastName = String(lastName).trim().replace(/\s+/g, ' ');

  const log = (step: string, request?: unknown, response?: unknown, error?: string) => {
    debugLog?.push({ step, request, response, error });
  };
  const settleState: { lastPostedAmount?: number | null } = {};

  const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
  const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
  const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
  const baseUrl = (CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2').replace(/\/v1\.\d+\/?$/, '');
  const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;

  if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
    throw new Error('Cloudbeds not configured');
  }

  const now = new Date();
  const checkInDate = (bodyCheckIn && /^\d{4}-\d{2}-\d{2}$/.test(String(bodyCheckIn)))
    ? String(bodyCheckIn)
    : getLocalDateStr(now);
  // Cloudbeds requires endDate AFTER startDate for a bookable night. Same-day start/end returns
  // "could not accommodate your request" from postReservation.
  let checkOutDate = (bodyCheckOut && /^\d{4}-\d{2}-\d{2}$/.test(String(bodyCheckOut)))
    ? String(bodyCheckOut)
    : addOneCalendarDayYmd(checkInDate);
  if (checkOutDate <= checkInDate) {
    checkOutDate = addOneCalendarDayYmd(checkInDate);
    log('0_dates_normalized', {
      reason: 'endDate must be after startDate for Cloudbeds',
      checkInDate,
      checkOutDate,
    });
  }

  const serverUtcToday = getLocalDateStr(new Date());
  // Only treat checkInDate as "past" when it is at least 2 calendar days behind the server UTC
  // date. A 1-day gap is normal for US evening check-ins: at 10 PM CDT the Vercel server (UTC)
  // is already on the next UTC day, so serverUtcToday appears 1 day ahead of the valid local
  // check-in date. Treating that as "past" incorrectly triggers overbooking fallbacks and causes
  // Cloudbeds to reject postReservation as back-dated. Only flag as past when the day AFTER
  // checkInDate is still behind serverUtcToday (i.e. a genuine 2+ day gap).
  const isPastCheckInDate = addOneCalendarDayYmd(checkInDate) < serverUtcToday;
  const useOverbooking = allowOverbookingParam === true || isPastCheckInDate;
  if (useOverbooking) {
    log('0_allowOverbooking', {
      checkInDate,
      serverUtcToday,
      reason: allowOverbookingParam === true ? 'explicit' : 'past_check_in_date',
    });
  }

  // forceUnassigned: admin explicitly wants an unassigned reservation.
  // Try multiple room types for the selected stay dates (Cloudbeds can reject a specific
  // type with "could not accommodate your request" even when another type can be booked
  // as unassigned). Only fail after exhausting candidates.
  if (forceUnassigned && !stopAfterReservationCreate) {
    log('0_forceUnassigned', { note: 'Admin requested unassigned reservation — skipping room-specific paths' });

    const candidateRoomTypeIDs: string[] = [];
    const seenTypeIDs = new Set<string>();
    const pushType = (val: unknown) => {
      if (val == null) return;
      const s = String(val).trim();
      if (!s || seenTypeIDs.has(s)) return;
      seenTypeIDs.add(s);
      candidateRoomTypeIDs.push(s);
    };

    try {
      const stayRooms = await fetchAllRoomsPagesMerged(apiV13, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY, {
        startDate: checkInDate,
        endDate: checkOutDate,
      });
      for (const room of stayRooms) {
        pushType(room?.roomTypeID ?? room?.roomType_id);
      }
      if (candidateRoomTypeIDs.length === 0) {
        const allRooms = await fetchAllRoomsPagesMerged(apiV13, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY);
        for (const room of allRooms) {
          pushType(room?.roomTypeID ?? room?.roomType_id);
        }
      }
    } catch (e: any) {
      log('0_forceUnassigned_rooms_error', undefined, undefined, e?.message);
    }

    const wantTye = String(classType ?? '').toUpperCase() === 'TYE';
    let stayRates: any[] = [];
    try {
      stayRates = await fetchCloudbedsRatePlansRows(
        CLOUDBEDS_API_URL,
        CLOUDBEDS_PROPERTY_ID,
        CLOUDBEDS_API_KEY,
        checkInDate,
        checkOutDate
      );
    } catch {
      stayRates = [];
    }

    const buildUnassignedParams = (roomTypeID: string, roomRateID: string | null): URLSearchParams => {
      const p = new URLSearchParams();
      p.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      p.append('startDate', checkInDate);
      p.append('endDate', checkOutDate);
      p.append('guestFirstName', guestFirstName);
      p.append('guestLastName', guestLastName);
      p.append('guestCountry', 'US');
      p.append('guestZip', '00000');
      p.append(
        'guestEmail',
        email != null && String(email).trim() !== ''
          ? String(email).trim()
          : buildGuestSyntheticEmail(guestFirstName, guestLastName)
      );
      p.append('guestPhone', phoneNumber || '000-000-0000');
      p.append('paymentMethod', 'CLC');
      p.append('rooms[0][roomTypeID]', roomTypeID);
      p.append('rooms[0][quantity]', '1');
      if (roomRateID) p.append('rooms[0][roomRateID]', roomRateID);
      p.append('adults[0][roomTypeID]', roomTypeID);
      p.append('adults[0][quantity]', '1');
      p.append('children[0][roomTypeID]', roomTypeID);
      p.append('children[0][quantity]', '0');
      p.append('sourceID', 's-945658-1');
      if (useOverbooking) p.append('allowOverbooking', '1');
      return p;
    };

    let respParsed: any = {};
    let createdReservation = false;
    for (const roomTypeID of candidateRoomTypeIDs.length > 0 ? candidateRoomTypeIDs : ['']) {
      let roomRateID: string | null = null;
      if (wantTye) {
        const { tyeRate } = findTyeRateForRoomType(stayRates, roomTypeID);
        roomRateID = tyeRate
          ? String(tyeRate.rateID ?? tyeRate.rate_id ?? tyeRate.id ?? tyeRate.ratePlanID ?? 227753)
          : '227753';
      }
      if (!roomTypeID) continue;
      const unassignedParams = buildUnassignedParams(roomTypeID, roomRateID);

      log('0_forceUnassigned_postReservation_request', {
        roomTypeID,
        roomRateID: roomRateID ?? undefined,
        startDate: checkInDate,
        endDate: checkOutDate,
      });

      const resp = await fetch(`${apiV13}/postReservation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CLOUDBEDS_API_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: unassignedParams.toString(),
      });
      const respText = await resp.text();
      try {
        respParsed = JSON.parse(respText);
      } catch {
        respParsed = { success: false, message: respText };
      }
      log('0_forceUnassigned_postReservation_response', {
        status: resp.status,
        roomTypeID,
        body: respParsed,
      });

      if (resp.ok && respParsed.success === true) {
        createdReservation = true;
        break;
      }
    }

    if (!createdReservation) {
      throw new Error(
        typeof respParsed?.message === 'string' && respParsed.message
          ? respParsed.message
          : 'Failed to create unassigned reservation in Cloudbeds'
      );
    }

    const resID = respParsed.data?.reservationID ?? respParsed.reservationID;
    const gstID = respParsed.data?.guestID ?? respParsed.guestID;
    if (!resID) throw new Error('No reservationID returned from Cloudbeds');

    // Settle folio so the reservation is paid (confirmed + paid, no check-in)
    const amtHint = extractPostReservationAmountHint(respParsed);
    await settleReservationFolio(
      apiV13, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY, String(resID),
      `${guestFirstName} ${guestLastName}`, log,
      { amountDueHint: amtHint, trustStaleInvoiceAfterSuccessfulPayment: true, settleState }
    );

    return {
      success: true,
      guestID: gstID,
      reservationID: String(resID),
      roomName: 'Unassigned',
      message: 'Unassigned reservation created and paid. Staff must assign a room in Cloudbeds.',
      reservationStatus: 'confirmed',
    };
  }

  // Step 1: Full property room list (paginated — single getRooms only returns ~20 rooms by default).
  const rooms = await fetchAllRoomsPagesMerged(apiV13, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY);

  let roomTypeName = 'Standard Room';
  let roomTypeID: string | number | null = null;
  let actualRoomID: string | number | null = null;
  let selectedRoomName: string | null = null;

  const roomListSummary: any[] = rooms.slice(0, 50).map((r: any) => ({
    roomID: r.roomID ?? r.id,
    roomName: r.roomName ?? r.name,
    roomTypeID: r.roomTypeID ?? r.roomType_id,
  }));
  if (rooms.length > 50) {
    roomListSummary.push({ _note: `... and ${rooms.length - 50} more rooms` });
  }
  log('1_getRooms_response', {
    mode: 'all_pages',
    roomCount: rooms.length,
    rooms: roomListSummary,
  });

  const roomKey = String(roomName).trim();
  const hint = roomNameHint != null && String(roomNameHint).trim() !== '' ? String(roomNameHint).trim() : '';

  let selectedRoom = findRoomByKey(rooms, roomKey);
  if (!selectedRoom && hint && hint !== roomKey) {
    selectedRoom = findRoomByKey(rooms, hint);
    if (selectedRoom) {
      log('2_room_match', { roomKey, fallbackHint: hint, found: true });
    }
  }

  if (!selectedRoom) {
    log('2_room_match', { roomKey, hint: hint || undefined, found: false, error: `Room ${roomName} not found` });
    throw new Error(`Room ${roomName} not found`);
  }

  roomTypeName = selectedRoom.roomTypeName || selectedRoom.roomType || 'Standard Room';
  roomTypeID = selectedRoom.roomTypeID || selectedRoom.roomType_id;
  actualRoomID = selectedRoom.roomID || selectedRoom.id;
  selectedRoomName = selectedRoom.roomName ?? selectedRoom.name ?? null;
  log('2_room_match', {
    roomKey,
    found: true,
    actualRoomID,
    selectedRoomName,
    roomTypeID,
    roomTypeName,
  });

  // Same room for the stay window — paginated dated getRooms (inventory for check-in → check-out nights).
  let roomIdForStayPeriod: string | null = null;
  try {
    log('1b_getRooms_stay_dates_request', { startDate: checkInDate, endDate: checkOutDate });
    const stayRooms = await fetchAllRoomsPagesMerged(apiV13, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY, {
      startDate: checkInDate,
      endDate: checkOutDate,
    });
    let stayRoom = findRoomByKey(stayRooms, roomKey);
    if (!stayRoom && hint) {
      stayRoom = findRoomByKey(stayRooms, hint);
    }
    if (stayRoom && (stayRoom.roomID != null || stayRoom.id != null)) {
      roomIdForStayPeriod = String(stayRoom.roomID ?? stayRoom.id);
    }
    log('1b_getRooms_stay_dates_response', {
      roomCount: stayRooms.length,
      matchedRoomId: roomIdForStayPeriod,
    });
  } catch (e: any) {
    log('1b_getRooms_stay_dates_error', undefined, undefined, e?.message);
  }

  // Step 2: Get rate — TYE for kiosk (classType TYE). Past start dates often omit TYE from getRatePlans;
  // resolve TYE from today's calendar when missing so yesterday matches walk-in today.
  const wantTye = String(classType ?? '').toUpperCase() === 'TYE';
  let rateID: string | number | null = null;
  let ratePlanID: string | number | null = null;
  // Kept in outer scope so the unassigned last-resort fallback can look up the correct rate per room type.
  let stayRatesForFallback: any[] = [];
  try {
    const stayRates = await fetchCloudbedsRatePlansRows(
      CLOUDBEDS_API_URL,
      CLOUDBEDS_PROPERTY_ID,
      CLOUDBEDS_API_KEY,
      checkInDate,
      checkOutDate
    );
    stayRatesForFallback = stayRates;
    let { allRatesForRoomType, tyeRate } = findTyeRateForRoomType(stayRates, roomTypeID);

    if (!tyeRate && wantTye) {
      // Use checkInDate as the base anchor. If the check-in date is genuinely in the past
      // (2+ day gap, i.e. admin backdating) fall back to the current server UTC date to find
      // an active TYE rate plan. Using server UTC directly was a bug for evening kiosk check-ins:
      // at 10 PM local CDT the Vercel server (UTC) is already on the next UTC day, so the anchor
      // would land on "tomorrow", fetching rates for a different night than the stay window.
      const anchorStart = isPastCheckInDate ? serverUtcToday : checkInDate;
      const anchorEnd = isPastCheckInDate ? addOneCalendarDayYmd(serverUtcToday) : checkOutDate;
      const sameWindowAsStay = anchorStart === checkInDate && anchorEnd === checkOutDate;
      if (!sameWindowAsStay) {
        log('2_getRatePlans_tye_anchor_window', {
          stayWindow: { checkInDate, checkOutDate },
          anchorWindow: { anchorStart, anchorEnd },
          note: 'TYE not in stay-window rate list — using current calendar to resolve same TYE plan as walk-in today',
        });
        const anchorRates = await fetchCloudbedsRatePlansRows(
          CLOUDBEDS_API_URL,
          CLOUDBEDS_PROPERTY_ID,
          CLOUDBEDS_API_KEY,
          anchorStart,
          anchorEnd
        );
        tyeRate = findTyeRateForRoomType(anchorRates, roomTypeID).tyeRate;
        // If still not found for this room type, try other room types in the anchor window.
        // Some room types (e.g. double queen) may have the TYE plan listed under a different
        // roomTypeID in getRatePlans — use the rate plan row from any matching TYE entry.
        if (!tyeRate) {
          tyeRate = anchorRates.find((rate: any) => {
            const planID = String(rate.ratePlanID ?? rate.rate_plan_id ?? rate.ratePlan_id ?? '');
            const planName = String(rate.ratePlanName ?? rate.name ?? '').toLowerCase();
            return planID === '227753' || Number(planID) === 227753 || planName.includes('tye');
          });
          if (tyeRate) {
            log('2_getRatePlans_tye_cross_type_fallback', {
              note: `TYE rate not found for roomTypeID=${roomTypeID}; using TYE rate from a different room type as plan-ID fallback`,
              tyeRatePlanID: tyeRate.ratePlanID ?? tyeRate.rate_plan_id ?? tyeRate.ratePlan_id,
            });
          }
        }
      }
      // Final fallback: if still no TYE rate found in any room type, try the stay-window rates
      // across all room types before giving up.
      if (!tyeRate) {
        tyeRate = stayRates.find((rate: any) => {
          const planID = String(rate.ratePlanID ?? rate.rate_plan_id ?? rate.ratePlan_id ?? '');
          const planName = String(rate.ratePlanName ?? rate.name ?? '').toLowerCase();
          return planID === '227753' || Number(planID) === 227753 || planName.includes('tye');
        });
        if (tyeRate) {
          log('2_getRatePlans_tye_stay_window_cross_type_fallback', {
            note: `TYE rate found in stay-window rates for a different room type`,
            tyeRatePlanID: tyeRate.ratePlanID ?? tyeRate.rate_plan_id ?? tyeRate.ratePlan_id,
          });
        }
      }
    }

    if (tyeRate) {
      rateID = tyeRate.rateID ?? tyeRate.rate_id ?? tyeRate.id;
      ratePlanID = tyeRate.ratePlanID ?? tyeRate.rate_plan_id ?? tyeRate.ratePlan_id ?? 227753;
    } else if (wantTye) {
      // TYE rate plan not found in Cloudbeds for any room type — use the known plan ID directly.
      // This ensures double queen and other room types that may not be listed under roomTypeID
      // in getRatePlans still get the correct TYE rate applied rather than failing entirely.
      log('2_getRatePlans_tye_plan_id_direct_fallback', {
        roomTypeID,
        note: 'TYE rate plan not found via getRatePlans for any room type — using ratePlanID 227753 directly',
      });
      ratePlanID = 227753;
    } else if (allRatesForRoomType.length > 0) {
      const available = allRatesForRoomType.filter(
        (rate: any) => (rate.roomsAvailable == null || rate.roomsAvailable > 0) && !rate.roomBlocked
      );
      const fallback = available[0] ?? allRatesForRoomType[0];
      rateID = fallback.rateID ?? fallback.rate_id ?? fallback.id;
      ratePlanID = fallback.ratePlanID ?? fallback.rate_plan_id ?? fallback.ratePlan_id;
    }
  } catch (e: unknown) {
    if (wantTye && ratePlanID == null) {
      // Rate lookup threw unexpectedly — still proceed with the known TYE plan ID so
      // the reservation is created rather than failing silently.
      log('2_getRatePlans_error_tye_fallback', {
        error: e instanceof Error ? e.message : String(e),
        note: 'Using ratePlanID 227753 as fallback after getRatePlans error',
      });
      ratePlanID = 227753;
    }
    // Non-TYE or transient errors: proceed without rate (legacy behavior)
  }

  const roomTypeIDStr = String(roomTypeID ?? '');
  const roomRateIDStr = rateID != null ? String(rateID) : ratePlanID != null ? String(ratePlanID) : '';

  // Prefer stay-window room id from getRooms(startDate,endDate); Cloudbeds uses that inventory for the booking dates.
  const roomIdForCreate = roomIdForStayPeriod ?? actualRoomID;
  const canAttachPhysicalRoomToReservation =
    process.env.CLOUDBEDS_SKIP_POST_RESERVATION_ROOM_ID !== '1' && roomIdForCreate != null;

  interface PostReservationOpts {
    attachPhysicalRoom: boolean;
    dateOverride?: { startDate: string; endDate: string };
    /**
     * When true: omit rooms[0][roomTypeID] and send only rooms[0][roomID].
     * Bypasses Cloudbeds type-level inventory counting, which blocks new reservations
     * for rooms whose prior same-day reservation was unassigned but not yet cleared
     * from the type inventory cache.
     */
    roomIdOnly?: boolean;
    /**
     * When true: append allowOverbooking=1 to the request.
     * Forces Cloudbeds to create the reservation even when its overbooking policy
     * would normally reject it. Tried after all other attempts fail.
     */
    allowOverbooking?: boolean;
  }

  /**
   * Room types that must never be used as the "vehicle" type when creating an overbooking
   * reservation in a different room type (unassigned-last-resort / create-then-unassign paths).
   * These are premium or incompatible room classes that should not be billed or assigned to
   * TYE / interior-room guests even temporarily.
   */
  function isExcludedOverbookingFallbackType(roomTypeName: string | null | undefined): boolean {
    if (!roomTypeName) return false;
    const n = roomTypeName.trim().toLowerCase().replace(/\s+/g, ' ');
    return (
      n.includes('deluxe double queen') ||
      n.includes('deluxe queen') ||
      n === 'king' ||
      n.includes('deluxe king') ||
      n.includes('suite') ||
      n.includes('conference')
    );
  }

  /** True when the Cloudbeds error response indicates an overbooking or availability block. */
  function isOverbookingError(data: any): boolean {
    // Cloudbeds may nest the error message under data.message, data.error, data.data.message,
    // or data.data.error — check all common locations.
    const msg = String(
      data?.message ?? data?.error ?? data?.data?.message ?? data?.data?.error ?? ''
    ).toLowerCase();
    return (
      msg.includes('overbook') ||
      msg.includes('not available') ||
      msg.includes('could not accommodate') ||
      msg.includes('no rooms available') ||
      msg.includes('no room available') ||
      msg.includes('availability') ||
      msg.includes('sold out') ||
      msg.includes('no availability') ||
      msg.includes('fully booked') ||
      msg.includes('inventory') ||
      msg.includes('exceed') ||
      msg.includes('maximum occupancy') ||
      msg.includes('at capacity') ||
      msg.includes('no vacancy') ||
      msg.includes('occupied') ||
      msg.includes('already booked') ||
      msg.includes('not bookable')
    );
  }

  const buildReservationParams = (opts: PostReservationOpts): URLSearchParams => {
    const { attachPhysicalRoom, dateOverride, roomIdOnly, allowOverbooking } = opts;
    const reservationParams = new URLSearchParams();
    reservationParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    reservationParams.append('startDate', dateOverride?.startDate ?? checkInDate);
    reservationParams.append('endDate', dateOverride?.endDate ?? checkOutDate);
    reservationParams.append('guestFirstName', guestFirstName);
    reservationParams.append('guestLastName', guestLastName);
    reservationParams.append('guestCountry', 'US');
    reservationParams.append('guestZip', '00000');
    reservationParams.append(
      'guestEmail',
      (email != null && String(email).trim() !== '' ? String(email).trim() : buildGuestSyntheticEmail(guestFirstName, guestLastName))
    );
    reservationParams.append('guestPhone', phoneNumber || '000-000-0000');
    reservationParams.append('paymentMethod', 'CLC');
    if (allowOverbooking) {
      reservationParams.append('allowOverbooking', '1');
    }
    if (roomIdOnly && roomIdForCreate != null) {
      // Room-ID-only mode: skip roomTypeID to bypass type-level inventory check.
      // Used as a last resort when prior same-day unassigned reservations exhaust type inventory.
      const rid = String(roomIdForCreate);
      reservationParams.append('rooms[0][roomID]', rid);
      reservationParams.append('rooms[0][quantity]', '1');
      reservationParams.append('adults[0][quantity]', '1');
      reservationParams.append('children[0][quantity]', '0');
    } else {
      reservationParams.append('rooms[0][roomTypeID]', roomTypeIDStr);
      reservationParams.append('rooms[0][quantity]', '1');
      if (roomRateIDStr) reservationParams.append('rooms[0][roomRateID]', roomRateIDStr);
      reservationParams.append('adults[0][roomTypeID]', roomTypeIDStr);
      reservationParams.append('adults[0][quantity]', '1');
      reservationParams.append('children[0][roomTypeID]', roomTypeIDStr);
      reservationParams.append('children[0][quantity]', '0');
      if (attachPhysicalRoom && roomIdForCreate != null) {
        const rid = String(roomIdForCreate);
        reservationParams.append('rooms[0][roomID]', rid);
        reservationParams.append('adults[0][roomID]', rid);
        reservationParams.append('children[0][roomID]', rid);
      }
    }
    reservationParams.append('sourceID', 's-945658-1');
    return reservationParams;
  };

  // Step 3: Create reservation — try with a specific room first; if Cloudbeds rejects (e.g. prior guest still in-house),
  // retry without a physical room ID so inventory can still be booked as confirmed + paid; staff assigns the room later.
  let reservationData: any = {};
  let confirmedPayOnly = false;
  // Tracks whether the successful postReservation call explicitly pinned the physical room via rooms[0][roomID].
  // When false, Cloudbeds may have auto-assigned a different room — postRoomAssign must be run to correct it.
  let physicalRoomPinnedInCreate = false;

  const runPostReservation = async (opts: PostReservationOpts): Promise<{ ok: boolean; text: string; data: any }> => {
    const { attachPhysicalRoom, dateOverride, roomIdOnly } = opts;
    const reservationParams = buildReservationParams(opts);
    log('3_postReservation_request', {
      url: `${apiV13}/postReservation`,
      body: {
        roomTypeID: roomIdOnly ? undefined : roomTypeIDStr,
        roomID: (attachPhysicalRoom || roomIdOnly) && roomIdForCreate != null ? String(roomIdForCreate) : undefined,
        roomRateID: roomIdOnly ? undefined : (roomRateIDStr || undefined),
        startDate: dateOverride?.startDate ?? checkInDate,
        endDate: dateOverride?.endDate ?? checkOutDate,
        guestFirstName: guestFirstName,
        guestLastName: guestLastName,
        attachPhysicalRoom,
        roomIdOnly: roomIdOnly ?? false,
      },
    });
    const reservationResponse = await fetch(`${apiV13}/postReservation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: reservationParams.toString(),
    });
    const responseText = await reservationResponse.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = { success: false, message: responseText };
    }
    log('3_postReservation_response', {
      status: reservationResponse.status,
      attachPhysicalRoom,
      body: parsed,
    });
    const ok = reservationResponse.ok && parsed.success === true;
    return { ok, text: responseText, data: parsed };
  };

  /**
   * Ordered room-specific fallback attempts after the initial postReservation fails.
   * Escalates through progressively more permissive request shapes to punch through
   * overbooking and inventory blocks before giving up and falling back to unassigned.
   *
   * Order: roomIdOnly -> typeOnly -> allowOverbooking variants -> back-dated today retry
   * Returns true and sets reservationData when any attempt succeeds.
   */
  const attemptRoomSpecificFallbacks = async (failedData: any): Promise<boolean> => {
    const inventoryBlock = isOverbookingError(failedData);
    log('3_fallback_room_specific_start', {
      detectedOverbooking: inventoryBlock,
      failedMessage: failedData?.message ?? '(none)',
      useOverbooking,
      isPastCheckInDate,
    });

    // When useOverbooking is already active (admin/past date), lead with allowOverbooking=1.
    if (useOverbooking) {
      if (roomIdForCreate != null && !stopAfterReservationCreate) {
        const rObRoom = await runPostReservation({ attachPhysicalRoom: true, allowOverbooking: true });
        if (rObRoom.ok) {
          reservationData = rObRoom.data;
          physicalRoomPinnedInCreate = true;
          log('3_postReservation_fallback_overbook_room_first', { note: 'allowOverbooking=1 + room (priority)' });
          return true;
        }
        const rObRoomId = await runPostReservation({ attachPhysicalRoom: true, roomIdOnly: true, allowOverbooking: true });
        if (rObRoomId.ok) {
          reservationData = rObRoomId.data;
          physicalRoomPinnedInCreate = true;
          log('3_postReservation_fallback_overbook_roomid_first', { note: 'allowOverbooking=1 + roomIdOnly (priority)' });
          return true;
        }
      }
      {
        const rObType = await runPostReservation({ attachPhysicalRoom: false, allowOverbooking: true });
        if (rObType.ok) {
          reservationData = rObType.data;
          // physicalRoomPinnedInCreate remains false — type-only, Cloudbeds may auto-assign wrong room
          log('3_postReservation_fallback_overbook_type_first', { note: 'allowOverbooking=1 + type-only (priority)' });
          return true;
        }
      }
    }

    // 2a. Room-ID-only — bypasses type-level inventory count.
    // Skip only when the initial error was a hard inventory/overbook rejection, since
    // Cloudbeds will reject these too without allowOverbooking.
    if (!inventoryBlock) {
      if (roomIdForCreate != null && !stopAfterReservationCreate) {
        const r = await runPostReservation({ attachPhysicalRoom: true, roomIdOnly: true });
        if (r.ok) { reservationData = r.data; physicalRoomPinnedInCreate = true; log('3_postReservation_fallback_roomid_only', { note: 'Room-ID-only succeeded' }); return true; }
      }
      // 2b. Type-only (no physical room pinned) — Cloudbeds may auto-assign a different room.
      // physicalRoomPinnedInCreate remains false so postRoomAssign will correct the assignment.
      {
        const r = await runPostReservation({ attachPhysicalRoom: false });
        if (r.ok) { reservationData = r.data; log('3_postReservation_fallback_type_only', { note: 'Type-only succeeded' }); return true; }
      }
    }

    // 2c. allowOverbooking=1 with physical room.
    if (roomIdForCreate != null && !stopAfterReservationCreate) {
      const r = await runPostReservation({ attachPhysicalRoom: true, allowOverbooking: true });
      if (r.ok) { reservationData = r.data; physicalRoomPinnedInCreate = true; log('3_postReservation_fallback_overbook_room', { note: 'allowOverbooking=1 + room succeeded' }); return true; }
    }
    // 2d. allowOverbooking=1, room-ID-only — strips type check AND sets override flag.
    if (roomIdForCreate != null && !stopAfterReservationCreate) {
      const r = await runPostReservation({ attachPhysicalRoom: true, roomIdOnly: true, allowOverbooking: true });
      if (r.ok) { reservationData = r.data; physicalRoomPinnedInCreate = true; log('3_postReservation_fallback_overbook_roomid_only', { note: 'allowOverbooking=1 + roomIdOnly succeeded' }); return true; }
    }
    // 2e. allowOverbooking=1, type-only — last room-specific attempt before unassigned fallback.
    // physicalRoomPinnedInCreate remains false so postRoomAssign will correct the assignment.
    {
      const r = await runPostReservation({ attachPhysicalRoom: false, allowOverbooking: true });
      if (r.ok) { reservationData = r.data; log('3_postReservation_fallback_overbook_type_only', { note: 'allowOverbooking=1 + type-only succeeded' }); return true; }
    }

    // 2f. Past check-in dates (admin backdate): retry with the requested stay window +
    // allowOverbooking=1. Never substitute server UTC "today" — staff chose checkInDate.
    if (isPastCheckInDate && !stopAfterReservationCreate) {
      const dateOvr = { startDate: checkInDate, endDate: checkOutDate };
      if (roomIdForCreate != null) {
        const r = await runPostReservation({
          attachPhysicalRoom: true,
          roomIdOnly: true,
          allowOverbooking: true,
          dateOverride: dateOvr,
        });
        if (r.ok) {
          reservationData = r.data;
          physicalRoomPinnedInCreate = true;
          log('3_postReservation_fallback_past_date_roomid', { note: 'Past date + roomIdOnly + overbook', dateOvr });
          return true;
        }
        const rRoom = await runPostReservation({
          attachPhysicalRoom: true,
          allowOverbooking: true,
          dateOverride: dateOvr,
        });
        if (rRoom.ok) {
          reservationData = rRoom.data;
          physicalRoomPinnedInCreate = true;
          log('3_postReservation_fallback_past_date_room', { note: 'Past date + room + overbook', dateOvr });
          return true;
        }
      }
      const r2 = await runPostReservation({
        attachPhysicalRoom: false,
        allowOverbooking: true,
        dateOverride: dateOvr,
      });
      if (r2.ok) {
        reservationData = r2.data;
        // physicalRoomPinnedInCreate remains false — type-only fallback
        log('3_postReservation_fallback_past_date_type_only', { note: 'Past date + type-only + overbook', dateOvr });
        return true;
      }
    }

    return false;
  };

  /**
   * Absolute last resort: create a reservation with no physical room attached —
   * purely an unassigned booking. Used when every room-specific and type-specific
   * attempt has failed (e.g. the selected room is occupied and inventory is exhausted
   * for the room type). Iterates all available room types to maximize success chance.
   * Staff can assign the room in Cloudbeds once the prior guest departs.
   */
  const attemptUnassignedReservationLastResort = async (): Promise<boolean> => {
    if (stopAfterReservationCreate) return false;

    // Build candidate room type IDs to try: start with the selected room's type,
    // then fall back to all other room types in the property. This ensures we always
    // create a reservation even when the specific room type has no inventory.
    const candidateTypeIDs: string[] = [];
    const seenLastResort = new Set<string>();
    const pushLastResort = (val: unknown) => {
      if (val == null) return;
      const s = String(val).trim();
      if (!s || seenLastResort.has(s)) return;
      seenLastResort.add(s);
      candidateTypeIDs.push(s);
    };
    pushLastResort(roomTypeIDStr);
    // Add other room types from the full property room list, skipping premium/incompatible types
    // that should never be used as a vehicle for overbooking reservations (e.g. Deluxe Double Queen, King).
    try {
      const allRoomsForFallback = await fetchAllRoomsPagesMerged(apiV13, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY);
      for (const r of allRoomsForFallback) {
        const tname = String(r?.roomTypeName ?? r?.roomType ?? '').trim();
        if (!isExcludedOverbookingFallbackType(tname)) {
          pushLastResort(r?.roomTypeID ?? r?.roomType_id);
        }
      }
    } catch { /* ignore — candidateTypeIDs already has the primary type */ }

    const guestEmail = email != null && String(email).trim() !== ''
      ? String(email).trim()
      : buildGuestSyntheticEmail(guestFirstName, guestLastName);

    for (const typeID of candidateTypeIDs) {
      try {
        // Resolve the correct rate for this specific room type so Cloudbeds accepts the request.
        // Using the original room's rate ID for a different room type causes Cloudbeds to reject
        // the request with an invalid-rate error rather than an availability error.
        let rateIDForType: string | null = null;
        if (wantTye) {
          const { tyeRate: tyeForType } = findTyeRateForRoomType(stayRatesForFallback, typeID);
          rateIDForType = tyeForType
            ? String(tyeForType.rateID ?? tyeForType.rate_id ?? tyeForType.id ?? tyeForType.ratePlanID ?? 227753)
            : '227753';
        } else if (typeID === roomTypeIDStr && roomRateIDStr) {
          // For the original room type, use the already-resolved rate.
          rateIDForType = roomRateIDStr;
        }

        const unassignedParams = new URLSearchParams();
        unassignedParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
        unassignedParams.append('startDate', checkInDate);
        unassignedParams.append('endDate', checkOutDate);
        unassignedParams.append('guestFirstName', guestFirstName);
        unassignedParams.append('guestLastName', guestLastName);
        unassignedParams.append('guestCountry', 'US');
        unassignedParams.append('guestZip', '00000');
        unassignedParams.append('guestEmail', guestEmail);
        unassignedParams.append('guestPhone', phoneNumber || '000-000-0000');
        unassignedParams.append('paymentMethod', 'CLC');
        unassignedParams.append('rooms[0][roomTypeID]', typeID);
        unassignedParams.append('rooms[0][quantity]', '1');
        if (rateIDForType) unassignedParams.append('rooms[0][roomRateID]', rateIDForType);
        unassignedParams.append('adults[0][roomTypeID]', typeID);
        unassignedParams.append('adults[0][quantity]', '1');
        unassignedParams.append('children[0][roomTypeID]', typeID);
        unassignedParams.append('children[0][quantity]', '0');
        unassignedParams.append('sourceID', 's-945658-1');
        unassignedParams.append('allowOverbooking', '1');

        log('3_postReservation_unassigned_last_resort_request', {
          note: 'Creating unassigned reservation with allowOverbooking=1 (inventory/overbook override)',
          roomTypeID: typeID,
          startDate: checkInDate,
          endDate: checkOutDate,
        });

        const resp = await fetch(`${apiV13}/postReservation`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: unassignedParams.toString(),
        });
        const text = await resp.text();
        let parsed: any = {};
        try { parsed = JSON.parse(text); } catch { parsed = { success: false, message: text }; }
        log('3_postReservation_unassigned_last_resort_response', { status: resp.status, roomTypeID: typeID, body: parsed });

        if (resp.ok && parsed.success === true) {
          reservationData = parsed;
          confirmedPayOnly = true;
          log('3_postReservation_unassigned_last_resort_succeeded', {
            note: 'Unassigned reservation created — room was occupied; staff must assign when available',
            roomTypeID: typeID,
          });
          return true;
        }
      } catch (e: any) {
        log('3_postReservation_unassigned_last_resort_error', { roomTypeID: typeID }, undefined, e?.message);
      }
    }
    return false;
  };

  /**
   * Nuclear overbooking override: create the reservation with allowOverbooking=1 (room-specific
   * first, then type-only across all room types), then immediately convert it to unassigned status
   * by calling putReservation(confirmed) → postRoomAssign(newRoomID='').
   *
   * Cloudbeds does not expose an "unassigned" flag on postReservation — the only supported way to
   * land a reservation in unassigned state is to first confirm it and then strip the room assignment
   * via postRoomAssign with an empty newRoomID.  This is the same two-step sequence used by the
   * /api/unassign-room endpoint.
   *
   * Sets confirmedPayOnly=true on success so the caller settles the folio and returns confirmed.
   */
  const attemptCreateThenUnassign = async (): Promise<boolean> => {
    if (stopAfterReservationCreate) return false;

    log('3_create_then_unassign_start', {
      note: 'All postReservation attempts failed — trying create+allowOverbooking then force-unassign',
    });

    // Ordered list of postReservation shapes to try: most-specific first.
    const shapesToTry: PostReservationOpts[] = [];
    if (roomIdForCreate != null) {
      shapesToTry.push({ attachPhysicalRoom: true, allowOverbooking: true });
      shapesToTry.push({ attachPhysicalRoom: true, roomIdOnly: true, allowOverbooking: true });
    }
    shapesToTry.push({ attachPhysicalRoom: false, allowOverbooking: true });

    let createdReservationData: any = null;

    // Try each shape with the selected room's type first.
    for (const shape of shapesToTry) {
      const r = await runPostReservation(shape);
      if (r.ok) {
        createdReservationData = r.data;
        log('3_create_then_unassign_postReservation_ok', {
          note: 'postReservation succeeded with allowOverbooking=1 for create+unassign path',
          shape,
        });
        break;
      }
    }

    // If the selected room type failed, iterate all other room types (type-only + allowOverbooking).
    if (!createdReservationData) {
      const guestEmail =
        email != null && String(email).trim() !== ''
          ? String(email).trim()
          : buildGuestSyntheticEmail(guestFirstName, guestLastName);

      let stayRatesForCreate: any[] = [];
      try {
        stayRatesForCreate = await fetchCloudbedsRatePlansRows(
          CLOUDBEDS_API_URL,
          CLOUDBEDS_PROPERTY_ID,
          CLOUDBEDS_API_KEY,
          checkInDate,
          checkOutDate
        );
      } catch { /* non-fatal */ }

      const candidateTypeIDs: string[] = [];
      const seenCreate = new Set<string>();
      const pushCreate = (val: unknown) => {
        if (val == null) return;
        const s = String(val).trim();
        if (!s || seenCreate.has(s) || s === roomTypeIDStr) return;
        seenCreate.add(s);
        candidateTypeIDs.push(s);
      };
      try {
        const allRoomsForCreate = await fetchAllRoomsPagesMerged(
          apiV13, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY
        );
        for (const r of allRoomsForCreate) {
          const tname = String(r?.roomTypeName ?? r?.roomType ?? '').trim();
          if (!isExcludedOverbookingFallbackType(tname)) {
            pushCreate(r?.roomTypeID ?? r?.roomType_id);
          }
        }
      } catch { /* ignore */ }

      for (const typeID of candidateTypeIDs) {
        let rateIDForType: string | null = null;
        if (wantTye) {
          const { tyeRate } = findTyeRateForRoomType(stayRatesForCreate, typeID);
          rateIDForType = tyeRate
            ? String(tyeRate.rateID ?? tyeRate.rate_id ?? tyeRate.id ?? tyeRate.ratePlanID ?? 227753)
            : '227753';
        }

        const p = new URLSearchParams();
        p.append('propertyID', CLOUDBEDS_PROPERTY_ID);
        p.append('startDate', checkInDate);
        p.append('endDate', checkOutDate);
        p.append('guestFirstName', guestFirstName);
        p.append('guestLastName', guestLastName);
        p.append('guestCountry', 'US');
        p.append('guestZip', '00000');
        p.append('guestEmail', guestEmail);
        p.append('guestPhone', phoneNumber || '000-000-0000');
        p.append('paymentMethod', 'CLC');
        p.append('rooms[0][roomTypeID]', typeID);
        p.append('rooms[0][quantity]', '1');
        if (rateIDForType) p.append('rooms[0][roomRateID]', rateIDForType);
        p.append('adults[0][roomTypeID]', typeID);
        p.append('adults[0][quantity]', '1');
        p.append('children[0][roomTypeID]', typeID);
        p.append('children[0][quantity]', '0');
        p.append('sourceID', 's-945658-1');
        p.append('allowOverbooking', '1');

        log('3_create_then_unassign_alt_type_request', { typeID, startDate: checkInDate, endDate: checkOutDate });
        try {
          const resp = await fetch(`${apiV13}/postReservation`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: p.toString(),
          });
          const text = await resp.text();
          let parsed: any = {};
          try { parsed = JSON.parse(text); } catch { parsed = { success: false, message: text }; }
          log('3_create_then_unassign_alt_type_response', { status: resp.status, typeID, body: parsed });
          if (resp.ok && parsed.success === true) {
            createdReservationData = parsed;
            log('3_create_then_unassign_alt_type_ok', { typeID });
            break;
          }
        } catch (e: any) {
          log('3_create_then_unassign_alt_type_error', { typeID }, undefined, e?.message);
        }
      }
    }

    if (!createdReservationData) {
      log('3_create_then_unassign_failed', { note: 'Could not create reservation even with allowOverbooking=1 across all room types' });
      return false;
    }

    const createdResID = String(
      createdReservationData.data?.reservationID ?? createdReservationData.reservationID ?? ''
    ).trim();
    if (!createdResID) {
      log('3_create_then_unassign_no_id', { note: 'postReservation succeeded but no reservationID in response' });
      return false;
    }

    // Step A: putReservation → confirmed (required before unassign per Cloudbeds API).
    log('3_create_then_unassign_confirm_request', { reservationID: createdResID });
    const confirmParams = new URLSearchParams();
    confirmParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    confirmParams.append('reservationID', createdResID);
    confirmParams.append('status', 'confirmed');
    const confirmResp = await fetch(`${apiV13}/putReservation`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: confirmParams.toString(),
    });
    const confirmText = await confirmResp.text();
    let confirmData: any = {};
    try { confirmData = JSON.parse(confirmText); } catch { confirmData = {}; }
    log('3_create_then_unassign_confirm_response', {
      status: confirmResp.status,
      ok: confirmResp.ok && confirmData.success === true,
      body: confirmData,
    });
    // Non-fatal — proceed to unassign regardless.

    // Step B: Resolve reservationRoomID for the postRoomAssign unassign call.
    // After postReservation, the room line ID may appear in unassigned[] or guestList.
    let reservationRoomIDForUnassign: string | null = extractReservationRoomLineId(createdReservationData);
    let subReservationIDForUnassign: string | null =
      createdReservationData.unassigned?.[0]?.subReservationID
      ?? createdReservationData.data?.subReservationID
      ?? null;

    // Fetch getReservation to get the definitive room line ID.
    try {
      const grUrl = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(createdResID)}&includeAllRooms=true`;
      log('3_create_then_unassign_getReservation_request', { url: grUrl });
      const grResp = await fetch(grUrl, {
        headers: { Authorization: `Bearer ${CLOUDBEDS_API_KEY}`, 'Content-Type': 'application/json' },
      });
      const grText = await grResp.text();
      let grParsed: any = null;
      try { grParsed = JSON.parse(grText); } catch { grParsed = null; }
      log('3_create_then_unassign_getReservation_response', { status: grResp.status, body: grParsed ?? grText });

      if (grResp.ok && grParsed?.success) {
        reservationRoomIDForUnassign = extractReservationRoomLineId(grParsed) ?? reservationRoomIDForUnassign;
        // Resolve subReservationID from assigned or unassigned rooms.
        const resData = grParsed.data ?? grParsed;
        if (!subReservationIDForUnassign) {
          const assigned = resData?.assigned;
          if (Array.isArray(assigned) && assigned[0]?.subReservationID) {
            subReservationIDForUnassign = String(assigned[0].subReservationID);
          } else if (Array.isArray(resData?.rooms) && resData.rooms[0]?.subReservationID) {
            subReservationIDForUnassign = String(resData.rooms[0].subReservationID);
          }
        }
      }
    } catch (e: any) {
      log('3_create_then_unassign_getReservation_error', undefined, undefined, e?.message);
    }

    // Step C: postRoomAssign with newRoomID='' to unassign the physical room.
    // Per Cloudbeds API: "newRoomID: Empty field must be sent if you want to unassign a room."
    // "reservationRoomID: Must be set if you want to unassign a room."
    if (reservationRoomIDForUnassign) {
      const unassignParams = new URLSearchParams();
      unassignParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      unassignParams.append('reservationID', createdResID);
      unassignParams.append('reservationRoomID', reservationRoomIDForUnassign);
      unassignParams.append('newRoomID', '');
      if (subReservationIDForUnassign && subReservationIDForUnassign !== createdResID) {
        unassignParams.append('subReservationID', subReservationIDForUnassign);
      }
      log('3_create_then_unassign_postRoomAssign_request', {
        reservationID: createdResID,
        reservationRoomID: reservationRoomIDForUnassign,
        subReservationID: subReservationIDForUnassign,
      });
      const unassignResp = await fetch(`${apiV13}/postRoomAssign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: unassignParams.toString(),
      });
      const unassignText = await unassignResp.text();
      let unassignData: any = {};
      try { unassignData = JSON.parse(unassignText); } catch { unassignData = {}; }
      log('3_create_then_unassign_postRoomAssign_response', {
        status: unassignResp.status,
        ok: unassignResp.ok && unassignData.success === true,
        body: unassignData,
      });
      // Non-fatal — the reservation exists regardless of whether unassign succeeded.
    } else {
      log('3_create_then_unassign_no_room_line_id', {
        note: 'Could not resolve reservationRoomID — reservation may already be unassigned or room-line missing',
      });
    }

    // Expose the created reservation through the shared reservationData variable so the
    // caller (confirmedPayOnly branch) can read reservationID / guestID.
    reservationData = createdReservationData;
    confirmedPayOnly = true;
    log('3_create_then_unassign_succeeded', {
      reservationID: createdResID,
      note: 'Reservation created with allowOverbooking=1 and converted to unassigned/confirmed — staff must assign room when available',
    });
    return true;
  };

  /**
   * After postReservation fails: reuse an existing booking, or escalate through room fallbacks
   * and unassigned + allowOverbooking. For inventory/overbook errors, try unassigned first.
   * Final nuclear option: create with allowOverbooking=1 then force-unassign via putReservation+postRoomAssign.
   */
  const escalateAfterFailedPostReservation = async (failedData: any): Promise<boolean> => {
    if (isOverbookingError(failedData)) {
      log('3_escalate_inventory_block', {
        note: 'Cloudbeds inventory/overbook rejection — unassigned + allowOverbooking first',
        message: failedData?.message,
      });
      if (await attemptUnassignedReservationLastResort()) return true;
      if (await attemptRoomSpecificFallbacks(failedData)) return true;
      return attemptCreateThenUnassign();
    }
    if (await attemptRoomSpecificFallbacks(failedData)) return true;
    if (await attemptUnassignedReservationLastResort()) return true;
    return attemptCreateThenUnassign();
  };

  if (stopAfterReservationCreate && (!canAttachPhysicalRoomToReservation || roomIdForCreate == null)) {
    throw new Error(
      'TYE block requires a bookable physical room ID from Cloudbeds. Unset CLOUDBEDS_SKIP_POST_RESERVATION_ROOM_ID if it is set to 1, or ensure getRooms returns this room for the stay dates.'
    );
  }

  const first = await runPostReservation({
    attachPhysicalRoom: canAttachPhysicalRoomToReservation,
    allowOverbooking: useOverbooking,
  });
  if (first.ok) {
    reservationData = first.data;
    physicalRoomPinnedInCreate = canAttachPhysicalRoomToReservation;
  } else if (canAttachPhysicalRoomToReservation && !stopAfterReservationCreate) {
    log('3_postReservation_first_failed', {
      message: first.data?.message ?? first.text,
    });

    let recoveredPayload: any = null;
    try {
      const candidates = await fetchGuestReservationsForStayWindow(
        apiV13,
        CLOUDBEDS_PROPERTY_ID,
        CLOUDBEDS_API_KEY,
        guestFirstName,
        guestLastName,
        checkInDate,
        checkOutDate,
        log
      );
      const targetRoomForRecovery = String(roomIdForStayPeriod ?? actualRoomID ?? '').trim();
      const recoveredRow = pickMatchingReservationForSameRoomStay(
        candidates,
        guestFirstName,
        guestLastName,
        checkInDate,
        checkOutDate,
        targetRoomForRecovery || null
      );
      if (recoveredRow) {
        const rid = String(recoveredRow.reservationID ?? '').trim();
        if (rid) {
          recoveredPayload = await loadReservationPayloadFromCloudbeds(
            apiV13,
            CLOUDBEDS_PROPERTY_ID,
            CLOUDBEDS_API_KEY,
            rid
          );
        }
      }
    } catch (recoveryErr: any) {
      log('3_recovery_lookup_error', undefined, undefined, recoveryErr?.message);
    }

    if (recoveredPayload?.reservationID || recoveredPayload?.data?.reservationID) {
      reservationData = recoveredPayload;
      log('3_recovered_reservation_after_failed_post', {
        reservationID: recoveredPayload.reservationID ?? recoveredPayload.data?.reservationID,
        note: 'postReservation failed but same guest+stay+room reservation exists — reusing for retry',
      });
    } else if (await escalateAfterFailedPostReservation(first.data)) {
      // The initial booking was rejected — we succeeded via an overbooking/fallback path.
      // The guest's physical room is occupied by another guest, so the reservation must stay
      // in confirmed (unassigned) status. Staff will assign the room in Cloudbeds.
      // Do NOT check the guest in, regardless of physicalRoomPinnedInCreate.
      confirmedPayOnly = true;
      log('3_escalation_confirmed_pay_only', {
        note: 'Initial postReservation failed; escalation succeeded — locking to confirmedPayOnly to prevent check-in of occupied room',
        physicalRoomPinnedInCreate,
      });
    } else {
      const msg = first.data?.message || first.text || 'Failed to create reservation in Cloudbeds';
      throw new Error(typeof msg === 'string' ? msg : 'Reservation creation failed');
    }
  } else {
    // first.ok is false and canAttachPhysicalRoomToReservation is false (no room ID available).
    // TYE placeholders cannot fall back to unassigned — surface error directly.
    // All other paths run the same escalating fallback + unassigned last resort.
    if (stopAfterReservationCreate) {
      const msg = first.data?.message || first.text ||
        'Room ' + JSON.stringify(selectedRoomName ?? roomName) + ' is not available for ' + checkInDate + ' (Cloudbeds could not book that specific room).';
      throw new Error(typeof msg === 'string' ? msg : 'Reservation creation failed');
    }
    if (await escalateAfterFailedPostReservation(first.data)) {
      // Same as above — escalation succeeded after initial failure, stay confirmed.
      confirmedPayOnly = true;
      log('3_escalation_confirmed_pay_only_no_room', {
        note: 'Initial postReservation failed (no room ID path); escalation succeeded — locking to confirmedPayOnly',
        physicalRoomPinnedInCreate,
      });
    } else {
      const msg = first.data?.message || first.text || 'Failed to create reservation in Cloudbeds';
      throw new Error(typeof msg === 'string' ? msg : 'Reservation creation failed');
    }
  }

  const reservationID = reservationData.data?.reservationID || reservationData.reservationID;
  const guestID = reservationData.data?.guestID || reservationData.guestID;
  const subReservationID = reservationData.unassigned?.[0]?.subReservationID || reservationID;
  let hasUnassigned = !!(reservationData.unassigned && reservationData.unassigned.length > 0);
  const assignedRooms = reservationData.assigned || [];
  if (!reservationID) {
    throw new Error('No reservationID returned from Cloudbeds');
  }

  // TYE placeholders: identical postReservation to kiosk, but no payment / assign / check-in.
  if (stopAfterReservationCreate === true) {
    const expectedPhysicalRoomId = String(roomIdForStayPeriod ?? actualRoomID ?? '').trim();
    await verifyPlaceholderReservationRoomOrCancel(
      apiV13,
      CLOUDBEDS_PROPERTY_ID,
      CLOUDBEDS_API_KEY,
      String(reservationID),
      expectedPhysicalRoomId,
      String(selectedRoomName ?? roomName),
      checkInDate,
      log
    );
    return {
      success: true,
      guestID,
      reservationID: String(reservationID),
      roomName: String(selectedRoomName ?? roomName),
      message: 'TYE placeholder reservation created in Cloudbeds',
      roomTypeID: roomTypeID != null ? String(roomTypeID) : undefined,
      roomTypeName: roomTypeName || undefined,
    };
  }

  // Physical room was not bookable for these dates, but an unassigned reservation was created:
  // collect payment and leave status confirmed (no check-in / room assign).
  if (confirmedPayOnly) {
    const postReservationAmountHint = extractPostReservationAmountHint(reservationData);
    await settleReservationFolio(
      apiV13,
      CLOUDBEDS_PROPERTY_ID,
      CLOUDBEDS_API_KEY,
      String(reservationID),
      `${guestFirstName} ${guestLastName}`,
      log,
      {
        amountDueHint: postReservationAmountHint,
        trustStaleInvoiceAfterSuccessfulPayment: true,
        settleState,
      }
    );
    return {
      success: true,
      guestID,
      reservationID: String(reservationID),
      roomName: String(selectedRoomName ?? roomName),
      message:
        'Room not available: reservation created, payment collected, and room set to unassigned. Staff will assign the correct room in Cloudbeds.',
      reservationStatus: 'confirmed',
    };
  }

  // When the reservation was created without an explicit rooms[0][roomID] (type-only fallback),
  // Cloudbeds may have auto-assigned any available room. We do NOT try to correct that assignment
  // here — instead we will settle payment, unassign the room, and return confirmed status so that
  // staff can assign the correct room in Cloudbeds once it is available.
  const needsUnassignAfterTypeOnlyCreate =
    !physicalRoomPinnedInCreate && !confirmedPayOnly;

  log('3a_postReservation_room_status', {
    hasUnassigned,
    unassignedCount: reservationData.unassigned?.length || 0,
    assignedCount: assignedRooms.length,
    physicalRoomPinnedInCreate,
    needsUnassignAfterTypeOnlyCreate,
    needsRoomAssignment: hasUnassigned,
  });

  // postRoomAssign needs the unassigned *line* id (reservationRoomID). postReservation often still lists unassigned[]
  // even after rooms[0][roomID] succeeded — getReservation is the source of truth.
  let reservationRoomLineId: string | null = extractReservationRoomLineId(reservationData);
  if (hasUnassigned) {
    try {
      const grUrl = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(String(reservationID))}`;
      log('3b_getReservation_request', { url: grUrl, method: 'GET' });
      const grResp = await fetch(grUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      const grText = await grResp.text();
      let grParsed: any = null;
      try {
        grParsed = JSON.parse(grText);
      } catch {
        grParsed = null;
      }
      log('3b_getReservation_response', { status: grResp.status, body: grParsed ?? grText });
      if (grResp.ok && grParsed?.success) {
        reservationRoomLineId = extractReservationRoomLineId(grParsed) ?? reservationRoomLineId;
        if (reservationAlreadyHasPhysicalRoom(grParsed)) {
          hasUnassigned = false;
          log('3d_reconciled_room_status', {
            postReservationSaidUnassigned: true,
            getReservationShowsAssignedRoom: true,
            skipPostRoomAssign: true,
          });
        }
      }
    } catch (e: any) {
      log('3b_getReservation_error', undefined, undefined, e?.message);
    }
    log('3c_reservation_room_line_id', { reservationRoomLineId, needsPostRoomAssign: hasUnassigned });
  }

  // Step 4: Clear folio balance using invoice balance (postReservation totals can differ from folio).
  // Properties that require "collect full amount prior to checking in" will reject checked_in until this succeeds.
  const postReservationAmountHint = extractPostReservationAmountHint(reservationData);
  await settleReservationFolio(
    apiV13,
    CLOUDBEDS_PROPERTY_ID,
    CLOUDBEDS_API_KEY,
    String(reservationID),
    `${guestFirstName} ${guestLastName}`,
    log,
    {
      amountDueHint: postReservationAmountHint,
      trustStaleInvoiceAfterSuccessfulPayment: true,
      settleState,
    }
  );

  // Refresh reservation after payment (reservationRoomID may appear; room may show as assigned only now).
  if (hasUnassigned) {
    try {
      const grUrl = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(String(reservationID))}`;
      log('4b_getReservation_after_payment_request', { url: grUrl, method: 'GET' });
      const grResp = await fetch(grUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      const grText = await grResp.text();
      let grParsed: any = null;
      try {
        grParsed = JSON.parse(grText);
      } catch {
        grParsed = null;
      }
      log('4b_getReservation_after_payment_response', { status: grResp.status, body: grParsed ?? grText });
      if (grResp.ok && grParsed?.success) {
        reservationRoomLineId = extractReservationRoomLineId(grParsed) ?? reservationRoomLineId;
        if (reservationAlreadyHasPhysicalRoom(grParsed)) {
          hasUnassigned = false;
          log('4b_reconciled_room_status', { getReservationShowsAssignedRoom: true, skipPostRoomAssign: true });
        }
      }
    } catch (e: any) {
      log('4b_getReservation_after_payment_error', undefined, undefined, e?.message);
    }
  }

  // Step 4c: When the reservation was created via a type-only fallback (the guest's specific room
  // could not be booked), Cloudbeds may have auto-assigned a different room. Per the kiosk policy,
  // we must NOT check this guest into a wrong room. Instead: settle payment, strip whatever room
  // Cloudbeds assigned (postRoomAssign newRoomID=''), leave the reservation as confirmed/unassigned,
  // and return to the kiosk. Staff will assign the correct room in Cloudbeds once available.
  if (needsUnassignAfterTypeOnlyCreate) {
    // Fetch the current reservationRoomID — needed by postRoomAssign to target the specific room line.
    let unassignRoomLineId: string | null = reservationRoomLineId;
    let unassignSubReservationID: string | null = String(subReservationID);
    try {
      const grUrl = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(String(reservationID))}`;
      log('4c_getReservation_for_unassign_request', { url: grUrl });
      const grResp = await fetch(grUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${CLOUDBEDS_API_KEY}`, 'Content-Type': 'application/json' },
      });
      const grText = await grResp.text();
      let grParsed: any = null;
      try { grParsed = JSON.parse(grText); } catch { grParsed = null; }
      log('4c_getReservation_for_unassign_response', { status: grResp.status, body: grParsed ?? grText });
      if (grResp.ok && grParsed?.success) {
        unassignRoomLineId = extractReservationRoomLineId(grParsed) ?? unassignRoomLineId;
        // Also check assigned[] for the room line ID (assigned rooms use a different response shape).
        const d = grParsed.data ?? grParsed;
        if (!unassignRoomLineId && Array.isArray(d?.assigned) && d.assigned[0]?.reservationRoomID) {
          unassignRoomLineId = String(d.assigned[0].reservationRoomID);
        }
        if (!unassignSubReservationID && Array.isArray(d?.assigned) && d.assigned[0]?.subReservationID) {
          unassignSubReservationID = String(d.assigned[0].subReservationID);
        }
      }
    } catch (e: any) {
      log('4c_getReservation_for_unassign_error', undefined, undefined, e?.message);
    }

    // Set reservation to confirmed before unassigning — Cloudbeds requires confirmed status
    // before postRoomAssign with newRoomID='' will accept the unassign request.
    const confirmBeforeUnassignParams = new URLSearchParams();
    confirmBeforeUnassignParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    confirmBeforeUnassignParams.append('reservationID', String(reservationID));
    confirmBeforeUnassignParams.append('status', 'confirmed');
    log('4c_putReservation_confirm_before_unassign_request', { reservationID: String(reservationID) });
    try {
      const confirmResp = await fetch(`${apiV13}/putReservation`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: confirmBeforeUnassignParams.toString(),
      });
      const confirmText = await confirmResp.text();
      let confirmData: any = {};
      try { confirmData = JSON.parse(confirmText); } catch { confirmData = {}; }
      log('4c_putReservation_confirm_before_unassign_response', {
        status: confirmResp.status,
        ok: confirmResp.ok && confirmData.success === true,
        body: confirmData,
      });
    } catch (e: any) {
      log('4c_putReservation_confirm_before_unassign_error', undefined, undefined, e?.message);
      // Non-fatal — proceed with unassign attempt regardless.
    }

    // Unassign: postRoomAssign with newRoomID='' removes the physical room assignment.
    // Per Cloudbeds API docs: "newRoomID: Empty field must be sent if you want to unassign a room."
    // "reservationRoomID: Must be set if you want to unassign a room."
    let unassignOk = false;
    if (unassignRoomLineId) {
      const unassignParams = new URLSearchParams();
      unassignParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      unassignParams.append('reservationID', String(reservationID));
      unassignParams.append('reservationRoomID', unassignRoomLineId);
      unassignParams.append('newRoomID', '');
      if (unassignSubReservationID && unassignSubReservationID !== String(reservationID)) {
        unassignParams.append('subReservationID', unassignSubReservationID);
      }
      log('4c_postRoomAssign_unassign_request', {
        reservationID: String(reservationID),
        reservationRoomID: unassignRoomLineId,
        subReservationID: unassignSubReservationID,
        newRoomID: '',
      });
      try {
        const uResp = await fetch(`${apiV13}/postRoomAssign`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: unassignParams.toString(),
        });
        const uText = await uResp.text();
        let uData: any = {};
        try { uData = JSON.parse(uText); } catch { uData = {}; }
        unassignOk = uResp.ok && uData.success === true;
        log('4c_postRoomAssign_unassign_response', { status: uResp.status, ok: unassignOk, body: uData });
      } catch (e: any) {
        log('4c_postRoomAssign_unassign_error', undefined, undefined, e?.message);
      }
    } else {
      log('4c_postRoomAssign_unassign_skipped', {
        note: 'No reservationRoomID available — reservation may already be unassigned',
      });
      unassignOk = true; // treat as success if there is nothing to unassign
    }

    log('4c_unassign_complete', {
      unassignOk,
      reservationID: String(reservationID),
      note: 'Reservation paid and unassigned — staff must assign the correct room in Cloudbeds',
    });

    return {
      success: true,
      guestID,
      reservationID: String(reservationID),
      roomName: String(selectedRoomName ?? roomName),
      message:
        'Room not available: reservation created, payment collected, and room set to unassigned. Staff will assign the correct room in Cloudbeds.',
      reservationStatus: 'confirmed',
    };
  }

  // Step 5: Assign physical room (postRoomAssign). Prefer reservationRoomID (unassigned line) + newRoomID.
  // postReservation already created the correct room type + dates; putReservation with rooms[] was
  // redundant and triggered Cloudbeds "could not accommodate your request" (availability re-check).
  if (hasUnassigned) {
    const lineSubReservationID = String(subReservationID);
    const roomNameForAssign = selectedRoomName ? String(selectedRoomName).trim() : '';
    const roomIdsToTry = [...new Set([roomIdForStayPeriod, actualRoomID].filter((x) => x != null).map(String))];

    type AssignAttempt = { step: string; params: URLSearchParams };
    const mk = (fields: Record<string, string>): URLSearchParams => {
      const p = new URLSearchParams();
      p.append('propertyID', CLOUDBEDS_PROPERTY_ID);
      for (const [k, v] of Object.entries(fields)) {
        if (v !== '') p.append(k, v);
      }
      return p;
    };

    let assignOk = false;
    let lastAssignMessage = '';

    assignAttempts: for (const internalId of roomIdsToTry) {
      const attempts: AssignAttempt[] = [];

      if (reservationRoomLineId) {
        attempts.push({
          step: `5_postRoomAssign_reservationRoomID_subRes_internal_${internalId}`,
          params: mk({
            reservationID: String(reservationID),
            reservationRoomID: reservationRoomLineId,
            subReservationID: lineSubReservationID,
            newRoomID: internalId,
            roomTypeID: String(roomTypeID),
            adjustPrice: 'true',
          }),
        });
        attempts.push({
          step: `5_postRoomAssign_reservationRoomID_subRes_internal_noAdjust_${internalId}`,
          params: mk({
            reservationID: String(reservationID),
            reservationRoomID: reservationRoomLineId,
            subReservationID: lineSubReservationID,
            newRoomID: internalId,
            roomTypeID: String(roomTypeID),
          }),
        });
        attempts.push({
          step: `5_postRoomAssign_reservationRoomID_only_internal_${internalId}`,
          params: mk({
            reservationID: String(reservationID),
            reservationRoomID: reservationRoomLineId,
            newRoomID: internalId,
            roomTypeID: String(roomTypeID),
            adjustPrice: 'true',
          }),
        });
        if (roomNameForAssign && roomNameForAssign !== internalId) {
          attempts.push({
            step: `5_postRoomAssign_reservationRoomID_subRes_roomName_${internalId}`,
            params: mk({
              reservationID: String(reservationID),
              reservationRoomID: reservationRoomLineId,
              subReservationID: lineSubReservationID,
              newRoomID: roomNameForAssign,
              roomTypeID: String(roomTypeID),
            }),
          });
        }
      }

      attempts.push({
        step: `5a_postRoomAssign_subRes_internalID_${internalId}`,
        params: mk({
          reservationID: String(reservationID),
          subReservationID: lineSubReservationID,
          newRoomID: internalId,
          roomTypeID: String(roomTypeID),
        }),
      });
      if (roomNameForAssign && roomNameForAssign !== internalId) {
        attempts.push({
          step: `5b_postRoomAssign_subRes_roomName_${internalId}`,
          params: mk({
            reservationID: String(reservationID),
            subReservationID: lineSubReservationID,
            newRoomID: roomNameForAssign,
            roomTypeID: String(roomTypeID),
          }),
        });
      }
      attempts.push({
        step: `5c_postRoomAssign_resOnly_internalID_${internalId}`,
        params: mk({
          reservationID: String(reservationID),
          newRoomID: internalId,
          roomTypeID: String(roomTypeID),
        }),
      });
      if (roomNameForAssign && roomNameForAssign !== internalId) {
        attempts.push({
          step: `5d_postRoomAssign_resOnly_roomName_${internalId}`,
          params: mk({
            reservationID: String(reservationID),
            newRoomID: roomNameForAssign,
            roomTypeID: String(roomTypeID),
          }),
        });
      }

      for (const { step, params } of attempts) {
        const bodyObj = Object.fromEntries(params.entries());
        log(`${step}_request`, { url: `${apiV13}/postRoomAssign`, body: bodyObj });

        const assignResponse = await fetch(`${apiV13}/postRoomAssign`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });
        const assignText = await assignResponse.text();
        let assignResult: any;
        try {
          assignResult = JSON.parse(assignText);
        } catch {
          assignResult = { success: false, message: assignText };
        }
        log(`${step}_response`, { status: assignResponse.status, body: assignResult });

        if (assignResult.success) {
          assignOk = true;
          console.log('[cloudbeds-checkin] Physical room assigned via postRoomAssign', step);
          break assignAttempts;
        }
        lastAssignMessage = assignResult.message || lastAssignMessage;
      }
    }

    if (!assignOk) {
      console.warn('[cloudbeds-checkin] postRoomAssign failed (will still try check-in):', lastAssignMessage);
      log('5_postRoomAssign_failed_continuing', { message: lastAssignMessage });
    }
  }

  // Folio can change after room assignment; settle again before checked_in (balance rule).
  // Do not pass postReservation amount hint here — would risk double-posting the same total if folio still reads $0 briefly.
  await settleReservationFolio(
    apiV13,
    CLOUDBEDS_PROPERTY_ID,
    CLOUDBEDS_API_KEY,
    String(reservationID),
    `${guestFirstName} ${guestLastName}`,
    log,
    { trustStaleInvoiceAfterSuccessfulPayment: true, settleState }
  );

  const roomIdForCheckIn = String(roomIdForStayPeriod ?? actualRoomID);

  const putReservationCheckedIn = async (): Promise<{ ok: boolean; data: any; status: number }> => {
    const checkInParams = new URLSearchParams();
    checkInParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    checkInParams.append('reservationID', String(reservationID));
    checkInParams.append('status', 'checked_in');
    const checkInResponse = await fetch(`${apiV13}/putReservation`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: checkInParams.toString(),
    });
    const checkInText = await checkInResponse.text();
    let checkInData: any;
    try {
      checkInData = JSON.parse(checkInText);
    } catch {
      checkInData = {};
    }
    return {
      ok: checkInResponse.ok && checkInData.success === true,
      data: checkInData,
      status: checkInResponse.status,
    };
  };

  const postRoomCheckInWith = async (variant: { subReservationID?: string; roomID?: string }) => {
    const roomCheckInParams = new URLSearchParams();
    roomCheckInParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
    roomCheckInParams.append('reservationID', String(reservationID));
    if (variant.subReservationID) roomCheckInParams.append('subReservationID', variant.subReservationID);
    if (variant.roomID) roomCheckInParams.append('roomID', variant.roomID);
    const rcResp = await fetch(`${apiV13}/postRoomCheckIn`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: roomCheckInParams.toString(),
    });
    const rcText = await rcResp.text();
    let rcData: any;
    try {
      rcData = JSON.parse(rcText);
    } catch {
      rcData = {};
    }
    return { ok: rcResp.ok && rcData.success === true, data: rcData, status: rcResp.status };
  };

  // Step 6: Set reservation status to checked_in. If Cloudbeds rejects (e.g. guest not checked in at room),
  // postRoomCheckIn then retry putReservation.
  let checkInResult = await putReservationCheckedIn();
  log('6_putReservation_checkin_response', { status: checkInResult.status, body: checkInResult.data });

  if (!checkInResult.ok) {
    const subRes = String(subReservationID);
    const roomCheckInVariants = [
      { subReservationID: subRes, roomID: roomIdForCheckIn },
      { subReservationID: subRes },
      { roomID: roomIdForCheckIn },
    ];
    for (const v of roomCheckInVariants) {
      const rc = await postRoomCheckInWith(v);
      log('6b_postRoomCheckIn_retry', { variant: v, status: rc.status, body: rc.data });
      if (rc.ok) {
        checkInResult = await putReservationCheckedIn();
        log('6_putReservation_checkin_after_postRoomCheckIn', { status: checkInResult.status, body: checkInResult.data });
        if (checkInResult.ok) break;
      }
    }
  }

  if (!checkInResult.ok) {
    // The reservation was already created and paid — throwing here would make the kiosk
    // think the entire check-in failed and potentially retry, but the guest DOES have a
    // reservation. Return confirmed status so the record is saved in Firestore with the
    // reservationID; staff can manually set status to checked_in in Cloudbeds if needed.
    log('6_putReservation_checkin_failed_returning_confirmed', {
      note: 'Reservation created and paid but putReservation checked_in failed — returning confirmed status to preserve reservation',
      reservationID: String(reservationID),
      message: checkInResult.data?.message,
    });
    console.warn(
      '[cloudbeds-checkin] putReservation checked_in failed but reservation exists — returning confirmed to preserve it:',
      { reservationID: String(reservationID), message: checkInResult.data?.message }
    );

    // Best-effort postRoomCheckIn before giving up on checked_in
    try {
      await postRoomCheckInWith({ subReservationID: String(subReservationID), roomID: roomIdForCheckIn });
    } catch (_) {
      // ignore
    }

    return {
      success: true,
      guestID,
      reservationID: String(reservationID),
      roomName,
      message: 'Reservation created and paid. Check-in status could not be updated automatically — staff should set status to Checked In in Cloudbeds.',
      reservationStatus: 'confirmed',
    };
  }

  // Step 7: postRoomCheckIn (best effort) — room-level check-in if not already completed
  try {
    await postRoomCheckInWith({ subReservationID: String(subReservationID), roomID: roomIdForCheckIn });
  } catch (_) {
    // ignore
  }

  return {
    success: true,
    guestID,
    reservationID: String(reservationID),
    roomName,
    message: 'Guest successfully checked in to Cloudbeds',
    reservationStatus: 'checked_in',
  };
}

/**
 * Cancel a Cloudbeds reservation (e.g. when the local TYE placeholder could not be saved after
 * postReservation succeeded). Uses the same API base URL resolution as performCloudbedsCheckIn.
 */
export async function cancelTyeBlockReservationInCloudbeds(reservationID: string): Promise<boolean> {
  const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
  const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
  const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
  const baseUrl = (CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2').replace(/\/v1\.\d+\/?$/, '');
  const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;
  if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) return false;
  return cancelCloudbedsReservation(apiV13, CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY, reservationID);
}
