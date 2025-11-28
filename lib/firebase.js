const admin = require('firebase-admin');

let firebaseApp;

/**
 * Initialize Firebase Admin SDK
 * @returns {admin.app.App} Firebase app instance
 */
function initializeFirebase() {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // Check if credentials are provided and not placeholders
    if (!process.env.FIREBASE_PROJECT_ID || 
        process.env.FIREBASE_PROJECT_ID.includes('your_') ||
        !process.env.FIREBASE_PRIVATE_KEY ||
        process.env.FIREBASE_PRIVATE_KEY.includes('your_')) {
      throw new Error('Firebase credentials not configured (using placeholders)');
    }

    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });

    console.log('Firebase Admin initialized successfully');
    return firebaseApp;
  } catch (error) {
    // Don't throw - allow server to start without Firebase
    console.warn('Firebase not initialized:', error.message);
    return null;
  }
}

/**
 * Get Firestore database instance
 * @returns {admin.firestore.Firestore|null}
 */
function getFirestore() {
  if (!firebaseApp) {
    initializeFirebase();
  }
  if (!firebaseApp) {
    return null;
  }
  return admin.firestore();
}

/**
 * Log transaction to Firestore
 * @param {Object} transactionData - Transaction data to log
 * @returns {Promise<string>} Transaction ID
 */
async function logTransaction(transactionData) {
  try {
    const db = getFirestore();
    if (!db) {
      console.warn('⚠️  Firestore not available - transaction not logged');
      return 'mock-transaction-id';
    }
    
    const transaction = {
      ...transactionData,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: new Date().toISOString(),
    };

    const docRef = await db.collection('transactions').add(transaction);
    console.log('Transaction logged:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('Error logging transaction:', error);
    // Don't throw - allow operation to continue
    return 'error-transaction-id';
  }
}

/**
 * Update transaction status
 * @param {string} transactionId - Transaction ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<void>}
 */
async function updateTransaction(transactionId, updates) {
  try {
    const db = getFirestore();
    await db.collection('transactions').doc(transactionId).update({
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('Transaction updated:', transactionId);
  } catch (error) {
    console.error('Error updating transaction:', error);
    throw error;
  }
}

/**
 * Log failed operation for retry
 * @param {Object} operation - Operation details
 * @returns {Promise<string>} Operation ID
 */
async function logFailedOperation(operation) {
  try {
    const db = getFirestore();
    const failedOp = {
      ...operation,
      retryCount: 0,
      maxRetries: 10,
      nextRetryAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('failed_operations').add(failedOp);
    console.log('Failed operation logged:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('Error logging failed operation:', error);
    throw error;
  }
}

/**
 * Get pending failed operations
 * @returns {Promise<Array>} List of pending operations
 */
async function getPendingFailedOperations() {
  try {
    const db = getFirestore();
    const now = new Date().toISOString();
    
    const snapshot = await db
      .collection('failed_operations')
      .where('status', '==', 'pending')
      .where('nextRetryAt', '<=', now)
      .where('retryCount', '<', 10)
      .limit(50)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
  } catch (error) {
    console.error('Error getting pending failed operations:', error);
    throw error;
  }
}

/**
 * Update failed operation
 * @param {string} operationId - Operation ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<void>}
 */
async function updateFailedOperation(operationId, updates) {
  try {
    const db = getFirestore();
    await db.collection('failed_operations').doc(operationId).update({
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('Error updating failed operation:', error);
    throw error;
  }
}

module.exports = {
  initializeFirebase,
  getFirestore,
  logTransaction,
  updateTransaction,
  logFailedOperation,
  getPendingFailedOperations,
  updateFailedOperation,
};

