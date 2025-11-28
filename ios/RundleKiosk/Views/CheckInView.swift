//
//  CheckInView.swift
//  RundleKiosk
//
//  Dual check-in flow view
//

import SwiftUI

struct CheckInView: View {
    let reservation: Reservation
    @Environment(\.dismiss) var dismiss
    @StateObject private var viewModel: CheckInViewModel
    
    init(reservation: Reservation) {
        self.reservation = reservation
        _viewModel = StateObject(wrappedValue: CheckInViewModel(reservation: reservation))
    }
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Guest information
                    GuestInfoSection(reservation: reservation)
                    
                    // Room assignment
                    if !reservation.hasRoom {
                        RoomAssignmentSection(
                            selectedRoom: $viewModel.selectedRoom,
                            availableRooms: viewModel.availableRooms,
                            isLoadingRooms: viewModel.isLoadingRooms
                        )
                    } else {
                        AssignedRoomDisplay(roomNumber: reservation.roomNumber ?? "Unknown")
                    }
                    
                    // Guest details form
                    GuestDetailsForm(guest: $viewModel.guest)
                    
                    // BNSF Crew section
                    BNSFCrewSection(
                        isBNSFCrew: $viewModel.isBNSFCrew,
                        employeeId: $viewModel.employeeId,
                        crewId: $viewModel.crewId
                    )
                    
                    // Check-in progress
                    if viewModel.isCheckingIn {
                        CheckInProgressView(
                            cloudbedsStatus: viewModel.cloudbedsStatus,
                            clcStatus: viewModel.clcStatus
                        )
                    }
                    
                    // Error display
                    if let error = viewModel.errorMessage {
                        ErrorBanner(message: error)
                    }
                    
                    // Check-in button
                    Button(action: { viewModel.performCheckIn() }) {
                        HStack {
                            if viewModel.isCheckingIn {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            }
                            Text("Check In Guest")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(canCheckIn ? Color.green : Color.gray)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(!canCheckIn || viewModel.isCheckingIn)
                    .padding(.horizontal)
                }
                .padding()
            }
            .navigationTitle("Check In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert("Check-In Complete", isPresented: $viewModel.showSuccess) {
                Button("Done") {
                    dismiss()
                }
            } message: {
                Text(viewModel.successMessage)
            }
            .task {
                await viewModel.loadAvailableRooms()
            }
        }
    }
    
    var canCheckIn: Bool {
        return (reservation.hasRoom || viewModel.selectedRoom != nil) && !viewModel.isCheckingIn
    }
}

// MARK: - Guest Info Section

struct GuestInfoSection: View {
    let reservation: Reservation
    
    var body: some View {
        VStack(spacing: 16) {
            HStack {
                ZStack {
                    Circle()
                        .fill(Color.blue.opacity(0.2))
                        .frame(width: 60, height: 60)
                    
                    Text(String(reservation.displayName.prefix(1)))
                        .font(.title)
                        .fontWeight(.bold)
                        .foregroundColor(.blue)
                }
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(reservation.displayName)
                        .font(.title2)
                        .fontWeight(.bold)
                    
                    Text("Reservation: \(reservation.reservationID)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    HStack {
                        Image(systemName: "calendar")
                        Text("\(reservation.checkInDate) - \(reservation.checkOutDate)")
                    }
                    .font(.caption)
                    .foregroundColor(.secondary)
                }
                
                Spacer()
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 3, x: 0, y: 1)
    }
}

// MARK: - Room Assignment Section

struct RoomAssignmentSection: View {
    @Binding var selectedRoom: Room?
    let availableRooms: [Room]
    let isLoadingRooms: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Assign Room")
                .font(.headline)
            
            if isLoadingRooms {
                ProgressView()
                    .frame(maxWidth: .infinity)
            } else if availableRooms.isEmpty {
                Text("No available rooms")
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(availableRooms) { room in
                            RoomCard(
                                room: room,
                                isSelected: selectedRoom?.id == room.id
                            )
                            .onTapGesture {
                                selectedRoom = room
                            }
                        }
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 3, x: 0, y: 1)
    }
}

struct RoomCard: View {
    let room: Room
    let isSelected: Bool
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "bed.double.fill")
                .font(.title2)
                .foregroundColor(isSelected ? .white : .blue)
            
            Text(room.roomNumber)
                .font(.headline)
                .foregroundColor(isSelected ? .white : .primary)
            
            Text(room.roomTypeName ?? room.roomType)
                .font(.caption)
                .foregroundColor(isSelected ? .white.opacity(0.9) : .secondary)
        }
        .frame(width: 100, height: 100)
        .background(isSelected ? Color.blue : Color.blue.opacity(0.1))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isSelected ? Color.blue : Color.clear, lineWidth: 2)
        )
    }
}

struct AssignedRoomDisplay: View {
    let roomNumber: String
    
    var body: some View {
        HStack {
            Image(systemName: "bed.double.fill")
                .foregroundColor(.green)
            Text("Room \(roomNumber)")
                .font(.headline)
            Spacer()
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)
        }
        .padding()
        .background(Color.green.opacity(0.1))
        .cornerRadius(12)
    }
}

// MARK: - Guest Details Form

struct GuestDetailsForm: View {
    @Binding var guest: Guest
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Guest Details")
                .font(.headline)
            
            TextField("First Name", text: $guest.firstName)
                .textFieldStyle(RoundedBorderTextFieldStyle())
            
            TextField("Last Name", text: $guest.lastName)
                .textFieldStyle(RoundedBorderTextFieldStyle())
            
            TextField("Email", text: Binding(
                get: { guest.email ?? "" },
                set: { guest.email = $0.isEmpty ? nil : $0 }
            ))
            .textFieldStyle(RoundedBorderTextFieldStyle())
            .textContentType(.emailAddress)
            .keyboardType(.emailAddress)
            .autocapitalization(.none)
            
            TextField("Phone", text: Binding(
                get: { guest.phone ?? "" },
                set: { guest.phone = $0.isEmpty ? nil : $0 }
            ))
            .textFieldStyle(RoundedBorderTextFieldStyle())
            .textContentType(.telephoneNumber)
            .keyboardType(.phonePad)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 3, x: 0, y: 1)
    }
}

// MARK: - BNSF Crew Section

struct BNSFCrewSection: View {
    @Binding var isBNSFCrew: Bool
    @Binding var employeeId: String
    @Binding var crewId: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle("BNSF Crew Member", isOn: $isBNSFCrew)
                .font(.headline)
            
            if isBNSFCrew {
                TextField("Employee ID", text: $employeeId)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                
                TextField("Crew ID (Optional)", text: $crewId)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 3, x: 0, y: 1)
    }
}

// MARK: - Check-In Progress View

struct CheckInProgressView: View {
    let cloudbedsStatus: CheckInStatus
    let clcStatus: CheckInStatus
    
    var body: some View {
        VStack(spacing: 16) {
            Text("Checking In...")
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
        .background(Color.blue.opacity(0.1))
        .cornerRadius(12)
    }
}

struct SystemStatusRow: View {
    let systemName: String
    let status: CheckInStatus
    
    var body: some View {
        HStack {
            Text(systemName)
                .font(.subheadline)
            
            Spacer()
            
            switch status {
            case .pending:
                ProgressView()
            case .success:
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
            case .failed:
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.red)
            case .skipped:
                Image(systemName: "minus.circle.fill")
                    .foregroundColor(.gray)
            }
        }
    }
}

enum CheckInStatus {
    case pending
    case success
    case failed
    case skipped
}

// MARK: - Error Banner

struct ErrorBanner: View {
    let message: String
    
    var body: some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(message)
                .font(.subheadline)
        }
        .foregroundColor(.white)
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color.red)
        .cornerRadius(12)
    }
}

#Preview {
    CheckInView(reservation: Reservation(
        id: "1",
        reservationID: "RES001",
        guestName: "John Doe",
        guestFirstName: "John",
        guestLastName: "Doe",
        guestEmail: "john@example.com",
        guestPhone: "555-1234",
        checkInDate: "2024-01-15",
        checkOutDate: "2024-01-17",
        status: .confirmed,
        roomID: nil,
        roomNumber: nil,
        roomType: "Standard",
        adults: 2,
        children: 0,
        thirdPartyIdentifier: nil,
        balance: nil,
        isBNSFCrew: false,
        employeeId: nil,
        crewId: nil
    ))
}

