//
//  ArrivalsView.swift
//  RundleKiosk
//
//  Today's arrivals list view
//

import SwiftUI

struct ArrivalsView: View {
    @StateObject private var viewModel = ArrivalsViewModel()
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
                
                // Arrivals list
                if viewModel.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if filteredArrivals.isEmpty {
                    EmptyStateView(
                        icon: "calendar.badge.clock",
                        message: "No arrivals today"
                    )
                } else {
                    List(filteredArrivals) { reservation in
                        ReservationRow(reservation: reservation)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedReservation = reservation
                            }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Today's Arrivals")
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
                if reservation.status == .confirmed {
                    CheckInView(reservation: reservation)
                } else {
                    ReservationDetailView(reservation: reservation)
                }
            }
            .task {
                await viewModel.loadArrivals()
            }
        }
        .navigationViewStyle(.stack)
    }
    
    var filteredArrivals: [Reservation] {
        var arrivals = viewModel.arrivals
        
        if showBNSFOnly {
            arrivals = arrivals.filter { $0.isBNSFCrew }
        }
        
        if !searchText.isEmpty {
            arrivals = arrivals.filter { reservation in
                reservation.displayName.localizedCaseInsensitiveContains(searchText) ||
                reservation.roomNumber?.localizedCaseInsensitiveContains(searchText) == true ||
                reservation.reservationID.localizedCaseInsensitiveContains(searchText)
            }
        }
        
        return arrivals
    }
}

struct ReservationRow: View {
    let reservation: Reservation
    
    var body: some View {
        HStack(spacing: 12) {
            // Initial avatar
            ZStack {
                Circle()
                    .fill(Color.blue.opacity(0.2))
                    .frame(width: 45, height: 45)
                
                Text(String(reservation.displayName.prefix(1)))
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundColor(.blue)
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
                    } else {
                        Label("No Room", systemImage: "bed.double")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                    
                    Label("\(reservation.adults) adults", systemImage: "person.2")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    if reservation.isBNSFCrew {
                        Label("BNSF", systemImage: "train.side.front.car")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }
            }
            
            Spacer()
            
            // Action indicator
            Image(systemName: "chevron.right")
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 8)
    }
}

#Preview {
    ArrivalsView()
}

