//
//  RundleKioskApp.swift
//  RundleKiosk
//
//  Dual Check-In System for Rundle Suites Hotel
//  BNSF Crew & Cloudbeds/CLC Integration
//

import SwiftUI
import FirebaseCore
import FirebaseAuth

@main
struct RundleKioskApp: App {
    @StateObject private var authManager = AuthenticationManager.shared
    @StateObject private var networkMonitor = NetworkMonitor.shared
    
    init() {
        // Configure Firebase
        FirebaseApp.configure()
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authManager)
                .environmentObject(networkMonitor)
        }
    }
}

