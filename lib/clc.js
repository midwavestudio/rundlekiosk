const axios = require('axios');

const CLC_API_URL = process.env.CLC_API_URL || 'https://api.clc.com/v1';

/**
 * CLC (BNSF Crew Lodging) API Client
 */
class CLCClient {
  constructor() {
    this.apiKey = process.env.CLC_API_KEY;
    this.baseURL = CLC_API_URL;
  }

  /**
   * Make authenticated request to CLC API
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
          'Accept': 'application/json',
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
      console.error('CLC API Error:', error.response?.data || error.message);
      throw {
        success: false,
        message: error.response?.data?.message || error.message,
        status: error.response?.status,
        data: error.response?.data,
      };
    }
  }

  /**
   * Get CLC reservations
   * @param {Object} filters - Filter parameters
   * @returns {Promise<Array>} List of CLC reservations
   */
  async getReservations(filters = {}) {
    return await this.makeRequest('/reservations', 'GET', filters);
  }

  /**
   * Get single CLC reservation
   * @param {string} reservationId - CLC Reservation ID or third-party identifier
   * @returns {Promise<Object>} Reservation details
   */
  async getReservation(reservationId) {
    return await this.makeRequest(`/reservations/${reservationId}`, 'GET');
  }

  /**
   * Check-in crew member to CLC
   * @param {Object} checkInData - Check-in data
   * @returns {Promise<Object>} Check-in result
   */
  async checkIn(checkInData) {
    const payload = {
      reservationId: checkInData.reservationId,
      thirdPartyIdentifier: checkInData.thirdPartyIdentifier,
      guestName: checkInData.guestName,
      roomNumber: checkInData.roomNumber,
      checkInDate: checkInData.checkInDate,
      checkOutDate: checkInData.checkOutDate,
      crewId: checkInData.crewId,
      employeeId: checkInData.employeeId,
      railroadCompany: checkInData.railroadCompany || 'BNSF',
      additionalGuests: checkInData.additionalGuests || [],
    };

    return await this.makeRequest('/checkin', 'POST', payload);
  }

  /**
   * Check-out crew member from CLC
   * @param {Object} checkOutData - Check-out data
   * @returns {Promise<Object>} Check-out result
   */
  async checkOut(checkOutData) {
    const payload = {
      reservationId: checkOutData.reservationId,
      thirdPartyIdentifier: checkOutData.thirdPartyIdentifier,
      roomNumber: checkOutData.roomNumber,
      checkOutDate: checkOutData.checkOutDate || new Date().toISOString(),
      actualCheckOutTime: new Date().toISOString(),
    };

    return await this.makeRequest('/checkout', 'POST', payload);
  }

  /**
   * Update crew reservation in CLC
   * @param {string} reservationId - Reservation ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Update result
   */
  async updateReservation(reservationId, updateData) {
    return await this.makeRequest(`/reservations/${reservationId}`, 'PUT', updateData);
  }

  /**
   * Get crew member details
   * @param {string} crewId - Crew member ID or employee ID
   * @returns {Promise<Object>} Crew member details
   */
  async getCrewMember(crewId) {
    return await this.makeRequest(`/crew/${crewId}`, 'GET');
  }

  /**
   * Validate crew member
   * @param {Object} crewData - Crew member data to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateCrewMember(crewData) {
    return await this.makeRequest('/crew/validate', 'POST', crewData);
  }

  /**
   * Add note to CLC reservation
   * @param {string} reservationId - Reservation ID
   * @param {string} note - Note text
   * @returns {Promise<Object>} Note creation result
   */
  async addNote(reservationId, note) {
    return await this.makeRequest(`/reservations/${reservationId}/notes`, 'POST', {
      note,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get today's crew arrivals
   * @returns {Promise<Array>} List of arriving crew members
   */
  async getTodayArrivals() {
    const today = new Date().toISOString().split('T')[0];
    return await this.getReservations({
      checkInDate: today,
      status: 'confirmed',
    });
  }

  /**
   * Get today's crew departures
   * @returns {Promise<Array>} List of departing crew members
   */
  async getTodayDepartures() {
    const today = new Date().toISOString().split('T')[0];
    return await this.getReservations({
      checkOutDate: today,
      status: 'checked_in',
    });
  }

  /**
   * Check if guest is BNSF crew member
   * @param {Object} guestData - Guest data to check
   * @returns {Promise<boolean>} True if crew member
   */
  async isBNSFCrew(guestData) {
    try {
      const result = await this.validateCrewMember({
        employeeId: guestData.employeeId,
        lastName: guestData.lastName,
        firstName: guestData.firstName,
      });
      return result.isValid === true;
    } catch (error) {
      console.error('Error validating BNSF crew member:', error);
      return false;
    }
  }
}

module.exports = CLCClient;

