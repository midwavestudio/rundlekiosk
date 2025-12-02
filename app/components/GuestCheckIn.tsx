'use client';

import { useState } from 'react';

interface GuestCheckInProps {
  onBack: () => void;
}

interface GuestData {
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  roomNumber: string;
  class: 'TYE' | 'MOW' | '';
  checkInTime: string;
}

export default function GuestCheckIn({ onBack }: GuestCheckInProps) {
  const [formData, setFormData] = useState<GuestData>({
    firstName: '',
    lastName: '',
    clcNumber: '',
    phoneNumber: '',
    roomNumber: '',
    class: '',
    checkInTime: '',
  });
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (field: keyof GuestData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError('');
  };

  const formatPhoneNumber = (value: string) => {
    // Remove all non-numeric characters
    const cleaned = value.replace(/\D/g, '');
    
    // Format as (XXX) XXX-XXXX
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  };

  const handlePhoneChange = (value: string) => {
    const formatted = formatPhoneNumber(value);
    handleChange('phoneNumber', formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!formData.firstName || !formData.lastName || !formData.clcNumber || 
        !formData.phoneNumber || !formData.roomNumber || !formData.class) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Add timestamp
      const checkInData = {
        ...formData,
        checkInTime: new Date().toISOString(),
      };

      // Save to localStorage (temporary storage)
      const existingGuests = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
      existingGuests.push(checkInData);
      localStorage.setItem('checkedInGuests', JSON.stringify(existingGuests));

      // TODO: Also save to Firebase Firestore when available
      // await saveToFirestore(checkInData);

      setSuccess(true);
      
      // Return to home after 2 seconds
      setTimeout(() => {
        onBack();
      }, 2000);
    } catch (err: any) {
      setError('Check-in failed. Please try again or contact the front desk.');
      console.error('Check-in error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="kiosk-container">
        <div className="success-screen">
          <h1 className="animated-message">Enjoy your stay!</h1>
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
        <h1>Guest Check-In</h1>
        <p className="subtitle">Please fill in your information</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit} className="checkin-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="firstName">First Name *</label>
            <input
              type="text"
              id="firstName"
              value={formData.firstName}
              onChange={(e) => handleChange('firstName', e.target.value)}
              placeholder="John"
              required
              autoComplete="given-name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="lastName">Last Name *</label>
            <input
              type="text"
              id="lastName"
              value={formData.lastName}
              onChange={(e) => handleChange('lastName', e.target.value)}
              placeholder="Smith"
              required
              autoComplete="family-name"
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="clcNumber">CLC Number *</label>
          <input
            type="text"
            id="clcNumber"
            value={formData.clcNumber}
            onChange={(e) => handleChange('clcNumber', e.target.value)}
            placeholder="Enter your CLC number"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="phoneNumber">Phone Number *</label>
          <input
            type="tel"
            id="phoneNumber"
            value={formData.phoneNumber}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="(555) 123-4567"
            required
            autoComplete="tel"
          />
        </div>

        <div className="form-group">
          <label htmlFor="roomNumber">Room Number *</label>
          <input
            type="text"
            id="roomNumber"
            value={formData.roomNumber}
            onChange={(e) => handleChange('roomNumber', e.target.value)}
            placeholder="101"
            required
          />
        </div>

        <div className="form-group">
          <label>Class *</label>
          <div className="class-selector">
            <button
              type="button"
              className={`class-button ${formData.class === 'TYE' ? 'active' : ''}`}
              onClick={() => handleChange('class', 'TYE')}
            >
              TYE
            </button>
            <button
              type="button"
              className={`class-button ${formData.class === 'MOW' ? 'active' : ''}`}
              onClick={() => handleChange('class', 'MOW')}
            >
              MOW
            </button>
          </div>
        </div>

        <button type="submit" className="submit-button" disabled={loading}>
          {loading ? (
            <>
              Processing...
              <span className="loading"></span>
            </>
          ) : (
            'Complete Check-In'
          )}
        </button>
      </form>

      <div className="kiosk-footer">
        <p>All fields marked with * are required</p>
      </div>
    </div>
  );
}

