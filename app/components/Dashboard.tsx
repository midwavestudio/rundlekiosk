'use client';

import { useState } from 'react';
import { User } from 'firebase/auth';
import ArrivalsTab from './ArrivalsTab';
import DeparturesTab from './DeparturesTab';
import CheckInModal from './CheckInModal';
import CheckOutModal from './CheckOutModal';

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'arrivals' | 'departures'>('dashboard');
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

  return (
    <>
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: 'clamp(15px, 3vw, 40px)'
      }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          background: 'white',
          borderRadius: '20px',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          height: 'calc(100vh - 30px)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
            {['dashboard', 'arrivals', 'departures'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                style={{
                  padding: '15px 25px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab ? '3px solid #667eea' : '3px solid transparent',
                  color: activeTab === tab ? '#667eea' : '#666',
                  fontWeight: activeTab === tab ? '600' : '400',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  fontSize: '16px',
                  transition: 'all 0.3s'
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ 
            padding: 'clamp(20px, 3vw, 40px)', 
            flex: 1,
            overflowY: 'auto'
          }}>
            {activeTab === 'dashboard' && (
              <DashboardTab />
            )}
            {activeTab === 'arrivals' && (
              <ArrivalsTab onCheckIn={handleCheckIn} />
            )}
            {activeTab === 'departures' && (
              <DeparturesTab onCheckOut={handleCheckOut} />
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
  const stats = {
    occupied: 42,
    available: 18,
    arrivals: 12,
    departures: 8
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

