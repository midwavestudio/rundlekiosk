//
//  CheckInViewModel.swift
//  RundleKiosk
//
//  ViewModel for check-in flow
//

import Foundation

@MainActor
class CheckInViewModel: ObservableObject {
    let reservation: Reservation
    
    @Published var guest: Guest
    @Published var selectedRoom: Room?
    @Published var availableRooms: [Room] = []
    @Published var isLoadingRooms = false
    
    @Published var isBNSFCrew = false
    @Published var employeeId = ""
    @Published var crewId = ""
    
    @Published var isCheckingIn = false
    @Published var cloudbedsStatus: CheckInStatus = .pending
    @Published var clcStatus: CheckInStatus = .pending
    
    @Published var showSuccess = false
    @Published var successMessage = ""
    @Published var errorMessage: String?
    
    init(reservation: Reservation) {
        self.reservation = reservation
        self.guest = Guest(
            firstName: reservation.guestFirstName ?? "",
            lastName: reservation.guestLastName ?? "",
            email: reservation.guestEmail,
            phone: reservation.guestPhone
        )
        self.isBNSFCrew = reservation.isBNSFCrew
        self.employeeId = reservation.employeeId ?? ""
        self.crewId = reservation.crewId ?? ""
    }
    
    func loadAvailableRooms() async {
        guard !reservation.hasRoom else { return }
        
        isLoadingRooms = true
        
        do {
            availableRooms = try await APIService.shared.getAvailableRooms(
                checkIn: reservation.checkInDate,
                checkOut: reservation.checkOutDate
            )
        } catch {
            errorMessage = "Failed to load available rooms: \(error.localizedDescription)"
        }
        
        isLoadingRooms = false
    }
    
    func performCheckIn() {
        Task {
            isCheckingIn = true
            errorMessage = nil
            cloudbedsStatus = .pending
            clcStatus = .pending
            
            do {
                // Prepare check-in request
                let roomId = selectedRoom?.roomID ?? reservation.roomID
                
                guard roomId != nil else {
                    errorMessage = "Please assign a room before checking in"
                    isCheckingIn = false
                    return
                }
                
                let request = CheckInRequest(
                    reservationId: reservation.reservationID,
                    roomId: roomId,
                    guestData: guest,
                    isBNSFCrew: isBNSFCrew,
                    employeeId: isBNSFCrew ? employeeId : nil,
                    crewId: isBNSFCrew ? (crewId.isEmpty ? nil : crewId) : nil
                )
                
                // Check if online
                if !NetworkMonitor.shared.isConnected {
                    // Queue for offline processing
                    let operation = PendingOperation(
                        type: .checkIn,
                        data: request
                    )
                    OfflineQueueManager.shared.addOperation(operation)
                    
                    successMessage = "Check-in queued for when connection is restored"
                    showSuccess = true
                    isCheckingIn = false
                    return
                }
                
                // Perform check-in
                let response = try await APIService.shared.checkIn(request: request)
                
                // Update status based on response
                if let results = response.results {
                    cloudbedsStatus = results.cloudbeds.success ? .success : .failed
                    
                    if isBNSFCrew {
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
                    errorMessage = response.message ?? "Check-in failed"
                }
            } catch {
                errorMessage = "Check-in failed: \(error.localizedDescription)"
                cloudbedsStatus = .failed
                clcStatus = .failed
            }
            
            isCheckingIn = false
        }
    }
    
    private func buildSuccessMessage(results: DualSystemResult?) -> String {
        guard let results = results else {
            return "Guest checked in successfully"
        }
        
        var message = ""
        
        if results.cloudbeds.success {
            message += "✓ Cloudbeds check-in complete\n"
        }
        
        if results.clc.success {
            message += "✓ CLC check-in complete\n"
        } else if results.clc.skipped == true {
            message += "• CLC check-in skipped (not BNSF crew)\n"
        } else if !results.clc.success {
            message += "⚠ CLC check-in failed (will retry automatically)\n"
        }
        
        if let errors = results.errors, !errors.isEmpty {
            message += "\nSome operations encountered issues and will be retried."
        }
        
        return message.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

