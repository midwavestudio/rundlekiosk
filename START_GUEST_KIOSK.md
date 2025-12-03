# 🏨 Start the Guest Kiosk

## Quick Start

The kiosk is now running at: **http://localhost:3001**

## What You'll See

### Home Screen
Two large buttons:
- **✓ Check In** - For guests arriving
- **→ Check Out** - For guests departing

### Try It Out

#### Test Check-In
1. Open http://localhost:3001
2. Click **"Check In"**
3. Fill in:
   - First Name: John
   - Last Name: Smith
   - CLC Number: CLC12345
   - Phone: 5551234567 (auto-formats to (555) 123-4567)
   - Class: Click **TYE**
4. Click **"Complete Check-In"**
5. See success message!

#### Test Check-Out
1. Click **"← Back"** or wait 3 seconds to return home
2. Click **"Check Out"**
3. Type **"John"** in the search box
4. Click on **"John Smith"** in the results
5. Click **"Confirm Check-Out"**
6. See thank you message!

## Features

✅ **No login required** - guests use immediately
✅ **Simple interface** - only 2 options on home
✅ **Smart search** - finds guests by name as you type
✅ **Auto-formatting** - phone numbers format automatically
✅ **Timestamps** - all check-ins/outs are timestamped
✅ **iPad optimized** - works portrait & landscape
✅ **Data saved** - survives page refresh

## View Saved Data

Open browser console (F12) and run:

```javascript
// See who's checked in
JSON.parse(localStorage.getItem('checkedInGuests'))

// See checkout history
JSON.parse(localStorage.getItem('checkOutHistory'))

// Clear all data (to test again)
localStorage.clear()
location.reload()
```

## Stop the Server

Press `Ctrl+C` in the terminal

## Restart the Server

```bash
npm run dev
```

## Next Steps

1. **Test on iPad**
   - Connect iPad to same network
   - Open Safari
   - Go to `http://YOUR_COMPUTER_IP:3001`
   - Test portrait and landscape modes

2. **Deploy to Production**
   - Push to GitHub: Run `push-to-github.bat`
   - Deploy to Vercel
   - Set up custom domain
   - Configure APIs (Cloudbeds, CLC)

3. **Enable API Integration**
   - See `GUEST_KIOSK_GUIDE.md` for details

---

**The kiosk is ready for guests!** 🎉



