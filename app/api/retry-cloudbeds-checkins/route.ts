import { NextRequest, NextResponse } from 'next/server';
import { performCloudbedsCheckIn } from '@/lib/cloudbeds-checkin';
import { saveEventLog } from '@/lib/event-log-store';
import {
  getPendingCheckins,
  markPendingCheckinComplete,
  markPendingCheckinFailed,
  incrementPendingCheckinAttempt,
  PendingCheckin,
} from '@/lib/pending-checkin-store';
import { updateCheckinRecord } from '@/lib/checkin-store';

export const maxDuration = 300;

// Security: require a secret token so only Vercel cron (or admins) can trigger retries.
const CRON_SECRET = process.env.CRON_SECRET;

const MAX_ATTEMPTS = 5;

/**
 * Retry all pending/failed Cloudbeds check-ins from the last 4 hours.
 * Called automatically by Vercel Cron every 5 minutes.
 * Can also be triggered manually by admins (GET or POST with Authorization header).
 */
export async function GET(request: NextRequest) {
  return handleRetry(request);
}

export async function POST(request: NextRequest) {
  return handleRetry(request);
}

async function handleRetry(request: NextRequest): Promise<NextResponse> {
  // Verify cron secret — Vercel Cron passes it as Authorization: Bearer <secret>
  if (CRON_SECRET) {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (token !== CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const startedAt = Date.now();
  const results: Array<{
    id: string;
    guest: string;
    room: string;
    status: 'succeeded' | 'failed' | 'skipped';
    message: string;
    reservationID?: string;
  }> = [];

  let pending: PendingCheckin[] = [];
  try {
    pending = await getPendingCheckins({ maxAge: 4 * 60 * 60 * 1000 });
  } catch (err: any) {
    console.error('[retry-cloudbeds-checkins] Failed to fetch pending check-ins:', err?.message);
    return NextResponse.json({ error: 'Failed to fetch pending check-ins', details: err?.message }, { status: 500 });
  }

  console.log(`[retry-cloudbeds-checkins] Found ${pending.length} pending check-ins to retry.`);

  for (const item of pending) {
    const guest = `${item.checkInParams.firstName ?? ''} ${item.checkInParams.lastName ?? ''}`.trim();
    const room = item.checkInParams.roomName ?? 'unknown';

    // Skip items that have already been retried too many times
    if (item.attempts >= MAX_ATTEMPTS) {
      results.push({
        id: item.id,
        guest,
        room,
        status: 'skipped',
        message: `Max retry attempts (${MAX_ATTEMPTS}) reached`,
      });
      continue;
    }

    // Skip items that are already "processing" from a concurrent run (recent timestamp check)
    if (
      item.status === 'processing' &&
      item.lastAttemptAt &&
      Date.now() - new Date(item.lastAttemptAt).getTime() < 90_000 // 90s lock
    ) {
      results.push({
        id: item.id,
        guest,
        room,
        status: 'skipped',
        message: 'Currently processing by another worker',
      });
      continue;
    }

    try {
      await incrementPendingCheckinAttempt(item.id).catch(() => {});

      const debugLog: Array<{ step: string; request?: unknown; response?: unknown; error?: string }> = [];
      const result = await performCloudbedsCheckIn({
        ...item.checkInParams,
        debugLog,
      });

      // Success — mark complete and patch the kiosk record
      await markPendingCheckinComplete(item.id, result.reservationID, result.guestID).catch(() => {});

      if (item.checkinRecordId && result.reservationID) {
        try {
          await updateCheckinRecord(item.checkinRecordId, {
            cloudbedsReservationID: result.reservationID,
            cloudbedsGuestID: result.guestID,
            ...(result.reservationStatus ? { reservationStatus: result.reservationStatus } as any : {}),
          });
        } catch (patchErr: any) {
          console.error(
            `[retry-cloudbeds-checkins] Failed to patch kiosk record ${item.checkinRecordId}:`,
            patchErr?.message
          );
          void saveEventLog({
            level: 'error',
            source: 'api:retry-cloudbeds-checkins',
            message: `Retry succeeded but failed to patch kiosk record ${item.checkinRecordId}: ${patchErr?.message}`,
            detail: { pendingId: item.id, checkinRecordId: item.checkinRecordId, reservationID: result.reservationID },
          }).catch(() => {});
        }
      }

      void saveEventLog({
        level: 'info',
        source: 'api:retry-cloudbeds-checkins',
        message: `Retry succeeded for ${guest} (room ${room}) — reservation ${result.reservationID}`,
        detail: { pendingId: item.id, reservationID: result.reservationID, attempt: (item.attempts ?? 0) + 1 },
      }).catch(() => {});

      results.push({
        id: item.id,
        guest,
        room,
        status: 'succeeded',
        message: result.message,
        reservationID: result.reservationID,
      });
    } catch (err: any) {
      const errMsg = err?.message ?? 'Unknown error';
      const newAttempts = (item.attempts ?? 0) + 1;
      const finalFail = newAttempts >= MAX_ATTEMPTS;

      if (finalFail) {
        await markPendingCheckinFailed(item.id, errMsg, newAttempts).catch(() => {});
        void saveEventLog({
          level: 'error',
          source: 'api:retry-cloudbeds-checkins',
          message: `Retry PERMANENTLY FAILED for ${guest} (room ${room}) after ${newAttempts} attempts: ${errMsg}`,
          detail: {
            pendingId: item.id,
            checkinRecordId: item.checkinRecordId,
            checkInParams: item.checkInParams,
            attempts: newAttempts,
          },
        }).catch(() => {});
      } else {
        void saveEventLog({
          level: 'error',
          source: 'api:retry-cloudbeds-checkins',
          message: `Retry attempt ${newAttempts}/${MAX_ATTEMPTS} failed for ${guest} (room ${room}): ${errMsg}`,
          detail: { pendingId: item.id, attempts: newAttempts },
        }).catch(() => {});
      }

      console.error(
        `[retry-cloudbeds-checkins] Retry failed for ${guest} (attempt ${newAttempts}):`,
        errMsg
      );

      results.push({
        id: item.id,
        guest,
        room,
        status: 'failed',
        message: errMsg,
      });
    }
  }

  const summary = {
    total: pending.length,
    succeeded: results.filter((r) => r.status === 'succeeded').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    elapsedMs: Date.now() - startedAt,
    results,
  };

  console.log('[retry-cloudbeds-checkins] Run complete:', {
    total: summary.total,
    succeeded: summary.succeeded,
    failed: summary.failed,
    skipped: summary.skipped,
  });

  return NextResponse.json(summary);
}
