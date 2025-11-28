# Rundle Kiosk - System Architecture

## Overview

The Rundle Kiosk is a dual check-in system that integrates Cloudbeds PMS with CLC (BNSF Crew Lodging) portal. It's built on a three-tier architecture with a native iOS app, serverless API middleware, and third-party PMS integrations.

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     iOS/iPadOS App                          │
│                   (Swift/SwiftUI)                           │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────┐        │
│  │ Dashboard  │  │  Check-In   │  │  Check-Out   │        │
│  └────────────┘  └─────────────┘  └──────────────┘        │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────┐        │
│  │  Arrivals  │  │  Departures │  │   Settings   │        │
│  └────────────┘  └─────────────┘  └──────────────┘        │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTPS / REST API
                            │ Firebase Auth Token
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Middleware API (Node.js/Express)               │
│                     Hosted on Vercel                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Check-In │  │Check-Out │  │   Rooms  │  │  Retry   │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │Arrivals  │  │Departures│  │   Auth   │                 │
│  └──────────┘  └──────────┘  └──────────┘                 │
└─────────────────────────────────────────────────────────────┘
           │                │                  │
           │                │                  │
           ▼                ▼                  ▼
    ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
    │  Cloudbeds  │  │  CLC (BNSF)  │  │   Firebase   │
    │     API     │  │     API      │  │  Firestore   │
    └─────────────┘  └──────────────┘  └──────────────┘
```

## Data Flow

### Check-In Flow

```
1. User taps "Check In" in iOS app
   ↓
2. App validates data (room assignment, guest info)
   ↓
3. App sends POST /api/checkin with Firebase token
   ↓
4. Middleware validates token via Firebase Admin SDK
   ↓
5. Middleware creates transaction log in Firestore
   ↓
6. [IF NEEDED] Middleware assigns room via Cloudbeds API
   ↓
7. Middleware updates guest data via Cloudbeds API
   ↓
8. Middleware performs check-in via Cloudbeds API
   ├─ SUCCESS → Continue
   └─ FAILURE → Abort, return error
   ↓
9. [IF BNSF CREW] Middleware performs check-in via CLC API
   ├─ SUCCESS → Mark complete
   └─ FAILURE → Queue for retry, mark partial success
   ↓
10. Middleware updates transaction log with results
    ↓
11. Middleware returns response to app
    ↓
12. App displays success/partial success to user
```

### Check-Out Flow

```
1. User taps "Check Out" in iOS app
   ↓
2. App sends POST /api/checkout with Firebase token
   ↓
3. Middleware validates token via Firebase Admin SDK
   ↓
4. Middleware creates transaction log in Firestore
   ↓
5. Middleware checks balance via Cloudbeds API
   ├─ Balance > 0 → Return error (blocked)
   └─ Balance = 0 → Continue
   ↓
6. Middleware performs check-out via Cloudbeds API
   ├─ SUCCESS → Continue
   └─ FAILURE → Abort, return error
   ↓
7. [IF BNSF CREW] Middleware performs check-out via CLC API
   ├─ SUCCESS → Mark complete
   └─ FAILURE → Queue for retry, mark partial success
   ↓
8. Middleware updates transaction log with results
   ↓
9. Middleware returns response to app
   ↓
10. App displays success/partial success to user
```

### Offline Mode Flow

```
1. App detects no network connection
   ↓
2. User performs check-in/check-out
   ↓
3. App creates PendingOperation
   ↓
4. App saves operation to UserDefaults
   ↓
5. App shows "queued for sync" message
   ↓
6. NetworkMonitor detects connection restored
   ↓
7. OfflineQueueManager automatically triggers sync
   ↓
8. For each pending operation:
   ├─ SUCCESS → Remove from queue
   └─ FAILURE → Keep in queue for next sync
```

### Retry Mechanism Flow

```
1. CLC check-in/check-out fails
   ↓
2. Middleware logs to failed_operations collection
   ├─ type: 'clc-checkin' or 'clc-checkout'
   ├─ data: operation details
   ├─ retryCount: 0
   ├─ nextRetryAt: now + 30 minutes
   └─ maxRetries: 10
   ↓
3. Background process (or manual trigger):
   ↓
4. Query failed_operations where:
   ├─ status = 'pending'
   ├─ nextRetryAt <= now
   └─ retryCount < maxRetries
   ↓
5. For each operation:
   ├─ Attempt operation
   ├─ SUCCESS → Mark complete
   └─ FAILURE → 
       ├─ Increment retryCount
       ├─ Update nextRetryAt (+30 min)
       └─ IF retryCount >= maxRetries:
           └─ Mark as 'max_retries_reached'
           └─ Send alert email
```

## API Architecture

### Endpoint Structure

```
/api
  /checkin.js          → POST /api/checkin
  /checkout.js         → POST /api/checkout
  /reservations.js     → GET /api/reservations
  /arrivals.js         → GET /api/arrivals
  /departures.js       → GET /api/departures
  /rooms.js            → GET /api/rooms
  /room-assign.js      → POST /api/room-assign
  /retry-failed.js     → POST /api/retry-failed

/lib
  /cloudbeds.js        → Cloudbeds API client
  /clc.js              → CLC API client
  /firebase.js         → Firebase admin & logging
  /middleware.js       → Auth & CORS middleware
```

### Middleware Pipeline

```
Request → CORS → Auth → Route Handler → Response
            │      │          │
            │      │          └─→ API Clients
            │      │                  ├─→ Cloudbeds
            │      │                  ├─→ CLC
            │      │                  └─→ Firebase
            │      │
            │      └─→ Firebase Auth (token validation)
            │
            └─→ CORS headers
```

## iOS App Architecture

### MVVM Pattern

```
Views
  ├─ ContentView
  ├─ LoginView
  ├─ DashboardView
  ├─ ArrivalsView
  ├─ DeparturesView
  ├─ CheckInView
  ├─ CheckOutView
  └─ SettingsView
     │
     ▼
ViewModels (ObservableObject)
  ├─ DashboardViewModel
  ├─ ArrivalsViewModel
  ├─ DeparturesViewModel
  ├─ CheckInViewModel
  └─ CheckOutViewModel
     │
     ▼
Services
  ├─ APIService (REST API calls)
  ├─ AuthenticationManager (Firebase Auth)
  ├─ NetworkMonitor (connectivity)
  └─ OfflineQueueManager (offline sync)
     │
     ▼
Models
  ├─ Reservation
  ├─ Room
  ├─ Guest
  ├─ CheckInRequest
  ├─ CheckOutRequest
  └─ API Response models
```

### State Management

```
@StateObject (View-owned state)
  └─ ViewModels

@ObservedObject (Observed external state)
  └─ Managers (Auth, Network, Queue)

@EnvironmentObject (Injected shared state)
  └─ Global managers

@Published (Observable properties)
  └─ Properties in ViewModels & Managers

@State (Local view state)
  └─ UI state (selected items, toggles)

@Binding (Two-way binding)
  └─ Form inputs
```

## Data Models

### Firestore Collections

#### transactions
```json
{
  "type": "check-in" | "check-out" | "room-assignment",
  "reservationId": "RES123",
  "userId": "firebase_user_id",
  "userEmail": "staff@hotel.com",
  "status": "initiated" | "completed" | "partial" | "failed",
  "timestamp": "2024-01-15T10:30:00Z",
  "cloudbeds": {
    "status": "success" | "failed",
    "checkIn": { "success": true, "timestamp": "..." },
    "roomAssignment": { "success": true, "roomId": "101" }
  },
  "clc": {
    "status": "success" | "failed" | "skipped",
    "checkIn": { "success": true, "timestamp": "..." }
  },
  "completedAt": "2024-01-15T10:30:15Z"
}
```

#### failed_operations
```json
{
  "type": "clc-checkin" | "clc-checkout",
  "reservationId": "RES123",
  "transactionId": "txn_abc123",
  "data": { "reservationId": "...", "roomNumber": "..." },
  "retryCount": 0,
  "maxRetries": 10,
  "nextRetryAt": "2024-01-15T11:00:00Z",
  "status": "pending" | "completed" | "max_retries_reached",
  "lastRetryAt": "2024-01-15T10:30:00Z",
  "lastError": "Connection timeout",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

## Security Architecture

### Authentication Flow

```
1. User enters credentials in iOS app
   ↓
2. App calls Firebase Auth SDK
   ↓
3. Firebase Auth validates credentials
   ↓
4. Firebase Auth returns ID token (JWT)
   ↓
5. App stores token and uses for API calls
   ↓
6. API validates token via Firebase Admin SDK
   ↓
7. API extracts user info from token
   ↓
8. API processes request with user context
```

### Security Layers

1. **Transport Security**
   - All communications over HTTPS/TLS
   - Vercel provides automatic SSL

2. **Authentication**
   - Firebase Authentication (email/password)
   - Biometric authentication (Face ID/Touch ID)
   - Token-based API authentication

3. **Authorization**
   - Role-based access (future enhancement)
   - Firestore security rules
   - API middleware validation

4. **Data Security**
   - Credentials stored in Vercel environment variables
   - Firebase service account for server-side auth
   - Sensitive data encrypted in transit

## Scalability Considerations

### Current Architecture

- **Serverless**: Auto-scales with Vercel
- **Database**: Firebase Firestore auto-scales
- **API Clients**: Stateless, horizontally scalable

### Performance Optimizations

1. **API Response Caching**
   - Cache reservation lists (5 minutes)
   - Cache room availability (2 minutes)

2. **Parallel Requests**
   - iOS app batches independent API calls
   - Middleware processes Cloudbeds/CLC in parallel (when possible)

3. **Offline-First**
   - Local data caching in iOS app
   - Operation queueing for offline scenarios

4. **Connection Pooling**
   - Axios HTTP client with keep-alive
   - Reuse connections to external APIs

## Error Handling Strategy

### Error Categories

1. **Network Errors**
   - Queue for retry (iOS offline mode)
   - Return user-friendly message

2. **Authentication Errors**
   - Refresh token automatically
   - Redirect to login if refresh fails

3. **Validation Errors**
   - Show specific field errors
   - Prevent invalid requests

4. **Business Logic Errors**
   - Balance check failed → Block checkout
   - Room not assigned → Require assignment

5. **External API Errors**
   - Cloudbeds fails → Abort operation
   - CLC fails → Continue, queue retry

### Error Logging

All errors logged to:
- Vercel console (API errors)
- Xcode console (iOS errors)
- Firestore transactions (operation outcomes)

## Monitoring & Observability

### Metrics to Monitor

1. **API Performance**
   - Response times
   - Error rates
   - Request volumes

2. **System Health**
   - Cloudbeds API availability
   - CLC API availability
   - Firebase connectivity

3. **Business Metrics**
   - Daily check-ins/check-outs
   - BNSF crew percentage
   - Failed operation count

4. **User Experience**
   - Average check-in time
   - Offline mode usage
   - Error frequency

### Logging Strategy

```
[INFO] Transaction initiated: check-in for RES123
[DEBUG] Cloudbeds API call: POST /putReservation
[SUCCESS] Cloudbeds check-in complete
[WARN] CLC check-in failed, queued for retry
[INFO] Transaction completed: partial success
```

## Deployment Architecture

### Environments

```
Development
  ├─ Local API (localhost:3000)
  ├─ iOS Simulator
  └─ Firebase Test Project

Staging (Optional)
  ├─ Vercel Preview Deployment
  ├─ TestFlight
  └─ Firebase Staging Project

Production
  ├─ Vercel Production (your-app.vercel.app)
  ├─ App Store / TestFlight
  └─ Firebase Production Project
```

### CI/CD Pipeline

```
Git Push → GitHub → Vercel
                      ├─ Install dependencies
                      ├─ Run tests (optional)
                      ├─ Build
                      └─ Deploy

                      Rollback available via:
                      └─ Vercel dashboard
```

## Future Enhancements

### Planned Features

1. **Advanced Role Management**
   - Admin vs. front desk roles
   - Permission-based access

2. **Reporting Dashboard**
   - Check-in/check-out analytics
   - BNSF crew metrics
   - Revenue reports

3. **Housekeeping Integration**
   - Room status updates
   - Cleaning schedules

4. **Guest Self-Service Kiosk**
   - QR code check-in
   - Contactless experience

5. **Push Notifications**
   - Failed operation alerts
   - Check-in reminders

### Technical Debt

- Add comprehensive unit tests
- Implement API rate limiting
- Add request validation schemas
- Improve error messages
- Add analytics tracking

---

**Architecture Version**: 1.0
**Last Updated**: 2024
**Maintainer**: Rundle Suites Hotel IT Team

