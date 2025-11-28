const CloudbedsClient = require('../lib/cloudbeds');
const { corsMiddleware, authMiddleware } = require('../lib/middleware');

/**
 * Get Reservations Endpoint
 * Fetches reservations from Cloudbeds with optional filters
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

      const {
        status,
        checkInFrom,
        checkInTo,
        checkOutFrom,
        checkOutTo,
        guestName,
        reservationId,
      } = req.query;

      // Initialize Cloudbeds client
      const cloudbeds = new CloudbedsClient();

      // Build filters
      const filters = {};
      if (status) filters.status = status;
      if (checkInFrom) filters.checkInFrom = checkInFrom;
      if (checkInTo) filters.checkInTo = checkInTo;
      if (checkOutFrom) filters.checkOutFrom = checkOutFrom;
      if (checkOutTo) filters.checkOutTo = checkOutTo;
      if (guestName) filters.guestName = guestName;
      if (reservationId) filters.reservationID = reservationId;

      // Get reservations
      const result = await cloudbeds.getReservations(filters);

      return res.status(200).json({
        success: true,
        data: result.data || [],
        count: result.data?.length || 0,
      });
    } catch (error) {
      console.error('Get reservations error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch reservations',
        error: error.message,
      });
    }
  });
}

module.exports = handler;

