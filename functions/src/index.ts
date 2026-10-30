import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Transaction } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

setGlobalOptions({ region: 'us-central1' });

initializeApp();
const db = getFirestore();
const auth = getAuth();

// Haversine formula for distance in meters
function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Helper to get client IP from request
function getClientIp(req: any): string {
  if (!req) return '';
  const forwarded = req.headers ? req.headers['x-forwarded-for'] : '';
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || '';
}

// Helper to get current IST date & time
function getISTDateTime(): { now: Date; dateStr: string; timeStr: string } {
  const istString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const now = new Date(istString);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;
  return { now, dateStr, timeStr };
}

// -------------------------------------------------------------
// 0. Initial System Setup Wizard
// -------------------------------------------------------------
export const checkSetupRequired = onCall(async () => {
  try {
    const usersSnap = await db.collection('users').limit(1).get();
    return { setupRequired: usersSnap.empty };
  } catch (error: any) {
    return { setupRequired: false, error: error.message };
  }
});

export const setupInitialAdmin = onCall(async (request) => {
  const data = request.data || {};
  const usersSnap = await db.collection('users').limit(1).get();
  if (!usersSnap.empty) {
    throw new HttpsError(
      'failed-precondition',
      'Initial admin setup has already been completed.'
    );
  }

  const {
    adminName,
    adminEmail,
    adminPassword,
    officeName,
    officeLat,
    officeLng,
    radiusM = 200,
    officeStart,
    officeEnd,
    graceMinutes = 10,
  } = data;

  if (!adminName || !adminEmail || !adminPassword) {
    throw new HttpsError('invalid-argument', 'Admin name, email and password are required');
  }

  try {
    // 1. Create Admin User
    const userRecord = await auth.createUser({
      email: adminEmail,
      password: adminPassword,
      displayName: adminName,
    });

    await auth.setCustomUserClaims(userRecord.uid, { role: 'admin' });

    const { dateStr } = getISTDateTime();

    // 2. Set Admin Document in users
    await db.collection('users').doc(userRecord.uid).set({
      name: adminName,
      email: adminEmail,
      role: 'admin',
      managerId: null,
      joinDate: dateStr,
      isActive: true,
    });

    // 3. Initialize Company Settings
    const hasOffice = officeName && officeLat != null && officeLng != null && !isNaN(Number(officeLat)) && !isNaN(Number(officeLng));
    const companySettings = {
      officeStart: officeStart || '',
      officeEnd: officeEnd || '',
      graceMinutes: Number(graceMinutes || 0),
      weeklyOffs: [0, 6], // Sunday, Saturday
      halfDayMinutes: 240,
      fullDayMinutes: 480,
      yearStartMonth: 1,
      monthlyQuota: 1.5,
      attendancePolicy: {
        mode: 'either',
        onFailure: 'flag',
        allowedIps: [],
        maxAccuracyM: 300,
        offices: hasOffice ? [
          {
            name: officeName,
            lat: Number(officeLat),
            lng: Number(officeLng),
            radiusM: Number(radiusM || 200),
          },
        ] : [],
      },
    };

    await db.collection('settings').doc('company').set(companySettings, { merge: true });

    // 6. Audit Log
    await db.collection('auditLogs').add({
      actorUid: userRecord.uid,
      actorName: adminName,
      action: 'INITIAL_SYSTEM_SETUP',
      targetId: userRecord.uid,
      after: {
        adminEmail,
        officeName,
        officeCoordinates: `${officeLat}, ${officeLng}`,
      },
      timestamp: new Date().toISOString(),
    });

    return { success: true, uid: userRecord.uid, email: adminEmail };
  } catch (error: any) {
    throw new HttpsError('internal', error.message);
  }
});

// -------------------------------------------------------------
// 1. User Management Functions
// -------------------------------------------------------------
export const createEmployee = onCall(async (request) => {
  const context = request;
  const data = request.data || {};

  const callerRole = context.auth?.token?.role;
  if (!context.auth || (callerRole !== 'admin' && callerRole !== 'manager')) {
    throw new HttpsError('permission-denied', 'Only admins and managers can create employees.');
  }

  const { email, password, name, role = 'employee', managerId } = data;
  if (!email || !password || !name) {
    throw new HttpsError('invalid-argument', 'Missing email, password, or name');
  }

  try {
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
    });

    // Managers can ONLY create employees. Admins can create employees, managers, or admins.
    const userRole = callerRole === 'admin' && (role === 'admin' || role === 'manager') 
      ? role 
      : 'employee';
    await auth.setCustomUserClaims(userRecord.uid, { role: userRole });

    const { dateStr } = getISTDateTime();
    const currentYear = dateStr.split('-')[0];

    const targetManagerId = callerRole === 'manager'
      ? (managerId || context.auth.uid)
      : (managerId || null);

    // Create user profile
    await db.collection('users').doc(userRecord.uid).set({
      name,
      email,
      role: userRole,
      managerId: targetManagerId,
      joinDate: dateStr,
      isActive: true,
    });

    // Create opening leave balance only for employees based on company settings
    if (userRole === 'employee') {
      const companyDoc = await db.collection('settings').doc('company').get();
      const quota = companyDoc.data()?.monthlyQuota ?? 1.5;
      const month = Number(dateStr.split('-')[1]);
      const remainingMonths = Math.max(1, 12 - month + 1);
      const initialAllotted = Number((quota * remainingMonths).toFixed(1));

      await db.collection('leaveBalances').doc(`${userRecord.uid}_${currentYear}`).set({
        uid: userRecord.uid,
        year: currentYear,
        balances: {
          unified: {
            allotted: initialAllotted,
            used: 0,
          },
        },
      });
    }

    // Audit Log
    await db.collection('auditLogs').add({
      actorUid: context.auth.uid,
      actorName: context.auth.token.name || context.auth.token.email || (callerRole === 'admin' ? 'Admin' : 'Manager'),
      action: 'CREATE_EMPLOYEE',
      targetId: userRecord.uid,
      after: { name, email, role: userRole, managerId: targetManagerId },
      timestamp: new Date().toISOString(),
    });

    return { uid: userRecord.uid };
  } catch (error: any) {
    throw new HttpsError('internal', error.message);
  }
});

export const updateEmployee = onCall(async (request) => {
  const context = request;
  const data = request.data || {};

  const callerRole = context.auth?.token?.role;
  if (!context.auth || (callerRole !== 'admin' && callerRole !== 'manager')) {
    throw new HttpsError('permission-denied', 'Only admins and managers can update employees.');
  }

  const { uid, role, managerId, isActive, name } = data;
  if (!uid) {
    throw new HttpsError('invalid-argument', 'User ID is required');
  }

  const userDocRef = db.collection('users').doc(uid);
  const userDoc = await userDocRef.get();
  if (!userDoc.exists) {
    throw new HttpsError('not-found', 'User not found');
  }

  const before = userDoc.data();
  if (callerRole === 'manager') {
    // Manager can only manage employees
    if (before?.role !== 'employee') {
      throw new HttpsError('permission-denied', 'Managers can only update employee profiles.');
    }
    if (role && role !== 'employee') {
      throw new HttpsError('permission-denied', 'Managers cannot change user role.');
    }
  }

  const updates: any = {};

  if (callerRole === 'admin' && role && (role === 'employee' || role === 'manager' || role === 'admin')) {
    updates.role = role;
    await auth.setCustomUserClaims(uid, { role });
  }

  if (managerId !== undefined) updates.managerId = managerId || null;
  if (isActive !== undefined) updates.isActive = Boolean(isActive);
  if (name) updates.name = name;

  await userDocRef.update(updates);

  await db.collection('auditLogs').add({
    actorUid: context.auth.uid,
    actorName: context.auth.token.name || context.auth.token.email || (callerRole === 'admin' ? 'Admin' : 'Manager'),
    action: 'UPDATE_EMPLOYEE',
    targetId: uid,
    before,
    after: updates,
    timestamp: new Date().toISOString(),
  });

  return { success: true };
});

// -------------------------------------------------------------
// 2. Attendance Actions: punchIn & punchOut
// -------------------------------------------------------------
export const punchIn = onCall(async (request) => {
  const context = request;
  const data = request.data || {};

  if (!context.auth) throw new HttpsError('unauthenticated', 'Not signed in');

  const uid = context.auth.uid;
  const { lat = 0, lng = 0, accuracy = 999999 } = data;
  const clientIp = data?.clientIp || getClientIp(request.rawRequest);

  const { now, dateStr } = getISTDateTime();
  const docId = `${uid}_${dateStr}`;
  const attendanceRef = db.collection('attendance').doc(docId);

  // Check if user is active and has employee role
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists || userDoc.data()?.isActive === false) {
    throw new HttpsError('permission-denied', 'Account is deactivated.');
  }
  if (userDoc.data()?.role !== 'employee') {
    throw new HttpsError('failed-precondition', 'Attendance marking is only for employees. Admins and Managers do not need to punch in.');
  }

  // Double punch check
  const existingDoc = await attendanceRef.get();
  if (existingDoc.exists && existingDoc.data()?.checkIn) {
    throw new HttpsError('failed-precondition', 'Already punched in for today.');
  }

  // Load Company Settings & Policy
  const settingsDoc = await db.collection('settings').doc('company').get();
  const settings = settingsDoc.data() || {};
  const policy = settings.attendancePolicy || {
    mode: 'either',
    onFailure: 'flag',
    allowedIps: [],
    maxAccuracyM: 300,
    offices: [],
  };

  // Location & IP Verification
  let closestDistanceM = 9999999;
  let geoMatched = false;

  if (policy.offices && policy.offices.length > 0 && lat && lng) {
    for (const office of policy.offices) {
      const dist = distanceM(lat, lng, office.lat, office.lng);
      if (dist < closestDistanceM) {
        closestDistanceM = Math.round(dist);
      }
      if (dist <= office.radiusM && accuracy <= (policy.maxAccuracyM || 300)) {
        geoMatched = true;
      }
    }
  }

  // IP Matching
  const allowedIps: string[] = policy.allowedIps || [];
  const ipMatched = allowedIps.some(ip => ip.trim() === clientIp.trim() || clientIp.includes(ip.trim()));

  // Mode verification logic: off | ip | geo | both | either
  let verified = false;
  switch (policy.mode) {
    case 'off':
      verified = true;
      break;
    case 'ip':
      verified = ipMatched;
      break;
    case 'geo':
      verified = geoMatched;
      break;
    case 'both':
      verified = ipMatched && geoMatched;
      break;
    case 'either':
    default:
      verified = ipMatched || geoMatched;
      break;
  }

  // Policy onFailure: block vs flag
  if (!verified && policy.onFailure === 'block') {
    throw new HttpsError(
      'failed-precondition',
      'You must be at the office to punch in (office location or IP mismatch).'
    );
  }

  // Calculate late status
  const [startH, startM] = (settings.officeStart || '10:10').split(':').map(Number);
  const graceMinutes = Number(settings.graceMinutes ?? 10);
  const expectedStartTime = startH * 60 + startM;
  const actualTime = now.getHours() * 60 + now.getMinutes();

  let status: 'present' | 'late' = 'present';
  if (actualTime > expectedStartTime + graceMinutes) {
    status = 'late';
  }

  const reviewStatus: 'none' | 'pending' = verified ? 'none' : 'pending';

  const punchInMeta = {
    ip: clientIp,
    lat,
    lng,
    accuracy,
    distanceM: closestDistanceM < 9999999 ? closestDistanceM : null,
    ipMatched,
    geoMatched,
    verified,
    method: policy.mode,
    userAgent: request.rawRequest?.headers?.['user-agent'] || '',
    time: now.toISOString(),
  };

  await attendanceRef.set(
    {
      uid,
      date: dateStr,
      checkIn: now.toISOString(),
      status,
      punchInMeta,
      reviewStatus,
    },
    { merge: true }
  );

  return {
    status,
    verified,
    reviewStatus,
    checkIn: now.toISOString(),
    distanceM: punchInMeta.distanceM,
  };
});

export const punchOut = onCall(async (request) => {
  const context = request;
  const data = request.data || {};

  if (!context.auth) throw new HttpsError('unauthenticated', 'Not signed in');

  const uid = context.auth.uid;
  const { lat = 0, lng = 0, accuracy = 999999 } = data;
  const clientIp = data?.clientIp || getClientIp(request.rawRequest);

  const { now, dateStr } = getISTDateTime();
  const docId = `${uid}_${dateStr}`;
  const attendanceRef = db.collection('attendance').doc(docId);

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists || userDoc.data()?.role !== 'employee') {
    throw new HttpsError('failed-precondition', 'Attendance marking is only for employees.');
  }

  return await db.runTransaction(async (transaction: Transaction) => {
    const doc = await transaction.get(attendanceRef);
    if (!doc.exists || !doc.data()?.checkIn) {
      throw new HttpsError('failed-precondition', 'Must punch in first');
    }

    const attData = doc.data()!;
    if (attData.checkOut) {
      throw new HttpsError('failed-precondition', 'Already punched out today');
    }

    const checkInTime = new Date(attData.checkIn).getTime();
    const workedMinutes = Math.max(0, Math.floor((now.getTime() - checkInTime) / 60000));

    const settingsDoc = await transaction.get(db.collection('settings').doc('company'));
    const settings = settingsDoc.data() || {};
    const halfDayMinutes = Number(settings.halfDayMinutes || 270); // 4.5h

    let status = attData.status;
    if (workedMinutes < halfDayMinutes) {
      status = 'half-day';
    }

    const punchOutMeta = {
      ip: clientIp,
      lat,
      lng,
      accuracy,
      time: now.toISOString(),
      userAgent: request.rawRequest?.headers?.['user-agent'] || '',
    };

    transaction.update(attendanceRef, {
      checkOut: now.toISOString(),
      workedMinutes,
      status,
      punchOutMeta,
    });

    return {
      success: true,
      workedMinutes,
      status,
      checkOut: now.toISOString(),
    };
  });
});

// -------------------------------------------------------------
// 3. Leave Actions: approveLeave, rejectLeave, cancelLeave
// -------------------------------------------------------------
export const approveLeave = onCall(async (request) => {
  const context = request;
  const data = request.data || {};

  if (
    !context.auth ||
    (context.auth.token.role !== 'manager' && context.auth.token.role !== 'admin')
  ) {
    throw new HttpsError('permission-denied', 'Managers and Admins only');
  }

  const { requestId, comment = '' } = data;
  if (!requestId) {
    throw new HttpsError('invalid-argument', 'Missing requestId');
  }

  const leaveRef = db.collection('leaveRequests').doc(requestId);

  return await db.runTransaction(async (transaction: Transaction) => {
    const doc = await transaction.get(leaveRef);
    if (!doc.exists) throw new HttpsError('not-found', 'Leave request not found');

    const leaveData = doc.data()!;
    if (leaveData.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Leave is not pending');
    }

    const year = leaveData.startDate.split('-')[0];
    const balanceRef = db.collection('leaveBalances').doc(`${leaveData.uid}_${year}`);
    const balanceDoc = await transaction.get(balanceRef);

    let balanceData = balanceDoc.data();
    if (!balanceData) {
      balanceData = {
        uid: leaveData.uid,
        year,
        balances: { unified: { allotted: 18, used: 0 } },
      };
    }

    const currentUsed = balanceData.balances?.unified?.used || 0;
    const currentAllotted = balanceData.balances?.unified?.allotted || 18;
    const daysRequested = Number(leaveData.days || 1);

    if (currentUsed + daysRequested > currentAllotted) {
      throw new HttpsError(
        'failed-precondition',
        `Insufficient leave balance. Remaining: ${currentAllotted - currentUsed}, Requested: ${daysRequested}`
      );
    }

    balanceData.balances.unified.used = currentUsed + daysRequested;

    transaction.set(balanceRef, balanceData, { merge: true });
    transaction.update(leaveRef, {
      status: 'approved',
      decidedBy: context.auth!.uid,
      decidedByName: context.auth!.token.name || context.auth!.token.email || 'Manager',
      managerComment: comment,
      decidedAt: new Date().toISOString(),
    });

    // Write audit log
    const auditRef = db.collection('auditLogs').doc();
    transaction.set(auditRef, {
      actorUid: context.auth!.uid,
      actorName: context.auth!.token.name || context.auth!.token.email || 'Manager',
      action: 'APPROVE_LEAVE',
      targetId: requestId,
      before: { status: 'pending' },
      after: { status: 'approved', managerComment: comment, days: daysRequested },
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  });
});

export const rejectLeave = onCall(async (request) => {
  const context = request;
  const data = request.data || {};

  if (
    !context.auth ||
    (context.auth.token.role !== 'manager' && context.auth.token.role !== 'admin')
  ) {
    throw new HttpsError('permission-denied', 'Managers and Admins only');
  }

  const { requestId, comment = '' } = data;
  if (!requestId) {
    throw new HttpsError('invalid-argument', 'Missing requestId');
  }

  const leaveRef = db.collection('leaveRequests').doc(requestId);

  return await db.runTransaction(async (transaction: Transaction) => {
    const doc = await transaction.get(leaveRef);
    if (!doc.exists) throw new HttpsError('not-found', 'Leave request not found');

    const leaveData = doc.data()!;
    if (leaveData.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Leave is not pending');
    }

    transaction.update(leaveRef, {
      status: 'rejected',
      decidedBy: context.auth!.uid,
      decidedByName: context.auth!.token.name || context.auth!.token.email || 'Manager',
      managerComment: comment,
      decidedAt: new Date().toISOString(),
    });

    const auditRef = db.collection('auditLogs').doc();
    transaction.set(auditRef, {
      actorUid: context.auth!.uid,
      actorName: context.auth!.token.name || context.auth!.token.email || 'Manager',
      action: 'REJECT_LEAVE',
      targetId: requestId,
      before: { status: 'pending' },
      after: { status: 'rejected', managerComment: comment },
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  });
});

export const cancelLeave = onCall(async (request) => {
  const context = request;
  const data = request.data || {};

  if (!context.auth) throw new HttpsError('unauthenticated', 'Not signed in');

  const { requestId } = data;
  if (!requestId) {
    throw new HttpsError('invalid-argument', 'Missing requestId');
  }

  const leaveRef = db.collection('leaveRequests').doc(requestId);

  return await db.runTransaction(async (transaction: Transaction) => {
    const doc = await transaction.get(leaveRef);
    if (!doc.exists) throw new HttpsError('not-found', 'Leave request not found');

    const leaveData = doc.data()!;
    const isOwner = leaveData.uid === context.auth!.uid;
    const isPrivileged =
      context.auth!.token.role === 'manager' || context.auth!.token.role === 'admin';

    if (!isOwner && !isPrivileged) {
      throw new HttpsError('permission-denied', 'Not authorized to cancel this leave');
    }

    if (leaveData.status === 'cancelled' || leaveData.status === 'rejected') {
      throw new HttpsError('failed-precondition', 'Leave is already cancelled or rejected');
    }

    // If leave was approved, restore the used balance
    if (leaveData.status === 'approved') {
      const year = leaveData.startDate.split('-')[0];
      const balanceRef = db.collection('leaveBalances').doc(`${leaveData.uid}_${year}`);
      const balanceDoc = await transaction.get(balanceRef);
      if (balanceDoc.exists) {
        const balanceData = balanceDoc.data()!;
        const currentUsed = balanceData.balances?.unified?.used || 0;
        const restoredUsed = Math.max(0, currentUsed - Number(leaveData.days || 1));
        balanceData.balances.unified.used = restoredUsed;
        transaction.set(balanceRef, balanceData, { merge: true });
      }
    }

    transaction.update(leaveRef, {
      status: 'cancelled',
      decidedAt: new Date().toISOString(),
    });

    const auditRef = db.collection('auditLogs').doc();
    transaction.set(auditRef, {
      actorUid: context.auth!.uid,
      actorName: context.auth!.token.name || context.auth!.token.email || 'User',
      action: 'CANCEL_LEAVE',
      targetId: requestId,
      before: { status: leaveData.status },
      after: { status: 'cancelled' },
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  });
});

// -------------------------------------------------------------
// 4. Flagged Punch Review & Attendance Correction
// -------------------------------------------------------------
export const reviewPunch = onCall(async (request) => {
  const context = request;
  const data = request.data || {};

  if (
    !context.auth ||
    (context.auth.token.role !== 'manager' && context.auth.token.role !== 'admin')
  ) {
    throw new HttpsError('permission-denied', 'Managers and Admins only');
  }

  const { attendanceId, action, comment = '' } = data; // action: 'approve' | 'reject'
  if (!attendanceId || !action) {
    throw new HttpsError('invalid-argument', 'Missing attendanceId or action');
  }

  const attRef = db.collection('attendance').doc(attendanceId);

  return await db.runTransaction(async (transaction: Transaction) => {
    const doc = await transaction.get(attRef);
    if (!doc.exists) throw new HttpsError('not-found', 'Attendance record not found');

    const att = doc.data()!;
    const before = { status: att.status, reviewStatus: att.reviewStatus };

    let newStatus = att.status;
    let newReviewStatus: 'approved' | 'rejected' = action === 'approve' ? 'approved' : 'rejected';

    if (action === 'approve') {
      // If punch was flagged, convert to present (or keep late if punched late)
      if (att.status === 'pending_review' || att.status === 'absent') {
        newStatus = 'present';
      }
    } else {
      // Rejected flagged punch
      newStatus = 'absent';
    }

    transaction.update(attRef, {
      status: newStatus,
      reviewStatus: newReviewStatus,
      managerComment: comment,
      reviewedBy: context.auth!.uid,
      reviewedAt: new Date().toISOString(),
    });

    const auditRef = db.collection('auditLogs').doc();
    transaction.set(auditRef, {
      actorUid: context.auth!.uid,
      actorName: context.auth!.token.name || context.auth!.token.email || 'Manager',
      action: action === 'approve' ? 'APPROVE_FLAGGED_PUNCH' : 'REJECT_FLAGGED_PUNCH',
      targetId: attendanceId,
      before,
      after: { status: newStatus, reviewStatus: newReviewStatus, comment },
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  });
});

export const adminCorrectAttendance = onCall(async (request) => {
  const context = request;
  const data = request.data || {};

  if (!context.auth || context.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admins only');
  }

  const { attendanceId, checkIn, checkOut, status, note } = data;
  if (!attendanceId) {
    throw new HttpsError('invalid-argument', 'attendanceId is required');
  }

  const attRef = db.collection('attendance').doc(attendanceId);
  const doc = await attRef.get();
  const before = doc.exists ? doc.data() : null;

  let workedMinutes = doc.exists ? doc.data()?.workedMinutes || 0 : 0;
  if (checkIn && checkOut) {
    const inTime = new Date(checkIn).getTime();
    const outTime = new Date(checkOut).getTime();
    workedMinutes = Math.max(0, Math.floor((outTime - inTime) / 60000));
  }

  const updates: any = {
    status,
    note: note || 'Admin correction',
    correctedBy: context.auth.uid,
    correctedAt: new Date().toISOString(),
  };
  if (checkIn) updates.checkIn = checkIn;
  if (checkOut) {
    updates.checkOut = checkOut;
    updates.workedMinutes = workedMinutes;
  }

  await attRef.set(updates, { merge: true });

  await db.collection('auditLogs').add({
    actorUid: context.auth.uid,
    actorName: context.auth.token.name || context.auth.token.email || 'Admin',
    action: 'ADMIN_CORRECT_ATTENDANCE',
    targetId: attendanceId,
    before,
    after: updates,
    timestamp: new Date().toISOString(),
  });

  return { success: true };
});

// -------------------------------------------------------------
// 5. Regularization Requests
// -------------------------------------------------------------
export const requestRegularization = onCall(async (request) => {
  const context = request;
  const data = request.data || {};

  if (!context.auth) throw new HttpsError('unauthenticated', 'Not signed in');
  if (context.auth.token.role !== 'employee') {
    throw new HttpsError('permission-denied', 'Regularization is only for employees.');
  }

  const { date, requestedIn, requestedOut, reason } = data;
  if (!date || !requestedIn || !requestedOut || !reason) {
    throw new HttpsError('invalid-argument', 'Missing regularization details');
  }

  const regRef = await db.collection('regularizations').add({
    uid: context.auth.uid,
    userName: context.auth.token.name || context.auth.token.email || 'Employee',
    date,
    requestedIn,
    requestedOut,
    reason,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });

  return { id: regRef.id };
});

export const reviewRegularization = onCall(async (request) => {
  const context = request;
  const data = request.data || {};

  if (
    !context.auth ||
    (context.auth.token.role !== 'manager' && context.auth.token.role !== 'admin')
  ) {
    throw new HttpsError('permission-denied', 'Managers and Admins only');
  }

  const { regularizationId, action, comment = '' } = data;
  if (!regularizationId || !action) {
    throw new HttpsError('invalid-argument', 'Missing parameters');
  }

  const regRef = db.collection('regularizations').doc(regularizationId);

  return await db.runTransaction(async (transaction: Transaction) => {
    const regDoc = await transaction.get(regRef);
    if (!regDoc.exists) throw new HttpsError('not-found', 'Regularization not found');

    const reg = regDoc.data()!;
    if (reg.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Regularization is not pending');
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    transaction.update(regRef, {
      status: newStatus,
      comment,
      decidedBy: context.auth!.uid,
      decidedAt: new Date().toISOString(),
    });

    if (action === 'approve') {
      // Update or create attendance record
      const attId = `${reg.uid}_${reg.date}`;
      const attRef = db.collection('attendance').doc(attId);

      const inDate = new Date(`${reg.date}T${reg.requestedIn}:00+05:30`);
      const outDate = new Date(`${reg.date}T${reg.requestedOut}:00+05:30`);
      const workedMinutes = Math.max(0, Math.floor((outDate.getTime() - inDate.getTime()) / 60000));

      const settingsDoc = await transaction.get(db.collection('settings').doc('company'));
      const settings = settingsDoc.data() || {};
      const halfDayMinutes = Number(settings.halfDayMinutes || 270);
      const attStatus = workedMinutes >= halfDayMinutes ? 'present' : 'half-day';

      transaction.set(
        attRef,
        {
          uid: reg.uid,
          date: reg.date,
          checkIn: inDate.toISOString(),
          checkOut: outDate.toISOString(),
          workedMinutes,
          status: attStatus,
          note: `Regularized: ${reg.reason}`,
          reviewStatus: 'none',
        },
        { merge: true }
      );
    }

    const auditRef = db.collection('auditLogs').doc();
    transaction.set(auditRef, {
      actorUid: context.auth!.uid,
      actorName: context.auth!.token.name || context.auth!.token.email || 'Manager',
      action: action === 'approve' ? 'APPROVE_REGULARIZATION' : 'REJECT_REGULARIZATION',
      targetId: regularizationId,
      before: { status: 'pending' },
      after: { status: newStatus, comment },
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  });
});

// -------------------------------------------------------------
// 6. Scheduled Background Jobs
// -------------------------------------------------------------
export const nightlyAttendanceJob = onSchedule(
  { schedule: '59 23 * * *', timeZone: 'Asia/Kolkata' },
  async () => {
    const { dateStr } = getISTDateTime();
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat

    const settingsDoc = await db.collection('settings').doc('company').get();
    const settings = settingsDoc.data() || {};
    const weeklyOffs: number[] = settings.weeklyOffs || [0, 6];

    // Check if weekend
    if (weeklyOffs.includes(dayOfWeek)) {
      return;
    }

    // Check if holiday
    const holidayDoc = await db.collection('holidays').doc(dateStr).get();
    if (holidayDoc.exists) {
      return;
    }

    // Fetch active users
    const usersSnap = await db.collection('users').where('isActive', '==', true).get();

    for (const userDoc of usersSnap.docs) {
      if (userDoc.data()?.role !== 'employee') continue;
      const uid = userDoc.id;
      const attId = `${uid}_${dateStr}`;
      const attDoc = await db.collection('attendance').doc(attId).get();

      if (!attDoc.exists) {
        // Check if user had an approved leave for today
        const leaveSnap = await db
          .collection('leaveRequests')
          .where('uid', '==', uid)
          .where('status', '==', 'approved')
          .where('startDate', '<=', dateStr)
          .get();

        const onLeave = leaveSnap.docs.some(doc => {
          const lData = doc.data();
          const end = lData.endDate || lData.startDate;
          return end >= dateStr;
        });

        if (onLeave) {
          await db.collection('attendance').doc(attId).set({
            uid,
            date: dateStr,
            status: 'leave',
            note: 'Approved Leave',
            reviewStatus: 'none',
          });
        } else {
          // Absent
          await db.collection('attendance').doc(attId).set({
            uid,
            date: dateStr,
            status: 'absent',
            note: 'Marked absent by nightly attendance job',
            reviewStatus: 'none',
          });
        }
      }
    }

    return;
  }
);

export const monthlyLeaveAllocation = onSchedule(
  { schedule: '0 0 1 * *', timeZone: 'Asia/Kolkata' },
  async () => {
    const { dateStr } = getISTDateTime();
    const year = dateStr.split('-')[0];

    const usersSnap = await db.collection('users').where('isActive', '==', true).get();
    const batch = db.batch();

    for (const userDoc of usersSnap.docs) {
      if (userDoc.data()?.role !== 'employee') continue;
      const uid = userDoc.id;
      const balanceRef = db.collection('leaveBalances').doc(`${uid}_${year}`);
      const balanceDoc = await balanceRef.get();

      if (balanceDoc.exists) {
        const data = balanceDoc.data()!;
        const currentAllotted = data.balances?.unified?.allotted || 0;
        batch.update(balanceRef, {
          'balances.unified.allotted': currentAllotted + 1.5,
        });
      } else {
        batch.set(balanceRef, {
          uid,
          year,
          balances: {
            unified: {
              allotted: 1.5,
              used: 0,
            },
          },
        });
      }
    }

    await batch.commit();
    return;
  }
);

export const yearlyReset = onSchedule(
  { schedule: '0 0 1 1 *', timeZone: 'Asia/Kolkata' },
  async () => {
    const { dateStr } = getISTDateTime();
    const newYear = dateStr.split('-')[0];

    const usersSnap = await db.collection('users').where('isActive', '==', true).get();
    const batch = db.batch();

    for (const userDoc of usersSnap.docs) {
      if (userDoc.data()?.role !== 'employee') continue;
      const uid = userDoc.id;
      const balanceRef = db.collection('leaveBalances').doc(`${uid}_${newYear}`);
      batch.set(balanceRef, {
        uid,
        year: newYear,
        balances: {
          unified: {
            allotted: 18,
            used: 0,
          },
        },
      });
    }

    await batch.commit();
    return;
  }
);

export const locationRetentionJob = onSchedule(
  { schedule: '0 2 * * 0', timeZone: 'Asia/Kolkata' }, // Weekly on Sunday 2:00 AM IST
  async () => {
    // 180 days retention
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - 180);
    const retentionDateStr = retentionDate.toISOString().split('T')[0];

    const oldRecords = await db
      .collection('attendance')
      .where('date', '<', retentionDateStr)
      .limit(500)
      .get();

    const batch = db.batch();
    for (const doc of oldRecords.docs) {
      batch.update(doc.ref, {
        'punchInMeta.lat': FieldValue.delete(),
        'punchInMeta.lng': FieldValue.delete(),
        'punchInMeta.ip': FieldValue.delete(),
        'punchOutMeta.lat': FieldValue.delete(),
        'punchOutMeta.lng': FieldValue.delete(),
        'punchOutMeta.ip': FieldValue.delete(),
      });
    }

    await batch.commit();
    return;
  }
);