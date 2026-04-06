import { NextRequest, NextResponse } from 'next/server';
import {
  getAvailablePlaceholdersByDate,
  getPlaceholdersByDate,
} from '@/lib/tye-placeholder-store';

function localDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * GET /api/tye-placeholders
 *
 * Returns TYE placeholder reservations for today and optionally tomorrow.
 *
 * Query params:
 *   date=YYYY-MM-DD  – override the date (defaults to today)
 *   all=1            – include non-available placeholders (for admin views)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const showAll = searchParams.get('all') === '1';

    const now = dateParam ? new Date(dateParam + 'T12:00:00') : new Date();
    const today = localDateYmd(now);
    const tomorrow = localDateYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000));

    const fetchFn = showAll ? getPlaceholdersByDate : getAvailablePlaceholdersByDate;

    const [todayList, tomorrowList] = await Promise.all([
      fetchFn(today),
      fetchFn(tomorrow),
    ]);

    return NextResponse.json({
      success: true,
      today,
      tomorrow,
      placeholders: {
        [today]: todayList,
        [tomorrow]: tomorrowList,
      },
      availableToday: todayList.filter((p) => p.status === 'available').length,
      availableTomorrow: tomorrowList.filter((p) => p.status === 'available').length,
    });
  } catch (error: any) {
    console.error('GET /api/tye-placeholders error:', error);
    return NextResponse.json(
      { success: false, error: error.message ?? 'Failed to fetch placeholders' },
      { status: 500 }
    );
  }
}
