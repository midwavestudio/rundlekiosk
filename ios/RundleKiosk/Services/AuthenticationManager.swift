//
//  AuthenticationManager.swift
//  RundleKiosk
//
//  Firebase Authentication Manager
//

import Foundation
import FirebaseAuth
import LocalAuthentication

class AuthenticationManager: ObservableObject {
    static let shared = AuthenticationManager()
    
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var currentUserToken: String?
    @Published var errorMessage: String?
    
    private init() {
        // Check if user is already logged in
        if let user = Auth.auth().currentUser {
            self.currentUser = user
            self.isAuthenticated = true
            fetchToken()
        }
    }
    
    // MARK: - Sign In
    
    func signIn(email: String, password: String) async throws {
        do {
            let result = try await Auth.auth().signIn(withEmail: email, password: password)
            await MainActor.run {
                self.currentUser = result.user
                self.isAuthenticated = true
                self.errorMessage = nil
            }
            fetchToken()
        } catch {
            await MainActor.run {
                self.errorMessage = error.localizedDescription
            }
            throw error
        }
    }
    
    // MARK: - Sign Out
    
    func signOut() throws {
        try Auth.auth().signOut()
        self.currentUser = nil
        self.currentUserToken = nil
        self.isAuthenticated = false
    }
    
    // MARK: - Get ID Token
    
    func fetchToken() {
        currentUser?.getIDToken { [weak self] token, error in
            if let token = token {
                self?.currentUserToken = token
            } else if let error = error {
                print("Error fetching token: \(error.localizedDescription)")
            }
        }
    }
    
    func refreshToken() async throws -> String {
        guard let user = currentUser else {
            throw AuthError.notAuthenticated
        }
        
        let token = try await user.getIDToken()
        await MainActor.run {
            self.currentUserToken = token
        }
        return token
    }
    
    // MARK: - Biometric Authentication
    
    func authenticateWithBiometrics() async throws -> Bool {
        let context = LAContext()
        var error: NSError?
        
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            throw AuthError.biometricsNotAvailable
        }
        
        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: "Authenticate to access Rundle Kiosk"
            )
            return success
        } catch {
            throw AuthError.biometricsFailed
        }
    }
    
    // MARK: - Check Biometric Support
    
    func isBiometricAvailable() -> Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    }
    
    func biometricType() -> BiometricType {
        let context = LAContext()
        var error: NSError?
        
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return .none
        }
        
        switch context.biometryType {
        case .faceID:
            return .faceID
        case .touchID:
            return .touchID
        default:
            return .none
        }
    }
}

// MARK: - Auth Errors

enum AuthError: LocalizedError {
    case notAuthenticated
    case biometricsNotAvailable
    case biometricsFailed
    case invalidCredentials
    
    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "User is not authenticated"
        case .biometricsNotAvailable:
            return "Biometric authentication is not available"
        case .biometricsFailed:
            return "Biometric authentication failed"
        case .invalidCredentials:
            return "Invalid email or password"
        }
    }
}

enum BiometricType {
    case none
    case touchID
    case faceID
    
    var displayName: String {
        switch self {
        case .none:
            return "None"
        case .touchID:
            return "Touch ID"
        case .faceID:
            return "Face ID"
        }
    }
}

