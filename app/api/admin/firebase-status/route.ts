import { NextResponse } from 'next/server';
import { probeFirestoreHealth } from '@/lib/checkin-store';

/**
 * GET /api/admin/firebase-status
 *
 * Returns whether the server-side Firebase Admin SDK / Firestore is properly
 * configured and can read `kiosk_checkin_records`. Probes an actual Firestore
 * query so invalid PEM keys and permission errors surface here.
 */
export async function GET() {
  const status = await probeFirestoreHealth();
  return NextResponse.json(status, { status: status.connected ? 200 : 503 });
}
