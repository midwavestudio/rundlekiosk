# Room Assignment Testing Script

## The Fix Applied

The code now tries **4 different approaches** to assign the specific room:

### Approach 0: Specify room during reservation creation
- Adds `rooms[0][roomID]` parameter to `postReservation` with internal roomID like `"517731-14"`
- If Cloudbeds accepts this, the room is pre-assigned and no separate assignment call is needed

Then if the room is still unassigned, it tries **3 assignment strategies** in order:

### Strategy 1: subReservationID + internal roomID
- Uses `subReservationID` from the `unassigned` array in postReservation response
- Uses internal `roomID` like `"517731-14"`
- Parameters: `subReservationID`, `newRoomID`, `roomTypeID`

### Strategy 2: reservationID + room name
- Uses main `reservationID`
- Uses room name like `"324"`
- Parameters: `reservationID`, `newRoomID`, `roomTypeID`

### Strategy 3: putReservation with roomID
- Uses `putReservation` endpoint instead of `postRoomAssign`
- Uses internal `roomID` like `"517731-14"`
- Parameters: `reservationID`, `roomID`

**The code tries each strategy until one succeeds.** If all fail, it throws an error with the last error message.

## Test Script

Run this in Chrome console on https://rundlekiosk.vercel.app:

```javascript
fetch('https://rundlekiosk.vercel.app/api/cloudbeds-checkin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    firstName: 'Test',
    lastName: 'Guest',
    phoneNumber: '(555) 123-4567',
    roomName: '324',
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
    const assign1 = d.debugTrail.find(t => t.step === '4a_postRoomAssign_attempt1_response');
    const assign2 = d.debugTrail.find(t => t.step === '4b_postRoomAssign_attempt2_response');
    const assign3 = d.debugTrail.find(t => t.step === '4c_putReservation_room_attempt3_response');
    
    console.log('\n=== ROOM MATCHING ===');
    if (roomMatch) {
      console.log('Requested room:', roomMatch.request?.roomKey);
      console.log('Matched room:', roomMatch.request?.selectedRoomName);
      console.log('Internal ID:', roomMatch.request?.actualRoomID);
      console.log('Room type:', roomMatch.request?.roomTypeID);
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

## What to Look For

1. **Success case:**
   - `success: true`
   - `roomName: "324"` (matches what you requested)
   - One of the 3 strategies shows `✅ SUCCESS`

2. **Failure case:**
   - `success: false`
   - All 3 strategies show `❌ FAILED`
   - Copy the full response and send to developer

## After Testing

If one strategy works, we can optimize the code to use only that strategy. If all fail, we may need to:
- Check if there's a different field in the room object we should use
- Contact Cloudbeds support for the correct API usage
- Use a different approach (e.g. specify room during reservation creation)
