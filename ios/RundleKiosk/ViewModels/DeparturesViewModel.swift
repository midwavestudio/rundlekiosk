//
//  DeparturesViewModel.swift
//  RundleKiosk
//
//  ViewModel for departures list
//

import Foundation

@MainActor
class DeparturesViewModel: ObservableObject {
    @Published var departures: [Reservation] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    func loadDepartures() async {
        isLoading = true
        errorMessage = nil
        
        do {
            departures = try await APIService.shared.getTodayDepartures()
        } catch {
            errorMessage = error.localizedDescription
            print("Error loading departures: \(error)")
        }
        
        isLoading = false
    }
    
    func refresh() async {
        await loadDepartures()
    }
}

