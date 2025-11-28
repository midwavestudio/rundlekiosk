const CloudbedsClient = require('../lib/cloudbeds');
const { corsMiddleware, authMiddleware } = require('../lib/middleware');

/**
 * Get Today's Departures Endpoint
 * Fetches today's departing reservations from Cloudbeds
 */
async function handler(req, res) {
  // Apply CORS
  corsMiddleware(req, res, async () => {
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        message: 'Method not allowed',
      });
    }

    try {
      // Apply auth middleware
      await new Promise((resolve, reject) => {
        authMiddleware(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Initialize Cloudbeds client
      const cloudbeds = new CloudbedsClient();

      // Get today's departures
      const departures = await cloudbeds.getTodayDepartures();

      return res.status(200).json({
        success: true,
        data: departures,
        count: departures.length,
        date: new Date().toISOString().split('T')[0],
      });
    } catch (error) {
      console.error('Get departures error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch departures',
        error: error.message,
      });
    }
  });
}

module.exports = handler;

