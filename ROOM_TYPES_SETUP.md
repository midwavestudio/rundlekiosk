# Accommodation Types (Room Types) Setup

## What Changed

The kiosk now uses **Cloudbeds Room Types API** (also called Accommodation Types) instead of trying to fetch individual room numbers. This means guests select the **type** of accommodation (e.g., "Standard Room", "Deluxe Suite", "King Room") rather than a specific room number.

## How It Works Now

### 1. Guest Check-In Flow

1. Guest clicks "Check In"
2. App calls `/api/available-rooms` which fetches all room types from Cloudbeds using `getRoomTypes`
3. Dropdown shows your accommodation types (e.g., "Standard Room", "Deluxe Suite", etc.)
4. Guest selects a room type and fills in their information
5. When they click "Complete Check-In", the app:
   - Creates a guest profile in Cloudbeds
   - Creates a reservation with the **selected room type**
   - Sets status to "checked_in"
   - Cloudbeds will auto-assign an available room of that type

### 2. API Calls

**Get Room Types:**
```
GET /getRoomTypes?propertyID={your_property_id}
```

Returns all your accommodation types configured in Cloudbeds.

**Create Reservation with Room Type:**
```
POST /postReservation
{
  "propertyID": "xxx",
  "guestID": "456",
  "startDate": "2024-12-31",
  "endDate": "2025-01-01",
  "adults": 1,
  "children": 0,
  "roomTypeName": "Standard Room",  // The selected accommodation type
  "status": "confirmed"
}
```

**Check In:**
```
PUT /putReservation
{
  "propertyID": "xxx",
  "reservationID": "789",
  "status": "checked_in"
}
```

## Cloudbeds Room Types

### Where to Find Your Room Types

1. Log into your Cloudbeds dashboard
2. Go to **Settings** → **Property** → **Accommodation Types** (or Room Types)
3. You'll see all your configured room types
4. Each has a unique ID in the URL when you view it (e.g., `/roomTypes/123456`)

### What the API Returns

The `getRoomTypes` endpoint returns something like:

```json
{
  "success": true,
  "data": [
    {
      "roomTypeID": "123456",
      "roomTypeName": "Standard Room",
      "maxGuests": 2,
      "propertyRoomTypeID": "STD-001"
    },
    {
      "roomTypeID": "123457",
      "roomTypeName": "Deluxe Suite",
      "maxGuests": 4,
      "propertyRoomTypeID": "DLX-001"
    }
  ]
}
```

## How Cloudbeds Assigns Specific Rooms

When a guest checks in with a **room type** (not a specific room):

1. **Reservation is created** with the room type
2. **Cloudbeds automatically assigns** an available room of that type
3. **OR** your staff can manually assign a specific room in the Cloudbeds dashboard

This is standard hotel practice - guests book a "room type" and the front desk assigns the actual room.

## What's Stored

### In localStorage (for admin dashboard):
```javascript
{
  firstName: "John",
  lastName: "Smith",
  clcNumber: "12345",
  phoneNumber: "(555) 123-4567",
  roomNumber: "Standard Room",  // This is the room TYPE name
  class: "TYE",
  checkInTime: "2024-12-31T10:30:00.000Z",
  cloudbedsGuestID: "456",
  cloudbedsReservationID: "789"
}
```

Note: `roomNumber` field now actually stores the **room type name** for simplicity. The actual room number is assigned in Cloudbeds.

## Testing

### 1. Check Your Room Types in Vercel Logs

After deployment:
1. Go to Vercel dashboard
2. Open latest deployment
3. View function logs
4. Look for the `/api/available-rooms` call
5. You should see your actual room types logged

### 2. Test Check-In

1. Open your kiosk app
2. Click "Check In"
3. **Verify the dropdown shows your actual room types** (not mock rooms)
4. Select a room type
5. Fill in guest info
6. Complete check-in
7. Go to Cloudbeds → Reservations
8. Verify:
   - Guest profile exists
   - Reservation is created for today
   - Room type matches what was selected
   - Status is "Checked In"

### 3. Verify in Cloudbeds

The reservation should show:
- **Guest:** John Smith
- **Room Type:** Standard Room (or whatever was selected)
- **Dates:** Today → Tomorrow
- **Status:** Checked In
- **Notes:** Should include CLC Number and Class

## Troubleshooting

### Still seeing mock rooms?

**Check:**
1. Are environment variables set in Vercel?
   - `CLOUDBEDS_API_KEY`
   - `CLOUDBEDS_PROPERTY_ID`
2. Is the API key valid and has permissions?
3. Check Vercel function logs for API errors

### "No accommodation types available"

**Possible causes:**
1. No room types configured in Cloudbeds
2. API key doesn't have permission to access room types
3. Wrong property ID

**Solution:**
- Log into Cloudbeds
- Go to Settings → Accommodation Types
- Make sure you have at least one room type configured

### Check-in creates reservation but wrong room type

**Cause:**
- The room type name in the dropdown must **exactly match** a room type name in Cloudbeds

**Solution:**
- Check spelling/capitalization in Cloudbeds
- Room types are case-sensitive

## API Credentials Required

Make sure these are set in Vercel:

```
CLOUDBEDS_API_KEY=cbat_Yi1C4ct6yZ5SwJUwsnMjwWv1n5FcLfW8
CLOUDBEDS_PROPERTY_ID=242902
CLOUDBEDS_API_URL=https://api.cloudbeds.com/api/v1.2
```

## Benefits of This Approach

✅ **Standard hotel practice** - Guests book room types, not specific rooms
✅ **Flexible** - Staff can assign actual rooms later
✅ **Scalable** - Works with any number of rooms per type
✅ **Integrated** - Works with OTA channels (Airbnb, Vrbo, etc.)
✅ **Simpler** - No need to track individual room availability

## What Happens After Check-In

1. **In Cloudbeds:**
   - Reservation appears in today's arrivals
   - Status shows "Checked In"
   - Room type is set
   - Staff can assign specific room number if needed

2. **In Kiosk Admin:**
   - Guest appears in Arrivals tab
   - Shows the room type they selected
   - Can check them out later

3. **For the Guest:**
   - Sees "Enjoy your stay!" message
   - Returns to main screen
   - They've been successfully checked in

---

**Status:** ✅ Now using Cloudbeds Room Types API
**Next:** Monitor Vercel logs to see your actual room types loading
