# Vercel Deployment Troubleshooting

## Error: "Environment Variable references Secret which does not exist"

### Solution 1: Check vercel.json

The `vercel.json` file should **NOT** reference environment variables. It should look like this:

```json
{
  "version": 2
}
```

If you see any `env` section with `@secret-name` references, remove it.

### Solution 2: Push Latest Changes

Make sure you've pushed the latest `vercel.json` changes to GitHub:

```bash
git push origin main
```

### Solution 3: Clear Vercel Cache

1. Go to Vercel Dashboard → Your Project → Settings
2. Scroll down to "Clear Build Cache"
3. Click "Clear Build Cache"
4. Redeploy your project

### Solution 4: Set Environment Variables in Dashboard

Environment variables must be set in the Vercel Dashboard, **not** in `vercel.json`:

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add each variable manually
3. Select all three environments: Production, Preview, Development
4. Click "Save"
5. **Redeploy** your project (go to Deployments → Redeploy)

### Solution 5: Verify Environment Variables

Make sure you've added **all** required variables:

**Firebase (Client-side):**
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

**Firebase (Server-side):**
- `FIREBASE_PROJECT_ID`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CLIENT_EMAIL`

**Cloudbeds:**
- `CLOUDBEDS_CLIENT_ID`
- `CLOUDBEDS_CLIENT_SECRET`
- `CLOUDBEDS_PROPERTY_ID`
- `CLOUDBEDS_API_KEY`
- `CLOUDBEDS_API_URL`

**CLC:**
- `CLC_API_KEY`
- `CLC_API_URL`

### Solution 6: Force New Deployment

After making changes:

1. Go to Deployments tab
2. Click the three dots (⋯) on the latest deployment
3. Click "Redeploy"
4. Or push a new commit to trigger automatic deployment

### Solution 7: Check Build Logs

1. Go to Deployments → Click on the failed deployment
2. Check the build logs for specific errors
3. Look for any references to missing secrets

## Still Not Working?

If you're still getting the error after trying all the above:

1. **Delete and recreate the project** in Vercel (last resort)
2. **Check for hidden files**: Make sure there's no `.vercel` folder with cached config
3. **Contact Vercel support** with the error message and deployment logs

## Quick Checklist

- [ ] `vercel.json` has no `env` section
- [ ] Latest code pushed to GitHub
- [ ] All environment variables added in Vercel Dashboard
- [ ] Variables set for all environments (Production/Preview/Development)
- [ ] Build cache cleared
- [ ] Project redeployed after adding variables

