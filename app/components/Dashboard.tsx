'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { ADMIN_ACCENT, ADMIN_GRADIENT } from '../lib/adminTheme';
import ArrivalsTab from './ArrivalsTab';
import DeparturesTab from './DeparturesTab';
import CheckInModal from './CheckInModal';
import CheckOutModal from './CheckOutModal';
import BulkCheckInTab from './BulkCheckInTab';
import TyePlaceholdersTab from './TyePlaceholdersTab';
import FeedbackTab from './FeedbackTab';
import EventLogTab from './EventLogTab';

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'arrivals' | 'departures' | 'bulk-checkin' | 'tye-placeholders' | 'feedback' | 'event-log'
  >('dashboard');
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showCheckOutModal, setShowCheckOutModal] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<any>(null);

  const handleCheckIn = (reservation: any) => {
    setSelectedReservation(reservation);
    setShowCheckInModal(true);
  };

  const handleCheckOut = (reservation: any) => {
    setSelectedReservation(reservation);
    setShowCheckOutModal(true);
  };

  const wideGuestTab = activeTab === 'arrivals' || activeTab === 'departures';

  return (
    <>
      {/* `body` is `display:flex; justify-content:center` in globals.css — without width:100% this shell shrink-wraps to ~login width. */}
      <div
        className="admin-dashboard-shell"
        style={{
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          minHeight: '100vh',
          background: ADMIN_GRADIENT,
          padding: wideGuestTab ? '8px 12px' : 'clamp(15px, 3vw, 40px)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{
          maxWidth: wideGuestTab ? 'min(1920px, 100%)' : '1400px',
          width: '100%',
          margin: '0 auto',
          background: 'white',
          borderRadius: '20px',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          height: wideGuestTab ? 'calc(100vh - 16px)' : 'calc(100vh - 30px)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Header */}
          <div style={{
            background: ADMIN_GRADIENT,
            padding: '20px 30px',
            color: 'white',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '24px' }}>🏨 Rundle Kiosk</h1>
              <p style={{ margin: '5px 0 0 0', opacity: 0.9, fontSize: '14px' }}>
                {user.email}
              </p>
            </div>
            <button
              onClick={onLogout}
              style={{
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                border: '2px solid white',
                padding: '10px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Sign Out
            </button>
          </div>

          {/* Tabs */}
          <div style={{
            display: 'flex',
            borderBottom: '2px solid #f0f0f0',
            padding: '0 20px'
          }}>
            {['dashboard', 'arrivals', 'departures', 'bulk-checkin', 'tye-placeholders', 'feedback', 'event-log'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                style={{
                  padding: '15px 25px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab ? `3px solid ${ADMIN_ACCENT}` : '3px solid transparent',
                  color: activeTab === tab ? ADMIN_ACCENT : '#666',
                  fontWeight: activeTab === tab ? '600' : '400',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  fontSize: '16px',
                  transition: 'all 0.3s'
                }}
              >
                {tab === 'bulk-checkin'
                  ? 'Bulk Check-In'
                  : tab === 'tye-placeholders'
                    ? 'Blocks'
                    : tab === 'event-log'
                      ? 'Error Log'
                      : tab}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ 
            padding: wideGuestTab ? '12px 16px 16px' : 'clamp(20px, 3vw, 40px)', 
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: wideGuestTab ? 'hidden' : 'auto',
            overflowY: wideGuestTab ? 'hidden' : 'auto',
          }}>
            {activeTab === 'dashboard' && (
              <DashboardTab />
            )}
          {activeTab === 'arrivals' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <ArrivalsTab onCheckIn={handleCheckIn} />
            </div>
          )}
          {activeTab === 'departures' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <DeparturesTab onCheckOut={handleCheckOut} />
            </div>
          )}
          {activeTab === 'bulk-checkin' && (
            <BulkCheckInTab />
          )}
          {activeTab === 'tye-placeholders' && (
            <TyePlaceholdersTab />
          )}
          {activeTab === 'feedback' && (
            <FeedbackTab />
          )}
          {activeTab === 'event-log' && (
            <EventLogTab />
          )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showCheckInModal && selectedReservation && (
        <CheckInModal
          reservation={selectedReservation}
          onClose={() => {
            setShowCheckInModal(false);
            setSelectedReservation(null);
          }}
        />
      )}

      {showCheckOutModal && selectedReservation && (
        <CheckOutModal
          reservation={selectedReservation}
          onClose={() => {
            setShowCheckOutModal(false);
            setSelectedReservation(null);
          }}
        />
      )}
    </>
  );
}

function DashboardTab() {
  // Get real stats from localStorage
  const checkedInGuests = typeof window !== 'undefined' 
    ? JSON.parse(localStorage.getItem('checkedInGuests') || '[]')
    : [];
  const checkOutHistory = typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('checkOutHistory') || '[]')
    : [];
  
  // Today's check-ins
  const today = new Date().toDateString();
  const todayCheckIns = checkedInGuests.filter((guest: any) => {
    const checkInDate = new Date(guest.checkInTime).toDateString();
    return checkInDate === today;
  });
  
  // Today's check-outs
  const todayCheckOuts = checkOutHistory.filter((guest: any) => {
    if (!guest.checkOutTime) return false;
    const checkOutDate = new Date(guest.checkOutTime).toDateString();
    return checkOutDate === today;
  });

  const stats = {
    occupied: checkedInGuests.length,
    available: 60 - checkedInGuests.length, // Assuming 60 total rooms
    arrivals: todayCheckIns.length,
    departures: todayCheckOuts.length
  };

  return (
    <div>
      <h2 style={{ 
        marginBottom: 'clamp(20px, 3vw, 40px)', 
        color: '#333',
        fontSize: 'clamp(24px, 3vw, 32px)'
      }}>Dashboard Overview</h2>
      
      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
        gap: 'clamp(15px, 2vw, 25px)',
        marginBottom: 'clamp(20px, 3vw, 40px)'
      }}>
        <StatCard icon="✓" label="Occupied" value={stats.occupied} color="#10b981" />
        <StatCard icon="🏠" label="Available" value={stats.available} color="#3b82f6" />
        <StatCard icon="↓" label="Arrivals Today" value={stats.arrivals} color="#f59e0b" />
        <StatCard icon="↑" label="Departures Today" value={stats.departures} color="#8b5cf6" />
      </div>

      {/* System Status */}
      <div style={{
        background: '#f9fafb',
        padding: '20px',
        borderRadius: '12px',
        marginTop: '20px'
      }}>
        <h3 style={{ marginBottom: '15px', color: '#333' }}>System Status</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <StatusRow label="Cloudbeds PMS" status="Connected" />
          <StatusRow label="CLC Portal" status="Demo Mode" warning />
          <StatusRow label="Firebase Auth" status="Active" />
          <StatusRow label="Transaction Logging" status="Active" />
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: any) {
  return (
    <div style={{
      background: 'white',
      border: `2px solid ${color}20`,
      borderRadius: '12px',
      padding: 'clamp(16px, 2.5vw, 28px)',
      textAlign: 'center',
      minHeight: '140px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    }}>
      <div style={{ fontSize: 'clamp(28px, 4vw, 40px)', marginBottom: '10px' }}>{icon}</div>
      <div style={{ 
        fontSize: 'clamp(32px, 5vw, 48px)', 
        fontWeight: 'bold', 
        color, 
        marginBottom: '5px',
        lineHeight: 1
      }}>
        {value}
      </div>
      <div style={{ fontSize: 'clamp(13px, 1.5vw, 16px)', color: '#666' }}>{label}</div>
    </div>
  );
}

function StatusRow({ label, status, warning }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{
        padding: '4px 12px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '600',
        background: warning ? '#fef3c7' : '#d1fae5',
        color: warning ? '#92400e' : '#065f46'
      }}>
        {status}
      </span>
    </div>
  );
}

