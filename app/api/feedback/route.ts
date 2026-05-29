import { NextRequest, NextResponse } from 'next/server';
import { saveFeedback, getAllFeedback, updateFeedback, deleteFeedback, type FeedbackMessage } from '@/lib/feedback-store';

// ---------------------------------------------------------------------------
// Server-side read cache — reduces Firestore reads when the admin dashboard
// polls this endpoint. Cache is busted on any write (POST / PATCH / DELETE).
// ---------------------------------------------------------------------------
let cachedMessages: FeedbackMessage[] | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes — aligns with 15-min badge poll

function bustCache() {
  cachedMessages = null;
  cacheExpiresAt = 0;
}

/** POST /api/feedback — guest submits a message */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = (body.message ?? '').toString().trim();
    const name = (body.name ?? '').toString().trim();

    if (!message || message.length < 2) {
      return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    }
    if (message.length > 1000) {
      return NextResponse.json({ error: 'Message is too long (max 1000 characters).' }, { status: 400 });
    }

    const id = await saveFeedback({
      message,
      name: name || undefined,
      submittedAt: new Date().toISOString(),
      status: 'new',
    });

    bustCache();
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('[feedback] POST error:', err);
    return NextResponse.json({ error: 'Failed to save feedback.' }, { status: 500 });
  }
}

/** GET /api/feedback — admin retrieves all messages */
export async function GET() {
  try {
    const now = Date.now();
    if (cachedMessages && now < cacheExpiresAt) {
      return NextResponse.json(
        { messages: cachedMessages },
        { headers: { 'Cache-Control': 'private, max-age=300' } }
      );
    }

    const messages = await getAllFeedback();
    cachedMessages = messages;
    cacheExpiresAt = now + CACHE_TTL_MS;

    return NextResponse.json(
      { messages },
      { headers: { 'Cache-Control': 'private, max-age=300' } }
    );
  } catch (err) {
    console.error('[feedback] GET error:', err);
    return NextResponse.json({ error: 'Failed to retrieve feedback.' }, { status: 500 });
  }
}

/** PATCH /api/feedback — admin updates status/notes on a message */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status, notes } = body;
    if (!id) {
      return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    }
    await updateFeedback(id, { status, notes });
    bustCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[feedback] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update feedback.' }, { status: 500 });
  }
}

/** DELETE /api/feedback — admin removes a message */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id') ?? '';
    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required.' }, { status: 400 });
    }
    await deleteFeedback(id);
    bustCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[feedback] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete feedback.' }, { status: 500 });
  }
}
