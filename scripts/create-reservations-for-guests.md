# Create Reservations for Guests (Cesar, Landry, Matt, Ross, Ashlee)

**Run this in your browser console** while your kiosk app is open (e.g. `http://localhost:3000` or your deployed URL).

1. Press **F12** → **Console** tab.
2. Paste the entire script below and press **Enter**.
3. The script will create one Cloudbeds reservation per guest (room doesn’t matter). Watch the console for progress and any errors.

---

## Script (copy everything below)

```javascript
(async function createReservations() {
  const guests = [
    { firstName: 'Cesar', lastName: 'Morales' },
    { firstName: 'Landry', lastName: 'Leishman' },
    { firstName: 'Matt', lastName: 'Phillips' },
    { firstName: 'Ross', lastName: 'Ruhkamp' },
    { firstName: 'Ashlee', lastName: 'Wright' },
  ];
  const base = window.location.origin;
  const results = [];

  for (let i = 0; i < guests.length; i++) {
    const g = guests[i];
    try {
      const roomsRes = await fetch(base + '/api/available-rooms');
      const roomsData = await roomsRes.json();
      const rooms = roomsData.rooms || [];
      if (rooms.length === 0) {
        console.error('No rooms available for', g.firstName, g.lastName);
        results.push({ guest: g.firstName + ' ' + g.lastName, success: false, error: 'No rooms available' });
        continue;
      }
      const room = rooms[0];
      const body = {
        firstName: g.firstName,
        lastName: g.lastName,
        roomName: room.roomID,
        phoneNumber: '(555) 000-0000',
        email: g.firstName.toLowerCase() + '.' + g.lastName.toLowerCase() + '@guest.com',
        classType: 'TYE',
      };
      const res = await fetch(base + '/api/cloudbeds-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        console.log('Created:', g.firstName, g.lastName, '→ Room', room.roomName, '| reservationID:', data.reservationID);
        results.push({ guest: g.firstName + ' ' + g.lastName, success: true, room: room.roomName, reservationID: data.reservationID });
      } else {
        console.error('Failed:', g.firstName, g.lastName, data.error);
        results.push({ guest: g.firstName + ' ' + g.lastName, success: false, error: data.error });
      }
    } catch (e) {
      console.error('Error for', g.firstName, g.lastName, e);
      results.push({ guest: g.firstName + ' ' + g.lastName, success: false, error: e.message });
    }
  }

  console.log('Done. Summary:', results);
  return results;
})();
```

---

After it runs, check Cloudbeds: you should see one new reservation per guest, each checked in and assigned to a room.
