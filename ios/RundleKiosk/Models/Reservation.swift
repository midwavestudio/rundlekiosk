//
//  Reservation.swift
//  RundleKiosk
//
//  Data models for reservations
//

import Foundation

struct Reservation: Identifiable, Codable {
    let id: String
    let reservationID: String
    let guestName: String
    let guestFirstName: String?
    let guestLastName: String?
    let guestEmail: String?
    let guestPhone: String?
    let checkInDate: String
    let checkOutDate: String
    let status: ReservationStatus
    let roomID: String?
    let roomNumber: String?
    let roomType: String?
    let adults: Int
    let children: Int
    let thirdPartyIdentifier: String?
    let balance: Double?
    let isBNSFCrew: Bool
    let employeeId: String?
    let crewId: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case reservationID
        case guestName
        case guestFirstName
        case guestLastName
        case guestEmail
        case guestPhone
        case checkInDate
        case checkOutDate
        case status
        case roomID
        case roomNumber
        case roomType
        case adults
        case children
        case thirdPartyIdentifier
        case balance
        case isBNSFCrew
        case employeeId
        case crewId
    }
    
    var displayName: String {
        return guestName.isEmpty ? "\(guestFirstName ?? "") \(guestLastName ?? "")" : guestName
    }
    
    var hasRoom: Bool {
        return roomID != nil && !roomID!.isEmpty
    }
    
    var canCheckIn: Bool {
        return status == .confirmed && hasRoom
    }
    
    var canCheckOut: Bool {
        return status == .checkedIn && (balance ?? 0) == 0
    }
}

enum ReservationStatus: String, Codable {
    case confirmed
    case checkedIn = "checked_in"
    case checkedOut = "checked_out"
    case cancelled
    case noShow = "no_show"
    
    var displayName: String {
        switch self {
        case .confirmed:
            return "Confirmed"
        case .checkedIn:
            return "Checked In"
        case .checkedOut:
            return "Checked Out"
        case .cancelled:
            return "Cancelled"
        case .noShow:
            return "No Show"
        }
    }
    
    var color: String {
        switch self {
        case .confirmed:
            return "blue"
        case .checkedIn:
            return "green"
        case .checkedOut:
            return "gray"
        case .cancelled, .noShow:
            return "red"
        }
    }
}

struct Room: Identifiable, Codable {
    let id: String
    let roomID: String
    let roomNumber: String
    let roomType: String
    let roomTypeName: String?
    let isAvailable: Bool
    let housekeepingStatus: HousekeepingStatus?
    
    var displayName: String {
        return "\(roomNumber) - \(roomTypeName ?? roomType)"
    }
}

enum HousekeepingStatus: String, Codable {
    case clean
    case dirty
    case inspected
    case outOfOrder = "out_of_order"
    
    var displayName: String {
        switch self {
        case .clean:
            return "Clean"
        case .dirty:
            return "Dirty"
        case .inspected:
            return "Inspected"
        case .outOfOrder:
            return "Out of Order"
        }
    }
}

struct Guest: Codable {
    var firstName: String
    var lastName: String
    var email: String?
    var phone: String?
    var address: String?
    var city: String?
    var state: String?
    var zip: String?
    var country: String?
    var documentType: String?
    var documentNumber: String?
    var employeeId: String?
    var crewId: String?
}

struct CheckInRequest: Codable {
    let reservationId: String
    let roomId: String?
    let guestData: Guest?
    let isBNSFCrew: Bool
    let employeeId: String?
    let crewId: String?
}

struct CheckOutRequest: Codable {
    let reservationId: String
    let isBNSFCrew: Bool
    let forceCheckOut: Bool
}

struct CheckInResponse: Codable {
    let success: Bool
    let message: String?
    let transactionId: String?
    let results: DualSystemResult?
    let balance: Double?
    let blocked: Bool?
}

struct CheckOutResponse: Codable {
    let success: Bool
    let message: String?
    let transactionId: String?
    let results: DualSystemResult?
    let balance: Double?
    let blocked: Bool?
}

struct DualSystemResult: Codable {
    let cloudbeds: SystemResult
    let clc: SystemResult
    let errors: [SystemError]?
}

struct SystemResult: Codable {
    let success: Bool
    let error: String?
    let skipped: Bool?
    let message: String?
}

struct SystemError: Codable {
    let system: String
    let step: String
    let message: String
}

