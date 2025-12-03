# Guest Self-Service Kiosk Guide

## Overview

The Rundle Kiosk has been transformed into a **guest-facing self-service check-in/check-out system**. Guests can now check themselves in and out without staff intervention.

## Features

### ✅ What's Changed

1. **No Authentication Required** - Guests can use the kiosk immediately without logging in
2. **Simple Home Screen** - Two clear options: Check In or Check Out
3. **Guest Check-In** - Comprehensive form for BNSF crew members
4. **Guest Check-Out** - Smart search with name autocomplete
5. **Timestamp Tracking** - All check-ins and check-outs are timestamped
6. **iPad Optimized** - Works perfectly in both portrait and landscape orientations

### 🚀 Guest Flow

#### Check-In Flow
1. Guest taps "Check In" on home screen
2. Fills out required information:
   - First Name
   - Last Name
   - CLC Number
   - Phone Number (auto-formatted)
   - Class: TYE or MOW
3. Taps "Complete Check-In"
4. Sees success message
5. Automatically returns to home screen after 3 seconds

#### Check-Out Flow
1. Guest taps "Check Out" on home screen
2. Starts typing their name
3. System shows matching guests in real-time
4. Guest selects their name from the list
5. Taps "Confirm Check-Out"
6. Sees thank you message
7. Automatically returns to home screen after 3 seconds

## Data Storage

### Current Implementation (MVP)
- **Check-Ins**: Stored in `localStorage` under key `checkedInGuests`
- **Check-Outs**: Stored in `localStorage` under key `checkOutHistory`
- **Persistence**: Data survives page refresh and browser restart

### Data Structure

#### Check-In Record
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "clcNumber": "CLC12345",
  "phoneNumber": "(555) 123-4567",
  "class": "TYE",
  "checkInTime": "2025-12-02T10:30:00.000Z"
}
```

#### Check-Out Record (includes check-in data plus)
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "clcNumber": "CLC12345",
  "phoneNumber": "(555) 123-4567",
  "class": "TYE",
  "checkInTime": "2025-12-02T10:30:00.000Z",
  "checkOutTime": "2025-12-03T08:15:00.000Z"
}
```

### Future Implementation
- **Firebase Firestore**: All data will sync to Firebase for:
  - Cloud backup
  - Multi-device access
  - Integration with Cloudbeds/CLC APIs
  - Staff dashboard access
  - Reporting and analytics

## Technical Details

### Key Components

1. **`app/page.tsx`** - Main kiosk home screen
   - Displays Check In / Check Out options
   - Routes to appropriate screens

2. **`app/components/GuestCheckIn.tsx`** - Check-in form
   - Form validation
   - Phone number formatting
   - Class selection (TYE/MOW)
   - Success screen

3. **`app/components/GuestCheckOut.tsx`** - Check-out search
   - Real-time search filtering
   - Guest selection
   - Check-out confirmation
   - Success screen

### Responsive Design

The kiosk is optimized for:
- **iPad Portrait** (768px - 1024px)
- **iPad Landscape** (1024px+ wide)
- Uses `clamp()` for fluid typography and spacing
- Grid layouts adapt to orientation
- Touch-friendly button sizes (minimum 44px)

### Form Features

#### Phone Number Formatting
- Auto-formats as user types
- Pattern: `(XXX) XXX-XXXX`
- Only accepts numeric input

#### Class Selection
- Visual toggle between TYE and MOW
- Large, touch-friendly buttons
- Clear active state indication

#### Name Search
- Case-insensitive search
- Matches first name, last name, or full name
- Real-time filtering as user types
- Shows all matching guests

## Testing the Kiosk

### Test Check-In
1. Navigate to `http://localhost:3000`
2. Click "Check In"
3. Fill in test data:
   - First Name: John
   - Last Name: Smith
   - CLC Number: CLC12345
   - Phone: 5551234567 (will auto-format)
   - Class: TYE
4. Click "Complete Check-In"
5. Verify success message appears

### Test Check-Out
1. Return to home screen
2. Click "Check Out"
3. Type "John" in the search box
4. See "John Smith" appear in results
5. Click on the guest card
6. Click "Confirm Check-Out"
7. Verify success message appears

### View Stored Data
Open browser console and run:
```javascript
// View checked-in guests
JSON.parse(localStorage.getItem('checkedInGuests'))

// View check-out history
JSON.parse(localStorage.getItem('checkOutHistory'))

// Clear all data (for testing)
localStorage.clear()
```

## API Integration (Future)

When Cloudbeds and CLC APIs are configured, the kiosk will:

### On Check-In
1. ✅ Save to local storage (immediate)
2. 🔄 Submit to CLC API (BNSF crew lodging system)
3. 🔄 Create/update guest in Cloudbeds
4. 🔄 Create reservation in Cloudbeds
5. 🔄 Log transaction in Firebase Firestore
6. 🔄 Send confirmation email

### On Check-Out
1. ✅ Save to local storage (immediate)
2. 🔄 Update CLC API (complete crew stay)
3. 🔄 Check balance in Cloudbeds
4. 🔄 Complete reservation in Cloudbeds
5. 🔄 Log transaction in Firebase Firestore
6. 🔄 Send receipt/thank you email

## Configuration

### Environment Variables (when APIs are ready)
```env
# Cloudbeds API
CLOUDBEDS_PROPERTY_ID=your_property_id
CLOUDBEDS_CLIENT_ID=your_client_id
CLOUDBEDS_CLIENT_SECRET=your_client_secret

# CLC (BNSF) API
CLC_API_KEY=your_clc_api_key
CLC_API_URL=https://clc.bnsf.com/api

# Firebase (already configured)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
```

## Deployment

### Current Setup (Development)
```bash
npm run dev
```
Access at: `http://localhost:3000`

### Production Deployment (Vercel)
1. Push to GitHub
2. Connect to Vercel
3. Configure environment variables
4. Deploy
5. Access at your custom domain

### Kiosk Mode (iPad)
1. Open Safari
2. Navigate to the app URL
3. Tap Share → Add to Home Screen
4. Open from home screen (full-screen mode)
5. Enable Guided Access (Settings → Accessibility)

## Troubleshooting

### No Guests Found on Check-Out
- Make sure you've checked in at least one guest first
- Check browser console for localStorage data
- Try clearing localStorage and checking in again

### Data Not Persisting
- Ensure you're using the same browser
- Check that cookies/storage are enabled
- Don't use private/incognito mode

### Form Not Submitting
- Verify all required fields are filled
- Check browser console for errors
- Ensure JavaScript is enabled

## Next Steps

To enable full API integration:

1. **Configure Cloudbeds**
   - Set up OAuth credentials
   - Add to `.env` file
   - Update API endpoints in `lib/cloudbeds.js`

2. **Configure CLC API**
   - Obtain API credentials from BNSF
   - Add to `.env` file
   - Update API endpoints in `lib/clc.js`

3. **Enable Firebase Firestore**
   - Create Firestore database
   - Set up security rules
   - Update data saving functions in components

4. **Add Error Handling**
   - Retry logic for failed API calls
   - Offline queue for network issues
   - Staff notifications for failed transactions

---

**The kiosk is now ready for guest use!** 🎉



