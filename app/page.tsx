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
        <div className="kiosk-footer-feedback">
          <p>Any issues?</p>
          <button type="button" className="kiosk-feedback-button" onClick={() => setShowFeedback(true)}>
            💬 Leave us a message
          </button>
        </div>
      </div>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </div>
  );
}

