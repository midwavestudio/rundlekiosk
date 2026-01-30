# Browser Console Tests – Response Logs

Open your kiosk app in the browser (e.g. `http://localhost:3000`), press **F12** → **Console** tab, paste one of the blocks below, and press **Enter**. Responses will log in the console.

---

## Copy this: Full test with response logs

Paste this entire block into the browser console and press Enter. It will call the available-rooms API and log the full response.

```javascript
(async function testAppWithLogs() {
  const base = window.location.origin;
  console.log('=== Kiosk API Test ===');
  console.log('Origin:', base);

  // 1) Available rooms (what the dropdown uses)
  try {
    const url = base + '/api/available-rooms';
    console.log('\n--- GET ' + url + ' ---');
    const res = await fetch(url);
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response (full):', data);
    console.log('Method:', data.method);
    console.log('Check-in:', data.checkIn, 'Check-out:', data.checkOut);
    console.log('Rooms count:', data.count);
    console.table(data.rooms || []);
    if (data.note) console.warn('Note:', data.note);
  } catch (e) {
    console.error('Available rooms error:', e);
  }

  // 2) Optional: Cloudbeds test endpoint (raw API responses)
  try {
    const testUrl = base + '/api/test-cloudbeds';
    console.log('\n--- GET ' + testUrl + ' ---');
    const testRes = await fetch(testUrl);
    const testData = await testRes.json();
    console.log('Status:', testRes.status);
    console.log('Response (full):', testData);
    if (testData.tests) {
      testData.tests.forEach(function(t, i) {
        console.log('Test ' + (i + 1) + ':', t.endpoint, 'Status:', t.status);
        if (t.parsed) console.log('  Parsed:', t.parsed);
      });
    }
  } catch (e) {
    console.error('Test-cloudbeds error:', e);
  }

  console.log('\n=== Done ===');
})();
```

---

## 1. Test today’s available rooms only (same as the dropdown)

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
