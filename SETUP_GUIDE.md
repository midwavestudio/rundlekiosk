# Rundle Kiosk - Complete Setup Guide

This guide will walk you through setting up the entire Dual Check-In System from scratch.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Firebase Setup](#firebase-setup)
3. [Cloudbeds API Setup](#cloudbeds-api-setup)
4. [Backend Deployment](#backend-deployment)
5. [iOS App Configuration](#ios-app-configuration)
6. [Testing](#testing)
7. [Production Deployment](#production-deployment)

## Prerequisites

Before you begin, ensure you have:

- [ ] Node.js 18+ installed
- [ ] npm or yarn package manager
- [ ] Git installed
- [ ] Xcode 15+ (macOS only, for iOS development)
- [ ] GitHub account
- [ ] Vercel account (free tier is sufficient)
- [ ] Firebase account (free tier is sufficient)
- [ ] Cloudbeds account with API access
- [ ] CLC API credentials from BNSF

## Firebase Setup

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Add project"
3. Enter project name: `rundle-kiosk`
4. Disable Google Analytics (optional)
5. Click "Create project"

### Step 2: Enable Authentication

1. In Firebase Console, click "Authentication" in left sidebar
2. Click "Get started"
3. Click "Sign-in method" tab
4. Click "Email/Password"
5. Enable "Email/Password" toggle
6. Click "Save"

### Step 3: Create Firestore Database

1. Click "Firestore Database" in left sidebar
2. Click "Create database"
3. Select "Start in production mode"
4. Choose your location (closest to your hotel)
5. Click "Enable"

### Step 4: Set Firestore Security Rules

1. Click "Rules" tab
2. Replace rules with:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow authenticated users to read/write transactions
    match /transactions/{transaction} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    // Allow authenticated users to read/write failed operations
    match /failed_operations/{operation} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

3. Click "Publish"

### Step 5: Create Service Account

1. Click Settings icon (⚙️) → "Project settings"
2. Click "Service accounts" tab
3. Click "Generate new private key"
4. Click "Generate key" (downloads JSON file)
5. **Save this file securely** - you'll need it for Vercel

### Step 6: Get iOS Configuration

1. In Project settings, scroll to "Your apps"
2. Click iOS icon
3. Enter bundle ID: `com.rundlesuites.kiosk`
4. Register app
5. Download `GoogleService-Info.plist`
6. **Save this file** - you'll add it to Xcode project

### Step 7: Create Staff User

1. Go to Authentication → Users
2. Click "Add user"
3. Enter email: `staff@rundlesuites.com`
4. Enter password (min 6 characters)
5. Click "Add user"

## Cloudbeds API Setup

### Step 1: Request API Access

1. Log into your Cloudbeds account
2. Go to [Cloudbeds API Portal](https://hotels.cloudbeds.com/connect/)
3. Click "Request API Access"
4. Fill out the form explaining your use case
5. Wait for approval (usually 1-2 business days)

### Step 2: Get API Credentials

1. Once approved, go to Settings → API Access
2. Click "Create New Application"
3. Enter application name: "Rundle Kiosk"
4. Note your:
   - Client ID
   - Client Secret
   - Property ID

### Step 3: Generate API Key

Recent Cloudbeds API versions support API Key authentication:

1. Go to Settings → API Access → API Keys
2. Click "Generate API Key"
3. Copy and save the key securely

## Backend Deployment

### Step 1: Clone Repository

```bash
git clone <your-repo-url>
cd rundlekiosk
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment Variables

Create `.env` file:

```bash
cp env.example .env
```

Edit `.env`:

```env
# Cloudbeds
CLOUDBEDS_CLIENT_ID=your_client_id_here
CLOUDBEDS_CLIENT_SECRET=your_client_secret_here
CLOUDBEDS_PROPERTY_ID=your_property_id_here
CLOUDBEDS_API_KEY=your_api_key_here
CLOUDBEDS_API_URL=https://api.cloudbeds.com/api/v1.2

# CLC
CLC_API_KEY=your_clc_api_key
CLC_API_URL=https://api.clc.com/v1

# Firebase (from service account JSON)
FIREBASE_PROJECT_ID=rundle-kiosk
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@rundle-kiosk.iam.gserviceaccount.com

NODE_ENV=development
```

**Important**: For `FIREBASE_PRIVATE_KEY`, copy from the downloaded JSON file and keep the newlines as `\n`.

### Step 4: Test Locally

```bash
npm run dev
```

Visit `http://localhost:3000/api/health` to verify it's working.

### Step 5: Deploy to Vercel

Install Vercel CLI:

```bash
npm install -g vercel
```

Login to Vercel:

```bash
vercel login
```

Link project:

```bash
vercel link
```

Add environment variables (one by one):

```bash
vercel env add CLOUDBEDS_CLIENT_ID
# Enter the value when prompted
# Select Production, Preview, and Development

vercel env add CLOUDBEDS_CLIENT_SECRET
vercel env add CLOUDBEDS_PROPERTY_ID
vercel env add CLOUDBEDS_API_KEY
vercel env add CLC_API_KEY
vercel env add CLC_API_URL
vercel env add FIREBASE_PROJECT_ID
vercel env add FIREBASE_PRIVATE_KEY
vercel env add FIREBASE_CLIENT_EMAIL
```

Deploy to production:

```bash
vercel --prod
```

Note your production URL: `https://your-app.vercel.app`

### Step 6: Verify Deployment

Test your API:

```bash
curl https://your-app.vercel.app/api/health
```

Should return: `{"status":"ok"}`

## iOS App Configuration

### Step 1: Open Xcode Project

```bash
cd ios/RundleKiosk
open RundleKiosk.xcodeproj
```

### Step 2: Add Firebase Configuration

1. In Xcode, drag `GoogleService-Info.plist` into the project
2. Ensure "Copy items if needed" is checked
3. Ensure target is selected

### Step 3: Install Firebase SDK

1. File → Add Packages
2. Enter: `https://github.com/firebase/firebase-ios-sdk`
3. Click "Add Package"
4. Select:
   - FirebaseAuth
   - FirebaseFirestore
5. Click "Add Package"

### Step 4: Update API Configuration

Open `Config/APIConfig.swift` and update:

```swift
static let baseURL = "https://your-app.vercel.app/api"
```

Replace with your actual Vercel URL.

### Step 5: Configure Signing

1. Select project in navigator
2. Select "RundleKiosk" target
3. Go to "Signing & Capabilities"
4. Select your Team
5. Update Bundle Identifier if needed

### Step 6: Build and Run

1. Select iPad simulator (recommended) or device
2. Press Cmd+R to build and run

### Step 7: Login

Use the credentials you created in Firebase:
- Email: `staff@rundlesuites.com`
- Password: (your password)

## Testing

### Test Backend Endpoints

Using the Firebase ID token from the iOS app:

```bash
# Get token from iOS app logs or use Firebase Auth REST API

# Test arrivals endpoint
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  https://your-app.vercel.app/api/arrivals

# Test rooms endpoint
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  "https://your-app.vercel.app/api/rooms?checkIn=2024-01-15&checkOut=2024-01-17"
```

### Test iOS App Features

1. **Dashboard**
   - [ ] View today's arrivals
   - [ ] View today's departures
   - [ ] See occupancy stats

2. **Arrivals**
   - [ ] View arrivals list
   - [ ] Search by name
   - [ ] Filter by BNSF crew
   - [ ] Tap to open check-in

3. **Check-In**
   - [ ] View guest details
   - [ ] Assign room (if needed)
   - [ ] Update guest info
   - [ ] Toggle BNSF crew
   - [ ] Perform check-in
   - [ ] Verify success message

4. **Check-Out**
   - [ ] View balance
   - [ ] Block if balance > 0
   - [ ] Perform check-out
   - [ ] Verify success message

5. **Offline Mode**
   - [ ] Enable Airplane mode
   - [ ] Attempt check-in
   - [ ] Verify operation queued
   - [ ] Disable Airplane mode
   - [ ] Verify auto-sync

## Production Deployment

### Step 1: Create Production Firebase Project

Create separate Firebase project for production:
- Name: `rundle-kiosk-prod`
- Follow same setup steps as above

### Step 2: Create Production Vercel Deployment

```bash
vercel --prod
```

Add production environment variables in Vercel dashboard.

### Step 3: Build Production iOS App

1. In Xcode, select "Any iOS Device (arm64)"
2. Product → Archive
3. Follow App Store submission process
4. Or use TestFlight for internal distribution

### Step 4: Monitor Logs

**Vercel Logs:**
```bash
vercel logs --prod
```

**Firebase Logs:**
- Go to Firestore Database
- View `transactions` collection
- View `failed_operations` collection

### Step 5: Set Up Monitoring

1. **Vercel Analytics**
   - Enable in Vercel dashboard
   - Monitor API performance

2. **Firebase Crashlytics** (optional)
   - Add Crashlytics to iOS app
   - Monitor app crashes

3. **Cloud Functions for Retry** (optional)
   - Deploy Cloud Function to run every 30 minutes
   - Calls `/api/retry-failed` endpoint

## Troubleshooting

### Backend Issues

**API returns 401 Unauthorized:**
- Check Firebase token is valid
- Verify token is passed in Authorization header
- Check token hasn't expired

**API returns 500 Internal Server Error:**
- Check Vercel logs: `vercel logs`
- Verify all environment variables are set
- Check Cloudbeds/CLC API credentials

**Transaction not logged in Firestore:**
- Check Firebase service account credentials
- Verify Firestore rules allow writes
- Check Vercel logs for errors

### iOS App Issues

**Can't login:**
- Verify user exists in Firebase Authentication
- Check Firebase configuration file is added
- Ensure email/password provider is enabled

**Can't fetch data:**
- Check API URL in APIConfig.swift
- Verify network connectivity
- Check authorization token is being sent

**Offline mode not working:**
- Check NetworkMonitor is initialized
- Verify OfflineQueueManager is saving to UserDefaults
- Check for errors in console logs

## Next Steps

After setup is complete:

1. [ ] Create additional staff users in Firebase
2. [ ] Configure iPad as kiosk (Guided Access)
3. [ ] Train staff on using the app
4. [ ] Monitor transaction logs
5. [ ] Set up automated backups
6. [ ] Document hotel-specific procedures

## Support

If you encounter issues:

1. Check Vercel logs: `vercel logs --prod`
2. Check Firebase Console → Firestore
3. Check Xcode console for iOS errors
4. Review this guide carefully
5. Check the main README.md for additional info

---

**Setup Complete!** 🎉

Your Dual Check-In System is now ready to use.

