# Firebase Setup Guide

## ✅ Web App Configuration (Complete)

Your Firebase web app configuration has been added to:
- `.env` file (for backend)
- `web/firebase-config.js` (for web app)

**Project ID**: `kiosk-rundle`

## ⚠️ Backend Admin SDK Setup (Required)

The backend needs Firebase Admin SDK credentials to authenticate API requests. Follow these steps:

### Step 1: Get Service Account Credentials

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: **kiosk-rundle**
3. Click the ⚙️ Settings icon → **Project settings**
4. Go to the **Service accounts** tab
5. Click **Generate new private key**
6. Click **Generate key** (this downloads a JSON file)

### Step 2: Extract Credentials from JSON

The downloaded JSON file will look like this:

```json
{
  "type": "service_account",
  "project_id": "kiosk-rundle",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@kiosk-rundle.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  ...
}
```

### Step 3: Update .env File

Open `.env` and update these two lines:

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_ACTUAL_KEY_HERE\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@kiosk-rundle.iam.gserviceaccount.com
```

**Important Notes:**
- Copy the entire `private_key` value including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
- Keep the `\n` characters (they represent newlines)
- Wrap the entire value in double quotes
- Copy the `client_email` value exactly as shown

### Step 4: Verify Setup

After updating `.env`, restart your server:

```bash
# Stop the server (Ctrl+C)
# Then restart:
npm run start:local
```

You should see:
```
✅ Firebase Admin initialized successfully
```

Instead of:
```
⚠️  Firebase not initialized: Firebase credentials not configured
```

## Current Status

✅ **Web App Config**: Complete  
✅ **Project ID**: Set to `kiosk-rundle`  
⚠️  **Admin SDK**: Needs service account credentials  

## Files Updated

1. **`.env`** - Contains your Firebase web app credentials
2. **`web/firebase-config.js`** - Web app Firebase initialization
3. **`lib/firebase.js`** - Backend Firebase Admin SDK (uses `.env` values)

## Next Steps

1. ✅ Get service account JSON from Firebase Console
2. ✅ Extract `private_key` and `client_email`
3. ✅ Update `.env` file with these values
4. ✅ Restart the server
5. ✅ Test authentication

## Testing

Once configured, test the Firebase connection:

```bash
# Health check should show Firebase initialized
curl http://localhost:3000/api/health

# Try an authenticated endpoint (will use Firebase auth)
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  http://localhost:3000/api/arrivals
```

---

**Need Help?** Check the Firebase documentation: https://firebase.google.com/docs/admin/setup



