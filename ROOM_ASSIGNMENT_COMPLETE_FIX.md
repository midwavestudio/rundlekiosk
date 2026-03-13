# Complete Room Assignment Fix - March 9, 2026

## The Problem

When selecting specific rooms (e.g. 324, 325) during check-in, the app was ignoring the selection and assigning the first available room of that type (e.g. 101) instead.

## Root Causes Discovered

### Issue 1: Missing roomTypeID parameter
The `postRoomAssign` API was failing with:
```
"error": "Please provide either \"oldRoomID\" or \"roomTypeID\""
```

### Issue 2: Invalid Room ID format
After adding `roomTypeID`, Cloudbeds still rejected the assignment with:
```
"error": "Invalid Room ID"
```

This happened regardless of whether we sent:
- Internal room ID: `"517731-14"`
- Room name: `"324"`

## The Complete Solution

The fix now uses **multiple strategies** to ensure room assignment works:

### Strategy 0: Specify room during reservation creation
Added `rooms[0][roomID]` parameter to `postReservation` request. If Cloudbeds accepts this, the room is pre-assigned and no separate assignment call is needed.

### Strategy 1: postRoomAssign with subReservationID
If the room is still unassigned after creation:
- Uses `subReservationID` from the `unassigned` array
- Sends internal `roomID` (e.g. `"517731-14"`)
- Parameters: `subReservationID`, `newRoomID`, `roomTypeID`

### Strategy 2: postRoomAssign with reservationID and room name
- Uses main `reservationID`
- Sends room name (e.g. `"324"`)
- Parameters: `reservationID`, `newRoomID`, `roomTypeID`

### Strategy 3: putReservation with roomID
- Uses `putReservation` endpoint to update the reservation
- Sends internal `roomID`
- Parameters: `reservationID`, `roomID`

**The code tries each strategy in order until one succeeds.** If all fail, it throws an error with details.

## Files Modified

1. **`lib/cloudbeds-checkin.ts`** - Main check-in logic with multi-strategy room assignment
2. **`app/api/cloudbeds-checkin/route.ts`** - Added debug trail support
3. **`app/components/GuestCheckIn.tsx`** - Added debug capture checkbox and display
4. **`app/api/test-checkin/route.ts`** - Added `roomTypeID` parameter
5. **`lib/cloudbeds.js`** - Updated `assignRoom` method to accept optional parameters
6. **`api/checkin.js`** - Updated to pass `roomTypeID` when assigning rooms

## Debug Trail Added

The code now captures a complete request/response trail when `debug: true` is sent:

- `1_getRooms_request` / `1_getRooms_response` - All rooms from Cloudbeds
- `2_room_match` - Which room was matched for your selection
- `3_postReservation_request` / `3_postReservation_response` - Reservation creation
- `3a_postReservation_room_status` - Whether room was assigned during creation
- `4a_postRoomAssign_attempt1_request` / `4a_postRoomAssign_attempt1_response` - Strategy 1
- `4b_postRoomAssign_attempt2_request` / `4b_postRoomAssign_attempt2_response` - Strategy 2
- `4c_putReservation_room_attempt3_request` / `4c_putReservation_room_attempt3_response` - Strategy 3
- `5_putReservation_response` - Check-in status update

## Testing

### Test Script (Chrome Console)

```javascript
fetch('https://rundlekiosk.vercel.app/api/cloudbeds-checkin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    firstName: 'Test',
    lastName: 'Guest',
    phoneNumber: '(555) 123-4567',
    roomName: '517731-14',  // Use the internal roomID from available-rooms API
    debug: true
  })
}).then(r => r.json()).then(d => {
  console.log('=== FULL RESPONSE ===');
  console.log(JSON.stringify(d, null, 2));
  console.log('=== END ===');
  
  if (d.success) {
    console.log('✅ CHECK-IN SUCCESS');
    console.log('Room assigned:', d.roomName);
  } else {
    console.log('❌ CHECK-IN FAILED');
    console.log('Error:', d.error);
  }
  
  if (d.debugTrail) {
    const roomMatch = d.debugTrail.find(t => t.step === '2_room_match');
    const roomStatus = d.debugTrail.find(t => t.step === '3a_postReservation_room_status');
    const assign1 = d.debugTrail.find(t => t.step === '4a_postRoomAssign_attempt1_response');
    const assign2 = d.debugTrail.find(t => t.step === '4b_postRoomAssign_attempt2_response');
    const assign3 = d.debugTrail.find(t => t.step === '4c_putReservation_room_attempt3_response');
    
    console.log('\n=== ROOM MATCHING ===');
    if (roomMatch) {
      console.log('Requested:', roomMatch.request?.roomKey);
      console.log('Matched name:', roomMatch.request?.selectedRoomName);
      console.log('Internal ID:', roomMatch.request?.actualRoomID);
      console.log('Type ID:', roomMatch.request?.roomTypeID);
    }
    
    console.log('\n=== ROOM STATUS AFTER CREATION ===');
    if (roomStatus) {
      console.log('Has unassigned:', roomStatus.request?.hasUnassigned);
      console.log('Needs assignment:', roomStatus.request?.needsRoomAssignment);
    }
    
    console.log('\n=== ASSIGNMENT ATTEMPTS ===');
    if (assign1) {
      console.log('Strategy 1 (subReservationID + internal ID):', assign1.request?.body?.success ? '✅ SUCCESS' : '❌ FAILED - ' + assign1.request?.body?.message);
    }
    if (assign2) {
      console.log('Strategy 2 (reservationID + room name):', assign2.request?.body?.success ? '✅ SUCCESS' : '❌ FAILED - ' + assign2.request?.body?.message);
    }
    if (assign3) {
      console.log('Strategy 3 (putReservation with roomID):', assign3.request?.body?.success ? '✅ SUCCESS' : '❌ FAILED - ' + assign3.request?.body?.message);
    }
  }
});
```

### Expected Success

One of these should happen:
1. Room is assigned during reservation creation (no `unassigned` array in response)
2. One of the 3 assignment strategies succeeds

### What to Check in Cloudbeds

After running the test:
1. Go to Cloudbeds calendar
2. Find today's date
3. Look for the test reservation
4. Verify it shows **room 324** (not 101)

## Deploy

```bash
git add .
git commit -m "Fix room assignment: try multiple strategies including room specification during reservation creation"
git push origin main
```

Wait 1-2 minutes for Vercel to deploy, then run the test script.

---

**Date:** March 9, 2026  
**Status:** Ready for testing
