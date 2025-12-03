# Cloudbeds Integration Guide

## What's Integrated

The kiosk now automatically syncs guest check-ins with Cloudbeds PMS.

## How It Works

### Check-In Process

When a guest checks in through the kiosk:

1. **Guest Information Captured:**
   - First Name
   - Last Name
   - Phone Number
   - Room Number
   - CLC Number
   - Class (TYE/MOW)

2. **Automatic Cloudbeds Sync:**
   - Creates a new guest in Cloudbeds
   - Creates a reservation (today → tomorrow)
   - Assigns the room number entered by the guest
   - Checks in the guest (sets status to "checked_in")
   - Stores Cloudbeds Guest ID and Reservation ID locally

3. **Fallback Behavior:**
   - If Cloudbeds API is not configured, check-in continues with local storage only
   - If Cloudbeds API call fails, a warning is logged but check-in completes
   - The app is resilient to API failures

## Environment Variables Required

Make sure these are set in your Vercel dashboard (or `.env.local` for local development):

```env
CLOUDBEDS_API_KEY=your_api_key_here
CLOUDBEDS_PROPERTY_ID=your_property_id_here
CLOUDBEDS_API_URL=https://api.cloudbeds.com/api/v1.2
```

## API Endpoint

**Route:** `/api/cloudbeds-checkin`

**Method:** `POST`

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "phoneNumber": "(555) 123-4567",
  "roomNumber": "101",
  "clcNumber": "12345",
  "email": "john.smith@guest.com"
}
```

**Success Response:**
```json
{
  "success": true,
  "guestID": "123456",
  "reservationID": "789012",
  "roomNumber": "101",
  "message": "Guest successfully checked in to Cloudbeds"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Failed to check in to Cloudbeds",
  "details": "Error details here"
}
```

## What Happens in Cloudbeds

### 1. Guest Creation
```
POST /postGuest
{
  "propertyID": "your_property_id",
  "guestFirstName": "John",
  "guestLastName": "Smith",
  "guestPhone": "(555) 123-4567",
  "guestEmail": "john.smith@guest.com",
  "guestNotes": "CLC Number: 12345"
}
```

### 2. Reservation Creation
```
POST /postReservation
{
  "propertyID": "your_property_id",
  "guestID": "123456",
  "startDate": "2024-12-03",
  "endDate": "2024-12-04",
  "adults": 1,
  "children": 0,
  "roomTypeName": "Standard Room",
  "status": "confirmed"
}
```

### 3. Room Assignment
```
POST /postRoomAssign
{
  "propertyID": "your_property_id",
  "reservationID": "789012",
  "roomName": "101"
}
```

### 4. Check-In
```
PUT /putReservation
{
  "propertyID": "your_property_id",
  "reservationID": "789012",
  "status": "checked_in"
}
```

## Check-Out Improvements

### Search Functionality
- **3-letter minimum** instead of 4 letters
- Placeholder text updated to "Type your first name..."
- No character counter displayed
- Searches first name, last name, or full name

### Visual Fix
- Guest names now visible in search results
- Selected guest cards show white text on copper background
- Unselected guest cards show dark text on white background

### CSS Changes
```css
.guest-name {
  color: #333; /* Dark text on white card */
}

.guest-card.selected .guest-name {
  color: white; /* White text when selected */
}

.guest-details {
  color: #666;
}

.guest-card.selected .guest-details {
  color: rgba(255, 255, 255, 0.95);
}
```

## Testing Locally

1. **Start the development server:**
   ```bash
   npm run dev
   ```

2. **Check-in a guest:**
   - Go to http://localhost:3001
   - Click "Check In"
   - Fill in all fields including room number
   - Submit

3. **Check console logs:**
   - Open browser DevTools → Console
   - Look for "Cloudbeds check-in successful" or warnings

4. **Verify in Cloudbeds:**
   - Log into your Cloudbeds dashboard
   - Check Reservations → Today's Arrivals
   - Verify the guest appears with correct room assignment

## Troubleshooting

### Cloudbeds API not configured
**Symptom:** Console shows "Cloudbeds not configured"
**Solution:** Add environment variables to Vercel dashboard

### Guest creation fails
**Symptom:** Error "Failed to create guest in Cloudbeds"
**Possible causes:**
- Invalid API key
- Missing property ID
- Duplicate guest (email already exists)
**Solution:** Check Cloudbeds API logs and verify credentials

### Room assignment fails
**Symptom:** Console warning about room assignment
**Solution:** Verify the room name exists in Cloudbeds and is available

### Check-in fails but reservation created
**Symptom:** Reservation exists but status is not "checked_in"
**Solution:** Manually check in the guest in Cloudbeds dashboard

## Data Flow

```
Guest fills form
      ↓
Form submitted
      ↓
Call /api/cloudbeds-checkin
      ↓
Create guest in Cloudbeds → Get guestID
      ↓
Create reservation → Get reservationID
      ↓
Assign room number
      ↓
Set status to "checked_in"
      ↓
Save to localStorage with Cloudbeds IDs
      ↓
Show success message
      ↓
Return to home page
```

## Future Enhancements

- [ ] Check-out integration with Cloudbeds
- [ ] Sync with CLC API for BNSF crew
- [ ] Real-time availability check before room assignment
- [ ] Email confirmation to guest
- [ ] Receipt printing
- [ ] Integration with payment processing

## Notes

- Cloudbeds API uses Bearer token authentication
- All API calls are server-side (Next.js API routes)
- Guest email is auto-generated if not provided: `firstname.lastname@guest.com`
- Reservations are created for 1 night (today → tomorrow)
- CLC number is stored in guest notes field
- Room type is set to "Standard Room" by default

