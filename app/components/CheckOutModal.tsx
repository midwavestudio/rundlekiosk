'use client';

import { useState } from 'react';

interface CheckOutModalProps {
  reservation: any;
  onClose: () => void;
}

export default function CheckOutModal({ reservation, onClose }: CheckOutModalProps) {
  const [step, setStep] = useState<'confirm' | 'processing' | 'success'>('confirm');

  const handleCheckOut = () => {
    setStep('processing');
    
    // Simulate API call
    setTimeout(() => {
      // Save to localStorage for demo
      const checkedOut = JSON.parse(localStorage.getItem('checkedOut') || '[]');
      checkedOut.push({
        ...reservation,
        checkedOutAt: new Date().toISOString()
      });
      localStorage.setItem('checkedOut', JSON.stringify(checkedOut));
      
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
          <h2 style={{ margin: 0, fontSize: 'clamp(20px, 2.5vw, 28px)' }}>Check-Out Guest</h2>
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
          {/* Confirmation */}
          {step === 'confirm' && (
            <div>
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
                  <div><strong>Room:</strong> {reservation.roomNumber}</div>
                  <div><strong>Dates:</strong> {reservation.checkInDate} - {reservation.checkOutDate}</div>
                </div>
              </div>

              {/* Balance Check */}
              <div style={{
                background: reservation.balance > 0 ? '#fee2e2' : '#d1fae5',
                border: `2px solid ${reservation.balance > 0 ? '#ef4444' : '#10b981'}`,
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '24px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>Balance</div>
                <div style={{
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: reservation.balance > 0 ? '#ef4444' : '#10b981'
                }}>
                  ${reservation.balance.toFixed(2)}
                </div>
                {reservation.balance > 0 ? (
                  <div style={{ fontSize: '14px', color: '#991b1b', marginTop: '8px' }}>
                    ⚠️ Outstanding balance must be cleared
                  </div>
                ) : (
                  <div style={{ fontSize: '14px', color: '#065f46', marginTop: '8px' }}>
                    ✓ Fully paid
                  </div>
                )}
              </div>

              {reservation.balance === 0 ? (
                <div>
                  <p style={{ color: '#666', marginBottom: '24px', textAlign: 'center' }}>
                    Ready to check out this guest?
                  </p>
                  <button
                    onClick={handleCheckOut}
                    style={{
                      width: '100%',
                      padding: '14px',
                      background: '#8b5cf6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Confirm Check-Out
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#666' }}>
                  <p>Please process payment before checking out.</p>
                  <button
                    onClick={onClose}
                    style={{
                      marginTop: '16px',
                      padding: '14px 32px',
                      background: '#f3f4f6',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Processing */}
          {step === 'processing' && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{
                width: '60px',
                height: '60px',
                border: '4px solid #f3f4f6',
                borderTop: '4px solid #8b5cf6',
                borderRadius: '50%',
                margin: '0 auto 20px',
                animation: 'spin 1s linear infinite'
              }}></div>
              <h3 style={{ marginBottom: '12px' }}>Processing Check-Out...</h3>
              <div style={{ color: '#666', fontSize: '14px' }}>
                <div>✓ Updating Cloudbeds PMS</div>
                {reservation.isBNSFCrew && <div>✓ Syncing with CLC Portal</div>}
                <div>✓ Clearing room status</div>
                <div>✓ Logging transaction</div>
              </div>
            </div>
          )}

          {/* Success */}
          {step === 'success' && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: '72px', marginBottom: '20px' }}>✅</div>
              <h3 style={{ marginBottom: '12px', fontSize: '24px', color: '#8b5cf6' }}>
                Check-Out Complete!
              </h3>
              <div style={{ color: '#666', marginBottom: '24px' }}>
                <div style={{ marginBottom: '8px' }}>
                  {reservation.guestName} has been checked out from Room {reservation.roomNumber}
                </div>
                {reservation.isBNSFCrew && (
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

