//
//  OfflineQueueManager.swift
//  RundleKiosk
//
//  Manages offline operation queue and sync
//

import Foundation

class OfflineQueueManager: ObservableObject {
    static let shared = OfflineQueueManager()
    
    @Published var pendingOperations: [PendingOperation] = []
    @Published var isSyncing = false
    
    private let queue = DispatchQueue(label: "OfflineQueue", qos: .utility)
    private let userDefaults = UserDefaults.standard
    private let queueKey = "offline_operations_queue"
    
    private init() {
        loadQueue()
        observeNetworkChanges()
    }
    
    // MARK: - Queue Management
    
    func addOperation(_ operation: PendingOperation) {
        queue.async { [weak self] in
            guard let self = self else { return }
            
            DispatchQueue.main.async {
                self.pendingOperations.append(operation)
                self.saveQueue()
            }
        }
    }
    
    func removeOperation(_ operation: PendingOperation) {
        queue.async { [weak self] in
            guard let self = self else { return }
            
            DispatchQueue.main.async {
                self.pendingOperations.removeAll { $0.id == operation.id }
                self.saveQueue()
            }
        }
    }
    
    func clearQueue() {
        pendingOperations.removeAll()
        saveQueue()
    }
    
    // MARK: - Persistence
    
    private func saveQueue() {
        do {
            let data = try JSONEncoder().encode(pendingOperations)
            userDefaults.set(data, forKey: queueKey)
        } catch {
            print("Error saving queue: \(error)")
        }
    }
    
    private func loadQueue() {
        guard let data = userDefaults.data(forKey: queueKey) else { return }
        
        do {
            pendingOperations = try JSONDecoder().decode([PendingOperation].self, from: data)
        } catch {
            print("Error loading queue: \(error)")
        }
    }
    
    // MARK: - Sync
    
    func syncPendingOperations() async {
        guard !isSyncing else { return }
        guard NetworkMonitor.shared.isConnected else { return }
        
        await MainActor.run {
            isSyncing = true
        }
        
        let operations = pendingOperations
        
        for operation in operations {
            do {
                try await processOperation(operation)
                await MainActor.run {
                    removeOperation(operation)
                }
            } catch {
                print("Error processing operation \(operation.id): \(error)")
                // Keep operation in queue for next sync attempt
            }
        }
        
        await MainActor.run {
            isSyncing = false
        }
    }
    
    private func processOperation(_ operation: PendingOperation) async throws {
        switch operation.type {
        case .checkIn:
            if let request = operation.data as? CheckInRequest {
                _ = try await APIService.shared.checkIn(request: request)
            }
        case .checkOut:
            if let request = operation.data as? CheckOutRequest {
                _ = try await APIService.shared.checkOut(request: request)
            }
        case .roomAssign:
            if let data = operation.data as? [String: String],
               let reservationId = data["reservationId"],
               let roomId = data["roomId"] {
                _ = try await APIService.shared.assignRoom(reservationId: reservationId, roomId: roomId)
            }
        }
    }
    
    // MARK: - Network Observer
    
    private func observeNetworkChanges() {
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("NetworkStatusChanged"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            if NetworkMonitor.shared.isConnected {
                Task {
                    await self?.syncPendingOperations()
                }
            }
        }
    }
}

// MARK: - Pending Operation Model

struct PendingOperation: Identifiable, Codable {
    let id: String
    let type: OperationType
    let data: CodableData
    let timestamp: Date
    let retryCount: Int
    
    enum OperationType: String, Codable {
        case checkIn
        case checkOut
        case roomAssign
    }
    
    init(id: String = UUID().uuidString, type: OperationType, data: Codable, retryCount: Int = 0) {
        self.id = id
        self.type = type
        self.data = CodableData(value: data)
        self.timestamp = Date()
        self.retryCount = retryCount
    }
}

// Type-erased wrapper for Codable data
struct CodableData: Codable {
    let value: Any
    
    init(value: Any) {
        self.value = value
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        
        if let dict = try? container.decode([String: String].self) {
            value = dict
        } else if let checkInReq = try? container.decode(CheckInRequest.self) {
            value = checkInReq
        } else if let checkOutReq = try? container.decode(CheckOutRequest.self) {
            value = checkOutReq
        } else {
            value = [:]
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        
        if let dict = value as? [String: String] {
            try container.encode(dict)
        } else if let checkInReq = value as? CheckInRequest {
            try container.encode(checkInReq)
        } else if let checkOutReq = value as? CheckOutRequest {
            try container.encode(checkOutReq)
        }
    }
}

