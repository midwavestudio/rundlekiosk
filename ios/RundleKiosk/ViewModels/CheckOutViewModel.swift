//
//  CheckOutViewModel.swift
//  RundleKiosk
//
//  ViewModel for check-out flow
//

import Foundation

@MainActor
class CheckOutViewModel: ObservableObject {
    let reservation: Reservation
    
    @Published var balance: Double?
    @Published var isLoadingBalance = false
    
    @Published var isCheckingOut = false
    @Published var cloudbedsStatus: CheckInStatus = .pending
    @Published var clcStatus: CheckInStatus = .pending
    
    @Published var showSuccess = false
    @Published var successMessage = ""
    @Published var errorMessage: String?
    
    init(reservation: Reservation) {
        self.reservation = reservation
        self.balance = reservation.balance
    }
    
    func loadBalance() async {
        // In a real implementation, you would fetch the latest balance
        // from the invoice endpoint. For now, we use the cached value.
        isLoadingBalance = true
        
        // Simulate API call
        try? await Task.sleep(nanoseconds: 500_000_000)
        
        // Use reservation balance or fetch from API
        balance = reservation.balance ?? 0
        
        isLoadingBalance = false
    }
    
    func performCheckOut() {
        Task {
            isCheckingOut = true
            errorMessage = nil
            cloudbedsStatus = .pending
            clcStatus = .pending
            
            do {
                // Check balance one more time
                if let currentBalance = balance, currentBalance > 0 {
                    errorMessage = "Cannot check out with outstanding balance"
                    isCheckingOut = false
                    return
                }
                
                let request = CheckOutRequest(
                    reservationId: reservation.reservationID,
                    isBNSFCrew: reservation.isBNSFCrew,
                    forceCheckOut: false
                )
                
                // Check if online
                if !NetworkMonitor.shared.isConnected {
                    // Queue for offline processing
                    let operation = PendingOperation(
                        type: .checkOut,
                        data: request
                    )
                    OfflineQueueManager.shared.addOperation(operation)
                    
                    successMessage = "Check-out queued for when connection is restored"
                    showSuccess = true
                    isCheckingOut = false
                    return
                }
                
                // Perform check-out
                let response = try await APIService.shared.checkOut(request: request)
                
                // Check if blocked due to balance
                if response.blocked == true {
                    errorMessage = "Cannot check out: Outstanding balance of $\(String(format: "%.2f", response.balance ?? 0))"
                    isCheckingOut = false
                    return
                }
                
                // Update status based on response
                if let results = response.results {
                    cloudbedsStatus = results.cloudbeds.success ? .success : .failed
                    
                    if reservation.isBNSFCrew {
                        if results.clc.skipped == true {
                            clcStatus = .skipped
                        } else {
                            clcStatus = results.clc.success ? .success : .failed
                        }
                    } else {
                        clcStatus = .skipped
                    }
                }
                
                if response.success {
                    successMessage = buildSuccessMessage(results: response.results)
                    showSuccess = true
                } else {
                    errorMessage = response.message ?? "Check-out failed"
                }
            } catch {
                errorMessage = "Check-out failed: \(error.localizedDescription)"
                cloudbedsStatus = .failed
                clcStatus = .failed
            }
            
            isCheckingOut = false
        }
    }
    
    private func buildSuccessMessage(results: DualSystemResult?) -> String {
        guard let results = results else {
            return "Guest checked out successfully"
        }
        
        var message = ""
        
        if results.cloudbeds.success {
            message += "✓ Cloudbeds check-out complete\n"
        }
        
        if results.clc.success {
            message += "✓ CLC check-out complete\n"
        } else if results.clc.skipped == true {
            message += "• CLC check-out skipped (not BNSF crew)\n"
        } else if !results.clc.success {
            message += "⚠ CLC check-out failed (will retry automatically)\n"
        }
        
        if let errors = results.errors, !errors.isEmpty {
            message += "\nSome operations encountered issues and will be retried."
        }
        
        return message.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

