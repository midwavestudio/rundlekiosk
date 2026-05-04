import { NextResponse } from 'next/server';
import { getCheckinRecords } from '@/lib/checkin-store';

/**
 * GET /api/checkin-records/backup
 *
 * Returns ALL check-in records as a downloadable JSON file.
 * The response sets Content-Disposition so the browser saves it
 * automatically with a timestamped filename.
 *
 * This endpoint is intentionally read-only and does not modify any data.
 * It fetches up to 1000 records (the store cap) from Firestore in a single
 * call so even a full history download stays within Spark plan quotas.
 *
 * Usage: GET /api/checkin-records/backup
 */
export async function GET() {
  try {
    // Fetch the maximum allowed set — no date filter means most-recent-first
    const records = await getCheckinRecords({ limit: 1000 });

    const now = new Date();
    // Local-safe filename: 2026-05-04T17-30-00
    const stamp = now
      .toISOString()
      .replace(/\.\d{3}Z$/, '')
      .replace(/:/g, '-');
    const filename = `checkin-records-backup-${stamp}.json`;

    const payload = JSON.stringify(
      {
        exportedAt: now.toISOString(),
        count: records.length,
        records,
      },
      null,
      2
    );

    return new NextResponse(payload, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('[checkin-records/backup GET]', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Server error' },
      { status: 500 }
    );
  }
}
