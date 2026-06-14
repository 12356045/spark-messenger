import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, getDocs, onSnapshot, orderBy, doc, updateDoc, setDoc, getDoc, where, arrayUnion, arrayRemove, deleteDoc, writeBatch, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDGQObyd4h5dYzLgZOxSFDaBY_f9ulJpdI",
    authDomain: "spark-ead35.firebaseapp.com",
    projectId: "spark-ead35",
    storageBucket: "spark-ead35.firebasestorage.app",
    messagingSenderId: "391789994095",
    appId: "1:391789994095:web:374032b2838133dd076d9a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null, currentChatId = null, unsubMessages = null, editingMessageId = null;
let notificationsEnabled = false;
let mediaRecorderVoice = null, audioChunksVoice = [], isRecordingVoice = false;
let onlineStatusInterval = null;

// WebRTC переменные
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let currentCallDocId = null;
let callUnsubscribe = null;
let isCallActive = false;

// Переменные для кружков
let currentStream = null;
let currentFacingMode = 'user';
let mediaRecorderCircle = null;
let videoChunks = [];
let isRecordingCircle = false;
let recordingStartTime = null;
let recordingTimerInterval = null;

let customNamesCache = {};

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

// ========== НАВИГАЦИЯ ПО ЭКРАНАМ ==========
let currentScreenIndex = 0;
const screens = ['welcomeScreen', 'featuresScreen', 'authChoiceScreen'];

function showScreen(index) {
    screens.forEach((screenId, i) => {
        const screen = document.getElementById(screenId);
        if (screen) {
            if (i === index) screen.classList.remove('hidden');
            else screen.classList.add('hidden');
        }
    });
    currentScreenIndex = index;
}

function nextScreen() {
    if (currentScreenIndex < screens.length - 1) showScreen(currentScreenIndex + 1);
}

function prevScreen() {
    if (currentScreenIndex > 0) showScreen(currentScreenIndex - 1);
}

let touchStartX = 0;
document.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; });
document.addEventListener('touchend', (e) => {
    let diff = touchStartX - e.changedTouches[0].screenX;
    if (diff > 50) nextScreen();
    else if (diff < -50) prevScreen();
});

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========
function escape(str) { 
    return str ? str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]) : ''; 
}

function isEmojiOnly(text) { 
    if (!text) return false;
    const emojiRegex = /^[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}\u{1F600}-\u{1F64F}\s]+$/u; 
    return emojiRegex.test(text.trim()); 
}

function showDynamicIsland(message, type = 'info') {
    const oldNotif = document.querySelector('.dynamic-island');
    if (oldNotif) oldNotif.remove();
    const island = document.createElement('div');
    island.className = 'dynamic-island';
    let icon = '';
    if (type === 'error') icon = '❌ ';
    else if (type === 'success') icon = '✅ ';
    else if (type === 'recording') icon = '🎙️ ';
    else if (type === 'circle') icon = '📹 ';
    else if (type === 'file') icon = '📎 ';
    else if (type === 'message') icon = '💬 ';
    else if (type === 'call') icon = '📞 ';
    else icon = '⚡ ';
    island.innerHTML = `${icon}${message}`;
    document.body.appendChild(island);
    setTimeout(() => island.remove(), 2500);
}

async function updateOnlineStatus() {
    if (!currentUser) return;
    await updateDoc(doc(db, "users", currentUser.uid), { online: true, lastSeen: serverTimestamp() }).catch(() => {});
}

async function setOfflineStatus() {
    if (!currentUser) return;
    await updateDoc(doc(db, "users", currentUser.uid), { online: false, lastSeen: serverTimestamp() }).catch(() => {});
}
window.addEventListener('beforeunload', () => setOfflineStatus());

async function markMessagesAsRead(chatId) {
    if (!currentUser) return;
    try {
        const messagesQuery = query(collection(db, "messages"), where("chatId", "==", chatId));
        const snapshot = await getDocs(messagesQuery);
        const batch = writeBatch(db);
        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.read && data.senderId !== currentUser.uid) {
                batch.update(doc.ref, { read: true, readAt: serverTimestamp() });
            }
        });
        await batch.commit();
    } catch(e) {
        console.log("Ошибка markMessagesAsRead:", e);
    }
}

async function getCustomNameForUser(targetUserId) {
    if (customNamesCache[targetUserId]) return customNamesCache[targetUserId];
    
    try {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        const userData = userDoc.data();
        const customSubs = userData.customSubscriptions || [];
        const subscription = customSubs.find(s => s.userId === targetUserId);
        
        if (subscription && subscription.name) {
            customNamesCache[targetUserId] = subscription.name;
            return subscription.name;
        }
        
        const targetDoc = await getDoc(doc(db, "users", targetUserId));
        if (targetDoc.exists()) {
            const targetData = targetDoc.data();
            customNamesCache[targetUserId] = targetData.username;
            return targetData.username;
        }
        
        return targetUserId;
    } catch(e) {
        console.error("Ошибка получения имени:", e);
        return targetUserId;
    }
}

// ========== ПОДПИСКИ ==========
async function addCustomSubscription(targetUserId, customName) {
    if (!currentUser || targetUserId === currentUser.uid) return;
    
    if (!customName || customName.trim() === '') {
        showDynamicIsland('❌ Введите имя для подписки', 'error');
        return;
    }
    
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const userData = userDoc.data();
    const existingSub = (userData.customSubscriptions || []).find(s => s.userId === targetUserId);
    
    if (existingSub) {
        showDynamicIsland('⚠️ Вы уже подписаны на этого пользователя', 'error');
        return;
    }
    
    await updateDoc(doc(db, "users", currentUser.uid), {
        customSubscriptions: arrayUnion({
            userId: targetUserId,
            name: customName.trim(),
            timestamp: new Date()
        })
    });
    
    await updateDoc(doc(db, "users", targetUserId), {
        subscribers: arrayUnion(currentUser.uid)
    });
    
    customNamesCache[targetUserId] = customName.trim();
    showDynamicIsland(`✅ Подписка добавлена: ${customName.trim()}`, 'success');
    loadChats();
}

async function removeCustomSubscription(targetUserId) {
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const userData = userDoc.data();
    const subscription = (userData.customSubscriptions || []).find(s => s.userId === targetUserId);
    
    if (subscription) {
        await updateDoc(doc(db, "users", currentUser.uid), {
            customSubscriptions: arrayRemove(subscription)
        });
        
        await updateDoc(doc(db, "users", targetUserId), {
            subscribers: arrayRemove(currentUser.uid)
        });
        
        delete customNamesCache[targetUserId];
        showDynamicIsland(`🗑️ Подписка удалена`, 'success');
        loadChats();
    }
}

async function renameCustomSubscription(targetUserId, newName) {
    if (!newName || newName.trim() === '') {
        showDynamicIsland('❌ Имя не может быть пустым', 'error');
        return;
    }
    
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const userData = userDoc.data();
    const customSubs = userData.customSubscriptions || [];
    const subscription = customSubs.find(s => s.userId === targetUserId);
    
    if (subscription) {
        const updatedSubs = customSubs.filter(s => s.userId !== targetUserId);
        updatedSubs.push({
            userId: targetUserId,
            name: newName.trim(),
            timestamp: new Date()
        });
        
        await updateDoc(doc(db, "users", currentUser.uid), {
            customSubscriptions: updatedSubs
        });
        
        customNamesCache[targetUserId] = newName.trim();
        showDynamicIsland(`✏️ Переименовано в "${newName.trim()}"`, 'success');
        loadChats();
    }
}

function showAddSubscriptionDialog(targetUserId) {
    const customName = prompt('📝 Введите имя для этого человека:', '');
    if (customName && customName.trim()) {
        addCustomSubscription(targetUserId, customName.trim());
    }
}

async function loadCustomSubscriptions() {
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const userData = userDoc.data();
    const customSubs = userData.customSubscriptions || [];
    const subscribers = userData.subscribers || [];
    
    const subscribersCount = document.getElementById('subscribersCount');
    const subscriptionsCount = document.getElementById('subscriptionsCount');
    if (subscribersCount) subscribersCount.textContent = subscribers.length;
    if (subscriptionsCount) subscriptionsCount.textContent = customSubs.length;
    
    const container = document.getElementById('subscribersList');
    if (!container) return;
    container.innerHTML = '';
    
    if (subscribers.length > 0) {
        container.innerHTML += '<div style="padding:8px 0; color: #667eea; font-size: 12px;">👥 ПОДПИСЧИКИ:</div>';
        for (const subId of subscribers) {
            const subDoc = await getDoc(doc(db, "users", subId));
            if (subDoc.exists()) {
                const sub = subDoc.data();
                const subData = subDoc.data();
                const customNameFromSub = (subData.customSubscriptions || []).find(s => s.userId === currentUser.uid);
                const displayName = customNameFromSub ? customNameFromSub.name : sub.username;
                
                container.innerHTML += `<div class="friend-item" style="display: flex; justify-content: space-between;">
                    <div><strong>${escape(displayName)}</strong><br><small>@${escape(sub.username)}</small></div>
                    <button class="small-btn chatFromSubscribe" data-uid="${sub.uid}" data-name="${escape(sub.username)}">💬</button>
                </div>`;
            }
        }
    }
    
    if (customSubs.length > 0) {
        container.innerHTML += '<div style="padding:8px 0; margin-top: 12px; color: #667eea; font-size: 12px;">⭐ ВАШИ ПОДПИСКИ:</div>';
        for (const sub of customSubs) {
            const subDoc = await getDoc(doc(db, "users", sub.userId));
            if (subDoc.exists()) {
                const user = subDoc.data();
                container.innerHTML += `<div class="friend-item" style="display: flex; justify-content: space-between;">
                    <div><strong>${escape(sub.name)}</strong><br><small>@${escape(user.username)}</small></div>
                    <div style="display: flex; gap: 6px;">
                        <button class="small-btn renameSubscriptionBtn" data-uid="${sub.userId}" data-oldname="${escape(sub.name)}">✏️</button>
                        <button class="small-btn removeSubscriptionBtn" data-uid="${sub.userId}" style="background: #e74c3c;">🗑️</button>
                    </div>
                </div>`;
            }
        }
    }
    
    if (subscribers.length === 0 && customSubs.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.5);">Нет подписок</div>';
    }
    
    document.querySelectorAll('.chatFromSubscribe').forEach(btn => {
        btn.onclick = () => createChat({ uid: btn.dataset.uid, username: btn.dataset.name });
    });
    
    document.querySelectorAll('.removeSubscriptionBtn').forEach(btn => {
        btn.onclick = () => removeCustomSubscription(btn.dataset.uid);
    });
    
    document.querySelectorAll('.renameSubscriptionBtn').forEach(btn => {
        btn.onclick = async () => {
            const newName = prompt('Введите новое имя для подписки:', btn.dataset.oldname);
            if (newName && newName.trim()) {
                await renameCustomSubscription(btn.dataset.uid, newName.trim());
                loadCustomSubscriptions();
            }
        };
    });
}

// ========== ЗАПРОСЫ В ДРУЗЬЯ ==========
async function sendFriendRequest(targetUserId) {
    if (!currentUser || targetUserId === currentUser.uid) {
        showDynamicIsland('❌ Нельзя добавить самого себя', 'error');
        return;
    }
    
    try {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        const userData = userDoc.data();
        
        if (userData.friends && userData.friends.includes(targetUserId)) {
            showDynamicIsland('👥 Этот пользователь уже в друзьях', 'error');
            return;
        }
        
        await updateDoc(doc(db, "users", targetUserId), {
            friendRequests: arrayUnion(currentUser.uid)
        });
        
        showDynamicIsland('✅ Запрос в друзья отправлен!', 'success');
        
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        const searchResults = document.getElementById('searchResults');
        if (searchResults) searchResults.style.display = 'none';
        
    } catch(e) {
        console.error("Ошибка отправки запроса:", e);
        showDynamicIsland('❌ Ошибка при отправке запроса', 'error');
    }
}

async function acceptFriendRequest(friendId) {
    try {
        await updateDoc(doc(db, "users", currentUser.uid), {
            friends: arrayUnion(friendId),
            friendRequests: arrayRemove(friendId)
        });
        
        await updateDoc(doc(db, "users", friendId), {
            friends: arrayUnion(currentUser.uid)
        });
        
        showDynamicIsland('✅ Запрос принят! Теперь вы друзья', 'success');
        
        loadFriendsList();
        loadRequestsList();
        loadChats();
        
    } catch(e) {
        console.error("Ошибка принятия запроса:", e);
        showDynamicIsland('❌ Ошибка при принятии запроса', 'error');
    }
}

async function rejectFriendRequest(friendId) {
    try {
        await updateDoc(doc(db, "users", currentUser.uid), {
            friendRequests: arrayRemove(friendId)
        });
        
        showDynamicIsland('❌ Запрос отклонён', 'info');
        loadRequestsList();
        
    } catch(e) {
        console.error("Ошибка отклонения запроса:", e);
        showDynamicIsland('❌ Ошибка при отклонении запроса', 'error');
    }
}

async function removeFriend(friendId, friendName) {
    if (!confirm(`Удалить ${friendName} из друзей?`)) return;
    
    try {
        await updateDoc(doc(db, "users", currentUser.uid), {
            friends: arrayRemove(friendId)
        });
        await updateDoc(doc(db, "users", friendId), {
            friends: arrayRemove(currentUser.uid)
        });
        
        // Удаляем чат с этим другом
        const chatsSnapshot = await getDocs(collection(db, "chats"));
        let chatToDelete = null;
        chatsSnapshot.forEach(doc => {
            const chat = doc.data();
            if (chat.type === 'private' && chat.members) {
                const members = chat.members.map(m => m.uid);
                if (members.includes(currentUser.uid) && members.includes(friendId)) {
                    chatToDelete = doc.id;
                }
            }
        });
        
        if (chatToDelete) {
            const messagesQuery = query(collection(db, "messages"), where("chatId", "==", chatToDelete));
            const messagesSnapshot = await getDocs(messagesQuery);
            const batch = writeBatch(db);
            messagesSnapshot.forEach(msg => batch.delete(msg.ref));
            await batch.commit();
            await deleteDoc(doc(db, "chats", chatToDelete));
            
            if (currentChatId === chatToDelete) {
                document.getElementById('chatView').style.display = 'none';
                currentChatId = null;
                if (unsubMessages) unsubMessages();
            }
        }
        
        showDynamicIsland('Друг удалён', 'success');
        loadFriendsList();
        loadChats();
        
    } catch(e) {
        console.error("Ошибка:", e);
        showDynamicIsland('Ошибка при удалении друга', 'error');
    }
}

// ========== ЗАГРУЗКА ДРУЗЕЙ ДЛЯ ВКЛАДКИ ==========
async function loadFriendsList() {
    if (!currentUser) return;
    
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const friends = userDoc.data()?.friends || [];
    
    const container = document.getElementById('myFriendsListContainer');
    if (!container) return;
    
    if (friends.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">🤝 У вас пока нет друзей<br><br>🔍 Найдите друзей через поиск</div>';
        return;
    }
    
    container.innerHTML = '';
    
    for (const fid of friends) {
        const fDoc = await getDoc(doc(db, "users", fid));
        if (fDoc.exists()) {
            const f = fDoc.data();
            const displayName = await getCustomNameForUser(fid);
            
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);';
            div.innerHTML = `
                <div class="friend-avatar" style="width:52px;height:52px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;color:white;"><i class="fas fa-user"></i></div>
                <div style="flex:1;">
                    <div style="color:white;font-weight:600;font-size:16px;">${escape(displayName)}</div>
                    <div style="color:rgba(255,255,255,0.5);font-size:13px;margin-top:4px;">@${escape(f.username)}</div>
                </div>
                <button class="small-btn chat-from-friends" data-uid="${fid}" data-name="${escape(displayName)}" style="background:#667eea;">💬</button>
            `;
            container.appendChild(div);
        }
    }
    
    document.querySelectorAll('.chat-from-friends').forEach(btn => {
        btn.onclick = () => createChat({ uid: btn.dataset.uid, username: btn.dataset.name });
    });
}

// ========== ЗАГРУЗКА ЗАПРОСОВ ==========
async function loadRequestsList() {
    if (!currentUser) return;
    
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const requests = userDoc.data()?.friendRequests || [];
    
    const badge = document.getElementById('requestsCountBadge');
    if (badge) badge.textContent = requests.length;
    
    const container = document.getElementById('requestsListContainer');
    if (!container) return;
    
    if (requests.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">📭 Нет входящих запросов</div>';
        return;
    }
    
    container.innerHTML = '';
    
    for (const rid of requests) {
        const rDoc = await getDoc(doc(db, "users", rid));
        if (rDoc.exists()) {
            const r = rDoc.data();
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);';
            div.innerHTML = `
                <div style="width:52px;height:52px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;color:white;"><i class="fas fa-user"></i></div>
                <div style="flex:1;">
                    <div style="color:white;font-weight:600;font-size:16px;">${escape(r.username)}</div>
                    <div style="color:rgba(255,255,255,0.5);font-size:13px;margin-top:4px;">${escape(r.name)}</div>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="small-btn acceptReqBtn" data-uid="${rid}" style="background:#2ecc71;">✓ Принять</button>
                    <button class="small-btn rejectReqBtn" data-uid="${rid}" style="background:#e74c3c;">✗ Отклонить</button>
                </div>
            `;
            container.appendChild(div);
        }
    }
    
    document.querySelectorAll('.acceptReqBtn').forEach(btn => {
        btn.onclick = () => acceptFriendRequest(btn.dataset.uid);
    });
    
    document.querySelectorAll('.rejectReqBtn').forEach(btn => {
        btn.onclick = () => rejectFriendRequest(btn.dataset.uid);
    });
}

// ========== ПОИСК ==========
const searchInput = document.getElementById('searchInput');
if (searchInput) {
    searchInput.addEventListener('input', async () => { 
        let t = searchInput.value.trim().toLowerCase(); 
        let r = document.getElementById('searchResults'); 
        if(t.length < 2) { if(r) r.style.display = 'none'; return; } 
        let u = await getDocs(collection(db, "users")); 
        if(r) r.innerHTML = ''; 
        u.forEach(d => { 
            let ud = d.data(); 
            if(ud.username && ud.username.toLowerCase().includes(t) && ud.uid !== currentUser?.uid) { 
                let div = document.createElement('div'); 
                div.className = 'search-item'; 
                div.style.cssText = 'padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);color:white';
                div.innerHTML = `<div><strong style="color:white">${escape(ud.username)}</strong><br><small style="color:rgba(255,255,255,0.7)">${escape(ud.name)}</small></div>
                    <div style="display: flex; gap: 6px;">
                        <button class="small-btn addFriendBtn" data-uid="${ud.uid}">➕ Друг</button>
                        <button class="small-btn subscribeBtn" data-uid="${ud.uid}">⭐ Подписаться</button>
                    </div>`; 
                r.appendChild(div); 
            } 
        }); 
        if(r) r.style.display = 'block'; 
        
        document.querySelectorAll('.addFriendBtn').forEach(btn => { 
            btn.onclick = async e => { 
                e.stopPropagation(); 
                await sendFriendRequest(btn.dataset.uid);
            }; 
        }); 
        
        document.querySelectorAll('.subscribeBtn').forEach(btn => { 
            btn.onclick = async e => { 
                e.stopPropagation(); 
                showAddSubscriptionDialog(btn.dataset.uid);
                if(r) r.style.display = 'none'; 
                searchInput.value = ''; 
            }; 
        }); 
    });
}

// ========== ЗВОНКИ ==========
async function initMedia(video = false) {
    try {
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        const constraints = { 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, 
            video: video ? { facingMode: { exact: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } } : false 
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (video) {
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = localStream;
                localVideo.style.display = 'block';
                localVideo.setAttribute('autoplay', '');
                localVideo.setAttribute('playsinline', '');
                localVideo.muted = true;
            }
        }
        return true;
    } catch(err) { 
        console.error("Media error:", err);
        showDynamicIsland('🎤 Разрешите доступ к микрофону и камере', 'error'); 
        return false; 
    }
}

function showVideoUI(show) {
    let container = document.getElementById('videoCallContainer');
    if (!container && show) {
        container = document.createElement('div');
        container.id = 'videoCallContainer';
        container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #000;
            z-index: 2000;
            display: flex;
            flex-direction: column;
        `;
        
        container.innerHTML = `
            <div style="position: relative; flex: 1; background: #000;">
                <video id="remoteVideo" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>
                <video id="localVideo" autoplay playsinline muted style="position: absolute; bottom: 20px; right: 20px; width: 120px; height: 160px; object-fit: cover; border-radius: 12px; border: 2px solid white; background: #333; cursor: pointer;"></video>
                <div style="position: absolute; bottom: 30px; left: 0; right: 0; text-align: center; display: flex; justify-content: center; gap: 15px;">
                    <button id="endCallVideoBtn" style="background: #e74c3c; border: none; padding: 12px 24px; border-radius: 40px; color: white; font-size: 16px; cursor: pointer;">
                        <i class="fas fa-phone-slash"></i> Завершить
                    </button>
                    <button id="toggleMicBtn" style="background: #333; border: none; padding: 12px 24px; border-radius: 40px; color: white; font-size: 16px; cursor: pointer;">
                        <i class="fas fa-microphone"></i>
                    </button>
                    <button id="toggleCameraBtn" style="background: #333; border: none; padding: 12px 24px; border-radius: 40px; color: white; font-size: 16px; cursor: pointer;">
                        <i class="fas fa-video"></i>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(container);
        
        let micEnabled = true;
        let cameraEnabled = true;
        
        document.getElementById('endCallVideoBtn')?.addEventListener('click', () => endCall());
        document.getElementById('toggleMicBtn')?.addEventListener('click', () => {
            if (localStream) {
                const audioTrack = localStream.getAudioTracks()[0];
                if (audioTrack) {
                    micEnabled = !micEnabled;
                    audioTrack.enabled = micEnabled;
                    document.getElementById('toggleMicBtn').innerHTML = micEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
                    showDynamicIsland(micEnabled ? 'Микрофон включён' : 'Микрофон выключен', 'info');
                }
            }
        });
        
        document.getElementById('toggleCameraBtn')?.addEventListener('click', () => {
            if (localStream) {
                const videoTrack = localStream.getVideoTracks()[0];
                if (videoTrack) {
                    cameraEnabled = !cameraEnabled;
                    videoTrack.enabled = cameraEnabled;
                    document.getElementById('toggleCameraBtn').innerHTML = cameraEnabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
                    showDynamicIsland(cameraEnabled ? 'Камера включена' : 'Камера выключена', 'info');
                }
            }
        });
    }
    
    if (container) container.style.display = show ? 'flex' : 'none';
    if (show && localStream) {
        const localVideo = document.getElementById('localVideo');
        if (localVideo && localStream) localVideo.srcObject = localStream;
    }
}

function hideVideoUI() {
    const container = document.getElementById('videoCallContainer');
    if (container) container.remove();
}

async function createPeerConnection(isVideo) {
    if (peerConnection) peerConnection.close();
    peerConnection = new RTCPeerConnection(rtcConfig);
    if (localStream) localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    peerConnection.ontrack = (e) => {
        remoteStream = e.streams[0];
        if (isVideo) {
            const remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo) {
                remoteVideo.srcObject = remoteStream;
                remoteVideo.play().catch(e => console.log('Play error:', e));
            }
        } else {
            const audio = new Audio();
            audio.srcObject = remoteStream;
            audio.play().catch(e => console.log('Audio play error:', e));
        }
        showDynamicIsland('🔊 Соединение установлено', 'success');
        if (document.getElementById('callStatus')) document.getElementById('callStatus').textContent = '🎙️ В разговоре...';
        isCallActive = true;
    };
    peerConnection.onicecandidate = async (e) => {
        if (e.candidate && currentCallDocId) {
            try { await updateDoc(doc(db, "calls", currentCallDocId), { [`ice_${Date.now()}`]: JSON.stringify(e.candidate) }); } catch(e) {}
        }
    };
    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'failed') { showDynamicIsland('❌ Соединение потеряно', 'error'); endCall(); }
    };
    return peerConnection;
}

async function startCall(targetUserId, isVideo = false) {
    if (!currentChatId) { showDynamicIsland('Выберите чат', 'error'); return; }
    if (isCallActive) { showDynamicIsland('Уже есть звонок', 'error'); return; }
    const target = (await getDoc(doc(db, "users", targetUserId))).data();
    if (!target?.online) { showDynamicIsland('Пользователь не в сети', 'error'); return; }
    if (!await initMedia(isVideo)) return;
    const targetName = await getCustomNameForUser(targetUserId);
    if (isVideo) showVideoUI(true);
    else {
        const callerInfo = document.getElementById('callerInfo');
        const callModal = document.getElementById('callModal');
        const activeCallControls = document.getElementById('activeCallControls');
        const callControls = document.getElementById('callControls');
        const callStatus = document.getElementById('callStatus');
        if (callerInfo) callerInfo.innerHTML = `<div><strong>${escape(targetName)}</strong><br>🎙️ Аудиозвонок</div>`;
        if (callModal) callModal.style.display = 'flex';
        if (activeCallControls) activeCallControls.style.display = 'flex';
        if (callControls) callControls.style.display = 'none';
        if (callStatus) callStatus.textContent = '⏳ Ожидание ответа...';
    }
    const callRef = await addDoc(collection(db, "calls"), { callerId: currentUser.uid, targetId: targetUserId, isVideo, status: "calling", timestamp: serverTimestamp() });
    currentCallDocId = callRef.id;
    await addDoc(collection(db, "messages"), { chatId: currentChatId, type: 'call', callId: callRef.id, isVideo, callStatus: 'calling', callerId: currentUser.uid, callerName: targetName, timestamp: new Date(), read: false });
    await createPeerConnection(isVideo);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await updateDoc(doc(db, "calls", callRef.id), { offer: JSON.stringify({ type: offer.type, sdp: offer.sdp }) });
    if (callUnsubscribe) callUnsubscribe();
    callUnsubscribe = onSnapshot(doc(db, "calls", callRef.id), async (snap) => {
        const data = snap.data();
        if (data?.answer && peerConnection?.signalingState === 'have-local-offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(data.answer)));
            isCallActive = true;
        }
        for (const [k, v] of Object.entries(data || {})) {
            if (k.startsWith('ice_') && v && peerConnection) {
                try { await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(v))); await updateDoc(doc(db, "calls", callRef.id), { [k]: null }); } catch(e) {}
            }
        }
        if (data?.status === 'rejected') { endCall(); showDynamicIsland('Звонок отклонён', 'error'); }
        if (data?.status === 'ended') endCall();
    });
    setTimeout(async () => { if (currentCallDocId === callRef.id && !isCallActive) { await updateDoc(doc(db, "calls", callRef.id), { status: "timeout" }); endCall(); } }, 60000);
}

async function answerCall(callId, callerId, isVideo) {
    if (isCallActive) { showDynamicIsland('Уже есть звонок', 'error'); return; }
    currentCallDocId = callId;
    if (!await initMedia(isVideo)) return;
    if (isVideo) showVideoUI(true);
    const callData = (await getDoc(doc(db, "calls", callId))).data();
    if (callData?.status !== 'calling') { showDynamicIsland('Звонок неактивен', 'error'); return; }
    await createPeerConnection(isVideo);
    const offer = JSON.parse(callData.offer);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await updateDoc(doc(db, "calls", callId), { answer: JSON.stringify({ type: answer.type, sdp: answer.sdp }), status: "active" });
    if (callUnsubscribe) callUnsubscribe();
    callUnsubscribe = onSnapshot(doc(db, "calls", callId), async (snap) => {
        const data = snap.data();
        for (const [k, v] of Object.entries(data || {})) {
            if (k.startsWith('ice_') && v && peerConnection) {
                try { await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(v))); await updateDoc(doc(db, "calls", callId), { [k]: null }); } catch(e) {}
            }
        }
        if (data?.status === 'ended') endCall();
    });
}

function endCall() {
    isCallActive = false;
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    if (currentCallDocId) updateDoc(doc(db, "calls", currentCallDocId), { status: "ended" }).catch(() => {});
    if (callUnsubscribe) callUnsubscribe();
    hideVideoUI();
    const callModal = document.getElementById('callModal');
    if (callModal) callModal.style.display = 'none';
    currentCallDocId = null;
}

function listenForIncomingCalls() {
    if (!currentUser) return;
    onSnapshot(query(collection(db, "calls"), where("targetId", "==", currentUser.uid), where("status", "==", "calling")), async (snap) => {
        for (const d of snap.docs) {
            const data = d.data();
            if (window.currentCallData?.callId === d.id) continue;
            const name = await getCustomNameForUser(data.callerId);
            window.currentCallData = { callId: d.id, callerId: data.callerId, isVideo: data.isVideo };
            const callerInfo = document.getElementById('callerInfo');
            const callModal = document.getElementById('callModal');
            const callControls = document.getElementById('callControls');
            const activeCallControls = document.getElementById('activeCallControls');
            if (callerInfo) callerInfo.innerHTML = `<div><strong>${escape(name)}</strong><br>${data.isVideo ? '📹 Видеозвонок' : '🎙️ Аудиозвонок'}</div>`;
            if (callModal) callModal.style.display = 'flex';
            if (callControls) callControls.style.display = 'flex';
            if (activeCallControls) activeCallControls.style.display = 'none';
            showDynamicIsland(`Входящий звонок от ${name}`, 'call');
        }
    });
}

// ========== КРУЖКИ ==========
async function initCamera(facingMode = 'user') {
    try {
        if (currentStream) currentStream.getTracks().forEach(t => t.stop());
        currentStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: { exact: facingMode } } });
        const video = document.getElementById('cameraPreview');
        if (video) video.srcObject = currentStream;
        return true;
    } catch(e) { showDynamicIsland('Нет доступа к камере', 'error'); return false; }
}

async function switchCamera() {
    if (isRecordingCircle) { showDynamicIsland('Нельзя переключить во время записи', 'error'); return; }
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    if (await initCamera(currentFacingMode)) showDynamicIsland(`Камера: ${currentFacingMode === 'user' ? 'фронтальная' : 'основная'}`, 'success');
}

async function startCircleRecordingWithPreview() {
    if (!currentChatId) { showDynamicIsland('Выберите чат', 'error'); return; }
    const modal = document.getElementById('cameraPreviewModal');
    if (modal) modal.style.display = 'flex';
    if (!await initCamera('user')) { if (modal) modal.style.display = 'none'; return; }
    const startBtn = document.getElementById('startRecordingBtn');
    const switchBtn = document.getElementById('switchCameraBtn');
    const timerDiv = document.getElementById('recordingTimer');
    const stopRecordDiv = document.getElementById('stopRecordingBtn');
    if (startBtn) {
        startBtn.onclick = async () => {
            if (startBtn) startBtn.style.display = 'none';
            if (switchBtn) switchBtn.style.display = 'none';
            if (timerDiv) timerDiv.style.display = 'block';
            if (stopRecordDiv) stopRecordDiv.style.display = 'block';
            videoChunks = [];
            mediaRecorderCircle = new MediaRecorder(currentStream, { mimeType: 'video/mp4' });
            mediaRecorderCircle.ondataavailable = (e) => { if (e.data.size) videoChunks.push(e.data); };
            mediaRecorderCircle.onstop = async () => {
                const blob = new Blob(videoChunks, { type: 'video/mp4' });
                if (blob.size > 20 * 1024 * 1024) { showDynamicIsland('Видео >20MB', 'error'); stopCircleRecording(); return; }
                if (blob.size && currentChatId) {
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        await addDoc(collection(db, "messages"), { chatId: currentChatId, type: 'video', content: e.target.result, senderId: currentUser.uid, senderName: currentUser.name, timestamp: new Date() });
                        await updateDoc(doc(db, "chats", currentChatId), { lastMessage: '📹 Видеосообщение', lastMessageTime: new Date() });
                        showDynamicIsland('Кружок отправлен!', 'success');
                    };
                    reader.readAsDataURL(blob);
                }
                stopCircleRecording();
            };
            mediaRecorderCircle.start();
            isRecordingCircle = true;
            recordingStartTime = Date.now();
            recordingTimerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
                if (timerDiv) timerDiv.textContent = `⏱️ ${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;
                if (elapsed >= 60) stopCircleRecordingAndSend();
            }, 1000);
        };
    }
    if (switchBtn) switchBtn.onclick = switchCamera;
    const stopInner = document.getElementById('stopRecordingBtnInner');
    if (stopInner) stopInner.onclick = () => stopCircleRecordingAndSend();
}

function stopCircleRecording() {
    if (mediaRecorderCircle && isRecordingCircle) mediaRecorderCircle.stop();
    if (recordingTimerInterval) clearInterval(recordingTimerInterval);
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());
    const modal = document.getElementById('cameraPreviewModal');
    if (modal) modal.style.display = 'none';
    isRecordingCircle = false;
}

function stopCircleRecordingAndSend() {
    if (mediaRecorderCircle && isRecordingCircle) mediaRecorderCircle.stop();
    isRecordingCircle = false;
}

// ========== ФАЙЛЫ ==========
const fileInput = document.getElementById('fileInput');
const fileBtn = document.getElementById('fileBtn');
if (fileBtn) fileBtn.addEventListener('click', () => fileInput?.click());
if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !currentChatId) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
            await addDoc(collection(db, "messages"), { chatId: currentChatId, type, content: ev.target.result, fileName: file.name, senderId: currentUser.uid, senderName: currentUser.name, timestamp: new Date() });
            await updateDoc(doc(db, "chats", currentChatId), { lastMessage: `📎 ${file.name}`, lastMessageTime: new Date() });
            showDynamicIsland('Файл отправлен', 'success');
        };
        reader.readAsDataURL(file);
        fileInput.value = '';
    });
}

// ========== ГОЛОСОВЫЕ ==========
const voiceRecordBtn = document.getElementById('voiceRecordBtn');
if (voiceRecordBtn) {
    voiceRecordBtn.addEventListener('click', async () => {
        if (!currentChatId) { showDynamicIsland('Выберите чат', 'error'); return; }
        if (isRecordingVoice) {
            mediaRecorderVoice?.stop();
            return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderVoice = new MediaRecorder(stream);
        audioChunksVoice = [];
        mediaRecorderVoice.ondataavailable = e => audioChunksVoice.push(e.data);
        mediaRecorderVoice.onstop = async () => {
            const blob = new Blob(audioChunksVoice, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = async (e) => {
                await addDoc(collection(db, "messages"), { chatId: currentChatId, type: 'voice', content: e.target.result, senderId: currentUser.uid, senderName: currentUser.name, timestamp: new Date() });
                await updateDoc(doc(db, "chats", currentChatId), { lastMessage: '🎙️ Голосовое', lastMessageTime: new Date() });
                showDynamicIsland('Голосовое отправлено', 'success');
            };
            reader.readAsDataURL(blob);
            stream.getTracks().forEach(t => t.stop());
            isRecordingVoice = false;
            voiceRecordBtn.classList.remove('recording');
        };
        mediaRecorderVoice.start();
        isRecordingVoice = true;
        voiceRecordBtn.classList.add('recording');
        showDynamicIsland('Запись... нажмите ещё раз для отправки', 'recording');
    });
}

// ========== АВАТАР ==========
async function loadUserAvatar() {
    const user = await getDoc(doc(db, "users", currentUser.uid));
    const avatar = document.getElementById('userAvatar');
    if (avatar && user.data()?.avatarUrl) avatar.src = user.data().avatarUrl;
}

const changeAvatarBtn = document.getElementById('changeAvatarBtn');
if (changeAvatarBtn) {
    changeAvatarBtn.addEventListener('click', () => {
        const avatarModal = document.getElementById('avatarModal');
        if (avatarModal) avatarModal.style.display = 'flex';
    });
}

const closeAvatarModal = document.querySelector('.closeAvatarModal');
if (closeAvatarModal) {
    closeAvatarModal.addEventListener('click', () => {
        const avatarModal = document.getElementById('avatarModal');
        if (avatarModal) avatarModal.style.display = 'none';
    });
}

const selectAvatarBtn = document.getElementById('selectAvatarBtn');
if (selectAvatarBtn) {
    selectAvatarBtn.addEventListener('click', () => {
        const avatarFileInput = document.getElementById('avatarFileInput');
        if (avatarFileInput) avatarFileInput.click();
    });
}

const avatarFileInput = document.getElementById('avatarFileInput');
if (avatarFileInput) {
    avatarFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            await updateDoc(doc(db, "users", currentUser.uid), { avatarUrl: ev.target.result });
            const userAvatar = document.getElementById('userAvatar');
            if (userAvatar) userAvatar.src = ev.target.result;
            const avatarModal = document.getElementById('avatarModal');
            if (avatarModal) avatarModal.style.display = 'none';
            showDynamicIsland('Аватар обновлён', 'success');
        };
        reader.readAsDataURL(file);
    });
}

// ========== НАСТРОЙКИ ==========
const ps = document.getElementById('paddingSlider');
const pv = document.getElementById('paddingValue');
function updatePadding(v) { 
    document.documentElement.style.setProperty('--screen-padding', v + 'px'); 
    localStorage.setItem('screenPadding', v); 
    const topPadding = document.querySelector('.top-padding');
    if (topPadding) topPadding.style.height = v + 'px';
    if (pv) pv.textContent = v + 'px'; 
}
if (ps) { 
    let sp = localStorage.getItem('screenPadding'); 
    if (sp) updatePadding(sp); 
    ps.value = sp || 50; 
    ps.addEventListener('input', e => updatePadding(e.target.value)); 
}

const isl = document.getElementById('islandPaddingSlider');
const isv = document.getElementById('islandPaddingValue');
function updateIsland(v) { 
    document.documentElement.style.setProperty('--island-top', v + 'px'); 
    localStorage.setItem('islandPadding', v); 
    if(isv) isv.textContent = v + 'px'; 
}
if (isl) { 
    let si = localStorage.getItem('islandPadding'); 
    if (si) updateIsland(si); 
    isl.value = si || 55; 
    isl.addEventListener('input', e => updateIsland(e.target.value)); 
}

const changePasswordBtn = document.getElementById('changePasswordBtn');
if (changePasswordBtn) changePasswordBtn.addEventListener('click', () => document.getElementById('passwordModal').style.display = 'flex');
const closePasswordModal = document.querySelector('.closePasswordModal');
if (closePasswordModal) closePasswordModal.addEventListener('click', () => document.getElementById('passwordModal').style.display = 'none');
const savePasswordBtn = document.getElementById('savePasswordBtn');
if (savePasswordBtn) {
    savePasswordBtn.addEventListener('click', async () => {
        const old = document.getElementById('oldPassword').value;
        const newp = document.getElementById('newPassword').value;
        const conf = document.getElementById('confirmPassword').value;
        if (!old || !newp) return showDynamicIsland('Заполните поля', 'error');
        if (newp !== conf) return showDynamicIsland('Пароли не совпадают', 'error');
        const user = auth.currentUser;
        const cred = EmailAuthProvider.credential(user.email, old);
        await reauthenticateWithCredential(user, cred);
        await updatePassword(user, newp);
        showDynamicIsland('Пароль изменён', 'success');
        document.getElementById('passwordModal').style.display = 'none';
    });
}

const themeSelect = document.getElementById('themeSelect');
function setTheme(theme) { 
    document.body.setAttribute('data-theme', theme); 
    localStorage.setItem('theme', theme); 
    if (themeSelect) themeSelect.value = theme; 
}
if (themeSelect) { 
    themeSelect.onchange = e => setTheme(e.target.value); 
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) setTheme(savedTheme);
    else setTheme('dark');
}

const notifToggle = document.getElementById('notifToggle');
if (notifToggle) {
    notificationsEnabled = localStorage.getItem('notifications') === 'true';
    notifToggle.checked = notificationsEnabled;
    notifToggle.onchange = () => { notificationsEnabled = notifToggle.checked; localStorage.setItem('notifications', notificationsEnabled); if (notificationsEnabled && Notification.permission !== 'granted') Notification.requestPermission(); };
}
if (Notification.permission === 'default') Notification.requestPermission();

// ========== ЧАТЫ ==========
async function loadChats() { 
    if(!currentUser) return;
    const q = query(collection(db, "chats"));
    onSnapshot(q, async (snap) => { 
        if(!currentUser) return; 
        let chats = []; 
        snap.forEach(d => { 
            let chat = d.data(); 
            if(chat.members && chat.members.some(m => m.uid === currentUser.uid)) 
                chats.push({ id: d.id, ...chat }); 
        }); 
        chats.sort((a, b) => {
            let timeA = a.lastMessageTime?.toDate ? a.lastMessageTime.toDate() : new Date(0);
            let timeB = b.lastMessageTime?.toDate ? b.lastMessageTime.toDate() : new Date(0);
            return timeB - timeA;
        });
        let container = document.getElementById('chatsList'); 
        if (!container) return;
        container.innerHTML = ''; 
        if(chats.length === 0) { 
            container.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">Нет чатов</div>'; 
            return; 
        } 
        for (const chat of chats) {
            let name = chat.name;
            let otherId = null;
            if(chat.type === 'private') { 
                let other = chat.members.find(m => m.uid !== currentUser.uid); 
                otherId = other?.uid;
                if (otherId) name = await getCustomNameForUser(otherId);
                else name = chat.name;
            }
            let div = document.createElement('div'); 
            div.className = 'chat-item'; 
            div.innerHTML = `<div class="chat-avatar"><i class="fas ${chat.type === 'group' ? 'fa-users' : 'fa-user'}"></i></div>
                <div class="chat-info">
                    <div class="chat-name">${escape(name)}</div>
                    <div class="chat-last">${escape(chat.lastMessage || 'Нет сообщений')}</div>
                </div>`;
            div.onclick = () => openChat(chat.id, name); 
            container.appendChild(div); 
        } 
    }); 
}

async function createChat(user) { 
    let existing = await getDocs(collection(db, "chats")); 
    let chat = null; 
    existing.forEach(d => { let data = d.data(); if(data.type === 'private' && data.members && data.members.some(m => m.uid === currentUser.uid) && data.members.some(m => m.uid === user.uid)) chat = { id: d.id, ...data }; }); 
    if(chat) openChat(chat.id, user.username); 
    else { let ref = await addDoc(collection(db, "chats"), { name: user.username, type: "private", members: [{ uid: currentUser.uid, name: currentUser.name, username: currentUser.username }, { uid: user.uid, name: user.username, username: user.username }], createdAt: new Date(), lastMessage: "", lastMessageTime: null }); 
        openChat(ref.id, user.username); } 
    const friendsModal = document.getElementById('friendsModal');
    if (friendsModal) friendsModal.style.display = 'none'; 
}

function openChat(id, name) { 
    if(unsubMessages) unsubMessages(); 
    currentChatId = id; 
    const chatTitle = document.getElementById('chatTitle');
    if (chatTitle) chatTitle.textContent = name; 
    const chatView = document.getElementById('chatView');
    if (chatView) chatView.style.display = 'flex'; 
    markMessagesAsRead(id);
    let curMsgId = null, curMsgText = null, curMsgIsText = false; 
    const menuEditBtn = document.getElementById('menuEditBtn');
    const menuDeleteBtn = document.getElementById('menuDeleteBtn');
    if (menuEditBtn) {
        menuEditBtn.onclick = () => { 
            if(curMsgId && curMsgIsText) { 
                const editInput = document.getElementById('editInput');
                if (editInput) editInput.value = curMsgText; 
                const editModal = document.getElementById('editModal');
                if (editModal) editModal.style.display = 'flex'; 
                editingMessageId = curMsgId; 
                const messageMenuModal = document.getElementById('messageMenuModal');
                if (messageMenuModal) messageMenuModal.style.display = 'none'; 
            } 
        };
    }
    if (menuDeleteBtn) {
        menuDeleteBtn.onclick = () => { 
            if(curMsgId) { deleteMessage(curMsgId); 
            const messageMenuModal = document.getElementById('messageMenuModal');
            if (messageMenuModal) messageMenuModal.style.display = 'none'; } 
        };
    }
    let msgsQuery = query(collection(db, "messages"), where("chatId", "==", id), orderBy("timestamp", "asc")); 
    unsubMessages = onSnapshot(msgsQuery, async (snap) => { 
        let msgs = []; 
        for (const d of snap.docs) msgs.push({ id: d.id, ...d.data() });
        let area = document.getElementById('messagesArea'); 
        if (!area) return;
        if(msgs.length === 0) area.innerHTML = '<div style="text-align:center;margin-top:80px;opacity:0.6;">Нет сообщений</div>'; 
        else { 
            area.innerHTML = ''; 
            for (const msg of msgs) {
                let isMy = msg.senderId === currentUser.uid; 
                let div = document.createElement('div'); 
                div.className = `message ${isMy ? 'my-message' : ''}`; 
                let content = ''; 
                
                if(msg.type === 'image') { 
                    let src = msg.content || msg.url; 
                    content = `<img src="${src}" class="image-message" onclick="window.open('${src}','_blank')">`; 
                } 
                else if(msg.type === 'video') { 
                    let src = msg.content || msg.url; 
                    content = `<video src="${src}" controls style="max-width:200px;max-height:200px;border-radius:16px;"></video>`; 
                } 
                else if(msg.type === 'file') { 
                    let src = msg.content || msg.url; 
                    content = `<a href="${src}" download="${msg.fileName}" target="_blank" class="file-message"><i class="fas fa-file"></i><span>${escape(msg.fileName)}</span><i class="fas fa-download"></i></a>`; 
                } 
                else if(msg.type === 'voice') { 
                    content = `<audio controls src="${msg.content}" style="max-width:200px;height:40px;border-radius:20px;"></audio>`; 
                } 
                else if(msg.type === 'call') {
                    const callerName = await getCustomNameForUser(msg.callerId);
                    if (msg.callStatus === 'calling') {
                        content = `<div class="message-text" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                            <span>📞 ${escape(callerName)} ${msg.isVideo ? '📹 видеозвонок' : '🎙️ аудиозвонок'}</span>
                            <button class="small-btn answer-call-btn" data-caller="${msg.callerId}" data-video="${msg.isVideo}" style="background: #2ecc71;">Ответить</button>
                        </div>`;
                    } else if (msg.callStatus === 'answered') {
                        content = `<div class="message-text" style="opacity: 0.7;">✅ ${escape(callerName)} ответил(а) на звонок</div>`;
                    } else if (msg.callStatus === 'timeout') {
                        content = `<div class="message-text" style="opacity: 0.5;">⏰ ${escape(callerName)} не ответил(а) на звонок</div>`;
                    }
                }
                else if(msg.type === 'system') { 
                    content = `<div class="message-text" style="font-style: italic; opacity: 0.7;">${escape(msg.text)}</div>`; 
                }
                else { 
                    let displayText = escape(msg.text);
                    if (isEmojiOnly(msg.text)) { 
                        content = `<div class="message-text emoji-large" style="font-size:32px;line-height:1.3;">${displayText}</div>`; 
                    } else { 
                        content = `<div class="message-text">${displayText}</div>`; 
                    }
                    if(msg.edited) content += `<span class="edited-badge"> (ред.)</span>`;
                } 
                let readStatus = '';
                if (!isMy && msg.read) { readStatus = '<span style="font-size:9px;margin-left:5px;opacity:0.5;">✓✓</span>'; }
                else if (!isMy && !msg.read) { readStatus = '<span style="font-size:9px;margin-left:5px;opacity:0.5;">✓</span>'; }
                
                let senderDisplayName = msg.senderName;
                if (!isMy && msg.senderId && msg.type !== 'system' && msg.type !== 'call') {
                    senderDisplayName = await getCustomNameForUser(msg.senderId);
                }
                
                div.innerHTML = `<div class="message-bubble">${!isMy && msg.type !== 'system' && msg.type !== 'call' ? `<div class="message-sender">${escape(senderDisplayName)}</div>` : ''}<div>${content}</div><div class="message-time">${msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || ''}${readStatus}</div></div>`; 
                if(isMy && msg.type !== 'system' && msg.type !== 'call') { 
                    let menuBtn = document.createElement('button'); 
                    menuBtn.className = 'message-menu'; 
                    menuBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>'; 
                    menuBtn.onclick = (e) => { 
                        e.stopPropagation(); 
                        curMsgId = msg.id; 
                        curMsgText = msg.text || ''; 
                        curMsgIsText = msg.type === 'text'; 
                        const menuEdit = document.getElementById('menuEditBtn');
                        if (menuEdit) menuEdit.style.display = curMsgIsText ? 'flex' : 'none'; 
                        const messageMenu = document.getElementById('messageMenuModal');
                        if (messageMenu) messageMenu.style.display = 'flex'; 
                    }; 
                    div.appendChild(menuBtn); 
                } 
                area.appendChild(div); 
            }
            setTimeout(() => {
                document.querySelectorAll('.answer-call-btn').forEach(btn => {
                    btn.onclick = () => {
                        const callerId = btn.dataset.caller;
                        const isVideo = btn.dataset.video === 'true';
                        startCall(callerId, isVideo);
                    };
                });
            }, 100);
        } 
        area.scrollTop = area.scrollHeight; 
    }); 
}

async function deleteMessage(id) { if(confirm('Удалить сообщение?')){ await deleteDoc(doc(db,"messages",id)); showDynamicIsland('Сообщение удалено', 'success'); } }
async function clearChatHistory() { if(confirm('Удалить всю историю сообщений?')){ let q=query(collection(db,"messages"),where("chatId","==",currentChatId)); let s=await getDocs(q); let b=writeBatch(db); s.forEach(d=>b.delete(d.ref)); await b.commit(); showDynamicIsland('История очищена', 'success'); } }
async function deleteCurrentChat() { if(!currentChatId) return; const chatDoc=await getDoc(doc(db,"chats",currentChatId)); const chat=chatDoc.data(); let confirmMsg='Удалить этот чат? Все сообщения будут удалены.'; if(chat.type==='private'){ const otherMember=chat.members.find(m=>m.uid!==currentUser.uid); if(otherMember) confirmMsg=`Удалить чат с ${otherMember.username}?`; } if(confirm(confirmMsg)){ const messagesQuery=query(collection(db,"messages"),where("chatId","==",currentChatId)); const messagesSnapshot=await getDocs(messagesQuery); const batch=writeBatch(db); messagesSnapshot.forEach(msg=>batch.delete(msg.ref)); await batch.commit(); await deleteDoc(doc(db,"chats",currentChatId)); showDynamicIsland('Чат удалён', 'success'); document.getElementById('chatView').style.display='none'; currentChatId=null; if(unsubMessages) unsubMessages(); loadChats(); } }

// ========== ОТПРАВКА СООБЩЕНИЙ ==========
const sendBtn = document.getElementById('sendBtn');
const messageInput = document.getElementById('messageInput');
if (sendBtn) {
    sendBtn.onclick = async () => { 
        if (!messageInput) return;
        let t = messageInput.value.trim(); 
        if(!t || !currentChatId) return; 
        await addDoc(collection(db, "messages"), { chatId: currentChatId, type: 'text', text: t, senderId: currentUser.uid, senderName: currentUser.name, timestamp: new Date(), edited: false, read: false }); 
        await updateDoc(doc(db, "chats", currentChatId), { lastMessage: t, lastMessageTime: new Date() }); 
        messageInput.value = ''; 
        showDynamicIsland('Сообщение отправлено', 'message');
        const chatDoc = await getDoc(doc(db, "chats", currentChatId));
        const otherMember = chatDoc.data().members?.find(m => m.uid !== currentUser.uid);
        if (otherMember && notificationsEnabled && Notification.permission === 'granted' && document.hidden) {
            new Notification(otherMember.username, { body: t, icon: '/icon.png' });
        }
    };
}
if (messageInput) {
    messageInput.addEventListener('keypress', e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (sendBtn) sendBtn.click(); } });
}

const backBtn = document.getElementById('backBtn');
if (backBtn) {
    backBtn.onclick = () => { if(unsubMessages) unsubMessages(); const chatView = document.getElementById('chatView'); if (chatView) chatView.style.display = 'none'; };
}

const saveEditBtn = document.getElementById('saveEditBtn');
if (saveEditBtn) {
    saveEditBtn.onclick = async () => { 
        const editInput = document.getElementById('editInput');
        let newText = editInput ? editInput.value.trim() : ''; 
        if(newText && editingMessageId) { 
            await updateDoc(doc(db, "messages", editingMessageId), { text: newText, edited: true, editedAt: new Date() }); 
            const editModal = document.getElementById('editModal');
            if (editModal) editModal.style.display = 'none'; 
            showDynamicIsland('Сообщение изменено', 'success'); 
            editingMessageId = null; 
        } 
    };
}

const closeEditModal = document.querySelector('.closeEditModal');
if (closeEditModal) closeEditModal.onclick = () => { const editModal = document.getElementById('editModal'); if (editModal) editModal.style.display = 'none'; };

const closeSettings = document.getElementById('closeSettings');
if (closeSettings) closeSettings.onclick = () => { const settingsModal = document.getElementById('settingsModal'); if (settingsModal) settingsModal.style.display = 'none'; };

// ========== КНОПКИ ==========
const audioCallBtn = document.getElementById('audioCallBtn');
if (audioCallBtn) {
    audioCallBtn.addEventListener('click', async () => {
        if (!currentChatId) return;
        const chat = await getDoc(doc(db, "chats", currentChatId));
        const other = chat.data()?.members?.find(m => m.uid !== currentUser.uid);
        if (other) startCall(other.uid, false);
    });
}

const videoCallBtn = document.getElementById('videoCallBtn');
if (videoCallBtn) {
    videoCallBtn.addEventListener('click', async () => {
        if (!currentChatId) return;
        const chat = await getDoc(doc(db, "chats", currentChatId));
        const other = chat.data()?.members?.find(m => m.uid !== currentUser.uid);
        if (other) startCall(other.uid, true);
    });
}

const answerCallBtn = document.getElementById('answerCallBtn');
if (answerCallBtn) {
    answerCallBtn.addEventListener('click', async () => {
        if (window.currentCallData) { 
            await answerCall(window.currentCallData.callId, window.currentCallData.callerId, window.currentCallData.isVideo); 
            const callModal = document.getElementById('callModal');
            if (callModal) callModal.style.display = 'none'; 
            window.currentCallData = null; 
        }
    });
}

const rejectCallBtn = document.getElementById('rejectCallBtn');
if (rejectCallBtn) {
    rejectCallBtn.addEventListener('click', async () => {
        if (window.currentCallData) { 
            await updateDoc(doc(db, "calls", window.currentCallData.callId), { status: "rejected" }); 
            window.currentCallData = null; 
        }
        endCall();
    });
}

const endCallBtn = document.getElementById('endCallBtn');
if (endCallBtn) endCallBtn.addEventListener('click', endCall);

const closeCallModal = document.querySelector('.closeCallModal');
if (closeCallModal) closeCallModal.addEventListener('click', endCall);

const circleRecordBtnGlobal = document.getElementById('circleRecordBtn');
if (circleRecordBtnGlobal) {
    circleRecordBtnGlobal.addEventListener('click', () => { 
        if (!currentChatId) showDynamicIsland('Выберите чат', 'error'); 
        else startCircleRecordingWithPreview(); 
    });
}

const closeCameraModal = document.getElementById('closeCameraModal');
if (closeCameraModal) closeCameraModal.addEventListener('click', () => stopCircleRecording());

const subscriptionsBtn = document.getElementById('subscriptionsBtn');
if (subscriptionsBtn) {
    subscriptionsBtn.addEventListener('click', () => { 
        loadCustomSubscriptions(); 
        const subscribeModal = document.getElementById('subscribeModal');
        if (subscribeModal) subscribeModal.style.display = 'flex'; 
    });
}

const closeSubscribeModal = document.querySelector('.closeSubscribeModal');
if (closeSubscribeModal) closeSubscribeModal.addEventListener('click', () => { const subscribeModal = document.getElementById('subscribeModal'); if (subscribeModal) subscribeModal.style.display = 'none'; });

const chatMenuBtn = document.getElementById('chatMenuBtn');
if (chatMenuBtn) {
    chatMenuBtn.addEventListener('click', () => { 
        const chatMenuModal = document.getElementById('chatMenuModal');
        if (chatMenuModal) chatMenuModal.style.display = 'flex'; 
    });
}

const chatMenuClearHistoryBtn = document.getElementById('chatMenuClearHistoryBtn');
if (chatMenuClearHistoryBtn) {
    chatMenuClearHistoryBtn.addEventListener('click', () => { 
        clearChatHistory(); 
        const chatMenuModal = document.getElementById('chatMenuModal');
        if (chatMenuModal) chatMenuModal.style.display = 'none'; 
    });
}

const chatMenuDeleteChatBtn = document.getElementById('chatMenuDeleteChatBtn');
if (chatMenuDeleteChatBtn) {
    chatMenuDeleteChatBtn.addEventListener('click', () => { 
        deleteCurrentChat(); 
        const chatMenuModal = document.getElementById('chatMenuModal');
        if (chatMenuModal) chatMenuModal.style.display = 'none'; 
    });
}

document.addEventListener('click', (e) => { 
    const chatMenuModal = document.getElementById('chatMenuModal');
    if (chatMenuModal && chatMenuModal.style.display === 'flex' && !e.target.closest('#chatMenuBtn') && !e.target.closest('#chatMenuModal')) { 
        chatMenuModal.style.display = 'none'; 
    } 
    const msgMenuModal = document.getElementById('messageMenuModal');
    if (msgMenuModal && msgMenuModal.style.display === 'flex' && !e.target.closest('.message-menu') && !e.target.closest('#messageMenuModal')) { 
        msgMenuModal.style.display = 'none'; 
    } 
});

// ========== НИЖНЕЕ МЕНЮ ==========
document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        const tabContent = document.getElementById(`${tabName}Tab`);
        if (tabContent) tabContent.classList.add('active');
        
        if (tabName === 'friends') {
            loadFriendsList();
            loadRequestsList();
        }
    });
});

// ========== ПОДВКЛАДКИ В ДРУЗЬЯХ ==========
document.getElementById('friendsSubTab')?.addEventListener('click', () => {
    document.getElementById('friendsSubTab').style.background = '#667eea';
    document.getElementById('requestsSubTab').style.background = 'rgba(255,255,255,0.2)';
    document.getElementById('myFriendsListContainer').style.display = 'block';
    document.getElementById('requestsListContainer').style.display = 'none';
    loadFriendsList();
});

document.getElementById('requestsSubTab')?.addEventListener('click', () => {
    document.getElementById('requestsSubTab').style.background = '#667eea';
    document.getElementById('friendsSubTab').style.background = 'rgba(255,255,255,0.2)';
    document.getElementById('myFriendsListContainer').style.display = 'none';
    document.getElementById('requestsListContainer').style.display = 'block';
    loadRequestsList();
});

// ========== АВТОРИЗАЦИЯ ==========
let pendingUsername = null;

const startChatButton = document.getElementById('startChatBtn');
if (startChatButton) startChatButton.addEventListener('click', () => showScreen(2));

const continueButton = document.getElementById('continueBtn');
if (continueButton) {
    continueButton.addEventListener('click', async () => {
        const username = document.getElementById('choiceUsername')?.value.trim();
        const choiceError = document.getElementById('choiceError');
        if (!username) { if (choiceError) choiceError.textContent = 'Введите username'; return; }
        if (!username.startsWith('@')) { if (choiceError) choiceError.textContent = 'Username должен начинаться с @'; return; }
        pendingUsername = username;
        try {
            const users = await getDocs(query(collection(db, "users"), where("username", "==", username)));
            if (users.empty) {
                document.getElementById('authChoiceScreen')?.classList.add('hidden');
                document.getElementById('registerScreen')?.classList.remove('hidden');
            } else {
                document.getElementById('authChoiceScreen')?.classList.add('hidden');
                document.getElementById('passwordScreen')?.classList.remove('hidden');
            }
        } catch(e) { if (choiceError) choiceError.textContent = 'Ошибка подключения'; }
    });
}

const finishLoginButton = document.getElementById('finishLoginBtn');
if (finishLoginButton) {
    finishLoginButton.addEventListener('click', async () => {
        const pass = document.getElementById('passwordInput')?.value;
        const passwordError = document.getElementById('passwordError');
        if (!pass) { if (passwordError) passwordError.textContent = 'Введите пароль'; return; }
        try {
            const users = await getDocs(query(collection(db, "users"), where("username", "==", pendingUsername)));
            if (users.empty) { if (passwordError) passwordError.textContent = 'Пользователь не найден'; return; }
            const userData = users.docs[0].data();
            await signInWithEmailAndPassword(auth, userData.email, pass);
        } catch(e) { if (passwordError) passwordError.textContent = 'Неверный пароль'; }
    });
}

const backToAuthButton = document.getElementById('backToAuthBtn');
if (backToAuthButton) backToAuthButton.addEventListener('click', () => {
    document.getElementById('passwordScreen')?.classList.add('hidden');
    document.getElementById('authChoiceScreen')?.classList.remove('hidden');
});

const registerFinishButton = document.getElementById('registerFinishBtn');
if (registerFinishButton) {
    registerFinishButton.addEventListener('click', async () => {
        const username = document.getElementById('regUsername')?.value.trim();
        const name = document.getElementById('regName')?.value.trim();
        const phone = document.getElementById('regPhone')?.value.trim();
        const pass = document.getElementById('regPass')?.value;
        const confirm = document.getElementById('regConfirm')?.value;
        const regError = document.getElementById('regError');
        if (!username || !name || !phone || !pass) { if (regError) regError.textContent = 'Заполните все поля'; return; }
        if (!username.startsWith('@')) { if (regError) regError.textContent = 'Username должен начинаться с @'; return; }
        if (pass.length < 6) { if (regError) regError.textContent = 'Пароль минимум 6 символов'; return; }
        if (pass !== confirm) { if (regError) regError.textContent = 'Пароли не совпадают'; return; }
        try {
            const exist = await getDocs(query(collection(db, "users"), where("username", "==", username)));
            if (!exist.empty) { if (regError) regError.textContent = 'Username уже занят'; return; }
            const existPhone = await getDocs(query(collection(db, "users"), where("phone", "==", phone)));
            if (!existPhone.empty) { if (regError) regError.textContent = 'Телефон уже зарегистрирован'; return; }
            const cleanUsername = username.replace('@', '').replace(/[^a-z0-9]/gi, '');
            const email = `${cleanUsername}_${Date.now()}@sparkapp.com`;
            const user = await createUserWithEmailAndPassword(auth, email, pass);
            await updateProfile(user.user, { displayName: name });
            await setDoc(doc(db, "users", user.user.uid), { 
                uid: user.user.uid, 
                username, 
                name, 
                phone, 
                email, 
                friends: [], 
                friendRequests: [], 
                customSubscriptions: [], 
                createdAt: new Date(), 
                online: true 
            });
            showDynamicIsland('Регистрация успешна!', 'success');
        } catch(e) { if (regError) regError.textContent = e.message; }
    });
}

const backToAuthFromRegButton = document.getElementById('backToAuthFromRegBtn');
if (backToAuthFromRegButton) backToAuthFromRegButton.addEventListener('click', () => {
    document.getElementById('registerScreen')?.classList.add('hidden');
    document.getElementById('authChoiceScreen')?.classList.remove('hidden');
});

const logoutSettingsButton = document.getElementById('logoutSettingsBtn');
if (logoutSettingsButton) {
    logoutSettingsButton.addEventListener('click', async () => {
        if (confirm('Выйти из аккаунта?')) {
            await setOfflineStatus();
            await signOut(auth);
            if (unsubMessages) unsubMessages();
            if (onlineStatusInterval) clearInterval(onlineStatusInterval);
            const messengerScreen = document.getElementById('messengerScreen');
            if (messengerScreen) messengerScreen.style.display = 'none';
            showScreen(0);
        }
    });
}

// ========== AUTH STATE ==========
onAuthStateChanged(auth, async (user) => {
    if (user) {
        let docUser = await getDoc(doc(db, "users", user.uid));
        if (docUser.exists()) {
            currentUser = { uid: user.uid, ...docUser.data() };
            const userNameSpan = document.getElementById('userName');
            const userUsernameSpan = document.getElementById('userUsername');
            if (userNameSpan) userNameSpan.textContent = currentUser.name;
            if (userUsernameSpan) userUsernameSpan.textContent = currentUser.username;
            await loadUserAvatar();
            await updateOnlineStatus();
            onlineStatusInterval = setInterval(updateOnlineStatus, 30000);
            listenForIncomingCalls();
            await loadChats();
            await loadFriendsList();
            await loadRequestsList();
            const messengerScreen = document.getElementById('messengerScreen');
            if (messengerScreen) {
                messengerScreen.style.display = 'flex';
                messengerScreen.classList.remove('hidden');
            }
            const welcomeScreen = document.getElementById('welcomeScreen');
            const featuresScreen = document.getElementById('featuresScreen');
            const authChoiceScreen = document.getElementById('authChoiceScreen');
            const passwordScreen = document.getElementById('passwordScreen');
            const registerScreen = document.getElementById('registerScreen');
            if (welcomeScreen) welcomeScreen.classList.add('hidden');
            if (featuresScreen) featuresScreen.classList.add('hidden');
            if (authChoiceScreen) authChoiceScreen.classList.add('hidden');
            if (passwordScreen) passwordScreen.classList.add('hidden');
            if (registerScreen) registerScreen.classList.add('hidden');
            
            const savedPadding = localStorage.getItem('screenPadding');
            if (savedPadding) updatePadding(savedPadding);
        }
    } else {
        currentUser = null;
        const messengerScreen = document.getElementById('messengerScreen');
        if (messengerScreen) messengerScreen.style.display = 'none';
        showScreen(0);
    }
});

showScreen(0);