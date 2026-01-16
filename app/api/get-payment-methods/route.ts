import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const CLOUDBEDS_API_KEY = process.env.CLOUDBEDS_API_KEY;
    const CLOUDBEDS_PROPERTY_ID = process.env.CLOUDBEDS_PROPERTY_ID;
    const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.3';

    if (!CLOUDBEDS_API_KEY || !CLOUDBEDS_PROPERTY_ID) {
      return NextResponse.json({
        success: false,
        error: 'Cloudbeds API credentials not configured',
      }, { status: 500 });
    }

    const results: any = {
      propertyID: CLOUDBEDS_PROPERTY_ID,
      apiVersion: 'v1.3',
      attempts: [],
    };

    // Try different possible endpoints for payment methods
    const endpoints = [
      '/getPaymentMethods',
      '/getPaymentTypes',
      '/getPaymentOptions',
      '/getSettings?type=payment',
    ];

    for (const endpoint of endpoints) {
      try {
        const url = `${CLOUDBEDS_API_URL}${endpoint}?propertyID=${CLOUDBEDS_PROPERTY_ID}`;
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
          endpoint,
          url,
          status: response.status,
          success: response.ok,
          response: parsed || text,
        });

        // If we got a successful response with data, return it
        if (response.ok && parsed) {
          return NextResponse.json({
            success: true,
            endpoint,
            paymentMethods: parsed.data || parsed.paymentMethods || parsed,
            rawResponse: parsed,
          });
        }
      } catch (error: any) {
        results.attempts.push({
          endpoint,
          error: error.message,
        });
      }
    }

    // If none worked, return all attempts for debugging
    return NextResponse.json({
      success: false,
      message: 'Could not find payment methods endpoint. Tried multiple endpoints.',
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
