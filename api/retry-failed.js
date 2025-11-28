const CLCClient = require('../lib/clc');
const { corsMiddleware, authMiddleware } = require('../lib/middleware');
const { getPendingFailedOperations, updateFailedOperation } = require('../lib/firebase');

/**
 * Retry Failed Operations Endpoint
 * Retries failed CLC operations (check-in/check-out)
 * Can be called manually or by scheduled Cloud Function
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
      // Apply auth middleware (or verify cron secret for scheduled calls)
      const cronSecret = req.headers['x-cron-secret'];
      const isScheduledCall = cronSecret === process.env.CRON_SECRET;

      if (!isScheduledCall) {
        await new Promise((resolve, reject) => {
          authMiddleware(req, res, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      // Get pending failed operations
      const failedOps = await getPendingFailedOperations();

      if (failedOps.length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No pending failed operations',
          processed: 0,
        });
      }

      // Initialize CLC client
      const clc = new CLCClient();

      const results = {
        total: failedOps.length,
        succeeded: 0,
        failed: 0,
        maxRetriesReached: 0,
        details: [],
      };

      // Process each failed operation
      for (const op of failedOps) {
        try {
          let result;

          if (op.type === 'clc-checkin') {
            result = await clc.checkIn(op.data);
          } else if (op.type === 'clc-checkout') {
            result = await clc.checkOut(op.data);
          }

          // Success - mark as completed
          await updateFailedOperation(op.id, {
            status: 'completed',
            lastRetryAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            result: result,
          });

          results.succeeded++;
          results.details.push({
            id: op.id,
            type: op.type,
            status: 'success',
          });
        } catch (error) {
          // Failed - increment retry count
          const newRetryCount = (op.retryCount || 0) + 1;
          const nextRetryAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

          if (newRetryCount >= op.maxRetries) {
            // Max retries reached
            await updateFailedOperation(op.id, {
              status: 'max_retries_reached',
              retryCount: newRetryCount,
              lastRetryAt: new Date().toISOString(),
              lastError: error.message,
            });

            results.maxRetriesReached++;
            results.details.push({
              id: op.id,
              type: op.type,
              status: 'max_retries_reached',
              error: error.message,
            });

            // TODO: Send email alert to staff
          } else {
            // Schedule next retry
            await updateFailedOperation(op.id, {
              retryCount: newRetryCount,
              lastRetryAt: new Date().toISOString(),
              nextRetryAt: nextRetryAt,
              lastError: error.message,
            });

            results.failed++;
            results.details.push({
              id: op.id,
              type: op.type,
              status: 'retry_scheduled',
              retryCount: newRetryCount,
              nextRetryAt: nextRetryAt,
              error: error.message,
            });
          }
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Retry operation completed',
        results,
      });
    } catch (error) {
      console.error('Retry failed operations error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to retry operations',
        error: error.message,
      });
    }
  });
}

module.exports = handler;

