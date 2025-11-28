//
//  APIConfig.swift
//  RundleKiosk
//
//  API Configuration
//

import Foundation

struct APIConfig {
    // Base URL for the Vercel-hosted API
    static let baseURL = "https://your-app.vercel.app/api"
    
    // Development URL (for local testing)
    static let devBaseURL = "http://localhost:3000/api"
    
    // Use development URL in debug mode
    #if DEBUG
    static var apiBaseURL: String {
        // Toggle this to test against local or production API
        return ProcessInfo.processInfo.environment["USE_LOCAL_API"] == "true" ? devBaseURL : baseURL
    }
    #else
    static let apiBaseURL = baseURL
    #endif
    
    // API Endpoints
    struct Endpoints {
        static let checkIn = "/checkin"
        static let checkOut = "/checkout"
        static let reservations = "/reservations"
        static let arrivals = "/arrivals"
        static let departures = "/departures"
        static let rooms = "/rooms"
        static let roomAssign = "/room-assign"
        static let retryFailed = "/retry-failed"
    }
    
    // Request timeout
    static let timeout: TimeInterval = 30.0
}

