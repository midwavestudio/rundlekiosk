# Local Development Guide

This guide will help you run the Rundle Kiosk system locally for development and testing.

## Prerequisites

- Node.js 18+ installed
- npm or yarn
- (Optional) Firebase project for authentication
- (Optional) Cloudbeds API credentials
- (Optional) CLC API credentials

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
# Copy the example file
cp env.example .env
```

Edit `.env` with your credentials. For local development, you can use mock/test values:

```env
# Cloudbeds API Configuration
CLOUDBEDS_CLIENT_ID=test_client_id
CLOUDBEDS_CLIENT_SECRET=test_client_secret
CLOUDBEDS_PROPERTY_ID=test_property_id
CLOUDBEDS_API_KEY=test_api_key
CLOUDBEDS_API_URL=https://api.cloudbeds.com/api/v1.2

# CLC (BNSF Crew Lodging) API Configuration
CLC_API_KEY=test_clc_api_key
CLC_API_URL=https://api.clc.com/v1

# Firebase Configuration (Required for authentication)
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@xxx.iam.gserviceaccount.com

# Environment
NODE_ENV=development
PORT=3000
```

**Note**: For local testing without real credentials, the API will still start but external API calls will fail. You can test the API structure and endpoints.

### 3. Start the Local Server

```bash
npm run start:local
```

Or:

```bash
node server.js
```

The server will start on `http://localhost:3000`

### 4. Test the API

Open your browser or use curl:

```bash
# Health check
curl http://localhost:3000/api/health

# Should return:
# {"status":"ok","message":"Rundle Kiosk API is running",...}
```

## API Endpoints (Local)

All endpoints are available at `http://localhost:3000/api/`:

- `GET /api/health` - Health check
- `POST /api/checkin` - Dual check-in
- `POST /api/checkout` - Dual check-out
- `GET /api/arrivals` - Today's arrivals
- `GET /api/departures` - Today's departures
- `GET /api/reservations` - Search reservations
- `GET /api/rooms` - Available rooms
- `POST /api/room-assign` - Assign room
- `POST /api/retry-failed` - Retry failed operations

## Testing with curl

### Test Health Endpoint

```bash
curl http://localhost:3000/api/health
```

### Test Arrivals (requires authentication)

```bash
# Get Firebase token first, then:
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  http://localhost:3000/api/arrivals
```

## iOS App Local Development

### 1. Update API Configuration

Open `ios/RundleKiosk/Config/APIConfig.swift` and update:

```swift
#if DEBUG
static var apiBaseURL: String {
    return "http://localhost:3000/api"  // Local development
    // return "https://your-app.vercel.app/api"  // Production
}
#else
static let apiBaseURL = "https://your-app.vercel.app/api"
#endif
```

### 2. Handle iOS Simulator Localhost

**Important**: iOS Simulator can access `localhost`, but physical devices cannot.

For **iOS Simulator**:
- Use `http://localhost:3000/api`

For **Physical Device**:
- Find your computer's local IP: `ipconfig` (Windows) or `ifconfig` (Mac)
- Use `http://YOUR_LOCAL_IP:3000/api`
- Example: `http://192.168.1.100:3000/api`

### 3. Configure Firebase

1. Download `GoogleService-Info.plist` from Firebase Console
2. Add it to your Xcode project
3. Install Firebase SDK via Swift Package Manager

### 4. Run iOS App

1. Open `ios/RundleKiosk/RundleKiosk.xcodeproj` in Xcode
2. Select a simulator or device
3. Press Cmd+R to build and run

## Troubleshooting

### Port Already in Use

If port 3000 is already in use:

```bash
# Change PORT in .env
PORT=3001

# Or kill the process using port 3000
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux:
lsof -ti:3000 | xargs kill
```

### Environment Variables Not Loading

Make sure:
1. `.env` file exists in the root directory
2. You've installed `dotenv` package (included in dependencies)
3. You're running from the root directory

### Firebase Connection Issues

If you see Firebase errors:
1. Check `FIREBASE_PRIVATE_KEY` includes `\n` for newlines
2. Verify service account credentials are correct
3. Ensure Firestore is enabled in Firebase Console

### CORS Issues

The server includes CORS middleware. If you still see CORS errors:
- Check the `corsMiddleware` in `lib/middleware.js`
- Ensure your iOS app is using the correct API URL

## Development Tips

### Hot Reload

For automatic server restart on file changes, install `nodemon`:

```bash
npm install -g nodemon
```

Then run:

```bash
nodemon server.js
```

Or add to package.json:

```json
"scripts": {
  "dev:watch": "nodemon server.js"
}
```

### Debugging

Enable debug logging:

```env
NODE_ENV=development
DEBUG=*
```

### Mock Data for Testing

You can create a mock API mode by modifying the handlers to return test data when credentials are missing. This is useful for UI development without backend dependencies.

## Next Steps

1. ✅ Server running locally
2. ✅ Test endpoints with curl/Postman
3. ✅ Configure iOS app to use local API
4. ✅ Test full check-in/check-out flow
5. ✅ Deploy to Vercel when ready

## Production vs Development

- **Development**: `npm run start:local` (uses `server.js`)
- **Production**: `vercel --prod` (uses serverless functions)

The local server (`server.js`) is for development only. Production uses Vercel's serverless functions directly.

---

**Happy coding!** 🚀







