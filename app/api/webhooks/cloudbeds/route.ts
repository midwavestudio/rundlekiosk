import { NextRequest, NextResponse } from 'next/server';
import {
  getPlaceholderByReservationID,
  updatePlaceholder,
  type PlaceholderStatus,
} from '@/lib/tye-placeholder-store';

/**
 * POST /api/webhooks/cloudbeds
 *
 * Receives Cloudbeds webhook events for reservation changes and updates
 * our TYE placeholder store accordingly.
 *
 * To register this webhook in Cloudbeds:
 *   1. Go to your Cloudbeds property settings → Webhooks / Integrations.
 *   2. Add a new webhook pointing to: https://your-domain/api/webhooks/cloudbeds
 *   3. Subscribe to events: reservation.updated, reservation.cancelled, reservation.modified
 *   4. Optionally set a secret token and configure CLOUDBEDS_WEBHOOK_SECRET below.
 *
 * Cloudbeds sends a POST with JSON body containing the event type and reservation data.
 * We look up the reservationID in our placeholder store; if found, we update its status.
 *
 * Environment variable (optional):
 *   CLOUDBEDS_WEBHOOK_SECRET   – if set, validate the X-Cloudbeds-Signature header
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Optional signature validation
    const secret = process.env.CLOUDBEDS_WEBHOOK_SECRET;
    if (secret) {
      const signature = request.headers.get('x-cloudbeds-signature') ?? '';
      const valid = await validateWebhookSignature(rawBody, signature, secret);
      if (!valid) {
        console.warn('Cloudbeds webhook: invalid signature — rejecting');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const eventType: string = String(
      event.event ?? event.type ?? event.action ?? ''
    ).toLowerCase();

    // Extract the reservation ID — Cloudbeds uses several field names across event types.
    const reservationID: string = String(
      event.reservationID ??
        event.reservation_id ??
        event.data?.reservationID ??
        event.data?.reservation_id ??
        event.payload?.reservationID ??
        ''
    );

    if (!reservationID) {
      // Not a reservation event — acknowledge and ignore.
      return NextResponse.json({ received: true });
    }

    console.log(`Cloudbeds webhook: eventType=${eventType} reservationID=${reservationID}`);

    const placeholder = await getPlaceholderByReservationID(reservationID);
    if (!placeholder) {
      // Not one of our placeholders — nothing to do.
      return NextResponse.json({ received: true, relevant: false });
    }

    // Map Cloudbeds status/event to our placeholder status.
    const cbStatus: string = String(
      event.data?.status ??
        event.data?.reservationStatus ??
        event.status ??
        event.reservationStatus ??
        ''
    ).toLowerCase();

    const guestFirst: string = String(
      event.data?.guestFirstName ?? event.data?.guest?.firstName ?? ''
    );

    let newStatus: PlaceholderStatus = placeholder.status;

    if (
      eventType.includes('cancel') ||
      cbStatus === 'cancelled' ||
      cbStatus === 'canceled'
    ) {
      newStatus = 'cancelled';
    } else if (
      cbStatus === 'checked_in' ||
      cbStatus === 'in_house'
    ) {
      // Someone checked in outside our app flow.
      newStatus = placeholder.status === 'available' ? 'externally_modified' : placeholder.status;
    } else if (
      placeholder.status === 'available' &&
      guestFirst !== '' &&
      guestFirst.toLowerCase() !== 'tye'
    ) {
      // Guest name was changed away from dummy — external assignment.
      newStatus = 'externally_modified';
    }

    if (newStatus !== placeholder.status) {
      await updatePlaceholder(placeholder.id, {
        status: newStatus,
        cloudbedsStatus: cbStatus || undefined,
        lastSyncedAt: new Date().toISOString(),
      });
      console.warn(
        `TYE placeholder ${reservationID} (room ${placeholder.roomName}) status changed via webhook: ${placeholder.status} → ${newStatus}`
      );
    }

    return NextResponse.json({ received: true, relevant: true, newStatus });
  } catch (error: any) {
    console.error('Cloudbeds webhook error:', error);
    // Always return 200 to prevent Cloudbeds from retrying indefinitely.
    return NextResponse.json({ received: true, error: error.message }, { status: 200 });
  }
}

/**
 * Validate HMAC-SHA256 signature from Cloudbeds webhook.
 * Cloudbeds signs the raw body with the shared secret and puts the hex digest
 * in X-Cloudbeds-Signature.
 */
async function validateWebhookSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return hex === signature.replace(/^sha256=/, '');
  } catch {
    return false;
  }
}
