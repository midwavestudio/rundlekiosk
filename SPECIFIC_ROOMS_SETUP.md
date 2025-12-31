# Specific Room Numbers Setup

## Overview

The kiosk now works with **specific physical room numbers** (e.g., "Room 101", "Room 102") instead of accommodation types. Guests select an actual room number from a dropdown of available rooms.

## How It Works

### 1. Fetching Available Rooms

The `/api/available-rooms` endpoint now:

1. **Gets all reservations for today** using `getReservations`
   - Extracts occupied room IDs from the `rooms` array in each reservation
   
2. **Gets all physical rooms** using `getRooms`
   - Returns all rooms configured in your property
   
3. **Filters out occupied rooms**
   - Shows only rooms that are NOT in today's reservations
   
4. **Returns available rooms** for the dropdown

### 2. Guest Check-In Flow

1. Guest clicks "Check In"
2. Dropdown loads with **available room numbers only**
3. Guest selects a specific room (e.g., "Room 101")
4. Guest fills in their information
5. When they click "Complete Check-In":
   - Creates guest profile in Cloudbeds
   - Looks up the room type for the selected room
   - Creates reservation with that room type
   - **Assigns the specific room** using `postRoomAssign`
   - Sets status to "checked_in"

## API Calls Made

### Step 1: Get Reservations (to find occupied rooms)
```
GET /getReservations
?propertyID={your_property_id}
&checkInFrom=2024-12-31
&checkInTo=2024-12-31
```

Response includes:
```json
{
  "data": [
    {
      "reservationID": "123",
      "rooms": [
        {
          "roomID": "456",
          "roomName": "101"
        }
      ]
    }
  ]
}
```

### Step 2: Get All Rooms
```
GET /getRooms
?propertyID={your_property_id}
```

Response:
```json
{
  "data": [
    {
      "roomID": "456",
      "roomName": "101",
      "roomTypeName": "Standard Room"
    },
    {
      "roomID": "457",
      "roomName": "102",
      "roomTypeName": "Standard Room"
    }
  ]
}
```

### Step 3: Create Guest
```
POST /postGuest
{
  "propertyID": "xxx",
  "guestFirstName": "John",
  "guestLastName": "Smith",
  "guestPhone": "(555) 123-4567",
  "guestEmail": "john.smith@guest.com",
  "guestNotes": "CLC Number: 12345, Class: TYE"
}
```

### Step 4: Create Reservation
```
POST /postReservation
{
  "propertyID": "xxx",
  "guestID": "789",
  "startDate": "2024-12-31",
  "endDate": "2025-01-01",
  "adults": 1,
  "children": 0,
  "roomTypeName": "Standard Room",
  "status": "confirmed"
}
```

### Step 5: Assign Specific Room
```
POST /postRoomAssign
{
  "propertyID": "xxx",
  "reservationID": "999",
  "roomName": "101"
}
```

### Step 6: Check In
```
PUT /putReservation
{
  "propertyID": "xxx",
  "reservationID": "999",
  "status": "checked_in"
}
```

## What's Stored

### In Cloudbeds:
- Guest profile with name, phone, email
- Reservation for today → tomorrow
- **Specific room assigned** (e.g., Room 101)
- Status: "Checked In"
- Notes include CLC Number and Class

### In localStorage (for admin):
```javascript
{
  firstName: "John",
  lastName: "Smith",
  clcNumber: "12345",
  phoneNumber: "(555) 123-4567",
  roomNumber: "101",  // The specific room number
  class: "TYE",
  checkInTime: "2024-12-31T10:30:00.000Z",
  cloudbedsGuestID: "789",
  cloudbedsReservationID: "999"
}
```

## Room Availability Logic

A room is considered **available** if:
- It exists in your Cloudbeds property
- It does NOT appear in any reservation's `rooms` array for today

A room is considered **occupied** if:
- It appears in a reservation with check-in date = today
- OR it's already assigned to an active reservation

## Benefits

✅ **Guests choose exact rooms** - No ambiguity about which room they get
✅ **Real-time availability** - Only shows rooms that aren't already booked
✅ **Automatic filtering** - Occupied rooms are hidden from the dropdown
✅ **Full integration** - Room assignments sync to Cloudbeds immediately
✅ **Prevents double-booking** - Can't select a room that's already occupied

## Testing

### 1. Check Available Rooms

1. Go to your kiosk
2. Click "Check In"
3. Look at the dropdown
4. **You should see your actual room numbers** (e.g., "Room 101 (Standard Room)")
5. Only available rooms should appear

### 2. Test Check-In

1. Select a room (e.g., "Room 101")
2. Fill in guest information
3. Click "Complete Check-In"
4. Go to Cloudbeds dashboard
5. Verify:
   - Guest profile exists
   - Reservation created for today
   - **Room 101 is assigned** to the reservation
   - Status is "Checked In"

### 3. Test Availability Filtering

1. In Cloudbeds, manually create a reservation for Room 101 for today
2. Refresh the kiosk check-in page
3. **Room 101 should NOT appear** in the dropdown
4. Other available rooms should still show

## Troubleshooting

### All rooms showing as available (even occupied ones)

**Cause:** The `getReservations` call might be failing or returning unexpected data.

**Solution:**
1. Check Vercel function logs
2. Look for the "Occupied room IDs" log entry
3. Verify your API key has permission to read reservations

### No rooms showing in dropdown

**Cause:** Either no rooms configured or all rooms are occupied.

**Solution:**
1. Log into Cloudbeds → Settings → Rooms
2. Verify you have rooms configured
3. Check if all rooms have active reservations for today
4. Look at Vercel logs for API errors

### Room assignment fails but check-in succeeds

**Cause:** The `postRoomAssign` call failed, but the reservation was created.

**Solution:**
- This is handled gracefully - the reservation exists
- Staff can manually assign the room in Cloudbeds
- Check that the room name exactly matches what's in Cloudbeds

### Wrong room type assigned

**Cause:** The room lookup couldn't find the room's type.

**Solution:**
- Verify room names in Cloudbeds match exactly (case-sensitive)
- The system falls back to "Standard Room" if lookup fails
- Check Vercel logs for the "Found room type" message

## Room Data Structure

Each room in the dropdown has:

```typescript
{
  roomID: "456",           // Cloudbeds internal ID
  roomName: "101",         // The room number/name
  roomTypeName: "Standard Room"  // The accommodation type
}
```

Displayed as: **"Room 101 (Standard Room)"**

## API Credentials Required

```
CLOUDBEDS_API_KEY=cbat_Yi1C4ct6yZ5SwJUwsnMjwWv1n5FcLfW8
CLOUDBEDS_PROPERTY_ID=242902
CLOUDBEDS_API_URL=https://api.cloudbeds.com/api/v1.2
```

Make sure your API key has these permissions:
- Read reservations
- Read rooms
- Create guests
- Create reservations
- Assign rooms
- Update reservation status

## What Happens in Cloudbeds

After a guest checks in:

1. **Guest Profile** created with their information
2. **Reservation** created for today → tomorrow
3. **Room Assignment** shows the specific room (e.g., Room 101)
4. **Status** set to "Checked In"
5. **Notes** include CLC Number and Class
6. **Housekeeping** can see the room is occupied
7. **Front Desk** can see which guest is in which room

---

**Status:** ✅ Now using specific room numbers with real-time availability
**Next:** Test with your actual Cloudbeds rooms to verify the dropdown shows correctly
