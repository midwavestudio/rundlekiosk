'use client';

import { useState, useEffect } from 'react';

interface DeparturesTabProps {
  onCheckOut: (reservation: any) => void;
}

interface CheckedInGuest {
  firstName: string;
  lastName: string;
  clcNumber: string;
  phoneNumber: string;
  class: 'TYE' | 'MOW';
  checkInTime: string;
  checkOutTime?: string;
}

export default function DeparturesTab({ onCheckOut }: DeparturesTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBNSF, setFilterBNSF] = useState(false);
  const [checkedInGuests, setCheckedInGuests] = useState<CheckedInGuest[]>([]);
  const [checkOutHistory, setCheckOutHistory] = useState<CheckedInGuest[]>([]);

  // Load guests from localStorage
  useEffect(() => {
    const loadGuests = () => {
      const checkedIn = JSON.parse(localStorage.getItem('checkedInGuests') || '[]');
      const checkedOut = JSON.parse(localStorage.getItem('checkOutHistory') || '[]');
      setCheckedInGuests(checkedIn);
      setCheckOutHistory(checkedOut);
    };

    loadGuests();
    // Refresh every 2 seconds
    const interval = setInterval(loadGuests, 2000);
    return () => clearInterval(interval);
  }, []);

  // Combine checked-in guests (for today's departures) with recent check-outs
  const departures = [
    ...checkedInGuests.map((guest, index) => ({
      id: `checked-in-${index}`,
      guestName: `${guest.firstName} ${guest.lastName}`,
      reservationId: guest.clcNumber || `GUEST-${index + 1}`,
      checkInDate: new Date(guest.checkInTime).toLocaleDateString(),
      checkInTime: new Date(guest.checkInTime).toLocaleTimeString(),
      checkOutDate: new Date().toLocaleDateString(),
      roomNumber: null,
      balance: 0, // Assume BNSF crew has no balance
      isBNSFCrew: true,
      class: guest.class,
      phoneNumber: guest.phoneNumber,
      status: 'checked_in',
      rawData: guest
    })),
    ...checkOutHistory.slice(-10).map((guest, index) => ({
      id: `checked-out-${index}`,
      guestName: `${guest.firstName} ${guest.lastName}`,
      reservationId: guest.clcNumber || `GUEST-OUT-${index + 1}`,
      checkInDate: new Date(guest.checkInTime).toLocaleDateString(),
      checkOutDate: guest.checkOutTime ? new Date(guest.checkOutTime).toLocaleDateString() : 'N/A',
      checkOutTime: guest.checkOutTime ? new Date(guest.checkOutTime).toLocaleTimeString() : 'N/A',
      roomNumber: null,
      balance: 0,
      isBNSFCrew: true,
      class: guest.class,
      phoneNumber: guest.phoneNumber,
      status: 'checked_out',
      rawData: guest
    }))
  ];

  const filteredDepartures = departures.filter(departure => {
    const matchesSearch = departure.guestName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         departure.reservationId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         departure.phoneNumber?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterBNSF || departure.isBNSFCrew;
    return matchesSearch && matchesFilter;
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'clamp(15px, 2vw, 25px)' }}>
        <h2 style={{ 
          margin: 0, 
          color: '#333',
          fontSize: 'clamp(22px, 3vw, 30px)'
        }}>Today's Departures ({filteredDepartures.length})</h2>
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
          placeholder="Search by name, reservation ID, or room..."
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

      {/* Departures List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(12px, 1.5vw, 20px)' }}>
        {filteredDepartures.map((departure) => (
          <div
            key={departure.id}
            style={{
              background: 'white',
              border: '2px solid #e5e7eb',
              borderRadius: '12px',
              padding: 'clamp(16px, 2vw, 28px)',
              transition: 'all 0.3s',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#8b5cf6';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.15)';
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
                    {departure.guestName}
                  </h3>
                  {departure.isBNSFCrew && (
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
                  {departure.balance > 0 && (
                    <span style={{
                      padding: '4px 8px',
                      background: '#fee2e2',
                      color: '#991b1b',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '600'
                    }}>
                      ⚠️ Balance: ${departure.balance.toFixed(2)}
                    </span>
                  )}
                </div>
                <div style={{ color: '#666', fontSize: 'clamp(13px, 1.5vw, 16px)', marginBottom: '8px' }}>
                  <strong>CLC Number:</strong> {departure.reservationId} | <strong>Class:</strong> {departure.class || 'N/A'} | <strong>Phone:</strong> {departure.phoneNumber || 'N/A'}
                </div>
                <div style={{ display: 'flex', gap: 'clamp(12px, 2vw, 20px)', fontSize: 'clamp(13px, 1.5vw, 16px)', color: '#666', flexWrap: 'wrap' }}>
                  <span>📅 Check In: {departure.checkInDate} {departure.checkInTime ? `at ${departure.checkInTime}` : ''}</span>
                  {departure.status === 'checked_out' && departure.checkOutTime && (
                    <span>📅 Check Out: {departure.checkOutDate} at {departure.checkOutTime}</span>
                  )}
                  {departure.balance === 0 && (
                    <span style={{ color: '#10b981', fontWeight: '600' }}>
                      ✓ Fully Paid
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                {departure.status === 'checked_out' ? (
                  <span style={{
                    padding: '6px 12px',
                    background: '#dbeafe',
                    color: '#1e40af',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}>
                    ✓ Checked Out
                  </span>
                ) : (
                  <button
                    onClick={() => onCheckOut(departure)}
                    style={{
                      background: '#8b5cf6',
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
                    Check Out
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredDepartures.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: '#999'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '10px' }}>📭</div>
          <div>No departures found</div>
        </div>
      )}
    </div>
  );
}

