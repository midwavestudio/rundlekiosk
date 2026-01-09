const axios = require('axios');

const CLOUDBEDS_API_URL = process.env.CLOUDBEDS_API_URL || 'https://api.cloudbeds.com/api/v1.3';

/**
 * Cloudbeds API Client
 */
class CloudbedsClient {
  constructor() {
    this.apiKey = process.env.CLOUDBEDS_API_KEY;
    this.propertyId = process.env.CLOUDBEDS_PROPERTY_ID;
    this.baseURL = CLOUDBEDS_API_URL;
  }

  /**
   * Make authenticated request to Cloudbeds API
   * @param {string} endpoint - API endpoint
   * @param {string} method - HTTP method
   * @param {Object} data - Request data
   * @returns {Promise<Object>} Response data
   */
  async makeRequest(endpoint, method = 'GET', data = null) {
    try {
      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      };

      if (data) {
        if (method === 'GET') {
          config.params = data;
        } else {
          config.data = data;
        }
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error('Cloudbeds API Error:', error.response?.data || error.message);
      throw {
        success: false,
        message: error.response?.data?.message || error.message,
        status: error.response?.status,
        data: error.response?.data,
      };
    }
  }

  /**
   * Get reservations with filters
   * @param {Object} filters - Filter parameters
   * @returns {Promise<Object>} Reservations data
   */
  async getReservations(filters = {}) {
    const params = {
      propertyID: this.propertyId,
      ...filters,
    };
    return await this.makeRequest('/getReservations', 'GET', params);
  }

  /**
   * Get today's arrivals
   * @returns {Promise<Array>} List of arriving reservations
   */
  async getTodayArrivals() {
    const today = new Date().toISOString().split('T')[0];
    const result = await this.getReservations({
      checkInFrom: today,
      checkInTo: today,
      status: 'confirmed',
    });
    return result.data || [];
  }

  /**
   * Get today's departures
   * @returns {Promise<Array>} List of departing reservations
   */
  async getTodayDepartures() {
    const today = new Date().toISOString().split('T')[0];
    const result = await this.getReservations({
      checkOutFrom: today,
      checkOutTo: today,
      status: 'checked_in',
    });
    return result.data || [];
  }

  /**
   * Get single reservation details
   * @param {string} reservationId - Reservation ID
   * @returns {Promise<Object>} Reservation details
   */
  async getReservation(reservationId) {
    return await this.makeRequest('/getReservation', 'GET', {
      reservationID: reservationId,
      propertyID: this.propertyId,
    });
  }

  /**
   * Get reservation with rate details
   * @param {string} reservationId - Reservation ID
   * @returns {Promise<Object>} Reservation with rates
   */
  async getReservationWithRates(reservationId) {
    return await this.makeRequest('/getReservationsWithRateDetails', 'GET', {
      reservationID: reservationId,
      propertyID: this.propertyId,
    });
  }

  /**
   * Get unassigned rooms
   * @param {string} checkIn - Check-in date (YYYY-MM-DD)
   * @param {string} checkOut - Check-out date (YYYY-MM-DD)
   * @returns {Promise<Array>} List of available rooms
   */
  async getUnassignedRooms(checkIn, checkOut) {
    const result = await this.makeRequest('/getRoomsUnassigned', 'GET', {
      propertyID: this.propertyId,
      checkIn,
      checkOut,
    });
    return result.data || [];
  }

  /**
   * Assign room to reservation
   * @param {string} reservationId - Reservation ID
   * @param {string} roomId - Room ID
   * @returns {Promise<Object>} Assignment result
   */
  async assignRoom(reservationId, roomId) {
    return await this.makeRequest('/postRoomAssign', 'POST', {
      reservationID: reservationId,
      roomID: roomId,
      propertyID: this.propertyId,
    });
  }

  /**
   * Update guest information
   * @param {string} guestId - Guest ID
   * @param {Object} guestData - Guest data to update
   * @returns {Promise<Object>} Update result
   */
  async updateGuest(guestId, guestData) {
    return await this.makeRequest('/putGuest', 'PUT', {
      guestID: guestId,
      propertyID: this.propertyId,
      ...guestData,
    });
  }

  /**
   * Add new guest
   * @param {string} reservationId - Reservation ID
   * @param {Object} guestData - Guest data
   * @returns {Promise<Object>} Guest creation result
   */
  async addGuest(reservationId, guestData) {
    return await this.makeRequest('/postGuest', 'POST', {
      reservationID: reservationId,
      propertyID: this.propertyId,
      ...guestData,
    });
  }

  /**
   * Check-in reservation
   * @param {string} reservationId - Reservation ID
   * @returns {Promise<Object>} Check-in result
   */
  async checkIn(reservationId) {
    return await this.makeRequest('/putReservation', 'PUT', {
      reservationID: reservationId,
      propertyID: this.propertyId,
      status: 'checked_in',
    });
  }

  /**
   * Check-out reservation
   * @param {string} reservationId - Reservation ID
   * @returns {Promise<Object>} Check-out result
   */
  async checkOut(reservationId) {
    return await this.makeRequest('/putReservation', 'PUT', {
      reservationID: reservationId,
      propertyID: this.propertyId,
      status: 'checked_out',
    });
  }

  /**
   * Get reservation invoice information
   * @param {string} reservationId - Reservation ID
   * @returns {Promise<Object>} Invoice information
   */
  async getInvoiceInformation(reservationId) {
    return await this.makeRequest('/getReservationInvoiceInformation', 'GET', {
      reservationID: reservationId,
      propertyID: this.propertyId,
    });
  }

  /**
   * Post payment
   * @param {string} reservationId - Reservation ID
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Payment result
   */
  async postPayment(reservationId, paymentData) {
    return await this.makeRequest('/postPayment', 'POST', {
      reservationID: reservationId,
      propertyID: this.propertyId,
      ...paymentData,
    });
  }

  /**
   * Upload guest document
   * @param {string} guestId - Guest ID
   * @param {Object} documentData - Document data
   * @returns {Promise<Object>} Upload result
   */
  async uploadGuestDocument(guestId, documentData) {
    return await this.makeRequest('/postGuestDocument', 'POST', {
      guestID: guestId,
      propertyID: this.propertyId,
      ...documentData,
    });
  }

  /**
   * Upload reservation document
   * @param {string} reservationId - Reservation ID
   * @param {Object} documentData - Document data
   * @returns {Promise<Object>} Upload result
   */
  async uploadReservationDocument(reservationId, documentData) {
    return await this.makeRequest('/postReservationDocument', 'POST', {
      reservationID: reservationId,
      propertyID: this.propertyId,
      ...documentData,
    });
  }

  /**
   * Add note to reservation
   * @param {string} reservationId - Reservation ID
   * @param {string} note - Note text
   * @returns {Promise<Object>} Note creation result
   */
  async addReservationNote(reservationId, note) {
    return await this.makeRequest('/postReservationNote', 'POST', {
      reservationID: reservationId,
      propertyID: this.propertyId,
      note,
    });
  }

  /**
   * Get housekeeping status
   * @param {string} roomId - Room ID
   * @returns {Promise<Object>} Housekeeping status
   */
  async getHousekeepingStatus(roomId) {
    return await this.makeRequest('/getHouseKeepingStatus', 'GET', {
      roomID: roomId,
      propertyID: this.propertyId,
    });
  }
}

module.exports = CloudbedsClient;

