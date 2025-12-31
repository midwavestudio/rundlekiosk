# Cloudbeds Integration Complete Setup

## Overview

The kiosk is now fully integrated with Cloudbeds PMS. When a guest checks in through the kiosk, it:

1. Fetches available rooms from Cloudbeds in real-time
2. Creates a guest profile in Cloudbeds
3. Creates a reservation for today
4. Assigns the selected room
5. Checks in the guest (sets status to "checked_in")

## What Works Now

### Guest Check-In Flow

1. **Guest opens kiosk** → Main page with "Check In" button
2. **Guest clicks "Check In"** → Form loads available rooms from Cloudbeds
3. **Room dropdown shows** → Only rooms available for today (from Cloudbeds API)
4. **Guest fills in:**
   - First Name
   - Last Name
   - CLC Number
   - Phone Number
   - **Selects Room from dropdown** (live from Cloudbeds)
   - Class (TYE/MOW)
5. **Guest clicks "Complete Check-In"** → Creates everything in Cloudbeds:
   - ✅ Guest profile created
   - ✅ Reservation created (today → tomorrow)
   - ✅ Room assigned
   - ✅ Status set to "checked_in"
6. **Success message** → "Enjoy your stay!" then returns to home

## API Endpoints

### `/api/available-rooms` (GET)
Fetches available rooms from Cloudbeds for check-in.

**Query Parameters:**
- `checkInDate` (optional) - defaults to today
- `checkOutDate` (optional) - defaults to tomorrow

**Response:**
```json
{
  "success": true,
  "rooms": [
    {
      "roomID": "123",
      "roomName": "101",
      "roomTypeName": "Standard Room"
    }
  ]
}
```

### `/api/cloudbeds-checkin` (POST)
Creates guest, reservation, assigns room, and checks in.

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

**What it does:**
1. `POST /postGuest` - Creates guest in Cloudbeds
2. `POST /postReservation` - Creates reservation
3. `POST /postRoomAssign` - Assigns the selected room
4. `PUT /putReservation` - Sets status to "checked_in"

**Response:**
```json
{
  "success": true,
  "guestID": "456",
  "reservationID": "789",
  "roomNumber": "101",
  "message": "Guest successfully checked in to Cloudbeds"
}
```

## Cloudbeds API Calls

### 1. Get Available Rooms
```
GET /getRoomsUnassigned
?propertyID={your_property_id}
&checkIn=2024-01-01
&checkOut=2024-01-02
```

### 2. Create Guest
```
POST /postGuest
{
  "propertyID": "xxx",
  "guestFirstName": "John",
  "guestLastName": "Smith",
  "guestPhone": "(555) 123-4567",
  "guestEmail": "john.smith@guest.com",
  "guestNotes": "CLC Number: 12345"
}
```

### 3. Create Reservation
```
POST /postReservation
{
  "propertyID": "xxx",
  "guestID": "456",
  "startDate": "2024-01-01",
  "endDate": "2024-01-02",
  "adults": 1,
  "children": 0,
  "roomTypeName": "Standard Room",
  "status": "confirmed"
}
```

### 4. Assign Room
```
POST /postRoomAssign
{
  "propertyID": "xxx",
  "reservationID": "789",
  "roomName": "101"
}
```

### 5. Check In Guest
```
PUT /putReservation
{
  "propertyID": "xxx",
  "reservationID": "789",
  "status": "checked_in"
}
```

## Testing the Integration

### 1. Check Environment Variables

Make sure these are set in your Vercel dashboard:

```
CLOUDBEDS_API_KEY=your_actual_api_key
CLOUDBEDS_PROPERTY_ID=your_property_id
CLOUDBEDS_API_URL=https://api.cloudbeds.com/api/v1.2
```

### 2. Test Check-In Flow

1. Open the kiosk app
2. Click "Check In"
3. Verify the room dropdown loads with actual rooms from Cloudbeds
4. Fill in all fields
5. Select a room
6. Click "Complete Check-In"
7. Wait for success message

### 3. Verify in Cloudbeds Dashboard

Log into your Cloudbeds dashboard and check:

- **Guests** → New guest profile should appear
- **Reservations** → Today's arrivals should show the new reservation
- **Room Assignment** → The selected room should be assigned
- **Status** → Reservation status should be "Checked In"

## Data Storage

### Local Storage (localStorage)
- Stores check-in data locally for admin dashboard
- Includes Cloudbeds IDs for future reference

```javascript
{
  firstName: "John",
  lastName: "Smith",
  clcNumber: "12345",
  phoneNumber: "(555) 123-4567",
  roomNumber: "101",
  class: "TYE",
  checkInTime: "2024-01-01T10:30:00.000Z",
  cloudbedsGuestID: "456",
  cloudbedsReservationID: "789"
}
```

### Cloudbeds (Source of Truth)
- Guest profiles
- Reservations
- Room assignments
- Check-in status

## Error Handling

### If Cloudbeds API is not configured:
- Falls back to mock rooms (101, 102, 201, 202)
- Check-in completes but only saves locally
- Console warning: "Cloudbeds not configured"

### If Cloudbeds API call fails:
- Shows error message to guest
- Logs error to console
- Doesn't complete check-in

### If room assignment fails:
- Logs warning but continues with check-in
- Guest and reservation are still created

## Admin Dashboard Features

### Arrivals Tab
- Shows all checked-in guests
- Displays Cloudbeds reservation ID
- "Delete" button cancels reservation in Cloudbeds

### Departures Tab
- Shows checked-in guests ready to check out
- "Check Out" button updates status in Cloudbeds
- "Delete" button cancels reservation

### Check-Out Modal
- Updates reservation status to "checked_out" in Cloudbeds
- Moves guest to check-out history

## Troubleshooting

### No rooms showing in dropdown
**Possible causes:**
- Cloudbeds API credentials not set
- No rooms available for today
- Cloudbeds API down

**Solutions:**
1. Check Vercel environment variables
2. Log into Cloudbeds and verify room availability
3. Check browser console for API errors

### Check-in fails
**Possible causes:**
- Invalid API key
- Guest already exists
- Room not available

**Solutions:**
1. Verify API credentials in Vercel
2. Check Cloudbeds API logs
3. Try a different room

### Room assignment fails but check-in succeeds
**This is normal:**
- Room assignment can fail if Cloudbeds room name doesn't match
- Guest and reservation are still created
- Manually assign room in Cloudbeds dashboard

## Next Steps

- ✅ Guest check-in creates reservation in Cloudbeds
- ✅ Room selection from available rooms
- ✅ Automatic room assignment
- ✅ Admin check-out syncs with Cloudbeds
- ✅ Admin delete cancels in Cloudbeds
- ⏳ CLC integration (future)
- ⏳ Email confirmations (future)
- ⏳ Payment processing (future)

## API Rate Limits

Cloudbeds API has rate limits:
- **Requests per minute:** Check your plan
- **Concurrent requests:** Limited

The app is designed to minimize API calls:
- Rooms fetched once on check-in page load
- Check-in creates all records in sequence
- Admin operations only call API when needed

## Security

- ✅ API keys stored as environment variables
- ✅ Server-side API calls only (Next.js API routes)
- ✅ No client-side exposure of API keys
- ✅ HTTPS required for production
- ✅ Input validation on all forms

## Support

For issues with:
- **Cloudbeds API:** Check https://developers.cloudbeds.com
- **Kiosk app:** Check browser console for errors
- **Vercel deployment:** Check deployment logs

---

**Status:** ✅ Fully integrated and ready for production use
