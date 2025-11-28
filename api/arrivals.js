const CloudbedsClient = require('../lib/cloudbeds');
const { corsMiddleware, authMiddleware } = require('../lib/middleware');

/**
 * Get Today's Arrivals Endpoint
 * Fetches today's arriving reservations from Cloudbeds
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

      // Get today's arrivals
      const arrivals = await cloudbeds.getTodayArrivals();

      return res.status(200).json({
        success: true,
        data: arrivals,
        count: arrivals.length,
        date: new Date().toISOString().split('T')[0],
      });
    } catch (error) {
      console.error('Get arrivals error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch arrivals',
        error: error.message,
      });
    }
  });
}

module.exports = handler;

