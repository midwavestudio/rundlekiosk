'use client';

import { useState } from 'react';
import GuestCheckIn from './components/GuestCheckIn';
import GuestCheckOut from './components/GuestCheckOut';

type Screen = 'home' | 'checkin' | 'checkout';

export default function Home() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');

  if (currentScreen === 'checkin') {
    return <GuestCheckIn onBack={() => setCurrentScreen('home')} />;
  }

  if (currentScreen === 'checkout') {
    return <GuestCheckOut onBack={() => setCurrentScreen('home')} />;
  }

  return (
    <div className="kiosk-container">
      <div className="kiosk-header">
        <div className="logo-icon">🏨</div>
        <h1>Welcome to Rundle Suites</h1>
        <p className="subtitle">Please select an option to continue</p>
      </div>

      <div className="kiosk-options">
        <button
          className="kiosk-button checkin-button"
          onClick={() => setCurrentScreen('checkin')}
        >
          <div className="button-icon">✓</div>
          <div className="button-text">Check In</div>
          <div className="button-description">Start your stay</div>
        </button>

        <button
          className="kiosk-button checkout-button"
          onClick={() => setCurrentScreen('checkout')}
        >
          <div className="button-icon">→</div>
          <div className="button-text">Check Out</div>
          <div className="button-description">Complete your stay</div>
        </button>
      </div>

      <div className="kiosk-footer">
        <p>Need assistance? Please contact the front desk</p>
      </div>
    </div>
  );
}

