# Check-In Response Logs for Developers

When a guest selects a specific room (e.g. 324 or 325) but Cloudbeds assigns a different room (e.g. 101), the developer needs a **response trail** — the actual API requests and responses from Cloudbeds — to see what’s going on.

## What the developer needs

A single JSON object that includes:

1. **What room you selected** – e.g. `324`
2. **Step 1 – getRooms** – List of rooms returned by Cloudbeds (order and IDs)
3. **Step 2 – room_match** – Which room the app matched (e.g. `actualRoomID`, `roomTypeID`)
4. **Step 3 – postReservation** – Request (room type, dates) and Cloudbeds’ response (e.g. `reservationID`)
5. **Step 4 – postRoomAssign** – Request (`newRoomID` = room to assign) and Cloudbeds’ full response
6. **Step 5 – putReservation** – Check-in status update response

From that, they can see whether:

- The app is matching the wrong room (e.g. 101 instead of 324)
- Cloudbeds is rejecting or ignoring the room-assign call
- The reservation is created with a room already set, and assign isn’t overriding it

## Chrome console script (recommended – same style as before)

Use this when the room assignment is wrong. **Change `roomName` to the room that gets ignored** (e.g. `'324'` or `'325'`), then paste in the Chrome console and press Enter. The response will include a `debugTrail` with the full Cloudbeds request/response log. Copy the printed JSON and send it to your developer.

1. Open the kiosk app in **Chrome** (e.g. https://rundlekiosk.vercel.app).
2. Press **F12** → **Console** tab.
3. **Paste this** (edit the `roomName` if needed), then press Enter:

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

4. **Copy the JSON** that appears in the console (right‑click → Copy, or select and copy) and send it to your developer. The `debugTrail` inside it is the response log they need.

**Important:** Use **`/api/cloudbeds-checkin`** (production) with **`debug: true`** and set **`roomName`** to the room that’s being ignored (e.g. `'324'`). Do **not** use `/api/test-checkin` for this — that’s a different endpoint and doesn’t return the same debug trail or use the same code path as the real check-in.

---

## Alternative: intercept script (captures a real form submission)

If you prefer to use the actual check-in form instead of the fetch above, paste this **before** submitting. It will add `debug: true` to your form’s request and log the full response (including `debugTrail`).

1. Open the kiosk app in **Chrome**.
2. Press **F12** → **Console** tab.
3. **Paste this entire script** and press Enter:

```javascript
(function() {
  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    var u = typeof url === 'string' ? url : (url && url.url);
    if (u && u.indexOf('/api/cloudbeds-checkin') !== -1 && opts && opts.method === 'POST' && opts.body) {
      try {
        var body = JSON.parse(opts.body);
        body.debug = true;
        opts = { ...opts, body: JSON.stringify(body) };
      } catch (e) {}
    }
    return origFetch.apply(this, arguments).then(function(res) {
      var clone = res.clone();
      if (u && u.indexOf('/api/cloudbeds-checkin') !== -1 && opts && opts.method === 'POST') {
        clone.json().then(function(data) {
          console.log('=== CHECK-IN RESPONSE LOG (copy below for developer) ===');
          console.log(JSON.stringify(data, null, 2));
          console.log('=== END LOG ===');
          if (data.debugTrail) {
            console.log('Debug trail captured. Copy the JSON above and send to your developer.');
          }
        }).catch(function() {});
      }
      return res;
    });
  };
  console.log('Debug capture is ON. Do a check-in now (e.g. room 324). The response will be logged here.');
})();
```

4. **Do the check-in** — select the problematic room (e.g. 324 or 325) and click **Complete Check-In**.
5. In the console, copy the JSON between the `===` lines and send it to your developer.

---

## How to capture the trail (on the kiosk app)

1. **Reproduce the issue**
   - Go through check-in and **select the room that gets ignored** (e.g. 324 or 325).

2. **Turn on debug capture**
   - Before submitting, check the box:  
     **“Capture response log for developer (use when room assignment is wrong)”**

3. **Submit the form**
   - Complete check-in as usual (even if the wrong room is assigned).

4. **Copy the log**
   - After the request finishes, a “Response log for developer” section appears.
   - Click **“Copy to clipboard”**.
   - Paste the content into an email or file and send it to your developer.

5. **Optional – send as file**
   - Paste into a text editor, save as `checkin-debug-324.json` (or similar), and attach it.

## What’s in the log (for the developer)

The JSON has a `response` object with a `debugTrail` array. Each entry has:

- **step** – e.g. `1_getRooms_response`, `2_room_match`, `3_postReservation_request`, `4_postRoomAssign_request`, `4_postRoomAssign_response`, `5_putReservation_response`
- **request** / **response** – Sanitized request (no API keys) and the response body from Cloudbeds

Key things to check:

- In **2_room_match**: `roomKey` (what the app sent), `actualRoomID` (what the app resolved), `selectedRoomName`.
- In **4_postRoomAssign_request**: `body.newRoomID` (should be the room you selected, e.g. 324).
- In **4_postRoomAssign_response**: `body.success` and any `body.message` or error from Cloudbeds.

## Capturing without the checkbox (e.g. from browser dev tools)

If the checkbox isn’t available (e.g. different build), you can still capture a trail by sending `debug: true` in the request body:

1. Open browser DevTools → **Network**.
2. Perform check-in and select the problematic room (e.g. 324).
3. Find the request to `/api/cloudbeds-checkin` (method POST).
4. Right‑click → **Copy** → **Copy as cURL** (or use “Edit and Resend” if your browser supports it).
5. Add to the JSON body: `"debug": true` (next to the other fields like `firstName`, `lastName`, `roomName`, etc.).
6. Resend the request.
7. In the response, copy the full JSON (it will include `debugTrail`).

Send that response (or the `debugTrail` part) to your developer.
