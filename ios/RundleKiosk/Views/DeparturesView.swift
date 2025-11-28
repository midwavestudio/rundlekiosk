//
//  DeparturesView.swift
//  RundleKiosk
//
//  Today's departures list view
//

import SwiftUI

struct DeparturesView: View {
    @StateObject private var viewModel = DeparturesViewModel()
    @State private var searchText = ""
    @State private var showBNSFOnly = false
    @State private var selectedReservation: Reservation?
    
    var body: some View {
        NavigationView {
            VStack {
                // Filters
                HStack {
                    Toggle("BNSF Crew Only", isOn: $showBNSFOnly)
                        .padding(.horizontal)
                }
                .padding(.vertical, 8)
                
                // Departures list
                if viewModel.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if filteredDepartures.isEmpty {
                    EmptyStateView(
                        icon: "calendar.badge.checkmark",
                        message: "No departures today"
                    )
                } else {
                    List(filteredDepartures) { reservation in
                        DepartureRow(reservation: reservation)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedReservation = reservation
                            }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Today's Departures")
            .searchable(text: $searchText, prompt: "Search by name or room")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { Task { await viewModel.refresh() } }) {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .refreshable {
                await viewModel.refresh()
            }
            .sheet(item: $selectedReservation) { reservation in
                if reservation.status == .checkedIn && reservation.canCheckOut {
                    CheckOutView(reservation: reservation)
                } else {
                    ReservationDetailView(reservation: reservation)
                }
            }
            .task {
                await viewModel.loadDepartures()
            }
        }
        .navigationViewStyle(.stack)
    }
    
    var filteredDepartures: [Reservation] {
        var departures = viewModel.departures
        
        if showBNSFOnly {
            departures = departures.filter { $0.isBNSFCrew }
        }
        
        if !searchText.isEmpty {
            departures = departures.filter { reservation in
                reservation.displayName.localizedCaseInsensitiveContains(searchText) ||
                reservation.roomNumber?.localizedCaseInsensitiveContains(searchText) == true ||
                reservation.reservationID.localizedCaseInsensitiveContains(searchText)
            }
        }
        
        return departures
    }
}

struct DepartureRow: View {
    let reservation: Reservation
    
    var body: some View {
        HStack(spacing: 12) {
            // Initial avatar
            ZStack {
                Circle()
                    .fill(Color.orange.opacity(0.2))
                    .frame(width: 45, height: 45)
                
                Text(String(reservation.displayName.prefix(1)))
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundColor(.orange)
            }
            
            // Reservation info
            VStack(alignment: .leading, spacing: 4) {
                Text(reservation.displayName)
                    .font(.headline)
                
                HStack(spacing: 16) {
                    if let roomNumber = reservation.roomNumber {
                        Label(roomNumber, systemImage: "bed.double")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    if let balance = reservation.balance, balance > 0 {
                        Label("Balance: $\(String(format: "%.2f", balance))", systemImage: "dollarsign.circle")
                            .font(.caption)
                            .foregroundColor(.red)
                    } else {
                        Label("Paid", systemImage: "checkmark.circle")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                    
                    if reservation.isBNSFCrew {
                        Label("BNSF", systemImage: "train.side.front.car")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }
            }
            
            Spacer()
            
            // Action indicator
            if reservation.canCheckOut {
                Image(systemName: "arrow.up.circle.fill")
                    .foregroundColor(.orange)
            } else {
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundColor(.red)
            }
        }
        .padding(.vertical, 8)
    }
}

#Preview {
    DeparturesView()
}

