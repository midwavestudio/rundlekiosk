import { NextRequest, NextResponse } from 'next/server';
import { saveEventLog, getRecentEventLogs, type EventLogEntry } from '@/lib/event-log-store';
import { saveFeedback, getAllFeedback, updateFeedback, deleteFeedback, setFeedbackReadState } from '@/lib/feedback-store';

// ─── Event log cache ─────────────────────────────────────────────────────────
interface EventCache { events: EventLogEntry[]; limit: number; expiresAt: number; }
let eventCache: EventCache | null = null;
const EVENT_CACHE_TTL_MS = 5 * 60_000;
function bustEventCache() { eventCache = null; }

// ─── Feedback cache ──────────────────────────────────────────────────────────
let feedbackCache: any[] | null = null;
let feedbackCacheExpiresAt = 0;
const FEEDBACK_CACHE_TTL_MS = 15_000;
function bustFeedbackCache() { feedbackCache = null; feedbackCacheExpiresAt = 0; }

const ALLOWED_SOURCES = new Set([
  'api:cloudbeds-checkin',
  'api:cloudbeds-checkout',
  'kiosk:check-in',
  'kiosk:check-in-rooms',
  'kiosk:check-out',
]);

// ─── GET — event log or feedback list ────────────────────────────────────────
// GET /api/event-log?limit=250         → event log
// GET /api/event-log?type=feedback     → all feedback messages

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');

  if (type === 'feedback') {
    try {
      const now = Date.now();
      if (feedbackCache && now < feedbackCacheExpiresAt) {
        return NextResponse.json({ messages: feedbackCache }, { headers: { 'Cache-Control': 'private, no-store' } });
      }
      const messages = await getAllFeedback();
      feedbackCache = messages;
      feedbackCacheExpiresAt = now + FEEDBACK_CACHE_TTL_MS;
      return NextResponse.json({ messages }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (err) {
      return NextResponse.json({ error: 'Failed to retrieve feedback.' }, { status: 500 });
    }
  }

  try {
    const limit = Number(searchParams.get('limit') ?? '200') || 200;
    const now = Date.now();
    if (eventCache && eventCache.limit >= limit && now < eventCache.expiresAt) {
      return NextResponse.json({ events: eventCache.events.slice(0, limit) }, { headers: { 'Cache-Control': 'private, max-age=300' } });
    }
    const events = await getRecentEventLogs(limit);
    eventCache = { events, limit, expiresAt: now + EVENT_CACHE_TTL_MS };
    return NextResponse.json({ events }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to load events.' }, { status: 500 });
  }
}

// ─── POST — log event or submit feedback ─────────────────────────────────────
// POST /api/event-log                  → log an event
// POST /api/event-log?type=feedback    → submit guest feedback

export async function POST(req: NextRequest) {
  const type = new URL(req.url).searchParams.get('type');

  if (type === 'feedback') {
    try {
      const body = await req.json();
      const message = (body.message ?? '').toString().trim();
      const name = (body.name ?? '').toString().trim();
      if (!message || message.length < 2) return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
      if (message.length > 1000) return NextResponse.json({ error: 'Message is too long (max 1000 characters).' }, { status: 400 });
      const id = await saveFeedback({ message, name: name || undefined, submittedAt: new Date().toISOString(), status: 'new' });
      bustFeedbackCache();
      return NextResponse.json({ id }, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: 'Failed to save feedback.' }, { status: 500 });
    }
  }

  try {
    const body = await req.json();
    const source = (body.source ?? '').toString().trim();
    const message = (body.message ?? '').toString().trim();
    const levelRaw = (body.level ?? 'error').toString().toLowerCase();
    const level = levelRaw === 'warn' || levelRaw === 'info' ? levelRaw : 'error';
    if (!source || !ALLOWED_SOURCES.has(source)) return NextResponse.json({ error: 'Invalid or missing source.' }, { status: 400 });
    if (!message || message.length < 2) return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    const id = await saveEventLog({ level, source, message: message.slice(0, 4000), detail: body.detail });
    bustEventCache();
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to save event.' }, { status: 500 });
  }
}

// ─── PATCH — update feedback ─────────────────────────────────────────────────
// PATCH /api/event-log?type=feedback   → update feedback status/notes/read state
// Body: { id, status?, notes?, read? } or { ids: string[], read: boolean }

export async function PATCH(req: NextRequest) {
  const type = new URL(req.url).searchParams.get('type');
  if (type !== 'feedback') return NextResponse.json({ error: 'Use ?type=feedback for PATCH.' }, { status: 400 });
  try {
    const body = await req.json();
    const { id, ids, status, notes, read } = body;

    if (typeof read === 'boolean') {
      const targetIds: string[] = Array.isArray(ids)
        ? ids.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
        : typeof id === 'string' && id.length > 0
          ? [id]
          : [];
      if (targetIds.length === 0) {
        return NextResponse.json({ error: 'id or ids is required when updating read state.' }, { status: 400 });
      }
      await setFeedbackReadState(targetIds, read);
      bustFeedbackCache();
      return NextResponse.json({ ok: true });
    }

    if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    await updateFeedback(id, { status, notes });
    bustFeedbackCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to update feedback.' }, { status: 500 });
  }
}

// ─── DELETE — delete feedback ─────────────────────────────────────────────────
// DELETE /api/event-log?type=feedback&id=xxx  → remove feedback

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  if (type !== 'feedback') return NextResponse.json({ error: 'Use ?type=feedback for DELETE.' }, { status: 400 });
  const id = searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'id query parameter is required.' }, { status: 400 });
  try {
    await deleteFeedback(id);
    bustFeedbackCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to delete feedback.' }, { status: 500 });
  }
}
