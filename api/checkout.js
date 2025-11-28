const CloudbedsClient = require('../lib/cloudbeds');
const CLCClient = require('../lib/clc');
const { logTransaction, updateTransaction, logFailedOperation } = require('../lib/firebase');
const { corsMiddleware, authMiddleware } = require('../lib/middleware');

/**
 * Dual Check-Out Endpoint
 * Handles check-out for both Cloudbeds and CLC systems
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

      const {
        reservationId,
        isBNSFCrew = false,
        forceCheckOut = false,
      } = req.body;

      // Validate required fields
      if (!reservationId) {
        return res.status(400).json({
          success: false,
          message: 'Reservation ID is required',
        });
      }

      // Initialize API clients
      const cloudbeds = new CloudbedsClient();
      const clc = new CLCClient();

      // Create transaction log
      const transactionId = await logTransaction({
        type: 'check-out',
        reservationId,
        isBNSFCrew,
        userId: req.user.uid,
        userEmail: req.user.email,
        status: 'initiated',
        cloudbeds: { status: 'pending' },
        clc: { status: 'pending' },
      });

      const results = {
        success: true,
        transactionId,
        cloudbeds: { success: false },
        clc: { success: false },
        errors: [],
      };

      try {
        // Step 1: Get reservation details
        const reservation = await cloudbeds.getReservation(reservationId);
        const roomNumber = reservation.data?.roomID;

        // Step 2: Check invoice for outstanding balance
        let hasBalance = false;
        let balanceAmount = 0;

        try {
          const invoice = await cloudbeds.getInvoiceInformation(reservationId);
          balanceAmount = invoice.data?.balance || 0;
          hasBalance = balanceAmount > 0;

          await updateTransaction(transactionId, {
            'cloudbeds.invoiceCheck': {
              success: true,
              balance: balanceAmount,
            },
          });
        } catch (error) {
          results.errors.push({
            system: 'cloudbeds',
            step: 'invoice-check',
            message: error.message,
          });
        }

        // Step 3: Validate balance before check-out
        if (hasBalance && !forceCheckOut) {
          await updateTransaction(transactionId, {
            status: 'blocked',
            'cloudbeds.status': 'blocked',
            reason: 'Outstanding balance',
            balance: balanceAmount,
          });

          return res.status(400).json({
            success: false,
            message: 'Cannot check out with outstanding balance',
            balance: balanceAmount,
            transactionId,
            blocked: true,
          });
        }

        // Step 4: Execute Cloudbeds check-out
        try {
          const checkOutResult = await cloudbeds.checkOut(reservationId);
          results.cloudbeds = {
            success: true,
            data: checkOutResult,
          };

          await updateTransaction(transactionId, {
            'cloudbeds.status': 'success',
            'cloudbeds.checkOut': {
              success: true,
              timestamp: new Date().toISOString(),
            },
          });

          // Add note about dual check-out
          await cloudbeds.addReservationNote(
            reservationId,
            `Checked out via Dual Check-In System by ${req.user.email}`
          );
        } catch (error) {
          // If Cloudbeds check-out fails, abort entire operation
          results.success = false;
          results.cloudbeds = {
            success: false,
            error: error.message,
          };

          await updateTransaction(transactionId, {
            status: 'failed',
            'cloudbeds.status': 'failed',
            'cloudbeds.error': error.message,
          });

          return res.status(500).json({
            success: false,
            message: 'Cloudbeds check-out failed',
            error: error.message,
            transactionId,
            results,
          });
        }

        // Step 5: If BNSF crew, attempt CLC check-out
        if (isBNSFCrew) {
          try {
            const clcCheckOutData = {
              reservationId,
              thirdPartyIdentifier: reservationId,
              roomNumber: roomNumber,
              checkOutDate: new Date().toISOString(),
            };

            const clcResult = await clc.checkOut(clcCheckOutData);
            results.clc = {
              success: true,
              data: clcResult,
            };

            await updateTransaction(transactionId, {
              'clc.status': 'success',
              'clc.checkOut': {
                success: true,
                timestamp: new Date().toISOString(),
              },
            });
          } catch (error) {
            // CLC failure doesn't abort the operation, but we log it for retry
            results.clc = {
              success: false,
              error: error.message,
            };
            results.errors.push({
              system: 'clc',
              step: 'check-out',
              message: error.message,
            });

            await updateTransaction(transactionId, {
              'clc.status': 'failed',
              'clc.error': error.message,
            });

            // Log for retry
            await logFailedOperation({
              type: 'clc-checkout',
              reservationId,
              transactionId,
              data: {
                reservationId,
                thirdPartyIdentifier: reservationId,
                roomNumber,
              },
            });
          }
        } else {
          results.clc = {
            success: true,
            skipped: true,
            message: 'Not a BNSF crew member',
          };
        }

        // Final transaction update
        await updateTransaction(transactionId, {
          status: results.cloudbeds.success ? 'completed' : 'partial',
          completedAt: new Date().toISOString(),
        });

        return res.status(200).json({
          success: true,
          message: 'Check-out completed',
          transactionId,
          results,
        });
      } catch (error) {
        await updateTransaction(transactionId, {
          status: 'error',
          error: error.message,
        });

        throw error;
      }
    } catch (error) {
      console.error('Check-out error:', error);
      return res.status(500).json({
        success: false,
        message: 'Check-out failed',
        error: error.message,
      });
    }
  });
}

module.exports = handler;

