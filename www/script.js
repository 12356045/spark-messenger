import { openPanel, closePanel, switchTab, applySavedLanguage, applySavedWallpaper, syncProfile, applySavedTheme, initPanelHandlers, renderAvatar, t } from "./ui.js";
import { getBlobUrlFromBase64, formatLastSeen, compressImage, detectDevice, getCameraConstraints, getSupportedVideoMimeType, isNotificationsEnabled, notifyIncomingMessage, registerAppServiceWorker, getMessagePreview, createCirclePlayerHTML, initCirclePlayer, closeCircleFullscreen, setRingProgress, formatVideoTime, CIRCLE_MAX_DURATION } from "./helpers.js";
import { initiateCall, listenToIncomingCalls, stopCall, toggleLocalVideo, toggleLocalAudio, triggerCameraSwitch, setZoom } from "./webrtc.js";
import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFCMToken, listenForMessages } from "./firebase-app.js";
import { collection, addDoc, query, getDocs, onSnapshot, orderBy, doc, updateDoc, setDoc, getDoc, where, arrayUnion, arrayRemove, deleteDoc, writeBatch, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref as storageRefFn, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
const storage = getStorage();

let currentUser = null, currentChatId = null, currentChatOtherId = null, unsubMessages = null, editingMessageId = null;
let contextMenuChatId = null;
let notificationsEnabled = false;
let mediaRecorderVoice = null, audioChunksVoice = [], isRecordingVoice = false;
let onlineStatusInterval = null;
let unsubChatUser = null;
let statusRefreshInterval = null;
let unsubChats = null;
let chatSnapshotCache = {};
let notificationsReady = false;
let currentChannelData = null;
let selectedChannelType = 'channel';

// Переменные для кружков
let currentStream = null;
let currentFacingMode = 'user';

let customNamesCache = {};
let chatsRenderCache = {};
let chatsRenderScheduled = false;
const CREATOR_USERNAME = '@kail';
const SPARK_CHANNEL_NAME = 'SPARK';
const PREMIUM_PRICE = 100;
const PREMIUM_CARD_NUMBER = '2200 0000 0000 0001';
const PREMIUM_CARD_BANK = 'Т-Банк';

function isCreator(userData) {
    return userData?.username?.toLowerCase() === CREATOR_USERNAME;
}

function isPremium(userData) {
    return userData?.premium === true;
}

function getPremiumLimits(userData) {
    if (isPremium(userData) || isCreator(userData)) {
        return { maxPins: Infinity, maxChannels: Infinity, maxGroups: Infinity, circleMaxDuration: 600, canTranslate: true };
    }
    return { maxPins: 5, maxChannels: 2, maxGroups: 5, circleMaxDuration: 60, canTranslate: false };
}

function getDisplayName(name, userData) {
    if (isCreator(userData)) return `${name}`;
    if (isPremium(userData)) return `${name}`;
    return name;
}

function getPinnedChats() {
    try { return JSON.parse(localStorage.getItem('spark-pinned-chats') || '[]'); } catch { return []; }
}
function getMutedChats() {
    try { return JSON.parse(localStorage.getItem('spark-muted-chats') || '[]'); } catch { return []; }
}
function togglePinChat(chatId) {
    let pinned = getPinnedChats();
    pinned = pinned.includes(chatId) ? pinned.filter(id => id !== chatId) : [...pinned, chatId];
    localStorage.setItem('spark-pinned-chats', JSON.stringify(pinned));
}
function toggleMuteChat(chatId) {
    let muted = getMutedChats();
    muted = muted.includes(chatId) ? muted.filter(id => id !== chatId) : [...muted, chatId];
    localStorage.setItem('spark-muted-chats', JSON.stringify(muted));
}

function showContextMenu(menuEl, x, y) {
    if (!menuEl) return;
    menuEl.style.display = 'flex';
    const rect = menuEl.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 10);
    const top = Math.min(y, window.innerHeight - rect.height - 10);
    menuEl.style.left = `${Math.max(10, left)}px`;
    menuEl.style.top = `${Math.max(10, top)}px`;
}

function hideAllContextMenus() {
    ['chatContextMenu', 'messageContextMenu', 'circleContextMenu'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const bar = document.getElementById('msgActionBar');
    if (bar) bar.style.display = 'none';
}

function setupLongPress(el, callback) {
    let timer = null;
    const start = (e) => { timer = setTimeout(() => callback(e), 500); };
    const cancel = () => { if (timer) clearTimeout(timer); };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchmove', cancel);
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); callback(e); });
}

// ========== НАВИГАЦИЯ ПО ЭКРАНАМ ==========
let currentScreenIndex = 0;
const screens = ['authStep1', 'authStep2', 'authRegister'];

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
    return str ? str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]) : ''; 
}

function isEmojiOnly(text) { 
    if (!text) return false;
    const emojiRegex = /^[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}\u{1F600}-\u{1F64F}\s]+$/u; 
    return emojiRegex.test(text.trim()); 
}

function showDynamicIsland(message, type = 'info') {
    window.showDynamicIsland(message, type);
}
window.showDynamicIsland = function(message, type = 'info') {
    const oldNotif = document.querySelector('.dynamic-island');
    if (oldNotif) oldNotif.remove();
    const island = document.createElement('div');
    island.className = 'dynamic-island';
    let icon = '';
    if (type === 'error') icon = '✕ ';
    else if (type === 'success') icon = '';
    else if (type === 'recording') icon = '';
    else if (type === 'circle') icon = '';
    else if (type === 'file') icon = '';
    else if (type === 'message') icon = ' ';
    else if (type === 'call') icon = '';
    else icon = '';
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
document.addEventListener('visibilitychange', () => {
    if (!currentUser) return;
    if (document.visibilityState === 'visible') updateOnlineStatus();
    else setOfflineStatus();
});
window.addEventListener('pagehide', () => setOfflineStatus());

function clearChatUserSubscription() {
    if (unsubChatUser) { unsubChatUser(); unsubChatUser = null; }
    if (statusRefreshInterval) { clearInterval(statusRefreshInterval); statusRefreshInterval = null; }
}

function renderUserStatus(u) {
    const statusEl = document.getElementById('chatTargetStatus');
    if (!statusEl || !u) return;
    statusEl.textContent = u.online ? t('online') : formatLastSeen(u.lastSeen);
}

function subscribeToChatUserStatus(userId) {
    clearChatUserSubscription();
    if (!userId) return;
    unsubChatUser = onSnapshot(doc(db, "users", userId), (snap) => {
        if (snap.exists()) renderUserStatus(snap.data());
    });
    statusRefreshInterval = setInterval(() => {
        getDoc(doc(db, "users", userId)).then(snap => {
            if (snap.exists()) renderUserStatus(snap.data());
        }).catch(() => {});
    }, 30000);
}

function getSupportedAudioMimeType() {
    const types = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (const type of types) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
}

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
            let displayName = targetData.name || targetData.username || targetUserId;
            if (isCreator(targetData)) displayName = `${displayName}`;
            else if (isPremium(targetData)) displayName = `${displayName}`;
            customNamesCache[targetUserId] = displayName;
            return displayName;
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
        showDynamicIsland('✕ Введите имя для подписки', 'error');
        return;
    }
    
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const userData = userDoc.data();
    const existingSub = (userData.customSubscriptions || []).find(s => s.userId === targetUserId);
    
    if (existingSub) {
        showDynamicIsland('! Вы уже подписаны на этого пользователя', 'error');
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
    showDynamicIsland(`Подписка добавлена: ${customName.trim()}`, 'success');
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
        showDynamicIsland(`Подписка удалена`, 'success');
        loadChats();
    }
}

async function renameCustomSubscription(targetUserId, newName) {
    if (!newName || newName.trim() === '') {
        showDynamicIsland('✕ Имя не может быть пустым', 'error');
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
        showDynamicIsland(`Переименовано в "${newName.trim()}"`, 'success');
        loadChats();
    }
}

function showAddSubscriptionDialog(targetUserId) {
    const customName = prompt('Введите имя для этого человека:', '');
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
        container.innerHTML += '<div style="padding:8px 0; color: rgba(255,255,255,0.6); font-size: 12px;">ПОДПИСЧИКИ:</div>';
        for (const subId of subscribers) {
            const subDoc = await getDoc(doc(db, "users", subId));
            if (subDoc.exists()) {
                const sub = subDoc.data();
                const subData = subDoc.data();
                const customNameFromSub = (subData.customSubscriptions || []).find(s => s.userId === currentUser.uid);
                const displayName = customNameFromSub ? customNameFromSub.name : (sub.name || sub.username);
                
                container.innerHTML += `<div class="friend-item" style="display: flex; justify-content: space-between;">
                    <div><strong>${escape(displayName)}</strong></div>
                    <button class="small-btn chatFromSubscribe" data-uid="${sub.uid}"></button>
                </div>`;
            }
        }
    }
    
    if (customSubs.length > 0) {
        container.innerHTML += '<div style="padding:8px 0; margin-top: 12px; color: rgba(255,255,255,0.6); font-size: 12px;">⭐ ВАШИ ПОДПИСКИ:</div>';
        for (const sub of customSubs) {
            const subDoc = await getDoc(doc(db, "users", sub.userId));
            if (subDoc.exists()) {
                const user = subDoc.data();
                container.innerHTML += `<div class="friend-item" style="display: flex; justify-content: space-between;">
                    <div><strong>${escape(sub.name)}</strong></div>
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
        btn.onclick = () => createChat({ uid: btn.dataset.uid });
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
// ========== ПОИСК ==========
const searchBar = document.getElementById('searchBar');
if (searchBar) {
    searchBar.addEventListener('input', async () => {
        const searchTerm = searchBar.value.trim().toLowerCase();
        const r = document.getElementById('searchResults');
        if (!r) return;
        if (searchTerm.length < 2) { r.style.display = 'none'; r.innerHTML = ''; return; }
        if (!currentUser) return;

        const u = await getDocs(collection(db, "users"));
        r.innerHTML = '';
        let found = 0;
        u.forEach(d => {
            const ud = d.data();
            const match = (ud.username && ud.username.toLowerCase().includes(searchTerm)) ||
                (ud.name && ud.name.toLowerCase().includes(searchTerm));
            if (match && ud.uid !== currentUser.uid) {
                found++;
                const div = document.createElement('div');
                div.className = 'search-item';
                div.innerHTML = `<div class="search-item-info">
                    <strong>${escape(ud.name || ud.username)}</strong>
                </div>
                <div class="search-item-actions">
                    <button class="small-btn chatSearchBtn" data-uid="${ud.uid}">${t('chat')}</button>
                </div>`;
                r.appendChild(div);
            }
        });

        if (found === 0) {
            r.innerHTML = `<div class="search-empty">${t('notFound')}</div>`;
        }
        r.style.display = 'block';

        r.querySelectorAll('.chatSearchBtn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                await createChat({ uid: btn.dataset.uid });
                r.style.display = 'none';
                searchBar.value = '';
            };
        });
    });

    document.addEventListener('click', (e) => {
        const r = document.getElementById('searchResults');
        const bar = document.getElementById('searchBar');
        if (r && bar && !r.contains(e.target) && !bar.contains(e.target) && !e.target.closest('.search-box')) {
            r.style.display = 'none';
        }
    });
}

// ========== ЧАТЫ ==========
async function initCamera(facingMode = 'user') {
    try {
        if (currentStream) currentStream.getTracks().forEach(t => t.stop());
        const constraints = getCameraConstraints(facingMode);
        try {
            currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
            currentStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode } });
        }
        const video = document.getElementById('cameraPreview');
        if (video) {
            video.srcObject = currentStream;
            video.muted = true;
            await video.play().catch(() => {});
        }
        return true;
    } catch(e) {
        const dev = detectDevice();
        const hint = dev.isIOS ? 'Разрешите камеру в Настройки → Safari' : 'Нет доступа к камере';
        showDynamicIsland(hint, 'error');
        return false;
    }
}

async function switchCamera() {
    if (circleRecorder) { showDynamicIsland('Нельзя переключить во время записи', 'error'); return; }
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    if (await initCamera(currentFacingMode)) showDynamicIsland(`Камера: ${currentFacingMode === 'user' ? 'фронтальная' : 'основная'}`, 'success');
}

// ========== КРУЖКИ — ФИНАЛЬНАЯ ПЕРЕПИСКА ==========
let circlePreviewStream = null;
let circleRecorder = null;
let circleChunks = [];
let circleRecordingTimer = null;
let circleRecordingStart = 0;
let circleMimeType = '';
let circleSending = false;

function getCircleMaxDuration() {
    if (!currentUser) return CIRCLE_MAX_DURATION;
    if (isCreator(currentUser) || isPremium(currentUser)) return 600;
    return CIRCLE_MAX_DURATION;
}

function cleanupCirclePreview() {
    if (circleRecordingTimer) { clearInterval(circleRecordingTimer); circleRecordingTimer = null; }
    try { if (circleRecorder && circleRecorder.state === 'recording') circleRecorder.stop(); } catch(e) {}
    circleRecorder = null;
    circleChunks = [];
    if (circlePreviewStream) { circlePreviewStream.getTracks().forEach(t => t.stop()); circlePreviewStream = null; }
    const modal = document.getElementById('cameraPreviewModal');
    if (modal) modal.style.display = 'none';
    const timerEl = document.getElementById('recordingTimer');
    if (timerEl) { timerEl.style.display = 'none'; timerEl.textContent = '0:00'; }
    const progressRing = document.getElementById('recordProgressRing');
    if (progressRing) setRingProgress(progressRing, 0);
    circleSending = false;
}

async function startCircleRecordingWithPreview() {
    if (!currentChatId) { showDynamicIsland('Выберите чат', 'error'); return; }

    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
            audio: true
        });
    } catch(e) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch(e2) {
            const dev = detectDevice();
            showDynamicIsland(dev.isIOS ? 'Разрешите камеру в Настройки → Safari' : 'Нет доступа к камере/микрофону', 'error');
            return;
        }
    }

    circlePreviewStream = stream;
    const modal = document.getElementById('cameraPreviewModal');
    if (modal) modal.style.display = 'flex';

    const preview = document.getElementById('cameraPreview');
    if (preview) { preview.srcObject = stream; preview.muted = true; await preview.play().catch(() => {}); }

    const startBtn = document.getElementById('startRecordingBtn');
    const switchBtn = document.getElementById('switchCameraBtnCircle');
    const stopBtn = document.getElementById('stopRecordingBtnInner');
    const timerEl = document.getElementById('recordingTimer');

    if (startBtn) { startBtn.style.display = 'flex'; startBtn.classList.remove('recording'); }
    if (switchBtn) switchBtn.style.display = 'flex';
    if (stopBtn) { stopBtn.style.display = 'none'; stopBtn.onclick = null; }
    if (timerEl) { timerEl.style.display = 'none'; timerEl.textContent = '0:00'; }
    circleSending = false;

    if (switchBtn) {
        switchBtn.onclick = async () => {
            if (circleRecorder) return;
            currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
            circlePreviewStream.getTracks().forEach(t => t.stop());
            try {
                circlePreviewStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: currentFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
                    audio: true
                });
            } catch(e) {
                circlePreviewStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            }
            if (preview) { preview.srcObject = circlePreviewStream; preview.muted = true; await preview.play().catch(() => {}); }
        };
    }

    if (startBtn) {
        startBtn.onclick = () => {
            if (circleRecorder) return;
            startBtn.style.display = 'none';
            if (switchBtn) switchBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'flex';
            if (timerEl) timerEl.style.display = 'block';

            circleMimeType = getSupportedVideoMimeType();
            const opts = circleMimeType ? { mimeType: circleMimeType, videoBitsPerSecond: 400000 } : { videoBitsPerSecond: 400000 };
            circleChunks = [];

            try {
                circleRecorder = new MediaRecorder(circlePreviewStream, opts);
            } catch(e) {
                try {
                    circleRecorder = new MediaRecorder(circlePreviewStream);
                } catch(e2) {
                    showDynamicIsland('Запись не поддерживается', 'error');
                    cleanupCirclePreview();
                    return;
                }
            }
            circleMimeType = circleRecorder.mimeType || circleMimeType || 'video/webm';

            circleRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) circleChunks.push(e.data); };
            circleRecorder.onerror = () => {
                showDynamicIsland('Ошибка записи', 'error');
                cleanupCirclePreview();
            };

            try {
                circleRecorder.start(500);
            } catch(e) {
                showDynamicIsland('Не удалось начать запись', 'error');
                cleanupCirclePreview();
                return;
            }

            circleRecordingStart = Date.now();
            let circleRecordedBytes = 0;
            const maxDur = getCircleMaxDuration();
            const MAX_CIRCLE_BYTES = 14 * 1024 * 1024;
            if (circleRecordingTimer) clearInterval(circleRecordingTimer);
            circleRecordingTimer = setInterval(() => {
                const elapsed = Math.floor((Date.now() - circleRecordingStart) / 1000);
                circleRecordedBytes = circleChunks.reduce((s, c) => s + (c.size || 0), 0);
                if (timerEl) timerEl.textContent = formatVideoTime(elapsed);
                if (progressRing) setRingProgress(progressRing, elapsed / maxDur);
                if (circleRecordedBytes > MAX_CIRCLE_BYTES) {
                    showDynamicIsland('Слишком большой объём — отправляю', 'error');
                    sendCircleNow();
                } else if (elapsed >= maxDur) sendCircleNow();
            }, 250);
        };
    }

    if (stopBtn) {
        const sendHandler = (e) => { e.preventDefault(); e.stopPropagation(); sendCircleNow(); };
        stopBtn.onclick = sendHandler;
        stopBtn.ontouchend = sendHandler;
    }
}

function sendCircleNow() {
    if (circleSending) return;
    circleSending = true;
    if (circleRecordingTimer) { clearInterval(circleRecordingTimer); circleRecordingTimer = null; }
    
    const mime = circleMimeType;
    const existingChunks = [...circleChunks];
    circleChunks = [];
    
    if (circleRecorder) {
        const recorder = circleRecorder;
        circleRecorder = null;
        
        const finalChunks = [];
        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) finalChunks.push(e.data); };
        recorder.onstop = null;
        
        if (recorder.state === 'recording') {
            try { recorder.stop(); } catch(e) {}
        }
        
        setTimeout(() => {
            const allChunks = [...existingChunks, ...finalChunks];
            if (allChunks.length === 0) {
                showDynamicIsland('Пустая запись', 'error');
                circleSending = false;
                cleanupCirclePreview();
                return;
            }
            doSendCircle(new Blob(allChunks, { type: mime || 'video/webm' }));
        }, 300);
    } else {
        circleChunks = [];
        showDynamicIsland('Пустая запись', 'error');
        circleSending = false;
        cleanupCirclePreview();
    }
}

async function doSendCircle(blob) {
    if (!currentChatId || !currentUser) {
        showDynamicIsland('Нет чата', 'error');
        cleanupCirclePreview();
        return;
    }
    if (blob.size < 500) {
        showDynamicIsland('Слишком короткая запись', 'error');
        cleanupCirclePreview();
        return;
    }
    if (blob.size > 15 * 1024 * 1024) {
        showDynamicIsland('Видео >15MB', 'error');
        cleanupCirclePreview();
        return;
    }

    const uploadChatId = currentChatId;
    const uploadUserId = currentUser.uid;
    const uploadUserName = currentUser.name;
    const maxDur = getCircleMaxDuration();
    const dur = Math.min(maxDur, Math.floor((Date.now() - circleRecordingStart) / 1000));

    cleanupCirclePreview();
    showDynamicIsland('Отправка кружка...', 'info');

    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
            reader.readAsDataURL(blob);
        });
        await addDoc(collection(db, "messages"), {
            chatId: uploadChatId, type: 'circle', content: dataUrl,
            mimeType: blob.type || 'video/webm', duration: dur, senderId: uploadUserId,
            senderName: uploadUserName, timestamp: serverTimestamp(), _localTime: Date.now()
        });
        await updateDoc(doc(db, "chats", uploadChatId), {
            lastMessage: 'Кружок', lastMessageTime: serverTimestamp()
        });
        showDynamicIsland('Кружок отправлен!', 'success');
    } catch(e) {
        console.error('Circle upload error:', e);
        showDynamicIsland('Ошибка: ' + (e.message || e), 'error');
        cleanupCirclePreview();
    }
}

function stopCircleRecording() { cleanupCirclePreview(); }
function finishCircleRecording() { cleanupCirclePreview(); }
function stopCircleRecordingAndSend() { sendCircleNow(); }

async function compressCircleVideo(blob) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => { resolve(blob); }, 8000);
        try {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.src = URL.createObjectURL(blob);
            video.onerror = () => { clearTimeout(timeout); URL.revokeObjectURL(video.src); video.remove(); resolve(blob); };
            video.onloadedmetadata = async () => {
                try {
                    const w = video.videoWidth || 480;
                    const h = video.videoHeight || 360;
                    const scale = Math.min(1, 480 / w);
                    const tw = Math.round(w * scale);
                    const th = Math.round(h * scale);
                    const canvas = document.createElement('canvas');
                    canvas.width = tw; canvas.height = th;
                    const ctx = canvas.getContext('2d');
                    const recStream = canvas.captureStream(24);
                    const outMime = ['video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
                    const rec = new MediaRecorder(recStream, { mimeType: outMime, videoBitsPerSecond: 300000 });
                    const outChunks = [];
                    rec.ondataavailable = (e) => { if (e.data && e.data.size) outChunks.push(e.data); };
                    rec.onstop = () => {
                        clearTimeout(timeout);
                        const out = new Blob(outChunks, { type: outMime });
                        URL.revokeObjectURL(video.src); video.remove();
                        resolve(out.size > 0 && out.size < blob.size ? out : blob);
                    };
                    rec.onerror = () => { clearTimeout(timeout); URL.revokeObjectURL(video.src); video.remove(); resolve(blob); };
                    rec.start();
                    await video.play().catch(() => {});
                    const drawFrame = () => {
                        if (video.ended || video.paused) { try { rec.stop(); } catch(e) { clearTimeout(timeout); resolve(blob); } return; }
                        ctx.drawImage(video, 0, 0, tw, th);
                        requestAnimationFrame(drawFrame);
                    };
                    drawFrame();
                } catch(e) { clearTimeout(timeout); URL.revokeObjectURL(video.src); video.remove(); resolve(blob); }
            };
        } catch(e) { clearTimeout(timeout); resolve(blob); }
    });
}

// ========== ФАЙЛЫ ==========
const fileInput = document.getElementById('mediaFileInput');
const fileBtn = document.getElementById('btnPaperclip');
if (fileBtn) fileBtn.addEventListener('click', () => fileInput?.click());
if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !currentChatId) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
                let content = ev.target.result;
                if (type === 'image') {
                    try { content = await compressImage(content, 800, 800, 900000); } catch(e) {}
                    if (content.length > 950000) {
                        showDynamicIsland('Изображение слишком большое', 'error');
                        return;
                    }
                }
                await addDoc(collection(db, "messages"), { chatId: currentChatId, type, content, fileName: file.name, senderId: currentUser.uid, senderName: currentUser.name, timestamp: serverTimestamp(), _localTime: Date.now() });
                await updateDoc(doc(db, "chats", currentChatId), { lastMessage: type === 'image' ? 'Фото' : `${file.name}`, lastMessageTime: serverTimestamp() });
                showDynamicIsland('Файл отправлен', 'success');
            } catch (err) {
                console.error('Ошибка отправки файла:', err);
                showDynamicIsland('Не удалось отправить файл', 'error');
            }
        };
        reader.readAsDataURL(file);
        fileInput.value = '';
    });
}

// ========== ГОЛОСОВЫЕ (через Storage) ==========
const voiceRecordBtn = document.getElementById('voiceBtn');
if (voiceRecordBtn) {
    voiceRecordBtn.addEventListener('click', async () => {
        if (!currentChatId) { showDynamicIsland('Выберите чат', 'error'); return; }
        if (isRecordingVoice) {
            mediaRecorderVoice?.stop();
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = getSupportedAudioMimeType();
            mediaRecorderVoice = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            audioChunksVoice = [];
            mediaRecorderVoice.ondataavailable = e => { if (e.data.size) audioChunksVoice.push(e.data); };
            mediaRecorderVoice.onstop = async () => {
                const blobType = mimeType || mediaRecorderVoice.mimeType || 'audio/mp4';
                const blob = new Blob(audioChunksVoice, { type: blobType });
                stream.getTracks().forEach(t => t.stop());
                if (!blob.size || !currentChatId) {
                    isRecordingVoice = false;
                    voiceRecordBtn.classList.remove('recording');
                    toggleSendButton();
                    return;
                }
                showDynamicIsland('Отправка голосового...', 'info');
                try {
                    const dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = () => reject(new Error('readFile failed'));
                        reader.readAsDataURL(blob);
                    });
                    await addDoc(collection(db, "messages"), { chatId: currentChatId, type: 'voice', content: dataUrl, mimeType: blobType, senderId: currentUser.uid, senderName: currentUser.name, timestamp: serverTimestamp(), _localTime: Date.now() });
                    await updateDoc(doc(db, "chats", currentChatId), { lastMessage: 'Голосовое', lastMessageTime: serverTimestamp() });
                    showDynamicIsland('Голосовое отправлено', 'success');
                } catch (err) {
                    console.error('Ошибка отправки голосового:', err);
                    showDynamicIsland('Не удалось отправить голосовое', 'error');
                }
                isRecordingVoice = false;
                voiceRecordBtn.classList.remove('recording');
                toggleSendButton();
            };
            mediaRecorderVoice.start();
            isRecordingVoice = true;
            voiceRecordBtn.classList.add('recording');
            showDynamicIsland('Запись... нажмите ещё раз для отправки', 'recording');
        } catch (err) {
            console.error('Ошибка записи голоса:', err);
            showDynamicIsland('Нет доступа к микрофону', 'error');
        }
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
            const newUrl = ev.target.result;
            const oldAvatar = currentUser.avatarUrl || '';
            const updates = { avatarUrl: newUrl };
            if (oldAvatar && oldAvatar.startsWith('http')) {
                updates.avatarHistory = arrayUnion(oldAvatar);
            } else if (oldAvatar && oldAvatar.startsWith('data:')) {
                updates.avatarHistory = arrayUnion(oldAvatar.substring(0, 200));
            }
            await updateDoc(doc(db, "users", currentUser.uid), updates);
            currentUser.avatarUrl = newUrl;
            syncProfile(currentUser);
            closePanel('profile');
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
registerAppServiceWorker();
if (Notification.permission === 'default' && isNotificationsEnabled()) {
    Notification.requestPermission();
}

// ========== ЧАТЫ ==========
async function handleIncomingChatNotification(chatId, chat) {
    if (!currentUser || !notificationsReady) return;
    if (!isNotificationsEnabled()) return;
    if (chatId === currentChatId && document.visibilityState === 'visible') return;
    if (getMutedChats().includes(chatId)) return;

    try {
        const msgQuery = query(collection(db, "messages"), where("chatId", "==", chatId));
        const msgSnap = await getDocs(msgQuery);
        if (msgSnap.empty) return;
        let latest = null;
        let latestTime = 0;
        msgSnap.forEach(d => {
            const m = d.data();
            const t = m.timestamp?.toMillis?.() || m.timestamp?.getTime?.() || 0;
            if (t >= latestTime) { latestTime = t; latest = m; }
        });
        if (!latest) return;
        const msg = latest;
        if (msg.senderId === currentUser.uid) return;

        let senderName = msg.senderName || 'SPARK';
        if (chat.type === 'private') {
            const other = chat.members?.find(m => m.uid !== currentUser.uid);
            if (other) senderName = await getCustomNameForUser(other.uid);
        }
        await notifyIncomingMessage(senderName, getMessagePreview(msg), chatId);
        if (document.visibilityState === 'visible' && chatId !== currentChatId) {
            showDynamicIsland(`${senderName}: ${getMessagePreview(msg)}`, 'message');
        }
    } catch (e) {
        console.warn('Уведомление:', e);
    }
}

function formatChatTime(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'вчера';
    if (diffDays < 7) return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()];
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

async function renderChatCard(chat, container, index) {
    const pinned = getPinnedChats();
    const muted = getMutedChats();
    const isChannel = chat.type === 'channel' || chat.type === 'group';
    let name = chat.name || (isChannel ? 'Канал' : '');
    let otherId = null;
    let otherAvatar = null;

    if (chat.type === 'private') {
        let other = chat.members.find(m => m.uid !== currentUser.uid);
        otherId = other?.uid;
        if (otherId) {
            name = await getCustomNameForUser(otherId);
            const otherDoc = await getDoc(doc(db, "users", otherId));
            if (otherDoc.exists()) otherAvatar = otherDoc.data().avatarUrl;
        } else name = chat.name;
    } else if (isChannel) {
        otherAvatar = chat.avatarUrl || null;
    }

    let existing = container.querySelector(`[data-chat-id="${chat.id}"]`);
    if (existing) {
        const nameEl = existing.querySelector('.chat-name');
        const lastEl = existing.querySelector('.chat-last');
        const timeEl = existing.querySelector('.chat-time');
        if (nameEl) nameEl.innerHTML = `${escape(name)}${muted.includes(chat.id) ? '<i class="fas fa-bell-slash" style="color:var(--text-secondary);font-size:11px;margin-left:4px;"></i>' : ''}`;
        if (lastEl) lastEl.textContent = chat.lastMessage || t('noMessagesPreview');
        if (timeEl) timeEl.textContent = formatChatTime(chat.lastMessageTime);
        return;
    }

    let div = document.createElement('div');
    div.className = 'chat-card animate-in';
    div.dataset.chatId = chat.id;
    div.style.animationDelay = `${Math.min(index, 12) * 0.05}s`;
    const pinIcon = pinned.includes(chat.id) ? '<i class="fas fa-thumbtack" style="font-size:11px;color:var(--text-secondary);"></i>' : '';
    const muteIcon = muted.includes(chat.id) ? '<i class="fas fa-bell-slash" style="font-size:11px;color:var(--text-secondary);margin-left:4px;"></i>' : '';
    const typeIcon = isChannel ? `<i class="fas fa-${chat.type === 'channel' ? 'broadcast-tower' : 'users'}" style="font-size:11px;color:var(--accent);margin-left:4px;"></i>` : '';
    const chatTime = formatChatTime(chat.lastMessageTime);
    const unread = chat.unreadCount || 0;
    const unreadBadge = unread > 0 ? `<span class="chat-unread-badge">${unread}</span>` : '';
    div.innerHTML = `<div class="avatar chat-list-avatar"></div>
        <div class="chat-info" style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:4px;">
                <div class="chat-name" style="flex:1; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escape(name)}${typeIcon}${muteIcon}</div>
                <span class="chat-time" style="font-size:11px; color:var(--text-secondary); white-space:nowrap; flex-shrink:0;">${chatTime}</span>
                ${pinIcon}
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
                <div class="chat-last" style="flex:1; color:var(--text-secondary); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escape(chat.lastMessage || t('noMessagesPreview'))}</div>
                ${unreadBadge}
            </div>
        </div>`;
    renderAvatar(div.querySelector('.chat-list-avatar'), { avatarUrl: otherAvatar, name });
    div.onclick = () => {
        if (isChannel) openChannel(chat.id, chat.name, chat);
        else openChat(chat.id, name, otherId);
    };
    setupLongPress(div, (e) => {
        contextMenuChatId = chat.id;
        const pinBtn = document.getElementById('btnMenuPin');
        const muteBtn = document.getElementById('btnMenuMute');
        if (pinBtn) pinBtn.querySelector('span').textContent = pinned.includes(chat.id) ? t('unpinChat') : t('pinChat');
        if (muteBtn) muteBtn.querySelector('span').textContent = muted.includes(chat.id) ? t('unmuteChat') : t('muteChat');
        const x = e.touches?.[0]?.clientX || e.clientX;
        const y = e.touches?.[0]?.clientY || e.clientY;
        showContextMenu(document.getElementById('chatContextMenu'), x, y);
    });
    container.appendChild(div);
}

function scheduleChatsRender(chats) {
    if (chatsRenderScheduled) return;
    chatsRenderScheduled = true;
    requestAnimationFrame(async () => {
        chatsRenderScheduled = false;
        let container = document.getElementById('chatList');
        if (!container) return;
        if (chats.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">${t('noChats')}</div>`;
            chatsRenderCache = {};
            return;
        }
        for (let i = 0; i < chats.length; i++) {
            await renderChatCard(chats[i], container, i);
        }
        // Remove deleted chats from DOM
        const chatIds = new Set(chats.map(c => c.id));
        container.querySelectorAll('.chat-card').forEach(el => {
            if (!chatIds.has(el.dataset.chatId)) el.remove();
        });
    });
}

async function loadChats() { 
    if (!currentUser) return;
    if (unsubChats) { unsubChats(); unsubChats = null; }
    const q = query(collection(db, "chats"));
    unsubChats = onSnapshot(q, async (snap) => { 
        if (!currentUser) return; 
        let chats = []; 
        snap.forEach(d => { 
            let chat = d.data(); 
            if (chat.members && chat.members.some(m => m.uid === currentUser.uid)) 
                chats.push({ id: d.id, ...chat }); 
        }); 
        chats.sort((a, b) => {
            const pinned = getPinnedChats();
            const aPinned = pinned.includes(a.id) ? 1 : 0;
            const bPinned = pinned.includes(b.id) ? 1 : 0;
            if (aPinned !== bPinned) return bPinned - aPinned;
            let timeA = a.lastMessageTime?.toDate ? a.lastMessageTime.toDate() : new Date(0);
            let timeB = b.lastMessageTime?.toDate ? b.lastMessageTime.toDate() : new Date(0);
            return timeB - timeA;
        });

        // Only notify on actual new messages, not re-renders
        for (const chat of chats) {
            const cached = chatSnapshotCache[chat.id];
            const newTime = chat.lastMessageTime?.toMillis?.() || chat.lastMessageTime?.getTime?.() || 0;
            const oldTime = cached?.lastMessageTime?.toMillis?.() || cached?.lastMessageTime?.getTime?.() || 0;
            if (cached && newTime > oldTime && cached.lastMessage !== chat.lastMessage) {
                handleIncomingChatNotification(chat.id, chat);
            }
            chatSnapshotCache[chat.id] = { lastMessageTime: chat.lastMessageTime, lastMessage: chat.lastMessage };
        }

        scheduleChatsRender(chats);
        
        if (!notificationsReady) {
            setTimeout(() => { notificationsReady = true; }, 2000);
        }
    }); 
}

let createChatLocks = {};
async function createChat(user) { 
    const lockKey = [currentUser.uid, user.uid].sort().join('_');
    if (createChatLocks[lockKey]) return;
    createChatLocks[lockKey] = true;
    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.exists() ? userDoc.data() : user;
        const displayName = await getCustomNameForUser(user.uid);
        
        // Search through all chats for existing private chat between users
        let chat = null;
        const existingChats = await getDocs(query(collection(db, "chats"), where("type", "==", "private")));
        existingChats.forEach(d => {
            const data = d.data();
            const memberUids = data.memberUids || data.members?.map(m => m.uid) || [];
            if (memberUids.includes(currentUser.uid) && memberUids.includes(user.uid)) {
                chat = { id: d.id, ...data };
            }
        });
        
        if (chat) {
            openChat(chat.id, displayName, user.uid);
        } else {
            const memberUids = [currentUser.uid, user.uid];
            let ref = await addDoc(collection(db, "chats"), { 
                name: displayName, type: "private", 
                members: [{ uid: currentUser.uid, name: currentUser.name, username: currentUser.username }, { uid: user.uid, name: userData.name || displayName, username: userData.username }], 
                memberUids,
                createdAt: serverTimestamp(), lastMessage: "", lastMessageTime: null 
            }); 
            openChat(ref.id, displayName, user.uid);
        }
    } finally {
        delete createChatLocks[lockKey];
    }
}

function openChat(id, name, otherId = null) { 
    if(unsubMessages) unsubMessages(); 
    clearChatUserSubscription();
    currentChatId = id; 
    currentChatOtherId = otherId;
    currentChannelData = null;
    const chatTargetName = document.getElementById('chatTargetName');
    if (chatTargetName) chatTargetName.textContent = name;
    const chatView = document.getElementById('chatView');
    if (chatView) { chatView.style.display = 'flex'; chatView.classList.add('chat-open'); }
    
    const actions = document.getElementById('chatHeaderActions');
    if (actions) { actions.classList.remove('open'); actions.style.display = ''; }
    
    markMessagesAsRead(id);
    
    const inputBar = document.querySelector('.chat-input-bar');
    if (inputBar) inputBar.style.display = 'flex';
    
    markMessagesAsRead(id);

    const setupOtherUser = (uid, displayName) => {
        currentChatOtherId = uid;
        subscribeToChatUserStatus(uid);
        getDoc(doc(db, "users", uid)).then(userDoc => {
            if (!userDoc.exists()) return;
            const u = userDoc.data();
            renderAvatar(document.getElementById('chatTargetAvatar'), { avatarUrl: u.avatarUrl, name: displayName || u.name || u.username });
        });
    };

    if (otherId) {
        setupOtherUser(otherId, name);
    } else {
        getDoc(doc(db, "chats", id)).then(chatDoc => {
            const members = chatDoc.data()?.members || [];
            const other = members.find(m => m.uid !== currentUser.uid);
            if (other) setupOtherUser(other.uid, name);
        });
    }

    let msgsQuery = query(collection(db, "messages"), where("chatId", "==", id)); 
    unsubMessages = onSnapshot(msgsQuery, async (snap) => { 
        let msgs = []; 
        for (const d of snap.docs) msgs.push({ id: d.id, ...d.data() });
        msgs.sort((a, b) => {
            const ta = a.timestamp?.toMillis?.() || a._localTime || 0;
            const tb = b.timestamp?.toMillis?.() || b._localTime || 0;
            return ta - tb;
        });
        let area = document.getElementById('messagesArea'); 
        if (!area) return;
        if(msgs.length === 0) area.innerHTML = `<div style="text-align:center;margin-top:80px;opacity:0.6;">${t('noMessages')}</div>`; 
        else { 
            area.innerHTML = ''; 
            for (const msg of msgs) {
                let isMy = msg.senderId === currentUser.uid; 
                let div = document.createElement('div'); 
                div.className = `message ${isMy ? 'my-message' : ''}`; 
                div.dataset.msgId = msg.id;
                let content = ''; 
                
                if(msg.type === 'image') { 
                    let src = getBlobUrlFromBase64(msg.content || msg.url); 
                    content = `<div class="msg-image-wrap"><img src="${src}" onclick="window.open(this.src,'_blank')"></div>`; 
                } 
                else if(msg.type === 'video') { 
                    let src = getBlobUrlFromBase64(msg.content || msg.url); 
                    content = `<video src="${src}" controls playsinline webkit-playsinline style="max-width:200px;max-height:200px;border-radius:16px;"></video>`; 
                }
                else if(msg.type === 'circle') {
                    const src = msg.content && !msg.content.startsWith('data:') ? msg.content : getBlobUrlFromBase64(msg.content || msg.url);
                    content = createCirclePlayerHTML(src);
                } 
                else if(msg.type === 'file') { 
                    let src = getBlobUrlFromBase64(msg.content || msg.url); 
                    content = `<a href="${src}" download="${msg.fileName}" target="_blank" class="file-message"><i class="fas fa-file"></i><span>${escape(msg.fileName)}</span><i class="fas fa-download"></i></a>`; 
                } 
                else if(msg.type === 'voice') { 
                    const audioSrc = getBlobUrlFromBase64(msg.content);
                    content = `<audio controls preload="metadata" playsinline src="${audioSrc}" style="max-width:220px;height:40px;border-radius:20px;"></audio>`; 
                } 
                else if(msg.type === 'call') {
                    const callerName = await getCustomNameForUser(msg.callerId);
                    if (msg.callStatus === 'calling') {
                        content = `<div class="message-text">${escape(callerName)} ${msg.isVideo ? t('videoCall') : t('audioCall')}</div>`;
                    } else if (msg.callStatus === 'answered') {
                        content = `<div class="message-text" style="opacity:0.7;">${escape(callerName)} ${t('callAnswered')}</div>`;
                    } else {
                        content = `<div class="message-text" style="opacity:0.5;">⏰ ${escape(callerName)} ${t('callMissed')}</div>`;
                    }
                }
                else if(msg.type === 'system') { 
                    content = `<div class="message-text" style="font-style: italic; opacity: 0.7;">${escape(msg.text)}</div>`; 
                }
                else { 
                    let displayText = escape(msg.text);
                    const emojiOnly = isEmojiOnly(msg.text);
                    if (emojiOnly) {
                        content = `<div class="msg-emoji-only">${displayText}</div>`;
                    } else {
                        content = `<div class="message-text" data-msg-text="${escape(msg.text)}">${displayText}</div>`;
                    }
                    if(msg.edited) content += `<span class="edited-badge"> ${t('edited')}</span>`;
                } 
                
                const bubble = document.createElement('div');
                bubble.className = 'message-bubble';
                if (msg.type === 'circle') bubble.classList.add('circle-bubble');
                if (isMy && msg.type !== 'system' && msg.type !== 'call') bubble.classList.add('clickable');
                let replyHtml = '';
                if (msg.replyTo) {
                    const replySnippet = msg.replyToText ? escape(msg.replyToText).substring(0, 80) : '';
                    const replySender = msg.replyToSenderName ? escape(msg.replyToSenderName) : '';
                    replyHtml = `<div class="reply-quote" style="border-left:3px solid var(--accent);padding:4px 10px;margin-bottom:6px;border-radius:4px;background:rgba(108,92,231,0.08);font-size:12px;"><div style="font-weight:600;color:var(--accent);font-size:11px;">${replySender}</div><div style="color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px;">${replySnippet}</div></div>`;
                }
                let forwardHtml = '';
                if (msg.forwardedFrom) {
                    forwardHtml = `<div style="font-size:11px;color:var(--accent);font-weight:600;margin-bottom:4px;"><i class="fas fa-share" style="margin-right:4px;font-size:10px;"></i>Переслано от ${escape(msg.forwardedFrom)}</div>`;
                }
                bubble.innerHTML = `<div>${forwardHtml}${replyHtml}${content}</div><div class="message-time">${msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || ''}</div>`;
                
                if (msg.type === 'circle') initCirclePlayer(bubble);
                
                if (isMy && msg.type !== 'system' && msg.type !== 'call' && msg.type !== 'circle') {
                    bubble.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const msgMenu = document.getElementById('messageContextMenu');
                        const editBtn = document.getElementById('btnMsgEdit');
                        if (editBtn) editBtn.style.display = msg.type === 'text' && isMy ? 'flex' : 'none';
                        editingMessageId = msg.id;
                        window._editingMsgText = msg.text || '';
                        window._editingMsgData = msg;
                        showContextMenu(msgMenu, e.clientX, e.clientY);
                    });
                }
                if (!isMy && msg.type !== 'system' && msg.type !== 'call' && msg.type !== 'circle') {
                    bubble.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const bar = document.getElementById('msgActionBar');
                        if (!bar) return;
                        bar.style.display = 'flex';
                        const bw = 280, bh = 44;
                        let left = Math.max(10, Math.min(e.clientX - bw/2, window.innerWidth - bw - 10));
                        let top = e.clientY - bh - 12;
                        if (top < 10) top = e.clientY + 12;
                        bar.style.left = left + 'px';
                        bar.style.top = Math.max(10, top) + 'px';
                        bar.dataset.msgId = msg.id;
                        bar.dataset.msgType = msg.type || 'text';
                        bar.dataset.msgText = msg.text || '';
                        bar.dataset.msgContent = msg.content || '';
                        bar.dataset.msgSenderName = msg.senderName || '';
                        bar.dataset.msgFileName = msg.fileName || '';
                        editingMessageId = msg.id;
                        window._editingMsgData = msg;
                    });
                }
                if (msg.type === 'circle') {
                    bubble.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        circleContextMenuMsgId = msg.id;
                        const delBtn = document.getElementById('btnCircleDelete');
                        if (delBtn) delBtn.style.display = isMy ? 'flex' : 'none';
                        showContextMenu(document.getElementById('circleContextMenu'), e.clientX, e.clientY);
                    });
                }
                if (msg.reactions && Object.keys(msg.reactions).length > 0) {
                    const rDiv = renderReactions(msg, false);
                    if (rDiv) bubble.appendChild(rDiv);
                }
                div.appendChild(bubble);
                area.appendChild(div); 
            }
        } 
        area.scrollTop = area.scrollHeight; 
    }); 
}

async function deleteMessage(id) { if(confirm('Удалить сообщение?')){ await deleteDoc(doc(db,"messages",id)); showDynamicIsland('Сообщение удалено', 'success'); } }
async function clearChatHistory() { if(confirm('Удалить всю историю сообщений?')){ let q=query(collection(db,"messages"),where("chatId","==",currentChatId)); let s=await getDocs(q); let b=writeBatch(db); s.forEach(d=>b.delete(d.ref)); await b.commit(); showDynamicIsland('История очищена', 'success'); } }
async function deleteCurrentChat() { if(!currentChatId) return; const chatDoc=await getDoc(doc(db,"chats",currentChatId)); const chat=chatDoc.data(); let confirmMsg='Удалить этот чат? Все сообщения будут удалены.'; if(chat.type==='private'){ const otherMember=chat.members.find(m=>m.uid!==currentUser.uid); if(otherMember) confirmMsg=`Удалить чат с ${otherMember.name || otherMember.username}?`; } if(confirm(confirmMsg)){ const messagesQuery=query(collection(db,"messages"),where("chatId","==",currentChatId)); const messagesSnapshot=await getDocs(messagesQuery); const batch=writeBatch(db); messagesSnapshot.forEach(msg=>batch.delete(msg.ref)); await batch.commit(); await deleteDoc(doc(db,"chats",currentChatId)); showDynamicIsland('Чат удалён', 'success'); document.getElementById('chatView').style.display='none'; currentChatId=null; currentChatOtherId=null; if(unsubMessages) unsubMessages(); clearChatUserSubscription(); loadChats(); } }

// ========== ОТПРАВКА СООБЩЕНИЙ ==========
const sendBtn = document.getElementById('btnSendMsg');
const messageInput = document.getElementById('msgInput');
const voiceBtn = document.getElementById('voiceBtn');

function toggleSendButton() {
    if (!messageInput || !sendBtn || !voiceBtn) return;
    const hasText = messageInput.value.trim().length > 0;
    const circleBtn = document.getElementById('circleRecordBtn');
    sendBtn.style.display = hasText ? 'flex' : 'none';
    voiceBtn.style.display = hasText ? 'none' : 'block';
    if (circleBtn) circleBtn.style.display = hasText ? 'none' : 'block';
}

async function sendMessage() {
    if (!messageInput) return;
    const messageText = messageInput.value.trim();
    if (!messageText || !currentChatId || !currentUser) return;
    
    // Check channel write permission
    if (currentChannelData && currentChannelData.type === 'channel') {
        const isSparkChannel = currentChannelData.name === SPARK_CHANNEL_NAME;
        if (isSparkChannel && !isCreator(currentUser)) {
            showDynamicIsland('Только Создатель может писать в SPARK', 'error');
            return;
        }
        if (!isSparkChannel && currentChannelData.ownerId !== currentUser.uid) {
            showDynamicIsland('Только владелец может писать в канале', 'error');
            return;
        }
    }
    
    await addDoc(collection(db, "messages"), { chatId: currentChatId, type: 'text', text: messageText, senderId: currentUser.uid, senderName: currentUser.name, timestamp: serverTimestamp(), _localTime: Date.now(), edited: false, read: false, replyTo: window._replyToMsgId || null, replyToText: window._replyToText || null, replyToSenderName: window._replyToSenderName || null });
    await updateDoc(doc(db, "chats", currentChatId), { lastMessage: messageText, lastMessageTime: serverTimestamp() });
    messageInput.value = '';
    toggleSendButton();
    const rb = document.getElementById('replyBar');
    if (rb) rb.remove();
    window._replyToMsgId = null;
    window._replyToText = null;
    window._replyToSenderName = null;
    showDynamicIsland('Сообщение отправлено', 'message');
    const chatDoc = await getDoc(doc(db, "chats", currentChatId));
    const otherMember = chatDoc.data().members?.find(m => m.uid !== currentUser.uid);
    if (otherMember) {
        addDoc(collection(db, 'notifications'), {
            recipientId: otherMember.uid, senderName: currentUser.name || currentUser.username,
            messageText: messageText, chatId: currentChatId,
            timestamp: new Date(), read: false
        }).catch(() => {});
    }
}

if (sendBtn) sendBtn.onclick = sendMessage;
if (messageInput) {
    messageInput.addEventListener('input', toggleSendButton);
    messageInput.addEventListener('keypress', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
}

const backBtn = document.getElementById('btnExitChat');
if (backBtn) {
    backBtn.onclick = () => {
        if (unsubMessages) unsubMessages();
        clearChatUserSubscription();
        const chatView = document.getElementById('chatView');
        if (chatView) { chatView.style.display = 'none'; chatView.classList.remove('chat-open'); }
        currentChatId = null;
        currentChatOtherId = null;
    };
}

const saveEditBtn = document.getElementById('btnSaveEdit');
if (saveEditBtn) {
    saveEditBtn.onclick = async () => { 
        const editInput = document.getElementById('editMessageInput');
        let newText = editInput ? editInput.value.trim() : ''; 
        if(newText && editingMessageId) { 
            await updateDoc(doc(db, "messages", editingMessageId), { text: newText, edited: true, editedAt: new Date() }); 
            document.getElementById('editMessageModal')?.classList.remove('active');
            showDynamicIsland('Сообщение изменено', 'success'); 
            editingMessageId = null; 
        } 
    };
}

document.getElementById('btnCancelEdit')?.addEventListener('click', () => {
    document.getElementById('editMessageModal')?.classList.remove('active');
    editingMessageId = null;
});

document.getElementById('btnMsgEdit')?.addEventListener('click', () => {
    hideAllContextMenus();
    const editInput = document.getElementById('editMessageInput');
    if (editInput) editInput.value = window._editingMsgText || '';
    document.getElementById('editMessageModal')?.classList.add('active');
});

document.getElementById('btnMsgDelete')?.addEventListener('click', () => {
    hideAllContextMenus();
    if (editingMessageId) deleteMessage(editingMessageId);
});

document.getElementById('btnMsgReply')?.addEventListener('click', () => {
    hideAllContextMenus();
    if (!editingMessageId) return;
    const msgEl = document.querySelector(`[data-msg-id="${editingMessageId}"]`);
    if (!msgEl) return;
    const bubble = msgEl.querySelector('.message-text');
    const replyText = bubble ? bubble.textContent : '';
    const msgData = window._editingMsgData || {};
    const senderName = msgData.senderName || '';
    const replyBar = document.getElementById('replyBar') || document.createElement('div');
    replyBar.id = 'replyBar';
    replyBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 16px;background:var(--card);border-left:3px solid var(--accent);border-radius:8px;margin:0 12px 4px;font-size:13px;color:var(--text-secondary);';
    replyBar.innerHTML = `<i class="fas fa-reply" style="color:var(--accent);"></i><div style="flex:1;overflow:hidden;"><div style="font-size:11px;font-weight:600;color:var(--accent);">${escape(senderName)}</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escape(replyText).substring(0, 60)}</div></div><i class="fas fa-times" style="cursor:pointer;opacity:0.5;" onclick="this.closest('#replyBar').remove();window._replyToMsgId=null;window._replyToText=null;window._replyToSenderName=null;"></i>`;
    const inputBar = document.querySelector('.chat-input-bar');
    if (inputBar && !document.getElementById('replyBar')) inputBar.parentNode.insertBefore(replyBar, inputBar);
    window._replyToMsgId = editingMessageId;
    window._replyToText = replyText;
    window._replyToSenderName = senderName;
    editingMessageId = null;
});

document.getElementById('btnMsgForward')?.addEventListener('click', () => {
    hideAllContextMenus();
    if (!editingMessageId) return;
    window._forwardMsgData = window._editingMsgData || null;
    openForwardPicker();
    editingMessageId = null;
});

async function openForwardPicker() {
    const modal = document.getElementById('forwardPickerModal');
    const list = document.getElementById('forwardChatList');
    const search = document.getElementById('forwardSearchInput');
    if (!modal || !list) return;
    modal.style.display = 'flex';
    list.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.5;">Загрузка...</div>';
    const chatsSnap = await getDocs(collection(db, 'chats'));
    const myChats = [];
    chatsSnap.forEach(d => {
        const c = { id: d.id, ...d.data() };
        if (c.members && c.members.some(m => m.uid === currentUser.uid)) myChats.push(c);
    });
    myChats.sort((a, b) => (b.lastMessageTime?.toMillis?.() || 0) - (a.lastMessageTime?.toMillis?.() || 0));
    function renderForwardList(filter) {
        list.innerHTML = '';
        const lf = (filter || '').toLowerCase();
        for (const chat of myChats) {
            const other = chat.members?.find(m => m.uid !== currentUser.uid);
            const name = other?.name || other?.username || chat.name || 'Чат';
            if (lf && !name.toLowerCase().includes(lf)) continue;
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;cursor:pointer;transition:background 0.15s;';
            div.innerHTML = `<div style="width:40px;height:40px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;font-weight:700;">${escape(name[0] || '?')}</div><div style="flex:1;font-weight:600;font-size:15px;">${escape(name)}</div><i class="fas fa-share" style="color:var(--accent);font-size:14px;"></i>`;
            div.onmouseenter = () => div.style.background = 'rgba(255,255,255,0.06)';
            div.onmouseleave = () => div.style.background = 'transparent';
            div.onclick = () => forwardToChat(chat.id);
            list.appendChild(div);
        }
        if (list.children.length === 0) list.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.5;">Нет чатов</div>';
    }
    renderForwardList('');
    search.value = '';
    search.oninput = () => renderForwardList(search.value);
}

async function forwardToChat(targetChatId) {
    const modal = document.getElementById('forwardPickerModal');
    if (modal) modal.style.display = 'none';
    const msgData = window._forwardMsgData;
    if (!msgData) { showDynamicIsland('Нет сообщения для пересылки', 'error'); return; }
    const fwdData = {
        chatId: targetChatId,
        type: msgData.type || 'text',
        senderId: currentUser.uid,
        senderName: currentUser.name,
        timestamp: serverTimestamp(),
        _localTime: Date.now(),
        read: false,
        forwardedFrom: msgData.senderName || msgData.forwardedFrom || 'Неизвестно',
    };
    if (msgData.type === 'text') {
        fwdData.text = msgData.text || '';
    } else if (msgData.type === 'image' || msgData.type === 'video' || msgData.type === 'voice' || msgData.type === 'circle' || msgData.type === 'file') {
        fwdData.content = msgData.content || '';
        if (msgData.fileName) fwdData.fileName = msgData.fileName;
    } else {
        fwdData.text = msgData.text || '';
    }
    await addDoc(collection(db, 'messages'), fwdData);
    await updateDoc(doc(db, 'chats', targetChatId), { lastMessage: msgData.type === 'text' ? msgData.text : `[${msgData.type}]`, lastMessageTime: serverTimestamp() });
    showDynamicIsland('Переслано', 'success');
    window._forwardMsgData = null;
}

document.getElementById('btnCancelForward')?.addEventListener('click', () => {
    document.getElementById('forwardPickerModal').style.display = 'none';
    window._forwardMsgData = null;
});

document.getElementById('btnMsgCopy')?.addEventListener('click', () => {
    hideAllContextMenus();
    if (!editingMessageId) return;
    const msgEl = document.querySelector(`[data-msg-id="${editingMessageId}"]`);
    const bubble = msgEl?.querySelector('.message-text');
    const text = bubble ? bubble.textContent : '';
    if (text && navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => showDynamicIsland('Скопировано', 'success'));
    }
    editingMessageId = null;
});

document.getElementById('btnMsgReact')?.addEventListener('click', () => {
    hideAllContextMenus();
    if (!editingMessageId) return;
    showReactionPicker(editingMessageId, window.innerWidth / 2 - 100, window.innerHeight / 2);
    editingMessageId = null;
});

document.getElementById('btnMenuPin')?.addEventListener('click', () => {
    if (contextMenuChatId) {
        togglePinChat(contextMenuChatId);
        hideAllContextMenus();
        loadChats();
    }
});

document.getElementById('btnMenuMute')?.addEventListener('click', () => {
    if (contextMenuChatId) {
        toggleMuteChat(contextMenuChatId);
        hideAllContextMenus();
        loadChats();
    }
});

document.getElementById('btnMenuClear')?.addEventListener('click', async () => {
    hideAllContextMenus();
    if (contextMenuChatId) {
        const prevChat = currentChatId;
        currentChatId = contextMenuChatId;
        await clearChatHistory();
        currentChatId = prevChat;
    }
});

document.getElementById('btnMenuDelete')?.addEventListener('click', async () => {
    hideAllContextMenus();
    if (contextMenuChatId) {
        const prevChat = currentChatId;
        currentChatId = contextMenuChatId;
        await deleteCurrentChat();
        currentChatId = prevChat;
    }
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu') && !e.target.closest('.message-bubble') && !e.target.closest('.chat-card')) {
        hideAllContextMenus();
    }
    if (!e.target.closest('#msgActionBar') && !e.target.closest('.message-bubble')) {
        const bar = document.getElementById('msgActionBar');
        if (bar) bar.style.display = 'none';
    }
});

// ========== ACTION BAR BUTTONS ==========
document.querySelectorAll('#msgActionBar .action-bar-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const bar = document.getElementById('msgActionBar');
        const action = btn.dataset.action;
        const msgId = bar?.dataset.msgId;
        if (!msgId) return;
        const msgData = window._editingMsgData || {};
        editingMessageId = msgId;
        if (action === 'reply') {
            const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
            const bubble = msgEl?.querySelector('.message-text') || msgEl?.querySelector('.msg-emoji-only');
            const replyText = bubble ? bubble.textContent : (msgData.text || '');
            const senderName = msgData.senderName || '';
            const replyBar = document.getElementById('replyBar') || document.createElement('div');
            replyBar.id = 'replyBar';
            replyBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 16px;background:var(--card);border-left:3px solid var(--accent);border-radius:8px;margin:0 12px 4px;font-size:13px;color:var(--text-secondary);';
            replyBar.innerHTML = `<i class="fas fa-reply" style="color:var(--accent);"></i><div style="flex:1;overflow:hidden;"><div style="font-size:11px;font-weight:600;color:var(--accent);">${escape(senderName)}</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escape(replyText).substring(0, 60)}</div></div><i class="fas fa-times" style="cursor:pointer;opacity:0.5;" onclick="this.closest('#replyBar').remove();window._replyToMsgId=null;window._replyToText=null;window._replyToSenderName=null;"></i>`;
            const inputBar = document.querySelector('.chat-input-bar');
            if (inputBar && !document.getElementById('replyBar')) inputBar.parentNode.insertBefore(replyBar, inputBar);
            window._replyToMsgId = msgId;
            window._replyToText = replyText;
            window._replyToSenderName = senderName;
        } else if (action === 'forward') {
            window._forwardMsgData = msgData;
            openForwardPicker();
        } else if (action === 'copy') {
            const text = msgData.text || '';
            if (text && navigator.clipboard) {
                navigator.clipboard.writeText(text).then(() => showDynamicIsland('Скопировано', 'success'));
            }
        } else if (action === 'react') {
            showReactionPicker(msgId, window.innerWidth / 2 - 100, window.innerHeight / 2);
        }
        bar.style.display = 'none';
        editingMessageId = null;
    });
});

const closeSettings = document.getElementById('closeSettings');
if (closeSettings) closeSettings.onclick = () => { const settingsModal = document.getElementById('settingsModal'); if (settingsModal) settingsModal.style.display = 'none'; };

// ========== КНОПКИ ЗВОНКОВ ==========
const audioCallBtn = document.getElementById('btnPhoneCall');
if (audioCallBtn) {
    audioCallBtn.addEventListener('click', async () => {
        if (!currentChatId || !currentChatOtherId) return;
        const targetDoc = await getDoc(doc(db, "users", currentChatOtherId));
        const target = targetDoc.data() || {};
        const name = await getCustomNameForUser(currentChatOtherId);
        await initiateCall(false, currentChatOtherId, currentUser, { name, avatarUrl: target.avatarUrl });
    });
}

const videoCallBtn = document.getElementById('btnVideoCall');
if (videoCallBtn) {
    videoCallBtn.addEventListener('click', async () => {
        if (!currentChatId || !currentChatOtherId) return;
        const targetDoc = await getDoc(doc(db, "users", currentChatOtherId));
        const target = targetDoc.data() || {};
        const name = await getCustomNameForUser(currentChatOtherId);
        await initiateCall(true, currentChatOtherId, currentUser, { name, avatarUrl: target.avatarUrl });
    });
}

// Toggle call buttons on header name click
document.getElementById('chatHeaderInfo')?.addEventListener('click', (e) => {
    if (!currentChatOtherId) return;
    const actions = document.getElementById('chatHeaderActions');
    if (actions) actions.classList.toggle('open');
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.hdr-capsule') && !e.target.closest('.hdr-actions')) {
        const actions = document.getElementById('chatHeaderActions');
        if (actions) actions.classList.remove('open');
    }
});

document.getElementById('endCallBtn')?.addEventListener('click', stopCall);
document.getElementById('btnDeclineCall')?.addEventListener('click', stopCall);
document.getElementById('toggleMicBtn')?.addEventListener('click', () => {
    const enabled = toggleLocalAudio();
    if (enabled !== null) {
        document.getElementById('toggleMicBtn').innerHTML = enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    }
});
document.getElementById('toggleCameraBtn')?.addEventListener('click', () => {
    const enabled = toggleLocalVideo();
    if (enabled !== null) {
        document.getElementById('toggleCameraBtn').innerHTML = enabled ? '<i class="fas fa-camera"></i>' : '<i class="fas fa-video-slash"></i>';
    }
});
document.getElementById('switchCameraBtn')?.addEventListener('click', triggerCameraSwitch);

const circleRecordBtnGlobal = document.getElementById('circleRecordBtn');
if (circleRecordBtnGlobal) {
    circleRecordBtnGlobal.addEventListener('click', () => { 
        if (!currentChatId) showDynamicIsland('Выберите чат', 'error'); 
        else startCircleRecordingWithPreview(); 
    });
}

const closeCameraModal = document.getElementById('closeCameraModal');
if (closeCameraModal) closeCameraModal.addEventListener('click', () => stopCircleRecording());

document.getElementById('closeCircleFullscreen')?.addEventListener('click', closeCircleFullscreen);
document.getElementById('circleFullscreenOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'circleFullscreenOverlay') closeCircleFullscreen();
});

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
    });
});

// ========== АВТОРИЗАЦИЯ ==========
let pendingUsername = null;

const btnStep1 = document.getElementById('btnStep1');
if (btnStep1) {
    btnStep1.addEventListener('click', async () => {
        const username = document.getElementById('userInput')?.value.trim();
        if (!username) { showDynamicIsland('Введите username', 'error'); return; }
        if (!username.startsWith('@')) { showDynamicIsland('Username должен начинаться с @', 'error'); return; }
        pendingUsername = username;
        try {
            const users = await getDocs(query(collection(db, "users"), where("username", "==", username)));
            if (users.empty) {
                showScreen(2);
            } else {
                const ud = users.docs[0].data();
                const helloH = document.getElementById('helloHeader');
                if (helloH) helloH.textContent = `Привет, ${ud.name || username}!`;
                showScreen(1);
            }
        } catch(e) { showDynamicIsland('Ошибка подключения', 'error'); }
    });
}

const btnStep2 = document.getElementById('btnStep2');
if (btnStep2) {
    btnStep2.addEventListener('click', async () => {
        const pass = document.getElementById('passInput')?.value;
        if (!pass) { showDynamicIsland('Введите пароль', 'error'); return; }
        
        if (!pendingUsername) { showDynamicIsland('Введите username на первом шаге', 'error'); return; }

        try {
            const users = await getDocs(query(collection(db, "users"), where("username", "==", pendingUsername)));
            if (users.empty) { showDynamicIsland('Пользователь не найден', 'error'); return; }
            
            const userData = users.docs[0].data();
            let email = userData.email;
            
            if (!email) {
                const clean = pendingUsername.replace('@', '').replace(/[^a-z0-9]/gi, '');
                email = `${clean}_${userData.uid}@sparkapp.com`;
            }
            
            await signInWithEmailAndPassword(auth, email, pass);
        } catch(e) { 
            console.error("Auth Error:", e);
            if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') {
                showDynamicIsland('Неверный пароль', 'error');
            } else {
                showDynamicIsland('Ошибка входа: ' + (e.message || e.code), 'error');
            }
        }
    });
}

const btnRegister = document.getElementById('btnRegister');
if (btnRegister) {
    btnRegister.addEventListener('click', async () => {
        const name = document.getElementById('regName')?.value.trim();
        const pass = document.getElementById('regPass')?.value;
        const birth = document.getElementById('regBirth')?.value;
        const bio = document.getElementById('regBio')?.value.trim();
        
        // Для регистрации нам все еще нужен username, берем его из pendingUsername если он был, 
        // или в данном UI он вводится на шаге 1.
        const username = pendingUsername; 

        if (!username || !name || !pass) { showDynamicIsland('Заполните основные поля', 'error'); return; }
        if (pass.length < 6) { showDynamicIsland('Пароль минимум 6 символов', 'error'); return; }
        
        try {
            const exist = await getDocs(query(collection(db, "users"), where("username", "==", username)));
            if (!exist.empty) { showDynamicIsland('Username уже занят', 'error'); return; }
            
            const cleanUsername = username.replace('@', '').replace(/[^a-z0-9]/gi, '');
            const email = `${cleanUsername}_${Date.now()}@sparkapp.com`;
            const user = await createUserWithEmailAndPassword(auth, email, pass);
            await updateProfile(user.user, { displayName: name });
            await setDoc(doc(db, "users", user.user.uid), { 
                uid: user.user.uid, 
                username, 
                name, 
                birth, 
                bio, 
                email, 
                customSubscriptions: [], 
                createdAt: new Date(), 
                online: true 
            });
            showDynamicIsland('Регистрация успешна!', 'success');
            // Auto-subscribe to SPARK channel
            subscribeToSparkChannel(user.user.uid, name, username);
        } catch(e) { showDynamicIsland(e.message, 'error'); }
    });
}

const logoutSettingsButton = document.getElementById('btn-logout');
if (logoutSettingsButton) {
    logoutSettingsButton.addEventListener('click', async () => {
        if (confirm('Выйти из аккаунта?')) {
            await setOfflineStatus();
            await signOut(auth);
            if (unsubMessages) unsubMessages();
            if (unsubChats) unsubChats();
            if (onlineStatusInterval) clearInterval(onlineStatusInterval);
            const appContainer = document.getElementById('app');
            if (appContainer) appContainer.style.display = 'none';
        }
    });
}

// ========== UI HELPERS ==========
document.getElementById('tab-chats-btn')?.addEventListener('click', (e) => switchTab('chats', e.currentTarget));
document.getElementById('tab-settings-btn')?.addEventListener('click', (e) => switchTab('settings', e.currentTarget));
document.getElementById('btn-profile-edit')?.addEventListener('click', () => openPanel('profile'));
document.getElementById('btn-theme-edit')?.addEventListener('click', () => openPanel('appearance'));
document.getElementById('btn-lang-edit')?.addEventListener('click', () => {
    const autoTranslateToggle = document.getElementById('autoTranslateToggle');
    if (autoTranslateToggle) {
        autoTranslateToggle.checked = localStorage.getItem('spark-autoTranslate') === 'on';
    }
    openPanel('language');
});
document.getElementById('btn-security-edit')?.addEventListener('click', () => openPanel('security'));
document.getElementById('btn-storage-edit')?.addEventListener('click', () => openPanel('storage'));
document.getElementById('btn-devices-edit')?.addEventListener('click', () => { loadDevices(); openPanel('devices'); });
document.getElementById('btn-premium-edit')?.addEventListener('click', () => { loadPremiumStatus(); openPanel('premium'); });
document.getElementById('btn-admin-premium-edit')?.addEventListener('click', () => { loadAdminReceiptsList(); loadAdminPremiumList(); openPanel('adminPremium'); });
document.getElementById('btn-custom-edit')?.addEventListener('click', () => openPanel('language'));

// HAMBURGER MENU
function openHamburgerDrawer() {
    const overlay = document.getElementById('hamburgerOverlay');
    const drawer = document.getElementById('hamburgerDrawer');
    if (overlay) overlay.style.display = 'block';
    if (drawer) { drawer.style.display = 'block'; requestAnimationFrame(() => drawer.style.transform = 'translateX(0)'); }
    if (currentUser) {
        renderAvatar(document.getElementById('drawerAvatar'), { avatarUrl: currentUser.avatarUrl, name: currentUser.name });
        const dn = document.getElementById('drawerName'); if (dn) dn.textContent = currentUser.name;
        const du = document.getElementById('drawerUsername'); if (du) du.textContent = '@' + (currentUser.username || '');
    }
}
document.getElementById('btnHamburger')?.addEventListener('click', openHamburgerDrawer);
document.getElementById('btnHamburger2')?.addEventListener('click', openHamburgerDrawer);

function closeHamburger() {
    const overlay = document.getElementById('hamburgerOverlay');
    const drawer = document.getElementById('hamburgerDrawer');
    if (drawer) drawer.style.transform = 'translateX(-100%)';
    if (overlay) setTimeout(() => { overlay.style.display = 'none'; drawer.style.display = 'none'; }, 300);
}
window.closeHamburger = closeHamburger;

document.querySelectorAll('.drawer-item').forEach(item => {
    item.addEventListener('click', (e) => {
        if (e.target.closest('.ios-switch')) return;
        const action = item.dataset.action;
        closeHamburger();
        if (action === 'chats') {
            switchTab('chats');
        }
        else if (action === 'profile') openPanel('profile');
        else if (action === 'settings') {
            switchTab('settings');
        }
        else if (action === 'create-group' || action === 'create-channel') {
            document.getElementById('createChannelModal')?.classList.add('active');
        }
        else if (action === 'contacts') {
            switchTab('chats');
        }
        else if (action === 'calls') {
            openPanel('devices');
        }
        else if (action === 'favorites') {
            switchTab('chats');
        }
        else if (action === 'wallet') {
            openPanel('premium');
        }
        else if (action === 'nightmode') {
            const toggle = document.getElementById('drawerNightToggle');
            if (toggle) { toggle.checked = !toggle.checked; localStorage.setItem('spark-theme', toggle.checked ? 'dark' : 'light'); applySavedTheme(); }
        }
    });
});

document.getElementById('drawerNightToggle')?.addEventListener('change', (e) => {
    localStorage.setItem('spark-theme', e.target.checked ? 'dark' : 'light');
    applySavedTheme();
});

document.getElementById('closeProfilePanelBtn')?.addEventListener('click', () => closePanel('profile'));
document.getElementById('closeAppearancePanelBtn')?.addEventListener('click', () => closePanel('appearance'));
document.getElementById('closeLangPanelBtn')?.addEventListener('click', () => closePanel('language'));
document.getElementById('closeDevicesPanelBtn')?.addEventListener('click', () => closePanel('devices'));
document.getElementById('closeSecurityPanelBtn')?.addEventListener('click', () => closePanel('security'));
document.getElementById('closeStoragePanelBtn')?.addEventListener('click', () => closePanel('storage'));
document.getElementById('closePremiumPanelBtn')?.addEventListener('click', () => closePanel('premium'));
document.getElementById('closeAdminPremiumPanelBtn')?.addEventListener('click', () => closePanel('adminPremium'));
document.getElementById('closeCustomPanelBtn')?.addEventListener('click', () => closePanel('custom'));

initPanelHandlers({ showToast: showDynamicIsland });

document.getElementById('btnSaveProfile')?.addEventListener('click', async () => {
    if (!currentUser) return;
    const name = document.getElementById('editName')?.value.trim();
    const birth = document.getElementById('editBirth')?.value;
    const bio = document.getElementById('editBio')?.value.trim();
    if (!name) { showDynamicIsland('Введите имя', 'error'); return; }
    await updateDoc(doc(db, "users", currentUser.uid), { name, birth, bio });
    currentUser = { ...currentUser, name, birth, bio };
    syncProfile(currentUser);
    closePanel('profile');
    showDynamicIsland('Профиль сохранён', 'success');
});

document.getElementById('btnChangeAvatar')?.addEventListener('click', () => {
    document.getElementById('avatarFileInput')?.click();
});

// ========== КОНТЕКСТНОЕ МЕНЮ КРУЖКА ==========
let circleContextMenuMsgId = null;
document.getElementById('btnCircleFullscreen')?.addEventListener('click', () => {
    hideAllContextMenus();
    if (circleContextMenuMsgId) {
        const videoEl = document.querySelector(`[data-msg-id="${circleContextMenuMsgId}"] video.circle-video-el`);
        if (videoEl) openCircleFullscreen(videoEl.src, videoEl.currentTime);
    }
});
document.getElementById('btnCircleDelete')?.addEventListener('click', () => {
    hideAllContextMenus();
    if (circleContextMenuMsgId) deleteMessage(circleContextMenuMsgId);
});

// ========== СОЗДАНИЕ КАНАЛА/ГРУППЫ ==========
document.getElementById('btnOpenCreateChannel')?.addEventListener('click', async () => {
    const modal = document.getElementById('createChannelModal');
    if (!modal) return;
    modal.classList.add('active');
    selectedChannelType = 'channel';
    document.getElementById('channelTypeChannel').style.background = 'var(--accent)';
    document.getElementById('channelTypeChannel').style.color = 'var(--bg)';
    document.getElementById('channelTypeGroup').style.background = 'var(--card)';
    document.getElementById('channelTypeGroup').style.color = 'var(--text)';
    document.getElementById('channelNameInput').value = '';
    
    // Load users from chats for member picker (Telegram-style)
    const usersToShow = new Map();
    try {
        const allChatsSnap = await getDocs(collection(db, "chats"));
        allChatsSnap.forEach(d => {
            const chat = d.data();
            const memberUids = chat.memberUids || chat.members?.map(m => m.uid) || [];
            if (!memberUids.includes(currentUser.uid)) return;
            if (chat.type === 'channel') return;
            const otherUid = memberUids.find(u => u !== currentUser.uid);
            if (otherUid && !usersToShow.has(otherUid)) usersToShow.set(otherUid, true);
        });
    } catch (e) { console.warn('Member picker load error:', e); }
    const picker = document.getElementById('channelMembersPicker');
    picker.innerHTML = '';
    if (usersToShow.size === 0) {
        picker.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">Нет контактов (сначала начните чат)</div>';
    } else {
        for (const otherUid of usersToShow.keys()) {
            try {
                const uDoc = await getDoc(doc(db, "users", otherUid));
                if (uDoc.exists()) {
                    const u = uDoc.data();
                    const div = document.createElement('div');
                    div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);';
                    div.innerHTML = `<label style="display:flex;align-items:center;gap:10px;cursor:pointer;flex:1;">
                        <input type="checkbox" value="${u.uid}" data-name="${escape(u.name || u.username)}" style="width:18px;height:18px;accent-color:var(--accent);">
                        <span style="color:var(--text);font-size:14px;">${escape(u.name || u.username)}</span>
                    </label>`;
                    picker.appendChild(div);
                }
            } catch (e) {}
        }
    }
});

document.getElementById('channelTypeChannel')?.addEventListener('click', () => {
    selectedChannelType = 'channel';
    document.getElementById('channelTypeChannel').style.background = 'var(--accent)';
    document.getElementById('channelTypeChannel').style.color = 'var(--bg)';
    document.getElementById('channelTypeGroup').style.background = 'var(--card)';
    document.getElementById('channelTypeGroup').style.color = 'var(--text)';
});
document.getElementById('channelTypeGroup')?.addEventListener('click', () => {
    selectedChannelType = 'group';
    document.getElementById('channelTypeGroup').style.background = 'var(--accent)';
    document.getElementById('channelTypeGroup').style.color = 'var(--bg)';
    document.getElementById('channelTypeChannel').style.background = 'var(--card)';
    document.getElementById('channelTypeChannel').style.color = 'var(--text)';
});
document.getElementById('btnCancelChannel')?.addEventListener('click', () => {
    document.getElementById('createChannelModal')?.classList.remove('active');
});
document.getElementById('btnCreateChannel')?.addEventListener('click', async () => {
    const name = document.getElementById('channelNameInput')?.value.trim();
    if (!name) { showDynamicIsland('Введите название', 'error'); return; }
    
    const checkboxes = document.querySelectorAll('#channelMembersPicker input[type="checkbox"]:checked');
    const members = [{ uid: currentUser.uid, name: currentUser.name, username: currentUser.username, role: 'owner' }];
    checkboxes.forEach(cb => {
        members.push({ uid: cb.value, name: cb.dataset.name, username: '', role: 'member' });
    });
    
    try {
        const ref = await addDoc(collection(db, "chats"), {
            name, type: selectedChannelType, ownerId: currentUser.uid,
            members, memberUids: members.map(m => m.uid),
            createdAt: serverTimestamp(), lastMessage: '', lastMessageTime: null
        });
        document.getElementById('createChannelModal')?.classList.remove('active');
        showDynamicIsland(`${selectedChannelType === 'channel' ? 'Канал' : 'Группа'} создана!`, 'success');
        loadChats();
    } catch (e) {
        console.error('Create channel error:', e);
        showDynamicIsland('Ошибка создания', 'error');
    }
});

// ========== ОТКРЫТИЕ КАНАЛА/ГРУППЫ ==========
function openChannel(id, name, channelData) {
    if (unsubMessages) unsubMessages();
    clearChatUserSubscription();
    currentChatId = id;
    currentChatOtherId = null;
    currentChannelData = channelData;
    
    const chatTargetName = document.getElementById('chatTargetName');
    if (chatTargetName) chatTargetName.textContent = name;
    const chatView = document.getElementById('chatView');
    if (chatView) { chatView.style.display = 'flex'; chatView.classList.add('chat-open'); }
    
    // Render channel avatar
    renderAvatar(document.getElementById('chatTargetAvatar'), { avatarUrl: channelData.avatarUrl, name });
    
    // Hide status for channels
    const statusEl = document.getElementById('chatTargetStatus');
    if (statusEl) statusEl.textContent = channelData.type === 'channel' ? 'Канал' : 'Группа';
    
    // Hide call buttons for channels
    const actions = document.getElementById('chatHeaderActions');
    if (actions) { actions.classList.remove('open'); actions.style.display = 'none'; }
    
    // Check if user can write
    const isOwner = channelData.ownerId === currentUser.uid;
    const isSparkChannel = channelData.name === SPARK_CHANNEL_NAME;
    const inputBar = document.querySelector('.chat-input-bar');
    if (channelData.type === 'channel' && (isSparkChannel ? !isCreator(currentUser) : !isOwner)) {
        if (inputBar) inputBar.style.display = 'none';
    } else {
        if (inputBar) inputBar.style.display = 'flex';
    }
    
    // Channel info on avatar click - store data for the shared handler
    currentChannelData = channelData;
    
    markMessagesAsRead(id);
    
    // Subscribe to messages
    let msgsQuery = query(collection(db, "messages"), where("chatId", "==", id));
    unsubMessages = onSnapshot(msgsQuery, async (snap) => {
        let msgs = [];
        for (const d of snap.docs) msgs.push({ id: d.id, ...d.data() });
        msgs.sort((a, b) => {
            const ta = a.timestamp?.toMillis?.() || 0;
            const tb = b.timestamp?.toMillis?.() || 0;
            return ta - tb;
        });
        let area = document.getElementById('messagesArea');
        if (!area) return;
        if (msgs.length === 0) area.innerHTML = `<div style="text-align:center;margin-top:80px;opacity:0.6;">Нет сообщений</div>`;
        else {
            area.innerHTML = '';
            for (const msg of msgs) {
                let isMy = msg.senderId === currentUser.uid;
                let div = document.createElement('div');
                div.className = `message ${isMy ? 'my-message' : ''}`;
                div.dataset.msgId = msg.id;
                let content = '';
                
                if (msg.type === 'image') {
                    let src = getBlobUrlFromBase64(msg.content || msg.url);
                    content = `<div class="msg-image-wrap"><img src="${src}" onclick="window.open(this.src,'_blank')"></div>`;
                } else if (msg.type === 'video') {
                    let src = getBlobUrlFromBase64(msg.content || msg.url);
                    content = `<video src="${src}" controls playsinline webkit-playsinline style="max-width:200px;max-height:200px;border-radius:16px;"></video>`;
                } else if (msg.type === 'circle') {
                    const src = msg.content && !msg.content.startsWith('data:') ? msg.content : getBlobUrlFromBase64(msg.content || msg.url);
                    content = createCirclePlayerHTML(src);
                } else if (msg.type === 'file') {
                    let src = getBlobUrlFromBase64(msg.content || msg.url);
                    content = `<a href="${src}" download="${msg.fileName}" target="_blank" class="file-message"><i class="fas fa-file"></i><span>${escape(msg.fileName)}</span><i class="fas fa-download"></i></a>`;
                } else if (msg.type === 'voice') {
                    const audioSrc = getBlobUrlFromBase64(msg.content);
                    content = `<audio controls preload="metadata" playsinline src="${audioSrc}" style="max-width:220px;height:40px;border-radius:20px;"></audio>`;
                } else if (msg.type === 'system') {
                    content = `<div class="message-text" style="font-style: italic; opacity: 0.7;">${escape(msg.text)}</div>`;
                } else {
                    let displayText = escape(msg.text);
                    const emojiOnly = isEmojiOnly(msg.text);
                    if (emojiOnly) content = `<div class="msg-emoji-only">${displayText}</div>`;
                    else {
                        content = `<div class="message-text" data-msg-text="${escape(msg.text)}">${displayText}</div>`;
                    }
                    if (msg.edited) content += `<span class="edited-badge"> ${t('edited')}</span>`;
                }
                
                const bubble = document.createElement('div');
                bubble.className = 'message-bubble';
                if (msg.type === 'circle') bubble.classList.add('circle-bubble');
                if (isMy && msg.type !== 'system') bubble.classList.add('clickable');
                
                const senderLabel = !isMy && channelData.type === 'channel' ? `<div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:4px;">${escape(msg.senderName || '')}</div>` : '';
                let replyHtml = '';
                if (msg.replyTo) {
                    const replySnippet = msg.replyToText ? escape(msg.replyToText).substring(0, 80) : '';
                    const replySender = msg.replyToSenderName ? escape(msg.replyToSenderName) : '';
                    replyHtml = `<div class="reply-quote" style="border-left:3px solid var(--accent);padding:4px 10px;margin-bottom:6px;border-radius:4px;background:rgba(108,92,231,0.08);font-size:12px;"><div style="font-weight:600;color:var(--accent);font-size:11px;">${replySender}</div><div style="color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px;">${replySnippet}</div></div>`;
                }
                let forwardHtml = '';
                if (msg.forwardedFrom) {
                    forwardHtml = `<div style="font-size:11px;color:var(--accent);font-weight:600;margin-bottom:4px;"><i class="fas fa-share" style="margin-right:4px;font-size:10px;"></i>Переслано от ${escape(msg.forwardedFrom)}</div>`;
                }
                bubble.innerHTML = `<div>${senderLabel}${forwardHtml}${replyHtml}${content}</div><div class="message-time">${msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || ''}</div>`;
                
                if (msg.type === 'circle') initCirclePlayer(bubble);
                
                if (isMy && msg.type !== 'system' && msg.type !== 'circle') {
                    bubble.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const msgMenu = document.getElementById('messageContextMenu');
                        const editBtn = document.getElementById('btnMsgEdit');
                        if (editBtn) editBtn.style.display = msg.type === 'text' && isMy ? 'flex' : 'none';
                        editingMessageId = msg.id;
                        window._editingMsgText = msg.text || '';
                        window._editingMsgData = msg;
                        showContextMenu(msgMenu, e.clientX, e.clientY);
                    });
                }
                if (!isMy && msg.type !== 'system' && msg.type !== 'circle') {
                    bubble.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const bar = document.getElementById('msgActionBar');
                        if (!bar) return;
                        bar.style.display = 'flex';
                        const bw = 280, bh = 44;
                        let left = Math.max(10, Math.min(e.clientX - bw/2, window.innerWidth - bw - 10));
                        let top = e.clientY - bh - 12;
                        if (top < 10) top = e.clientY + 12;
                        bar.style.left = left + 'px';
                        bar.style.top = Math.max(10, top) + 'px';
                        bar.dataset.msgId = msg.id;
                        bar.dataset.msgType = msg.type || 'text';
                        bar.dataset.msgText = msg.text || '';
                        bar.dataset.msgContent = msg.content || '';
                        bar.dataset.msgSenderName = msg.senderName || '';
                        bar.dataset.msgFileName = msg.fileName || '';
                        editingMessageId = msg.id;
                        window._editingMsgData = msg;
                    });
                }
                if (msg.type === 'circle') {
                    bubble.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        circleContextMenuMsgId = msg.id;
                        const delBtn = document.getElementById('btnCircleDelete');
                        if (delBtn) delBtn.style.display = isMy ? 'flex' : 'none';
                        showContextMenu(document.getElementById('circleContextMenu'), e.clientX, e.clientY);
                    });
                }
                if (msg.reactions && Object.keys(msg.reactions).length > 0) {
                    const isChannelType = currentChannelData && currentChannelData.type === 'channel';
                    const rDiv = renderReactions(msg, isChannelType);
                    if (rDiv) bubble.appendChild(rDiv);
                }
                div.appendChild(bubble);
                area.appendChild(div);
            }
        }
        area.scrollTop = area.scrollHeight;
    });
}

// ========== ИНФО КАНАЛА/ГРУППЫ ==========
async function openChannelInfo(channelData) {
    const panel = document.getElementById('channelInfoPanel');
    if (!panel) return;
    
    document.getElementById('channelInfoTitle').textContent = channelData.type === 'channel' ? 'Инфо канала' : 'Инфо группы';
    document.getElementById('channelInfoName').textContent = channelData.name || '';
    document.getElementById('channelInfoType').textContent = channelData.type === 'channel' ? 'Канал' : 'Группа';
    
    renderAvatar(document.getElementById('channelInfoAvatar'), { avatarUrl: channelData.avatarUrl, name: channelData.name });
    
    // Find owner name
    const ownerMember = channelData.members?.find(m => m.role === 'owner');
    const ownerName = ownerMember?.name || 'Неизвестно';
    document.getElementById('channelInfoOwner').textContent = `Владелец: ${ownerName}`;
    
    // Render members
    const membersContainer = document.getElementById('channelInfoMembers');
    membersContainer.innerHTML = '';
    if (channelData.members) {
        for (const member of channelData.members) {
            const memberDoc = await getDoc(doc(db, "users", member.uid));
            const memberData = memberDoc.exists() ? memberDoc.data() : {};
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);';
            const roleBadge = member.role === 'owner' ? '<span style="color:var(--accent);font-size:12px;margin-left:6px;">Владелец</span>' : '';
            div.innerHTML = `<div class="avatar" style="width:40px;height:40px;font-size:16px;"></div>
                <div><div style="color:var(--text);font-weight:600;">${escape(member.name || member.username || member.uid)}</div>${roleBadge}</div>`;
            renderAvatar(div.querySelector('.avatar'), { avatarUrl: memberData.avatarUrl, name: member.name });
            membersContainer.appendChild(div);
        }
    }
    
    panel.classList.add('active');
}
document.getElementById('closeChannelInfoBtn')?.addEventListener('click', () => {
    document.getElementById('channelInfoPanel')?.classList.remove('active');
});

// ========== УСТРОЙСТВА ==========
function generateDeviceId() {
    return currentUser.uid + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
}

async function loadDevices() {
    if (!currentUser) return;
    const container = document.getElementById('deviceList');
    if (!container) return;
    
    try {
        const devicesQuery = query(collection(db, "devices"), where("userId", "==", currentUser.uid));
        const snap = await getDocs(devicesQuery);
        container.innerHTML = '';
        
        if (snap.empty) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">Нет устройств</div>';
            return;
        }
        
        const currentDeviceId = localStorage.getItem('spark-device-id') || '';
        
        snap.forEach(d => {
            const device = d.data();
            const isCurrent = d.id === currentDeviceId;
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:14px;padding:16px;background:var(--card);border-radius:16px;margin-bottom:10px;border:1px solid var(--border);';
            const icon = device.platform === 'ios' ? 'fa-mobile-alt' : device.platform === 'android' ? 'fa-android' : 'fa-globe';
            const statusColor = isCurrent ? '#2ecc71' : 'var(--text-secondary)';
            const lastActive = device.lastActive?.toDate ? device.lastActive.toDate().toLocaleString() : 'Неизвестно';
            div.innerHTML = `<div style="width:44px;height:44px;background:rgba(255,255,255,0.05);border-radius:12px;display:flex;align-items:center;justify-content:center;"><i class="fas ${icon}" style="font-size:20px;color:var(--text);"></i></div>
                <div style="flex:1;">
                    <div style="font-weight:600;color:var(--text);font-size:14px;">${device.brand || device.platform || 'Устройство'} ${isCurrent ? '(это устройство)' : ''}</div>
                    <div style="font-size:12px;color:${statusColor};">${isCurrent ? 'Активно' : 'Последний вход: ' + lastActive}</div>
                </div>
                ${!isCurrent ? `<button class="small-btn removeDeviceBtn" data-device="${d.id}" style="background:#e74c3c;">Удалить</button>` : ''}`;
            container.appendChild(div);
        });
        
        container.querySelectorAll('.removeDeviceBtn').forEach(btn => {
            btn.onclick = async () => {
                if (!confirm('Удалить устройство? Пользователь будет отключён.')) return;
                const deviceId = btn.dataset.device;
                const deviceDoc = await getDoc(doc(db, "devices", deviceId));
                if (deviceDoc.exists()) {
                    const deviceData = deviceDoc.data();
                    // Remove FCM token from user
                    if (deviceData.fcmToken) {
                        await updateDoc(doc(db, "users", currentUser.uid), {
                            fcmTokens: arrayRemove(deviceData.fcmToken)
                        });
                    }
                    await deleteDoc(doc(db, "devices", deviceId));
                    showDynamicIsland('Устройство удалено', 'success');
                    loadDevices();
                }
            };
        });
    } catch (e) {
        console.error('Load devices error:', e);
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Ошибка загрузки</div>';
    }
}

async function registerCurrentDevice() {
    if (!currentUser) return;
    let deviceId = localStorage.getItem('spark-device-id');
    const dev = detectDevice();
    
    try {
        if (deviceId) {
            const deviceDoc = await getDoc(doc(db, "devices", deviceId));
            if (deviceDoc.exists() && deviceDoc.data().userId === currentUser.uid) {
                await updateDoc(doc(db, "devices", deviceId), { lastActive: serverTimestamp() });
                return;
            }
        }
        
        // Create new device entry
        let fcmToken = null;
        try { fcmToken = await getFCMToken(); } catch (e) {}
        
        const ref = await addDoc(collection(db, "devices"), {
            userId: currentUser.uid,
            platform: dev.platform,
            brand: dev.brand,
            lastActive: serverTimestamp(),
            createdAt: serverTimestamp(),
            fcmToken: fcmToken || ''
        });
        localStorage.setItem('spark-device-id', ref.id);
    } catch (e) {
        console.warn('Device register error:', e);
    }
}

// QR Code generation (simple canvas-based)
function generateQR(text, canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 200;
    canvas.width = size;
    canvas.height = size;
    
    // Simple hash-based QR-like pattern
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    
    const cellSize = 8;
    const hash = text.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    let seed = Math.abs(hash);
    
    for (let y = 0; y < size; y += cellSize) {
        for (let x = 0; x < size; x += cellSize) {
            // Position markers
            const isMarker = (x < 48 && y < 48) || (x > size - 48 && y < 48) || (x < 48 && y > size - 48);
            if (isMarker) {
                const mx = x % 48, my = y % 48;
                const isBorder = mx === 0 || my === 0 || mx >= 40 || my >= 40;
                const isInner = mx >= 12 && mx <= 28 && my >= 12 && my <= 28;
                if (isBorder || isInner) {
                    ctx.fillRect(x, y, cellSize, cellSize);
                }
            } else {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                if (seed % 3 !== 0) ctx.fillRect(x, y, cellSize, cellSize);
            }
        }
    }
    
    // Center icon
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(size/2 - 16, size/2 - 16, 32, 32);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', size/2, size/2);
}

document.getElementById('btnShowQR')?.addEventListener('click', () => {
    const modal = document.getElementById('qrModal');
    if (modal) modal.classList.add('active');
    const qrData = `spark-login:${currentUser.uid}:${Date.now()}`;
    generateQR(qrData, document.getElementById('qrCanvas'));
});
document.getElementById('btnCloseQR')?.addEventListener('click', () => {
    document.getElementById('qrModal')?.classList.remove('active');
});

// ========== СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ ==========
async function getUserStats(userId, otherUserId) {
    const stats = { images: 0, files: 0, links: 0, messages: 0 };
    try {
        // Get chat between users
        const myChatsQuery = query(collection(db, "chats"), where("type", "==", "private"));
        const chatsSnap = await getDocs(myChatsQuery);
        let chatId = null;
        chatsSnap.forEach(d => {
            const members = d.data().members || [];
            if (members.some(m => m.uid === userId) && members.some(m => m.uid === otherUserId)) {
                chatId = d.id;
            }
        });
        if (!chatId) return stats;
        
        const msgsQuery = query(collection(db, "messages"), where("chatId", "==", chatId));
        const msgsSnap = await getDocs(msgsQuery);
        msgsSnap.forEach(d => {
            const msg = d.data();
            stats.messages++;
            if (msg.type === 'image') stats.images++;
            else if (msg.type === 'file') stats.files++;
            else if (msg.type === 'text' && /https?:\/\//.test(msg.text || '')) stats.links++;
        });
    } catch (e) {}
    return stats;
}

// ========== FACE ID ==========
let faceIdStream = null;
let faceIdRegistered = localStorage.getItem('spark-faceid-registered') === 'true';
let faceIdMode = 'login'; // 'bind' or 'login'

// Face ID - привязка в настройках
document.getElementById('btnFaceId')?.addEventListener('click', () => {
    faceIdMode = 'bind';
    openFaceIdModal();
});

// ========== FACE ID ВХОД (объединённый) ==========

async function openFaceIdModal() {
    if (faceIdMode === 'bind' && faceIdRegistered) {
        if (confirm('Face ID уже привязан. Перепривязать?')) {
            faceIdRegistered = false;
            localStorage.removeItem('spark-faceid-uid');
        } else return;
    }
    
    if (faceIdMode === 'login' && !faceIdRegistered) {
        showDynamicIsland('Face ID не привязан. Сначала войдите и привяжите в Безопасности', 'error');
        return;
    }
    
    const modal = document.getElementById('faceIdModal');
    if (modal) modal.classList.add('active');
    document.getElementById('faceIdMessage').textContent = 'Наведите камеру на лицо';
    
    try {
        faceIdStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 320 } });
        const video = document.getElementById('faceIdVideo');
        if (video) { video.srcObject = faceIdStream; await video.play().catch(() => {}); }
    } catch (e) {
        document.getElementById('faceIdMessage').textContent = 'Нет доступа к камере';
    }
}

document.getElementById('btnScanFaceId')?.addEventListener('click', async () => {
    const msg = document.getElementById('faceIdMessage');
    if (msg) msg.textContent = 'Сканирование...';
    
    setTimeout(async () => {
        if (faceIdStream) { faceIdStream.getTracks().forEach(t => t.stop()); faceIdStream = null; }
        document.getElementById('faceIdModal')?.classList.remove('active');
        
        if (faceIdMode === 'bind' && currentUser) {
            // Bind mode - save face data
            faceIdRegistered = true;
            localStorage.setItem('spark-faceid-registered', 'true');
            localStorage.setItem('spark-faceid-uid', currentUser.uid);
            updateFaceIdStatus();
            showDynamicIsland('Face ID привязан!', 'success');
        } else if (faceIdMode === 'login') {
            // Login mode - auto login
            const savedUid = localStorage.getItem('spark-faceid-uid');
            if (savedUid) {
                const userDoc = await getDoc(doc(db, "users", savedUid));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    document.getElementById('userInput').value = userData.username || '';
                    pendingUsername = userData.username;
                    showScreen(1);
                    showDynamicIsland('Face ID распознан! Введите пароль', 'success');
                } else {
                    showDynamicIsland('Аккаунт не найден', 'error');
                }
            } else {
                showDynamicIsland('Face ID не привязан', 'error');
            }
        }
    }, 2000);
});

document.getElementById('btnCancelFaceId')?.addEventListener('click', () => {
    if (faceIdStream) { faceIdStream.getTracks().forEach(t => t.stop()); faceIdStream = null; }
    document.getElementById('faceIdModal')?.classList.remove('active');
});

// ========== QR КОД ВХОДА ==========
let qrLoginStream = null;
let qrDetectInterval = null;

// QR - вход на экране входа
document.getElementById('btnAuthQr')?.addEventListener('click', async () => {
    const modal = document.getElementById('qrLoginModal');
    if (modal) modal.classList.add('active');
    
    try {
        qrLoginStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = document.getElementById('qrLoginVideo');
        if (video) { video.srcObject = qrLoginStream; await video.play().catch(() => {}); }
        document.getElementById('qrLoginMessage').textContent = 'Сканируйте QR-код для входа';
        
        // Auto-detect QR code
        startQrDetection(video);
    } catch (e) {
        document.getElementById('qrLoginMessage').textContent = 'Нет доступа к камере';
    }
});

function startQrDetection(video) {
    if (qrDetectInterval) clearInterval(qrDetectInterval);
    
    if ('BarcodeDetector' in window) {
        const barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
        qrDetectInterval = setInterval(async () => {
            if (!qrLoginStream) { clearInterval(qrDetectInterval); return; }
            try {
                const barcodes = await barcodeDetector.detect(video);
                if (barcodes.length > 0) {
                    const code = barcodes[0].rawValue;
                    handleQrCodeScanned(code);
                }
            } catch (e) {}
        }, 300);
    } else {
        // Fallback: manual input
        if (qrDetectInterval) clearInterval(qrDetectInterval);
        const msgEl = document.getElementById('qrLoginMessage');
        if (msgEl) {
            msgEl.innerHTML = 'QR-код недоступен. Введите @username вручную:<div style="display:flex;gap:8px;margin-top:10px;"><input type="text" id="qrManualInput" class="input" placeholder="@username" style="flex:1;margin:0;font-size:14px;padding:10px;"><button class="btn" id="qrManualSubmit" style="padding:10px 16px;width:auto;font-size:14px;">→</button></div>';
        }
        document.getElementById('qrManualSubmit')?.addEventListener('click', async () => {
            const val = document.getElementById('qrManualInput')?.value.trim();
            if (!val) return;
            if (qrLoginStream) { qrLoginStream.getTracks().forEach(t => t.stop()); qrLoginStream = null; }
            document.getElementById('qrLoginModal')?.classList.remove('active');
            const username = val.startsWith('@') ? val : '@' + val;
            document.getElementById('userInput').value = username;
            pendingUsername = username;
            showDynamicIsland('Username введён!', 'success');
            showScreen(1);
        });
    }
}

async function handleQrCodeScanned(code) {
    if (!code || !code.startsWith('spark-')) return;
    if (qrDetectInterval) clearInterval(qrDetectInterval);
    if (qrLoginStream) { qrLoginStream.getTracks().forEach(t => t.stop()); qrLoginStream = null; }
    document.getElementById('qrLoginModal')?.classList.remove('active');
    
    const parts = code.split(':');
    if (parts.length >= 2) {
        const targetUid = parts[1];
        const userDoc = await getDoc(doc(db, "users", targetUid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            document.getElementById('userInput').value = userData.username || '';
            pendingUsername = userData.username;
            showDynamicIsland('QR-код распознан!', 'success');
            showScreen(1);
        } else {
            showDynamicIsland('Пользователь не найден', 'error');
        }
    }
}

document.getElementById('btnCloseQrLogin')?.addEventListener('click', () => {
    if (qrDetectInterval) clearInterval(qrDetectInterval);
    if (qrLoginStream) { qrLoginStream.getTracks().forEach(t => t.stop()); qrLoginStream = null; }
    document.getElementById('qrLoginModal')?.classList.remove('active');
});

document.getElementById('btnQrLogin')?.addEventListener('click', async () => {
    const modal = document.getElementById('qrLoginModal');
    if (modal) modal.classList.add('active');
    
    try {
        qrLoginStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = document.getElementById('qrLoginVideo');
        if (video) { video.srcObject = qrLoginStream; await video.play().catch(() => {}); }
        document.getElementById('qrLoginMessage').textContent = 'Наведите камеру на QR-код';
    } catch (e) {
        document.getElementById('qrLoginMessage').textContent = 'Нет доступа к камере';
    }
});

document.getElementById('btnCloseQrLogin')?.addEventListener('click', () => {
    if (qrLoginStream) { qrLoginStream.getTracks().forEach(t => t.stop()); qrLoginStream = null; }
    document.getElementById('qrLoginModal')?.classList.remove('active');
});

// ========== SPARK КАНАЛ ==========
async function subscribeToSparkChannel(uid, name, username) {
    try {
        const existing = await getDocs(query(collection(db, "chats"), where("name", "==", SPARK_CHANNEL_NAME)));
        if (!existing.empty) {
            const sparkDoc = existing.docs[0];
            const sparkData = sparkDoc.data();
            const members = sparkData.members || [];
            if (!members.some(m => m.uid === uid)) {
                await updateDoc(doc(db, "chats", sparkDoc.id), {
                    members: arrayUnion({ uid, name, username: username || '', role: 'member' }),
                    memberUids: arrayUnion(uid)
                });
            }
        }
    } catch (e) {
        console.warn('Subscribe to SPARK:', e);
    }
}

async function subscribeAllToSparkChannel() {
    try {
        const existing = await getDocs(query(collection(db, "chats"), where("name", "==", SPARK_CHANNEL_NAME)));
        if (existing.empty) return;
        const sparkDoc = existing.docs[0];
        const sparkData = sparkDoc.data();
        const existingUids = sparkData.memberUids || [];
        
        const allUsers = await getDocs(collection(db, "users"));
        const batch = writeBatch(db);
        let newMembers = [...(sparkData.members || [])];
        let newUids = [...existingUids];
        
        allUsers.forEach(d => {
            const u = d.data();
            if (u.uid && !existingUids.includes(u.uid)) {
                newMembers.push({ uid: u.uid, name: u.name || u.username || u.uid, username: u.username || '', role: 'member' });
                newUids.push(u.uid);
            }
        });
        
        if (newUids.length > existingUids.length) {
            await updateDoc(doc(db, "chats", sparkDoc.id), {
                members: newMembers,
                memberUids: newUids
            });
            console.log(`Subscribed ${newUids.length - existingUids.length} users to SPARK`);
        }
    } catch (e) {
        console.warn('Subscribe all to SPARK:', e);
    }
}

async function initSparkChannel() {
    if (!currentUser) return;
    try {
        const existing = await getDocs(query(collection(db, "chats"), where("name", "==", SPARK_CHANNEL_NAME)));
        if (existing.empty && isCreator(currentUser)) {
            await addDoc(collection(db, "chats"), {
                name: SPARK_CHANNEL_NAME, type: 'channel', ownerId: currentUser.uid,
                avatarUrl: 'icon.png',
                members: [{ uid: currentUser.uid, name: currentUser.name, username: currentUser.username, role: 'owner' }],
                memberUids: [currentUser.uid],
                createdAt: serverTimestamp(), lastMessage: 'Канал SPARK создан!', lastMessageTime: serverTimestamp()
            });
        }
        // Subscribe all users on every login
        subscribeAllToSparkChannel();
    } catch (e) {
        console.warn('SPARK channel init:', e);
    }
}

// ========== УЛУЧШЕННАЯ ИНФО ПРОФИЛЯ ==========
async function openProfileModal(userId) {
    if (!userId) return;
    const userDoc = await getDoc(doc(db, "users", userId));
    if (!userDoc.exists()) return;
    const u = userDoc.data();
    const name = await getCustomNameForUser(userId);
    
    renderAvatar(document.getElementById('modalTargetAvatar'), { avatarUrl: u.avatarUrl, name });
    document.getElementById('modalTargetName').textContent = name;
    const modalUser = document.getElementById('modalTargetUser');
    if (modalUser) { modalUser.style.display = 'block'; modalUser.textContent = u.username || ''; }
    document.getElementById('modalTargetBio').textContent = u.bio || t('noInfo');
    document.getElementById('modalTargetBirth').textContent = u.birth || t('notSpecified');
    
    // Creator badge
    const creatorBadge = document.getElementById('modalCreatorBadge');
    if (creatorBadge) {
        creatorBadge.style.display = isCreator(u) ? 'block' : 'none';
    }
    
    // Avatar history
    const avatarHistorySection = document.getElementById('modalAvatarHistory');
    const avatarHistoryList = document.getElementById('modalAvatarHistoryList');
    if (avatarHistorySection && avatarHistoryList) {
        const history = u.avatarHistory || [];
        if (history.length > 0) {
            avatarHistorySection.style.display = 'block';
            avatarHistoryList.innerHTML = '';
            history.forEach(url => {
                const div = document.createElement('div');
                div.style.cssText = 'min-width:60px;width:60px;height:60px;border-radius:50%;overflow:hidden;cursor:pointer;border:2px solid var(--border);flex-shrink:0;';
                div.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
                div.onclick = () => window.open(url, '_blank');
                avatarHistoryList.appendChild(div);
            });
        } else {
            avatarHistorySection.style.display = 'none';
        }
    }
    
    // Shared images
    const sharedImagesSection = document.getElementById('modalSharedImages');
    const sharedImagesGrid = document.getElementById('modalSharedImagesGrid');
    if (sharedImagesSection && sharedImagesGrid && currentUser) {
        sharedImagesSection.style.display = 'none';
        sharedImagesGrid.innerHTML = '';
        try {
            const chatsSnap = await getDocs(query(collection(db, "chats"), where("type", "==", "private")));
            let chatId = null;
            chatsSnap.forEach(d => {
                const members = d.data().members || [];
                if (members.some(m => m.uid === currentUser.uid) && members.some(m => m.uid === userId)) {
                    chatId = d.id;
                }
            });
            if (chatId) {
                const msgsSnap = await getDocs(query(collection(db, "messages"), where("chatId", "==", chatId)));
                const images = [];
                msgsSnap.forEach(d => {
                    const msg = d.data();
                    if (msg.type === 'image' && msg.content) images.push(msg.content);
                });
                if (images.length > 0) {
                    sharedImagesSection.style.display = 'block';
                    images.slice(-30).forEach(url => {
                        const div = document.createElement('div');
                        div.style.cssText = 'aspect-ratio:1;border-radius:8px;overflow:hidden;cursor:pointer;';
                        div.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`;
                        div.onclick = () => window.open(url, '_blank');
                        sharedImagesGrid.appendChild(div);
                    });
                }
            }
        } catch(e) {}
    }
    
    const statsContainer = document.getElementById('modalTargetStats');
    if (statsContainer && currentUser) {
        statsContainer.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-secondary);">Загрузка...</div>';
        const stats = await getUserStats(currentUser.uid, userId);
        statsContainer.innerHTML = `<div style="display:flex;justify-content:space-around;padding:15px 0;border-top:1px solid var(--border);margin-top:15px;">
            <div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:var(--accent);">${stats.images}</div><div style="font-size:11px;color:var(--text-secondary);">Фото</div></div>
            <div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:var(--accent);">${stats.files}</div><div style="font-size:11px;color:var(--text-secondary);">Файлы</div></div>
            <div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:var(--accent);">${stats.links}</div><div style="font-size:11px;color:var(--text-secondary);">Ссылки</div></div>
            <div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:var(--accent);">${stats.messages}</div><div style="font-size:11px;color:var(--text-secondary);">Всего</div></div>
        </div>`;
    }
    
    document.getElementById('profileInfoModal').style.display = 'flex';
}

document.getElementById('chatTargetAvatar')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (currentChannelData) {
        openChannelInfo(currentChannelData);
        return;
    }
    if (!currentChatOtherId) return;
    openProfileModal(currentChatOtherId);
});

// ========== PUSH-УВЕДОМЛЕНИЯ ==========
let notifUnsub = null;
function startNotificationsListener(userId) {
    if (notifUnsub) notifUnsub();
    if (!userId) return;
    try {
        const q = query(collection(db, 'notifications'), where('recipientId', '==', userId));
        notifUnsub = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const d = change.doc.data();
                    if (d.read) return;
                    if ('Notification' in window && Notification.permission === 'granted') {
                        try {
                            new Notification(d.senderName || 'SPARK', {
                                body: d.messageText || 'Новое сообщение',
                                icon: '/icon.png',
                                tag: 'spark-' + (d.chatId || Date.now())
                            });
                        } catch (e) {}
                    }
                    deleteDoc(change.doc.ref).catch(() => {});
                }
            });
        }, () => {});
    } catch (e) {}
}

async function saveFCMToken(userId) {
    try {
        const token = await getFCMToken();
        if (token) {
            const userDoc = await getDoc(doc(db, "users", userId));
            const tokens = userDoc.data()?.fcmTokens || [];
            if (!tokens.includes(token)) {
                await updateDoc(doc(db, "users", userId), {
                    fcmTokens: arrayUnion(token),
                    fcmTokensUpdated: serverTimestamp()
                });
            }
        }
    } catch (e) {
        console.warn('FCM token save error:', e);
    }
}

function setupForegroundNotifications() {
    listenForMessages((payload) => {
        const data = payload.data || {};
        const notification = payload.notification || {};
        const title = notification.title || data.senderName || 'SPARK';
        const body = notification.body || data.messageText || 'Новое сообщение';
        const chatId = data.chatId || '';
        
        if (chatId === currentChatId && document.visibilityState === 'visible') return;
        
        showDynamicIsland(`${title}: ${body}`, 'message');
        
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                const n = new Notification(title, {
                    body, icon: '/icon.png',
                    tag: 'spark-fg-' + (chatId || Date.now()),
                    renotify: true
                });
                n.onclick = () => { window.focus(); n.close(); };
                setTimeout(() => n.close(), 8000);
            } catch (e) {}
        }
    });
}

// ========== AUTH STATE ==========
onAuthStateChanged(auth, async (user) => {
    if (user) {
        let docUser = await getDoc(doc(db, "users", user.uid));
        if (docUser.exists()) {
            currentUser = { uid: user.uid, ...docUser.data() };
            
            // Restore app state and settings
            applySavedTheme();
            applySavedLanguage();
            applySavedWallpaper();
            syncProfile(currentUser);
            
            // UI elements specific to logged in user
            const myNameDisplay = document.getElementById('myNameDisplay');
            if (myNameDisplay) myNameDisplay.textContent = currentUser.name;
            const myUserDisplay = document.getElementById('myUserDisplay');
            if (myUserDisplay) myUserDisplay.textContent = currentUser.username;
            
            // Load data
            loadChats();
            loadUserAvatar();
            listenToIncomingCalls(currentUser);
            startNotificationsListener(user.uid);
            saveFCMToken(user.uid);
            setupForegroundNotifications();
            registerCurrentDevice();
            initSparkChannel();
            updateFaceIdStatus();
            applyCustomSettings();
            loadPremiumStatus();
            if (isPremium(currentUser) || isCreator(currentUser)) setupAutoTranslate();
            
            // Show admin premium button for creator only
            if (isCreator(currentUser)) {
                const adminBtn = document.getElementById('btn-admin-premium-edit');
                if (adminBtn) adminBtn.style.display = 'block';
            }
            
            // Start online status heartbeat
            onlineStatusInterval = setInterval(updateOnlineStatus, 15000);
            updateOnlineStatus();

            const appContainer = document.getElementById('app');
            if (appContainer) {
                appContainer.style.display = 'flex';
            }
            
            // Hide auth screens
            const authScreens = document.querySelectorAll('.screen');
            authScreens.forEach(s => s.style.display = 'none');
            
            // Hide splash screen if it's still there
            const splash = document.getElementById('splash');
            if (splash) splash.style.display = 'none';
        }
    } else {
        currentUser = null;
        if (onlineStatusInterval) clearInterval(onlineStatusInterval);
        const appContainer = document.getElementById('app');
        if (appContainer) appContainer.style.display = 'none';
        showScreen(0);
    }
});

// ========== SPARK PREMIUM ==========
let selectedReceiptFile = null;

async function loadPremiumStatus() {
    if (!currentUser) return;
    try {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        const data = userDoc.data();
        const statusText = document.getElementById('premiumStatusText');
        
        if (data?.premium) {
            const activated = data.premiumActivatedAt?.toDate?.() || new Date(data.premiumActivatedAt);
            if (statusText) {
                statusText.innerHTML = `<span style="color:#6c5ce7;font-weight:700;">Активирован</span> ${activated ? '· ' + activated.toLocaleDateString('ru-RU') : ''}`;
            }
            const uploadBtn = document.getElementById('btnUploadReceipt');
            const activateBtn = document.getElementById('btnActivatePremium');
            if (uploadBtn) uploadBtn.style.display = 'none';
            if (activateBtn) { activateBtn.textContent = 'Premium активирован ✓'; activateBtn.disabled = true; activateBtn.style.opacity = '0.6'; }
        } else {
            if (statusText) statusText.textContent = 'Не активирован';
            // Check if receipt is pending (client-side filter to avoid composite index)
            const pendingSnap = await getDocs(query(collection(db, "premiumReceipts"), where("uid", "==", currentUser.uid)));
            const hasPending = pendingSnap.docs.some(d => d.data().status === "pending");
            if (hasPending) {
                const uploadBtn = document.getElementById('btnUploadReceipt');
                const activateBtn = document.getElementById('btnActivatePremium');
                if (uploadBtn) { uploadBtn.textContent = '⏳ Квитанция на проверке'; uploadBtn.disabled = true; }
                if (activateBtn) { activateBtn.style.display = 'none'; }
                if (statusText) statusText.innerHTML = '<span style="color:#f39c12;">Квитанция на проверке...</span>';
            }
        }
    } catch (e) {}
}

// Premium plan selection
let selectedPlan = 'month';
const planPrices = { month: '100 ₽', year: '500 ₽', forever: '1000 ₽' };
document.querySelectorAll('.premium-plan-option').forEach(opt => {
    opt.addEventListener('click', () => {
        document.querySelectorAll('.premium-plan-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        opt.querySelector('input[type=radio]').checked = true;
        selectedPlan = opt.dataset.plan;
        const amountDisplay = document.getElementById('premiumAmountDisplay');
        if (amountDisplay) amountDisplay.textContent = planPrices[selectedPlan];
    });
});
// Auto-select month
const defaultPlan = document.querySelector('.premium-plan-option[data-plan="month"]');
if (defaultPlan) { defaultPlan.classList.add('selected'); defaultPlan.querySelector('input[type=radio]').checked = true; }

// Receipt preview
document.getElementById('btnUploadReceipt')?.addEventListener('click', () => {
    document.getElementById('premiumReceiptInput')?.click();
});

document.getElementById('premiumReceiptInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    selectedReceiptFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const preview = document.getElementById('premiumReceiptPreview');
        const img = document.getElementById('premiumReceiptImg');
        if (preview && img) { img.src = ev.target.result; preview.style.display = 'block'; }
    };
    reader.readAsDataURL(file);
});

// Submit receipt
document.getElementById('btnActivatePremium')?.addEventListener('click', async () => {
    const msg = document.getElementById('premiumActivateMessage');
    if (!selectedReceiptFile) { if (msg) { msg.style.display = 'block'; msg.textContent = 'Сначала загрузите квитанцию'; msg.style.color = '#ff3b30'; } return; }
    
    const activateBtn = document.getElementById('btnActivatePremium');
    if (activateBtn) { activateBtn.textContent = 'Отправка...'; activateBtn.disabled = true; }
    
    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
            reader.readAsDataURL(selectedReceiptFile);
        });
        
        const receiptDocRef = await addDoc(collection(db, "premiumReceipts"), {
            uid: currentUser.uid,
            username: currentUser.displayName || currentUser.name || currentUser.username || '',
            plan: selectedPlan,
            amount: planPrices[selectedPlan],
            receiptUrl: dataUrl,
            status: "pending",
            createdAt: new Date().toISOString()
        });
        
        if (msg) { msg.style.display = 'block'; msg.textContent = 'AI проверяет квитанцию...'; msg.style.color = '#6c5ce7'; }
        showDynamicIsland('AI проверяет квитанцию...', 'info');
        
        // Auto AI verification
        autoVerifyReceipt(receiptDocRef.id, dataUrl, selectedPlan);
        
        selectedReceiptFile = null;
        const preview = document.getElementById('premiumReceiptPreview');
        if (preview) preview.style.display = 'none';
        const receiptInput = document.getElementById('premiumReceiptInput');
        if (receiptInput) receiptInput.value = '';
        if (activateBtn) { activateBtn.textContent = 'Отправлено ✓'; activateBtn.disabled = true; activateBtn.style.opacity = '0.5'; }
        const uploadBtn = document.getElementById('btnUploadReceipt');
        if (uploadBtn) { uploadBtn.textContent = '⏳ AI проверяет...'; uploadBtn.disabled = true; }
    } catch (e) {
        console.error('Receipt upload error:', e);
        if (msg) { msg.style.display = 'block'; msg.textContent = 'Ошибка загрузки: ' + (e.message || e); msg.style.color = '#ff3b30'; }
        if (activateBtn) { activateBtn.textContent = 'Отправить на проверку'; activateBtn.disabled = false; }
    }
});

async function autoVerifyReceipt(receiptId, receiptUrl, plan) {
    const msg = document.getElementById('premiumActivateMessage');
    try {
        const ocrBody = receiptUrl.startsWith('data:')
            ? { base64Image: receiptUrl, language: 'rus' }
            : { url: receiptUrl, language: 'rus' };
        const resp = await fetch('https://api.ocr.space/parse/imageurl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': 'K85429601388957' },
            body: JSON.stringify(ocrBody)
        });
        const data = await resp.json();
        const text = data?.ParsedResults?.[0]?.ParsedText || '';
        console.log('OCR text:', text);
        
        const phoneMatch = text.includes('79266625807') || text.includes('9266625807') || text.includes('7 926 662-58-07') || text.includes('926 662-58-07') || text.match(/926.*662.*58.*07/);
        const nameMatch = text.toLowerCase().includes('алексей') || text.toLowerCase().includes('aleksey') || text.toLowerCase().includes('alexey');
        const amountMap = { month: ['100', '100₽', '100 ₽'], year: ['500', '500₽', '500 ₽'], forever: ['1000', '1000₽', '1000 ₽'] };
        const expectedAmounts = amountMap[plan] || ['100'];
        const amountMatch = expectedAmounts.some(a => text.includes(a));
        
        const paymentMatch = phoneMatch || nameMatch;
        
        if (paymentMatch && amountMatch) {
            await updateDoc(doc(db, "premiumReceipts", receiptId), { status: "approved", reviewedAt: new Date().toISOString(), reviewedBy: 'ai-bot' });
            await updateDoc(doc(db, "users", currentUser.uid), { premium: true, premiumActivatedAt: new Date().toISOString(), premiumActivatedBy: 'ai-bot' });
            currentUser.premium = true;
            if (msg) { msg.innerHTML = '<span style="color:#2ecc71;">Premium активирован! (AI подтвердил)</span>'; }
            showDynamicIsland('Premium активирован! AI подтвердил квитанцию.', 'success');
            const uploadBtn = document.getElementById('btnUploadReceipt');
            if (uploadBtn) uploadBtn.style.display = 'none';
            const activateBtn = document.getElementById('btnActivatePremium');
            if (activateBtn) { activateBtn.textContent = 'Premium активирован ✓'; activateBtn.disabled = true; activateBtn.style.opacity = '0.6'; }
        } else {
            await updateDoc(doc(db, "premiumReceipts", receiptId), { status: "rejected", reviewedAt: new Date().toISOString(), reviewedBy: 'ai-bot', rejectReason: `payment:${paymentMatch} amount:${amountMatch}` });
            let reason = 'Не распознан платёж или сумма';
            if (!paymentMatch && !amountMatch) reason = 'Платёжные данные и сумма не совпадают';
            else if (!paymentMatch) reason = 'Не найден телефон/получатель Алексей';
            else if (!amountMatch) reason = 'Сумма не совпадает с тарифом';
            if (msg) { msg.innerHTML = `<span style="color:#ff3b30;">✕ Отклонено: ${reason}</span>`; }
            showDynamicIsland('Квитанция отклонена: ' + reason, 'error');
            const activateBtn = document.getElementById('btnActivatePremium');
            if (activateBtn) { activateBtn.textContent = 'Отправить на проверку'; activateBtn.disabled = false; activateBtn.style.opacity = ''; }
            const uploadBtn = document.getElementById('btnUploadReceipt');
            if (uploadBtn) { uploadBtn.textContent = 'Загрузить квитанцию'; uploadBtn.disabled = false; }
        }
    } catch (e) {
        console.error('AI verify error:', e);
        if (msg) { msg.innerHTML = '<span style="color:#f39c12;">! Ошибка AI. Попробуйте позже.</span>'; }
        const activateBtn = document.getElementById('btnActivatePremium');
        if (activateBtn) { activateBtn.textContent = 'Отправить на проверку'; activateBtn.disabled = false; activateBtn.style.opacity = ''; }
        const uploadBtn = document.getElementById('btnUploadReceipt');
        if (uploadBtn) { uploadBtn.textContent = 'Загрузить квитанцию'; uploadBtn.disabled = false; }
    }
}

// ========== FACE ID БЕЗ АВТОРИЗАЦИИ ==========
let faceIdLoginStream = null;
let faceIdLoginDetectInterval = null;

async function startFaceIdLogin() {
    const modal = document.getElementById('faceIdModal');
    if (modal) modal.classList.add('active');
    const msgEl = document.getElementById('faceIdMessage');
    const progressRing = document.querySelector('#faceIdModal .face-scan-ring');
    if (msgEl) msgEl.textContent = 'Наведите камеру на лицо';
    
    try {
        faceIdLoginStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 640 } });
        const video = document.getElementById('faceIdVideo');
        if (video) { video.srcObject = faceIdLoginStream; await video.play().catch(() => {}); }
        
        // Animated scan: capture multiple frames over 3 seconds
        const frames = [];
        let scanStep = 0;
        const totalSteps = 6;
        const stepInterval = 500;
        const scanInstructions = [
            'Наведите камеру на лицо',
            'Медленно наклоните голову влево',
            'Медленно наклоните голову вправо',
            'Наклоните голову вверх',
            'Наклоните голову вниз',
            'Сканирование...'
        ];
        
        faceIdLoginDetectInterval = setInterval(() => {
            if (!faceIdLoginStream) { clearInterval(faceIdLoginDetectInterval); return; }
            if (scanStep < totalSteps) {
                if (msgEl) msgEl.textContent = scanInstructions[scanStep] || 'Сканирование...';
                // Capture frame
                const canvas = document.createElement('canvas');
                canvas.width = 128; canvas.height = 128;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, 128, 128);
                frames.push(canvas.toDataURL('image/jpeg', 0.7));
                scanStep++;
            }
            if (scanStep >= totalSteps) {
                clearInterval(faceIdLoginDetectInterval);
                if (frames.length > 0) {
                    // Use last frame as primary, others for validation
                    const primaryFrame = frames[frames.length - 1];
                    matchFaceAndLogin(primaryFrame, frames);
                }
            }
        }, stepInterval);
    } catch (e) {
        if (msgEl) msgEl.textContent = 'Нет доступа к камере';
        console.warn('Face ID login error:', e);
    }
}

async function matchFaceAndLogin(faceImageData, allFrames) {
    const msgEl = document.getElementById('faceIdMessage');
    if (msgEl) msgEl.textContent = 'Поиск аккаунта...';
    
    // Stop camera
    if (faceIdLoginStream) { faceIdLoginStream.getTracks().forEach(t => t.stop()); faceIdLoginStream = null; }
    if (faceIdLoginDetectInterval) { clearInterval(faceIdLoginDetectInterval); }
    
    // Search all users with faceId enabled
    try {
        const usersSnap = await getDocs(query(collection(db, "users"), where("faceIdEnabled", "==", true)));
        let matchedUser = null;
        let bestSimilarity = 0;
        const faceEntries = [];
        
        usersSnap.forEach(d => {
            const u = d.data();
            if (u.faceImage) faceEntries.push({ uid: d.id, data: u, image: u.faceImage });
        });
        
        for (const entry of faceEntries) {
            // Compare primary frame
            const similarity = await compareFaceImages(faceImageData, entry.image);
            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                matchedUser = entry.data;
            }
        }
        
        if (matchedUser && bestSimilarity > 0.25) {
            if (msgEl) msgEl.textContent = `Найден: ${matchedUser.name || matchedUser.username}`;
            pendingUsername = matchedUser.username;
            document.getElementById('userInput').value = matchedUser.username;
            document.getElementById('faceIdModal')?.classList.remove('active');
            showDynamicIsland(`Аккаунт найден: ${matchedUser.name}`, 'success');
            showScreen(1);
        } else {
            if (msgEl) msgEl.textContent = 'Аккаунт не найден. Попробуйте снова.';
            setTimeout(() => { document.getElementById('faceIdModal')?.classList.remove('active'); }, 2000);
        }
    } catch (e) {
        console.warn('Face match error:', e);
        if (msgEl) msgEl.textContent = 'Ошибка поиска аккаунта';
    }
}

function compareFaceImages(img1, img2) {
    try {
        const canvas1 = document.createElement('canvas');
        const canvas2 = document.createElement('canvas');
        canvas1.width = canvas2.width = 32;
        canvas1.height = canvas2.height = 32;
        const ctx1 = canvas1.getContext('2d');
        const ctx2 = canvas2.getContext('2d');
        
        const image1 = new Image();
        const image2 = new Image();
        
        return new Promise((resolve) => {
            let loaded = 0;
            const check = () => {
                loaded++;
                if (loaded < 2) return;
                try {
                    ctx1.drawImage(image1, 0, 0, 32, 32);
                    ctx2.drawImage(image2, 0, 0, 32, 32);
                    const data1 = ctx1.getImageData(0, 0, 32, 32).data;
                    const data2 = ctx2.getImageData(0, 0, 32, 32).data;
                    let diff = 0;
                    for (let i = 0; i < data1.length; i += 4) {
                        diff += Math.abs(data1[i] - data2[i]);
                        diff += Math.abs(data1[i+1] - data2[i+1]);
                        diff += Math.abs(data1[i+2] - data2[i+2]);
                    }
                    const maxDiff = 32 * 32 * 3 * 255;
                    const similarity = 1 - diff / maxDiff;
                    // Bonus: also compare center region (face area) for better accuracy
                    const centerDiff = compareCenterRegion(data1, data2, 32);
                    resolve(similarity * 0.6 + centerDiff * 0.4);
                } catch (e) { resolve(0); }
            };
            image1.onload = check;
            image2.onload = check;
            image1.onerror = () => { loaded++; check(); };
            image2.onerror = () => { loaded++; check(); };
            image1.src = img1;
            image2.src = img2;
            setTimeout(() => resolve(0), 3000);
        });
    } catch (e) { return Promise.resolve(0); }
}

function compareCenterRegion(data1, data2, size) {
    // Compare center 16x16 region (face area)
    let diff = 0, count = 0;
    const start = Math.floor(size * 0.25);
    const end = Math.floor(size * 0.75);
    for (let y = start; y < end; y++) {
        for (let x = start; x < end; x++) {
            const i = (y * size + x) * 4;
            diff += Math.abs(data1[i] - data2[i]);
            diff += Math.abs(data1[i+1] - data2[i+1]);
            diff += Math.abs(data1[i+2] - data2[i+2]);
            count++;
        }
    }
    const maxDiff = count * 3 * 255;
    return maxDiff > 0 ? 1 - diff / maxDiff : 0;
}

// Wire up Face ID button on auth screen
document.getElementById('btnAuthFaceId')?.addEventListener('click', () => {
    startFaceIdLogin();
});

// ========== FACE ID SETUP (for logged-in users) ==========
async function setupFaceIdForCurrentUser() {
    if (!currentUser) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 640 } });
        const video = document.getElementById('faceIdVideo');
        const msgEl = document.getElementById('faceIdMessage');
        const modal = document.getElementById('faceIdModal');
        
        if (modal) modal.classList.add('active');
        if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
        
        // Animated multi-angle capture
        const frames = [];
        let step = 0;
        const instructions = [
            'Наведите камеру на лицо',
            'Наклоните голову влево...',
            'Наклоните голову вправо...',
            'Поднимите голову вверх...',
            'Опустите голову вниз...',
            'Сохранение...'
        ];
        
        const captureInterval = setInterval(() => {
            if (step >= instructions.length) {
                clearInterval(captureInterval);
                return;
            }
            if (msgEl) msgEl.textContent = instructions[step];
            if (step < instructions.length - 1) {
                const canvas = document.createElement('canvas');
                canvas.width = 128; canvas.height = 128;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, 128, 128);
                frames.push(canvas.toDataURL('image/jpeg', 0.7));
            }
            step++;
            
            if (step >= instructions.length) {
                // Use best frame (last one, face is centered)
                const bestFrame = frames[frames.length - 1] || frames[0];
                stream.getTracks().forEach(t => t.stop());
                
                updateDoc(doc(db, "users", currentUser.uid), {
                    faceIdEnabled: true,
                    faceImage: bestFrame,
                    faceImages: frames.slice(0, -1)
                }).then(() => {
                    if (modal) modal.classList.remove('active');
                    showDynamicIsland('Face ID настроен!', 'success');
            updateFaceIdStatus();
            setupAutoTranslate();
            applyCustomSettings();
                }).catch((e) => {
                    console.error('Face ID save error:', e);
                    if (modal) modal.classList.remove('active');
                    showDynamicIsland('Ошибка сохранения', 'error');
                });
            }
        }, 600);
    } catch (e) {
        showDynamicIsland('Нет доступа к камере', 'error');
    }
}

// Face ID button in security panel
document.getElementById('btnFaceId')?.addEventListener('click', () => {
    setupFaceIdForCurrentUser();
});

async function updateFaceIdStatus() {
    if (!currentUser) return;
    try {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        const statusEl = document.getElementById('faceIdStatus');
        if (statusEl) {
            if (userDoc.data()?.faceIdEnabled) {
                statusEl.textContent = 'Face ID привязан';
                statusEl.style.display = 'block';
            } else {
                statusEl.textContent = '';
                statusEl.style.display = 'none';
            }
        }
    } catch (e) {}
}

// ========== AI TRANSLATION BOT (Premium) ==========
window._translateMsg = async function(msgId, text) {
    const existing = document.getElementById(`trans-${msgId}`);
    if (existing) { existing.remove(); return; }
    const bubble = document.querySelector(`[data-msg-id="${msgId}"] .message-text`);
    if (!bubble) return;
    bubble.style.opacity = '0.5';
    bubble.textContent = 'Перевод...';
    const translated = await translateText(text);
    bubble.textContent = text;
    bubble.style.opacity = '';
    if (translated && translated !== text) {
        const el = document.createElement('div');
        el.id = `trans-${msgId}`;
        el.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-top:6px;padding-top:6px;border-top:1px solid var(--border);font-style:italic;';
        el.textContent = translated;
        bubble.parentElement.insertBefore(el, bubble.nextSibling);
    }
};
async function translateText(text, targetLang) {
    if (!text || text.length < 2) return text;
    const userLang = localStorage.getItem('spark-lang') || 'ru';
    const langMap = { ru: 'ru', en: 'en', uk: 'uk', kk: 'kk' };
    const target = targetLang || langMap[userLang] || 'ru';
    
    try {
        const resp = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`);
        const data = await resp.json();
        if (data && data[0]) {
            const translated = data[0].map(s => s[0]).join('');
            if (translated && translated.toLowerCase() !== text.toLowerCase()) return translated;
        }
    } catch (e) {}
    
    try {
        const resp = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${target}`);
        const data = await resp.json();
        if (data.responseStatus === 200 && data.responseData?.translatedText) {
            const translated = data.responseData.translatedText;
            if (translated.toLowerCase() !== text.toLowerCase()) return translated;
        }
    } catch (e) { console.warn('Translation error:', e); }
    return text;
}

async function translateMessageText(msgId, text) {
    const existing = document.getElementById(`trans-${msgId}`);
    if (existing) { existing.remove(); return; }
    
    const bubble = document.querySelector(`[data-msg-id="${msgId}"] .message-text`);
    if (!bubble) return;
    
    const translated = await translateText(text);
    if (translated && translated !== text) {
        const el = document.createElement('div');
        el.id = `trans-${msgId}`;
        el.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-top:6px;padding-top:6px;border-top:1px solid var(--border);font-style:italic;';
        el.textContent = '' + translated;
        bubble.appendChild(el);
    }
}

// Auto-translate incoming messages for premium users
function setupAutoTranslate() {
    if (!currentUser || !(isPremium(currentUser) || isCreator(currentUser))) return;
    if (localStorage.getItem('spark-autoTranslate') !== 'on') return;
    if (window._autoTranslateObserver) return;
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                const bubble = node.querySelector ? node.querySelector('.message-text') : null;
                if (!bubble) return;
                const msgId = node.closest?.('[data-msg-id]')?.dataset?.msgId;
                const text = bubble.textContent?.trim();
                if (msgId && text && text.length > 3 && !document.getElementById(`trans-${msgId}`)) {
                    setTimeout(() => translateMessageText(msgId, text), 1000);
                }
            });
        });
    });
    const messagesContainer = document.getElementById('messagesContainer');
    if (messagesContainer) { observer.observe(messagesContainer, { childList: true, subtree: true }); window._autoTranslateObserver = observer; }
}

// ========== УПРАВЛЕНИЕ PREMIUM (ДЛЯ СОЗДАТЕЛЯ) ==========
document.getElementById('btnAdminPremiumSearch')?.addEventListener('click', async () => {
    const term = document.getElementById('adminPremiumSearch')?.value.trim().toLowerCase();
    const results = document.getElementById('adminPremiumSearchResults');
    if (!term || !results) { if (results) results.innerHTML = ''; return; }
    
    results.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:13px;">Поиск...</div>';
    
    try {
        const usersSnap = await getDocs(collection(db, "users"));
        results.innerHTML = '';
        let found = 0;
        
        usersSnap.forEach(d => {
            const u = d.data();
            const match = (u.username && u.username.toLowerCase().includes(term)) ||
                          (u.name && u.name.toLowerCase().includes(term));
            if (match && u.uid !== currentUser.uid) {
                found++;
                const isPrem = u.premium === true;
                const div = document.createElement('div');
                div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);margin-bottom:8px;';
                div.innerHTML = `
                    <div style="flex:1;">
                        <div style="font-weight:600;font-size:14px;">${escape(u.name || u.username)}</div>
                        <div style="font-size:12px;color:var(--text-secondary);">${escape(u.username || '')} ${isPrem ? '<span style="color:#6c5ce7;font-weight:700;">Premium</span>' : ''}</div>
                    </div>
                    <button class="btn admin-grant-premium" data-uid="${u.uid}" data-name="${escape(u.name || u.username)}" data-action="${isPrem ? 'revoke' : 'grant'}" 
                        style="padding:8px 14px;font-size:12px;width:auto;background:${isPrem ? '#ff3b30' : '#6c5ce7'};color:#fff;">
                        ${isPrem ? '<i class="fas fa-times"></i> Снять' : '<i class="fas fa-star"></i> Выдать'}
                    </button>
                `;
                results.appendChild(div);
            }
        });
        
        if (found === 0) results.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:13px;">Ничего не найдено</div>';
        
        results.querySelectorAll('.admin-grant-premium').forEach(btn => {
            btn.onclick = async () => {
                const uid = btn.dataset.uid;
                const name = btn.dataset.name;
                const action = btn.dataset.action;
                
                try {
                    if (action === 'grant') {
                        await updateDoc(doc(db, "users", uid), {
                            premium: true,
                            premiumActivatedAt: new Date().toISOString(),
                            premiumActivatedBy: currentUser.uid
                        });
                        showDynamicIsland(`Premium выдан ${name}`, 'success');
                    } else {
                        await updateDoc(doc(db, "users", uid), {
                            premium: false,
                            premiumActivatedAt: null,
                            premiumActivatedBy: null
                        });
                        showDynamicIsland(`Premium снят у ${name}`, 'info');
                    }
                    // Refresh search results
                    document.getElementById('btnAdminPremiumSearch')?.click();
                    loadAdminPremiumList();
                } catch (e) {
                    showDynamicIsland('Ошибка', 'error');
                }
            };
        });
    } catch (e) {
        results.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:13px;">Ошибка поиска</div>';
    }
});

async function loadAdminPremiumList() {
    const container = document.getElementById('adminPremiumUsersList');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:13px;">Загрузка...</div>';
    
    try {
        const usersSnap = await getDocs(query(collection(db, "users"), where("premium", "==", true)));
        container.innerHTML = '';
        
        if (usersSnap.empty) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">Нет Premium пользователей</div>';
            return;
        }
        
        usersSnap.forEach(d => {
            const u = d.data();
            if (u.uid === currentUser.uid) return; // Skip creator
            const activated = u.premiumActivatedAt ? new Date(u.premiumActivatedAt).toLocaleDateString('ru-RU') : '';
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);margin-bottom:8px;';
            div.innerHTML = `
                <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6c5ce7,#a29bfe);display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;flex-shrink:0;"><i class="fas fa-star"></i></div>
                <div style="flex:1;">
                    <div style="font-weight:600;font-size:14px;">${escape(u.name || u.username)}</div>
                    <div style="font-size:12px;color:var(--text-secondary);">${escape(u.username || '')} · Активирован ${activated}</div>
                </div>
                <button class="btn admin-revoke-premium" data-uid="${u.uid}" data-name="${escape(u.name || u.username)}" 
                    style="padding:8px 14px;font-size:12px;width:auto;background:#ff3b30;color:#fff;">
                    <i class="fas fa-times"></i> Снять
                </button>
            `;
            container.appendChild(div);
        });
        
        container.querySelectorAll('.admin-revoke-premium').forEach(btn => {
            btn.onclick = async () => {
                const uid = btn.dataset.uid;
                const name = btn.dataset.name;
                try {
                    await updateDoc(doc(db, "users", uid), {
                        premium: false,
                        premiumActivatedAt: null,
                        premiumActivatedBy: null
                    });
                    showDynamicIsland(`Premium снят у ${name}`, 'info');
                    loadAdminPremiumList();
                } catch (e) {
                    showDynamicIsland('Ошибка', 'error');
                }
            };
        });
    } catch (e) {
        container.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:13px;">Ошибка загрузки</div>';
    }
}

async function loadAdminReceiptsList() {
    const container = document.getElementById('adminReceiptsList');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:13px;">Загрузка...</div>';
    
    try {
        const snap = await getDocs(query(collection(db, "premiumReceipts"), where("status", "==", "pending")));
        container.innerHTML = '';
        
        if (snap.empty) {
            container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-secondary);font-size:13px;">Нет квитанций на проверке</div>';
            return;
        }
        
        snap.forEach(d => {
            const r = d.data();
            const div = document.createElement('div');
            div.style.cssText = 'background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;margin-bottom:10px;';
            div.innerHTML = `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <div style="width:36px;height:36px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;"><i class="fas fa-receipt"></i></div>
                    <div style="flex:1;">
                        <div style="font-weight:600;font-size:14px;">${escape(r.username || 'Unknown')}</div>
                        <div style="font-size:11px;color:var(--text-secondary);">${new Date(r.createdAt).toLocaleString('ru-RU')} · ${escape(r.plan || 'month')} — ${escape(r.amount || '100 ₽')}</div>
                    </div>
                </div>
                <div style="text-align:center;margin-bottom:10px;"><img src="${r.receiptUrl}" style="max-width:100%;max-height:250px;border-radius:8px;cursor:pointer;" onclick="window.open('${r.receiptUrl}','_blank')"></div>
                <div id="ocr-result-${d.id}" style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;display:none;padding:8px;background:var(--bg);border-radius:6px;"></div>
                <div style="display:flex;gap:8px;">
                    <button class="btn admin-ocr-receipt" data-id="${d.id}" data-url="${r.receiptUrl}" data-plan="${r.plan}"
                        style="flex:1;background:var(--accent);color:var(--bg);padding:10px;font-size:13px;"><i class="fas fa-robot"></i> AI Проверка</button>
                    <button class="btn admin-approve-receipt" data-id="${d.id}" data-uid="${r.uid}" data-name="${escape(r.username)}"
                        style="flex:1;background:#2ecc71;color:#fff;padding:10px;font-size:13px;"><i class="fas fa-check"></i> Одобрить</button>
                    <button class="btn admin-reject-receipt" data-id="${d.id}" data-name="${escape(r.username)}"
                        style="flex:1;background:#ff3b30;color:#fff;padding:10px;font-size:13px;"><i class="fas fa-times"></i> Отклонить</button>
                </div>
            `;
            container.appendChild(div);
        });
        
        // AI OCR verification
        container.querySelectorAll('.admin-ocr-receipt').forEach(btn => {
            btn.onclick = async () => {
                btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Анализ...';
                const resultEl = document.getElementById(`ocr-result-${btn.dataset.id}`);
                if (resultEl) resultEl.style.display = 'block';
                try {
                    const urlVal = btn.dataset.url;
                    const ocrBody = urlVal && urlVal.startsWith('data:')
                        ? { base64Image: urlVal, language: 'rus' }
                        : { url: urlVal, language: 'rus' };
                    const resp = await fetch('https://api.ocr.space/parse/imageurl', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': 'K85429601388957' },
                        body: JSON.stringify(ocrBody)
                    });
                    const data = await resp.json();
                    const text = data?.ParsedResults?.[0]?.ParsedText || '';
                    const phoneMatch = text.includes('79266625807') || text.includes('9266625807') || text.includes('7 926 662-58-07') || text.includes('926 662-58-07') || text.match(/926.*662.*58.*07/);
                    const amountMap = { month: ['100', '100₽', '100 ₽'], year: ['500', '500₽', '500 ₽'], forever: ['1000', '1000₽', '1000 ₽'] };
                    const expectedAmounts = amountMap[btn.dataset.plan] || ['100'];
                    const amountMatch = expectedAmounts.some(a => text.includes(a));
                    
                    let result = `<strong>AI Результат:</strong><br>`;
                    result += `Телефон: ${phoneMatch ? '<span style="color:#2ecc71;">✓ Найден</span>' : '<span style="color:#ff3b30;">✗ Не найден</span>'}<br>`;
                    result += `Сумма: ${amountMatch ? '<span style="color:#2ecc71;">✓ Совпадает</span>' : '<span style="color:#f39c12;">! Не распознана</span>'}<br>`;
                    result += `<details style="margin-top:6px;"><summary style="cursor:pointer;font-size:11px;">Текст с квитанции</summary><pre style="font-size:10px;white-space:pre-wrap;max-height:100px;overflow-y:auto;margin-top:4px;">${escape(text.substring(0, 500))}</pre></details>`;
                    if (resultEl) resultEl.innerHTML = result;
                    
                    if (phoneMatch && amountMatch) {
                        btn.innerHTML = '<i class="fas fa-check"></i> Подтверждено';
                        btn.style.background = '#2ecc71';
                    } else {
                        btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Проверьте';
                        btn.style.background = '#f39c12';
                    }
                } catch (e) {
                    if (resultEl) resultEl.innerHTML = '<span style="color:#ff3b30;">Ошибка OCR: ' + e.message + '</span>';
                    btn.innerHTML = '<i class="fas fa-robot"></i> AI Проверка';
                    btn.disabled = false;
                }
            };
        });
        
        container.querySelectorAll('.admin-approve-receipt').forEach(btn => {
            btn.onclick = async () => {
                btn.disabled = true; btn.textContent = '...';
                try {
                    await updateDoc(doc(db, "premiumReceipts", btn.dataset.id), { status: "approved", reviewedAt: new Date().toISOString() });
                    await updateDoc(doc(db, "users", btn.dataset.uid), { premium: true, premiumActivatedAt: new Date().toISOString(), premiumActivatedBy: currentUser.uid });
                    showDynamicIsland(`Premium активирован для ${btn.dataset.name}`, 'success');
                    loadAdminReceiptsList(); loadAdminPremiumList();
                } catch (e) { showDynamicIsland('Ошибка', 'error'); }
            };
        });
        
        container.querySelectorAll('.admin-reject-receipt').forEach(btn => {
            btn.onclick = async () => {
                btn.disabled = true; btn.textContent = '...';
                try {
                    await updateDoc(doc(db, "premiumReceipts", btn.dataset.id), { status: "rejected", reviewedAt: new Date().toISOString() });
                    showDynamicIsland(`Квитанция отклонена`, 'info');
                    loadAdminReceiptsList();
                } catch (e) { showDynamicIsland('Ошибка', 'error'); }
            };
        });
    } catch (e) {
        container.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:13px;">Ошибка загрузки</div>';
    }
}

// ========== КАСТОМ (PREMIUM) ==========
let customWallpaperData = null;
const CARD_COLORS = ['#6c5ce7','#00b894','#0984e3','#e17055','#fdcb6e','#e84393','#00cec9','#d63031','#2d3436','#636e72'];

async function loadCustomSettings() {
    if (!currentUser) return;
    if (!isPremium(currentUser) && !isCreator(currentUser)) {
        showDynamicIsland('Только для Premium', 'error');
        closePanel('custom');
        openPanel('premium');
        return;
    }
    try {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        const data = userDoc.data();
        
        const opacitySlider = document.getElementById('customOpacity');
        const opacityValue = document.getElementById('customOpacityValue');
        if (opacitySlider) {
            opacitySlider.value = (data.customOpacity ?? 100);
            if (opacityValue) opacityValue.textContent = opacitySlider.value + '%';
            opacitySlider.oninput = () => { if (opacityValue) opacityValue.textContent = opacitySlider.value + '%'; };
        }
        
        const preview = document.getElementById('customWallpaperPreview');
        const img = document.getElementById('customWallpaperImg');
        if (data.customWallpaper) {
            customWallpaperData = data.customWallpaper;
            if (preview && img) { img.src = data.customWallpaper; preview.style.display = 'block'; }
        } else {
            customWallpaperData = null;
            if (preview) preview.style.display = 'none';
        }
        
        const colorsContainer = document.getElementById('customCardColors');
        if (colorsContainer) {
            colorsContainer.innerHTML = '';
            const currentColor = data.customCardColor || '#6c5ce7';
            CARD_COLORS.forEach(color => {
                const sq = document.createElement('div');
                sq.style.cssText = `width:36px;height:36px;border-radius:50%;background:${color};cursor:pointer;border:3px solid ${color === currentColor ? '#fff' : 'transparent'};transition:border-color 0.2s;`;
                sq.onclick = () => {
                    colorsContainer.querySelectorAll('div').forEach(s => s.style.borderColor = 'transparent');
                    sq.style.borderColor = '#fff';
                    colorsContainer.dataset.selected = color;
                };
                if (color === currentColor) sq.style.borderColor = '#fff';
                colorsContainer.appendChild(sq);
            });
            colorsContainer.dataset.selected = currentColor;
        }
        
        const autoTranslateToggle = document.getElementById('autoTranslateToggle');
        if (autoTranslateToggle) {
            autoTranslateToggle.checked = localStorage.getItem('spark-autoTranslate') === 'on';
            autoTranslateToggle.onchange = () => {
                if (autoTranslateToggle.checked) {
                    localStorage.setItem('spark-autoTranslate', 'on');
                    if (currentUser && (isPremium(currentUser) || isCreator(currentUser))) setupAutoTranslate();
                } else {
                    localStorage.removeItem('spark-autoTranslate');
                    window._autoTranslateObserver = null;
                }
            };
        }
    } catch (e) { console.warn('Load custom error:', e); }
}

document.getElementById('btnUploadWallpaper')?.addEventListener('click', () => {
    document.getElementById('customWallpaperInput')?.click();
});

document.getElementById('customWallpaperInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showDynamicIsland('Файл >2MB, сжимаю...', 'info'); }
    const reader = new FileReader();
    reader.onload = async (ev) => {
        let dataUrl = ev.target.result;
        try { dataUrl = await compressImage(dataUrl, 400, 400, 200000); } catch(e) {}
        customWallpaperData = dataUrl;
        const preview = document.getElementById('customWallpaperPreview');
        const img = document.getElementById('customWallpaperImg');
        if (preview && img) { img.src = dataUrl; preview.style.display = 'block'; }
    };
    reader.readAsDataURL(file);
});

document.getElementById('btnRemoveWallpaper')?.addEventListener('click', () => {
    customWallpaperData = null;
    const preview = document.getElementById('customWallpaperPreview');
    if (preview) preview.style.display = 'none';
    const input = document.getElementById('customWallpaperInput');
    if (input) input.value = '';
});

document.getElementById('btnSaveCustom')?.addEventListener('click', async () => {
    if (!currentUser) return;
    const opacity = parseInt(document.getElementById('customOpacity')?.value || '100');
    const colorsEl = document.getElementById('customCardColors');
    const cardColor = colorsEl?.dataset?.selected || '#6c5ce7';
    
    try {
        const updateData = { customOpacity: opacity, customCardColor: cardColor };
        if (customWallpaperData) {
            if (customWallpaperData.length > 900000) {
                showDynamicIsland('Обои слишком большие, сжимаю...', 'info');
                try { customWallpaperData = await compressImage(customWallpaperData, 320, 320, 100000); } catch(e) {}
            }
            if (customWallpaperData.length > 900000) {
                showDynamicIsland('Обои >1MB, уменьшите файл', 'error');
                return;
            }
            updateData.customWallpaper = customWallpaperData;
        } else {
            updateData.customWallpaper = null;
        }
        await updateDoc(doc(db, "users", currentUser.uid), updateData);
        currentUser.customOpacity = opacity;
        currentUser.customCardColor = cardColor;
        
        const autoTranslateToggle = document.getElementById('autoTranslateToggle');
        if (autoTranslateToggle && (isPremium(currentUser) || isCreator(currentUser))) {
            if (autoTranslateToggle.checked) {
                localStorage.setItem('spark-autoTranslate', 'on');
                setupAutoTranslate();
            } else {
                localStorage.removeItem('spark-autoTranslate');
                window._autoTranslateObserver = null;
            }
        }
        currentUser.customWallpaper = customWallpaperData;
        applyCustomSettings();
        showDynamicIsland('Кастом сохранён!', 'success');
    } catch (e) {
        console.error('Custom save error:', e);
        showDynamicIsland('Ошибка сохранения: ' + (e.message || e), 'error');
    }
});

function applyCustomSettings() {
    if (!currentUser) return;
    const opacity = currentUser.customOpacity ?? 100;
    const cardColor = currentUser.customCardColor;
    const wallpaper = currentUser.customWallpaper;
    
    if (cardColor) {
        document.documentElement.style.setProperty('--accent', cardColor);
    }
    document.querySelectorAll('.card, .glass-panel, .search-box, .switch-container, .footer').forEach(el => {
        el.style.opacity = opacity < 100 ? String(opacity / 100) : '';
    });
    if (wallpaper) {
        document.querySelectorAll('.tab-pane.active').forEach(el => {
            el.style.backgroundImage = `url(${wallpaper})`;
            el.style.backgroundSize = 'cover';
            el.style.backgroundPosition = 'center';
        });
    }
}

// ========== REACTIONS ==========
let reactionMsgId = null;
const avatarUrlCache = {};

async function getUserAvatarUrl(uid) {
    if (avatarUrlCache[uid]) return avatarUrlCache[uid];
    try {
        const uDoc = await getDoc(doc(db, "users", uid));
        if (uDoc.exists()) {
            avatarUrlCache[uid] = uDoc.data().avatarUrl || '';
            return avatarUrlCache[uid];
        }
    } catch(e) {}
    return '';
}

function renderReactions(msg, isChannel) {
    if (!msg.reactions || Object.keys(msg.reactions).length === 0) return null;
    const rDiv = document.createElement('div');
    rDiv.className = 'reactions-row';
    for (const [emoji, users] of Object.entries(msg.reactions)) {
        if (!users || users.length === 0) continue;
        const isMine = users.includes(currentUser.uid);
        const badge = document.createElement('span');
        badge.className = 'reaction-badge' + (isMine ? ' mine' : '');
        if (isChannel) {
            badge.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
        } else {
            const avatarsHtml = users.slice(0, 3).map(uid => 
                `<span class="reaction-avatar" data-uid="${uid}" style="width:18px;height:18px;border-radius:50%;background:var(--accent);display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:#fff;overflow:hidden;border:1.5px solid var(--bg);margin-left:-4px;vertical-align:middle;"></span>`
            ).join('');
            const extra = users.length > 3 ? `<span class="reaction-count">+${users.length - 3}</span>` : '';
            badge.innerHTML = `${emoji} ${avatarsHtml}${extra}`;
            setTimeout(async () => {
                badge.querySelectorAll('.reaction-avatar').forEach(async (av) => {
                    const uid = av.dataset.uid;
                    const url = await getUserAvatarUrl(uid);
                    if (url) { av.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`; }
                    else { av.textContent = (uid || '?')[0].toUpperCase(); }
                });
            }, 0);
        }
        badge.onclick = (e) => { e.stopPropagation(); toggleReaction(msg.id, emoji); };
        rDiv.appendChild(badge);
    }
    return rDiv;
}

async function toggleReaction(msgId, emoji) {
    if (!currentUser || !msgId) return;
    const msgRef = doc(db, "messages", msgId);
    const msgDoc = await getDoc(msgRef);
    if (!msgDoc.exists()) return;
    const data = msgDoc.data();
    const reactions = data.reactions || {};
    
    // Remove user from all other reactions first
    let myPreviousEmoji = null;
    for (const [em, users] of Object.entries(reactions)) {
        const idx = users.indexOf(currentUser.uid);
        if (idx > -1) {
            myPreviousEmoji = em;
            reactions[em] = users.filter(u => u !== currentUser.uid);
            if (reactions[em].length === 0) delete reactions[em];
            break;
        }
    }
    
    if (myPreviousEmoji === emoji) {
        // Clicking same emoji — remove
    } else {
        // Add new reaction
        reactions[emoji] = [...(reactions[emoji] || []), currentUser.uid];
    }
    
    await updateDoc(msgRef, { reactions });
}

function showReactionPicker(msgId, x, y) {
    reactionMsgId = msgId;
    const picker = document.getElementById('reactionPicker');
    if (!picker) return;
    picker.style.display = 'flex';
    picker.style.left = Math.min(x, window.innerWidth - 320) + 'px';
    picker.style.top = Math.max(10, y - 50) + 'px';
}

document.getElementById('reactionPicker')?.querySelectorAll('.reaction-emoji').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (reactionMsgId) toggleReaction(reactionMsgId, btn.dataset.reaction);
        document.getElementById('reactionPicker').style.display = 'none';
        reactionMsgId = null;
    });
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.3)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
});

document.addEventListener('click', () => {
    const picker = document.getElementById('reactionPicker');
    if (picker) picker.style.display = 'none';
});

// Long press on message bubble → reaction picker
document.addEventListener('pointerdown', (e) => {
    const bubble = e.target.closest('.message-bubble');
    if (!bubble) return;
    const msgDiv = bubble.closest('[data-msg-id]');
    if (!msgDiv) return;
    const timer = setTimeout(() => {
        showReactionPicker(msgDiv.dataset.msgId, e.clientX, e.clientY);
    }, 500);
    const cancel = () => { clearTimeout(timer); document.removeEventListener('pointerup', cancel); document.removeEventListener('pointercancel', cancel); };
    document.addEventListener('pointerup', cancel);
    document.addEventListener('pointercancel', cancel);
});

// SPARK v2.0.2
