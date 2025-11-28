const CloudbedsClient = require('../lib/cloudbeds');
const { corsMiddleware, authMiddleware } = require('../lib/middleware');

/**
 * Get Available Rooms Endpoint
 * Fetches unassigned/available rooms from Cloudbeds
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

      const { checkIn, checkOut } = req.query;

      // Validate required dates
      if (!checkIn || !checkOut) {
        return res.status(400).json({
          success: false,
          message: 'checkIn and checkOut dates are required (YYYY-MM-DD format)',
        });
      }

      // Initialize Cloudbeds client
      const cloudbeds = new CloudbedsClient();

      // Get unassigned rooms
      const rooms = await cloudbeds.getUnassignedRooms(checkIn, checkOut);

      return res.status(200).json({
        success: true,
        data: rooms,
        count: rooms.length,
        checkIn,
        checkOut,
      });
    } catch (error) {
      console.error('Get rooms error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch available rooms',
        error: error.message,
      });
    }
  });
}

module.exports = handler;

