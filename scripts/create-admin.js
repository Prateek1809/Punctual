const admin = require('firebase-admin');

// Initialize with application default credentials or service account
admin.initializeApp();

const args = process.argv.slice(2);
const email = args[0];
const password = args[1];
const displayName = args[2];

if (!email || !password || !displayName) {
  console.error("Usage: node create-admin.js <email> <password> <displayName>");
  process.exit(1);
}

async function createAdmin() {
  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName,
    });
    
    await admin.auth().setCustomUserClaims(userRecord.uid, { role: 'admin' });
    
    const nowStr = new Date().toISOString().split('T')[0];
    const year = nowStr.split('-')[0];

    await admin.firestore().collection('users').doc(userRecord.uid).set({
      name: displayName,
      email: email,
      role: 'admin',
      managerId: null,
      joinDate: nowStr,
      isActive: true
    });

    await admin.firestore().collection('leaveBalances').doc(`${userRecord.uid}_${year}`).set({
      uid: userRecord.uid,
      year: year,
      balances: {
        unified: {
          allotted: 18,
          used: 0
        }
      }
    });
    
    console.log(`Successfully created new admin user: ${userRecord.uid} (${email})`);
  } catch (error) {
    console.error('Error creating new admin user:', error);
  } finally {
    process.exit(0);
  }
}

createAdmin();
