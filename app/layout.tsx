import type { Metadata, Viewport } from 'next';
import './globals.css';
import KioskAutoUpdate from './components/KioskAutoUpdate';

const APP_NAME = 'Rundle Kiosk';
const APP_TITLE = 'Rundle Kiosk - Dual Check-In System';
const APP_DESCRIPTION = 'Hotel check-in system for Cloudbeds and CLC integration';
const THEME = '#8B6F47';

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: THEME,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <KioskAutoUpdate />
        {children}
      </body>
    </html>
  );
}
