'use client';

import { useState, useEffect } from 'react';

interface ArrivalsTabProps {
  onCheckIn: (reservation: any) => void;
  onDelete?: (reservation: any) => void;
}

interface CheckedInGuest {
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  class: 'TYE' | 'MOW';
  checkInTime: string;
  cloudbedsGuestID?: string;
  cloudbedsReservationID?: string;
  roomNumber?: string;
}

export default function ArrivalsTab({ onCheckIn, onDelete }: ArrivalsTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBNSF, setFilterBNSF] = useState(false);
  const [checkedInGuests, setCheckedInGuests] = useState<CheckedInGuest[]>([]);

  // Load checked-in guests from localStorage
  useEffect(() => {
    const loadGuests = () => {
      const guests = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
      setCheckedInGuests(guests);
    };

    loadGuests();
    // Refresh every 2 seconds to catch new check-ins
    const interval = setInterval(loadGuests, 2000);
    return () => clearInterval(interval);
  }, []);

  // Convert checked-in guests to arrival format
  const arrivals = checkedInGuests.map((guest, index) => ({
    id: `guest-${index}`,
    guestName: `${guest.firstName} ${guest.lastName}`,
    reservationId: guest.clcNumber || `GUEST-${index + 1}`,
    checkInDate: new Date(guest.checkInTime).toLocaleDateString(),
    checkInTime: new Date(guest.checkInTime).toLocaleTimeString(),
    checkOutDate: 'N/A',
    roomNumber: null,
    adults: 1,
    children: 0,
    isBNSFCrew: true, // All guests from kiosk are BNSF crew
    class: guest.class,
    phoneNumber: guest.phoneNumber,
    status: 'checked_in',
    rawData: guest
  }));

  const filteredArrivals = arrivals.filter(arrival => {
    const matchesSearch = arrival.guestName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         arrival.reservationId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         arrival.phoneNumber?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterBNSF || arrival.isBNSFCrew;
    return matchesSearch && matchesFilter;
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'clamp(15px, 2vw, 25px)' }}>
        <h2 style={{ 
          margin: 0, 
          color: '#333',
          fontSize: 'clamp(22px, 3vw, 30px)'
        }}>Today&apos;s Arrivals ({filteredArrivals.length})</h2>
      </div>

      {/* Search and Filter */}
      <div style={{ 
        display: 'flex', 
        gap: '15px', 
        marginBottom: 'clamp(15px, 2vw, 25px)',
        flexWrap: 'wrap'
      }}>
        <input
          type="text"
          placeholder="Search by name or reservation ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: 1,
            minWidth: '250px',
            padding: 'clamp(12px, 1.5vw, 16px)',
            border: '2px solid #e0e0e0',
            borderRadius: '8px',
            fontSize: 'clamp(14px, 1.5vw, 18px)'
          }}
        />
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: 'clamp(12px, 1.5vw, 16px) clamp(16px, 2vw, 24px)',
          background: filterBNSF ? '#667eea' : '#f3f4f6',
          color: filterBNSF ? 'white' : '#333',
          borderRadius: '8px',
          cursor: 'pointer',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          fontSize: 'clamp(14px, 1.5vw, 16px)'
        }}>
          <input
            type="checkbox"
            checked={filterBNSF}
            onChange={(e) => setFilterBNSF(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          BNSF Crew Only
        </label>
      </div>

      {/* Arrivals List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(12px, 1.5vw, 20px)' }}>
        {filteredArrivals.map((arrival) => (
          <div
            key={arrival.id}
            style={{
              background: 'white',
              border: '2px solid #e5e7eb',
              borderRadius: '12px',
              padding: 'clamp(16px, 2vw, 28px)',
              transition: 'all 0.3s',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#667eea';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e5e7eb';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '300px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: 'clamp(18px, 2vw, 24px)', color: '#111' }}>
                    {arrival.guestName}
                  </h3>
                  {arrival.isBNSFCrew && (
                    <span style={{
                      padding: '4px 8px',
                      background: '#fef3c7',
                      color: '#92400e',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '600'
                    }}>
                      🚂 BNSF Crew
                    </span>
                  )}
                </div>
                <div style={{ color: '#666', fontSize: 'clamp(13px, 1.5vw, 16px)', marginBottom: '8px' }}>
                  <strong>CLC Number:</strong> {arrival.reservationId} | <strong>Class:</strong> {arrival.class || 'N/A'} | <strong>Phone:</strong> {arrival.phoneNumber || 'N/A'}
                </div>
                <div style={{ display: 'flex', gap: 'clamp(12px, 2vw, 20px)', fontSize: 'clamp(13px, 1.5vw, 16px)', color: '#666', flexWrap: 'wrap' }}>
                  <span>📅 Checked In: {arrival.checkInDate} at {arrival.checkInTime}</span>
                  {arrival.roomNumber ? (
                    <span style={{ color: '#10b981', fontWeight: '600' }}>
                      🛏️ Room {arrival.roomNumber}
                    </span>
                  ) : (
                    <span style={{ color: '#f59e0b', fontWeight: '600' }}>
                      ⚠️ No Room Assigned
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                <span style={{
                  padding: '6px 12px',
                  background: '#d1fae5',
                  color: '#065f46',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '600'
                }}>
                  ✓ Already Checked In
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => onCheckIn(arrival)}
                    style={{
                      background: '#667eea',
                      color: 'white',
                      border: 'none',
                      padding: 'clamp(12px, 1.5vw, 16px) clamp(20px, 2.5vw, 32px)',
                      borderRadius: '8px',
                      fontSize: 'clamp(14px, 1.5vw, 18px)',
                      fontWeight: '600',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    View Details
                  </button>
                  {onDelete && (
                    <button
                      onClick={async () => {
                        if (confirm(`Are you sure you want to delete the reservation for ${arrival.guestName}? This will also delete it from Cloudbeds.`)) {
                          try {
                            if (arrival.rawData?.cloudbedsReservationID) {
                              const response = await fetch(`/api/cloudbeds-delete?reservationID=${arrival.rawData.cloudbedsReservationID}`, {
                                method: 'DELETE',
                              });
                              const result = await response.json();
                              if (!result.success && !result.mockMode) {
                                throw new Error(result.error || 'Failed to delete from Cloudbeds');
                              }
                            }
                            
                            // Remove from localStorage
                            const checkedInGuests = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
                            const updated = checkedInGuests.filter(
                              (g: any) => !(g.firstName === arrival.rawData?.firstName && 
                                          g.lastName === arrival.rawData?.lastName &&
                                          g.checkInTime === arrival.rawData?.checkInTime)
                            );
                            localStorage.setItem('checkedInGuests', JSON.stringify(updated));
                            onDelete(arrival);
                          } catch (error: any) {
                            alert(`Delete failed: ${error.message}`);
                          }
                        }
                      }}
                      style={{
                        background: '#ef4444',
                        color: 'white',
                        border: 'none',
                        padding: 'clamp(12px, 1.5vw, 16px) clamp(20px, 2.5vw, 32px)',
                        borderRadius: '8px',
                        fontSize: 'clamp(14px, 1.5vw, 18px)',
                        fontWeight: '600',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredArrivals.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: '#999'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '10px' }}>📭</div>
          <div>No arrivals found</div>
        </div>
      )}
    </div>
  );
}

