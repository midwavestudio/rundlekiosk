//
//  APIService.swift
//  RundleKiosk
//
//  API Service for communication with backend
//

import Foundation

class APIService {
    static let shared = APIService()
    
    private init() {}
    
    private var authToken: String? {
        return AuthenticationManager.shared.currentUserToken
    }
    
    // MARK: - Generic Request Handler
    
    private func makeRequest<T: Codable>(
        endpoint: String,
        method: String = "GET",
        body: Codable? = nil
    ) async throws -> T {
        let urlString = APIConfig.apiBaseURL + endpoint
        guard let url = URL(string: urlString) else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = APIConfig.timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        // Add authentication token
        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        // Add request body if provided
        if let body = body {
            request.httpBody = try JSONEncoder().encode(body)
        }
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            if let errorResponse = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
                throw APIError.serverError(errorResponse.message)
            }
            throw APIError.httpError(httpResponse.statusCode)
        }
        
        do {
            let decoder = JSONDecoder()
            return try decoder.decode(T.self, from: data)
        } catch {
            print("Decoding error: \(error)")
            throw APIError.decodingError(error)
        }
    }
    
    // MARK: - Reservations
    
    func getReservations(filters: [String: String] = [:]) async throws -> [Reservation] {
        var urlComponents = URLComponents(string: APIConfig.apiBaseURL + APIConfig.Endpoints.reservations)!
        urlComponents.queryItems = filters.map { URLQueryItem(name: $0.key, value: $0.value) }
        
        let response: ReservationsResponse = try await makeRequest(
            endpoint: urlComponents.url!.path + (urlComponents.query.map { "?" + $0 } ?? ""),
            method: "GET"
        )
        return response.data
    }
    
    func getTodayArrivals() async throws -> [Reservation] {
        let response: ReservationsResponse = try await makeRequest(
            endpoint: APIConfig.Endpoints.arrivals,
            method: "GET"
        )
        return response.data
    }
    
    func getTodayDepartures() async throws -> [Reservation] {
        let response: ReservationsResponse = try await makeRequest(
            endpoint: APIConfig.Endpoints.departures,
            method: "GET"
        )
        return response.data
    }
    
    // MARK: - Rooms
    
    func getAvailableRooms(checkIn: String, checkOut: String) async throws -> [Room] {
        let endpoint = "\(APIConfig.Endpoints.rooms)?checkIn=\(checkIn)&checkOut=\(checkOut)"
        let response: RoomsResponse = try await makeRequest(
            endpoint: endpoint,
            method: "GET"
        )
        return response.data
    }
    
    func assignRoom(reservationId: String, roomId: String) async throws -> RoomAssignResponse {
        let body = RoomAssignRequest(reservationId: reservationId, roomId: roomId)
        return try await makeRequest(
            endpoint: APIConfig.Endpoints.roomAssign,
            method: "POST",
            body: body
        )
    }
    
    // MARK: - Check-In / Check-Out
    
    func checkIn(request: CheckInRequest) async throws -> CheckInResponse {
        return try await makeRequest(
            endpoint: APIConfig.Endpoints.checkIn,
            method: "POST",
            body: request
        )
    }
    
    func checkOut(request: CheckOutRequest) async throws -> CheckOutResponse {
        return try await makeRequest(
            endpoint: APIConfig.Endpoints.checkOut,
            method: "POST",
            body: request
        )
    }
    
    // MARK: - Retry Failed Operations
    
    func retryFailedOperations() async throws -> RetryResponse {
        return try await makeRequest(
            endpoint: APIConfig.Endpoints.retryFailed,
            method: "POST"
        )
    }
}

// MARK: - Response Models

struct ReservationsResponse: Codable {
    let success: Bool
    let data: [Reservation]
    let count: Int
}

struct RoomsResponse: Codable {
    let success: Bool
    let data: [Room]
    let count: Int
}

struct RoomAssignRequest: Codable {
    let reservationId: String
    let roomId: String
}

struct RoomAssignResponse: Codable {
    let success: Bool
    let message: String
    let transactionId: String?
}

struct RetryResponse: Codable {
    let success: Bool
    let message: String
    let results: RetryResults?
}

struct RetryResults: Codable {
    let total: Int
    let succeeded: Int
    let failed: Int
    let maxRetriesReached: Int
}

struct ErrorResponse: Codable {
    let success: Bool
    let message: String
}

// MARK: - API Errors

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(Int)
    case serverError(String)
    case decodingError(Error)
    case unauthorized
    case networkError(Error)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let code):
            return "HTTP error: \(code)"
        case .serverError(let message):
            return message
        case .decodingError(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .unauthorized:
            return "Unauthorized - Please log in again"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}

