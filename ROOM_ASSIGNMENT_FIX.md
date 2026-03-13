# Room Assignment Fix - January 2026

## The Problem

When checking in guests and selecting specific rooms (e.g. 324 or 325), the app was ignoring the selected room and assigning the first available room of that type (e.g. 101) instead.

## Root Cause (Discovered via Debug Logs)

The Cloudbeds `postRoomAssign` API was returning an error:

```
"error": "Please provide either \"oldRoomID\" or \"roomTypeID\""
```

The app was only sending:
- `propertyID`
- `reservationID`
- `newRoomID` (the room to assign, e.g. 324)

But Cloudbeds requires **either**:
- `oldRoomID` (for reassignment from an existing room)
- **OR** `roomTypeID` (for initial assignment)

Since this is an **initial assignment** (not a reassignment), we need to include `roomTypeID`.

## The Fix

Added `roomTypeID` to the `postRoomAssign` request:

**Before:**
```typescript
assignParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
assignParams.append('reservationID', String(reservationID));
assignParams.append('newRoomID', roomIdToAssign);
```

**After:**
```typescript
assignParams.append('propertyID', CLOUDBEDS_PROPERTY_ID);
assignParams.append('reservationID', String(reservationID));
assignParams.append('newRoomID', roomIdToAssign);
assignParams.append('roomTypeID', String(roomTypeID));  // ← ADDED
```

The `roomTypeID` was already available from Step 2 (room matching), so we just needed to include it in the assignment request.

## Files Modified

1. **`lib/cloudbeds-checkin.ts`** - Added `roomTypeID` parameter to `postRoomAssign` call (main production check-in flow)
2. **`app/api/test-checkin/route.ts`** - Added `roomTypeID` parameter to `postRoomAssign` call (test endpoint)
3. **`lib/cloudbeds.js`** - Updated `assignRoom` method to accept `roomTypeID` and `oldRoomID` as optional parameters
4. **`api/checkin.js`** - Updated to pass `roomTypeID` when calling `assignRoom`

## Testing

After deploying this fix, test with the console script:

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
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
```

**Expected result:**
- `success: true`
- `roomName: "324"` (or whatever room you specified)
- In the `debugTrail`, step `4_postRoomAssign_response` should show `success: true`

## Deploy

Push to Vercel:

```bash
git add lib/cloudbeds-checkin.ts
git commit -m "Fix room assignment: add roomTypeID to postRoomAssign"
git push origin main
```

Vercel will automatically deploy the fix.

---

**Date Fixed:** March 9, 2026  
**Issue:** Room selection ignored during check-in  
**Solution:** Added required `roomTypeID` parameter to Cloudbeds postRoomAssign API call
