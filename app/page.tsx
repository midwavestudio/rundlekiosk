'use client';

import { useState } from 'react';
import GuestCheckIn from './components/GuestCheckIn';
import GuestCheckOut from './components/GuestCheckOut';
import FeedbackModal from './components/FeedbackModal';

type Screen = 'home' | 'checkin' | 'checkout';

export default function Home() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [showFeedback, setShowFeedback] = useState(false);

  if (currentScreen === 'checkin') {
    return (
      <>
        <GuestCheckIn
          onBack={() => setCurrentScreen('home')}
          onOpenFeedback={() => setShowFeedback(true)}
        />
        {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      </>
    );
  }

  if (currentScreen === 'checkout') {
    return (
      <>
        <GuestCheckOut
          onBack={() => setCurrentScreen('home')}
          onOpenFeedback={() => setShowFeedback(true)}
        />
        {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      </>
    );
  }

  return (
    <div className="kiosk-container">
      <div className="kiosk-header">
        <h1>Welcome to Rundle Suites</h1>
        <p className="subtitle">Please select an option to continue</p>
      </div>

      <div className="kiosk-options">
        <button
          className="kiosk-button checkin-button"
          onClick={() => setCurrentScreen('checkin')}
        >
          <div className="button-text">Check In</div>
          <div className="button-description">Start your stay</div>
        </button>

        <button
          className="kiosk-button checkout-button"
          onClick={() => setCurrentScreen('checkout')}
        >
          <div className="button-text">Check Out</div>
          <div className="button-description">Complete your stay</div>
        </button>
      </div>

      <div className="kiosk-footer">
        <p>Need assistance? Please contact the front desk &mdash; <a href="tel:+14062282800" style={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}>(406) 228-2800</a></p>
        <button
          onClick={() => setShowFeedback(true)}
          style={{
            marginTop: '10px',
            background: 'rgba(255,255,255,0.18)',
            border: '1px solid rgba(255,255,255,0.45)',
            color: 'inherit',
            borderRadius: '8px',
            padding: '7px 18px',
            fontSize: '13px',
            cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >
          💬 Send Us a Message
        </button>
      </div>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </div>
  );
}

