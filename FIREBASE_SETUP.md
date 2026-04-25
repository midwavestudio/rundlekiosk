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

## Firestore indexes (kiosk check-ins)

Check-in records live in the **`kiosk_checkin_records`** collection. Composite indexes are defined in **`firestore.indexes.json`** at the repo root so Firestore can:

1. Look up guests by **`firstName` + `lastName` + `checkInTime`** (dedupe / upsert).
2. Query by **`checkInDateYmd`** + **`checkInTime`** when the API passes both `from` and `to` (`GET /api/checkin-records?from=YYYY-MM-DD&to=YYYY-MM-DD`).

Each new write sets **`checkInDateYmd`** (YYYY-MM-DD from the ISO check-in time) for indexed date ranges. Older documents get **`checkInDateYmd`** the next time they are updated via sync or upsert.

### Deploy indexes (Firebase CLI)

**Important:** Run each command on its own line. Do not paste several commands on one line, and do not put `# comments` on the same line as `npm install` — npm can treat `#` as a package name and fail with `EINVALIDTAGNAME`.

**Recommended (uses the CLI from this repo, no global install):**

```bash
cd /path/to/rundlekiosk
npm install
npx firebase login
npx firebase use --add
```

When prompted, pick your Firebase project (e.g. **kiosk-rundle**). That creates `.firebaserc` in the repo root.

Then deploy the indexes defined in `firestore.indexes.json`:

```bash
npm run firebase:deploy-indexes
```

**Alternative:** install the CLI globally (one line only, no comment on the same line):

```bash
npm install -g firebase-tools
```

Then `firebase login`, `firebase use --add`, and `firebase deploy --only firestore:indexes` from the repo root.

Builds can take a few minutes. Watch **Firebase Console → Firestore → Indexes** until status is **Enabled**.

If deploy reports a missing `firestore.rules` file, add a minimal `firestore.rules` in the repo and extend `firebase.json` with `"rules": "firestore.rules"` — or manage rules in the Console and use the error link Firestore shows when a query needs an index.

---

**Need Help?** Check the Firebase documentation: https://firebase.google.com/docs/admin/setup









