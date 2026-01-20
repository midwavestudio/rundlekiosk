import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.2';

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json({
        success: false,
        error: 'Cloudbeds API credentials not configured',
      }, { status: 500 });
    }

    const results: any = {
      propertyID: CLOUDBEDS_PROPERTY_ID,
      apiVersion: CLOUDBEDS_API_URL,
      attempts: [],
    };

    // Get today's date for rate plan lookup
    const today = new Date().toISOString().split('T')[0];

    // Try different possible endpoints for rates
    const endpoints = [
      { path: '/getRatePlans', params: `propertyID=${CLOUDBEDS_PROPERTY_ID}&startDate=${today}` },
      { path: '/getRates', params: `propertyID=${CLOUDBEDS_PROPERTY_ID}&startDate=${today}` },
      { path: '/getRoomRates', params: `propertyID=${CLOUDBEDS_PROPERTY_ID}&startDate=${today}` },
      { path: '/getPropertyRates', params: `propertyID=${CLOUDBEDS_PROPERTY_ID}&startDate=${today}` },
    ];

    for (const endpoint of endpoints) {
      try {
        const url = `${CLOUDBEDS_API_URL}${endpoint.path}?${endpoint.params}`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${CLOUDBEDS_API_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        const text = await response.text();
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {}

        results.attempts.push({
          endpoint: endpoint.path,
          url,
          status: response.status,
          success: response.ok,
          response: parsed || text,
        });

        if (response.ok && parsed) {
          return NextResponse.json({
            success: true,
            endpoint: endpoint.path,
            rates: parsed.data || parsed.rates || parsed,
            rawResponse: parsed,
          });
        }
      } catch (error: any) {
        results.attempts.push({
          endpoint: endpoint.path,
          error: error.message,
        });
      }
    }

    return NextResponse.json({
      success: false,
      message: 'Could not find rates endpoint. Tried multiple endpoints.',
      attempts: results.attempts,
      note: 'You may need to check Cloudbeds API documentation for the correct endpoint.',
    });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
}
