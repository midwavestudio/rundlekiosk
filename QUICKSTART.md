# Quick Start Guide

Get the Rundle Kiosk Dual Check-In System up and running in 15 minutes.

## Prerequisites Checklist

- [ ] Node.js 18+ installed
- [ ] Firebase account
- [ ] Vercel account
- [ ] Cloudbeds API credentials
- [ ] CLC API credentials

## 5-Step Setup

### 1. Clone & Install (2 minutes)

```bash
git clone <your-repo-url>
cd rundlekiosk
npm install
```

### 2. Firebase Setup (5 minutes)

1. Create project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Authentication → Email/Password
3. Create Firestore database
4. Generate service account key (Settings → Service Accounts)
5. Create staff user in Authentication

### 3. Configure Environment (2 minutes)

Create `.env`:

```env
CLOUDBEDS_API_KEY=your_cloudbeds_key
CLOUDBEDS_PROPERTY_ID=your_property_id
CLC_API_KEY=your_clc_key
CLC_API_URL=https://api.clc.com/v1
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@xxx.iam.gserviceaccount.com
```

### 4. Deploy Backend (3 minutes)

```bash
# Install Vercel CLI
npm install -g vercel

# Login and deploy
vercel login
vercel

# Add environment variables
vercel env add CLOUDBEDS_API_KEY
# (repeat for all variables)

# Deploy to production
vercel --prod
```

Note your URL: `https://your-app.vercel.app`

### 5. Configure iOS App (3 minutes)

1. Download `GoogleService-Info.plist` from Firebase
2. Open `ios/RundleKiosk/RundleKiosk.xcodeproj` in Xcode
3. Add `GoogleService-Info.plist` to project
4. Install Firebase SDK (File → Add Packages → `https://github.com/firebase/firebase-ios-sdk`)
5. Update `APIConfig.swift` with your Vercel URL
6. Build and run (Cmd+R)

## Test the System

### Test Backend

```bash
# Health check
curl https://your-app.vercel.app/api/health

# Should return: {"status":"ok"}
```

### Test iOS App

1. Launch app on iPad/iPhone
2. Login with Firebase credentials
3. View Dashboard
4. Check arrivals/departures
5. Perform test check-in

## Troubleshooting

**Backend not working?**
- Check Vercel logs: `vercel logs --prod`
- Verify all env variables are set

**iOS app can't login?**
- Check Firebase user exists
- Verify GoogleService-Info.plist is added

**Can't fetch data?**
- Check API URL in APIConfig.swift
- Verify Firebase token is valid

## Next Steps

- [ ] Read [SETUP_GUIDE.md](SETUP_GUIDE.md) for detailed configuration
- [ ] Review [ARCHITECTURE.md](ARCHITECTURE.md) to understand the system
- [ ] Configure iPad as kiosk (Guided Access mode)
- [ ] Train staff on using the app
- [ ] Monitor transaction logs in Firebase

## Quick Reference

### API Endpoints

- `POST /api/checkin` - Dual check-in
- `POST /api/checkout` - Dual check-out
- `GET /api/arrivals` - Today's arrivals
- `GET /api/departures` - Today's departures
- `GET /api/rooms` - Available rooms
- `POST /api/room-assign` - Assign room

### iOS App Structure

```
RundleKiosk/
├── Views/           # UI components
├── ViewModels/      # Business logic
├── Models/          # Data models
├── Services/        # API & Auth
└── Config/          # Configuration
```

### Key Files

- `vercel.json` - Vercel configuration
- `package.json` - Node.js dependencies
- `lib/cloudbeds.js` - Cloudbeds API client
- `lib/clc.js` - CLC API client
- `lib/firebase.js` - Firebase integration

## Support Resources

- **Main Documentation**: [README.md](README.md)
- **Detailed Setup**: [SETUP_GUIDE.md](SETUP_GUIDE.md)
- **System Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md)
- **Cloudbeds API**: https://developers.cloudbeds.com/docs/check-in-upsell-upgrade
- **Firebase Docs**: https://firebase.google.com/docs
- **Vercel Docs**: https://vercel.com/docs

---

**Ready to go!** 🚀

For issues or questions, check the detailed documentation or Vercel/Firebase logs.

