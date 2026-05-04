import { NextResponse } from 'next/server';
import { probeFirestoreHealth, type FirestoreHealth } from '@/lib/checkin-store';

/**
 * GET /api/admin/firebase-status
 *
 * Returns whether the server-side Firebase Admin SDK / Firestore is properly
 * configured and can read `kiosk_checkin_records`. Probes an actual Firestore
 * query so invalid PEM keys and permission errors surface here.
 *
 * Result is cached for 10 minutes — there is no need to probe Firestore on
 * every page load / tab switch. Cache is intentionally long for healthy
 * connections; shorter for errors so transient failures self-heal quickly.
 */

interface ProbeCache {
  result: FirestoreHealth;
  expiresAt: number;
}
let probeCache: ProbeCache | null = null;

export async function GET() {
  const now = Date.now();
  if (probeCache && now < probeCache.expiresAt) {
    const { result } = probeCache;
    return NextResponse.json(result, {
      status: result.connected ? 200 : 503,
      headers: { 'Cache-Control': 'private, max-age=600' },
    });
  }

  const status = await probeFirestoreHealth();
  // Cache healthy status for 10 min; errors for 2 min so issues self-heal.
  const ttl = status.connected ? 10 * 60_000 : 2 * 60_000;
  probeCache = { result: status, expiresAt: now + ttl };

  return NextResponse.json(status, {
    status: status.connected ? 200 : 503,
    headers: { 'Cache-Control': 'private, max-age=600' },
  });
}
