/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next 14: keep firebase-admin as Node external (avoids bundling issues with Admin SDK).
    serverComponentsExternalPackages: ['firebase-admin'],
  },
};

const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  reloadOnOnline: true,
});

module.exports = withPWA(nextConfig);
