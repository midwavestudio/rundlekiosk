//
//  CheckOutView.swift
//  RundleKiosk
//
//  Dual check-out flow view
//

import SwiftUI

struct CheckOutView: View {
    let reservation: Reservation
    @Environment(\.dismiss) var dismiss
    @StateObject private var viewModel: CheckOutViewModel
    
    init(reservation: Reservation) {
        self.reservation = reservation
        _viewModel = StateObject(wrappedValue: CheckOutViewModel(reservation: reservation))
    }
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Guest information
                    GuestInfoSection(reservation: reservation)
                    
                    // Room information
                    RoomInfoSection(reservation: reservation)
                    
                    // Balance check
                    BalanceSection(
                        balance: viewModel.balance,
                        isLoadingBalance: viewModel.isLoadingBalance
                    )
                    
                    // Check-out progress
                    if viewModel.isCheckingOut {
                        CheckOutProgressView(
                            cloudbedsStatus: viewModel.cloudbedsStatus,
                            clcStatus: viewModel.clcStatus
                        )
                    }
                    
                    // Error display
                    if let error = viewModel.errorMessage {
                        ErrorBanner(message: error)
                    }
                    
                    // Warning if balance exists
                    if let balance = viewModel.balance, balance > 0 {
                        BalanceWarning(balance: balance)
                    }
                    
                    // Check-out button
                    Button(action: { viewModel.performCheckOut() }) {
                        HStack {
                            if viewModel.isCheckingOut {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            }
                            Text("Check Out Guest")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(canCheckOut ? Color.orange : Color.gray)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(!canCheckOut || viewModel.isCheckingOut)
                    .padding(.horizontal)
                }
                .padding()
            }
            .navigationTitle("Check Out")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert("Check-Out Complete", isPresented: $viewModel.showSuccess) {
                Button("Done") {
                    dismiss()
                }
            } message: {
                Text(viewModel.successMessage)
            }
            .task {
                await viewModel.loadBalance()
            }
        }
    }
    
    var canCheckOut: Bool {
        return (viewModel.balance ?? 0) == 0 && !viewModel.isCheckingOut
    }
}

// MARK: - Room Info Section

struct RoomInfoSection: View {
    let reservation: Reservation
    
    var body: some View {
        HStack {
            Image(systemName: "bed.double.fill")
                .font(.title2)
                .foregroundColor(.blue)
            
            VStack(alignment: .leading, spacing: 4) {
                Text("Room \(reservation.roomNumber ?? "Unknown")")
                    .font(.headline)
                
                if let roomType = reservation.roomType {
                    Text(roomType)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
            Spacer()
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 3, x: 0, y: 1)
    }
}

// MARK: - Balance Section

struct BalanceSection: View {
    let balance: Double?
    let isLoadingBalance: Bool
    
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Balance")
                    .font(.headline)
                
                Spacer()
                
                if isLoadingBalance {
                    ProgressView()
                } else if let balance = balance {
                    Text("$\(String(format: "%.2f", balance))")
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundColor(balance > 0 ? .red : .green)
                } else {
                    Text("Unknown")
                        .font(.title2)
                        .foregroundColor(.secondary)
                }
            }
            
            if let balance = balance {
                HStack {
                    Image(systemName: balance > 0 ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                        .foregroundColor(balance > 0 ? .red : .green)
                    
                    Text(balance > 0 ? "Outstanding balance must be paid before check-out" : "Fully paid")
                        .font(.caption)
                        .foregroundColor(balance > 0 ? .red : .green)
                    
                    Spacer()
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 3, x: 0, y: 1)
    }
}

// MARK: - Balance Warning

struct BalanceWarning: View {
    let balance: Double
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(.red)
                
                Text("Cannot Check Out")
                    .font(.headline)
                    .foregroundColor(.red)
            }
            
            Text("Guest has an outstanding balance of $\(String(format: "%.2f", balance)). Please process payment before checking out.")
                .font(.subheadline)
        }
        .padding()
        .background(Color.red.opacity(0.1))
        .cornerRadius(12)
    }
}

// MARK: - Check-Out Progress View

struct CheckOutProgressView: View {
    let cloudbedsStatus: CheckInStatus
    let clcStatus: CheckInStatus
    
    var body: some View {
        VStack(spacing: 16) {
            Text("Checking Out...")
                .font(.headline)
            
            SystemStatusRow(
                systemName: "Cloudbeds",
                status: cloudbedsStatus
            )
            
            SystemStatusRow(
                systemName: "CLC (BNSF)",
                status: clcStatus
            )
        }
        .padding()
        .background(Color.orange.opacity(0.1))
        .cornerRadius(12)
    }
}

// MARK: - Stubs for Missing Views

struct SearchView: View {
    @Binding var searchText: String
    
    var body: some View {
        Text("Search View - Coming Soon")
    }
}

struct ReservationDetailView: View {
    let reservation: Reservation
    
    var body: some View {
        Text("Reservation Detail View")
    }
}

struct SettingsView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    
    var body: some View {
        NavigationView {
            List {
                Section("Account") {
                    if let email = authManager.currentUser?.email {
                        Text(email)
                    }
                }
                
                Section {
                    Button("Sign Out", role: .destructive) {
                        try? authManager.signOut()
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    CheckOutView(reservation: Reservation(
        id: "1",
        reservationID: "RES001",
        guestName: "John Doe",
        guestFirstName: "John",
        guestLastName: "Doe",
        guestEmail: "john@example.com",
        guestPhone: "555-1234",
        checkInDate: "2024-01-15",
        checkOutDate: "2024-01-17",
        status: .checkedIn,
        roomID: "101",
        roomNumber: "101",
        roomType: "Standard",
        adults: 2,
        children: 0,
        thirdPartyIdentifier: nil,
        balance: 0,
        isBNSFCrew: false,
        employeeId: nil,
        crewId: nil
    ))
}

