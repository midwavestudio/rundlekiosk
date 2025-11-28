# 🚀 Quick Start - Next.js Version

Your Rundle Kiosk is now powered by Next.js 14!

## Run the App (2 Steps)

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Start Development Server

```bash
npm run dev
```

Open http://localhost:3000

## What You'll See

1. **Login Page** - Beautiful Firebase authentication
2. **Dashboard** - User info and API status
3. **Modern UI** - React components with TypeScript

## Features

- ✅ Next.js 14 with App Router
- ✅ Firebase Authentication
- ✅ TypeScript support
- ✅ Server-side rendering
- ✅ API routes built-in
- ✅ Hot module replacement
- ✅ Automatic code splitting

## Project Structure

```
app/
├── layout.tsx       ← Root layout
├── page.tsx         ← Home page (login/dashboard)
├── globals.css      ← Styles
└── api/
    └── health/
        └── route.ts ← API endpoint
```

## Available Commands

```bash
# Development
npm run dev          # Start dev server

# Production
npm run build        # Build for production
npm start            # Start production server

# Code Quality
npm run lint         # Run ESLint
```

## Test Login

1. Create a user in Firebase Console
2. Go to http://localhost:3000
3. Login with your Firebase credentials
4. See the dashboard!

## Environment Variables

All configured in `.env.local`:
- Firebase web credentials (NEXT_PUBLIC_*)
- Firebase Admin SDK (server-side)
- Cloudbeds/CLC API keys

## Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

That's it! Your Next.js app is ready.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [React Documentation](https://react.dev)
- [Firebase Documentation](https://firebase.google.com/docs)

---

**Enjoy your modern Next.js app!** 🎉


