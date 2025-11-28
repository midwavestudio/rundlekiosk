//
//  ContentView.swift
//  RundleKiosk
//
//  Main content view with authentication routing
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    
    var body: some View {
        Group {
            if authManager.isAuthenticated {
                MainTabView()
            } else {
                LoginView()
            }
        }
    }
}

struct MainTabView: View {
    @State private var selectedTab = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            DashboardView()
                .tabItem {
                    Label("Dashboard", systemImage: "house.fill")
                }
                .tag(0)
            
            ArrivalsView()
                .tabItem {
                    Label("Arrivals", systemImage: "arrow.down.circle.fill")
                }
                .tag(1)
            
            DeparturesView()
                .tabItem {
                    Label("Departures", systemImage: "arrow.up.circle.fill")
                }
                .tag(2)
            
            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .tag(3)
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthenticationManager.shared)
        .environmentObject(NetworkMonitor.shared)
}

