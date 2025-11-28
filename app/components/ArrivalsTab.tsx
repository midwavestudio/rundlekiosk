'use client';

import { useState } from 'react';

// Mock data for arrivals
const mockArrivals = [
  {
    id: '1',
    guestName: 'John Smith',
    reservationId: 'RES001',
    checkInDate: new Date().toLocaleDateString(),
    checkOutDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    roomNumber: '101',
    adults: 2,
    children: 0,
    isBNSFCrew: true,
    status: 'confirmed'
  },
  {
    id: '2',
    guestName: 'Sarah Johnson',
    reservationId: 'RES002',
    checkInDate: new Date().toLocaleDateString(),
    checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    roomNumber: '205',
    adults: 1,
    children: 1,
    isBNSFCrew: false,
    status: 'confirmed'
  },
  {
    id: '3',
    guestName: 'Michael Chen',
    reservationId: 'RES003',
    checkInDate: new Date().toLocaleDateString(),
    checkOutDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    roomNumber: null,
    adults: 2,
    children: 0,
    isBNSFCrew: true,
    status: 'confirmed'
  },
];

interface ArrivalsTabProps {
  onCheckIn: (reservation: any) => void;
}

export default function ArrivalsTab({ onCheckIn }: ArrivalsTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBNSF, setFilterBNSF] = useState(false);

  const filteredArrivals = mockArrivals.filter(arrival => {
    const matchesSearch = arrival.guestName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         arrival.reservationId.toLowerCase().includes(searchTerm.toLowerCase());
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
        }}>Today's Arrivals ({filteredArrivals.length})</h2>
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
                  <strong>Reservation:</strong> {arrival.reservationId}
                </div>
                <div style={{ display: 'flex', gap: 'clamp(12px, 2vw, 20px)', fontSize: 'clamp(13px, 1.5vw, 16px)', color: '#666', flexWrap: 'wrap' }}>
                  <span>📅 {arrival.checkInDate} - {arrival.checkOutDate}</span>
                  <span>👥 {arrival.adults} adults, {arrival.children} children</span>
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
              <button
                onClick={() => onCheckIn(arrival)}
                style={{
                  background: '#10b981',
                  color: 'white',
                  border: 'none',
                  padding: 'clamp(12px, 1.5vw, 16px) clamp(20px, 2.5vw, 32px)',
                  borderRadius: '8px',
                  fontSize: 'clamp(14px, 1.5vw, 18px)',
                  fontWeight: '600',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  alignSelf: 'flex-start'
                }}
              >
                Check In
              </button>
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

