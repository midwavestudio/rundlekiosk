import { NextRequest, NextResponse } from 'next/server';
import {
  getPlaceholdersForDates,
  updatePlaceholder,
  type PlaceholderStatus,
} from '@/lib/tye-placeholder-store';

/**
 * POST /api/admin/sync-tye-placeholders
 *
 * Polls Cloudbeds for the current status of every known placeholder reservation
 * for today, tomorrow, and any extra dates passed as repeated `date` query params.
 * Updates our local store if Cloudbeds shows that the
 * reservation was externally modified (e.g. a staff member changed it directly).
 *
 * This is the "polling" sync mechanism. The webhook route handles real-time updates.
 *
 * Returns a diff of what changed.
 */
export async function POST(request: NextRequest) {
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
    const baseUrl = CLOUDBEDS_API_URL.replace(/\/v1\.\d+\/?$/, '');
    const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json(
        { success: false, error: 'Cloudbeds API credentials not configured' },
        { status: 503 }
      );
    }

    const headers = {
      Authorization: `Bearer ${CLOUDBEDS_API_KEY}`,
      'Content-Type': 'application/json',
    };

    const placeholders = await getPlaceholdersForDates(
      mergePlaceholderQueryDates(request)
    );

    if (placeholders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No placeholders to sync',
        changes: [],
      });
    }

    const changes: Array<{
      placeholderID: string;
      reservationID: string;
      roomName: string;
      previousStatus: PlaceholderStatus;
      newStatus: PlaceholderStatus;
      cloudbedsStatus: string;
    }> = [];

    const syncedAt = new Date().toISOString();

    for (const placeholder of placeholders) {
      // Cancelled rows are terminal — nothing to sync.
      if (placeholder.status === 'cancelled') {
        continue;
      }

      try {
        const url = `${apiV13}/getReservation?propertyID=${encodeURIComponent(CLOUDBEDS_PROPERTY_ID)}&reservationID=${encodeURIComponent(placeholder.reservationID)}`;
        const res = await fetch(url, { method: 'GET', headers });
        const rawText = await res.text();
        let data: any = {};
        try {
          data = JSON.parse(rawText);
        } catch {
          data = {};
        }

        /** Reservation removed in Cloudbeds (deleted) — 404, empty data, or explicit not-found message. */
        const messageStr = String(data?.message ?? '');
        const notFoundMsg = /not found|does not exist|invalid reservation|no reservation|unable to find|could not find/i.test(
          messageStr
        );
        const reservationGone =
          res.status === 404 ||
          (res.ok && data.success === true && (data.data == null || data.data === '')) ||
          (res.ok && data.success === false && notFoundMsg);

        if (reservationGone) {
          const updates: Record<string, string> = {
            lastSyncedAt: syncedAt,
            cloudbedsStatus: 'gone',
            status: 'cancelled',
          };
          await updatePlaceholder(placeholder.id, updates as any);
          changes.push({
            placeholderID: placeholder.id,
            reservationID: placeholder.reservationID,
            roomName: placeholder.roomName,
            previousStatus: placeholder.status,
            newStatus: 'cancelled',
            cloudbedsStatus: 'gone',
          });
          console.warn(
            `TYE placeholder ${placeholder.reservationID} (room ${placeholder.roomName}): reservation no longer in Cloudbeds → cancelled locally`
          );
          continue;
        }

        // Transient HTTP errors — do not flip status.
        if (!res.ok) {
          console.warn(`getReservation HTTP ${res.status} for ${placeholder.reservationID}, skipping sync`);
          continue;
        }

        if (!data.success || !data.data) {
          continue;
        }

        const reservation = data.data;
        const cbStatus: string = String(
          reservation.status ?? reservation.reservationStatus ?? ''
        ).toLowerCase();

        const guestName: string = String(
          reservation.guestName ?? reservation.guest?.guestName ?? ''
        );
        const guestFirst: string = String(
          reservation.guestFirstName ?? reservation.guest?.firstName ?? ''
        );

        // Detect external modification: guest name changed away from our dummy profile,
        // or status changed to something other than "confirmed".
        const isExternallyModified =
          (cbStatus !== 'confirmed' && cbStatus !== '') ||
          (
            guestFirst.toLowerCase() !== 'tye' &&
            guestFirst !== '' &&
            !guestName.toLowerCase().includes('placeholder')
          );

        const isCancelled = cbStatus === 'cancelled' || cbStatus === 'canceled';

        let newStatus: PlaceholderStatus = placeholder.status;
        if (isCancelled) {
          newStatus = 'cancelled';
        } else if (isExternallyModified && placeholder.status === 'available') {
          newStatus = 'externally_modified';
        }

        const updates: Record<string, string> = { lastSyncedAt: syncedAt, cloudbedsStatus: cbStatus };
        if (newStatus !== placeholder.status) {
          updates.status = newStatus;
        }

        await updatePlaceholder(placeholder.id, updates as any);

        if (newStatus !== placeholder.status) {
          changes.push({
            placeholderID: placeholder.id,
            reservationID: placeholder.reservationID,
            roomName: placeholder.roomName,
            previousStatus: placeholder.status,
            newStatus,
            cloudbedsStatus: cbStatus,
          });
          console.warn(
            `TYE placeholder ${placeholder.reservationID} (room ${placeholder.roomName}) status changed: ${placeholder.status} → ${newStatus} (Cloudbeds: ${cbStatus})`
          );
        }
      } catch (err: any) {
        console.error(
          `Error syncing placeholder ${placeholder.reservationID}:`,
          err?.message
        );
      }
    }

    const now = new Date();
    const todayStr = localDateYmd(now);
    const tomorrowStr = localDateYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const refreshed = await getPlaceholdersForDates(mergePlaceholderQueryDates(request));

    return NextResponse.json({
      success: true,
      synced: placeholders.length,
      changes,
      syncedAt,
      today: todayStr,
      tomorrow: tomorrowStr,
      placeholders: refreshed,
      counts: {
        available: refreshed.filter((p) => p.status === 'available').length,
        assigned: refreshed.filter((p) => p.status === 'assigned').length,
        externally_modified: refreshed.filter((p) => p.status === 'externally_modified').length,
        cancelled: refreshed.filter((p) => p.status === 'cancelled').length,
      },
    });
  } catch (error: any) {
    console.error('sync-tye-placeholders error:', error);
    return NextResponse.json(
      { success: false, error: error.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/sync-tye-placeholders
 *
 * Returns placeholder summary without triggering a Cloudbeds sync.
 * Useful for quick admin dashboard reads.
 */
export async function GET(request: NextRequest) {
  try {
    const now = new Date();
    const todayStr = localDateYmd(now);
    const tomorrowStr = localDateYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const placeholders = await getPlaceholdersForDates(
      mergePlaceholderQueryDates(request)
    );

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
    return NextResponse.json(
      { success: false, error: error.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}

function localDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Always includes today + tomorrow; optional `date` query params add more YYYY-MM-DD values. */
function mergePlaceholderQueryDates(request: NextRequest): string[] {
  const now = new Date();
  const todayStr = localDateYmd(now);
  const tomorrowStr = localDateYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const set = new Set<string>([todayStr, tomorrowStr]);
  for (const d of request.nextUrl.searchParams.getAll('date')) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
  }
  return [...set].sort();
}
