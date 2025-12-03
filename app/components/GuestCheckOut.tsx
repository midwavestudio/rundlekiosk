'use client';

import { useState, useEffect } from 'react';

interface GuestCheckOutProps {
  onBack: () => void;
}

interface CheckedInGuest {
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  class: 'TYE' | 'MOW';
  checkInTime: string;
}

export default function GuestCheckOut({ onBack }: GuestCheckOutProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [checkedInGuests, setCheckedInGuests] = useState<CheckedInGuest[]>([]);
  const [filteredGuests, setFilteredGuests] = useState<CheckedInGuest[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<CheckedInGuest | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load checked-in guests from localStorage
    const guests = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
    setCheckedInGuests(guests);
  }, []);

  useEffect(() => {
    // Filter guests based on search query - show results after 3 characters
    if (searchQuery.trim().length < 3) {
      setFilteredGuests([]);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = checkedInGuests.filter((guest) => {
      const fullName = `${guest.firstName} ${guest.lastName}`.toLowerCase();
      return fullName.includes(query) || 
             guest.firstName.toLowerCase().includes(query) ||
             guest.lastName.toLowerCase().includes(query);
    });

    setFilteredGuests(filtered);
  }, [searchQuery, checkedInGuests]);

  const handleCheckOut = async () => {
    if (!selectedGuest) return;

    setLoading(true);

    try {
      // Add checkout timestamp
      const checkOutData = {
        ...selectedGuest,
        checkOutTime: new Date().toISOString(),
      };

      // Remove from checked-in guests
      const updatedGuests = checkedInGuests.filter(
        (g) =>
          !(g.firstName === selectedGuest.firstName &&
            g.lastName === selectedGuest.lastName &&
            g.checkInTime === selectedGuest.checkInTime)
      );
      localStorage.setItem('checkedInGuests', JSON.stringify(updatedGuests));

      // Save to checkout history
      const checkOutHistory = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
      checkOutHistory.push(checkOutData);
      localStorage.setItem('checkOutHistory', JSON.stringify(checkOutHistory));

      // TODO: Also save to Firebase Firestore when available
      // await saveCheckOutToFirestore(checkOutData);

      setSuccess(true);

      // Return to home after 2 seconds
      setTimeout(() => {
        onBack();
      }, 2000);
    } catch (err: any) {
      console.error('Check-out error:', err);
      alert('Check-out failed. Please try again or contact the front desk.');
    } finally {
      setLoading(false);
    }
  };

  if (success && selectedGuest) {
    return (
      <div className="kiosk-container">
        <div className="success-screen">
          <h1 className="animated-message">Thank you for staying with us!</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="kiosk-container">
      <div className="kiosk-header">
        <button className="back-link" onClick={onBack}>
          ← Back
        </button>
        <h1>Guest Check-Out</h1>
        <p className="subtitle">Search for your reservation</p>
      </div>

      <div className="checkout-search">
        <div className="form-group">
          <label htmlFor="search">Type Your First Name</label>
          <input
            type="text"
            id="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type your first name..."
            autoFocus
            autoComplete="off"
          />
        </div>

        {searchQuery.length >= 3 && filteredGuests.length === 0 && (
          <div className="no-results">
            <p>No guests found matching "{searchQuery}"</p>
            <p className="no-results-help">
              Please check your spelling or contact the front desk for assistance.
            </p>
          </div>
        )}

        {filteredGuests.length > 0 && (
          <div className="guest-list">
            <p className="guest-list-title">Select your name:</p>
            {filteredGuests.map((guest, index) => (
              <button
                key={index}
                className={`guest-card ${selectedGuest === guest ? 'selected' : ''}`}
                onClick={() => setSelectedGuest(guest)}
              >
                <div className="guest-info">
                  <div className="guest-name">
                    {guest.firstName} {guest.lastName}
                  </div>
                  <div className="guest-details">
                    CLC: {guest.clcNumber} • Class: {guest.class}
                  </div>
                  <div className="guest-details">
                    Checked in: {new Date(guest.checkInTime).toLocaleString()}
                  </div>
                </div>
                {selectedGuest === guest && (
                  <div className="selected-check">Selected</div>
                )}
              </button>
            ))}
          </div>
        )}

        {selectedGuest && (
          <button
            className="submit-button checkout-confirm"
            onClick={handleCheckOut}
            disabled={loading}
          >
            {loading ? (
              <>
                Processing...
                <span className="loading"></span>
              </>
            ) : (
              'Confirm Check-Out'
            )}
          </button>
        )}

        {checkedInGuests.length === 0 && !searchQuery && (
          <div className="no-guests">
            <p>No guests are currently checked in.</p>
            <p className="no-guests-help">
              If you believe this is an error, please contact the front desk.
            </p>
          </div>
        )}
      </div>

      <div className="kiosk-footer">
        <p>Need help? Please contact the front desk</p>
      </div>
    </div>
  );
}

