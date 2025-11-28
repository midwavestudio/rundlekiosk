//
//  DashboardView.swift
//  RundleKiosk
//
//  Main dashboard with occupancy and quick actions
//

import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var networkMonitor: NetworkMonitor
    @StateObject private var viewModel = DashboardViewModel()
    @State private var showingSearch = false
    @State private var searchText = ""
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // Network status banner
                    if !networkMonitor.isConnected {
                        OfflineBanner()
                    }
                    
                    // Quick stats
                    StatsSection(stats: viewModel.stats)
                    
                    // Quick actions
                    QuickActionsSection()
                    
                    // Today's arrivals preview
                    SectionHeader(title: "Today's Arrivals", action: {
                        // Navigate to arrivals
                    })
                    
                    if viewModel.isLoading {
                        ProgressView()
                            .padding()
                    } else if viewModel.arrivals.isEmpty {
                        EmptyStateView(
                            icon: "calendar.badge.clock",
                            message: "No arrivals today"
                        )
                    } else {
                        ForEach(viewModel.arrivals.prefix(5)) { reservation in
                            ReservationCard(reservation: reservation)
                        }
                    }
                    
                    // Today's departures preview
                    SectionHeader(title: "Today's Departures", action: {
                        // Navigate to departures
                    })
                    
                    if viewModel.departures.isEmpty {
                        EmptyStateView(
                            icon: "calendar.badge.checkmark",
                            message: "No departures today"
                        )
                    } else {
                        ForEach(viewModel.departures.prefix(5)) { reservation in
                            ReservationCard(reservation: reservation)
                        }
                    }
                    
                    // Pending operations (offline mode)
                    if !OfflineQueueManager.shared.pendingOperations.isEmpty {
                        PendingOperationsSection()
                    }
                }
                .padding()
            }
            .navigationTitle("Dashboard")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingSearch = true }) {
                        Image(systemName: "magnifyingglass")
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { viewModel.refresh() }) {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .sheet(isPresented: $showingSearch) {
                SearchView(searchText: $searchText)
            }
            .refreshable {
                await viewModel.refresh()
            }
            .task {
                await viewModel.loadData()
            }
        }
        .navigationViewStyle(.stack)
    }
}

// MARK: - Stats Section

struct StatsSection: View {
    let stats: DashboardStats
    
    var body: some View {
        VStack(spacing: 16) {
            Text("Occupancy Overview")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
            
            HStack(spacing: 16) {
                StatCard(
                    title: "Occupied",
                    value: "\(stats.occupied)",
                    color: .green,
                    icon: "checkmark.circle.fill"
                )
                
                StatCard(
                    title: "Available",
                    value: "\(stats.available)",
                    color: .blue,
                    icon: "house.fill"
                )
                
                StatCard(
                    title: "Arrivals",
                    value: "\(stats.arrivals)",
                    color: .orange,
                    icon: "arrow.down.circle.fill"
                )
                
                StatCard(
                    title: "Departures",
                    value: "\(stats.departures)",
                    color: .purple,
                    icon: "arrow.up.circle.fill"
                )
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.1), radius: 5, x: 0, y: 2)
    }
}

struct StatCard: View {
    let title: String
    let value: String
    let color: Color
    let icon: String
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(color)
            
            Text(value)
                .font(.title)
                .fontWeight(.bold)
            
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(color.opacity(0.1))
        .cornerRadius(12)
    }
}

// MARK: - Quick Actions Section

struct QuickActionsSection: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("Quick Actions")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
            
            HStack(spacing: 16) {
                QuickActionButton(
                    title: "Check In",
                    icon: "arrow.down.circle",
                    color: .green
                ) {
                    // Navigate to check-in
                }
                
                QuickActionButton(
                    title: "Check Out",
                    icon: "arrow.up.circle",
                    color: .orange
                ) {
                    // Navigate to check-out
                }
                
                QuickActionButton(
                    title: "Assign Room",
                    icon: "bed.double",
                    color: .blue
                ) {
                    // Navigate to room assignment
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.1), radius: 5, x: 0, y: 2)
    }
}

struct QuickActionButton: View {
    let title: String
    let icon: String
    let color: Color
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title)
                    .foregroundColor(color)
                
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .background(color.opacity(0.1))
            .cornerRadius(12)
        }
    }
}

// MARK: - Section Header

struct SectionHeader: View {
    let title: String
    var action: (() -> Void)? = nil
    
    var body: some View {
        HStack {
            Text(title)
                .font(.headline)
            
            Spacer()
            
            if let action = action {
                Button(action: action) {
                    Text("See All")
                        .font(.subheadline)
                        .foregroundColor(.blue)
                }
            }
        }
        .padding(.top, 8)
    }
}

// MARK: - Reservation Card

struct ReservationCard: View {
    let reservation: Reservation
    
    var body: some View {
        HStack(spacing: 16) {
            // Guest initial or icon
            ZStack {
                Circle()
                    .fill(Color.blue.opacity(0.2))
                    .frame(width: 50, height: 50)
                
                Text(String(reservation.displayName.prefix(1)))
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundColor(.blue)
            }
            
            // Reservation details
            VStack(alignment: .leading, spacing: 4) {
                Text(reservation.displayName)
                    .font(.headline)
                
                HStack {
                    Image(systemName: "calendar")
                        .font(.caption)
                    Text("\(reservation.checkInDate) - \(reservation.checkOutDate)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                if let roomNumber = reservation.roomNumber {
                    HStack {
                        Image(systemName: "bed.double")
                            .font(.caption)
                        Text("Room \(roomNumber)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                
                if reservation.isBNSFCrew {
                    Label("BNSF Crew", systemImage: "train.side.front.car")
                        .font(.caption)
                        .foregroundColor(.orange)
                }
            }
            
            Spacer()
            
            // Status badge
            StatusBadge(status: reservation.status)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 3, x: 0, y: 1)
    }
}

struct StatusBadge: View {
    let status: ReservationStatus
    
    var body: some View {
        Text(status.displayName)
            .font(.caption)
            .fontWeight(.semibold)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(statusColor.opacity(0.2))
            .foregroundColor(statusColor)
            .cornerRadius(8)
    }
    
    var statusColor: Color {
        switch status {
        case .confirmed:
            return .blue
        case .checkedIn:
            return .green
        case .checkedOut:
            return .gray
        case .cancelled, .noShow:
            return .red
        }
    }
}

// MARK: - Empty State View

struct EmptyStateView: View {
    let icon: String
    let message: String
    
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            
            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

// MARK: - Offline Banner

struct OfflineBanner: View {
    var body: some View {
        HStack {
            Image(systemName: "wifi.slash")
            Text("Offline Mode - Operations will sync when connected")
                .font(.subheadline)
        }
        .foregroundColor(.white)
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color.orange)
        .cornerRadius(12)
    }
}

// MARK: - Pending Operations Section

struct PendingOperationsSection: View {
    @ObservedObject var queueManager = OfflineQueueManager.shared
    
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "clock.arrow.circlepath")
                Text("Pending Operations")
                    .font(.headline)
                Spacer()
                Text("\(queueManager.pendingOperations.count)")
                    .font(.headline)
                    .foregroundColor(.orange)
            }
            
            ForEach(queueManager.pendingOperations) { operation in
                HStack {
                    Text(operation.type.rawValue)
                        .font(.subheadline)
                    Spacer()
                    Text(operation.timestamp, style: .time)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 4)
            }
        }
        .padding()
        .background(Color.orange.opacity(0.1))
        .cornerRadius(12)
    }
}

#Preview {
    DashboardView()
        .environmentObject(NetworkMonitor.shared)
}

