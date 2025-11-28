const CloudbedsClient = require('../lib/cloudbeds');
const CLCClient = require('../lib/clc');
const { logTransaction, updateTransaction, logFailedOperation } = require('../lib/firebase');
const { corsMiddleware, authMiddleware, errorHandler } = require('../lib/middleware');

/**
 * Dual Check-In Endpoint
 * Handles check-in for both Cloudbeds and CLC systems
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
        roomId,
        guestData,
        isBNSFCrew = false,
        employeeId,
        crewId,
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
        type: 'check-in',
        reservationId,
        roomId,
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
        
        // Step 2: Check if room is assigned, if not assign it
        let assignedRoomId = roomId;
        if (!reservation.data?.roomID && !roomId) {
          return res.status(400).json({
            success: false,
            message: 'Room must be assigned before check-in',
            transactionId,
          });
        }

        if (roomId && !reservation.data?.roomID) {
          try {
            await cloudbeds.assignRoom(reservationId, roomId);
            assignedRoomId = roomId;
            await updateTransaction(transactionId, {
              'cloudbeds.roomAssignment': {
                success: true,
                roomId: assignedRoomId,
              },
            });
          } catch (error) {
            results.errors.push({
              system: 'cloudbeds',
              step: 'room-assignment',
              message: error.message,
            });
            await updateTransaction(transactionId, {
              'cloudbeds.roomAssignment': {
                success: false,
                error: error.message,
              },
            });
          }
        } else {
          assignedRoomId = reservation.data?.roomID;
        }

        // Step 3: Update guest data if provided
        if (guestData && reservation.data?.guestID) {
          try {
            await cloudbeds.updateGuest(reservation.data.guestID, guestData);
            await updateTransaction(transactionId, {
              'cloudbeds.guestUpdate': {
                success: true,
              },
            });
          } catch (error) {
            results.errors.push({
              system: 'cloudbeds',
              step: 'guest-update',
              message: error.message,
            });
          }
        }

        // Step 4: Execute Cloudbeds check-in
        try {
          const checkInResult = await cloudbeds.checkIn(reservationId);
          results.cloudbeds = {
            success: true,
            data: checkInResult,
          };

          await updateTransaction(transactionId, {
            'cloudbeds.status': 'success',
            'cloudbeds.checkIn': {
              success: true,
              timestamp: new Date().toISOString(),
            },
          });

          // Add note about dual check-in
          await cloudbeds.addReservationNote(
            reservationId,
            `Checked in via Dual Check-In System by ${req.user.email}`
          );
        } catch (error) {
          // If Cloudbeds check-in fails, abort entire operation
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
            message: 'Cloudbeds check-in failed',
            error: error.message,
            transactionId,
            results,
          });
        }

        // Step 5: If BNSF crew, attempt CLC check-in
        if (isBNSFCrew) {
          try {
            const clcCheckInData = {
              reservationId,
              thirdPartyIdentifier: reservationId,
              guestName: `${guestData?.firstName || ''} ${guestData?.lastName || ''}`.trim(),
              roomNumber: assignedRoomId,
              checkInDate: reservation.data?.startDate,
              checkOutDate: reservation.data?.endDate,
              crewId: crewId,
              employeeId: employeeId,
              railroadCompany: 'BNSF',
            };

            const clcResult = await clc.checkIn(clcCheckInData);
            results.clc = {
              success: true,
              data: clcResult,
            };

            await updateTransaction(transactionId, {
              'clc.status': 'success',
              'clc.checkIn': {
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
              step: 'check-in',
              message: error.message,
            });

            await updateTransaction(transactionId, {
              'clc.status': 'failed',
              'clc.error': error.message,
            });

            // Log for retry
            await logFailedOperation({
              type: 'clc-checkin',
              reservationId,
              transactionId,
              data: {
                reservationId,
                thirdPartyIdentifier: reservationId,
                roomNumber: assignedRoomId,
                employeeId,
                crewId,
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
          message: 'Check-in completed',
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
      console.error('Check-in error:', error);
      return res.status(500).json({
        success: false,
        message: 'Check-in failed',
        error: error.message,
      });
    }
  });
}

module.exports = handler;

