'use client';

import { useState } from 'react';

// Mock data for departures
const mockDepartures = [
  {
    id: '4',
    guestName: 'Emily Davis',
    reservationId: 'RES004',
    checkInDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    checkOutDate: new Date().toLocaleDateString(),
    roomNumber: '302',
    balance: 0,
    isBNSFCrew: false,
    status: 'checked_in'
  },
  {
    id: '5',
    guestName: 'Robert Wilson',
    reservationId: 'RES005',
    checkInDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    checkOutDate: new Date().toLocaleDateString(),
    roomNumber: '405',
    balance: 0,
    isBNSFCrew: true,
    status: 'checked_in'
  },
  {
    id: '6',
    guestName: 'Lisa Anderson',
    reservationId: 'RES006',
    checkInDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    checkOutDate: new Date().toLocaleDateString(),
    roomNumber: '108',
    balance: 150.00,
    isBNSFCrew: false,
    status: 'checked_in'
  },
];

interface DeparturesTabProps {
  onCheckOut: (reservation: any) => void;
}

export default function DeparturesTab({ onCheckOut }: DeparturesTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBNSF, setFilterBNSF] = useState(false);

  const filteredDepartures = mockDepartures.filter(departure => {
    const matchesSearch = departure.guestName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         departure.reservationId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         departure.roomNumber?.toLowerCase().includes(searchTerm.toLowerCase());
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
                  <strong>Reservation:</strong> {departure.reservationId} | <strong>Room:</strong> {departure.roomNumber}
                </div>
                <div style={{ display: 'flex', gap: 'clamp(12px, 2vw, 20px)', fontSize: 'clamp(13px, 1.5vw, 16px)', color: '#666', flexWrap: 'wrap' }}>
                  <span>📅 {departure.checkInDate} - {departure.checkOutDate}</span>
                  {departure.balance === 0 ? (
                    <span style={{ color: '#10b981', fontWeight: '600' }}>
                      ✓ Fully Paid
                    </span>
                  ) : (
                    <span style={{ color: '#ef4444', fontWeight: '600' }}>
                      ⚠️ Outstanding Balance
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => onCheckOut(departure)}
                disabled={departure.balance > 0}
                style={{
                  background: departure.balance > 0 ? '#d1d5db' : '#8b5cf6',
                  color: 'white',
                  border: 'none',
                  padding: 'clamp(12px, 1.5vw, 16px) clamp(20px, 2.5vw, 32px)',
                  borderRadius: '8px',
                  fontSize: 'clamp(14px, 1.5vw, 18px)',
                  fontWeight: '600',
                  cursor: departure.balance > 0 ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                  opacity: departure.balance > 0 ? 0.6 : 1,
                  alignSelf: 'flex-start'
                }}
              >
                Check Out
              </button>
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

