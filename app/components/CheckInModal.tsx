'use client';

import { useState } from 'react';

interface CheckInModalProps {
  reservation: any;
  onClose: () => void;
}

const availableRooms = [
  { id: '201', number: '201', type: 'Standard' },
  { id: '202', number: '202', type: 'Deluxe' },
  { id: '301', number: '301', type: 'Suite' },
  { id: '305', number: '305', type: 'Standard' },
];

export default function CheckInModal({ reservation, onClose }: CheckInModalProps) {
  const [step, setStep] = useState<'confirm' | 'room' | 'processing' | 'success'>(
    reservation.roomNumber ? 'confirm' : 'room'
  );
  const [selectedRoom, setSelectedRoom] = useState(reservation.roomNumber);
  const [isBNSFCrew, setIsBNSFCrew] = useState(reservation.isBNSFCrew);
  const [employeeId, setEmployeeId] = useState('');

  const handleCheckIn = () => {
    setStep('processing');
    
    // Simulate API call
    setTimeout(() => {
      // Save to localStorage for demo
      const checkedIn = JSON.parse(localStorage.getItem('checkedIn') || '[]');
      checkedIn.push({
        ...reservation,
        roomNumber: selectedRoom,
        isBNSFCrew,
        employeeId: isBNSFCrew ? employeeId : null,
        checkedInAt: new Date().toISOString()
      });
      localStorage.setItem('checkedIn', JSON.stringify(checkedIn));
      
      setStep('success');
    }, 2000);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 'clamp(20px, 3vw, 40px)'
    }}>
      <div style={{
        background: 'white',
        borderRadius: '16px',
        maxWidth: 'min(800px, 90vw)',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div style={{
          padding: 'clamp(20px, 2.5vw, 32px)',
          borderBottom: '2px solid #f3f4f6',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{ margin: 0, fontSize: 'clamp(20px, 2.5vw, 28px)' }}>Check-In Guest</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#999',
              padding: '0',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 'clamp(20px, 2.5vw, 32px)' }}>
          {/* Guest Info */}
          <div style={{
            background: '#f9fafb',
            padding: '16px',
            borderRadius: '8px',
            marginBottom: '24px'
          }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px' }}>{reservation.guestName}</h3>
            <div style={{ fontSize: '14px', color: '#666' }}>
              <div><strong>Reservation:</strong> {reservation.reservationId}</div>
              <div><strong>Dates:</strong> {reservation.checkInDate} - {reservation.checkOutDate}</div>
              <div><strong>Guests:</strong> {reservation.adults} adults, {reservation.children} children</div>
            </div>
          </div>

          {/* Room Selection */}
          {step === 'room' && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>Select Room</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                {availableRooms.map((room) => (
                  <button
                    key={room.id}
                    onClick={() => {
                      setSelectedRoom(room.number);
                      setStep('confirm');
                    }}
                    style={{
                      padding: '20px',
                      border: '2px solid #e5e7eb',
                      borderRadius: '8px',
                      background: 'white',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.3s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#667eea';
                      e.currentTarget.style.background = '#f0f4ff';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e5e7eb';
                      e.currentTarget.style.background = 'white';
                    }}
                  >
                    <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '4px' }}>
                      {room.number}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666' }}>{room.type}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Confirmation */}
          {step === 'confirm' && (
            <div>
              <div style={{
                background: '#10b98120',
                border: '2px solid #10b981',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '24px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981', marginBottom: '8px' }}>
                  Room {selectedRoom}
                </div>
                <div style={{ fontSize: '14px', color: '#666' }}>Assigned</div>
              </div>

              {/* BNSF Crew Toggle */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '16px',
                background: '#f9fafb',
                borderRadius: '8px',
                cursor: 'pointer',
                marginBottom: '16px'
              }}>
                <input
                  type="checkbox"
                  checked={isBNSFCrew}
                  onChange={(e) => setIsBNSFCrew(e.target.checked)}
                  style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '16px' }}>🚂 BNSF Crew Member</span>
              </label>

              {/* Employee ID Input */}
              {isBNSFCrew && (
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                    Employee ID
                  </label>
                  <input
                    type="text"
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    placeholder="Enter employee ID"
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '14px'
                    }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                {!reservation.roomNumber && (
                  <button
                    onClick={() => setStep('room')}
                    style={{
                      flex: 1,
                      padding: '14px',
                      background: '#f3f4f6',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Change Room
                  </button>
                )}
                <button
                  onClick={handleCheckIn}
                  style={{
                    flex: 1,
                    padding: '14px',
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Confirm Check-In
                </button>
              </div>
            </div>
          )}

          {/* Processing */}
          {step === 'processing' && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{
                width: '60px',
                height: '60px',
                border: '4px solid #f3f4f6',
                borderTop: '4px solid #667eea',
                borderRadius: '50%',
                margin: '0 auto 20px',
                animation: 'spin 1s linear infinite'
              }}></div>
              <h3 style={{ marginBottom: '12px' }}>Processing Check-In...</h3>
              <div style={{ color: '#666', fontSize: '14px' }}>
                <div>✓ Updating Cloudbeds PMS</div>
                {isBNSFCrew && <div>✓ Syncing with CLC Portal</div>}
                <div>✓ Assigning room</div>
                <div>✓ Logging transaction</div>
              </div>
            </div>
          )}

          {/* Success */}
          {step === 'success' && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: '72px', marginBottom: '20px' }}>✅</div>
              <h3 style={{ marginBottom: '12px', fontSize: '24px', color: '#10b981' }}>
                Check-In Complete!
              </h3>
              <div style={{ color: '#666', marginBottom: '24px' }}>
                <div style={{ marginBottom: '8px' }}>{reservation.guestName} has been checked into Room {selectedRoom}</div>
                {isBNSFCrew && (
                  <div style={{
                    padding: '12px',
                    background: '#fef3c7',
                    borderRadius: '8px',
                    marginTop: '16px'
                  }}>
                    ✓ CLC Portal updated for BNSF crew member
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                style={{
                  padding: '14px 32px',
                  background: '#667eea',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

