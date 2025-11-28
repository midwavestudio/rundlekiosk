# 🚀 Get Started with Rundle Kiosk

## ✅ What's Ready

Your Rundle Kiosk Dual Check-In System is set up with:

1. ✅ Firebase web app configured
2. ✅ Backend API with Firebase Admin SDK
3. ✅ Beautiful web interface
4. ✅ Complete documentation

## Quick Start (3 Steps)

### Step 1: Create a User in Firebase

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: **kiosk-rundle**
3. Click **Authentication** in the left menu
4. Click **Users** tab
5. Click **Add user** button
6. Enter:
   - **Email**: `staff@rundlesuites.com` (or your email)
   - **Password**: Choose a secure password
7. Click **Add user**

### Step 2: Start the Backend API

Open PowerShell in the project folder and run:

```powershell
npm run start:local
```

Or double-click `start-server.bat`

You should see:
```
╔══════════════════════════════════════════════════════════╗
║     Rundle Kiosk API - Local Development Server        ║
╠══════════════════════════════════════════════════════════╣
║  Server running on: http://localhost:3000               ║
║  Health check: http://localhost:3000/api/health          ║
╚══════════════════════════════════════════════════════════╝

✅ Firebase Admin SDK initialized successfully
```

### Step 3: Open the Web App

**Option A: Simple (No server needed)**
- Just double-click `web/index.html`
- Opens directly in your browser

**Option B: With HTTP server**
```powershell
cd web
python -m http.server 8000
# Then open: http://localhost:8000
```

## Using the App

1. **Login**: Use the email and password you created in Firebase
2. **Dashboard**: See your user info and API status
3. **API Status**: Should show "Connected" when backend is running

## What You Can Do Next

### Test the API

```powershell
# Health check
curl http://localhost:3000/api/health

# Should return:
# {"status":"ok","message":"Rundle Kiosk API is running",...}
```

### Add Cloudbeds & CLC Credentials

When you're ready to connect to real PMSs, edit `.env`:

```env
# Add your real credentials:
CLOUDBEDS_API_KEY=your_actual_key
CLOUDBEDS_PROPERTY_ID=your_property_id
CLC_API_KEY=your_clc_key
```

Then restart the server.

### Explore the Features

The system includes:
- ✅ Dual check-in/check-out
- ✅ Room assignment
- ✅ Guest management
- ✅ Transaction logging
- ✅ Automatic retry for failures
- ✅ Offline mode support

## Project Structure

```
rundlekiosk/
├── web/
│   ├── index.html          ← Web app (open this!)
│   └── firebase-config.js   ← Firebase config
├── api/
│   ├── checkin.js          ← Check-in endpoint
│   ├── checkout.js         ← Check-out endpoint
│   └── ...                 ← Other endpoints
├── lib/
│   ├── cloudbeds.js        ← Cloudbeds API client
│   ├── clc.js              ← CLC API client
│   └── firebase.js         ← Firebase integration
├── server.js               ← Backend server
├── .env                    ← Your credentials (configured!)
└── package.json            ← Dependencies

Documentation/
├── README.md               ← Complete overview
├── GET_STARTED.md          ← This file
├── WEB_APP_SETUP.md        ← Web app details
├── FIREBASE_SETUP.md       ← Firebase guide
├── LOCAL_DEVELOPMENT.md    ← Development guide
└── ARCHITECTURE.md         ← System design
```

## Troubleshooting

### Can't login to web app?

- Make sure you created a user in Firebase Console
- Check browser console for errors (F12)
- Verify Firebase config in `web/index.html`

### Backend won't start?

- Check if port 3000 is available
- Make sure `npm install` was run
- Check `.env` file exists

### API shows "Offline" in web app?

- Make sure backend server is running
- Check `http://localhost:3000/api/health` works
- Look at backend server console for errors

## Common Commands

```powershell
# Install dependencies
npm install

# Start backend server
npm run start:local

# Stop server
Ctrl+C (in the server window)

# Test API
curl http://localhost:3000/api/health

# Open web app
# Just double-click web/index.html
```

## What's Next?

1. ✅ Create Firebase user (Step 1 above)
2. ✅ Start backend server (Step 2 above)
3. ✅ Open web app (Step 3 above)
4. 📝 Test login and dashboard
5. 📝 Add Cloudbeds/CLC credentials when ready
6. 📝 Deploy to production (see DEPLOYMENT.md)

## Need Help?

- **Quick Start**: This file
- **API Details**: See `README.md`
- **Setup Guide**: See `SETUP_GUIDE.md`
- **Firebase**: See `FIREBASE_SETUP.md`
- **Architecture**: See `ARCHITECTURE.md`

---

**You're all set!** 🎉

Just create a Firebase user, start the backend, and open the web app.


