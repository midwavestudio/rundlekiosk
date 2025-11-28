//
//  DashboardViewModel.swift
//  RundleKiosk
//
//  ViewModel for dashboard data management
//

import Foundation

@MainActor
class DashboardViewModel: ObservableObject {
    @Published var arrivals: [Reservation] = []
    @Published var departures: [Reservation] = []
    @Published var stats = DashboardStats()
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    func loadData() async {
        isLoading = true
        errorMessage = nil
        
        do {
            async let arrivalsTask = APIService.shared.getTodayArrivals()
            async let departuresTask = APIService.shared.getTodayDepartures()
            
            let (fetchedArrivals, fetchedDepartures) = try await (arrivalsTask, departuresTask)
            
            arrivals = fetchedArrivals
            departures = fetchedDepartures
            
            // Calculate stats
            updateStats()
        } catch {
            errorMessage = error.localizedDescription
            print("Error loading dashboard data: \(error)")
        }
        
        isLoading = false
    }
    
    func refresh() async {
        await loadData()
    }
    
    private func updateStats() {
        stats.arrivals = arrivals.count
        stats.departures = departures.count
        
        // Note: In a real implementation, you'd fetch actual occupancy data
        // from the API. This is just a placeholder calculation.
        stats.occupied = 25 // Placeholder
        stats.available = 15 // Placeholder
    }
}

struct DashboardStats {
    var occupied: Int = 0
    var available: Int = 0
    var arrivals: Int = 0
    var departures: Int = 0
}

