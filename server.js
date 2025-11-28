/**
 * Local Express Server for Development
 * Run with: npm run start:local
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Rundle Kiosk API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Import API routes
const checkInHandler = require('./api/checkin');
const checkOutHandler = require('./api/checkout');
const arrivalsHandler = require('./api/arrivals');
const departuresHandler = require('./api/departures');
const reservationsHandler = require('./api/reservations');
const roomsHandler = require('./api/rooms');
const roomAssignHandler = require('./api/room-assign');
const retryFailedHandler = require('./api/retry-failed');

// Mount API routes
// These handlers are designed for Vercel serverless, so we wrap them
app.post('/api/checkin', async (req, res) => {
  try {
    await checkInHandler(req, res);
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/checkout', async (req, res) => {
  try {
    await checkOutHandler(req, res);
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/arrivals', async (req, res) => {
  try {
    await arrivalsHandler(req, res);
  } catch (error) {
    console.error('Arrivals error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/departures', async (req, res) => {
  try {
    await departuresHandler(req, res);
  } catch (error) {
    console.error('Departures error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/reservations', async (req, res) => {
  try {
    await reservationsHandler(req, res);
  } catch (error) {
    console.error('Reservations error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/rooms', async (req, res) => {
  try {
    await roomsHandler(req, res);
  } catch (error) {
    console.error('Rooms error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/room-assign', async (req, res) => {
  try {
    await roomAssignHandler(req, res);
  } catch (error) {
    console.error('Room assign error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/retry-failed', async (req, res) => {
  try {
    await retryFailedHandler(req, res);
  } catch (error) {
    console.error('Retry failed error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Firebase initialization is handled in middleware.js
// It will fail gracefully if credentials are not configured

console.log('Initializing server...');

// Start server
const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     Rundle Kiosk API - Local Development Server        ║
╠══════════════════════════════════════════════════════════╣
║  Server running on: http://localhost:${PORT}              ║
║  Health check: http://localhost:${PORT}/api/health        ║
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(40)}║
╚══════════════════════════════════════════════════════════╝
  `);
  
  // Check environment variables
  const requiredVars = [
    'CLOUDBEDS_API_KEY',
    'CLOUDBEDS_PROPERTY_ID',
    'FIREBASE_PROJECT_ID'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName] || process.env[varName].includes('your_'));
  
  if (missingVars.length > 0) {
    console.warn('\n⚠️  Warning: Missing or placeholder environment variables:');
    missingVars.forEach(varName => {
      console.warn(`   - ${varName}`);
    });
    console.warn('\n   Edit .env file with your actual credentials');
    console.warn('   API will start but external calls may fail\n');
  } else {
    console.log('✅ All required environment variables are set\n');
  }
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use`);
    console.error(`   Try changing PORT in .env or stop the other process\n`);
  } else {
    console.error('\n❌ Server error:', error);
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

