/**
 * Shared Cloudbeds check-in logic. Used by both POST /api/cloudbeds-checkin and bulk-checkin
 * so bulk can call this directly instead of fetching the app (avoids HTML/JSON errors on live).
 */

import { buildGuestSyntheticEmail } from '@/lib/guest-email';

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

  return rooms.find((r: any) => {
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
      nameAlt === roomKey ||
      norm(nameStr) === roomKey ||
      norm(nameAlt) === roomKey ||
      nameStr.endsWith(roomKey) ||
      nameAlt.endsWith(roomKey) ||
      stripTrailingLetter(idStr) === roomKey ||
      stripTrailingLetter(idAlt) === roomKey ||
      stripTrailingLetter(nameStr) === roomKey ||
      stripTrailingLetter(nameAlt) === roomKey ||
      (keyDigits &&
        (digits(idStr) === keyDigits ||
          digits(idAlt) === keyDigits ||
          digits(nameStr) === keyDigits ||
          digits(nameAlt) === keyDigits))
    );
  });
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

const TYE_RATE_LOOKUP_FAILED_MSG =
  'TYE rate plan was not found for this room type in Cloudbeds.';

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
    debugLog,
  } = params;

  const guestFirstName = String(firstName).trim().replace(/\s+/g, ' ');
  const guestLastName = String(lastName).trim().replace(/\s+/g, ' ');

  const log = (step: string, request?: unknown, response?: unknown, error?: string) => {
    debugLog?.push({ step, request, response, error });
  };

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
  try {
    const stayRates = await fetchCloudbedsRatePlansRows(
      CLOUDBEDS_API_URL,
      CLOUDBEDS_PROPERTY_ID,
      CLOUDBEDS_API_KEY,
      checkInDate,
      checkOutDate
    );
    let { allRatesForRoomType, tyeRate } = findTyeRateForRoomType(stayRates, roomTypeID);

    if (!tyeRate && wantTye) {
      const anchorStart = getLocalDateStr(new Date());
      const anchorEnd = addOneCalendarDayYmd(anchorStart);
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
      }
    }

    if (tyeRate) {
      rateID = tyeRate.rateID ?? tyeRate.rate_id ?? tyeRate.id;
      ratePlanID = tyeRate.ratePlanID ?? tyeRate.rate_plan_id ?? tyeRate.ratePlan_id ?? 227753;
    } else if (wantTye) {
      throw new Error(TYE_RATE_LOOKUP_FAILED_MSG);
    } else if (allRatesForRoomType.length > 0) {
      const available = allRatesForRoomType.filter(
        (rate: any) => (rate.roomsAvailable == null || rate.roomsAvailable > 0) && !rate.roomBlocked
      );
      const fallback = available[0] ?? allRatesForRoomType[0];
      rateID = fallback.rateID ?? fallback.rate_id ?? fallback.id;
      ratePlanID = fallback.ratePlanID ?? fallback.rate_plan_id ?? fallback.ratePlan_id;
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === TYE_RATE_LOOKUP_FAILED_MSG) {
      throw e;
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
  }

  const buildReservationParams = (opts: PostReservationOpts): URLSearchParams => {
    const { attachPhysicalRoom, dateOverride, roomIdOnly } = opts;
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

  if (stopAfterReservationCreate && (!canAttachPhysicalRoomToReservation || roomIdForCreate == null)) {
    throw new Error(
      'TYE block requires a bookable physical room ID from Cloudbeds. Unset CLOUDBEDS_SKIP_POST_RESERVATION_ROOM_ID if it is set to 1, or ensure getRooms returns this room for the stay dates.'
    );
  }

  const first = await runPostReservation({ attachPhysicalRoom: canAttachPhysicalRoomToReservation });
  if (first.ok) {
    reservationData = first.data;
  } else if (canAttachPhysicalRoomToReservation && !stopAfterReservationCreate) {
    // Walk-in / kiosk: if the specific room cannot be booked, fall back to room-type-only reservation.
    // TYE blocks (stopAfterReservationCreate): never do this — it creates a booking on the wrong room or unassigned.
    const second = await runPostReservation({ attachPhysicalRoom: false });
    if (!second.ok) {
      const today = getLocalDateStr(new Date());

      if (checkInDate < today) {
        // Third attempt: Cloudbeds often returns "cannot accommodate" for past dates when the room
        // type's inventory for that night is exhausted. Retry the type-only reservation using
        // today's dates so at least a confirmed booking is created.
        const todayOut = addOneCalendarDayYmd(today);
        const third = await runPostReservation({ attachPhysicalRoom: false, dateOverride: { startDate: today, endDate: todayOut } });
        if (third.ok) {
          reservationData = third.data;
          confirmedPayOnly = true;
          log('3_postReservation_fallback_today_dates', {
            note: `Back-dated check-in (${checkInDate}) rejected by Cloudbeds; created confirmed reservation for today (${today})`,
            originalCheckInDate: checkInDate,
            fallbackStartDate: today,
            fallbackEndDate: todayOut,
          });
        } else {
          const msg =
            third.data?.message ||
            second.data?.message ||
            first.data?.message ||
            first.text ||
            'Failed to create reservation in Cloudbeds';
          throw new Error(typeof msg === 'string' ? msg : 'Reservation creation failed');
        }
      } else if (roomIdForCreate != null) {
        // Fourth attempt (same-day, room was previously unassigned): send only rooms[0][roomID]
        // without rooms[0][roomTypeID]. Prior same-day checkouts can exhaust the room TYPE's
        // inventory counter even though the physical room is free — omitting the type lets
        // Cloudbeds infer it from the room ID and bypass the type-level inventory check.
        const fourth = await runPostReservation({ attachPhysicalRoom: true, roomIdOnly: true });
        if (fourth.ok) {
          reservationData = fourth.data;
          confirmedPayOnly = true;
          log('3_postReservation_fallback_room_id_only', {
            note: 'Type-level inventory exhausted by prior same-day reservation; created confirmed reservation using room ID only',
            roomID: String(roomIdForCreate),
          });
        } else {
          const msg =
            fourth.data?.message ||
            second.data?.message ||
            first.data?.message ||
            first.text ||
            'Failed to create reservation in Cloudbeds';
          throw new Error(typeof msg === 'string' ? msg : 'Reservation creation failed');
        }
      } else {
        const msg =
          second.data?.message ||
          first.data?.message ||
          first.text ||
          'Failed to create reservation in Cloudbeds';
        throw new Error(typeof msg === 'string' ? msg : 'Reservation creation failed');
      }
    } else {
      reservationData = second.data;
      confirmedPayOnly = true;
      log('3_postReservation_fallback_no_physical_room', {
        note: 'Physical room was not available for postReservation; created unassigned reservation for payment as confirmed',
      });
    }
  } else {
    const msg =
      first.data?.message ||
      first.text ||
      (stopAfterReservationCreate
        ? `Room "${selectedRoomName ?? roomName}" is not available for ${checkInDate} (Cloudbeds could not book that specific room).`
        : 'Failed to create reservation in Cloudbeds');
    throw new Error(typeof msg === 'string' ? msg : 'Reservation creation failed');
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

  // Physical room was not bookable for these dates, but an unassigned reservation was created: collect payment and leave status confirmed (no check-in / room assign).
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
      }
    );
    return {
      success: true,
      guestID,
      reservationID: String(reservationID),
      roomName: String(selectedRoomName ?? roomName),
      message:
        'Reservation is confirmed and paid. The selected room is not available to check into yet; staff can assign it in Cloudbeds when the prior guest departs.',
      reservationStatus: 'confirmed',
    };
  }

  log('3a_postReservation_room_status', {
    hasUnassigned,
    unassignedCount: reservationData.unassigned?.length || 0,
    assignedCount: assignedRooms.length,
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
    { trustStaleInvoiceAfterSuccessfulPayment: true }
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
    throw new Error(checkInResult.data?.message || 'Check-in failed');
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
