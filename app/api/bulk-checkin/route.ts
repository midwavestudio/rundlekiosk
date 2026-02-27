import { NextRequest, NextResponse } from 'next/server';
import { performCloudbedsCheckIn } from '@/lib/cloudbeds-checkin';

interface GuestRow {
  name: string;
  phoneNumber: string;
  roomNumber: string;
  clcNumber: string;
  classType: string;
  signInTime: string;
}

interface CheckInResult {
  guest: string;
  room: string;
  status: 'success' | 'skipped' | 'error';
  message: string;
  reservationID?: string;
}

function parseName(fullName: string) {
  const name = (fullName || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Guest', lastName: 'Guest' };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function getLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getExistingReservations(propertyID: string, apiKey: string, apiUrl: string, checkInDate: string) {
  try {
    const url = `${apiUrl}/getReservations?propertyID=${propertyID}&checkInFrom=${checkInDate}&checkInTo=${checkInDate}&status=checked_in,confirmed`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching existing reservations:', error);
    return [];
  }
}

function isDuplicate(guest: GuestRow, existingReservations: any[], checkInDate: string): boolean {
  const { firstName, lastName } = parseName(guest.name);
  const guestFullName = `${firstName} ${lastName}`.toLowerCase().trim();
  
  return existingReservations.some((res: any) => {
    const existingName = `${res.guestFirstName || ''} ${res.guestLastName || ''}`.toLowerCase().trim();
    const resCheckIn = res.startDate || res.checkInDate || '';
    const sameDate = resCheckIn.startsWith(checkInDate);
    return existingName === guestFullName && sameDate;
  });
}

async function checkInGuest(guest: GuestRow, checkInDate: string, checkOutDate: string, skipDuplicates: boolean, existingReservations: any[]): Promise<CheckInResult> {
  const { firstName, lastName } = parseName(guest.name);

  if (skipDuplicates && isDuplicate(guest, existingReservations, checkInDate)) {
    return {
      guest: guest.name,
      room: guest.roomNumber,
      status: 'skipped',
      message: 'Duplicate - already checked in for this date',
    };
  }

  try {
    const result = await performCloudbedsCheckIn({
      firstName,
      lastName,
      phoneNumber: guest.phoneNumber,
      roomName: guest.roomNumber,
      clcNumber: guest.clcNumber,
      classType: guest.classType || 'TYE',
      checkInDate,
      checkOutDate,
    });
    return {
      guest: guest.name,
      room: guest.roomNumber,
      status: 'success',
      message: result.message,
      reservationID: result.reservationID,
    };
  } catch (error: any) {
    return {
      guest: guest.name,
      room: guest.roomNumber,
      status: 'error',
      message: error?.message || 'Check-in failed',
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { guests, checkInDate: bodyCheckInDate, skipDuplicates = true } = body;
    
    if (!guests || !Array.isArray(guests) || guests.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No guests provided' },
        { status: 400 }
      );
    }
    
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';
    
    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json(
        { success: false, error: 'Cloudbeds not configured' },
        { status: 500 }
      );
    }
    
    // Determine check-in date (from body or today)
    const now = new Date();
    const checkInDate = (bodyCheckInDate && /^\d{4}-\d{2}-\d{2}$/.test(String(bodyCheckInDate)))
      ? String(bodyCheckInDate)
      : getLocalDateStr(now);
    const checkOutDate = getLocalDateStr(new Date(new Date(checkInDate).getTime() + 24 * 60 * 60 * 1000));
    
    // Fetch existing reservations for duplicate detection
    const existingReservations = skipDuplicates
      ? await getExistingReservations(CLOUDBEDS_PROPERTY_ID, CLOUDBEDS_API_KEY, CLOUDBEDS_API_URL, checkInDate)
      : [];
    
    console.log(`Bulk check-in: ${guests.length} guests for ${checkInDate}, existing: ${existingReservations.length}`);
    
    // Process guests sequentially to avoid rate limits
    const results: CheckInResult[] = [];
    for (const guest of guests) {
      const result = await checkInGuest(guest, checkInDate, checkOutDate, skipDuplicates, existingReservations);
      results.push(result);
      
      // Small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const summary = {
      total: results.length,
      success: results.filter(r => r.status === 'success').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      failed: results.filter(r => r.status === 'error').length,
    };
    
    return NextResponse.json({
      success: true,
      summary,
      results,
      checkInDate,
      checkOutDate,
    });
    
  } catch (error: any) {
    console.error('Bulk check-in error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Bulk check-in failed' },
      { status: 500 }
    );
  }
}
