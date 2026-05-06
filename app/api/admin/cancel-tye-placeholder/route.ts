import { NextRequest, NextResponse } from 'next/server';
import {
  getPlaceholderByReservationID,
  updatePlaceholder,
} from '@/lib/tye-placeholder-store';
import { cancelTyeBlockReservationInCloudbeds } from '@/lib/cloudbeds-checkin';

/**
 * POST /api/admin/cancel-tye-placeholder
 *
 * Cancels a TYE block reservation in Cloudbeds and marks the local placeholder row as cancelled.
 * Body:
 *   reservationID: string
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const reservationID = String(body?.reservationID ?? '').trim();
    if (!reservationID) {
      return NextResponse.json(
        { success: false, error: 'reservationID is required' },
        { status: 400 }
      );
    }

    const placeholder = await getPlaceholderByReservationID(reservationID);
    if (!placeholder) {
      return NextResponse.json(
        {
          success: false,
          error: 'Placeholder reservation was not found in the app store.',
        },
        { status: 404 }
      );
    }

    if (placeholder.status === 'assigned') {
      return NextResponse.json(
        {
          success: false,
          error: 'This block is already assigned to a guest and cannot be cancelled from this tab.',
        },
        { status: 409 }
      );
    }

    const cancelledInCloudbeds = await cancelTyeBlockReservationInCloudbeds(reservationID);
    if (!cancelledInCloudbeds) {
      const cloudbedsState = await getCloudbedsReservationState(reservationID);
      // If Cloudbeds says this reservation is already gone/cancelled, it is safe to
      // clear the local active block even though the direct cancel call failed.
      if (cloudbedsState !== 'cancelled') {
        return NextResponse.json(
          {
            success: false,
            error:
              'Cloudbeds cancellation failed. The block was not changed locally to avoid a mismatch.',
          },
          { status: 502 }
        );
      }
    }

    await updatePlaceholder(placeholder.id, {
      status: 'cancelled',
      cloudbedsStatus: 'cancelled',
      lastSyncedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      reservationID,
      message: 'Block cancelled in Cloudbeds and updated locally.',
    });
  } catch (error: unknown) {
    console.error('cancel-tye-placeholder error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

type ReservationState = 'active' | 'cancelled' | 'unknown';

async function getCloudbedsReservationState(reservationID: string): Promise<ReservationState> {
  const apiKey = process.env.CLOUDBEDS_API_KEY;
  const propertyID = process.env.CLOUDBEDS_PROPERTY_ID;
  const apiUrl = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
  if (!apiKey || !propertyID) return 'unknown';

  const baseUrl = apiUrl.replace(/\/v1\.\d+\/?$/, '');
  const apiV13 = `${baseUrl.replace(/\/$/, '')}/v1.3`;
  const url = `${apiV13}/getReservation?propertyID=${encodeURIComponent(propertyID)}&reservationID=${encodeURIComponent(
    reservationID
  )}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    // Not found / gone in Cloudbeds should be treated as cancelled for local cleanup.
    if (!res.ok) return 'cancelled';
    const parsed = await res.json();
    if (!parsed?.success) return 'cancelled';

    const d = parsed.data ?? parsed;
    const status = String(d?.status ?? d?.reservationStatus ?? '').toLowerCase();
    if (status === 'cancelled' || status === 'canceled' || status === 'no_show') {
      return 'cancelled';
    }
    return 'active';
  } catch {
    return 'unknown';
  }
}
