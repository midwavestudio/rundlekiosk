/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next 14: keep firebase-admin as Node external (avoids bundling issues with Admin SDK).
    serverComponentsExternalPackages: ['firebase-admin'],
  },
};

module.exports = nextConfig;
