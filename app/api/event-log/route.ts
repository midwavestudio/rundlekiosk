import { NextRequest, NextResponse } from 'next/server';
import { saveEventLog, getRecentEventLogs, type EventLogEntry } from '@/lib/event-log-store';

// ---------------------------------------------------------------------------
// Server-side read cache — reduces Firestore reads when the admin dashboard
// polls this endpoint. Cache is busted on any write (POST).
// ---------------------------------------------------------------------------
interface EventCache {
  events: EventLogEntry[];
  limit: number;
  expiresAt: number;
}
let eventCache: EventCache | null = null;
const EVENT_CACHE_TTL_MS = 5 * 60_000; // 5 minutes — aligns with 15-min badge poll

function bustEventCache() {
  eventCache = null;
}

const ALLOWED_SOURCES = new Set([
  'api:cloudbeds-checkin',
  'api:cloudbeds-checkout',
  'kiosk:check-in',
  'kiosk:check-in-rooms',
  'kiosk:check-out',
]);

/** POST /api/event-log — record an event (server routes + optional kiosk client) */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const source = (body.source ?? '').toString().trim();
    const message = (body.message ?? '').toString().trim();
    const levelRaw = (body.level ?? 'error').toString().toLowerCase();
    const level = levelRaw === 'warn' || levelRaw === 'info' ? levelRaw : 'error';

    if (!source || !ALLOWED_SOURCES.has(source)) {
      return NextResponse.json({ error: 'Invalid or missing source.' }, { status: 400 });
    }
    if (!message || message.length < 2) {
      return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    }

    const id = await saveEventLog({
      level,
      source,
      message: message.slice(0, 4000),
      detail: body.detail,
    });

    bustEventCache();
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('[event-log] POST error:', err);
    return NextResponse.json({ error: 'Failed to save event.' }, { status: 500 });
  }
}

/** GET /api/event-log — admin list */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get('limit') ?? '200') || 200;

    const now = Date.now();
    if (eventCache && eventCache.limit >= limit && now < eventCache.expiresAt) {
      return NextResponse.json(
        { events: eventCache.events.slice(0, limit) },
        { headers: { 'Cache-Control': 'private, max-age=300' } }
      );
    }

    const events = await getRecentEventLogs(limit);
    eventCache = { events, limit, expiresAt: now + EVENT_CACHE_TTL_MS };

    return NextResponse.json(
      { events },
      { headers: { 'Cache-Control': 'private, max-age=300' } }
    );
  } catch (err) {
    console.error('[event-log] GET error:', err);
    return NextResponse.json({ error: 'Failed to load events.' }, { status: 500 });
  }
}
