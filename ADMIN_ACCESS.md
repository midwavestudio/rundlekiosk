# 🔐 Admin Dashboard Access

## How to Access the Admin Panel

The admin/staff dashboard is now available at a separate route from the guest kiosk.

### URL
**http://localhost:3001/admin**

Or in production: **https://yourdomain.com/admin**

## What You'll See

### 1. Login Screen
- Email and password authentication
- Create account option (first time)
- Link back to guest kiosk

### 2. Dashboard (After Login)
Three tabs:
- **Dashboard** - Overview stats and system status
- **Arrivals** - All checked-in guests (from guest kiosk)
- **Departures** - Guests who checked out today

## Features

### Dashboard Tab
- **Occupied Rooms** - Current checked-in guests count
- **Available Rooms** - Remaining capacity
- **Today's Arrivals** - Check-ins today
- **Today's Departures** - Check-outs today
- **System Status** - API connection status

### Arrivals Tab
Shows all guests currently checked in:
- Guest name
- CLC number
- Class (TYE/MOW)
- Phone number
- Check-in date and time
- Room assignment status
- Search and filter by BNSF crew

**Data Source:** `localStorage.checkedInGuests`

### Departures Tab
Shows:
- Currently checked-in guests (can check out)
- Recently checked-out guests (last 10)
- Check-in and check-out timestamps
- Search and filter capabilities

**Data Sources:** 
- `localStorage.checkedInGuests` (active guests)
- `localStorage.checkOutHistory` (recent check-outs)

## Real-Time Updates

The admin dashboard automatically refreshes every 2 seconds to show:
- New guest check-ins from the kiosk
- New guest check-outs from the kiosk
- Updated statistics

## Authentication

### First Time Setup
1. Go to `/admin`
2. Click "Don't have an account? Create One"
3. Enter email and password (min 6 characters)
4. Click "Create Account"
5. You're automatically logged in

### Subsequent Logins
1. Go to `/admin`
2. Enter your email and password
3. Click "Sign In"
4. You stay logged in (persistent session)

### Logout
Click "Sign Out" button in the top right of the dashboard

## Data Flow

```
Guest Kiosk (/)
    ↓
Guest checks in
    ↓
Saved to localStorage.checkedInGuests
    ↓
Admin Dashboard (/admin)
    ↓
Shows in Arrivals tab (auto-refreshes)
```

```
Guest Kiosk (/)
    ↓
Guest checks out
    ↓
Moved to localStorage.checkOutHistory
    ↓
Admin Dashboard (/admin)
    ↓
Shows in Departures tab (auto-refreshes)
```

## Quick Access

### From Guest Kiosk
There's a link at the bottom of the admin login page to go back to the guest kiosk.

### Direct URLs
- **Guest Kiosk:** http://localhost:3001/
- **Admin Dashboard:** http://localhost:3001/admin

## Security Notes

- Admin dashboard requires authentication
- Guest kiosk has no authentication (public)
- Staff accounts are stored in Firebase Authentication
- Each staff member needs their own account
- Passwords must be at least 6 characters

## Testing

### Test Admin Access
1. Go to http://localhost:3001/admin
2. Create an account (e.g., `admin@rundlesuites.com` / `password123`)
3. Log in
4. See the dashboard with real data from guest check-ins

### Test Data Flow
1. Open guest kiosk: http://localhost:3001/
2. Check in a guest (e.g., John Smith)
3. Open admin dashboard: http://localhost:3001/admin
4. Go to Arrivals tab
5. See John Smith appear automatically!

### Test Check-Out Tracking
1. In guest kiosk, check out John Smith
2. In admin dashboard, go to Departures tab
3. See John Smith in the checked-out list

## Troubleshooting

### Can't See Guest Data
- Make sure guests have checked in via the guest kiosk
- Check browser console for errors
- Verify localStorage has data:
  ```javascript
  JSON.parse(localStorage.getItem('checkedInGuests'))
  ```

### Login Not Working
- Check Firebase configuration in `.env.local`
- Verify Firebase Authentication is enabled
- Try creating a new account

### Data Not Refreshing
- The dashboard auto-refreshes every 2 seconds
- If data doesn't appear, refresh the page manually
- Check that both tabs are using the same browser (localStorage is per-browser)

## Future Enhancements

When APIs are configured:
- Cloudbeds integration - show real reservations
- CLC API - sync BNSF crew data
- Firebase Firestore - cloud data storage
- Multi-device sync - see data across devices
- Email notifications - alerts for new check-ins
- Reporting - analytics and exports

---

**The admin dashboard is ready to use!** 🎉

Access it at: **http://localhost:3001/admin**





