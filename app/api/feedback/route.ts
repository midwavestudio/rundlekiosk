import { NextRequest, NextResponse } from 'next/server';
import { saveFeedback, getAllFeedback, updateFeedback } from '@/lib/feedback-store';

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

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('[feedback] POST error:', err);
    return NextResponse.json({ error: 'Failed to save feedback.' }, { status: 500 });
  }
}

/** GET /api/feedback — admin retrieves all messages */
export async function GET() {
  try {
    const messages = await getAllFeedback();
    return NextResponse.json({ messages });
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
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[feedback] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update feedback.' }, { status: 500 });
  }
}
