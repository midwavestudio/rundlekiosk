# Room Availability – Browser Console Test

Run this in the **browser console** (F12 → Console) while on your kiosk app (e.g. `http://localhost:3000` or your deployed URL).

## 1. Test today’s available rooms (same as the dropdown)

```javascript
(async function testAvailableRooms() {
  const base = window.location.origin;
  console.log('Testing:', base + '/api/available-rooms');
  const res = await fetch(base + '/api/available-rooms');
  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Method used:', data.method);
  console.log('Check-in date:', data.checkIn);
  console.log('Check-out date:', data.checkOut);
  console.log('Count:', data.count);
  console.table(data.rooms || []);
  if (data.note) console.warn('Note:', data.note);
  return data;
})();
```

## 2. Test a specific date (e.g. tomorrow)

```javascript
const date = '2025-01-28'; // change to desired YYYY-MM-DD
(async function testDate() {
  const base = window.location.origin;
  const url = base + '/api/available-rooms?date=' + date;
  console.log('Testing:', url);
  const res = await fetch(url);
  const data = await res.json();
  console.log('Method:', data.method, '| Count:', data.count);
  console.table(data.rooms || []);
  return data;
})();
```

## 3. Compare app list vs Cloudbeds (if you have a test endpoint)

```javascript
(async function compare() {
  const base = window.location.origin;
  const app = await fetch(base + '/api/available-rooms').then(r => r.json());
  const roomNames = (app.rooms || []).map(r => r.roomName).sort();
  console.log('App available rooms (' + app.method + '):', roomNames.length);
  console.log(roomNames);
  console.log('Sample:', app.rooms?.[0]);
  return { method: app.method, count: app.count, roomNames };
})();
```

Copy any block above into the console and press Enter. Use **#1** to verify what the dropdown sees; use **#2** to test a specific date.
