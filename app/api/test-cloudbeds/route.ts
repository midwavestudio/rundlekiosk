import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
  const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
  const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.3';

  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const results: any = {
    config: {
      hasApiKey: !!CLOUDBEDS_API_KEY,
      hasPropertyId: !!CLOUDBEDS_PROPERTY_ID,
      propertyId: CLOUDBEDS_PROPERTY_ID,
      apiUrl: CLOUDBEDS_API_URL,
      dates: { today, tomorrow },
    },
    tests: [],
  };

  // Test 1: getRoomsUnassigned
  try {
    const url = `${CLOUDBEDS_API_URL}/getRoomsUnassigned?propertyID=${CLOUDBEDS_PROPERTY_ID}&checkIn=${today}&checkOut=${tomorrow}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const text = await response.text();
    results.tests.push({
      endpoint: 'getRoomsUnassigned',
      status: response.status,
      url: url,
      response: text,
      parsed: (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })(),
    });
  } catch (error: any) {
    results.tests.push({
      endpoint: 'getRoomsUnassigned',
      error: error.message,
    });
  }

  // Test 2: getRooms
  try {
    const url = `${CLOUDBEDS_API_URL}/getRooms?propertyID=${CLOUDBEDS_PROPERTY_ID}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const text = await response.text();
    results.tests.push({
      endpoint: 'getRooms',
      status: response.status,
      url: url,
      response: text,
      parsed: (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })(),
    });
  } catch (error: any) {
    results.tests.push({
      endpoint: 'getRooms',
      error: error.message,
    });
  }

  // Test 3: getRoomTypes
  try {
    const url = `${CLOUDBEDS_API_URL}/getRoomTypes?propertyID=${CLOUDBEDS_PROPERTY_ID}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const text = await response.text();
    results.tests.push({
      endpoint: 'getRoomTypes',
      status: response.status,
      url: url,
      response: text,
      parsed: (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })(),
    });
  } catch (error: any) {
    results.tests.push({
      endpoint: 'getRoomTypes',
      error: error.message,
    });
  }

  // Test 4: getReservations
  try {
    const url = `${CLOUDBEDS_API_URL}/getReservations?propertyID=${CLOUDBEDS_PROPERTY_ID}&checkInFrom=${today}&checkInTo=${today}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const text = await response.text();
    results.tests.push({
      endpoint: 'getReservations',
      status: response.status,
      url: url,
      response: text,
      parsed: (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })(),
    });
  } catch (error: any) {
    results.tests.push({
      endpoint: 'getReservations',
      error: error.message,
    });
  }

  return NextResponse.json(results, { status: 200 });
}
