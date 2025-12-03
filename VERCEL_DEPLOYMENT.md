# Vercel Deployment Guide

## Environment Variables Setup

When deploying to Vercel, you need to set environment variables directly in the Vercel dashboard, **not** in `vercel.json`.

### Step 1: Go to Vercel Dashboard

1. Go to [vercel.com](https://vercel.com)
2. Select your project: `rundlekiosk`
3. Go to **Settings** → **Environment Variables**

### Step 2: Add Environment Variables

Add each of these variables for **Production**, **Preview**, and **Development**:

#### Firebase Configuration (Client-side)
```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyBcIyLp-a9YK_XLFgZv2KkldQuHNx6redI
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=kiosk-rundle.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=kiosk-rundle
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=kiosk-rundle.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=960821255140
NEXT_PUBLIC_FIREBASE_APP_ID=1:960821255140:web:42c45d0846fb78481445f1
```

#### Firebase Admin SDK (Server-side)
```
FIREBASE_PROJECT_ID=kiosk-rundle
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@kiosk-rundle.iam.gserviceaccount.com
```

**Important**: For `FIREBASE_PRIVATE_KEY`, copy the entire key from your `.env.local` file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines, and keep the `\n` newline characters.

#### Cloudbeds API Configuration
```
CLOUDBEDS_CLIENT_ID=your_client_id_here
CLOUDBEDS_CLIENT_SECRET=your_client_secret_here
CLOUDBEDS_PROPERTY_ID=your_property_id_here
CLOUDBEDS_API_KEY=your_api_key_here
CLOUDBEDS_API_URL=https://api.cloudbeds.com/api/v1.2
```

#### CLC API Configuration
```
CLC_API_KEY=your_clc_api_key_here
CLC_API_URL=https://api.clc.com/v1
```

### Step 3: Deploy

After adding all environment variables:

1. Go to **Deployments** tab
2. Click **Redeploy** on the latest deployment, or
3. Push a new commit to trigger a new deployment

## Quick Setup via Vercel CLI

Alternatively, you can set environment variables via CLI:

```bash
# Install Vercel CLI (if not already installed)
npm install -g vercel

# Login to Vercel
vercel login

# Link your project (if not already linked)
vercel link

# Add environment variables one by one
vercel env add NEXT_PUBLIC_FIREBASE_API_KEY
# Paste the value when prompted
# Select: Production, Preview, Development

vercel env add FIREBASE_PROJECT_ID
vercel env add FIREBASE_PRIVATE_KEY
vercel env add FIREBASE_CLIENT_EMAIL
vercel env add CLOUDBEDS_CLIENT_ID
vercel env add CLOUDBEDS_CLIENT_SECRET
vercel env add CLOUDBEDS_PROPERTY_ID
vercel env add CLOUDBEDS_API_KEY
vercel env add CLOUDBEDS_API_URL
vercel env add CLC_API_KEY
vercel env add CLC_API_URL
```

## Troubleshooting

### Error: "Environment Variable references Secret which does not exist"

**Solution**: This error occurs when `vercel.json` references secrets that don't exist. The `vercel.json` file has been updated to remove these references. Environment variables should be set directly in the Vercel dashboard.

### Environment Variables Not Working

1. **Check variable names**: Make sure they match exactly (case-sensitive)
2. **Check environment scope**: Ensure variables are added for the correct environment (Production/Preview/Development)
3. **Redeploy**: After adding variables, you must redeploy for them to take effect
4. **Check logs**: Go to Deployment → Functions → View Function Logs to see if variables are accessible

### Next.js Environment Variables

- Variables starting with `NEXT_PUBLIC_` are exposed to the browser
- Variables without `NEXT_PUBLIC_` are server-side only
- After adding new variables, you must redeploy

## Testing Deployment

After deployment, test your API endpoints:

```bash
# Health check
curl https://your-app.vercel.app/api/health

# Test with authentication (if required)
curl -X POST https://your-app.vercel.app/api/checkin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"reservationId": "123"}'
```

## Notes

- Environment variables set in Vercel dashboard override `.env.local` in production
- For local development, continue using `.env.local`
- Never commit `.env.local` to Git (it's in `.gitignore`)
- The `vercel.json` file no longer references environment variables - they're managed in the dashboard

