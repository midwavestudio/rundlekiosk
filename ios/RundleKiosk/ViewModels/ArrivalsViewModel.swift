//
//  ArrivalsViewModel.swift
//  RundleKiosk
//
//  ViewModel for arrivals list
//

import Foundation

@MainActor
class ArrivalsViewModel: ObservableObject {
    @Published var arrivals: [Reservation] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    func loadArrivals() async {
        isLoading = true
        errorMessage = nil
        
        do {
            arrivals = try await APIService.shared.getTodayArrivals()
        } catch {
            errorMessage = error.localizedDescription
            print("Error loading arrivals: \(error)")
        }
        
        isLoading = false
    }
    
    func refresh() async {
        await loadArrivals()
    }
}

