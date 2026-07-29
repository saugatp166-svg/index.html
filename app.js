// ============================================================
// FIREBASE INITIALIZATION
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyAmQxNPKANzO8hEng5pdpAR3t7DJtwkG7U",
  authDomain: "aibmodel.firebaseapp.com",
  databaseURL: "https://aibmodel-default-rtdb.firebaseio.com",
  projectId: "aibmodel",
  storageBucket: "aibmodel.firebasestorage.app",
  messagingSenderId: "572663832515",
  appId: "1:572663832515:web:3fea2dac685b9b5f646776"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// ============================================================
// TELEGRAM / BROWSER DETECTION & AUTHENTICATION
// ============================================================
let currentUserData = null;
let isTelegram = false;

function detectPlatform() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('tg_user_id')) {
    isTelegram = true;
    return {
      id: urlParams.get('tg_user_id'),
      name: urlParams.get('tg_user_name') || 'Telegram User',
      image: urlParams.get('tg_user_photo') || '',
      platform: 'telegram'
    };
  } else if (window.Telegram && window.Telegram.WebApp) {
    isTelegram = true;
    const tg = window.Telegram.WebApp;
    const user = tg.initDataUnsafe.user || {};
    return {
      id: String(user.id || Date.now()),
      name: user.first_name ? user.first_name + (user.last_name ? ' ' + user.last_name : '') : 'Telegram User',
      image: user.photo_url || '',
      platform: 'telegram'
    };
  } else {
    return { platform: 'browser' };
  }
}

async function handleAuth() {
  const platformData = detectPlatform();
  
  if (platformData.platform === 'telegram' && platformData.id) {
    // Telegram User Login
    const uid = 'tg_' + platformData.id;
    try {
      const userCredential = await auth.signInAnonymously();
      const userRef = db.ref('users/' + uid);
      await userRef.update({
        uid: uid,
        name: platformData.name,
        image: platformData.image,
        platform: 'telegram',
        telegramId: platformData.id,
        lastActive: firebase.database.ServerValue.TIMESTAMP
      });
      currentUserData = { uid: uid, ...platformData };
      localStorage.setItem('igram_user', JSON.stringify(currentUserData));
      initPage();
    } catch (e) {
      console.error("Telegram Auth Error:", e);
      showBrowserRegister();
    }
  } else {
    // Browser User Login
    const savedUser = localStorage.getItem('igram_user');
    if (savedUser) {
      currentUserData = JSON.parse(savedUser);
      try {
        await auth.signInAnonymously();
        await db.ref('users/' + currentUserData.uid).update({
          lastActive: firebase.database.ServerValue.TIMESTAMP
        });
        initPage();
      } catch (e) {
        showBrowserRegister();
      }
    } else {
      showBrowserRegister();
    }
  }
}

function showBrowserRegister() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

async function registerBrowserUser() {
  const name = document.getElementById('regName').value.trim();
  if (!name) {
    showToast('Please enter your name', 'error');
    return;
  }

  try {
    const userCredential = await auth.signInAnonymously();
    const uid = 'br_' + userCredential.user.uid;
    const userRef = db.ref('users/' + uid);
    
    // Generate a random avatar for browser users
    const randomSeed = Math.random().toString(36).substring(7);
    
    await userRef.set({
      uid: uid,
      name: name,
      image: 'https://picsum.photos/seed/' + randomSeed + '/200/200.jpg',
      platform: 'browser',
      lastActive: firebase.database.ServerValue.TIMESTAMP,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });

    currentUserData = {
      uid: uid,
      name: name,
      image: 'https://picsum.photos/seed/' + randomSeed + '/200/200.jpg',
      platform: 'browser'
    };
    
    localStorage.setItem('igram_user', JSON.stringify(currentUserData));
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    initPage();
  } catch (e) {
    console.error("Registration Error:", e);
    showToast('Registration failed, try again.', 'error');
  }
}

// ============================================================
// REAL-TIME DATABASE SYNC FUNCTIONS
// ============================================================

// POSTS
function createPost(postData) {
  const newPostRef = db.ref('posts').push();
  return newPostRef.set({
    ...postData,
    uid: currentUserData.uid,
    username: currentUserData.name,
    avatar: currentUserData.image,
    likes: 0,
    likedBy: {},
    comments: {},
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });
}

function fetchAllPosts(callback) {
  db.ref('posts').orderByChild('createdAt').on('value', (snapshot) => {
    const posts = [];
    snapshot.forEach((childSnapshot) => {
      const data = childSnapshot.val();
      data.id = childSnapshot.key;
      posts.push(data);
    });
    callback(posts.reverse()); // newest first
  });
}

function toggleLike(postId) {
  if (!currentUserData) return;
  const likeRef = db.ref('posts/' + postId + '/likedBy/' + currentUserData.uid);
  likeRef.once('value').then((snapshot) => {
    if (snapshot.exists()) {
      likeRef.remove();
    } else {
      likeRef.set(true);
    }
  });
}

function addComment(postId, text) {
  if (!currentUserData || !text.trim()) return;
  db.ref('posts/' + postId + '/comments').push({
    uid: currentUserData.uid,
    username: currentUserData.name,
    text: text.trim(),
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });
}

function toggleBookmark(postId) {
  if (!currentUserData) return;
  const bookmarkRef = db.ref('users/' + currentUserData.uid + '/bookmarks/' + postId);
  bookmarkRef.once('value').then((snapshot) => {
    if (snapshot.exists()) {
      bookmarkRef.remove();
    } else {
      bookmarkRef.set(true);
    }
  });
}

// WALLET
function fetchWalletData(callback) {
  if (!currentUserData) return;
  db.ref('users/' + currentUserData.uid).on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      callback({
        balance: data.balance || 0,
        transactions: data.transactions || {}
      });
    }
  });
}

function updateWalletTransaction(type, amount, description) {
  if (!currentUserData) return;
  const userRef = db.ref('users/' + currentUserData.uid);
  const txRef = userRef.child('transactions').push();
  
  userRef.transaction((currentData) => {
    if (currentData === null) currentData = {};
    if (!currentData.balance) currentData.balance = 0;
    
    if (type === 'deposit' || type === 'reward') {
      currentData.balance += amount;
    } else if (type === 'withdraw' || type === 'transfer') {
      if (currentData.balance >= amount) {
        currentData.balance -= amount;
      } else {
        return; // abort transaction if insufficient funds
      }
    }
    return currentData;
  }).then((result) => {
    if (!result.committed) {
      showToast('Insufficient balance', 'error');
      return;
    }
    txRef.set({
      type: type,
      amount: amount,
      description: description,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    showToast('Transaction successful', 'success');
  });
}

// REFERRAL
function generateReferralCode() {
  if (!currentUserData) return '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'IG-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function initReferralSystem() {
  if (!currentUserData) return;
  const refRef = db.ref('users/' + currentUserData.uid + '/referral');
  refRef.once('value').then((snapshot) => {
    if (!snapshot.exists()) {
      refRef.set({
        code: generateReferralCode(),
        invited: 0,
        active: 0,
        earned: 0
      });
    }
  });
}

function fetchReferralData(callback) {
  if (!currentUserData) return;
  db.ref('users/' + currentUserData.uid + '/referral').on('value', (snapshot) => {
    callback(snapshot.val() || { code: 'N/A', invited: 0, active: 0, earned: 0 });
  });
}

function fetchReferralList(callback) {
  if (!currentUserData) return;
  db.ref('users/' + currentUserData.uid + '/referredUsers').orderByChild('createdAt').on('value', (snapshot) => {
    const list = [];
    snapshot.forEach((child) => {
      list.push(child.val());
    });
    callback(list.reverse());
  });
}

function processReferral(code) {
  if (!currentUserData || !code) return;
  db.ref('users').orderByChild('referral/code').equalTo(code).once('value').then((snapshot) => {
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const referrerUid = child.key;
        if (referrerUid !== currentUserData.uid) {
          const referredRef = db.ref('users/' + referrerUid + '/referredUsers/' + currentUserData.uid);
          referredRef.once('value').then((s) => {
            if (!s.exists()) {
              referredRef.set({
                name: currentUserData.name,
                image: currentUserData.image,
                createdAt: firebase.database.ServerValue.TIMESTAMP
              });
              db.ref('users/' + referrerUid + '/referral').transaction((refData) => {
                if (refData) {
                  refData.invited = (refData.invited || 0) + 1;
                  refData.active = (refData.active || 0) + 1;
                  refData.earned = (refData.earned || 0) + 10;
                }
                return refData;
              });
              // Give reward to referrer
              updateWalletTransactionSilent(referrerUid, 'reward', 10, 'Referral reward for ' + currentUserData.name);
            }
          });
        }
      });
    }
  });
}

function updateWalletTransactionSilent(targetUid, type, amount, description) {
  const userRef = db.ref('users/' + targetUid);
  const txRef = userRef.child('transactions').push();
  userRef.transaction((currentData) => {
    if (currentData === null) currentData = {};
    if (!currentData.balance) currentData.balance = 0;
    if (type === 'reward') currentData.balance += amount;
    return currentData;
  }).then((result) => {
    if (result.committed) {
      txRef.set({ type, amount, description, createdAt: firebase.database.ServerValue.TIMESTAMP });
    }
  });
}

// PROFILE
function updateProfilePic(url) {
  if (!currentUserData) return;
  db.ref('users/' + currentUserData.uid + '/image').set(url);
  currentUserData.image = url;
  localStorage.setItem('igram_user', JSON.stringify(currentUserData));
  loadProfileUI();
}

function fetchProfilePosts(callback) {
  if (!currentUserData) return;
  db.ref('posts').orderByChild('uid').equalTo(currentUserData.uid).on('value', (snapshot) => {
    const posts = [];
    snapshot.forEach((child) => {
      posts.push({ id: child.key, ...child.val() });
    });
    callback(posts.reverse());
  });
}

// ============================================================
// UI UTILITIES (Original implementations preserved)
// ============================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
  toast.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i> ' + message;
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
}

function openModal(content) {
  document.getElementById('modalContent').innerHTML = content;
  document.getElementById('modalOverlay').classList.add('show');
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modalOverlay')) return;
  document.getElementById('modalOverlay').classList.remove('show');
}

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  const days = Math.floor(hrs / 24);
  return days + 'd';
}

// Global init fallback
function initPage() {
  if (typeof setupPage === 'function') {
    setupPage();
  }
}

// Start App
auth.onAuthStateChanged(() => {
  handleAuth();
});