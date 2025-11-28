const admin = require('firebase-admin');
const { initializeFirebase } = require('./firebase');

/**
 * Initialize Firebase for middleware (optional for local dev)
 */
let firebaseInitialized = false;
try {
  if (process.env.FIREBASE_PROJECT_ID && 
      process.env.FIREBASE_PRIVATE_KEY && 
      !process.env.FIREBASE_PRIVATE_KEY.includes('your_')) {
    const app = initializeFirebase();
    if (app) {
      firebaseInitialized = true;
      console.log('✅ Firebase Admin SDK initialized successfully');
    } else {
      console.warn('⚠️  Firebase initialization returned null');
    }
  } else {
    console.warn('⚠️  Firebase credentials not configured - using mock auth');
  }
} catch (error) {
  console.error('❌ Firebase initialization error:', error.message);
  console.warn('   Authentication will be disabled for local development');
}

/**
 * Authentication middleware using Firebase Auth
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
async function authMiddleware(req, res, next) {
  // Skip authentication if Firebase is not initialized (local dev mode)
  if (!firebaseInitialized) {
    console.warn('⚠️  Authentication disabled - Firebase not configured');
    // For local development, create a mock user
    req.user = {
      uid: 'local-dev-user',
      email: 'dev@localhost',
      role: 'staff',
    };
    return next();
  }

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - No token provided',
      });
    }

    const token = authHeader.split('Bearer ')[1];

    // Verify Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: decodedToken.role || 'staff',
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({
      success: false,
      message: 'Unauthorized - Invalid token',
      error: error.message,
    });
  }
}

/**
 * CORS middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
function corsMiddleware(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
}

/**
 * Error handling middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  const statusCode = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    message,
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
}

/**
 * Request logging middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });

  next();
}

/**
 * Role-based access control middleware
 * @param {Array<string>} allowedRoles - Array of allowed roles
 * @returns {Function} Middleware function
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - Authentication required',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden - Insufficient permissions',
      });
    }

    next();
  };
}

module.exports = {
  authMiddleware,
  corsMiddleware,
  errorHandler,
  requestLogger,
  requireRole,
};

