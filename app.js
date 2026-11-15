// ============================================================================
// EDUPLUS PORTAL - SHARED ENGINE (app.js)
// Centralized Firebase, Paystack, Auth Guard, Dashboards & Interactive Features
// ============================================================================

// --- 1. CONFIGURATION ---
const PAYSTACK_PUBLIC_KEY = "pk_live_3aae1eec1c5298079ca3d9013fd99929c56110d8";

const PRICING = {
  studentRegistration: 20,
  studentResubscribe: 20,
  lecturerRegistration: 50,
  lecturerResubscribe: 50,
  findAccount: 0,
  forgotPassword: 0
};

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;
const RESET_LINK_TTL_MS = 10 * 60 * 1000;
const RESET_RESEND_COOLDOWN_MS = 60 * 1000;
const RECOVERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_SESSION_KEY = 'eduplusSmallPasswordResetSession';
const STUDENT_LEVELS = ['Level 100', 'Level 200', 'Level 300', 'Level 400', 'Postgraduate'];

const firebaseConfig = {
  apiKey: "AIzaSyD4cilr7LTZcl8uCTgWECi82kcdipzEMfo",
  authDomain: "jr-anonymous-questions.firebaseapp.com",
  projectId: "jr-anonymous-questions",
  storageBucket: "jr-anonymous-questions.firebasestorage.app",
  messagingSenderId: "966568815274",
  appId: "1:966568815274:web:92f27d8f06efa775513ed3"
};

// Initialize Firebase v8
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db   = firebase.firestore();

// --- 2. GLOBAL STATE ---
let currentRole = null;          // 'student' | 'lecturer'
let currentUserData = null;      // Cached Firestore user profile
let currentCourseCode = null;    // Active course code
let currentCourseInstanceKey = null; // Active course offering identity
let lastRenderedCoursesSignature = '';
let activeStudentTab = 'anon';
let activeLecturerTab = 'anon';
let searchTargetRole = 'student';
let pendingGoogleUser = null;
let findAccountCache = [];
let activeCoursesCache = [];
let archivedCoursesCache = [];
let studentActiveCoursesLoaded = false;
let studentArchivedCoursesLoaded = false;
let resetCountdownInterval = null;
let resetExpiryShown = false;
let pendingPasswordResetCode = '';
let pendingPasswordResetEmail = '';

// Real-time Firestore Listeners
let unsubQuestions = null;
let unsubAnswers = null;
let unsubCourses = null;
let unsubArchivedCourses = null;
let unsubSelf = null;

// Anti-spam rate limiting
let lastQuestionSentTime = 0;
let lastAnswerSentTime = 0;

// Camera capture state
let activeCameraTargetPreview = null;
let activeCameraTargetData = null;
let cameraStream = null;

// Network status
let isUserOffline = !navigator.onLine;
let offlineActionTimeout = null;

// Verification timer
let resendTimer = 60;
let resendInterval = null;

// --- 3. SANITIZATION & STRING UTILITIES ---
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeInput(str) {
  if (!str) return '';
  return String(str)
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim();
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const cleanEmail = email.trim().toLowerCase();
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(cleanEmail);
}

function formatTime(date) {
  if (!date) return '';
  var d = typeof date.toDate === 'function' ? date.toDate() : new Date(date);
  var h = d.getHours();
  var m = d.getMinutes();
  var ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  var mStr = m < 10 ? '0' + m : m;
  var day = d.getDate();
  var mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  return mon + ' ' + day + ', ' + h + ':' + mStr + ' ' + ampm;
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  var parts = email.split('@');
  var name = parts[0];
  if (name.length <= 2) return name[0] + '***@' + parts[1];
  return name[0] + '***' + name[name.length - 1] + '@' + parts[1];
}

// --- 4. TOAST NOTIFICATIONS & LOADING OVERLAY ---
function showLoading(text) {
  var overlay = document.getElementById('loadingOverlay');
  var textEl = document.getElementById('loadingText');
  if (textEl) textEl.textContent = text || 'Loading...';
  if (overlay) overlay.classList.add('active');
}

function hideLoading() {
  var overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.remove('active');
}

function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  var t = document.createElement('div');
  t.className = 'toast';

  var iconMap = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
  var iconSpan = document.createElement('span');
  iconSpan.className = 'material-icons';
  iconSpan.style.fontSize = '20px';
  iconSpan.style.color = type === 'error' ? '#ef4444' : (type === 'success' ? '#22c55e' : (type === 'warning' ? '#f59e0b' : '#38bdf8'));
  iconSpan.textContent = iconMap[type] || 'info';

  var textNode = document.createElement('span');
  textNode.textContent = message;

  t.appendChild(iconSpan);
  t.appendChild(textNode);
  container.appendChild(t);

  setTimeout(function() {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s ease';
    setTimeout(function() { if (t.parentNode) t.remove(); }, 350);
  }, 4500);
}

function openModal(modalId) {
  var m = document.getElementById(modalId);
  if (m) m.classList.add('active');
}

function closeModal(modalId) {
  var m = document.getElementById(modalId);
  if (m) m.classList.remove('active');
}

// --- 5. NETWORK & OFFLINE MONITOR ---
window.addEventListener('online', function() {
  isUserOffline = false;
  var overlay = document.getElementById('offlineOverlay');
  if (overlay && overlay.classList.contains('active')) {
    showLoading('Restoring connection & re-syncing data...');
    setTimeout(function() {
      overlay.classList.remove('active');
      hideLoading();
      showToast('Internet connection restored!', 'success');
      if (currentRole === 'student' && currentCourseCode) {
        loadQuestionsForStudent(currentCourseCode);
        loadAnswersForStudent(currentCourseCode);
      } else if (currentRole === 'lecturer' && currentCourseCode) {
        loadQuestionsForLecturer();
        loadAnswersForLecturer();
      }
    }, 2000);
  }
});

window.addEventListener('offline', function() {
  isUserOffline = true;
});

function verifyConnectionBeforeAction(onSuccessCallback) {
  if (isUserOffline || !navigator.onLine) {
    showLoading('Connecting...');
    clearTimeout(offlineActionTimeout);
    offlineActionTimeout = setTimeout(function() {
      hideLoading();
      var overlay = document.getElementById('offlineOverlay');
      if (overlay) overlay.classList.add('active');
    }, 1200);
    return false;
  }
  if (onSuccessCallback) onSuccessCallback();
  return true;
}

// --- 6. DATE, COURSE OFFERING & PROFILE HELPERS ---
function parseSubscriptionTimestamp(value) {
  if (!value) return 0;
  if (typeof value === 'number') {
    if (!isFinite(value) || value <= 0) return 0;
    return value < 1000000000000 ? value * 1000 : value;
  }
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') {
    try { return value.toDate().getTime(); } catch (e) { return 0; }
  }
  if (value.seconds !== undefined) {
    var seconds = Number(value.seconds) || 0;
    var nanos = Number(value.nanoseconds) || 0;
    return seconds * 1000 + Math.floor(nanos / 1000000);
  }
  if (value instanceof Date) return value.getTime();
  var parsed = Date.parse(value);
  return isNaN(parsed) ? 0 : parsed;
}

function formatSubscriptionDate(timestamp) {
  if (!timestamp) return 'date unavailable';
  try {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch (e) {
    return 'date unavailable';
  }
}

function getSubscriptionExpiry(userOrDate) {
  if (!userOrDate) return 0;
  if (typeof userOrDate === 'object' && (userOrDate.subscriptionExpiresAt !== undefined || userOrDate.lastPaymentDate !== undefined)) {
    var expiry = parseSubscriptionTimestamp(userOrDate.subscriptionExpiresAt);
    if (expiry) return expiry;
    var legacy = parseSubscriptionTimestamp(userOrDate.lastPaymentDate);
    return legacy ? legacy + ONE_MONTH_MS : 0;
  }
  return parseSubscriptionTimestamp(userOrDate);
}

function isSubscriptionActive(user) {
  var expiry = getSubscriptionExpiry(user);
  return expiry > Date.now();
}

function isSubscriptionInGracePeriod(user) {
  var expiry = getSubscriptionExpiry(user);
  if (!expiry) return false;
  var now = Date.now();
  return now >= expiry && (now - expiry) <= GRACE_PERIOD_MS;
}

function canAccessPortal(user) {
  return isSubscriptionActive(user) || isSubscriptionInGracePeriod(user);
}

function getDaysRemaining(user) {
  var expiry = getSubscriptionExpiry(user);
  if (!expiry) return 0;
  var diff = expiry - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getSubscriptionStatus(user) {
  if (isSubscriptionActive(user)) return 'active';
  if (isSubscriptionInGracePeriod(user)) return 'grace_period';
  return 'expired';
}

function normalizeCourseCode(value) {
  return (value || '').toString().trim().toUpperCase();
}

function getStoredCourseCode(course) {
  return normalizeCourseCode(course && (course.courseCode || course.code));
}

function getStoredCourseTitle(course) {
  return ((course && (course.courseTitle || course.title)) || '').toString().trim();
}

function getCourseOfferingNumber(course) {
  return Math.max(1, Number(course && (course.offering || course.offeringNumber)) || 1);
}

function makeCourseInstanceKey(code) {
  var cleanCode = normalizeCourseCode(code).replace(/[^A-Z0-9_-]/g, '_') || 'COURSE';
  return 'course_' + cleanCode + '_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
}

function getCourseInstanceKey(course) {
  if (!course) return '';
  if (course.instanceKey) return String(course.instanceKey);
  if (course.courseInstanceKey) return String(course.courseInstanceKey);
  return 'legacy::' + getStoredCourseCode(course);
}

function normalizeCourseTitleKey(value) {
  return (value || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
}

function makeCourseIdentityKey(code, title) {
  return normalizeCourseCode(code) + '::' + normalizeCourseTitleKey(title);
}

function formatCourseTitleWithOffering(course) {
  var title = getStoredCourseTitle(course) || getStoredCourseCode(course) || 'Course';
  var offering = getCourseOfferingNumber(course);
  return offering > 1 ? title + ' · Offering ' + offering : title;
}

function getArchivedCourseRecords(code) {
  var list = Array.isArray(archivedCoursesCache) ? archivedCoursesCache : [];
  if (!code) return list.slice();
  var key = normalizeCourseCode(code);
  return list.filter(function(c) { return c && normalizeCourseCode(c.courseCode || c.code) === key; });
}

function getNewestArchivedCourseRecord(code) {
  var list = getArchivedCourseRecords(code);
  if (!list.length) return null;
  return list.slice().sort(function(a, b) {
    return (getCourseOfferingNumber(a) - getCourseOfferingNumber(b)) ||
      ((Number(a.closedAt) || 0) - (Number(b.closedAt) || 0));
  }).pop();
}

function courseClosureReasonText(archived) {
  if (!archived) return 'This course is no longer registered by any lecturer.';
  if (archived.closedReason === 'lecturer_account_deleted') {
    return 'The lecturer deleted their account, so this course was automatically unregistered.';
  }
  return 'The lecturer unregistered this course.';
}

function getActiveCourseByCode(code) {
  var key = normalizeCourseCode(code);
  return activeCoursesCache.find(function(c) {
    return c && normalizeCourseCode(c.courseCode || c.code) === key;
  }) || null;
}

function setJoinedCourseInstanceKey(user, code, instanceKey) {
  if (!user || !instanceKey) return false;
  var key = normalizeCourseCode(code);
  if (!key) return false;
  if (!user.joinedCourseKeys || typeof user.joinedCourseKeys !== 'object' || Array.isArray(user.joinedCourseKeys)) {
    user.joinedCourseKeys = {};
  }
  if (String(user.joinedCourseKeys[key] || '') === String(instanceKey)) return false;
  user.joinedCourseKeys[key] = String(instanceKey);
  return true;
}

async function getNextCourseOffering(code, title) {
  var key = normalizeCourseCode(code);
  if (!key) return 1;
  var identityKey = makeCourseIdentityKey(key, title);
  var titleKey = normalizeCourseTitleKey(title);
  var maxOffering = 0;

  try {
    var snap = await db.collection('archivedCourses').where('courseCode', '==', key).get();
    snap.forEach(function(doc) {
      var data = doc.data() || {};
      var sameIdentity = data.identityKey
        ? String(data.identityKey) === identityKey
        : normalizeCourseTitleKey(data.courseTitle || data.title) === titleKey;
      if (sameIdentity) maxOffering = Math.max(maxOffering, getCourseOfferingNumber(data));
    });
  } catch (err) {
    console.warn('Could not read archived course offerings:', err);
  }

  getArchivedCourseRecords(key).forEach(function(record) {
    var sameIdentity = record.identityKey
      ? String(record.identityKey) === identityKey
      : normalizeCourseTitleKey(record.courseTitle || record.title) === titleKey;
    if (sameIdentity) maxOffering = Math.max(maxOffering, getCourseOfferingNumber(record));
  });

  return maxOffering + 1;
}

async function archiveCourseOfferingRecord(course, options) {
  if (!course) return null;
  options = options || {};
  var code = getStoredCourseCode(course);
  if (!code) return null;
  var title = getStoredCourseTitle(course) || code;
  var instanceKey = getCourseInstanceKey(course);
  var snapshot = {
    code: code,
    title: title,
    courseCode: code,
    courseTitle: title,
    identityKey: course.identityKey || makeCourseIdentityKey(code, title),
    instanceKey: instanceKey,
    offering: getCourseOfferingNumber(course),
    lecturerUid: course.lecturerUid || options.lecturerUid || '',
    lecturerName: course.lecturerName || options.lecturerName || '',
    lecturerEmail: course.lecturerEmail || options.lecturerEmail || '',
    lecturerPhoto: course.lecturerPhoto || options.lecturerPhoto || '',
    status: options.closedReason === 'lecturer_account_deleted' ? 'lecturer_deleted' : 'deregistered',
    closedReason: options.closedReason || 'lecturer_unregistered',
    closedAt: Date.now(),
    closedBy: options.closedBy || '',
    closedByName: options.closedByName || '',
    startedAt: Number(course.createdAt) || Date.now()
  };

  try {
    var ref = await db.collection('archivedCourses').add(snapshot);
    snapshot.id = ref.id;
  } catch (err) {
    console.warn('Could not archive the closed course offering:', err);
    snapshot.id = 'local_archive_' + code + '_' + Date.now();
  }

  archivedCoursesCache = [snapshot].concat(archivedCoursesCache.filter(function(item) {
    return !item || String(item.instanceKey) !== String(instanceKey);
  }));
  return snapshot;
}

async function stampCourseContentWithOffering(course) {
  if (!course) return 0;
  var code = getStoredCourseCode(course);
  var instanceKey = getCourseInstanceKey(course);
  if (!code || !instanceKey) return 0;

  var stamped = 0;
  var collections = ['questions', 'answers'];
  for (var c = 0; c < collections.length; c++) {
    var name = collections[c];
    try {
      var snap = await db.collection(name).where('courseCode', '==', code).get();
      var refs = [];
      snap.forEach(function(doc) {
        var data = doc.data() || {};
        if (!data.courseInstanceKey) refs.push(doc.ref);
      });
      for (var start = 0; start < refs.length; start += 400) {
        var batch = db.batch();
        refs.slice(start, start + 400).forEach(function(ref) {
          batch.set(ref, { courseInstanceKey: instanceKey }, { merge: true });
        });
        await batch.commit();
      }
      stamped += refs.length;
    } catch (err) {
      console.warn('Could not stamp ' + name + ' with the course offering:', err);
    }
  }
  return stamped;
}

async function backfillJoinedCourseKeysForOffering(course) {
  var code = getStoredCourseCode(course);
  var instanceKey = getCourseInstanceKey(course);
  if (!code || !instanceKey) return 0;

  try {
    var snap = await db.collection('students').where('joinedCourses', 'array-contains', code).get();
    var writes = [];
    snap.forEach(function(doc) {
      var data = doc.data() || {};
      var map = (data.joinedCourseKeys && typeof data.joinedCourseKeys === 'object' && !Array.isArray(data.joinedCourseKeys))
        ? data.joinedCourseKeys : {};
      if (map[code]) return;
      var nextMap = Object.assign({}, map);
      nextMap[code] = String(instanceKey);
      writes.push(db.collection('students').doc(doc.id).set({
        joinedCourseKeys: nextMap
      }, { merge: true }).catch(function(err) {
        console.warn('Membership backfill notice:', err);
      }));
    });
    await Promise.all(writes);
    return writes.length;
  } catch (err) {
    console.warn('Membership backfill notice:', err);
    return 0;
  }
}

function getJoinedCourseInstanceKey(user, code) {
  if (!user) return null;
  var key = normalizeCourseCode(code);
  if (!key) return null;
  var joined = (user.joinedCourses || []).some(function(c) {
    return normalizeCourseCode(c) === key;
  });
  if (!joined) return null;
  var map = (user.joinedCourseKeys && typeof user.joinedCourseKeys === 'object' && !Array.isArray(user.joinedCourseKeys))
    ? user.joinedCourseKeys : {};
  if (map[key]) return String(map[key]);
  var active = activeCoursesCache.find(function(c) { return c.courseCode === key; });
  if (active) return active.instanceKey;
  var archived = archivedCoursesCache.filter(function(c) { return c.courseCode === key; })
    .sort(function(a, b) {
      return (getCourseOfferingNumber(a) - getCourseOfferingNumber(b)) ||
        ((Number(a.closedAt) || 0) - (Number(b.closedAt) || 0));
    }).pop();
  return archived ? archived.instanceKey : null;
}

function recordMatchesCourseOffering(record, expectedKey) {
  if (!record || !expectedKey) return true;
  var recordKey = record.courseInstanceKey ? String(record.courseInstanceKey) : '';
  if (recordKey) return recordKey === String(expectedKey);
  // Legacy documents were created before offerings existed. They belong only to
  // the legacy offering, never to a freshly registered course with the same code.
  return String(expectedKey).indexOf('legacy::') === 0;
}

function normalizeUserProfile(data, role, uid) {
  var profile = Object.assign({}, data || {});
  profile.uid = uid || profile.uid || profile.id || '';
  profile.id = profile.uid;
  profile.role = role || profile.role || 'student';
  profile.name = (profile.name || '').toString().trim();
  profile.email = (profile.email || '').toString().trim().toLowerCase();
  profile.indexNumber = (profile.indexNumber || profile.studentId || '').toString().trim().toUpperCase();
  profile.level = profile.level || (profile.role === 'student' ? 'Level 100' : '');
  profile.photoURL = profile.photoURL || profile.avatar || '';
  profile.deletedAt = Number(profile.deletedAt) || 0;
  profile.disabled = profile.disabled === true;
  profile.joinedCourses = Array.isArray(profile.joinedCourses)
    ? profile.joinedCourses.map(normalizeCourseCode).filter(Boolean) : [];
  profile.joinedCourseKeys = (profile.joinedCourseKeys && typeof profile.joinedCourseKeys === 'object' && !Array.isArray(profile.joinedCourseKeys))
    ? Object.assign({}, profile.joinedCourseKeys) : {};
  if (!profile.subscriptionExpiresAt && profile.lastPaymentDate) {
    var legacyExpiry = parseSubscriptionTimestamp(profile.lastPaymentDate);
    if (legacyExpiry) profile.subscriptionExpiresAt = legacyExpiry + ONE_MONTH_MS;
  }
  profile.subscriptionExpiresAt = parseSubscriptionTimestamp(profile.subscriptionExpiresAt);
  profile.subscriptionStatus = getSubscriptionStatus(profile);
  return profile;
}

function formatStudentIdentity(profile) {
  if (!profile) return 'Student';
  var parts = [profile.name || 'Student'];
  if (profile.level) parts.push(profile.level);
  if (profile.indexNumber) parts.push('ID: ' + profile.indexNumber);
  if (profile.email) parts.push('(' + profile.email + ')');
  return parts.join(' | ');
}

function formatLecturerIdentity(profile) {
  if (!profile) return 'Lecturer';
  return (profile.name || 'Lecturer') + (profile.email ? ' (' + profile.email + ')' : '');
}

function isAccountDeletionExpired(profile) {
  var deletedAt = Number(profile && profile.deletedAt) || 0;
  return !!deletedAt && (Date.now() - deletedAt >= RECOVERY_WINDOW_MS);
}

function userHasPasswordProvider(user) {
  if (!user || !Array.isArray(user.providerData)) return false;
  return user.providerData.some(function(provider) { return provider.providerId === 'password'; });
}

function userHasGoogleProvider(user) {
  if (!user || !Array.isArray(user.providerData)) return false;
  return user.providerData.some(function(provider) { return provider.providerId === 'google.com'; });
}

async function deleteDocumentsFromQueries(queries) {
  var refs = [];
  var seen = {};
  for (var i = 0; i < queries.length; i++) {
    var snap = await queries[i].get();
    snap.forEach(function(doc) {
      if (!seen[doc.id]) {
        seen[doc.id] = true;
        refs.push(doc.ref);
      }
    });
  }
  for (var start = 0; start < refs.length; start += 400) {
    var batch = db.batch();
    refs.slice(start, start + 400).forEach(function(ref) { batch.delete(ref); });
    await batch.commit();
  }
  return refs.length;
}

async function purgeExpiredAccount(profile, role, uid, authUser) {
  if (!uid || !role) return false;
  try {
    if (role === 'lecturer') {
      var courses = (profile && Array.isArray(profile.courses)) ? profile.courses : [];
      for (var i = 0; i < courses.length; i++) {
        await archiveCourseOfferingRecord(courses[i], {
          closedReason: 'lecturer_account_deleted',
          lecturerUid: uid,
          lecturerName: profile.name || '',
          lecturerEmail: profile.email || '',
          lecturerPhoto: profile.photoURL || '',
          closedBy: profile.email || '',
          closedByName: profile.name || ''
        });
      }
    } else {
      var email = ((profile && profile.email) || '').toLowerCase();
      var queries = [];
      if (email) {
        queries.push(db.collection('questions').where('senderEmail', '==', email));
        queries.push(db.collection('answers').where('studentEmail', '==', email));
      }
      queries.push(db.collection('answers').where('studentUid', '==', uid));
      await deleteDocumentsFromQueries(queries);
    }

    await db.collection(role === 'lecturer' ? 'lecturers' : 'students').doc(uid).delete();

    if (authUser && auth.currentUser && auth.currentUser.uid === uid) {
      try { await authUser.delete(); } catch (err) {
        console.warn('Auth account purge notice:', err);
      }
    }
    return true;
  } catch (err) {
    console.error('Expired account purge failed:', err);
    return false;
  }
}

async function purgeExpiredAccountIfNeeded(profile, role, uid, authUser) {
  if (!profile || !isAccountDeletionExpired(profile)) return false;
  return await purgeExpiredAccount(profile, role, uid, authUser);
}

async function clearAccountDeletionFlags(profile, role, uid) {
  if (!uid || !role) return false;
  try {
    await db.collection(role === 'lecturer' ? 'lecturers' : 'students').doc(uid).set({
      deletedAt: 0,
      disabled: false,
      recoveredAt: Date.now()
    }, { merge: true });
    if (profile) {
      profile.deletedAt = 0;
      profile.disabled = false;
      profile.recoveredAt = Date.now();
    }
    return true;
  } catch (err) {
    console.error('Could not re-enable the recovered account:', err);
    return false;
  }
}

async function fetchUserRecordByUid(uid, roleHint) {
  if (!uid) return null;
  var roles = roleHint ? [roleHint] : ['student', 'lecturer'];
  for (var i = 0; i < roles.length; i++) {
    var role = roles[i];
    var collection = role === 'student' ? 'students' : 'lecturers';
    try {
      var doc = await db.collection(collection).doc(uid).get();
      if (doc.exists) return { uid: uid, role: role, data: normalizeUserProfile(doc.data(), role, uid) };
    } catch (err) {
      console.warn('Profile lookup failed:', err);
    }
  }
  return null;
}

async function lookupAccountByEmail(email) {
  var cleanEmail = sanitizeInput(email).toLowerCase();
  if (!cleanEmail) return null;
  var roles = ['student', 'lecturer'];
  for (var i = 0; i < roles.length; i++) {
    var role = roles[i];
    var collection = role === 'student' ? 'students' : 'lecturers';
    try {
      var snap = await db.collection(collection).where('email', '==', cleanEmail).limit(1).get();
      if (!snap.empty) {
        var doc = snap.docs[0];
        return { uid: doc.id, role: role, data: normalizeUserProfile(doc.data(), role, doc.id) };
      }
    } catch (err) {
      console.warn('Account lookup failed:', err);
    }
  }
  return null;
}

async function accountExistsForEmail(email) {
  var record = await lookupAccountByEmail(email);
  return !!record;
}

// --- 7. SUBSCRIPTION CALCULATIONS ---
function updateSubBadge() {
  if (!currentUserData) return;
  var days = getDaysRemaining(currentUserData);
  var status = getSubscriptionStatus(currentUserData);
  var badgeId = currentRole === 'student' ? 'stuSubBadge' : 'lecSubBadge';
  var metaId = currentRole === 'student' ? 'stuSubMeta' : 'lecSubMeta';
  var badgeEl = document.getElementById(badgeId);
  var metaEl = document.getElementById(metaId);
  var expiry = getSubscriptionExpiry(currentUserData);

  if (badgeEl) {
    if (status === 'active') {
      badgeEl.textContent = 'Active · ' + days + ' day' + (days === 1 ? '' : 's') + ' left';
      badgeEl.style.background = 'rgba(34, 197, 94, 0.15)';
      badgeEl.style.color = '#22c55e';
    } else if (status === 'grace_period') {
      badgeEl.textContent = 'Grace Period';
      badgeEl.style.background = 'rgba(245, 158, 11, 0.18)';
      badgeEl.style.color = '#fbbf24';
    } else {
      badgeEl.textContent = 'Expired';
      badgeEl.style.background = 'rgba(239, 68, 68, 0.15)';
      badgeEl.style.color = '#ef4444';
    }
  }

  if (metaEl) {
    if (status === 'active') {
      metaEl.textContent = 'PayPass expires ' + formatSubscriptionDate(expiry) + ' · ' + days + ' day(s) remaining';
    } else if (status === 'grace_period') {
      metaEl.textContent = 'Expired ' + formatSubscriptionDate(expiry) + ' · 3-day grace period active. Renew to keep access.';
    } else {
      metaEl.textContent = 'Expired ' + formatSubscriptionDate(expiry) + '. Renew your PayPass to continue.';
    }
  }
}

function showSubscriptionRenewalMessage() {
  var isStu = currentRole === 'student';
  var priceStr = isStu ? 'GHS 20.00' : 'GHS 50.00';
  var modalPrice = document.getElementById('renewalModalPrice');
  var modalText = document.getElementById('renewalModalText');
  var expiry = getSubscriptionExpiry(currentUserData);
  if (modalPrice) modalPrice.textContent = priceStr;
  if (modalText) {
    if (isSubscriptionInGracePeriod(currentUserData)) {
      modalText.textContent = 'Your 30-day ' + (isStu ? 'Student' : 'Lecturer') + ' portal pass expired on ' + formatSubscriptionDate(expiry) + '. A 3-day grace period is active, so you can still use the portal. Renew for ' + priceStr + ' to add another full 30 days.';
    } else {
      modalText.textContent = 'Your 30-day ' + (isStu ? 'Student' : 'Lecturer') + ' portal pass expired on ' + formatSubscriptionDate(expiry) + '. Renew for ' + priceStr + ' via Mobile Money or Card to restore full interactive access.';
    }
  }
}

function checkAndEnforceSubscription() {
  if (!currentUserData) return false;
  updateSubBadge();
  var canAccess = canAccessPortal(currentUserData);

  // The dashboard stays visible so an expired user can renew. Interactive
  // actions are still blocked once the 3-day grace period has ended.
  if (!isSubscriptionActive(currentUserData)) {
    showSubscriptionRenewalMessage();
    openModal('subscriptionRenewalModal');
  } else {
    closeModal('subscriptionRenewalModal');
  }
  return canAccess;
}

function openRenewalModalManual() {
  var isStu = currentRole === 'student';
  var priceStr = isStu ? 'GHS 20.00' : 'GHS 50.00';
  var modalPrice = document.getElementById('renewalModalPrice');
  var modalText = document.getElementById('renewalModalText');
  var days = getDaysRemaining(currentUserData);
  if (modalPrice) modalPrice.textContent = priceStr;
  if (modalText) {
    modalText.textContent = 'Extend your 30-day ' + (isStu ? 'Student' : 'Lecturer') + ' portal pass. Renewal cost is ' + priceStr + ' via Mobile Money or Card.' +
      (days > 0 ? ' Any remaining ' + days + ' day(s) will be added to the new pass.' : '');
  }
  openModal('subscriptionRenewalModal');
}

// --- 8. PASSWORD RESET SESSION & ACCOUNT RECOVERY HELPERS ---
function getResetSession() {
  var session = null;
  try {
    session = JSON.parse(localStorage.getItem(RESET_SESSION_KEY) || 'null');
  } catch (e) { session = null; }
  if (!session || !session.email) return null;
  var entitlementEnds = Number(session.entitlementExpiresAt) || 0;
  if (entitlementEnds && Date.now() >= entitlementEnds) {
    clearResetSession();
    return null;
  }
  return session;
}

function saveResetSession(session) {
  try { localStorage.setItem(RESET_SESSION_KEY, JSON.stringify(session)); } catch (e) {}
}

function clearResetSession() {
  try { localStorage.removeItem(RESET_SESSION_KEY); } catch (e) {}
  stopResetLinkTimer();
  var banner = document.getElementById('resetLinkTimerBanner');
  if (banner) banner.style.display = 'none';
}

function stopResetLinkTimer() {
  if (resetCountdownInterval) {
    clearInterval(resetCountdownInterval);
    resetCountdownInterval = null;
  }
  resetExpiryShown = false;
}

function formatCountdown(seconds) {
  var safe = Math.max(0, Math.floor(seconds));
  var mins = Math.floor(safe / 60).toString().padStart(2, '0');
  var secs = (safe % 60).toString().padStart(2, '0');
  return mins + ':' + secs;
}

function updateResetResendButton(session) {
  var btn = document.getElementById('btnResendResetLink');
  if (!btn || !session) return;
  var next = Number(session.nextResendAt) || 0;
  var wait = Math.max(0, Math.ceil((next - Date.now()) / 1000));
  btn.disabled = wait > 0;
  var label = btn.querySelector('span');
  if (label) {
    label.textContent = wait > 0
      ? 'Please wait ' + wait + 's to resend'
      : 'Resend Reset Link (Free)';
  }
}

function startResetLinkTimer(session) {
  stopResetLinkTimer();
  if (!session) return;
  var banner = document.getElementById('resetLinkTimerBanner');
  var countdownEl = document.getElementById('resetLinkCountdown');
  var expiredMsg = document.getElementById('resetLinkExpiredMsg');
  var emailDisplay = document.getElementById('resetTimerEmailDisplay');
  var statusEl = document.getElementById('resetTimerPaidStatus');
  if (!banner || !countdownEl) return;

  banner.style.display = 'block';
  if (emailDisplay) emailDisplay.textContent = 'Sent to: ' + session.email;
  if (expiredMsg) expiredMsg.style.display = 'none';
  if (statusEl) {
    var hoursLeft = Math.max(0, Math.ceil(((Number(session.entitlementExpiresAt) || 0) - Date.now()) / (60 * 60 * 1000)));
    statusEl.textContent = 'Password reset is free. You can resend this link for about ' +
      (hoursLeft > 48 ? Math.ceil(hoursLeft / 24) + ' more day(s)' : hoursLeft + ' more hour(s)') +
      ' without any charge.';
  }

  var tick = function() {
    var current = getResetSession();
    if (!current) {
      stopResetLinkTimer();
      if (banner) banner.style.display = 'none';
      return;
    }
    var remaining = Math.max(0, Math.ceil((Number(current.linkExpiresAt) - Date.now()) / 1000));
    countdownEl.textContent = formatCountdown(remaining);
    countdownEl.style.color = remaining <= 60 ? '#ef4444' : '#fbbf24';
    if (remaining <= 0 && expiredMsg && !resetExpiryShown) {
      expiredMsg.style.display = 'block';
      resetExpiryShown = true;
    }
    updateResetResendButton(current);
  };
  tick();
  resetCountdownInterval = setInterval(tick, 1000);
}

function buildResetActionSettings(session) {
  if (!session) return undefined;
  try {
    var resetUrl = new URL('reset-password.html', window.location.href);
    if (session.role) resetUrl.searchParams.set('role', session.role);
    return {
      url: resetUrl.href,
      handleCodeInApp: true
    };
  } catch (e) {
    return undefined;
  }
}

async function deliverPasswordResetEmail(session) {
  if (!session || !session.email) throw new Error('No password reset request is available.');
  var settings = buildResetActionSettings(session);
  if (settings) {
    try {
      await auth.sendPasswordResetEmail(session.email, settings);
    } catch (err) {
      var fallbackCodes = [
        'auth/unauthorized-continue-uri',
        'auth/invalid-continue-uri',
        'auth/invalid-dynamic-link-domain'
      ];
      if (fallbackCodes.indexOf(err && err.code) === -1) throw err;
      console.warn('Custom reset continue URL rejected; sending standard Firebase reset email.', err);
      await auth.sendPasswordResetEmail(session.email);
    }
  } else {
    await auth.sendPasswordResetEmail(session.email);
  }

  var now = Date.now();
  session.linkSentAt = now;
  session.linkExpiresAt = now + RESET_LINK_TTL_MS;
  session.lastResendAt = now;
  session.nextResendAt = now + RESET_RESEND_COOLDOWN_MS;
  saveResetSession(session);
  startResetLinkTimer(session);
  return session;
}

async function startFreePasswordReset(account, purpose) {
  if (!account || !account.data || !account.data.email) {
    showToast('That account could not be found.', 'error');
    return false;
  }
  var profile = account.data;
  var deletedAt = Number(profile.deletedAt) || 0;
  if (deletedAt && Date.now() - deletedAt >= RECOVERY_WINDOW_MS) {
    showToast('This account’s 30-day recovery window has ended. The account can no longer be recovered.', 'error');
    return false;
  }

  var existing = getResetSession();
  if (existing && existing.email.toLowerCase() === profile.email.toLowerCase() &&
      Number(existing.nextResendAt) > Date.now()) {
    var wait = Math.ceil((Number(existing.nextResendAt) - Date.now()) / 1000);
    startResetLinkTimer(existing);
    showToast('A reset link was just sent. Please wait ' + wait + ' second(s) before requesting another.', 'info');
    return false;
  }

  var now = Date.now();
  var session = {
    email: profile.email,
    userId: account.uid,
    role: account.role,
    purpose: purpose || 'forgotPassword',
    freeReset: true,
    recoveryPending: !!deletedAt,
    paidAt: now,
    entitlementExpiresAt: deletedAt ? deletedAt + RECOVERY_WINDOW_MS : now + ONE_MONTH_MS,
    linkSentAt: 0,
    linkExpiresAt: 0,
    nextResendAt: 0,
    reference: ''
  };

  showLoading('Sending password reset link...');
  try {
    await deliverPasswordResetEmail(session);
    hideLoading();
    var loginEmail = document.getElementById(currentRole === 'lecturer' ? 'lecLoginEmail' : 'stuLoginEmail');
    if (loginEmail) loginEmail.value = profile.email;
    showToast('Password reset link sent to ' + profile.email + '. Check your inbox or spam folder.', 'success');
    return true;
  } catch (err) {
    hideLoading();
    showToast('Failed to send reset email: ' + (err.message || err), 'error');
    return false;
  }
}

async function resendPasswordResetLink() {
  var session = getResetSession();
  if (!session) {
    showToast('No password reset request was found. Please use Forgot Password or Find Account again.', 'error');
    return;
  }
  if (Number(session.nextResendAt) > Date.now()) {
    var wait = Math.ceil((Number(session.nextResendAt) - Date.now()) / 1000);
    showToast('Please wait ' + wait + ' more second(s) before resending.', 'info');
    return;
  }
  showLoading('Sending a fresh password reset link...');
  try {
    await deliverPasswordResetEmail(session);
    hideLoading();
    showToast('A fresh reset link has been sent to ' + session.email + '. Resending is free.', 'success');
  } catch (err) {
    hideLoading();
    showToast(err.message || 'Could not resend the reset link.', 'error');
  }
}

function initLoginPage(role) {
  currentRole = role;
  var params = new URLSearchParams(window.location.search);
  var email = params.get('email');
  var inputId = role === 'lecturer' ? 'lecLoginEmail' : 'stuLoginEmail';
  var emailInput = document.getElementById(inputId);
  if (email && emailInput) emailInput.value = email;

  var noticeBanner = document.getElementById('loginNoticeBanner');
  var noticeText = document.getElementById('loginNoticeText');
  var notice = params.get('notice');
  if (noticeBanner && noticeText) {
    if (notice === 'pending') {
      noticeText.textContent = 'This account is pending deletion. Use Find Account on this page to recover it before the 30-day window ends.';
      noticeBanner.style.display = 'block';
    } else if (notice === 'deleted') {
      noticeText.textContent = 'That account’s 30-day recovery window has ended and it has been permanently deleted. Please register again if needed.';
      noticeBanner.style.display = 'block';
    } else if (notice === 'recovered') {
      noticeText.textContent = 'Your account was recovered and your password was updated. Sign in with your new password to continue.';
      noticeBanner.style.display = 'block';
    } else if (notice === 'reset') {
      noticeText.textContent = 'Your password was updated successfully. Sign in with your new password.';
      noticeBanner.style.display = 'block';
    } else {
      noticeBanner.style.display = 'none';
    }
  }

  var session = getResetSession();
  if (session) startResetLinkTimer(session);
}

// --- 8b. COMPLETE PASSWORD RESET PAGE ---
function initResetPasswordPage() {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('oobCode');
  var mode = params.get('mode');
  var roleParam = params.get('role');
  var form = document.getElementById('resetPasswordForm');
  var statusBox = document.getElementById('resetPasswordStatus');
  var emailDisplay = document.getElementById('resetEmailDisplay');
  var description = document.getElementById('resetPasswordDescription');
  var loginLink = document.getElementById('resetBackToLogin');

  currentRole = (roleParam === 'lecturer') ? 'lecturer' : 'student';
  if (loginLink) loginLink.href = currentRole === 'lecturer' ? 'lecturer-login.html' : 'student-login.html';

  var showStatus = function(message, tone) {
    if (!statusBox) return;
    statusBox.textContent = message;
    statusBox.style.display = 'block';
    statusBox.style.background = tone === 'error' ? 'rgba(239,68,68,0.14)' : 'rgba(34,197,94,0.12)';
    statusBox.style.border = '1px solid ' + (tone === 'error' ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.3)');
    statusBox.style.color = tone === 'error' ? '#fca5a5' : '#86efac';
  };

  if (mode && mode !== 'resetPassword') {
    if (form) form.style.display = 'none';
    showStatus('This link is not a password reset link. Please use Forgot Password or Find Account on the sign-in page.', 'error');
    return;
  }
  if (!code) {
    if (form) form.style.display = 'none';
    showStatus('This reset link is incomplete or has already been used. Request a fresh link from the sign-in page. Resending is free.', 'error');
    return;
  }

  showLoading('Verifying your reset link...');
  auth.verifyPasswordResetCode(code)
    .then(async function(email) {
      pendingPasswordResetCode = code;
      pendingPasswordResetEmail = email;
      if (emailDisplay) emailDisplay.textContent = email;
      var account = await lookupAccountByEmail(email);
      if (account && account.role) {
        currentRole = account.role;
        if (loginLink) loginLink.href = currentRole === 'lecturer' ? 'lecturer-login.html' : 'student-login.html';
      }
      if (description) {
        var pendingDeletion = account && Number(account.data.deletedAt) > 0 && !isAccountDeletionExpired(account.data);
        description.textContent = pendingDeletion
          ? 'After you save a new password, the pending deletion on this account will be cancelled and the account will be re-enabled.'
          : 'Enter and confirm your new password below.';
      }
      hideLoading();
    })
    .catch(function(err) {
      hideLoading();
      if (form) form.style.display = 'none';
      var expired = err && (err.code === 'auth/expired-action-code' || err.code === 'auth/invalid-action-code');
      showStatus(expired
        ? 'This password reset link is invalid or has expired. Request a fresh link from the sign-in page — resending is free.'
        : (err.message || 'This password reset link could not be verified. Request a new one.'), 'error');
    });
}

async function completePasswordReset(event) {
  if (event) event.preventDefault();
  if (!pendingPasswordResetCode || !pendingPasswordResetEmail) {
    showToast('This reset link is no longer available. Request a new one.', 'error');
    return;
  }

  var passEl = document.getElementById('resetNewPassword');
  var confirmEl = document.getElementById('resetConfirmPassword');
  var btn = document.getElementById('btnCompleteReset');
  var newPass = passEl ? passEl.value : '';
  var confirmPass = confirmEl ? confirmEl.value : '';

  if (newPass.length < 6) { showToast('Use a password with at least 6 characters.', 'error'); return; }
  if (newPass !== confirmPass) { showToast('The new passwords do not match.', 'error'); return; }

  if (btn) btn.disabled = true;
  showLoading('Saving your new password...');
  try {
    await auth.confirmPasswordReset(pendingPasswordResetCode, newPass);

    var email = pendingPasswordResetEmail;
    var account = await lookupAccountByEmail(email);
    var role = account ? account.role : (currentRole || 'student');
    var recovered = false;
    var expiredDeletion = false;
    var authUser = null;

    try {
      var cred = await auth.signInWithEmailAndPassword(email, newPass);
      authUser = cred.user;
    } catch (signInErr) {
      console.warn('Automatic sign-in after password reset failed:', signInErr);
    }

    if (account && isAccountDeletionExpired(account.data)) {
      expiredDeletion = true;
      await purgeExpiredAccount(account.data, role, account.uid, authUser);
    } else if (account && Number(account.data.deletedAt) > 0) {
      recovered = await clearAccountDeletionFlags(account.data, role, account.uid);
    }

    var session = getResetSession();
    if (session && session.email && session.email.toLowerCase() === email.toLowerCase()) clearResetSession();

    try { await auth.signOut(); } catch (e) {}

    pendingPasswordResetCode = '';
    pendingPasswordResetEmail = '';
    hideLoading();
    if (btn) btn.disabled = false;

    if (expiredDeletion) {
      showToast('Your password was updated, but this account’s 30-day recovery window had ended and the account was permanently deleted.', 'error');
      window.location.href = 'student-login.html?notice=deleted';
      return;
    }

    if (recovered) {
      showToast('Password reset complete. The pending deletion was cancelled and your account has been re-enabled.', 'success');
      window.location.href = role + '-login.html?email=' + encodeURIComponent(email) + '&notice=recovered';
    } else {
      showToast('Password reset complete. You can now sign in with your new password.', 'success');
      window.location.href = role + '-login.html?email=' + encodeURIComponent(email) + '&notice=reset';
    }
  } catch (err) {
    hideLoading();
    if (btn) btn.disabled = false;
    var expiredCode = err && (err.code === 'auth/expired-action-code' || err.code === 'auth/invalid-action-code');
    showToast(expiredCode
      ? 'This reset link has expired. Use Forgot Password or Find Account to request a fresh link — resending is free.'
      : (err.message || 'Could not reset your password. Please request a fresh link.'), 'error');
  }
}

// --- 7. PAYSTACK INTEGRATION ---
function payWithPaystack(email, amountGhs, description, fullName, onSuccess, onCancel) {
  var cleanEmail = sanitizeInput(email).toLowerCase();
  var nameStr = sanitizeInput(fullName || 'Eduplus Customer').trim();
  
  var nameParts = nameStr.split(' ');
  var firstName = nameParts[0] || 'Eduplus';
  var lastName = nameParts.slice(1).join(' ') || 'User';

  if (typeof PaystackPop === 'undefined') {
    showToast('Payment system failed to load. Please check your internet connection.', 'error');
    return;
  }

  var handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: cleanEmail,
    first_name: firstName,
    last_name: lastName,
    amount: Math.round(amountGhs * 100),
    currency: "GHS",
    channels: ['card', 'mobile_money'],
    ref: 'EDUPLUS_' + Math.floor((Math.random() * 1000000000) + 1),
    metadata: {
      custom_fields: [
        { display_name: "Customer Name", variable_name: "customer_name", value: nameStr },
        { display_name: "Service Description", variable_name: "service", value: description }
      ]
    },
    callback: function(response) {
      onSuccess(response);
    },
    onClose: function() {
      if (onCancel) onCancel();
      else showToast('Payment process was cancelled.', 'info');
    }
  });
  handler.openIframe();
}

function processRenewalPayment() {
  if (!currentUserData || !currentUserData.email) {
    showToast('Session error. Please log in again.', 'error');
    logoutUser();
    return;
  }

  var btnRenew = document.getElementById('btnProcessRenewal');
  if (btnRenew) btnRenew.disabled = true;

  var isStu = currentRole === 'student';
  var amount = isStu ? 20 : 50;
  var desc = (isStu ? 'Student' : 'Lecturer') + ' Monthly Subscription Extension';
  var userName = currentUserData.name || 'Eduplus Customer';

  payWithPaystack(currentUserData.email, amount, desc, userName, async function(resp) {
    showLoading('Extending subscription pass...');
    try {
      var collection = currentRole === 'student' ? 'students' : 'lecturers';
      var now = Date.now();
      var existingExpiry = getSubscriptionExpiry(currentUserData);
      var baseTime = existingExpiry > now ? existingExpiry : now;
      var newExpiry = baseTime + ONE_MONTH_MS;
      var paymentDate = new Date(now);

      await db.collection(collection).doc(currentUserData.uid).set({
        subscriptionStatus: 'active',
        subscriptionExpiresAt: new Date(newExpiry),
        subscriptionPaidAt: now,
        lastSubscribedAt: now,
        lastPaymentDate: paymentDate,
        lastPaymentRef: resp.reference || ''
      }, { merge: true });

      currentUserData.subscriptionStatus = 'active';
      currentUserData.subscriptionExpiresAt = newExpiry;
      currentUserData.subscriptionPaidAt = now;
      currentUserData.lastSubscribedAt = now;
      currentUserData.lastPaymentDate = paymentDate;

      closeModal('subscriptionRenewalModal');
      hideLoading();
      if (btnRenew) btnRenew.disabled = false;
      showToast('PayPass activated! Added 1 full month. You now have ' + getDaysRemaining(currentUserData) + ' day(s) of access left.', 'success');
      updateSubBadge();
    } catch(e) {
      hideLoading();
      if (btnRenew) btnRenew.disabled = false;
      showToast('Failed to update subscription: ' + e.message, 'error');
    }
  }, function() {
    if (btnRenew) btnRenew.disabled = false;
    showToast('Payment cancelled. Pass extension aborted.', 'info');
  });
}

// --- 8. PRE-PAYMENT DUPLICATE EMAIL GUARD ---
async function checkEmailAlreadyRegistered(email) {
  var cleanEmail = sanitizeInput(email).toLowerCase();
  if (!cleanEmail) return { exists: false };

  try {
    var timeoutPromise = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('Timeout')); }, 5000);
    });

    var checkPromise = (async function() {
      var stuSnap = await db.collection('students').where('email', '==', cleanEmail).limit(1).get();
      if (!stuSnap.empty) {
        var stu = stuSnap.docs[0].data() || {};
        return { exists: true, role: 'student', deletedAt: Number(stu.deletedAt) || 0 };
      }

      var lecSnap = await db.collection('lecturers').where('email', '==', cleanEmail).limit(1).get();
      if (!lecSnap.empty) {
        var lec = lecSnap.docs[0].data() || {};
        return { exists: true, role: 'lecturer', deletedAt: Number(lec.deletedAt) || 0 };
      }

      return { exists: false };
    })();

    return await Promise.race([checkPromise, timeoutPromise]);
  } catch(err) {
    console.warn('Email check bypassed:', err);
    return { exists: false };
  }
}

async function checkPrePaymentEmail(role, email) {
  var clean = sanitizeInput(email).toLowerCase();
  var alertEl = document.getElementById(role === 'student' ? 'stuDuplicateAlert' : 'lecDuplicateAlert');
  var alertText = document.getElementById(role === 'student' ? 'stuDuplicateAlertText' : 'lecDuplicateAlertText');
  var regBtn = document.getElementById(role === 'student' ? 'btnStuReg' : 'btnLecReg');

  if (!clean || !isValidEmail(clean)) {
    if (alertEl) alertEl.style.display = 'none';
    if (regBtn) regBtn.disabled = false;
    return;
  }

  try {
    var check = await checkEmailAlreadyRegistered(clean);
    if (check.exists) {
      if (alertEl) alertEl.style.display = 'block';
      if (alertText) {
        alertText.textContent = check.deletedAt
          ? 'The email "' + clean + '" belongs to an account pending deletion. Use Find Account on the sign-in page to recover it within 30 days instead of registering again.'
          : 'The email "' + clean + '" is already registered' + (check.role ? ' as a ' + check.role : '') + '! To avoid accidental duplicate payments, please sign in instead.';
      }
      if (regBtn) regBtn.disabled = true;
      showToast(check.deletedAt ? 'This account is pending deletion. Please recover it instead.' : 'Account already exists for ' + clean + '! Please sign in.', 'error');
    } else {
      if (alertEl) alertEl.style.display = 'none';
      if (regBtn) regBtn.disabled = false;
    }
  } catch(e) {
    console.error(e);
  }
}

async function checkCourseCodeExists(code, excludeLecturerUid) {
  var wanted = normalizeCourseCode(code);
  if (!wanted) return false;
  var snap = await db.collection('lecturers').get();
  var found = false;
  snap.forEach(function(doc) {
    if (excludeLecturerUid && doc.id === excludeLecturerUid) return;
    var data = doc.data();
    if (data.courses && Array.isArray(data.courses)) {
      data.courses.forEach(function(c) {
        if (getStoredCourseCode(c) === wanted) {
          found = true;
        }
      });
    }
  });
  return found;
}

// --- 9. CAMERA & IMAGE CAPTURE SYSTEM ---
function openCameraModal(previewId, dataInputId) {
  activeCameraTargetPreview = previewId;
  activeCameraTargetData = dataInputId;
  openModal('cameraCaptureModal');
  showCameraLiveView(true);
  
  showLoading('Initializing Camera...');
  var video = document.getElementById('cameraVideo');
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
    .then(function(stream) {
      hideLoading();
      cameraStream = stream;
      video.srcObject = stream;
    })
    .catch(function(err) {
      hideLoading();
      closeCameraModal();
      showToast('Could not access camera: ' + err.message, 'error');
    });
}

function closeCameraModal() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(function(track) { track.stop(); });
    cameraStream = null;
  }
  closeModal('cameraCaptureModal');
}

function snapCameraFrame() {
  try {
    var video = document.getElementById('cameraVideo');
    var canvas = document.getElementById('cameraCanvas');
    canvas.width = 240;
    canvas.height = 240;
    
    var ctx = canvas.getContext('2d');
    var minDim = Math.min(video.videoWidth || 320, video.videoHeight || 240);
    var sx = ((video.videoWidth || 320) - minDim) / 2;
    var sy = ((video.videoHeight || 240) - minDim) / 2;
    ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, 240, 240);

    showCameraLiveView(false);
  } catch (err) {
    showToast('Failed to capture image: ' + err.message, 'error');
  }
}

function retakeCameraPhoto() {
  showCameraLiveView(true);
}

function useCapturedPhoto() {
  var base64 = document.getElementById('cameraCanvas').toDataURL('image/jpeg', 0.85);
  setAvatarImage(activeCameraTargetPreview, activeCameraTargetData, base64);
  closeCameraModal();
  showToast('Profile photo added.', 'success');
}

function showCameraLiveView(isLive) {
  var video = document.getElementById('cameraVideo');
  var canvas = document.getElementById('cameraCanvas');
  var liveBtns = document.getElementById('cameraLiveButtons');
  var reviewBtns = document.getElementById('cameraReviewButtons');

  if (video) video.style.display = isLive ? 'block' : 'none';
  if (canvas) canvas.style.display = isLive ? 'none' : 'block';
  if (liveBtns) liveBtns.style.display = isLive ? 'flex' : 'none';
  if (reviewBtns) reviewBtns.style.display = isLive ? 'none' : 'flex';
}

function handleFileSelect(evt, previewId, dataInputId) {
  var file = evt.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file.', 'error');
    return;
  }

  showLoading('Processing Image...');
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 240;
      var ctx = canvas.getContext('2d');
      var minDim = Math.min(img.width, img.height);
      var sx = (img.width - minDim) / 2;
      var sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 240, 240);
      var base64 = canvas.toDataURL('image/jpeg', 0.85);
      setAvatarImage(previewId, dataInputId, base64);
      hideLoading();
      showToast('Profile image loaded!', 'success');
    };
    img.onerror = function() {
      hideLoading();
      showToast('Error reading image file.', 'error');
    };
    img.src = e.target.result;
  };
  reader.onerror = function() {
    hideLoading();
    showToast('Failed to read file.', 'error');
  };
  reader.readAsDataURL(file);
}

function handleUrlImageInput(url, previewId, dataInputId) {
  var cleanUrl = sanitizeInput(url);
  if (!cleanUrl) return;
  setAvatarImage(previewId, dataInputId, cleanUrl);
}

function setAvatarImage(previewId, dataInputId, urlOrBase64) {
  var dataEl = document.getElementById(dataInputId);
  if (dataEl) dataEl.value = urlOrBase64;
  var previewEl = document.getElementById(previewId);
  if (previewEl) {
    if (urlOrBase64) {
      previewEl.innerHTML = '<img src="' + urlOrBase64 + '" class="avatar-img" alt="Profile Preview">';
    } else {
      previewEl.innerHTML = '<span class="material-icons" style="font-size:42px;color:#94a3b8;">account_circle</span>';
    }
  }
}

// Fullscreen Lightbox
function viewPhotoInLightbox(imgSrc, captionText) {
  if (!imgSrc) {
    showToast('No picture uploaded yet.', 'info');
    return;
  }
  var lightbox = document.getElementById('imageLightboxModal');
  var img = document.getElementById('lightboxImage');
  var caption = document.getElementById('lightboxCaption');
  
  if (img) img.src = imgSrc;
  if (caption) caption.textContent = captionText || 'Profile Picture';
  if (lightbox) lightbox.classList.add('active');
}

function closeLightbox(e) {
  if (e) e.stopPropagation();
  var lightbox = document.getElementById('imageLightboxModal');
  if (lightbox) lightbox.classList.remove('active');
}

// --- 10. FORGOT PASSWORD & FIND ACCOUNT (FREE RESET LINKS) ---
async function openForgotPassword(role) {
  currentRole = role || currentRole || 'student';
  if (!verifyConnectionBeforeAction()) return;

  var emailInput = role === 'student'
    ? document.getElementById('stuLoginEmail')
    : document.getElementById('lecLoginEmail');
  var email = emailInput ? sanitizeInput(emailInput.value).toLowerCase() : '';

  if (!email || !isValidEmail(email)) {
    showToast('Please enter your registered account email in the field above first.', 'error');
    return;
  }

  var existing = getResetSession();
  if (existing && existing.email.toLowerCase() === email && Number(existing.nextResendAt) > Date.now()) {
    var wait = Math.ceil((Number(existing.nextResendAt) - Date.now()) / 1000);
    startResetLinkTimer(existing);
    showToast('A reset link was just sent. Please wait ' + wait + ' more second(s) before requesting another.', 'info');
    return;
  }

  showLoading('Checking your account...');
  var account = await lookupAccountByEmail(email);
  hideLoading();
  if (!account) {
    showToast('No EduPlus account was found with this email address. Check the spelling or use Find Account.', 'error');
    return;
  }

  await startFreePasswordReset(account, 'forgotPassword');
}

// Kept as an alias so older page markup cannot call a removed paid flow.
function openPaidForgotPassword(role) {
  return openForgotPassword(role);
}

async function openFindAccountModal(role) {
  searchTargetRole = role || searchTargetRole || 'student';
  currentRole = searchTargetRole;
  var input = document.getElementById('findAccountName');
  var results = document.getElementById('searchResultsContainer');
  var desc = document.getElementById('findAccountRoleDesc');
  if (input) input.value = '';
  if (desc) {
    desc.textContent = 'Type the full or part of the name you used during registration. Locate your account below and click "Reset Password" to receive a reset link by email. This service is free.';
  }
  if (results) {
    results.style.display = 'block';
    results.innerHTML = '<div style="padding:14px;font-size:12.5px;color:#94a3b8;text-align:center;">Loading registered accounts...</div>';
  }
  openModal('findAccountModal');

  try {
    var collection = searchTargetRole === 'student' ? 'students' : 'lecturers';
    var snap = await db.collection(collection).get();
    findAccountCache = [];
    snap.forEach(function(doc) {
      var data = normalizeUserProfile(doc.data(), searchTargetRole, doc.id);
      if (isAccountDeletionExpired(data)) return;
      findAccountCache.push(data);
    });
    renderFindAccountResults('');
  } catch (err) {
    console.error('Find account load error:', err);
    if (results) {
      results.innerHTML = '<div style="padding:12px;font-size:12.5px;color:#ef4444;text-align:center;">Search failed. Please check your connection.</div>';
    }
  }
}

function renderFindAccountResults(term) {
  var container = document.getElementById('searchResultsContainer');
  if (!container) return;
  term = (term || '').toLowerCase().trim();
  if (!term) {
    container.innerHTML = '<div style="padding:14px;font-size:12.5px;color:#94a3b8;text-align:center;">Type your full or part of your registered name above.</div>';
    return;
  }

  var unique = {};
  findAccountCache.forEach(function(m) {
    var matches = (m.name || '').toLowerCase().indexOf(term) !== -1 ||
      (m.email || '').toLowerCase().indexOf(term) !== -1;
    if (!matches) return;
    var key = (m.email || '').toLowerCase();
    if (key && !unique[key]) unique[key] = m;
  });
  var matches = Object.keys(unique).map(function(key) { return unique[key]; });

  container.innerHTML = '';
  if (!matches.length) {
    var emptyDiv = document.createElement('div');
    emptyDiv.style.padding = '14px';
    emptyDiv.style.fontSize = '12.5px';
    emptyDiv.style.color = '#fca5a5';
    emptyDiv.style.textAlign = 'center';
    emptyDiv.textContent = 'No registered ' + searchTargetRole + ' account matches that name.';
    container.appendChild(emptyDiv);
    return;
  }

  matches.forEach(function(m) {
    var itemDiv = document.createElement('div');
    itemDiv.className = 'search-item';
    itemDiv.style.display = 'flex';
    itemDiv.style.alignItems = 'center';
    itemDiv.style.justifyContent = 'space-between';
    itemDiv.style.gap = '10px';

    var infoDiv = document.createElement('div');
    infoDiv.style.minWidth = '0';

    var titleDiv = document.createElement('div');
    titleDiv.className = 'search-item-title';
    titleDiv.textContent = m.name + (m.indexNumber ? ' (' + m.indexNumber + ')' : '');
    if (m.deletedAt) {
      titleDiv.textContent += ' · Pending Deletion';
    }

    var subDiv = document.createElement('div');
    subDiv.className = 'search-item-sub';
    subDiv.textContent = 'Email: ' + maskEmail(m.email) + (m.level ? ' · ' + m.level : '') + ' — Free password reset';

    infoDiv.appendChild(titleDiv);
    infoDiv.appendChild(subDiv);

    var resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn-primary btn-small';
    resetBtn.style.flexShrink = '0';
    resetBtn.textContent = 'Reset Password';
    resetBtn.onclick = function() { requestPasswordResetForAccount(m.uid); };

    itemDiv.appendChild(infoDiv);
    itemDiv.appendChild(resetBtn);
    container.appendChild(itemDiv);
  });
}

function searchAccountsByName(term) {
  renderFindAccountResults(term);
}

async function requestPasswordResetForAccount(uid) {
  var account = findAccountCache.find(function(m) { return m.uid === uid; });
  if (!account) {
    showToast('Selected account could not be found. Please search again.', 'error');
    return;
  }
  if (isAccountDeletionExpired(account)) {
    showToast('This account’s 30-day recovery window has ended. It can no longer be recovered.', 'error');
    return;
  }
  var sent = await startFreePasswordReset({
    uid: account.uid,
    role: searchTargetRole,
    data: account
  }, account.deletedAt ? 'findAccount' : 'findAccount');
  if (sent) {
    closeModal('findAccountModal');
    showToast(account.deletedAt
      ? 'Free reset link sent. Completing the reset will also cancel the pending deletion.'
      : 'Free password reset link sent. Check your inbox or spam folder.', 'success');
  }
}

// --- 11. REGISTRATION SYSTEM (PAYSTACK GHS 20 / GHS 50) ---
async function registerUser(role) {
  var name, email, pass, confirmPass, indexNumber, level, courseCode, courseTitle, photoURL;
  var btnId = role === 'student' ? 'btnStuReg' : 'btnLecReg';
  var btnEl = document.getElementById(btnId);

  var currentUser = auth.currentUser;
  var isGoogleAuth = userHasGoogleProvider(currentUser);

  if (role === 'student') {
    name        = sanitizeInput(document.getElementById('stuRegName').value);
    indexNumber = sanitizeInput(document.getElementById('stuRegIndex').value).toUpperCase();
    email       = sanitizeInput(document.getElementById('stuRegEmail').value).toLowerCase();
    level       = document.getElementById('stuRegLevel') ? document.getElementById('stuRegLevel').value : 'Level 100';
    pass        = document.getElementById('stuRegPass') ? document.getElementById('stuRegPass').value : '';
    confirmPass = document.getElementById('stuRegPassConfirm') ? document.getElementById('stuRegPassConfirm').value : '';
    photoURL    = document.getElementById('stuRegPhotoData') ? document.getElementById('stuRegPhotoData').value : '';
  } else {
    name        = sanitizeInput(document.getElementById('lecRegName').value);
    email       = sanitizeInput(document.getElementById('lecRegEmail').value).toLowerCase();
    courseCode  = sanitizeInput(document.getElementById('lecRegCourseCode').value).toUpperCase();
    courseTitle = sanitizeInput(document.getElementById('lecRegCourseTitle').value);
    pass        = document.getElementById('lecRegPass') ? document.getElementById('lecRegPass').value : '';
    confirmPass = document.getElementById('lecRegPassConfirm') ? document.getElementById('lecRegPassConfirm').value : '';
    photoURL    = document.getElementById('lecRegPhotoData') ? document.getElementById('lecRegPhotoData').value : '';
  }

  if (isGoogleAuth && currentUser && currentUser.email) {
    email = currentUser.email.toLowerCase();
    var emailField = document.getElementById(role === 'student' ? 'stuRegEmail' : 'lecRegEmail');
    if (emailField) emailField.value = email;
  }

  // A Firebase password account can exist without a Firestore profile if a previous
  // registration was interrupted after payment. Resuming must not charge twice.
  var isPasswordResume = !!(currentUser && !isGoogleAuth && currentUser.email &&
    currentUser.email.toLowerCase() === email);

  if (!name) { showToast('Please enter your full name.', 'error'); return; }
  if (!email || !isValidEmail(email)) { showToast('Please enter a valid email address.', 'error'); return; }
  if (!isGoogleAuth && !isPasswordResume) {
    if (!pass || pass.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
    if (pass !== confirmPass) { showToast('The passwords do not match. Please re-enter them.', 'error'); return; }
  }
  if (role === 'student' && STUDENT_LEVELS.indexOf(level) === -1) level = 'Level 100';

  if (role === 'lecturer') {
    if (!courseCode) { showToast('Please enter an initial course code.', 'error'); return; }
    if (!courseTitle) { showToast('Please enter an initial course title.', 'error'); return; }
  }

  showLoading('Verifying details...');

  try {
    var check = await checkEmailAlreadyRegistered(email);
    if (check.exists) {
      hideLoading();
      if (btnEl) btnEl.disabled = false;
      if (check.deletedAt) {
        showToast('This email belongs to an account pending deletion. Use Find Account on the sign-in page to recover it within 30 days instead of registering again.', 'error');
      } else {
        showToast('This email is already registered' + (check.role ? ' as a ' + check.role : '') + '. Please sign in instead.', 'error');
      }
      return;
    }

    var nextOffering = 1;
    if (role === 'lecturer') {
      var codeExists = await checkCourseCodeExists(courseCode);
      if (codeExists) {
        hideLoading();
        if (btnEl) btnEl.disabled = false;
        showToast('Course code "' + courseCode + '" is currently registered. Choose another code or ask the lecturer to unregister it.', 'error');
        return;
      }
      nextOffering = await getNextCourseOffering(courseCode, courseTitle);
    }
    hideLoading();
  } catch (err) {
    hideLoading();
    showToast('Could not verify your details: ' + (err.message || err), 'error');
    return;
  }

  var amount = role === 'student' ? PRICING.studentRegistration : PRICING.lecturerRegistration;
  var desc = (role === 'student' ? 'Student' : 'Lecturer') + ' 30-Day Portal Registration Fee';

  var finalizeRegistration = async function(user, reference) {
    showLoading('Finalizing account and saving profile...');
    try {
      var now = Date.now();

      if (!user) throw new Error('No authentication session is available.');
      try { await user.updateProfile({ displayName: name }); } catch (profileErr) { console.warn(profileErr); }

      var commonData = {
        name: name,
        email: email,
        photoURL: photoURL || user.photoURL || '',
        role: role,
        subscriptionStatus: 'active',
        subscriptionExpiresAt: new Date(now + ONE_MONTH_MS),
        subscriptionPaidAt: now,
        lastSubscribedAt: now,
        lastPaymentDate: new Date(now),
        lastPaymentRef: reference || '',
        deletedAt: 0,
        disabled: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (role === 'student') {
        commonData.indexNumber = indexNumber || '';
        commonData.level = level;
        commonData.joinedCourses = [];
        commonData.joinedCourseKeys = {};
        await db.collection('students').doc(user.uid).set(commonData);
      } else {
        var initialCourse = {
          courseCode: courseCode,
          courseTitle: courseTitle,
          identityKey: makeCourseIdentityKey(courseCode, courseTitle),
          instanceKey: makeCourseInstanceKey(courseCode),
          offering: nextOffering,
          createdAt: now
        };
        commonData.courses = [initialCourse];
        await db.collection('lecturers').doc(user.uid).set(commonData);
      }

      var needsVerificationEmail = !isGoogleAuth && !isPasswordResume;
      if (needsVerificationEmail) {
        try { await user.sendEmailVerification(); } catch (emailErr) { console.warn('Verification email notice:', emailErr); }
      }

      currentRole = role;
      currentUserData = normalizeUserProfile(commonData, role, user.uid);
      hideLoading();
      if (btnEl) btnEl.disabled = false;
      showToast(isPasswordResume ? 'Registration resumed and your profile is ready.' : 'Payment successful! Account registered successfully.', 'success');

      if (isGoogleAuth || isPasswordResume) {
        window.location.href = role === 'student' ? 'student-dashboard.html' : 'lecturer-dashboard.html';
      } else {
        window.location.href = 'verification.html?email=' + encodeURIComponent(email) + '&role=' + role;
      }
    } catch (err) {
      hideLoading();
      if (btnEl) btnEl.disabled = false;
      showToast('Registration error: ' + (err.message || err), 'error');
    }
  };

  if (btnEl) btnEl.disabled = true;

  if (isPasswordResume) {
    await finalizeRegistration(currentUser, 'RESUMED_REGISTRATION');
    return;
  }

  if (currentUser && !isGoogleAuth) {
    try { await auth.signOut(); } catch (e) {}
  }

  payWithPaystack(email, amount, desc, name, function(resp) {
    var finish = async function() {
      try {
        var user;
        if (isGoogleAuth) {
          user = auth.currentUser;
          if (!user || user.email.toLowerCase() !== email) {
            throw new Error('The Google session changed while payment was processing. Please sign in with Google again.');
          }
        } else {
          var cred = await auth.createUserWithEmailAndPassword(email, pass);
          user = cred.user;
        }
        await finalizeRegistration(user, resp && resp.reference);
      } catch (err) {
        hideLoading();
        if (btnEl) btnEl.disabled = false;
        var msg = err && err.code === 'auth/email-already-in-use'
          ? 'An authentication account already exists for this email. Please sign in or use Forgot Password to recover it.'
          : (err.message || 'Registration failed.');
        showToast(msg, 'error');
      }
    };
    finish();
  }, function() {
    if (btnEl) btnEl.disabled = false;
    if (isGoogleAuth) {
      try { auth.signOut(); } catch (e) {}
    }
    showToast('Payment was cancelled. Account registration aborted.', 'info');
  });
}

// Google Auth Handlers
async function handleGoogleSignIn(role) {
  var btnGoogleId = role === 'student' ? 'btnStuGoogleLogin' : 'btnLecGoogleLogin';
  var btnGoogle = document.getElementById(btnGoogleId);
  if (btnGoogle) btnGoogle.disabled = true;

  var provider = new firebase.auth.GoogleAuthProvider();
  showLoading('Connecting with Google...');

  try {
    var result = await auth.signInWithPopup(provider);
    var user = result.user;
    var email = user.email.toLowerCase();

    var primaryCollection = role === 'student' ? 'students' : 'lecturers';
    var otherCollection = role === 'student' ? 'lecturers' : 'students';

    var doc = await db.collection(primaryCollection).doc(user.uid).get();
    var otherDoc = await db.collection(otherCollection).doc(user.uid).get();

    if (otherDoc.exists) {
      await auth.signOut();
      hideLoading();
      if (btnGoogle) btnGoogle.disabled = false;
      var correctRole = role === 'student' ? 'Lecturer' : 'Student';
      showToast('This Google account is registered as a ' + correctRole + '. Please use the ' + correctRole + ' portal.', 'error');
      return;
    }

    if (!doc.exists) {
      if (role === 'student') {
        hideLoading();
        var googleStudentName = sanitizeInput(user.displayName || 'Google Student');
        payWithPaystack(user.email, PRICING.studentRegistration, 'Student 30-Day Portal Registration Fee', googleStudentName, async function(resp) {
          showLoading('Saving student profile...');
          try {
            var now = Date.now();
            var studentData = {
              name: googleStudentName,
              email: email,
              indexNumber: '',
              level: 'Level 100',
              photoURL: user.photoURL || '',
              role: 'student',
              joinedCourses: [],
              joinedCourseKeys: {},
              subscriptionStatus: 'active',
              subscriptionExpiresAt: new Date(now + ONE_MONTH_MS),
              subscriptionPaidAt: now,
              lastSubscribedAt: now,
              lastPaymentDate: new Date(now),
              lastPaymentRef: resp.reference || '',
              deletedAt: 0,
              disabled: false,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await db.collection('students').doc(user.uid).set(studentData);
            hideLoading();
            if (btnGoogle) btnGoogle.disabled = false;
            showToast('Payment successful! Welcome to Eduplus.', 'success');
            window.location.href = 'student-dashboard.html';
          } catch(e) {
            hideLoading();
            if (btnGoogle) btnGoogle.disabled = false;
            showToast('Error saving profile: ' + e.message, 'error');
          }
        }, function() {
          if (btnGoogle) btnGoogle.disabled = false;
          auth.signOut();
          showToast('Payment cancelled. Registration aborted.', 'error');
        });
      } else {
        pendingGoogleUser = user;
        hideLoading();
        if (btnGoogle) btnGoogle.disabled = false;
        var nameInput = document.getElementById('googleLecName');
        if (nameInput) nameInput.value = user.displayName || '';
        openModal('googleLecturerSetupModal');
      }
      return;
    }

    var profile = normalizeUserProfile(doc.data(), role, user.uid);

    if (isAccountDeletionExpired(profile)) {
      await purgeExpiredAccount(profile, role, user.uid, user);
      try { await auth.signOut(); } catch (e) {}
      hideLoading();
      if (btnGoogle) btnGoogle.disabled = false;
      showToast('This account’s 30-day recovery window has ended. The account and its data have been permanently deleted.', 'error');
      return;
    }

    if (profile.deletedAt || profile.disabled) {
      await auth.signOut();
      hideLoading();
      if (btnGoogle) btnGoogle.disabled = false;
      showToast('This account is pending deletion or disabled. Recover it through Find Account before the 30-day period ends.', 'error');
      return;
    }

    currentRole = role;
    currentUserData = profile;
    var resetSession = getResetSession();
    if (resetSession && resetSession.email.toLowerCase() === profile.email.toLowerCase()) clearResetSession();

    hideLoading();
    if (btnGoogle) btnGoogle.disabled = false;
    showToast('Welcome back, ' + currentUserData.name + '!', 'success');
    window.location.href = role === 'student' ? 'student-dashboard.html' : 'lecturer-dashboard.html';
  } catch (err) {
    hideLoading();
    if (btnGoogle) btnGoogle.disabled = false;
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Google Authentication failed: ' + err.message, 'error');
    }
  }
}

async function handleGoogleRegister(role) {
  var provider = new firebase.auth.GoogleAuthProvider();
  showLoading('Connecting with Google...');

  try {
    var result = await auth.signInWithPopup(provider);
    var user = result.user;
    var email = user.email.toLowerCase();

    var emailCheck = await checkEmailAlreadyRegistered(email);
    if (emailCheck.exists) {
      await auth.signOut();
      hideLoading();
      showToast(emailCheck.deletedAt
        ? 'This email belongs to an account pending deletion. Use Find Account on the sign-in page to recover it within 30 days.'
        : 'An account with email "' + email + '" already exists! Please sign in.', 'error');
      window.location.href = role === 'student' ? 'student-login.html' : 'lecturer-login.html';
      return;
    }

    if (role === 'student') {
      var nameEl = document.getElementById('stuRegName');
      var emailEl = document.getElementById('stuRegEmail');
      if (nameEl) nameEl.value = user.displayName || '';
      if (emailEl) {
        emailEl.value = email;
        emailEl.readOnly = true;
      }
      if (user.photoURL) {
        setAvatarImage('stuRegAvatarPreview', 'stuRegPhotoData', user.photoURL);
      }
      hideLoading();
      showToast('Google account linked! Please enter your Index ID and click Pay & Register.', 'success');
    } else {
      var lecNameEl = document.getElementById('lecRegName');
      var lecEmailEl = document.getElementById('lecRegEmail');
      if (lecNameEl) lecNameEl.value = user.displayName || '';
      if (lecEmailEl) {
        lecEmailEl.value = email;
        lecEmailEl.readOnly = true;
      }
      if (user.photoURL) {
        setAvatarImage('lecRegAvatarPreview', 'lecRegPhotoData', user.photoURL);
      }
      hideLoading();
      showToast('Google account linked! Please enter course details and click Pay & Register.', 'success');
    }
  } catch (err) {
    hideLoading();
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Google Registration failed: ' + err.message, 'error');
    }
  }
}

async function submitGoogleLecturerSetup() {
  if (!pendingGoogleUser) return;

  var btnSubmit = document.getElementById('btnSubmitGoogleLec');
  var name = sanitizeInput(document.getElementById('googleLecName').value);
  var courseCode = sanitizeInput(document.getElementById('googleLecCourseCode').value).toUpperCase();
  var courseTitle = sanitizeInput(document.getElementById('googleLecCourseTitle').value);

  if (!name) { showToast('Please enter your full dashboard name.', 'error'); return; }
  if (!courseCode) { showToast('Please enter an initial course code.', 'error'); return; }
  if (!courseTitle) { showToast('Please enter an initial course title.', 'error'); return; }

  if (btnSubmit) btnSubmit.disabled = true;
  closeModal('googleLecturerSetupModal');
  showLoading('Verifying course details...');

  try {
    var exists = await checkCourseCodeExists(courseCode);
    if (exists) {
      hideLoading();
      if (btnSubmit) btnSubmit.disabled = false;
      showToast('Course code "' + courseCode + '" is already registered.', 'error');
      openModal('googleLecturerSetupModal');
      return;
    }
    var nextOffering = await getNextCourseOffering(courseCode, courseTitle);
    hideLoading();

    payWithPaystack(pendingGoogleUser.email, PRICING.lecturerRegistration, 'Lecturer 30-Day Portal Registration Fee', name, async function(resp) {
      showLoading('Finalizing lecturer profile...');
      try {
        var now = Date.now();
        var lecturerData = {
          name: name,
          email: pendingGoogleUser.email.toLowerCase(),
          photoURL: pendingGoogleUser.photoURL || '',
          courses: [{
            courseCode: courseCode,
            courseTitle: courseTitle,
            identityKey: makeCourseIdentityKey(courseCode, courseTitle),
            instanceKey: makeCourseInstanceKey(courseCode),
            offering: nextOffering,
            createdAt: now
          }],
          role: 'lecturer',
          subscriptionStatus: 'active',
          subscriptionExpiresAt: new Date(now + ONE_MONTH_MS),
          subscriptionPaidAt: now,
          lastSubscribedAt: now,
          lastPaymentDate: new Date(now),
          lastPaymentRef: resp.reference || '',
          deletedAt: 0,
          disabled: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('lecturers').doc(pendingGoogleUser.uid).set(lecturerData);
        currentRole = 'lecturer';
        currentUserData = normalizeUserProfile(lecturerData, 'lecturer', pendingGoogleUser.uid);
        pendingGoogleUser = null;

        hideLoading();
        if (btnSubmit) btnSubmit.disabled = false;
        showToast('Payment successful! Lecturer profile created.', 'success');
        window.location.href = 'lecturer-dashboard.html';
      } catch(e) {
        hideLoading();
        if (btnSubmit) btnSubmit.disabled = false;
        showToast('Failed to save profile: ' + e.message, 'error');
      }
    }, function() {
      if (btnSubmit) btnSubmit.disabled = false;
      auth.signOut();
      showToast('Payment cancelled. Account setup aborted.', 'info');
    });

  } catch (err) {
    hideLoading();
    if (btnSubmit) btnSubmit.disabled = false;
    showToast('Failed to complete setup: ' + err.message, 'error');
  }
}

// --- 12. LOGIN USER ---
async function loginUser(role) {
  var email, pass;
  var btnId = role === 'student' ? 'btnStuLogin' : 'btnLecLogin';
  var btnEl = document.getElementById(btnId);

  if (role === 'student') {
    email = sanitizeInput(document.getElementById('stuLoginEmail').value).toLowerCase();
    pass  = document.getElementById('stuLoginPass').value;
  } else {
    email = sanitizeInput(document.getElementById('lecLoginEmail').value).toLowerCase();
    pass  = document.getElementById('lecLoginPass').value;
  }

  if (!email || !isValidEmail(email)) { showToast('Please enter a valid email address.', 'error'); return; }
  if (!pass || pass.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }

  if (btnEl) btnEl.disabled = true;
  showLoading('Signing you in...');

  try {
    var cred = await auth.signInWithEmailAndPassword(email, pass);
    var user = cred.user;

    if (!user.emailVerified) {
      hideLoading();
      if (btnEl) btnEl.disabled = false;
      showToast('Please verify your email address to continue.', 'warning');
      window.location.href = 'verification.html?email=' + encodeURIComponent(email) + '&role=' + role;
      return;
    }

    var collection = role === 'student' ? 'students' : 'lecturers';
    var doc = await db.collection(collection).doc(user.uid).get();

    if (!doc.exists) {
      var otherCollection = role === 'student' ? 'lecturers' : 'students';
      var otherDoc = await db.collection(otherCollection).doc(user.uid).get();
      if (otherDoc.exists) {
        await auth.signOut();
        hideLoading();
        if (btnEl) btnEl.disabled = false;
        var correctRole = role === 'student' ? 'Lecturer' : 'Student';
        showToast('This account is registered as a ' + correctRole + '. Please use the ' + correctRole + ' portal.', 'error');
        return;
      }
      await auth.signOut();
      hideLoading();
      if (btnEl) btnEl.disabled = false;
      showToast('Account record not found. Please register a new account.', 'error');
      return;
    }

    var profile = normalizeUserProfile(doc.data(), role, user.uid);

    if (isAccountDeletionExpired(profile)) {
      await purgeExpiredAccount(profile, role, user.uid, user);
      try { await auth.signOut(); } catch (e) {}
      hideLoading();
      if (btnEl) btnEl.disabled = false;
      showToast('This account’s 30-day recovery window has ended. The account and its data have been permanently deleted.', 'error');
      return;
    }

    if (profile.deletedAt || profile.disabled) {
      await auth.signOut();
      hideLoading();
      if (btnEl) btnEl.disabled = false;
      showToast('This account is pending deletion or disabled. Use Find Account to recover it before the 30-day period ends.', 'error');
      return;
    }

    currentRole = role;
    currentUserData = profile;
    var resetSession = getResetSession();
    if (resetSession && resetSession.email.toLowerCase() === profile.email.toLowerCase()) clearResetSession();

    hideLoading();
    if (btnEl) btnEl.disabled = false;
    showToast('Welcome back, ' + currentUserData.name + '!', 'success');

    window.location.href = role === 'student' ? 'student-dashboard.html' : 'lecturer-dashboard.html';

  } catch (err) {
    hideLoading();
    if (btnEl) btnEl.disabled = false;

    var errStr = JSON.stringify(err);
    if (
      err.code === 'auth/user-not-found' ||
      err.code === 'auth/wrong-password' ||
      err.code === 'auth/invalid-credential' ||
      errStr.includes('INVALID_LOGIN_CREDENTIALS') ||
      (err.message && err.message.includes('INVALID_LOGIN_CREDENTIALS'))
    ) {
      showToast('Wrong email or password, check your email or password and try again.', 'error');
    } else if (err.code === 'auth/user-disabled') {
      showToast('This authentication account is disabled. Use Find Account to recover a pending-deletion account.', 'error');
    } else if (err.code === 'auth/network-request-failed' || (err.message && err.message.includes('Timeout'))) {
      showToast('Network error: Please check your internet connection and try again.', 'error');
    } else {
      showToast(err.message || 'Login failed.', 'error');
    }
  }
}

// --- 13. ROUTE PROTECTION & AUTH GUARD ---
function requireAuth(expectedRole, onReadyCallback) {
  showLoading('Authenticating session...');
  var loginPage = expectedRole === 'student' ? 'student-login.html' : 'lecturer-login.html';
  auth.onAuthStateChanged(async function(user) {
    if (!user) {
      hideLoading();
      window.location.href = loginPage;
      return;
    }

    try {
      var collection = expectedRole === 'student' ? 'students' : 'lecturers';
      var doc = await db.collection(collection).doc(user.uid).get();

      if (!doc.exists) {
        // Check if signed in as opposite role
        var otherCollection = expectedRole === 'student' ? 'lecturers' : 'students';
        var otherDoc = await db.collection(otherCollection).doc(user.uid).get();
        if (otherDoc.exists) {
          hideLoading();
          window.location.href = expectedRole === 'student' ? 'lecturer-dashboard.html' : 'student-dashboard.html';
          return;
        }
        await auth.signOut();
        hideLoading();
        window.location.href = loginPage;
        return;
      }

      var profile = normalizeUserProfile(doc.data(), expectedRole, user.uid);

      if (isAccountDeletionExpired(profile)) {
        await purgeExpiredAccount(profile, expectedRole, user.uid, user);
        try { await auth.signOut(); } catch (e) {}
        hideLoading();
        window.location.href = loginPage + '?notice=deleted';
        return;
      }

      if (profile.deletedAt || profile.disabled) {
        await auth.signOut();
        hideLoading();
        window.location.href = loginPage + '?notice=pending';
        return;
      }

      currentRole = expectedRole;
      currentUserData = profile;

      hideLoading();

      // Check subscription. The dashboard remains usable for renewal even after expiry.
      checkAndEnforceSubscription();

      if (onReadyCallback) {
        onReadyCallback(currentUserData);
      }
    } catch (err) {
      console.error('Auth verification error:', err);
      hideLoading();
      showToast('Failed to verify session: ' + err.message, 'error');
    }
  });
}

// --- 14. LOGOUT & DELETE ACCOUNT ---
async function logoutUser() {
  showLoading('Signing out...');
  closeModal('subscriptionRenewalModal');

  if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }
  if (unsubAnswers) { unsubAnswers(); unsubAnswers = null; }
  if (unsubCourses) { unsubCourses(); unsubCourses = null; }
  if (unsubArchivedCourses) { unsubArchivedCourses(); unsubArchivedCourses = null; }
  if (unsubSelf) { unsubSelf(); unsubSelf = null; }

  try { await auth.signOut(); } catch (e) {}

  currentRole = null;
  currentUserData = null;
  currentCourseCode = null;
  currentCourseInstanceKey = null;
  hideLoading();
  showToast('Signed out successfully.', 'info');
  window.location.href = 'portal-select.html';
}

function openDeleteAccountModal() {
  if (!currentUserData) {
    showToast('Your session is not ready yet. Please try again in a moment.', 'error');
    return;
  }
  var user = auth.currentUser;
  var passwordGroup = document.getElementById('deleteAccountPasswordGroup');
  var googleNote = document.getElementById('deleteAccountGoogleNote');
  var passwordInput = document.getElementById('deleteAccountPassword');
  var googleOnly = !!user && userHasGoogleProvider(user) && !userHasPasswordProvider(user);

  if (passwordInput) passwordInput.value = '';
  if (passwordGroup) passwordGroup.style.display = googleOnly ? 'none' : 'block';
  if (googleNote) googleNote.style.display = googleOnly ? 'block' : 'none';
  openModal('deleteAccountModal');
}

async function deleteAccount() {
  var user = auth.currentUser;
  if (!user) {
    showToast('No active session was found. Please sign in again.', 'error');
    return;
  }

  var btnDelete = document.getElementById('btnConfirmDeleteAccount') || document.getElementById('btnStuDelete');
  var passwordInput = document.getElementById('deleteAccountPassword');
  var password = passwordInput ? passwordInput.value : '';
  var googleOnly = userHasGoogleProvider(user) && !userHasPasswordProvider(user);

  if (!googleOnly && !password) {
    showToast('Please enter your current password to confirm account deletion.', 'error');
    return;
  }

  if (btnDelete) btnDelete.disabled = true;
  showLoading('Processing account deletion...');

  try {
    if (googleOnly) {
      await user.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
    } else {
      var credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
      await user.reauthenticateWithCredential(credential);
    }

    var deletionTime = Date.now();
    var collection = currentRole === 'lecturer' ? 'lecturers' : 'students';
    await db.collection(collection).doc(user.uid).set({
      deletedAt: deletionTime,
      disabled: true
    }, { merge: true });

    if (currentUserData) {
      currentUserData.deletedAt = deletionTime;
      currentUserData.disabled = true;
    }

    if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }
    if (unsubAnswers) { unsubAnswers(); unsubAnswers = null; }
    if (unsubCourses) { unsubCourses(); unsubCourses = null; }
    if (unsubArchivedCourses) { unsubArchivedCourses(); unsubArchivedCourses = null; }
    if (unsubSelf) { unsubSelf(); unsubSelf = null; }

    try { await auth.signOut(); } catch (e) {}

    currentRole = null;
    currentUserData = null;
    currentCourseCode = null;
    currentCourseInstanceKey = null;

    hideLoading();
    if (btnDelete) btnDelete.disabled = false;
    closeModal('deleteAccountModal');
    closeModal('editProfileModal');
    showToast('Account deletion initiated. Your account will be permanently deleted after 30 days. Use Find Account to recover it during this period.', 'success');
    window.location.href = 'portal-select.html';

  } catch (err) {
    hideLoading();
    if (btnDelete) btnDelete.disabled = false;
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      showToast('Incorrect password. Please enter your valid current password to confirm account deletion.', 'error');
    } else if (err.code === 'auth/popup-closed-by-user') {
      showToast('Google confirmation was cancelled. Your account was not deleted.', 'info');
    } else if (err.code === 'auth/requires-recent-login') {
      showToast('For security, please sign out and sign in again, then retry account deletion.', 'error');
    } else {
      showToast('Failed to process account deletion: ' + (err.message || err), 'error');
    }
  }
}

// --- 15. EDIT PROFILE SYSTEM ---
function openProfileModal() {
  if (!currentUserData) {
    showToast('Your profile is still loading. Please try again in a moment.', 'info');
    return;
  }

  var nameEl = document.getElementById('profileEditName');
  var emailEl = document.getElementById('profileEditEmail');
  var currentPassEl = document.getElementById('profileCurrentPass');
  var newPassEl = document.getElementById('profileNewPass');
  var confirmPassEl = document.getElementById('profileConfirmPass');
  var urlInput = document.getElementById('editProfileUrlInput');
  var photoData = document.getElementById('editProfilePhotoData');

  if (nameEl) nameEl.value = currentUserData.name || '';
  if (emailEl) {
    emailEl.value = currentUserData.email || '';
    emailEl.readOnly = true;
  }
  if (currentPassEl) currentPassEl.value = '';
  if (newPassEl) newPassEl.value = '';
  if (confirmPassEl) confirmPassEl.value = '';
  if (urlInput) urlInput.value = '';

  var photoVal = currentUserData.photoURL || '';
  if (photoData) photoData.value = photoVal;
  if (photoVal) {
    setAvatarImage('editProfileAvatarPreview', 'editProfilePhotoData', photoVal);
    if (urlInput && (photoVal.indexOf('http://') === 0 || photoVal.indexOf('https://') === 0)) {
      urlInput.value = photoVal;
    }
  } else {
    var preview = document.getElementById('editProfileAvatarPreview');
    if (preview) preview.innerHTML = '<span class="material-icons" style="font-size:42px;color:#94a3b8;">account_circle</span>';
  }

  var indexGroup = document.getElementById('profileIndexGroup');
  var levelGroup = document.getElementById('profileLevelGroup');
  if (currentRole === 'student') {
    if (indexGroup) {
      indexGroup.style.display = 'block';
      var indexEl = document.getElementById('profileEditIndex');
      if (indexEl) indexEl.value = (currentUserData.indexNumber || '').toUpperCase();
    }
    if (levelGroup) {
      levelGroup.style.display = 'block';
      var levelEl = document.getElementById('profileEditLevel');
      if (levelEl) levelEl.value = currentUserData.level || 'Level 100';
    }
  } else {
    if (indexGroup) indexGroup.style.display = 'none';
    if (levelGroup) levelGroup.style.display = 'none';
  }

  openModal('editProfileModal');
}

async function saveProfileChanges() {
  var btnSave = document.getElementById('btnSaveProfile');
  var nameEl = document.getElementById('profileEditName');
  var indexEl = document.getElementById('profileEditIndex');
  var levelEl = document.getElementById('profileEditLevel');
  var photoEl = document.getElementById('editProfilePhotoData');
  var currPassEl = document.getElementById('profileCurrentPass');
  var newPassEl = document.getElementById('profileNewPass');
  var confirmPassEl = document.getElementById('profileConfirmPass');

  var name = sanitizeInput(nameEl ? nameEl.value : '');
  var indexNumber = currentRole === 'student' && indexEl ? sanitizeInput(indexEl.value).toUpperCase() : '';
  var level = currentRole === 'student' && levelEl ? levelEl.value : '';
  var photoURL = photoEl ? photoEl.value : '';
  var currPass = currPassEl ? currPassEl.value : '';
  var newPass = newPassEl ? newPassEl.value : '';
  var confirmPass = confirmPassEl ? confirmPassEl.value : '';

  if (!name) { showToast('Please enter your full name.', 'error'); return; }
  if (currentRole === 'student' && STUDENT_LEVELS.indexOf(level) === -1) level = 'Level 100';

  if (newPass) {
    if (newPass.length < 6) { showToast('New password must be at least 6 characters.', 'error'); return; }
    if (newPass !== confirmPass) { showToast('The new passwords do not match.', 'error'); return; }
  }

  var user = auth.currentUser;
  if (!user) {
    showToast('No active user session found. Please sign in again.', 'error');
    return;
  }

  var googleOnly = userHasGoogleProvider(user) && !userHasPasswordProvider(user);
  if (newPass && googleOnly) {
    showToast('This account signs in with Google. Manage your password with Google instead.', 'info');
    return;
  }
  if (newPass && !currPass) {
    showToast('Please enter your current password to set a new password.', 'error');
    return;
  }

  if (btnSave) btnSave.disabled = true;
  showLoading('Saving profile changes...');

  try {
    if (newPass) {
      var cred = firebase.auth.EmailAuthProvider.credential(user.email, currPass);
      await user.reauthenticateWithCredential(cred);
      await user.updatePassword(newPass);
    }

    await user.updateProfile({ displayName: name });

    var collectionName = (currentRole === 'student') ? 'students' : 'lecturers';
    var updatePayload = {
      name: name,
      photoURL: photoURL,
      role: currentRole,
      email: (user.email || '').toLowerCase()
    };

    if (currentRole === 'student') {
      updatePayload.indexNumber = indexNumber;
      updatePayload.level = level;
    }

    var docRef = db.collection(collectionName).doc(user.uid);
    await docRef.set(updatePayload, { merge: true });

    var freshDoc = await docRef.get();
    if (freshDoc.exists) {
      currentUserData = normalizeUserProfile(freshDoc.data(), currentRole, freshDoc.id);
    }

    var avatarImgId = currentRole === 'student' ? 'stuDashAvatar' : 'lecDashAvatar';
    var avatarImg = document.getElementById(avatarImgId);
    if (photoURL && avatarImg) {
      avatarImg.src = photoURL;
      avatarImg.style.display = 'block';
    } else if (avatarImg) {
      avatarImg.style.display = 'none';
    }

    if (currentRole === 'student') {
      var infoEl = document.getElementById('stuDashUserInfo');
      if (infoEl) infoEl.textContent = formatStudentIdentity(currentUserData);
      checkStudentIndexPrompt();
    } else {
      var lecInfoEl = document.getElementById('lecDashUserInfo');
      if (lecInfoEl) lecInfoEl.textContent = formatLecturerIdentity(currentUserData);
    }

    closeModal('editProfileModal');
    hideLoading();
    if (btnSave) btnSave.disabled = false;
    showToast('Profile updated successfully!', 'success');

  } catch (err) {
    hideLoading();
    if (btnSave) btnSave.disabled = false;
    var msg = err.message || 'Profile update failed.';
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg = 'Current password is incorrect.';
    showToast(msg, 'error');
  }
}

// --- 16. STUDENT DASHBOARD CONTROLLERS ---
function initStudentDashboard() {
  requireAuth('student', function(userData) {
    updateStudentHeader(userData);
    updateSubBadge();
    checkStudentIndexPrompt();
    loadCoursesForStudent();

    // Attach listeners
    var qInput = document.getElementById('stuQuestionInput');
    if (qInput) {
      qInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendQuestion();
        }
      });
    }

    var aInput = document.getElementById('stuAnswerInput');
    if (aInput) {
      aInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitVerbalAnswer();
        }
      });
    }

    // Real-time self listener
    if (unsubSelf) unsubSelf();
    unsubSelf = db.collection('students').doc(userData.uid).onSnapshot(function(docSnap) {
      if (docSnap.exists) {
        currentUserData = normalizeUserProfile(docSnap.data(), 'student', docSnap.id);
        updateStudentHeader(currentUserData);
        checkStudentIndexPrompt();
        updateSubBadge();
        if (studentActiveCoursesLoaded && studentArchivedCoursesLoaded) renderStudentCourses();
      }
    });
  });
}

function updateStudentHeader(userData) {
  if (!userData) return;
  var userEl = document.getElementById('stuDashUserInfo');
  if (userEl) userEl.textContent = formatStudentIdentity(userData);

  var avatarImg = document.getElementById('stuDashAvatar');
  if (avatarImg) {
    if (userData.photoURL) {
      avatarImg.src = userData.photoURL;
      avatarImg.style.display = 'block';
    } else {
      avatarImg.style.display = 'none';
    }
  }
}

function checkStudentIndexPrompt() {
  var promptBanner = document.getElementById('stuIndexPromptBanner');
  if (!promptBanner || !currentUserData) return;
  if (!currentUserData.indexNumber || currentUserData.indexNumber.trim() === '') {
    promptBanner.style.display = 'flex';
  } else {
    promptBanner.style.display = 'none';
  }
}

function loadCoursesForStudent() {
  var myContainer = document.getElementById('stuMyCoursesContainer');
  if (myContainer && !myContainer.hasChildNodes()) {
    myContainer.innerHTML = '<div class="empty-state"><span class="material-icons">hourglass_empty</span>Loading your courses...</div>';
  }

  studentActiveCoursesLoaded = false;
  studentArchivedCoursesLoaded = false;

  if (unsubCourses) { unsubCourses(); unsubCourses = null; }
  if (unsubArchivedCourses) { unsubArchivedCourses(); unsubArchivedCourses = null; }

  var tryRender = function() {
    if (!studentActiveCoursesLoaded || !studentArchivedCoursesLoaded) return;
    renderStudentCourses();
    var browseModal = document.getElementById('browseCoursesModal');
    if (browseModal && browseModal.classList.contains('active')) renderBrowseCoursesList();
  };

  unsubCourses = db.collection('lecturers').onSnapshot(function(snapshot) {
    var allCourses = [];
    snapshot.forEach(function(doc) {
      var lec = doc.data() || {};
      if (lec.courses && Array.isArray(lec.courses)) {
        lec.courses.forEach(function(c) {
          var code = getStoredCourseCode(c);
          var title = getStoredCourseTitle(c);
          if (code && title) {
            allCourses.push({
              lecturerUid: doc.id,
              lecturerName: lec.name || 'Lecturer',
              lecturerEmail: lec.email || '',
              lecturerPhoto: lec.photoURL || '',
              courseCode: code,
              courseTitle: title,
              instanceKey: getCourseInstanceKey(c),
              offering: getCourseOfferingNumber(c),
              createdAt: Number(c.createdAt) || 0
            });
          }
        });
      }
    });
    allCourses.sort(function(a, b) {
      return (a.courseCode + '::' + a.offering).localeCompare(b.courseCode + '::' + b.offering);
    });
    activeCoursesCache = allCourses;
    studentActiveCoursesLoaded = true;
    tryRender();
  }, function(err) {
    console.warn('Courses listener error:', err);
    studentActiveCoursesLoaded = true;
    tryRender();
  });

  unsubArchivedCourses = db.collection('archivedCourses').onSnapshot(function(snapshot) {
    archivedCoursesCache = [];
    snapshot.forEach(function(doc) {
      var data = doc.data() || {};
      data.id = doc.id;
      if (getStoredCourseCode(data)) archivedCoursesCache.push(data);
    });
    studentArchivedCoursesLoaded = true;
    tryRender();
  }, function(err) {
    console.warn('Archived courses listener error:', err);
    studentArchivedCoursesLoaded = true;
    tryRender();
  });
}

function getStudentMembershipSplit() {
  var activeMemberships = [];
  var closedMemberships = [];
  var seen = {};
  var user = currentUserData;
  if (!user) return { active: activeMemberships, closed: closedMemberships };

  (user.joinedCourses || []).forEach(function(rawCode) {
    var code = normalizeCourseCode(rawCode);
    if (!code || seen[code]) return;
    seen[code] = true;

    var active = getActiveCourseByCode(code);
    var joinedKey = getJoinedCourseInstanceKey(user, code);
    if (active && joinedKey === getCourseInstanceKey(active)) {
      activeMemberships.push(active);
      return;
    }

    var archivedMatch = null;
    if (joinedKey) {
      archivedMatch = getArchivedCourseRecords(code).find(function(a) {
        return getCourseInstanceKey(a) === joinedKey;
      }) || null;
    }
    if (!archivedMatch) archivedMatch = getNewestArchivedCourseRecord(code);
    closedMemberships.push({ code: code, archived: archivedMatch, replacement: active || null });
  });

  return { active: activeMemberships, closed: closedMemberships };
}

function renderStudentCourses() {
  if (!currentUserData) return;
  var container = document.getElementById('stuMyCoursesContainer');
  if (!container) return;
  var closedContainer = document.getElementById('stuClosedCoursesContainer');
  var closedSection = document.getElementById('stuClosedCoursesSection');
  var split = getStudentMembershipSplit();

  if (currentCourseCode) {
    var stillActive = split.active.some(function(c) {
      return normalizeCourseCode(c.courseCode) === normalizeCourseCode(currentCourseCode);
    });
    if (!stillActive) {
      leaveQuestionView();
      showToast('This course offering has been closed by the lecturer. Your card is now in Closed Courses.', 'warning');
    }
  }

  container.innerHTML = '';
  if (split.active.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="material-icons">school</span>You have no active course right now. Click "Browse & Join" to enrol in a lecturer-registered course.</div>';
  }

  split.active.forEach(function(c) {
    var card = document.createElement('div');
    card.className = 'course-card';

    var infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'display:flex;align-items:center;gap:12px;min-width:0;cursor:pointer;flex:1;';
    infoDiv.onclick = function() { selectStudentCourse(c.courseCode); };

    if (c.lecturerPhoto) {
      var lecImg = document.createElement('img');
      lecImg.src = c.lecturerPhoto;
      lecImg.className = 'answer-avatar';
      lecImg.alt = 'Lecturer Avatar';
      lecImg.onclick = function(e) {
        e.stopPropagation();
        viewPhotoInLightbox(c.lecturerPhoto, c.lecturerName + ' Profile');
      };
      infoDiv.appendChild(lecImg);
    } else {
      var icon = document.createElement('span');
      icon.className = 'material-icons';
      icon.style.cssText = 'font-size:28px;color:#94a3b8;';
      icon.textContent = 'co_present';
      infoDiv.appendChild(icon);
    }

    var textWrap = document.createElement('div');
    textWrap.style.minWidth = '0';
    var h4 = document.createElement('h4');
    h4.style.fontSize = '14.5px';
    h4.textContent = c.courseCode + ' — ' + formatCourseTitleWithOffering(c);

    var p = document.createElement('p');
    p.style.fontSize = '12px';
    p.style.color = '#94a3b8';
    p.textContent = 'Lecturer: ' + c.lecturerName;

    textWrap.appendChild(h4);
    textWrap.appendChild(p);
    infoDiv.appendChild(textWrap);

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

    var openBtn = document.createElement('button');
    openBtn.className = 'btn btn-primary btn-small';
    openBtn.textContent = 'Open Class';
    openBtn.onclick = function() { selectStudentCourse(c.courseCode); };

    var removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger btn-small';
    removeBtn.title = 'Remove course from my account';
    removeBtn.innerHTML = '<span class="material-icons" style="font-size:16px;">delete</span>';
    removeBtn.onclick = function() { removeStudentCourse(c.courseCode); };

    actions.appendChild(openBtn);
    actions.appendChild(removeBtn);
    card.appendChild(infoDiv);
    card.appendChild(actions);
    container.appendChild(card);
  });

  if (closedContainer) closedContainer.innerHTML = '';
  if (closedSection) closedSection.style.display = split.closed.length ? 'block' : 'none';

  split.closed.forEach(function(entry) {
    var archived = entry.archived;
    var title = archived ? formatCourseTitleWithOffering(archived) : ('Course ' + entry.code);
    var lecturerName = archived ? (archived.lecturerName || 'Lecturer') : 'Lecturer';
    var card = document.createElement('div');
    card.className = 'course-card';
    card.style.background = 'rgba(239, 68, 68, 0.08)';
    card.style.borderColor = 'rgba(239, 68, 68, 0.3)';

    var infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'min-width:0;flex:1;';
    var h4 = document.createElement('h4');
    h4.style.fontSize = '14.5px';
    h4.textContent = entry.code + ' — ' + title;
    var p = document.createElement('p');
    p.style.fontSize = '12px';
    p.style.color = '#fca5a5';
    p.style.marginTop = '4px';
    p.textContent = courseClosureReasonText(archived) + ' Lecturer: ' + lecturerName;
    var hint = document.createElement('p');
    hint.style.fontSize = '11.5px';
    hint.style.color = '#94a3b8';
    hint.style.marginTop = '4px';
    hint.textContent = 'This card is closed. You will not receive new questions or answers for it.';
    infoDiv.appendChild(h4);
    infoDiv.appendChild(p);
    infoDiv.appendChild(hint);

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap;';

    if (entry.replacement) {
      var rejoinBtn = document.createElement('button');
      rejoinBtn.className = 'btn btn-primary btn-small';
      rejoinBtn.textContent = 'Join new offering';
      rejoinBtn.onclick = function() { joinCourseFromBrowse(entry.code); };
      actions.appendChild(rejoinBtn);
    }

    var removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger btn-small';
    removeBtn.title = 'Remove closed card';
    removeBtn.innerHTML = '<span class="material-icons" style="font-size:16px;">close</span>';
    removeBtn.onclick = function() { removeClosedStudentCourse(entry.code); };
    actions.appendChild(removeBtn);

    card.appendChild(infoDiv);
    card.appendChild(actions);
    if (closedContainer) closedContainer.appendChild(card);
  });
}

function openBrowseCoursesModal() {
  var input = document.getElementById('stuJoinCourseCode');
  if (input) input.value = '';
  renderBrowseCoursesList();
  openModal('browseCoursesModal');
}

function renderBrowseCoursesList() {
  var list = document.getElementById('stuBrowseCoursesList');
  if (!list) return;
  list.innerHTML = '';

  if (!studentActiveCoursesLoaded) {
    list.innerHTML = '<div class="empty-state"><span class="material-icons">hourglass_empty</span>Loading available courses...</div>';
    return;
  }
  if (!activeCoursesCache.length) {
    list.innerHTML = '<div class="empty-state"><span class="material-icons">search_off</span>No active courses are registered by lecturers right now.</div>';
    return;
  }

  activeCoursesCache.forEach(function(c) {
    var card = document.createElement('div');
    card.className = 'course-card';

    var infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'display:flex;align-items:center;gap:12px;min-width:0;flex:1;';
    if (c.lecturerPhoto) {
      var img = document.createElement('img');
      img.src = c.lecturerPhoto;
      img.className = 'answer-avatar';
      img.alt = 'Lecturer Avatar';
      img.onclick = function() { viewPhotoInLightbox(c.lecturerPhoto, c.lecturerName + ' Profile'); };
      infoDiv.appendChild(img);
    } else {
      var icon = document.createElement('span');
      icon.className = 'material-icons';
      icon.style.cssText = 'font-size:28px;color:#94a3b8;';
      icon.textContent = 'co_present';
      infoDiv.appendChild(icon);
    }

    var textWrap = document.createElement('div');
    textWrap.style.minWidth = '0';
    var h4 = document.createElement('h4');
    h4.style.fontSize = '14.5px';
    h4.textContent = c.courseCode + ' — ' + formatCourseTitleWithOffering(c);
    var p = document.createElement('p');
    p.style.fontSize = '12px';
    p.style.color = '#94a3b8';
    p.textContent = 'Lecturer: ' + c.lecturerName;
    textWrap.appendChild(h4);
    textWrap.appendChild(p);
    infoDiv.appendChild(textWrap);

    var joinedKey = getJoinedCourseInstanceKey(currentUserData, c.courseCode);
    var isJoined = joinedKey === getCourseInstanceKey(c) &&
      (currentUserData.joinedCourses || []).some(function(code) {
        return normalizeCourseCode(code) === normalizeCourseCode(c.courseCode);
      });

    if (isJoined) {
      var enrolled = document.createElement('span');
      enrolled.className = 'status-pill status-pill-active';
      enrolled.textContent = 'Enrolled';
      card.appendChild(infoDiv);
      card.appendChild(enrolled);
    } else {
      var joinBtn = document.createElement('button');
      joinBtn.className = 'btn btn-primary btn-small';
      joinBtn.textContent = 'Join Course';
      joinBtn.onclick = function() { joinCourseFromBrowse(c.courseCode); };
      card.appendChild(infoDiv);
      card.appendChild(joinBtn);
    }
    list.appendChild(card);
  });
}

async function resolveActiveCourseForCode(code) {
  var key = normalizeCourseCode(code);
  if (!key) return null;
  var local = getActiveCourseByCode(key);
  if (local) return local;

  try {
    var snapshot = await db.collection('lecturers').get();
    var found = null;
    snapshot.forEach(function(doc) {
      if (found) return;
      var lec = doc.data() || {};
      (lec.courses || []).forEach(function(c) {
        if (found) return;
        if (getStoredCourseCode(c) === key) {
          found = {
            lecturerUid: doc.id,
            lecturerName: lec.name || 'Lecturer',
            lecturerEmail: lec.email || '',
            lecturerPhoto: lec.photoURL || '',
            courseCode: key,
            courseTitle: getStoredCourseTitle(c),
            instanceKey: getCourseInstanceKey(c),
            offering: getCourseOfferingNumber(c),
            createdAt: Number(c.createdAt) || 0
          };
        }
      });
    });
    return found;
  } catch (err) {
    console.warn('Course lookup failed:', err);
    return null;
  }
}

async function persistStudentCourseMembership(course) {
  if (!currentUserData || !course) return false;
  var code = getStoredCourseCode(course);
  var instanceKey = getCourseInstanceKey(course);
  if (!code || !instanceKey) return false;

  if (!Array.isArray(currentUserData.joinedCourses)) currentUserData.joinedCourses = [];
  if (!currentUserData.joinedCourses.some(function(c) { return normalizeCourseCode(c) === code; })) {
    currentUserData.joinedCourses.push(code);
  }
  if (!currentUserData.joinedCourseKeys || typeof currentUserData.joinedCourseKeys !== 'object' || Array.isArray(currentUserData.joinedCourseKeys)) {
    currentUserData.joinedCourseKeys = {};
  }
  currentUserData.joinedCourseKeys[code] = String(instanceKey);

  await db.collection('students').doc(currentUserData.uid).set({
    joinedCourses: currentUserData.joinedCourses,
    joinedCourseKeys: currentUserData.joinedCourseKeys
  }, { merge: true });
  return true;
}

async function joinCourseFromBrowse(code) {
  if (!checkAndEnforceSubscription()) return;
  var course = await resolveActiveCourseForCode(code);
  if (!course) {
    showToast('No active course is registered with code ' + normalizeCourseCode(code) + '. Ask your lecturer for the current course.', 'error');
    return;
  }

  var already = getJoinedCourseInstanceKey(currentUserData, course.courseCode) === getCourseInstanceKey(course) &&
    (currentUserData.joinedCourses || []).some(function(c) { return normalizeCourseCode(c) === normalizeCourseCode(course.courseCode); });
  if (already) {
    closeModal('browseCoursesModal');
    openStudentCourseWorkspace(course);
    showToast('You are already enrolled in this course.', 'info');
    return;
  }

  showLoading('Joining course...');
  try {
    await persistStudentCourseMembership(course);
    hideLoading();
    closeModal('browseCoursesModal');
    renderStudentCourses();
    showToast('Successfully enrolled in ' + course.courseCode +
      (getCourseOfferingNumber(course) > 1 ? ' (Offering ' + getCourseOfferingNumber(course) + ')' : '') + '!', 'success');
    openStudentCourseWorkspace(course);
  } catch (err) {
    hideLoading();
    showToast('Could not join course: ' + (err.message || err), 'error');
  }
}

async function joinStudentCourseByCode() {
  if (!checkAndEnforceSubscription()) return;
  var input = document.getElementById('stuJoinCourseCode');
  var code = normalizeCourseCode(input ? input.value : '');
  if (!code) {
    showToast('Enter a course code to join.', 'error');
    return;
  }

  var course = await resolveActiveCourseForCode(code);
  if (!course) {
    showToast('No active course is registered with code ' + code + '. A closed course cannot receive new questions or answers.', 'error');
    return;
  }

  var already = getJoinedCourseInstanceKey(currentUserData, code) === getCourseInstanceKey(course) &&
    (currentUserData.joinedCourses || []).some(function(c) { return normalizeCourseCode(c) === code; });
  if (already) {
    if (input) input.value = '';
    closeModal('browseCoursesModal');
    openStudentCourseWorkspace(course);
    showToast('You are already enrolled in ' + code + '.', 'info');
    return;
  }

  showLoading('Joining course...');
  try {
    await persistStudentCourseMembership(course);
    hideLoading();
    if (input) input.value = '';
    closeModal('browseCoursesModal');
    renderStudentCourses();
    showToast('Successfully enrolled in ' + code +
      (getCourseOfferingNumber(course) > 1 ? ' (Offering ' + getCourseOfferingNumber(course) + ')' : '') + '!', 'success');
    openStudentCourseWorkspace(course);
  } catch (err) {
    hideLoading();
    showToast('Could not join course: ' + (err.message || err), 'error');
  }
}

function selectStudentCourse(code) {
  var active = getActiveCourseByCode(code);
  if (!active) {
    showToast('That course offering is no longer active. Browse available courses to join the current offering.', 'info');
    openBrowseCoursesModal();
    return;
  }

  var joined = (currentUserData.joinedCourses || []).some(function(c) {
    return normalizeCourseCode(c) === normalizeCourseCode(code);
  });
  if (!joined || getJoinedCourseInstanceKey(currentUserData, code) !== getCourseInstanceKey(active)) {
    showToast('Join this active course offering before opening its classroom.', 'info');
    openBrowseCoursesModal();
    return;
  }

  openStudentCourseWorkspace(active);
}

function openStudentCourseWorkspace(course) {
  if (!course || !checkAndEnforceSubscription()) return;
  var code = getStoredCourseCode(course);
  currentCourseCode = code;
  currentCourseInstanceKey = getCourseInstanceKey(course);

  var nameEl = document.getElementById('stuQCourseName');
  var infoEl = document.getElementById('stuQLecturerInfo');
  var avatarEl = document.getElementById('stuQLecturerAvatar');

  if (nameEl) nameEl.textContent = code + ' — ' + formatCourseTitleWithOffering(course);
  if (infoEl) infoEl.textContent = 'Lecturer: ' + (course.lecturerName || 'Lecturer');
  if (avatarEl) {
    if (course.lecturerPhoto) {
      avatarEl.src = course.lecturerPhoto;
      avatarEl.style.display = 'block';
    } else {
      avatarEl.style.display = 'none';
    }
  }

  var browseView = document.getElementById('stuBrowseView');
  var questionView = document.getElementById('stuQuestionView');
  if (browseView) browseView.style.display = 'none';
  if (questionView) questionView.style.display = 'block';
  var qInput = document.getElementById('stuQuestionInput');
  var aInput = document.getElementById('stuAnswerInput');
  if (qInput) qInput.value = '';
  if (aInput) aInput.value = '';

  switchStudentTab('anon');
  loadQuestionsForStudent(code);
  loadAnswersForStudent(code);
}

async function removeStudentCourse(code) {
  var codeKey = normalizeCourseCode(code);
  var active = getActiveCourseByCode(codeKey);
  var label = active ? formatCourseTitleWithOffering(active) : codeKey;
  if (!confirm('Remove ' + label + ' from your account?\n\nYour submitted questions and verbal answers stay in the course records. You can join this course again later from Browse & Join.')) return;

  showLoading('Removing course...');
  try {
    currentUserData.joinedCourses = (currentUserData.joinedCourses || []).filter(function(c) {
      return normalizeCourseCode(c) !== codeKey;
    });
    if (currentUserData.joinedCourseKeys) delete currentUserData.joinedCourseKeys[codeKey];

    await db.collection('students').doc(currentUserData.uid).set({
      joinedCourses: currentUserData.joinedCourses,
      joinedCourseKeys: currentUserData.joinedCourseKeys || {}
    }, { merge: true });

    hideLoading();
    if (currentCourseCode === codeKey) leaveQuestionView();
    renderStudentCourses();
    showToast('Course ' + codeKey + ' removed from your account.', 'info');
  } catch (err) {
    hideLoading();
    showToast('Could not remove course: ' + (err.message || err), 'error');
  }
}

async function removeClosedStudentCourse(code) {
  var codeKey = normalizeCourseCode(code);
  if (!confirm('Remove the closed course card ' + codeKey + ' from your account?\n\nThis only hides the card on your account. Your archived records stay available.')) return;

  showLoading('Removing closed course card...');
  try {
    currentUserData.joinedCourses = (currentUserData.joinedCourses || []).filter(function(c) {
      return normalizeCourseCode(c) !== codeKey;
    });
    if (currentUserData.joinedCourseKeys) delete currentUserData.joinedCourseKeys[codeKey];
    await db.collection('students').doc(currentUserData.uid).set({
      joinedCourses: currentUserData.joinedCourses,
      joinedCourseKeys: currentUserData.joinedCourseKeys || {}
    }, { merge: true });
    hideLoading();
    renderStudentCourses();
    showToast('Closed course card ' + codeKey + ' removed from your account.', 'info');
  } catch (err) {
    hideLoading();
    showToast('Could not remove the closed card: ' + (err.message || err), 'error');
  }
}

function leaveQuestionView() {
  if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }
  if (unsubAnswers) { unsubAnswers(); unsubAnswers = null; }
  currentCourseCode = null;
  currentCourseInstanceKey = null;
  var browseView = document.getElementById('stuBrowseView');
  var questionView = document.getElementById('stuQuestionView');
  if (browseView) browseView.style.display = 'block';
  if (questionView) questionView.style.display = 'none';
}

function switchStudentTab(tab) {
  activeStudentTab = tab;
  var tabAnonBtn = document.getElementById('tabBtnStuAnon');
  var tabAnsBtn = document.getElementById('tabBtnStuAnswer');
  var contentAnon = document.getElementById('tabContentStuAnon');
  var contentAns = document.getElementById('tabContentStuAnswer');

  if (tab === 'anon') {
    if (tabAnonBtn) tabAnonBtn.classList.add('active');
    if (tabAnsBtn) tabAnsBtn.classList.remove('active');
    if (contentAnon) contentAnon.style.display = 'block';
    if (contentAns) contentAns.style.display = 'none';
  } else {
    if (tabAnsBtn) tabAnsBtn.classList.add('active');
    if (tabAnonBtn) tabAnonBtn.classList.remove('active');
    if (contentAns) contentAns.style.display = 'block';
    if (contentAnon) contentAnon.style.display = 'none';
  }
}

function loadQuestionsForStudent(courseCode) {
  var container = document.getElementById('stuQuestionList');
  var countBadge = document.getElementById('stuQuestionCountBadge');
  if (!container) return;
  container.innerHTML = '<div class="empty-state"><span class="material-icons">hourglass_empty</span>Loading questions...</div>';

  if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }

  unsubQuestions = db.collection('questions')
    .where('courseCode', '==', courseCode)
    .onSnapshot(function(snapshot) {
      container.innerHTML = '';
      var now = Date.now();
      var questions = [];

      snapshot.forEach(function(doc) {
        var data = doc.data();
        if (data.senderEmail !== currentUserData.email.toLowerCase()) return;
        if (!recordMatchesCourseOffering(data, currentCourseInstanceKey)) return;

        data._id = doc.id;
        var ts = data.createdAt ? data.createdAt.toDate() : null;

        if (ts && (now - ts.getTime() > 86400000)) {
          db.collection('questions').doc(doc.id).delete().catch(function(){});
          return;
        }
        data._ts = ts || new Date();
        questions.push(data);
      });

      if (countBadge) countBadge.textContent = questions.length;
      questions.sort(function(a, b) { return a._ts.getTime() - b._ts.getTime(); });

      if (questions.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="material-icons">chat_bubble_outline</span>You have not asked any questions in this course yet.</div>';
        return;
      }

      questions.forEach(function(q, i) {
        var item = document.createElement('div');
        item.className = 'question-item';

        var numDiv = document.createElement('div');
        numDiv.className = 'question-number';
        numDiv.textContent = i + 1;

        var contentDiv = document.createElement('div');
        contentDiv.style.flex = '1';

        var textDiv = document.createElement('div');
        textDiv.className = 'question-text';
        textDiv.textContent = q.text;

        var timeDiv = document.createElement('div');
        timeDiv.className = 'question-time';
        timeDiv.textContent = formatTime(q._ts);

        contentDiv.appendChild(textDiv);
        contentDiv.appendChild(timeDiv);

        var delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger btn-small';
        delBtn.title = 'Delete question';
        delBtn.innerHTML = '<span class="material-icons" style="font-size:16px;">delete</span>';
        delBtn.onclick = function() { studentDeleteSingleQuestion(q._id); };

        item.appendChild(numDiv);
        item.appendChild(contentDiv);
        item.appendChild(delBtn);
        container.appendChild(item);
      });
    }, function(err) {
      console.error('Questions load error:', err);
      container.innerHTML = '<div class="empty-state"><span class="material-icons">error</span>Failed to load questions.</div>';
      if (countBadge) countBadge.textContent = '0';
    });
}

async function sendQuestion() {
  if (!verifyConnectionBeforeAction()) return;
  if (!checkAndEnforceSubscription()) return;

  var input = document.getElementById('stuQuestionInput');
  var sendBtn = document.getElementById('btnSendQuestion');
  var rawText = input ? input.value : '';
  var text = sanitizeInput(rawText);

  if (!text) { showToast('Please type a valid question.', 'error'); return; }
  if (!currentCourseCode) { showToast('No course selected.', 'error'); return; }

  var now = Date.now();
  if (now - lastQuestionSentTime < 3000) {
    var waitSecs = Math.ceil((3000 - (now - lastQuestionSentTime)) / 1000);
    showToast('Please wait ' + waitSecs + ' second(s) before asking another question.', 'warning');
    return;
  }

  input.value = '';
  if (sendBtn) sendBtn.disabled = true;
  showLoading('Sending question anonymously...');

  try {
    await db.collection('questions').add({
      courseCode: currentCourseCode,
      courseInstanceKey: currentCourseInstanceKey || '',
      senderEmail: currentUserData.email.toLowerCase(),
      text: text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    lastQuestionSentTime = Date.now();
    hideLoading();
    if (sendBtn) sendBtn.disabled = false;
    showToast('Question sent anonymously!', 'success');
  } catch (err) {
    hideLoading();
    if (sendBtn) sendBtn.disabled = false;
    showToast('Failed to send question: ' + err.message, 'error');
  }
}

function loadAnswersForStudent(courseCode) {
  var container = document.getElementById('stuAnswerList');
  var countBadge = document.getElementById('stuAnswerCountBadge');
  if (!container) return;
  container.innerHTML = '<div class="empty-state"><span class="material-icons">hourglass_empty</span>Loading your answers...</div>';

  if (unsubAnswers) { unsubAnswers(); unsubAnswers = null; }

  unsubAnswers = db.collection('answers')
    .where('courseCode', '==', courseCode)
    .onSnapshot(function(snapshot) {
      container.innerHTML = '';
      var answers = [];

      snapshot.forEach(function(doc) {
        var data = doc.data();
        if (data.studentEmail !== currentUserData.email.toLowerCase()) return;
        if (!recordMatchesCourseOffering(data, currentCourseInstanceKey)) return;

        data._id = doc.id;
        data._ts = data.createdAt ? data.createdAt.toDate() : new Date();
        answers.push(data);
      });

      if (countBadge) countBadge.textContent = answers.length;
      answers.sort(function(a, b) { return a._ts.getTime() - b._ts.getTime(); });

      if (answers.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="material-icons">task_alt</span>You have not submitted any verbal answers for this course yet.</div>';
        return;
      }

      answers.forEach(function(ans, i) {
        var item = document.createElement('div');
        item.className = 'answer-item';

        var numDiv = document.createElement('div');
        numDiv.className = 'answer-number';
        numDiv.textContent = i + 1;

        var contentDiv = document.createElement('div');
        contentDiv.style.flex = '1';

        var metaDiv = document.createElement('div');
        metaDiv.className = 'student-meta';
        metaDiv.innerHTML = '<span>Submitted by: ' + escapeHtml(ans.studentName) + '</span>' + 
          (ans.studentIndex ? '<span class="index-tag">ID: ' + escapeHtml(ans.studentIndex) + '</span>' : '<span class="index-tag" style="background:#fee2e2;color:#991b1b;">ID: Not set</span>');

        var textDiv = document.createElement('div');
        textDiv.className = 'answer-text';
        textDiv.textContent = ans.answerText;

        var timeDiv = document.createElement('div');
        timeDiv.className = 'answer-time';
        timeDiv.textContent = formatTime(ans._ts);

        contentDiv.appendChild(metaDiv);
        contentDiv.appendChild(textDiv);
        contentDiv.appendChild(timeDiv);

        var delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger btn-small';
        delBtn.title = 'Delete answer';
        delBtn.innerHTML = '<span class="material-icons" style="font-size:16px;">delete</span>';
        delBtn.onclick = function() { studentDeleteSingleAnswer(ans._id); };

        item.appendChild(numDiv);
        item.appendChild(contentDiv);
        item.appendChild(delBtn);
        container.appendChild(item);
      });
    }, function(err) {
      console.error('Student answers load error:', err);
      container.innerHTML = '<div class="empty-state"><span class="material-icons">error</span>Failed to load answers.</div>';
      if (countBadge) countBadge.textContent = '0';
    });
}

async function submitVerbalAnswer() {
  if (!verifyConnectionBeforeAction()) return;
  if (!checkAndEnforceSubscription()) return;

  var input = document.getElementById('stuAnswerInput');
  var btn = document.getElementById('btnSendAnswer');
  var answerText = input ? sanitizeInput(input.value) : '';

  if (!answerText) { showToast('Please type your answer before submitting.', 'error'); return; }
  if (!currentCourseCode) { showToast('No course selected.', 'error'); return; }

  var now = Date.now();
  if (now - lastAnswerSentTime < 3000) {
    var waitSecs = Math.ceil((3000 - (now - lastAnswerSentTime)) / 1000);
    showToast('Please wait ' + waitSecs + ' second(s) before submitting another answer.', 'warning');
    return;
  }

  input.value = '';
  if (btn) btn.disabled = true;
  showLoading('Submitting answer...');

  try {
    await db.collection('answers').add({
      courseCode: currentCourseCode,
      courseInstanceKey: currentCourseInstanceKey || '',
      studentUid: currentUserData.uid,
      studentName: currentUserData.name || 'Student',
      studentIndex: (currentUserData.indexNumber || '').toUpperCase(),
      studentEmail: currentUserData.email.toLowerCase(),
      studentPhoto: currentUserData.photoURL || '',
      answerText: answerText,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    lastAnswerSentTime = Date.now();
    hideLoading();
    if (btn) btn.disabled = false;
    showToast('Verbal answer submitted successfully to lecturer!', 'success');
  } catch (err) {
    hideLoading();
    if (btn) btn.disabled = false;
    showToast('Failed to submit answer: ' + err.message, 'error');
  }
}

async function studentDeleteSingleAnswer(docId) {
  if (!checkAndEnforceSubscription()) return;
  showLoading('Deleting answer...');
  try {
    await db.collection('answers').doc(docId).delete();
    hideLoading();
    showToast('Answer deleted.', 'success');
  } catch (err) {
    hideLoading();
    showToast('Failed to delete answer: ' + err.message, 'error');
  }
}

async function studentDeleteSingleQuestion(docId) {
  if (!checkAndEnforceSubscription()) return;
  showLoading('Deleting question...');
  try {
    await db.collection('questions').doc(docId).delete();
    hideLoading();
    showToast('Question deleted.', 'success');
  } catch (err) {
    hideLoading();
    showToast('Failed to delete question: ' + err.message, 'error');
  }
}

async function studentDeleteAllQuestions() {
  if (!checkAndEnforceSubscription()) return;
  if (!currentCourseCode) return;
  if (!confirm('Are you sure you want to delete all visible questions for this course?')) return;

  var btnClear = document.getElementById('btnStuClearQuestions');
  if (btnClear) btnClear.disabled = true;

  showLoading('Deleting questions...');
  try {
    var snap = await db.collection('questions')
      .where('courseCode', '==', currentCourseCode)
      .where('senderEmail', '==', currentUserData.email.toLowerCase())
      .get();
    var batch = db.batch();
    snap.forEach(function(doc) {
      if (!recordMatchesCourseOffering(doc.data(), currentCourseInstanceKey)) return;
      batch.delete(doc.ref);
    });
    await batch.commit();
    hideLoading();
    if (btnClear) btnClear.disabled = false;
    showToast('All questions deleted successfully.', 'success');
  } catch (err) {
    hideLoading();
    if (btnClear) btnClear.disabled = false;
    showToast('Failed to delete questions: ' + err.message, 'error');
  }
}

// --- 17. LECTURER DASHBOARD CONTROLLERS ---
function initLecturerDashboard() {
  requireAuth('lecturer', function(userData) {
    updateLecturerHeader(userData);
    updateSubBadge();
    renderLecturerCourses();

    if (unsubSelf) unsubSelf();
    unsubSelf = db.collection('lecturers').doc(userData.uid).onSnapshot(function(docSnap) {
      if (docSnap.exists) {
        currentUserData = normalizeUserProfile(docSnap.data(), 'lecturer', docSnap.id);
        updateLecturerHeader(currentUserData);
        updateSubBadge();
        renderLecturerCourses();
      }
    });
  });
}

function updateLecturerHeader(userData) {
  if (!userData) return;
  var userEl = document.getElementById('lecDashUserInfo');
  if (userEl) userEl.textContent = formatLecturerIdentity(userData);

  var avatarImg = document.getElementById('lecDashAvatar');
  if (avatarImg) {
    if (userData.photoURL) {
      avatarImg.src = userData.photoURL;
      avatarImg.style.display = 'block';
    } else {
      avatarImg.style.display = 'none';
    }
  }
}

function renderLecturerCourses() {
  var container = document.getElementById('lecCoursesContainer');
  var filterSelect = document.getElementById('lecCourseFilter');
  if (!container || !filterSelect) return;

  var courses = (currentUserData && Array.isArray(currentUserData.courses) ? currentUserData.courses : [])
    .filter(function(c) { return !!getStoredCourseCode(c); });
  container.innerHTML = '';
  filterSelect.innerHTML = '';

  if (courses.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="material-icons">sentiment_dissatisfied</span>No courses registered. Click "Add Course" to create one.</div>';
    filterSelect.innerHTML = '<option value="">No Courses</option>';
    currentCourseCode = null;
    currentCourseInstanceKey = null;
    loadQuestionsForLecturer();
    loadAnswersForLecturer();
    return;
  }

  courses.forEach(function(c) {
    var code = getStoredCourseCode(c);
    var offering = getCourseOfferingNumber(c);
    var card = document.createElement('div');
    card.className = 'course-card';

    var infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'min-width:0;flex:1;';
    var h4 = document.createElement('h4');
    h4.style.fontSize = '14.5px';
    h4.textContent = code + ' — ' + formatCourseTitleWithOffering(c);

    var p = document.createElement('p');
    p.style.fontSize = '12px';
    p.style.color = '#94a3b8';
    p.textContent = 'Active Interactive Classroom' + (offering > 1 ? ' · Offering ' + offering : '');

    infoDiv.appendChild(h4);
    infoDiv.appendChild(p);

    var btn = document.createElement('button');
    btn.className = 'btn btn-warning btn-small';
    btn.innerHTML = '<span class="material-icons" style="font-size:16px;">remove_circle</span> Unregister';
    btn.onclick = function() { unregisterCourse(code, btn); };

    card.appendChild(infoDiv);
    card.appendChild(btn);
    container.appendChild(card);

    var opt = document.createElement('option');
    opt.value = code;
    opt.textContent = code + ' — ' + formatCourseTitleWithOffering(c);
    filterSelect.appendChild(opt);
  });

  var active = courses.find(function(c) {
    return getStoredCourseCode(c) === normalizeCourseCode(currentCourseCode);
  });
  if (!active) {
    currentCourseCode = getStoredCourseCode(courses[0]);
    active = courses[0];
  }
  currentCourseInstanceKey = getCourseInstanceKey(active);
  filterSelect.value = currentCourseCode;
  switchLecturerTab(activeLecturerTab);
}

function switchLecturerActiveCourse(code) {
  var key = normalizeCourseCode(code);
  var active = (currentUserData && Array.isArray(currentUserData.courses) ? currentUserData.courses : [])
    .find(function(c) { return getStoredCourseCode(c) === key; });
  currentCourseCode = key || null;
  currentCourseInstanceKey = active ? getCourseInstanceKey(active) : null;
  loadQuestionsForLecturer();
  loadAnswersForLecturer();
}

function switchLecturerTab(tab) {
  activeLecturerTab = tab;
  var tabAnonBtn = document.getElementById('tabBtnLecAnon');
  var tabAnsBtn = document.getElementById('tabBtnLecAnswers');
  var contentAnon = document.getElementById('tabContentLecAnon');
  var contentAns = document.getElementById('tabContentLecAnswers');

  if (tab === 'anon') {
    if (tabAnonBtn) tabAnonBtn.classList.add('active');
    if (tabAnsBtn) tabAnsBtn.classList.remove('active');
    if (contentAnon) contentAnon.style.display = 'block';
    if (contentAns) contentAns.style.display = 'none';
    loadQuestionsForLecturer();
  } else {
    if (tabAnsBtn) tabAnsBtn.classList.add('active');
    if (tabAnonBtn) tabAnonBtn.classList.remove('active');
    if (contentAns) contentAns.style.display = 'block';
    if (contentAnon) contentAnon.style.display = 'none';
    loadAnswersForLecturer();
  }
}

function toggleLecturerCoursesCollapse() {
  var wrapper = document.getElementById('lecCoursesWrapper');
  var toggleText = document.getElementById('lecCoursesToggleText');
  var toggleIcon = document.getElementById('lecCoursesToggleIcon');
  if (!wrapper) return;

  if (wrapper.style.display === 'none') {
    wrapper.style.display = 'block';
    if (toggleText) toggleText.textContent = 'Collapse';
    if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
  } else {
    wrapper.style.display = 'none';
    if (toggleText) toggleText.textContent = 'Show';
    if (toggleIcon) toggleIcon.style.transform = 'rotate(-90deg)';
  }
}

function openAddCourseModal() {
  if (!checkAndEnforceSubscription()) return;
  document.getElementById('newCourseCode').value = '';
  document.getElementById('newCourseTitle').value = '';
  openModal('addCourseModal');
}

async function saveNewCourse() {
  if (!checkAndEnforceSubscription()) return;

  var btnSave = document.getElementById('btnSaveNewCourse');
  var codeInput = document.getElementById('newCourseCode');
  var titleInput = document.getElementById('newCourseTitle');
  var code = normalizeCourseCode(sanitizeInput(codeInput ? codeInput.value : ''));
  var title = sanitizeInput(titleInput ? titleInput.value : '');

  if (!code || !title) { 
    showToast('Please provide both course code and title.', 'error'); 
    return; 
  }

  if (btnSave) btnSave.disabled = true;
  showLoading('Adding course...');
  
  try {
    var exists = await checkCourseCodeExists(code);
    if (exists) {
      hideLoading();
      if (btnSave) btnSave.disabled = false;
      showToast('Course code "' + code + '" is currently registered. A code can only be used by one active course at a time.', 'error');
      return;
    }

    var updatedCourses = Array.isArray(currentUserData.courses) ? currentUserData.courses.slice() : [];
    var alreadyExistsForLecturer = updatedCourses.some(function(c) {
      return getStoredCourseCode(c) === code;
    });

    if (alreadyExistsForLecturer) {
      hideLoading();
      if (btnSave) btnSave.disabled = false;
      showToast('You have already registered course code "' + code + '".', 'error');
      return;
    }

    var offering = await getNextCourseOffering(code, title);
    var now = Date.now();
    var newCourse = {
      courseCode: code,
      courseTitle: title,
      identityKey: makeCourseIdentityKey(code, title),
      instanceKey: makeCourseInstanceKey(code),
      offering: offering,
      status: 'active',
      lecturerUid: currentUserData.uid,
      lecturerName: currentUserData.name || '',
      lecturerEmail: currentUserData.email || '',
      lecturerPhoto: currentUserData.photoURL || '',
      createdAt: now
    };
    updatedCourses.push(newCourse);

    await db.collection('lecturers').doc(currentUserData.uid).set({
      courses: updatedCourses
    }, { merge: true });

    currentUserData.courses = updatedCourses;
    currentCourseCode = code;
    currentCourseInstanceKey = getCourseInstanceKey(newCourse);
    renderLecturerCourses();

    closeModal('addCourseModal');
    if (codeInput) codeInput.value = '';
    if (titleInput) titleInput.value = '';
    hideLoading();
    if (btnSave) btnSave.disabled = false;
    showToast(offering > 1
      ? 'Course ' + code + ' published as a separate Offering ' + offering + '. Only content posted from now on belongs to it.'
      : 'New course added successfully! Students can now find it in Browse & Join.', 'success');
  } catch (err) {
    hideLoading();
    if (btnSave) btnSave.disabled = false;
    showToast('Failed to add course: ' + err.message, 'error');
  }
}

async function unregisterCourse(code, btnEl) {
  if (!checkAndEnforceSubscription()) return;
  var codeKey = normalizeCourseCode(code);
  var courseObj = (currentUserData.courses || []).find(function(c) {
    return getStoredCourseCode(c) === codeKey;
  });
  if (!courseObj) {
    showToast('Course ' + codeKey + ' is not an active course.', 'info');
    renderLecturerCourses();
    return;
  }

  var offeringNo = getCourseOfferingNumber(courseObj);
  var offeringLabel = offeringNo > 1 ? ' (Offering ' + offeringNo + ')' : '';
  if (!confirm('Unregister course ' + codeKey + offeringLabel + '?\n\nStudents keep their archived questions and verbal answers, but their course card moves to the "Closed Courses — Unregistered" section and they will not receive any new content. The code ' + codeKey + ' becomes free for a completely separate new offering later.')) return;

  if (btnEl) btnEl.disabled = true;
  showLoading('Archiving course ' + codeKey + ' and notifying students...');
  try {
    await stampCourseContentWithOffering(courseObj);
    await archiveCourseOfferingRecord(courseObj, {
      closedReason: 'lecturer_unregistered',
      lecturerUid: currentUserData.uid,
      lecturerName: currentUserData.name || '',
      lecturerEmail: currentUserData.email || '',
      lecturerPhoto: currentUserData.photoURL || '',
      closedBy: currentUserData.email || '',
      closedByName: currentUserData.name || ''
    });
    await backfillJoinedCourseKeysForOffering(courseObj);

    var updatedCourses = (currentUserData.courses || []).filter(function(c) {
      return getStoredCourseCode(c) !== codeKey;
    });

    await db.collection('lecturers').doc(currentUserData.uid).set({
      courses: updatedCourses
    }, { merge: true });

    currentUserData.courses = updatedCourses;
    if (currentCourseCode === codeKey) {
      var next = updatedCourses.find(function(c) { return !!getStoredCourseCode(c); });
      currentCourseCode = next ? getStoredCourseCode(next) : null;
      currentCourseInstanceKey = next ? getCourseInstanceKey(next) : null;
    }

    hideLoading();
    if (btnEl) btnEl.disabled = false;
    renderLecturerCourses();
    showToast('Course ' + codeKey + offeringLabel + ' unregistered. Its questions and answers were kept, and students were moved to their Closed Courses section. The code is now free for a new offering.', 'success');
  } catch (err) {
    hideLoading();
    if (btnEl) btnEl.disabled = false;
    showToast('Failed to unregister course: ' + err.message, 'error');
  }
}

function loadQuestionsForLecturer() {
  var container = document.getElementById('lecQuestionList');
  var countBadge = document.getElementById('lecQuestionCountBadge');
  if (!container) return;

  if (!currentCourseCode) {
    container.innerHTML = '<div class="empty-state"><span class="material-icons">chat_bubble_outline</span>No active course selected.</div>';
    if (countBadge) countBadge.textContent = '0';
    return;
  }

  container.innerHTML = '<div class="empty-state"><span class="material-icons">hourglass_empty</span>Loading questions...</div>';

  if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }

  unsubQuestions = db.collection('questions')
    .where('courseCode', '==', currentCourseCode)
    .onSnapshot(function(snapshot) {
      container.innerHTML = '';
      var now = Date.now();
      var questions = [];

      snapshot.forEach(function(doc) {
        var data = doc.data();
        if (!recordMatchesCourseOffering(data, currentCourseInstanceKey)) return;
        data._id = doc.id;
        var ts = data.createdAt ? data.createdAt.toDate() : null;

        if (ts && (now - ts.getTime() > 86400000)) {
          db.collection('questions').doc(doc.id).delete().catch(function(){});
          return;
        }
        data._ts = ts || new Date();
        questions.push(data);
      });

      if (countBadge) countBadge.textContent = questions.length;
      questions.sort(function(a, b) { return a._ts.getTime() - b._ts.getTime(); });

      if (questions.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="material-icons">chat_bubble_outline</span>No questions for ' + escapeHtml(currentCourseCode) + ' yet.</div>';
        return;
      }

      questions.forEach(function(q, i) {
        var item = document.createElement('div');
        item.className = 'question-item';

        var numDiv = document.createElement('div');
        numDiv.className = 'question-number';
        numDiv.textContent = i + 1;

        var contentDiv = document.createElement('div');
        contentDiv.style.flex = '1';

        var textDiv = document.createElement('div');
        textDiv.className = 'question-text';
        textDiv.textContent = q.text;

        var timeDiv = document.createElement('div');
        timeDiv.className = 'question-time';
        timeDiv.textContent = formatTime(q._ts);

        contentDiv.appendChild(textDiv);
        contentDiv.appendChild(timeDiv);

        var delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger btn-small';
        delBtn.title = 'Delete question';
        delBtn.innerHTML = '<span class="material-icons" style="font-size:16px;">delete</span>';
        delBtn.onclick = function() { deleteSingleQuestion(q._id); };

        item.appendChild(numDiv);
        item.appendChild(contentDiv);
        item.appendChild(delBtn);
        container.appendChild(item);
      });
    }, function(err) {
      console.error('Lecturer questions error:', err);
      if (countBadge) countBadge.textContent = '0';
    });
}

function loadAnswersForLecturer() {
  var container = document.getElementById('lecAnswerList');
  var countBadge = document.getElementById('lecAnswerCountBadge');
  if (!container) return;

  if (!currentCourseCode) {
    container.innerHTML = '<div class="empty-state"><span class="material-icons">how_to_reg</span>No active course selected.</div>';
    if (countBadge) countBadge.textContent = '0';
    return;
  }

  container.innerHTML = '<div class="empty-state"><span class="material-icons">hourglass_empty</span>Loading student answers...</div>';

  if (unsubAnswers) { unsubAnswers(); unsubAnswers = null; }

  unsubAnswers = db.collection('answers')
    .where('courseCode', '==', currentCourseCode)
    .onSnapshot(function(snapshot) {
      container.innerHTML = '';
      var answers = [];

      snapshot.forEach(function(doc) {
        var data = doc.data();
        if (!recordMatchesCourseOffering(data, currentCourseInstanceKey)) return;
        data._id = doc.id;
        data._ts = data.createdAt ? data.createdAt.toDate() : new Date();
        answers.push(data);
      });

      if (countBadge) countBadge.textContent = answers.length;
      answers.sort(function(a, b) { return a._ts.getTime() - b._ts.getTime(); });

      if (answers.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="material-icons">how_to_reg</span>No verbal answers submitted for ' + escapeHtml(currentCourseCode) + ' yet.</div>';
        return;
      }

      answers.forEach(function(ans, i) {
        var item = document.createElement('div');
        item.className = 'answer-item';

        var numDiv = document.createElement('div');
        numDiv.className = 'answer-number';
        numDiv.textContent = i + 1;

        var contentDiv = document.createElement('div');
        contentDiv.style.flex = '1';

        var metaDiv = document.createElement('div');
        metaDiv.className = 'student-meta';
        var metaRow = document.createElement('div');
        metaRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

        if (ans.studentPhoto) {
          var avatarImg = document.createElement('img');
          avatarImg.src = ans.studentPhoto;
          avatarImg.className = 'answer-avatar';
          avatarImg.alt = 'Profile photo';
          avatarImg.onclick = function() { viewPhotoInLightbox(ans.studentPhoto, ans.studentName + ' Profile'); };
          metaRow.appendChild(avatarImg);
        } else {
          var avatarIcon = document.createElement('span');
          avatarIcon.className = 'material-icons';
          avatarIcon.style.cssText = 'font-size:26px;color:#94a3b8;';
          avatarIcon.textContent = 'account_circle';
          metaRow.appendChild(avatarIcon);
        }

        var nameSpan = document.createElement('span');
        nameSpan.textContent = 'Student: ' + ans.studentName;

        var idTag = document.createElement('span');
        idTag.className = 'index-tag';
        if (ans.studentIndex) {
          idTag.textContent = 'ID: ' + ans.studentIndex;
        } else {
          idTag.style.cssText = 'background:#fee2e2;color:#991b1b;';
          idTag.textContent = 'ID: Not Provided';
        }

        metaRow.appendChild(nameSpan);
        metaRow.appendChild(idTag);
        metaDiv.appendChild(metaRow);

        var textDiv = document.createElement('div');
        textDiv.className = 'answer-text';
        textDiv.textContent = ans.answerText;

        var timeDiv = document.createElement('div');
        timeDiv.className = 'answer-time';
        timeDiv.textContent = formatTime(ans._ts);

        contentDiv.appendChild(metaDiv);
        contentDiv.appendChild(textDiv);
        contentDiv.appendChild(timeDiv);

        var delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger btn-small';
        delBtn.title = 'Delete answer';
        delBtn.innerHTML = '<span class="material-icons" style="font-size:16px;">delete</span>';
        delBtn.onclick = function() { deleteSingleAnswer(ans._id); };

        item.appendChild(numDiv);
        item.appendChild(contentDiv);
        item.appendChild(delBtn);
        container.appendChild(item);
      });
    }, function(err) {
      console.error('Lecturer answers error:', err);
      if (countBadge) countBadge.textContent = '0';
    });
}

async function deleteSingleQuestion(docId) {
  if (!checkAndEnforceSubscription()) return;
  showLoading('Deleting question...');
  try {
    await db.collection('questions').doc(docId).delete();
    hideLoading();
    showToast('Question deleted.', 'success');
  } catch (err) {
    hideLoading();
    showToast('Failed to delete question: ' + err.message, 'error');
  }
}

async function deleteSingleAnswer(docId) {
  if (!checkAndEnforceSubscription()) return;
  showLoading('Deleting answer...');
  try {
    await db.collection('answers').doc(docId).delete();
    hideLoading();
    showToast('Answer deleted.', 'success');
  } catch (err) {
    hideLoading();
    showToast('Failed to delete answer: ' + err.message, 'error');
  }
}

async function deleteAllQuestions() {
  if (!checkAndEnforceSubscription()) return;
  if (!currentCourseCode) return;
  if (!confirm('Are you sure you want to delete ALL questions for ' + currentCourseCode + '?')) return;

  var btnClear = document.getElementById('btnLecClearQuestions');
  if (btnClear) btnClear.disabled = true;

  showLoading('Deleting course questions...');
  try {
    var snap = await db.collection('questions').where('courseCode', '==', currentCourseCode).get();
    var batch = db.batch();
    snap.forEach(function(doc) {
      if (!recordMatchesCourseOffering(doc.data(), currentCourseInstanceKey)) return;
      batch.delete(doc.ref);
    });
    await batch.commit();

    hideLoading();
    if (btnClear) btnClear.disabled = false;
    showToast('All questions for ' + currentCourseCode + ' deleted.', 'success');
  } catch (err) {
    hideLoading();
    if (btnClear) btnClear.disabled = false;
    showToast('Failed to clear questions: ' + err.message, 'error');
  }
}

async function deleteAllAnswers() {
  if (!checkAndEnforceSubscription()) return;
  if (!currentCourseCode) return;
  if (!confirm('Are you sure you want to delete ALL student verbal answers for ' + currentCourseCode + '?')) return;

  var btnClear = document.getElementById('btnLecClearAnswers');
  if (btnClear) btnClear.disabled = true;

  showLoading('Deleting course verbal answers...');
  try {
    var snap = await db.collection('answers').where('courseCode', '==', currentCourseCode).get();
    var batch = db.batch();
    snap.forEach(function(doc) {
      if (!recordMatchesCourseOffering(doc.data(), currentCourseInstanceKey)) return;
      batch.delete(doc.ref);
    });
    await batch.commit();

    hideLoading();
    if (btnClear) btnClear.disabled = false;
    showToast('All student answers for ' + currentCourseCode + ' deleted.', 'success');
  } catch (err) {
    hideLoading();
    if (btnClear) btnClear.disabled = false;
    showToast('Failed to clear answers: ' + err.message, 'error');
  }
}

// --- 18. VERIFICATION PAGE LOGIC ---
function initVerificationPage() {
  var urlParams = new URLSearchParams(window.location.search);
  var email = urlParams.get('email') || '';
  var role = urlParams.get('role') || 'student';
  currentRole = role;

  var emailEl = document.getElementById('verifyPendingEmail');
  if (emailEl) emailEl.textContent = email;

  startResendTimer();
}

function startResendTimer() {
  resendTimer = 60;
  var btn = document.getElementById('btnResendVerification');
  var txt = document.getElementById('resendCountdownText');
  if (btn) btn.disabled = true;

  if (resendInterval) clearInterval(resendInterval);
  resendInterval = setInterval(function() {
    resendTimer--;
    if (resendTimer <= 0) {
      clearInterval(resendInterval);
      if (btn) btn.disabled = false;
      if (txt) txt.textContent = 'Resend Verification Email';
    } else {
      if (txt) txt.textContent = 'Resend available in ' + resendTimer + 's';
    }
  }, 1000);
}

async function checkVerificationStatus() {
  var user = auth.currentUser;
  var emailEl = document.getElementById('verifyPendingEmail');
  var email = emailEl ? emailEl.textContent.trim() : (user ? user.email : '');
  var role = currentRole || 'student';

  showLoading('Checking verification status...');
  try {
    if (user) {
      await user.reload();
      if (user.emailVerified) {
        hideLoading();
        showToast('Email verified successfully! You can now sign in.', 'success');
        window.location.href = role === 'student' ? 'student-login.html' : 'lecturer-login.html';
        return;
      }
      await auth.signOut();
    }
  } catch(e) {}

  hideLoading();
  showToast('Redirecting to Sign In. Please enter your password to continue.', 'info');
  window.location.href = (role === 'student' ? 'student-login.html' : 'lecturer-login.html') + '?email=' + encodeURIComponent(email);
}

async function resendVerificationLink() {
  var user = auth.currentUser;
  if (!user) {
    showToast('Session expired. Please sign in to resend verification.', 'error');
    window.location.href = currentRole === 'student' ? 'student-login.html' : 'lecturer-login.html';
    return;
  }
  showLoading('Sending fresh verification link...');
  try {
    await user.sendEmailVerification();
    hideLoading();
    showToast('Fresh verification email sent!', 'success');
    startResendTimer();
  } catch(e) {
    hideLoading();
    showToast('Failed to resend email: ' + e.message, 'error');
  }
}
