# 🏨 Rundle Kiosk - Guest Self-Service System

A modern, iPad-optimized self-service check-in/check-out kiosk for Rundle Suites Hotel, designed specifically for BNSF railway crew members.

## 🎯 What It Does

Guests can:
- ✅ Check themselves in (first/last name, CLC number, phone, class TYE/MOW)
- ✅ Check themselves out (search by name, auto-populated)
- ✅ All timestamps automatically recorded
- ✅ No login required - immediate guest access

## 🚀 Quick Start

### Run Locally
```bash
# Install dependencies (first time only)
npm install

# Start the kiosk
npm run dev
```

Open: **http://localhost:3000** (or 3001 if 3000 is in use)

### Test the Kiosk

1. **Check In a Guest:**
   - Click "Check In"
   - Fill in: John Smith, CLC12345, 5551234567, TYE
   - Click "Complete Check-In"

2. **Check Out the Guest:**
   - Click "Check Out"
   - Type "John"
   - Click on the guest
   - Click "Confirm Check-Out"

That's it! 🎉

## 📱 iPad Optimized

- Works perfectly in **portrait and landscape** modes
- Large, touch-friendly buttons (minimum 44px)
- Fluid typography using CSS `clamp()`
- Auto-formatted phone numbers
- Smart name search with real-time filtering

## 💾 Data Storage

### Current (MVP)
- Uses browser `localStorage`
- Persists across page reloads
- Check-ins stored in `checkedInGuests`
- Check-outs stored in `checkOutHistory`

### Future (when APIs configured)
- Firebase Firestore for cloud storage
- Cloudbeds PMS integration
- CLC (BNSF Crew Lodging) API integration
- Email notifications
- Staff dashboard

## 📂 Project Structure

```
rundlekiosk/
├── app/
│   ├── page.tsx                    # Home screen (Check In / Check Out)
│   ├── globals.css                 # All kiosk styles
│   ├── layout.tsx                  # Root layout
│   └── components/
│       ├── GuestCheckIn.tsx        # Check-in form
│       └── GuestCheckOut.tsx       # Check-out search
├── api/                            # Backend API endpoints (for future)
├── lib/                            # Utility functions (Firebase, APIs)
├── .env.local                      # Firebase config (client)
├── .env                            # Firebase config (server)
└── package.json                    # Dependencies & scripts
```

## 🔧 Key Features

### Guest Check-In Form
- First Name (required)
- Last Name (required)
- CLC Number (required) - BNSF crew identifier
- Phone Number (required) - auto-formats as (XXX) XXX-XXXX
- Class (required) - TYE or MOW toggle buttons
- Check-in timestamp (automatic)

### Guest Check-Out Search
- Type guest's name
- Real-time filtering (first or last name)
- Shows: Name, CLC, Class, Check-in time
- Click to select → Confirm check-out
- Check-out timestamp (automatic)

### Success Screens
- Check-in confirmation with guest name
- Check-out thank you message
- Auto-return to home after 3 seconds

## 📖 Documentation

- **[GUEST_KIOSK_GUIDE.md](./GUEST_KIOSK_GUIDE.md)** - Complete feature guide
- **[KIOSK_CHANGES_SUMMARY.md](./KIOSK_CHANGES_SUMMARY.md)** - What changed from staff dashboard
- **[START_GUEST_KIOSK.md](./START_GUEST_KIOSK.md)** - Quick start guide
- **[IPAD_OPTIMIZATION.md](./IPAD_OPTIMIZATION.md)** - Responsive design details
- **[MVP_FEATURES.md](./MVP_FEATURES.md)** - MVP showcase guide

## 🎨 Design

- Clean, modern gradient background (#667eea to #764ba2)
- White cards with rounded corners
- Large emoji icons for visual clarity
- Color-coded buttons:
  - Green for Check In (#4caf50)
  - Blue for Check Out (#2196f3)
  - Purple for submit actions (#667eea)

## 🔐 Security (Future)

When APIs are configured:
- OAuth 2.0 for Cloudbeds
- API key authentication for CLC
- Firebase Admin SDK for server operations
- Environment variables for all secrets
- HTTPS/SSL required in production

## 📦 Dependencies

### Core
- **Next.js 14** - React framework with App Router
- **React 18** - UI library
- **TypeScript** - Type safety
- **Firebase** - Authentication & Firestore (configured, not yet used)

### Dev Tools
- ESLint - Code quality
- TypeScript - Type checking

## 🚢 Deployment

### To Vercel (Recommended)
1. Push to GitHub
2. Connect to Vercel
3. Deploy automatically
4. Configure environment variables
5. Custom domain (optional)

### To Other Platforms
Works on any platform supporting Next.js:
- Netlify
- AWS Amplify
- Google Cloud Run
- Docker container

## 🔄 Future Enhancements

When external APIs are configured:

### Cloudbeds Integration
- Create/update guest profiles
- Create reservations
- Assign rooms
- Process payments
- Send confirmation emails

### CLC API Integration
- Submit crew check-ins
- Update crew status
- Complete crew lodging records

### Firebase Firestore
- Cloud data backup
- Multi-device sync
- Staff dashboard access
- Reporting and analytics

### Additional Features
- Email/SMS confirmations
- Digital room keys
- Upsell opportunities
- Guest preferences
- Loyalty program integration

## 🐛 Troubleshooting

### Port Already in Use
Next.js will automatically try the next port (3001, 3002, etc.)

### No Guests Found on Check-Out
Make sure you've checked in a guest first. Data is stored per browser.

### Clear Test Data
Open browser console (F12):
```javascript
localStorage.clear()
location.reload()
```

## 📱 iPad Kiosk Mode

1. Open Safari on iPad
2. Navigate to the app URL
3. Tap **Share** → **Add to Home Screen**
4. Open from home screen (runs full-screen)
5. **Optional:** Enable Guided Access in Settings → Accessibility

## 🔑 Environment Variables

### Required for Firebase (Already Configured)
```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

### Required for APIs (Not Yet Configured)
```env
CLOUDBEDS_PROPERTY_ID=
CLOUDBEDS_CLIENT_ID=
CLOUDBEDS_CLIENT_SECRET=
CLC_API_KEY=
CLC_API_URL=
```

## 📞 Support

For questions or issues:
1. Check the documentation files
2. Review the code comments
3. Test with mock data first
4. Contact the development team

## 📄 License

Private project for Rundle Suites Hotel

---

**Built with Next.js, React, and TypeScript**
**Optimized for iPad • Ready for Production • API-Ready Architecture**

🎉 **The kiosk is ready for guest use!**
