/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next 14: keep firebase-admin as Node external (avoids bundling issues with Admin SDK).
    serverComponentsExternalPackages: ['firebase-admin'],
  },
};

let defaultCache = [];
try {
  defaultCache = require('@ducanh2912/next-pwa/cache').defaultCache || [];
} catch {
  defaultCache = [];
}

const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  // Avoid surprise full-page reloads when Wi‑Fi reconnects mid check-in/out.
  reloadOnOnline: false,
  runtimeCaching: [
    {
      urlPattern: /\/api\/.*/i,
      handler: 'NetworkOnly',
    },
    ...defaultCache,
  ],
});

module.exports = withPWA(nextConfig);
