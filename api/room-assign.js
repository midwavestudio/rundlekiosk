const CloudbedsClient = require('../lib/cloudbeds');
const { corsMiddleware, authMiddleware } = require('../lib/middleware');
const { logTransaction, updateTransaction } = require('../lib/firebase');

/**
 * Room Assignment Endpoint
 * Assigns a room to a reservation in Cloudbeds
 */
async function handler(req, res) {
  // Apply CORS
  corsMiddleware(req, res, async () => {
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'POST') {
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

      const { reservationId, roomId } = req.body;

      // Validate required fields
      if (!reservationId || !roomId) {
        return res.status(400).json({
          success: false,
          message: 'reservationId and roomId are required',
        });
      }

      // Initialize Cloudbeds client
      const cloudbeds = new CloudbedsClient();

      // Log transaction
      const transactionId = await logTransaction({
        type: 'room-assignment',
        reservationId,
        roomId,
        userId: req.user.uid,
        userEmail: req.user.email,
        status: 'initiated',
      });

      try {
        // Assign room
        const result = await cloudbeds.assignRoom(reservationId, roomId);

        // Update transaction
        await updateTransaction(transactionId, {
          status: 'completed',
          result: result,
          completedAt: new Date().toISOString(),
        });

        return res.status(200).json({
          success: true,
          message: 'Room assigned successfully',
          transactionId,
          data: result,
        });
      } catch (error) {
        // Update transaction with error
        await updateTransaction(transactionId, {
          status: 'failed',
          error: error.message,
        });

        throw error;
      }
    } catch (error) {
      console.error('Room assignment error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to assign room',
        error: error.message,
      });
    }
  });
}

module.exports = handler;

