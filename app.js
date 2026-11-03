// ============================================================================
// EDUPLUS PORTAL - SHARED ENGINE (app.js)
// Centralized Firebase, Paystack, Auth Guard, Dashboards & Interactive Features
// ============================================================================

// --- 1. CONFIGURATION ---
const PAYSTACK_PUBLIC_KEY = "pk_live_3aae1eec1c5298079ca3d9013fd99929c56110d8";

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

// Set persistence to SESSION so individual tabs can log into different accounts independently
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
  .catch((error) => {
    console.error("Auth persistence error:", error);
  });

// --- 2. GLOBAL STATE ---
let currentRole = null;          // 'student' | 'lecturer'
let currentUserData = null;      // Cached Firestore user profile
let currentCourseCode = null;    // Active course code
let lastRenderedCoursesSignature = '';
let activeStudentTab = 'anon';
let activeLecturerTab = 'anon';
let searchTargetRole = 'student';
let pendingGoogleUser = null;

// Real-time Firestore Listeners
let unsubQuestions = null;
let unsubAnswers = null;
let unsubCourses = null;
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

// Update Lecturer Badges & Existing Expanded Counters
function updateLecturerCounters(qCount, aCount) {
  const lqBadge = document.getElementById('lecturerQBadge');
  const labBadge = document.getElementById('lecturerABadge');
  
  if (lqBadge) lqBadge.textContent = qCount;
  if (labBadge) labBadge.textContent = aCount;

  // Maintain your existing expanded view counters for lecturer
  const expQ = document.getElementById('expandedLecturerQCount');
  if (expQ) expQ.textContent = qCount;

  const expA = document.getElementById('expandedLecturerACount');
  if (expA) expA.textContent = aCount;
}

// Update Student Badges & Existing Expanded Counters
function updateStudentCounters(qCount, aCount) {
  const sqBadge = document.getElementById('studentQBadge');
  const sabBadge = document.getElementById('studentABadge');
  
  if (sqBadge) sqBadge.textContent = qCount;
  if (sabBadge) sabBadge.textContent = aCount;

  // Maintain your existing expanded view counters for student
  const expQ = document.getElementById('expandedStudentQCount');
  if (expQ) expQ.textContent = qCount;

  const expA = document.getElementById('expandedStudentACount');
  if (expA) expA.textContent = aCount;
}

// --- 4. TOAST NOTIFICATIONS & LOADING OVERLAY (WITH SAFETY TIMEOUT) ---
let loadingTimeoutTimer = null;

// Request Notification Permission
if ('Notification' in window && 'serviceWorker' in navigator) {
  Notification.requestPermission().then((permission) => {
    if (permission === 'granted') {
      console.log('Notification permission granted.');
    } else {
      console.log('Notification permission denied.');
    }
  });
}

function showLoading(text) {
  var overlay = document.getElementById('loadingOverlay');
  var textEl = document.getElementById('loadingText');
  if (textEl) textEl.textContent = text || 'Loading...';
  if (overlay) overlay.classList.add('active');

  clearTimeout(loadingTimeoutTimer);
  loadingTimeoutTimer = setTimeout(function() {
    hideLoading();
    console.warn('Loading overlay forcefully dismissed by safety timer.');
  }, 6500);
}

function hideLoading() {
  clearTimeout(loadingTimeoutTimer);
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

// --- 6. SUBSCRIPTION CALCULATIONS ---
function getDaysRemaining(lastPaymentDate) {
  if (!lastPaymentDate) return 0;
  var payTime = typeof lastPaymentDate.toDate === 'function' ? lastPaymentDate.toDate().getTime() : new Date(lastPaymentDate).getTime();
  if (isNaN(payTime)) return 0;
  var thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  var diff = (payTime + thirtyDaysMs) - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function isSubscriptionActive(lastPaymentDate) {
  return getDaysRemaining(lastPaymentDate) > 0;
}

function updateSubBadge() {
  if (!currentUserData) return;
  var days = getDaysRemaining(currentUserData.lastPaymentDate);
  var badgeId = currentRole === 'student' ? 'stuSubBadge' : 'lecSubBadge';
  var badgeEl = document.getElementById(badgeId);
  if (!badgeEl) return;

  if (days > 0) {
    badgeEl.textContent = 'Active (' + days + 'd left)';
    badgeEl.style.background = 'rgba(34, 197, 94, 0.15)';
    badgeEl.style.color = '#22c55e';
  } else {
    badgeEl.textContent = 'Expired';
    badgeEl.style.background = 'rgba(239, 68, 68, 0.15)';
    badgeEl.style.color = '#ef4444';
  }
}

function checkAndEnforceSubscription() {
  if (!currentUserData) return false;
  var active = isSubscriptionActive(currentUserData.lastPaymentDate);
  updateSubBadge();

  if (!active) {
    var isStu = currentRole === 'student';
    var priceStr = isStu ? 'GHS 20.00' : 'GHS 50.00';
    var modalPrice = document.getElementById('renewalModalPrice');
    var modalText = document.getElementById('renewalModalText');
    if (modalPrice) modalPrice.textContent = priceStr;
    if (modalText) {
      modalText.textContent = 'Your 30-day ' + (isStu ? 'Student' : 'Lecturer') + ' portal pass has expired. Please pay ' + priceStr + ' via Mobile Money or Card to restore full interactive access.';
    }
    openModal('subscriptionRenewalModal');
    return false;
  }
  closeModal('subscriptionRenewalModal');
  return true;
}

function openRenewalModalManual() {
  var isStu = currentRole === 'student';
  var priceStr = isStu ? 'GHS 20.00' : 'GHS 50.00';
  var modalPrice = document.getElementById('renewalModalPrice');
  var modalText = document.getElementById('renewalModalText');
  if (modalPrice) modalPrice.textContent = priceStr;
  if (modalText) {
    modalText.textContent = 'Extend your 30-day ' + (isStu ? 'Student' : 'Lecturer') + ' portal pass. Renewal cost is ' + priceStr + ' via Mobile Money or Card.';
  }
  openModal('subscriptionRenewalModal');
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
      var currentPaymentDate = currentUserData.lastPaymentDate;
      var daysLeft = getDaysRemaining(currentPaymentDate);
      var newPaymentDate;

      if (currentPaymentDate && daysLeft > 0) {
        var oldTime = typeof currentPaymentDate.toDate === 'function' 
          ? currentPaymentDate.toDate().getTime() 
          : new Date(currentPaymentDate).getTime();
        var thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        newPaymentDate = new Date(oldTime + thirtyDaysMs);
      } else {
        newPaymentDate = new Date();
      }

      await db.collection(collection).doc(currentUserData.uid).set({
        subscriptionStatus: 'active',
        lastPaymentDate: newPaymentDate,
        lastPaymentRef: resp.reference || ''
      }, { merge: true });

      currentUserData.subscriptionStatus = 'active';
      currentUserData.lastPaymentDate = newPaymentDate;

      closeModal('subscriptionRenewalModal');
      hideLoading();
      if (btnRenew) btnRenew.disabled = false;
      showToast('Subscription extended by an additional 30 days!', 'success');
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
      var stuSnap = await db.collection('students').where('email', '==', cleanEmail).get();
      if (!stuSnap.empty) return { exists: true, role: 'student' };

      var lecSnap = await db.collection('lecturers').where('email', '==', cleanEmail).get();
      if (!lecSnap.empty) return { exists: true, role: 'lecturer' };

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
        alertText.textContent = 'The email "' + clean + '" is already registered' + (check.role ? ' as a ' + check.role : '') + '! To avoid accidental duplicate payments, please sign in instead.';
      }
      if (regBtn) regBtn.disabled = true;
      showToast('Account already exists for ' + clean + '! Please sign in.', 'error');
    } else {
      if (alertEl) alertEl.style.display = 'none';
      if (regBtn) regBtn.disabled = false;
    }
  } catch(e) {
    console.error(e);
  }
}

async function checkCourseCodeExists(code, excludeLecturerUid) {
  var snap = await db.collection('lecturers').get();
  var found = false;
  snap.forEach(function(doc) {
    if (excludeLecturerUid && doc.id === excludeLecturerUid) return;
    var data = doc.data();
    if (data.courses && Array.isArray(data.courses)) {
      data.courses.forEach(function(c) {
        if (c.courseCode && c.courseCode.toUpperCase() === code.toUpperCase()) {
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

// --- 10. FORGOT PASSWORD & FIND ACCOUNT MODAL (5 GHS CHARGE) ---
function openPaidForgotPassword(role) {
  var emailInput = role === 'student' ?
    document.getElementById('stuLoginEmail') :
    document.getElementById('lecLoginEmail');

  var email = emailInput ? sanitizeInput(emailInput.value).toLowerCase() : '';

  if (!email || !isValidEmail(email)) {
    showToast('Please enter your registered account email in the input box first.', 'error');
    return;
  }

  if (!confirm('Password recovery via forgot-password incurs a 5 GHS service charge. Proceed to Paystack payment?')) return;

  var customerName = (currentUserData && currentUserData.name) ? currentUserData.name : 'Eduplus Reset User';

  payWithPaystack(email, 5, 'Password Reset Service Fee', customerName, async function(resp) {
    showLoading('Processing password reset...');
    try {
      await auth.sendPasswordResetEmail(email);
      hideLoading();
      showToast('Password reset link successfully sent to ' + escapeHtml(email) + '!', 'success');
    } catch (err) {
      hideLoading();
      showToast('Failed to send reset email: ' + err.message, 'error');
    }
  }, function() {
    showToast('Payment for password reset was cancelled.', 'info');
  });
}

function openFindAccountModal(role) {
  searchTargetRole = role;
  var input = document.getElementById('findAccountName');
  var results = document.getElementById('searchResultsContainer');
  if (input) input.value = '';
  if (results) {
    results.style.display = 'none';
    results.innerHTML = '';
  }
  openModal('findAccountModal');
}

async function searchAccountsByName(term) {
  term = sanitizeInput(term).toLowerCase().trim();
  var container = document.getElementById('searchResultsContainer');
  if (!container) return;

  if (term.length < 2) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  try {
    var collection = searchTargetRole === 'student' ? 'students' : 'lecturers';
    var snap = await db.collection(collection).get();

    var matches = [];
    snap.forEach(function(doc) {
      var d = doc.data();
      if (d.name && d.name.toLowerCase().includes(term)) {
        matches.push(d);
      }
    });

    container.innerHTML = '';
    if (matches.length === 0) {
      var emptyDiv = document.createElement('div');
      emptyDiv.style.padding = '12px';
      emptyDiv.style.fontSize = '13px';
      emptyDiv.style.color = '#94a3b8';
      emptyDiv.style.textAlign = 'center';
      emptyDiv.textContent = 'No matching accounts found';
      container.appendChild(emptyDiv);
    } else {
      matches.forEach(function(m) {
        var masked = maskEmail(m.email);
        var itemDiv = document.createElement('div');
        itemDiv.className = 'search-item';
        itemDiv.onclick = function() { payAndTriggerReset(m.email, m.name); };

        var titleDiv = document.createElement('div');
        titleDiv.className = 'search-item-title';
        titleDiv.textContent = m.name + (m.indexNumber ? ' (' + m.indexNumber + ')' : '');

        var subDiv = document.createElement('div');
        subDiv.className = 'search-item-sub';
        subDiv.textContent = 'Email: ' + masked + ' — Click to pay 5 GHS & Reset Password';

        itemDiv.appendChild(titleDiv);
        itemDiv.appendChild(subDiv);
        container.appendChild(itemDiv);
      });
    }
    container.style.display = 'block';
  } catch (err) {
    console.error('Search accounts error:', err);
    container.style.display = 'block';
    container.innerHTML = '<div style="padding:12px;font-size:12.5px;color:#ef4444;text-align:center;">Search failed. Please check connection.</div>';
  }
}

function payAndTriggerReset(email, name) {
  closeModal('findAccountModal');
  if (!confirm('Account selected: ' + name + ' (' + maskEmail(email) + '). Password reset requires a 5 GHS service fee. Proceed to payment?')) return;

  payWithPaystack(email, 5, 'Account Password Reset Fee', name, async function(resp) {
    showLoading('Sending password reset link...');
    try {
      await auth.sendPasswordResetEmail(email);
      hideLoading();
      showToast('Password reset link successfully sent to ' + escapeHtml(email) + '!', 'success');
    } catch (err) {
      hideLoading();
      showToast('Failed to send reset email: ' + err.message, 'error');
    }
  }, function() {
    showToast('Payment cancelled.', 'info');
  });
}

// --- 11. REGISTRATION SYSTEM (PAYSTACK GHS 20 / GHS 50) ---
async function registerUser(role) {
  var name, email, pass, indexNumber, courseCode, courseTitle, photoURL;
  var btnId = role === 'student' ? 'btnStuReg' : 'btnLecReg';
  var btnEl = document.getElementById(btnId);

  var currentUser = auth.currentUser;
  var isGoogleAuth = currentUser && currentUser.email;

  if (role === 'student') {
    name        = sanitizeInput(document.getElementById('stuRegName').value);
    indexNumber = sanitizeInput(document.getElementById('stuRegIndex').value).toUpperCase();
    email       = sanitizeInput(document.getElementById('stuRegEmail').value).toLowerCase();
    pass        = isGoogleAuth ? 'GOOGLE_AUTH_USER' : (document.getElementById('stuRegPass') ? document.getElementById('stuRegPass').value : '');
    photoURL    = document.getElementById('stuRegPhotoData') ? document.getElementById('stuRegPhotoData').value : '';
  } else {
    name        = sanitizeInput(document.getElementById('lecRegName').value);
    email       = sanitizeInput(document.getElementById('lecRegEmail').value).toLowerCase();
    courseCode  = sanitizeInput(document.getElementById('lecRegCourseCode').value).toUpperCase();
    courseTitle = sanitizeInput(document.getElementById('lecRegCourseTitle').value);
    pass        = isGoogleAuth ? 'GOOGLE_AUTH_USER' : (document.getElementById('lecRegPass') ? document.getElementById('lecRegPass').value : '');
    photoURL    = document.getElementById('lecRegPhotoData') ? document.getElementById('lecRegPhotoData').value : '';
  }

  if (!name) { showToast('Please enter your full name.', 'error'); return; }
  if (!email || !isValidEmail(email)) { showToast('Please enter a valid email address.', 'error'); return; }
  if (!isGoogleAuth && (!pass || pass.length < 6)) { showToast('Password must be at least 6 characters.', 'error'); return; }
  
  if (role === 'lecturer') {
    if (!courseCode) { showToast('Please enter an initial course code.', 'error'); return; }
    if (!courseTitle) { showToast('Please enter an initial course title.', 'error'); return; }
  }

  showLoading('Verifying details...');
  
  var check = await checkEmailAlreadyRegistered(email);
  if (check.exists && !isGoogleAuth) {
    hideLoading();
    if (btnEl) btnEl.disabled = false;
    showToast('This email is already registered! Please sign in.', 'error');
    return;
  }

  if (role === 'lecturer') {
    var codeExists = await checkCourseCodeExists(courseCode);
    if (codeExists) {
      hideLoading();
      showToast('Course code "' + courseCode + '" is already registered.', 'error');
      return;
    }
  }
  hideLoading();

  var amount = role === 'student' ? 20 : 50;
  var desc = (role === 'student' ? 'Student' : 'Lecturer') + ' Portal Registration Fee';

  if (btnEl) btnEl.disabled = true;

  payWithPaystack(email, amount, desc, name, async function(resp) {
    showLoading('Finalizing account and saving profile...');
    try {
      var user = currentUser;

      if (!isGoogleAuth) {
        var cred = await auth.createUserWithEmailAndPassword(email, pass);
        user = cred.user;
        await user.updateProfile({ displayName: name });
        await user.sendEmailVerification();
      } else {
        await user.updateProfile({ displayName: name });
      }

      if (role === 'student') {
        var stuData = {
          name: name,
          email: email,
          indexNumber: indexNumber || '',
          photoURL: photoURL || user.photoURL || '',
          role: 'student',
          subscriptionStatus: 'active',
          lastPaymentDate: firebase.firestore.FieldValue.serverTimestamp(),
          lastPaymentRef: resp.reference || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('students').doc(user.uid).set(stuData);
      } else {
        var initialCourses = [{ courseCode: courseCode, courseTitle: courseTitle }];
        var lecData = {
          name: name,
          email: email,
          photoURL: photoURL || user.photoURL || '',
          courses: initialCourses,
          role: 'lecturer',
          subscriptionStatus: 'active',
          lastPaymentDate: firebase.firestore.FieldValue.serverTimestamp(),
          lastPaymentRef: resp.reference || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('lecturers').doc(user.uid).set(lecData);
      }

      hideLoading();
      if (btnEl) btnEl.disabled = false;
      showToast('Payment successful! Account registered successfully.', 'success');

      if (isGoogleAuth) {
        window.location.href = role === 'student' ? 'student-dashboard.html' : 'lecturer-dashboard.html';
      } else {
        window.location.href = 'verification.html?email=' + encodeURIComponent(email) + '&role=' + role;
      }
    } catch(e) {
      hideLoading();
      if (btnEl) btnEl.disabled = false;
      showToast('Registration error: ' + e.message, 'error');
    }
  }, function() {
    if (btnEl) btnEl.disabled = false;
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
        var googleStudentName = user.displayName || 'Google Student';
        payWithPaystack(user.email, 20, 'Student Portal Registration Fee', googleStudentName, async function(resp) {
          showLoading('Saving student profile...');
          try {
            var studentData = {
              name: sanitizeInput(googleStudentName),
              email: user.email.toLowerCase(),
              indexNumber: '',
              photoURL: user.photoURL || '',
              role: 'student',
              subscriptionStatus: 'active',
              lastPaymentDate: firebase.firestore.FieldValue.serverTimestamp(),
              lastPaymentRef: resp.reference || '',
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
    } else {
      currentRole = role;
      currentUserData = doc.data();
      currentUserData.uid = user.uid;

      hideLoading();
      if (btnGoogle) btnGoogle.disabled = false;

      showToast('Welcome back, ' + currentUserData.name + '!', 'success');
      window.location.href = role === 'student' ? 'student-dashboard.html' : 'lecturer-dashboard.html';
    }
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
      showToast('An account with email "' + email + '" already exists! Please sign in.', 'error');
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
    hideLoading();

    payWithPaystack(pendingGoogleUser.email, 50, 'Lecturer Portal Registration Fee', name, async function(resp) {
      showLoading('Finalizing lecturer profile...');
      try {
        var lecturerData = {
          name: name,
          email: pendingGoogleUser.email.toLowerCase(),
          photoURL: pendingGoogleUser.photoURL || '',
          courses: [{ courseCode: courseCode, courseTitle: courseTitle }],
          role: 'lecturer',
          subscriptionStatus: 'active',
          lastPaymentDate: firebase.firestore.FieldValue.serverTimestamp(),
          lastPaymentRef: resp.reference || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('lecturers').doc(pendingGoogleUser.uid).set(lecturerData);
        currentRole = 'lecturer';
        currentUserData = lecturerData;
        currentUserData.uid = pendingGoogleUser.uid;
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
      showToast('Payment cancelled. Account setup aborted.', 'error');
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
      showToast('Account record not found. Please register.', 'error');
      return;
    }

    currentRole = role;
    currentUserData = doc.data();
    currentUserData.uid = user.uid;

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
  auth.onAuthStateChanged(async function(user) {
    if (!user) {
      hideLoading();
      window.location.href = expectedRole === 'student' ? 'student-login.html' : 'lecturer-login.html';
      return;
    }

    try {
      var collection = expectedRole === 'student' ? 'students' : 'lecturers';
      var doc = await db.collection(collection).doc(user.uid).get();

      if (!doc.exists) {
        var otherCollection = expectedRole === 'student' ? 'lecturers' : 'students';
        var otherDoc = await db.collection(otherCollection).doc(user.uid).get();
        if (otherDoc.exists) {
          hideLoading();
          window.location.href = expectedRole === 'student' ? 'lecturer-dashboard.html' : 'student-dashboard.html';
          return;
        }
        await auth.signOut();
        hideLoading();
        window.location.href = expectedRole === 'student' ? 'student-login.html' : 'lecturer-login.html';
        return;
      }

      currentRole = expectedRole;
      currentUserData = doc.data();
      currentUserData.uid = user.uid;

      hideLoading();
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
  if (unsubSelf) { unsubSelf(); unsubSelf = null; }

  try { await auth.signOut(); } catch (e) {}

  currentRole = null;
  currentUserData = null;
  currentCourseCode = null;
  hideLoading();
  showToast('Signed out successfully.', 'info');
  window.location.href = 'portal-select.html';
}

async function deleteAccount() {
  if (!confirm('Are you sure you want to permanently delete your account and all associated data? This cannot be undone.')) return;

  var btnDelete = document.getElementById('btnStuDelete');
  if (btnDelete) btnDelete.disabled = true;

  showLoading('Deleting account permanently...');

  if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }
  if (unsubAnswers) { unsubAnswers(); unsubAnswers = null; }
  if (unsubCourses) { unsubCourses(); unsubCourses = null; }
  if (unsubSelf) { unsubSelf(); unsubSelf = null; }

  try {
    var user = auth.currentUser;
    var uid = user.uid;

    if (currentRole === 'lecturer') {
      var courses = currentUserData.courses || [];
      var batch = db.batch();

      for (var i = 0; i < courses.length; i++) {
        var cCode = courses[i].courseCode;
        var qsnap = await db.collection('questions').where('courseCode', '==', cCode).get();
        qsnap.forEach(function(d) { batch.delete(d.ref); });

        var asnap = await db.collection('answers').where('courseCode', '==', cCode).get();
        asnap.forEach(function(d) { batch.delete(d.ref); });
      }

      batch.delete(db.collection('lecturers').doc(uid));
      await batch.commit();
    } else {
      await db.collection('students').doc(uid).delete();
    }

    await user.delete();

    currentRole = null;
    currentUserData = null;
    currentCourseCode = null;

    hideLoading();
    if (btnDelete) btnDelete.disabled = false;
    showToast('Your account was permanently deleted.', 'success');
    closeModal('editProfileModal');
    window.location.href = 'portal-select.html';

  } catch (err) {
    hideLoading();
    if (btnDelete) btnDelete.disabled = false;
    if (err.code === 'auth/requires-recent-login') {
      showToast('Security check: Please log out and log back in before deleting your account.', 'error');
    } else {
      showToast('Failed to delete account: ' + err.message, 'error');
    }
  }
}

// --- 15. EDIT PROFILE SYSTEM ---
function openProfileModal() {
  if (!currentUserData) return;
  document.getElementById('profileEditName').value = currentUserData.name || '';
  document.getElementById('profileEditEmail').value = currentUserData.email || '';
  document.getElementById('profileCurrentPass').value = '';
  document.getElementById('profileNewPass').value = '';
  document.getElementById('editProfileUrlInput').value = '';

  var photoVal = currentUserData.photoURL || '';
  document.getElementById('editProfilePhotoData').value = photoVal;
  if (photoVal) {
    setAvatarImage('editProfileAvatarPreview', 'editProfilePhotoData', photoVal);
    if (photoVal.startsWith('http://') || photoVal.startsWith('https://')) {
      document.getElementById('editProfileUrlInput').value = photoVal;
    }
  } else {
    document.getElementById('editProfileAvatarPreview').innerHTML = '<span class="material-icons" style="font-size:42px;color:#94a3b8;">account_circle</span>';
  }

  var indexGroup = document.getElementById('profileIndexGroup');
  if (currentRole === 'student' && indexGroup) {
    indexGroup.style.display = 'block';
    document.getElementById('profileEditIndex').value = (currentUserData.indexNumber || '').toUpperCase();
  } else if (indexGroup) {
    indexGroup.style.display = 'none';
  }

  openModal('editProfileModal');
}

async function saveProfileChanges() {
  var btnSave = document.getElementById('btnSaveProfile');
  var name = sanitizeInput(document.getElementById('profileEditName').value);
  var indexNumber = currentRole === 'student' ? sanitizeInput(document.getElementById('profileEditIndex').value).toUpperCase() : '';
  var photoURL = document.getElementById('editProfilePhotoData').value;
  var currPass = document.getElementById('profileCurrentPass').value;
  var newPass = document.getElementById('profileNewPass').value;

  if (!name) { showToast('Please enter your full name.', 'error'); return; }

  var user = auth.currentUser;
  if (!user) {
    showToast('No active user session found. Please sign in again.', 'error');
    return;
  }

  if (btnSave) btnSave.disabled = true;
  showLoading('Saving profile changes...');
  
  try {
    if (newPass) {
      if (!currPass) {
        hideLoading();
        if (btnSave) btnSave.disabled = false;
        showToast('Please enter your current password to set a new password.', 'error');
        return;
      }
      if (newPass.length < 6) {
        hideLoading();
        if (btnSave) btnSave.disabled = false;
        showToast('New password must be at least 6 characters.', 'error');
        return;
      }

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
      email: user.email.toLowerCase()
    };
    
    if (currentRole === 'student') {
      updatePayload.indexNumber = indexNumber;
    }

    var docRef = db.collection(collectionName).doc(user.uid);
    await docRef.set(updatePayload, { merge: true });

    var freshDoc = await docRef.get();
    if (freshDoc.exists) {
      currentUserData = freshDoc.data();
      currentUserData.uid = freshDoc.id;
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
      var iStr = currentUserData.indexNumber ? ' | ID: ' + currentUserData.indexNumber : '';
      var infoEl = document.getElementById('stuDashUserInfo');
      if (infoEl) infoEl.textContent = currentUserData.name + iStr + ' (' + currentUserData.email + ')';
      checkStudentIndexPrompt();
    } else {
      var lecInfoEl = document.getElementById('lecDashUserInfo');
      if (lecInfoEl) lecInfoEl.textContent = currentUserData.name + ' (' + currentUserData.email + ')';
    }

    closeModal('editProfileModal');
    hideLoading();
    if (btnSave) btnSave.disabled = false;
    showToast('Profile updated successfully!', 'success');
    
  } catch (err) {
    hideLoading();
    if (btnSave) btnSave.disabled = false;
    var msg = err.message || 'Profile update failed.';
    if (err.code === 'auth/wrong-password') msg = 'Current password is incorrect.';
    showToast(msg, 'error');
  }
}

// --- 16. STUDENT DASHBOARD CONTROLLERS ---
function initStudentDashboard() {
  requireAuth('student', function(userData) {
    var indexStr = userData.indexNumber ? ' | ID: ' + userData.indexNumber : '';
    var userEl = document.getElementById('stuDashUserInfo');
    if (userEl) userEl.textContent = userData.name + indexStr + ' (' + userData.email + ')';

    var avatarImg = document.getElementById('stuDashAvatar');
    if (avatarImg) {
      if (userData.photoURL) {
        avatarImg.src = userData.photoURL;
        avatarImg.style.display = 'block';
      } else {
        avatarImg.style.display = 'none';
      }
    }

    checkStudentIndexPrompt();
    loadCoursesForStudent();

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

    if (unsubSelf) unsubSelf();
    unsubSelf = db.collection('students').doc(userData.uid).onSnapshot(function(docSnap) {
      if (docSnap.exists) {
        currentUserData = docSnap.data();
        currentUserData.uid = docSnap.id;
        var iStr = currentUserData.indexNumber ? ' | ID: ' + currentUserData.indexNumber : '';
        if (userEl) userEl.textContent = currentUserData.name + iStr + ' (' + currentUserData.email + ')';
        checkStudentIndexPrompt();
      }
    });
  });
}

function checkStudentIndexPrompt() {
  var promptBanner = document.getElementById('stuIndexPromptBanner');
  if (!promptBanner) return;
  if (!currentUserData.indexNumber || currentUserData.indexNumber.trim() === '') {
    promptBanner.style.display = 'flex';
  } else {
    promptBanner.style.display = 'none';
  }
}

function loadCoursesForStudent() {
  var container = document.getElementById('courseListContainer');
  if (!container) return;
  if (!container.hasChildNodes()) {
    container.innerHTML = '<div class="empty-state"><span class="material-icons">hourglass_empty</span>Loading available courses...</div>';
  }

  if (unsubCourses) { unsubCourses(); unsubCourses = null; }

  unsubCourses = db.collection('lecturers').onSnapshot(function(snapshot) {
    var allCourses = [];
    snapshot.forEach(function(doc) {
      var lec = doc.data();
      if (lec && lec.courses && Array.isArray(lec.courses)) {
        lec.courses.forEach(function(c) {
          if (c.courseCode && c.courseTitle) {
            allCourses.push({
              lecturerUid: doc.id,
              lecturerName: lec.name || 'Lecturer',
              lecturerPhoto: lec.photoURL || '',
              courseCode: c.courseCode,
              courseTitle: c.courseTitle
            });
          }
        });
      }
    });

    if (currentCourseCode) {
      var existsStill = allCourses.some(function(c) { return c.courseCode === currentCourseCode; });
      if (!existsStill) {
        leaveQuestionView();
        showToast('This course is no longer available.', 'warning');
      }
    }

    var newSignature = JSON.stringify(allCourses);
    if (newSignature === lastRenderedCoursesSignature) return;
    lastRenderedCoursesSignature = newSignature;

    container.innerHTML = '';
    if (allCourses.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="material-icons">search_off</span>No courses currently available. Check back soon.</div>';
      return;
    }

    allCourses.forEach(function(c) {
      var card = document.createElement('div');
      card.className = 'course-card';

      var infoDiv = document.createElement('div');
      infoDiv.style.display = 'flex';
      infoDiv.style.alignItems = 'center';
      infoDiv.style.gap = '12px';

      if (c.lecturerPhoto) {
        var lecImg = document.createElement('img');
        lecImg.src = c.lecturerPhoto;
        lecImg.className = 'answer-avatar';
        lecImg.alt = 'Lecturer Avatar';
        lecImg.onclick = function(e) {
          e.stopPropagation();
          viewPhotoInLightbox(c.lecturerPhoto, 'Dr. ' + c.lecturerName + ' Profile');
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
      var h4 = document.createElement('h4');
      h4.style.fontSize = '14.5px';
      h4.textContent = c.courseCode + ' — ' + c.courseTitle;

      var p = document.createElement('p');
      p.style.fontSize = '12px';
      p.style.color = '#94a3b8';
      p.textContent = 'Lecturer: ' + c.lecturerName;

      textWrap.appendChild(h4);
      textWrap.appendChild(p);
      infoDiv.appendChild(textWrap);

      var btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-small';
      btn.textContent = 'Join Class';
      btn.onclick = function() { joinCourse(c.courseCode, c.courseTitle, c.lecturerName, c.lecturerPhoto); };

      card.appendChild(infoDiv);
      card.appendChild(btn);
      container.appendChild(card);
    });
  }, function(err) {
    console.warn('Courses listener error, retrying in 2s...', err);
    setTimeout(function() {
      if (!currentCourseCode) loadCoursesForStudent();
    }, 2000);
  });
}

function joinCourse(courseCode, courseTitle, lecName, lecPhoto) {
  if (!checkAndEnforceSubscription()) return;
  currentCourseCode = courseCode;

  var nameEl = document.getElementById('stuQCourseName');
  var infoEl = document.getElementById('stuQLecturerInfo');
  var avatarEl = document.getElementById('stuQLecturerAvatar');

  if (nameEl) nameEl.textContent = courseCode + ' — ' + courseTitle;
  if (infoEl) infoEl.textContent = 'Lecturer: ' + lecName;
  if (avatarEl) {
    if (lecPhoto) {
      avatarEl.src = lecPhoto;
      avatarEl.style.display = 'block';
    } else {
      avatarEl.style.display = 'none';
    }
  }

  document.getElementById('stuBrowseView').style.display = 'none';
  document.getElementById('stuQuestionView').style.display = 'block';
  document.getElementById('stuQuestionInput').value = '';
  document.getElementById('stuAnswerInput').value = '';
  
  switchStudentTab('anon');
  loadQuestionsForStudent(courseCode);
  loadAnswersForStudent(courseCode);
}

function leaveQuestionView() {
  if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }
  if (unsubAnswers) { unsubAnswers(); unsubAnswers = null; }
  currentCourseCode = null;
  document.getElementById('stuBrowseView').style.display = 'block';
  document.getElementById('stuQuestionView').style.display = 'none';
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
      
      // Update Student Counter Badges (Tab Badge & Expanded View)
      updateStudentCounters(questions.length, parseInt(document.getElementById('stuAnswerCountBadge')?.textContent || '0', 10));

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

        data._id = doc.id;
        data._ts = data.createdAt ? data.createdAt.toDate() : new Date();
        answers.push(data);
      });

      if (countBadge) countBadge.textContent = answers.length;
      
      // Update Student Counter Badges (Tab Badge & Expanded View)
      updateStudentCounters(parseInt(document.getElementById('stuQuestionCountBadge')?.textContent || '0', 10), answers.length);

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
  if (!currentCourseCode) {
    showToast('No active course selected.', 'error');
    return;
  }
  if (!confirm('Are you sure you want to delete all your questions for ' + currentCourseCode + '?')) return;

  var btnClear = document.getElementById('btnStuClearQuestions');
  if (btnClear) btnClear.disabled = true;

  showLoading('Clearing your questions...');
  try {
    var snapshot = await db.collection('questions')
      .where('courseCode', '==', currentCourseCode)
      .get();

    var batch = db.batch();
    var count = 0;
    snapshot.docs.forEach((doc) => {
      var data = doc.data();
      if (data.senderEmail === currentUserData.email.toLowerCase()) {
        batch.delete(doc.ref);
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
    }

    hideLoading();
    if (btnClear) btnClear.disabled = false;
    showToast('All your questions for this course have been cleared.', 'success');
  } catch (err) {
    hideLoading();
    if (btnClear) btnClear.disabled = false;
    showToast('Failed to clear questions: ' + err.message, 'error');
  }
}

async function clearStudentAnswerHistory() {
  if (!checkAndEnforceSubscription()) return;
  if (!currentUserData || !currentUserData.uid) {
    showToast('You must be logged in to clear history.', 'error');
    return;
  }
  if (!currentCourseCode) {
    showToast('No active course selected.', 'error');
    return;
  }

  const confirmed = confirm('Are you sure you want to clear all your submitted answers for ' + currentCourseCode + '? This cannot be undone.');
  if (!confirmed) return;

  var btnClear = document.getElementById('clearHistoryBtn');
  if (btnClear) btnClear.disabled = true;

  showLoading('Clearing your submission history...');

  try {
    const snapshot = await db.collection('answers')
      .where('courseCode', '==', currentCourseCode)
      .get();

    if (snapshot.empty) {
      hideLoading();
      if (btnClear) btnClear.disabled = false;
      showToast('No submitted answers found to clear.', 'info');
      return;
    }

    const batch = db.batch();
    let count = 0;
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.studentUid === currentUserData.uid || data.studentEmail === currentUserData.email.toLowerCase()) {
        batch.delete(doc.ref);
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
    }

    const historyContainer = document.getElementById('stuAnswerList');
    if (historyContainer) {
      historyContainer.innerHTML = '<div class="empty-state"><span class="material-icons">task_alt</span>You have not submitted any verbal answers for this course yet.</div>';
    }

    hideLoading();
    if (btnClear) btnClear.disabled = false;
    showToast('Your answer history has been cleared successfully.', 'success');
  } catch (error) {
    hideLoading();
    if (btnClear) btnClear.disabled = false;
    console.error('Error clearing answer history:', error);
    showToast('Failed to clear history. Please try again.', 'error');
  }
}

// --- 17. LECTURER DASHBOARD CONTROLLERS & REAL-TIME ALERTS ---
async function requestLecturerNotificationPermission() {
  try {
    if (typeof Notification === 'undefined') return;
    
    if (Notification.permission === 'blocked' || Notification.permission === 'denied') {
      console.warn('Notifications are blocked by the user in browser settings.');
      return;
    }

    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
    }

    const messaging = firebase.messaging();
    const token = await messaging.getToken({ 
      vapidKey: 'BJBO8yK_V-eTvqcwdGw4vHvbTMn9zdiuGzHvDpqE3y02BsAKSwuOIM5heddfHmNtG84Gur0XgDYvyEemeebyfj0' 
    });
    
    if (token && currentUserData && currentUserData.uid) {
      await db.collection('lecturers').doc(currentUserData.uid).set({
        fcmToken: token
      }, { merge: true });
    }
  } catch (error) {
    console.warn('Notification permission setup skipped:', error);
  }
}

function initLecturerDashboard() {
  requireAuth('lecturer', function(userData) {
    var userEl = document.getElementById('lecDashUserInfo');
    if (userEl) userEl.textContent = userData.name + ' (' + userData.email + ')';

    var avatarImg = document.getElementById('lecDashAvatar');
    if (avatarImg) {
      if (userData.photoURL) {
        avatarImg.src = userData.photoURL;
        avatarImg.style.display = 'block';
      } else {
        avatarImg.style.display = 'none';
      }
    }

    requestLecturerNotificationPermission();
    renderLecturerCourses();

    if (currentCourseCode) {
      setupLecturerRealtimeAlerts(currentCourseCode);
    }

    if (unsubSelf) unsubSelf();
    unsubSelf = db.collection('lecturers').doc(userData.uid).onSnapshot(function(doc) {
      if (doc.exists) {
        currentUserData = doc.data();
        currentUserData.uid = doc.id;
        if (userData.photoURL && avatarImg) {
          avatarImg.src = currentUserData.photoURL;
          avatarImg.style.display = 'block';
        }
        renderLecturerCourses();
      }
    });
  });
}

function renderLecturerCourses() {
  var container = document.getElementById('lecCoursesContainer');
  var filterSelect = document.getElementById('lecCourseFilter');
  if (!container || !filterSelect) return;

  var courses = currentUserData.courses || [];
  container.innerHTML = '';
  filterSelect.innerHTML = '';

  if (courses.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="material-icons">sentiment_dissatisfied</span>No courses registered. Click "Add Course" to create one.</div>';
    filterSelect.innerHTML = '<option value="">No Courses</option>';
    currentCourseCode = null;
    loadQuestionsForLecturer();
    loadAnswersForLecturer();
    return;
  }

  courses.forEach(function(c) {
    var card = document.createElement('div');
    card.className = 'course-card';

    var infoDiv = document.createElement('div');
    var h4 = document.createElement('h4');
    h4.style.fontSize = '14.5px';
    h4.textContent = c.courseCode + ' — ' + c.courseTitle;

    var p = document.createElement('p');
    p.style.fontSize = '12px';
    p.style.color = '#94a3b8';
    p.textContent = 'Active Interactive Classroom';

    infoDiv.appendChild(h4);
    infoDiv.appendChild(p);

    var btn = document.createElement('button');
    btn.className = 'btn btn-warning btn-small';
    btn.innerHTML = '<span class="material-icons" style="font-size:16px;">remove_circle</span> Unregister';
    btn.onclick = function() { unregisterCourse(c.courseCode, btn); };

    card.appendChild(infoDiv);
    card.appendChild(btn);
    container.appendChild(card);

    var opt = document.createElement('option');
    opt.value = c.courseCode;
    opt.textContent = c.courseCode + ' — ' + c.courseTitle;
    filterSelect.appendChild(opt);
  });

  if (!currentCourseCode || !courses.some(function(c){ return c.courseCode === currentCourseCode; })) {
    currentCourseCode = courses[0].courseCode;
  }
  filterSelect.value = currentCourseCode;
  
  setupLecturerRealtimeAlerts(currentCourseCode);
  switchLecturerTab(activeLecturerTab);
}

function switchLecturerActiveCourse(code) {
  currentCourseCode = code;
  setupLecturerRealtimeAlerts(currentCourseCode);
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
  var code = sanitizeInput(document.getElementById('newCourseCode').value).toUpperCase();
  var title = sanitizeInput(document.getElementById('newCourseTitle').value);

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
      showToast('Course code "' + code + '" already exists in the system.', 'error');
      return;
    }

    var updatedCourses = Array.isArray(currentUserData.courses) ? [...currentUserData.courses] : [];
    
    var alreadyExistsForLecturer = updatedCourses.some(function(c) {
      return c.courseCode.toUpperCase() === code;
    });

    if (alreadyExistsForLecturer) {
      hideLoading();
      if (btnSave) btnSave.disabled = false;
      showToast('You have already registered course code "' + code + '".', 'error');
      return;
    }

    updatedCourses.push({ courseCode: code, courseTitle: title });

    await db.collection('lecturers').doc(currentUserData.uid).set({
      courses: updatedCourses
    }, { merge: true });

    currentUserData.courses = updatedCourses;
    renderLecturerCourses();

    closeModal('addCourseModal');
    hideLoading();
    if (btnSave) btnSave.disabled = false;
    showToast('New course added successfully!', 'success');
  } catch (err) {
    hideLoading();
    if (btnSave) btnSave.disabled = false;
    showToast('Failed to add course: ' + err.message, 'error');
  }
}

async function unregisterCourse(code, btnEl) {
  if (!checkAndEnforceSubscription()) return;
  if (!confirm('Are you sure you want to unregister course ' + code + '? It will be removed and its questions/answers cleared.')) return;

  if (btnEl) btnEl.disabled = true;
  showLoading('Unregistering course ' + code + '...');
  try {
    var updatedCourses = (currentUserData.courses || []).filter(function(c) {
      return c.courseCode !== code;
    });

    await db.collection('lecturers').doc(currentUserData.uid).set({
      courses: updatedCourses
    }, { merge: true });

    var qsnap = await db.collection('questions').where('courseCode', '==', code).get();
    var batch1 = db.batch();
    qsnap.forEach(function(doc) { batch1.delete(doc.ref); });
    await batch1.commit();

    var asnap = await db.collection('answers').where('courseCode', '==', code).get();
    var batch2 = db.batch();
    asnap.forEach(function(doc) { batch2.delete(doc.ref); });
    await batch2.commit();

    hideLoading();
    if (btnEl) btnEl.disabled = false;
    showToast('Course ' + code + ' unregistered successfully!', 'success');
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
      
      // Update Lecturer Counter Badges (Tab Badge & Expanded View)
      updateLecturerCounters(questions.length, parseInt(document.getElementById('lecAnswerCountBadge')?.textContent || '0', 10));

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
        data._id = doc.id;
        data._ts = data.createdAt ? data.createdAt.toDate() : new Date();
        answers.push(data);
      });

      if (countBadge) countBadge.textContent = answers.length;
      
      // Update Lecturer Counter Badges (Tab Badge & Expanded View)
      updateLecturerCounters(parseInt(document.getElementById('lecQuestionCountBadge')?.textContent || '0', 10), answers.length);

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
    snap.forEach(function(doc) { batch.delete(doc.ref); });
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
    snap.forEach(function(doc) { batch.delete(doc.ref); });
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

// --- 19. CLIENT-SIDE REAL-TIME NOTIFICATIONS & SYNTH CHIME ---
let lecturerInitialLoadDone = false;
let knownQuestionIds = new Set();
let knownAnswerIds = new Set();
let unsubRealtimeQuestions = null;
let unsubRealtimeAnswers = null;

function playWebAudioChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.15); // G5

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (err) {
    console.warn('Web Audio chime playback failed:', err);
  }
}

function triggerLecturerAlert(title, message, courseCode) {
  playWebAudioChime();
  showToast(title + ' (' + courseCode + '): ' + message.substring(0, 50) + '...', 'info');

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
    new Notification('Eduplus: ' + title, {
      body: message,
      icon: '/icon.png'
    });
  }
}

function setupLecturerRealtimeAlerts(courseCode) {
  if (!courseCode) return;

  if (unsubRealtimeQuestions) { unsubRealtimeQuestions(); unsubRealtimeQuestions = null; }
  if (unsubRealtimeAnswers) { unsubRealtimeAnswers(); unsubRealtimeAnswers = null; }

  if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
    Notification.requestPermission();
  }

  lecturerInitialLoadDone = false;

  unsubRealtimeQuestions = db.collection('questions')
    .where('courseCode', '==', courseCode)
    .onSnapshot(function(snapshot) {
      snapshot.docChanges().forEach(function(change) {
        if (change.type === 'added') {
          const docId = change.doc.id;
          const data = change.doc.data();

          if (lecturerInitialLoadDone && !knownQuestionIds.has(docId)) {
            triggerLecturerAlert('New Question', data.text, courseCode);
          }
          knownQuestionIds.add(docId);
        }
      });
    });

  unsubRealtimeAnswers = db.collection('answers')
    .where('courseCode', '==', courseCode)
    .onSnapshot(function(snapshot) {
      snapshot.docChanges().forEach(function(change) {
        if (change.type === 'added') {
          const docId = change.doc.id;
          const data = change.doc.data();

          if (lecturerInitialLoadDone && !knownAnswerIds.has(docId)) {
            triggerLecturerAlert('New Answer from ' + (data.studentName || 'Student'), data.answerText, courseCode);
          }
          knownAnswerIds.add(docId);
        }
      });
    });

  setTimeout(function() {
    lecturerInitialLoadDone = true;
  }, 1500);
}
