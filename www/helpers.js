import { doc, getDocs, updateDoc, collection, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { getLang } from "./ui.js";

const lastSeenLabels = {
    ru: { justNow: "был(а) только что", minsAgo: n => `был(а) ${n} мин. назад`, hoursAgo: n => `был(а) ${n} ч. назад`, at: (d, t) => `был(а) ${d} в ${t}`, offline: "не в сети" },
    en: { justNow: "last seen just now", minsAgo: n => `last seen ${n} min ago`, hoursAgo: n => `last seen ${n} h ago`, at: (d, t) => `last seen ${d} at ${t}`, offline: "offline" },
    uk: { justNow: "був(ла) щойно", minsAgo: n => `був(ла) ${n} хв. тому`, hoursAgo: n => `був(ла) ${n} год. тому`, at: (d, t) => `був(ла) ${d} о ${t}`, offline: "не в мережі" },
    kk: { justNow: "жаңа ғана", minsAgo: n => `${n} мин бұрын`, hoursAgo: n => `${n} сағ бұрын`, at: (d, t) => `${d}, ${t}`, offline: "желіде емес" }
};

const blobCache = new Map();

// Декодер Base64 в Blob URL для стабильного воспроизведения на iOS Webkit/Safari
export function getBlobUrlFromBase64(base64Data) {
    if (!base64Data || typeof base64Data !== 'string') return "";
    if (!base64Data.startsWith('data:')) return base64Data; 
    if (blobCache.has(base64Data)) return blobCache.get(base64Data);

    try {
        const parts = base64Data.split(',');
        if (parts.length < 2) return base64Data;
        
        const mimeMatch = parts[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : "video/mp4";
        let b64 = parts[1];
        
        b64 = b64.replace(/[\s\r\n\t]/g, ''); 
        b64 = b64.replace(/-/g, '+').replace(/_/g, '/'); 
        
        if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(b64)) {
            return base64Data; 
        }

        const pad = b64.length % 4;
        if (pad === 2) b64 += '==';
        else if (pad === 3) b64 += '=';

        const byteCharacters = atob(b64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        blobCache.set(base64Data, blobUrl);
        return blobUrl;
    } catch (e) {
        console.error("Преобразование Base64 в Blob не удалось:", e);
        return base64Data; 
    }
}

// Проверка на содержание в тексте исключительно смайликов
export function isOnlyEmojis(str) {
    if (!str) return false;
    const cleanStr = str.replace(/[\s\n\r\t]/g, '');
    if (!cleanStr) return false;
    
    const emojiRegex = /^(\p{Emoji}|\p{Emoji_Component}|\p{Emoji_Modifier}|\p{Emoji_Modifier_Base}|\p{Emoji_Presentation})+$/u;
    if (/^\d+$/.test(cleanStr)) return false; 
    
    return emojiRegex.test(cleanStr);
}

// Форматирование даты последнего посещения
export function formatLastSeen(timestamp) {
    const L = lastSeenLabels[getLang()] || lastSeenLabels.ru;
    if (!timestamp) return L.offline;
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return L.justNow;
    if (diffMins < 60) return L.minsAgo(diffMins);
    if (diffHours < 24) return L.hoursAgo(diffHours);
    return L.at(date.toLocaleDateString(), date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
}

// Сжатие и автоматическое улучшение изображений перед выгрузкой в Firestore
export function compressImage(base64Str, maxWidth = 320, maxHeight = 320, maxSize = 900000) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                const resize = () => {
                    if (width > height) {
                        if (width > maxWidth) {
                            height *= maxWidth / width;
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width *= maxHeight / height;
                            height = maxHeight;
                        }
                    }
                    canvas.width = Math.max(1, Math.round(width));
                    canvas.height = Math.max(1, Math.round(height));
                };

                const encode = (quality) => {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    if (ctx.filter !== undefined) {
                        ctx.filter = 'contrast(1.06) saturate(1.08) brightness(1.02)';
                    }
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    return canvas.toDataURL('image/jpeg', quality);
                };

                resize();

                let quality = 0.80;
                let compressed = encode(quality);
                while (compressed.length > maxSize && quality > 0.28) {
                    quality -= 0.08;
                    compressed = encode(quality);
                }

                if (compressed.length > maxSize) {
                    const shrinkFactor = 0.85;
                    let tries = 0;
                    while (compressed.length > maxSize && tries < 6) {
                        width *= shrinkFactor;
                        height *= shrinkFactor;
                        resize();
                        quality = Math.max(0.24, quality - 0.08);
                        compressed = encode(quality);
                        tries += 1;
                    }
                }

                resolve(compressed.length <= maxSize ? compressed : base64Str);
            } catch (err) {
                resolve(base64Str);
            }
        };
        img.onerror = () => resolve(base64Str);
        img.src = base64Str;
    });
}

// Локальное обновление статусов прочтения входящих сообщений
export async function markIncomingMessagesAsRead(activeChatId, currentUserUID) {
    if (!activeChatId || !currentUserUID) return;
    try {
        const qMessages = query(collection(db, "messages"), where("chatId", "==", activeChatId));
        const snap = await getDocs(qMessages);
        snap.forEach(async (mDoc) => {
            const m = mDoc.data();
            if (m.senderId !== currentUserUID && !m.read) {
                await updateDoc(doc(db, "messages", mDoc.id), { read: true }).catch(() => {});
            }
        });
    } catch (e) {
        console.error("Ошибка при обновлении статуса прочтения:", e);
    }
}

// Показ тоста навигации/уведомлений
export function showNotification(text, title = "SPARK") {
    if (localStorage.getItem('spark-notifications') === 'false') return;

    const toast = document.createElement('div');
    toast.className = 'dynamic-island';
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
}

const CIRCLE_RING_R = 54;
export const CIRCLE_RING_C = 2 * Math.PI * CIRCLE_RING_R;
export const CIRCLE_MAX_DURATION = 60;

export function formatVideoTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export function setRingProgress(ringEl, progress) {
    if (!ringEl) return;
    const p = Math.min(1, Math.max(0, progress));
    ringEl.style.strokeDasharray = `${CIRCLE_RING_C}`;
    ringEl.style.strokeDashoffset = `${CIRCLE_RING_C * (1 - p)}`;
}

// Определение платформы: iOS, Samsung, Huawei/Honor, Xiaomi/Redmi
export function detectDevice() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) return { platform: 'ios', brand: 'apple', isIOS: true, isAndroid: false };
    const isAndroid = /Android/i.test(ua);
    let brand = 'android';
    if (/Huawei|Honor|HONOR|HUAWEI|HMSCore/i.test(ua)) brand = 'huawei';
    else if (/Samsung|SM-|SAMSUNG/i.test(ua)) brand = 'samsung';
    else if (/Xiaomi|Redmi|Mi |POCO|MIUI/i.test(ua)) brand = 'xiaomi';
    return { platform: isAndroid ? 'android' : 'web', brand, isIOS: false, isAndroid };
}

export function getCameraConstraints(facingMode = 'user') {
    const dev = detectDevice();
    return {
        audio: true,
        video: {
            facingMode: dev.isIOS ? facingMode : { ideal: facingMode },
            width: { ideal: 480, max: 720 },
            height: { ideal: 480, max: 720 },
            aspectRatio: { ideal: 1 }
        }
    };
}

export function getSupportedVideoMimeType() {
    const dev = detectDevice();
    const types = dev.isIOS
        ? ['video/mp4', 'video/webm;codecs=vp8', 'video/webm']
        : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    for (const type of types) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
}

export function isNotificationsEnabled() {
    return localStorage.getItem('spark-notifications') !== 'false';
}

export function getMessagePreview(msg) {
    if (!msg) return 'Новое сообщение';
    if (msg.type === 'text') return msg.text || 'Сообщение';
    if (msg.type === 'voice') return 'Голосовое';
    if (msg.type === 'circle') return 'Кружок';
    if (msg.type === 'image') return 'Фото';
    if (msg.type === 'video') return 'Видео';
    if (msg.type === 'file') return `${msg.fileName || 'Файл'}`;
    return 'Новое сообщение';
}

export async function notifyIncomingMessage(title, body, chatId) {
    if (!isNotificationsEnabled()) return;
    if (Notification.permission !== 'granted') return;

    const options = {
        body,
        icon: '/icon.png',
        badge: '/icon.png',
        tag: `spark-chat-${chatId}`,
        renotify: true,
        data: { chatId },
        vibrate: [200, 100, 200]
    };

    try {
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification(title, options);
            return;
        }
    } catch (_) { /* fallback */ }

    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); window._openChatFromNotif = chatId; n.close(); };
}

export async function registerAppServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        await reg.update();
    } catch (e) {
        console.warn('Service Worker:', e);
    }
}

let activeCircleVideo = null;
let fsControlsBound = false;

function bindFullscreenControls() {
    const overlay = document.getElementById('circleFullscreenOverlay');
    const fsVideo = document.getElementById('circleFullscreenVideo');
    const fsRing = document.getElementById('circleFsRing');
    const fsTime = document.getElementById('circleFsTime');
    if (!overlay || fsControlsBound) return;
    fsControlsBound = true;

    const updateFs = () => {
        if (!fsVideo) return;
        const dur = fsVideo.duration || CIRCLE_MAX_DURATION;
        setRingProgress(fsRing, dur ? fsVideo.currentTime / dur : 0);
        if (fsTime) fsTime.textContent = formatVideoTime(fsVideo.currentTime);
        const playBtn = overlay.querySelector('[data-fs="toggle"] i');
        if (playBtn) playBtn.className = fsVideo.paused ? 'fas fa-play' : 'fas fa-pause';
    };

    fsVideo?.addEventListener('timeupdate', updateFs);
    fsVideo?.addEventListener('ended', updateFs);

    overlay.querySelector('[data-fs="toggle"]')?.addEventListener('click', () => {
        if (!fsVideo) return;
        fsVideo.paused ? fsVideo.play().catch(() => {}) : fsVideo.pause();
        updateFs();
    });
    overlay.querySelector('[data-fs="back5"]')?.addEventListener('click', () => {
        if (!fsVideo) return;
        fsVideo.currentTime = Math.max(0, fsVideo.currentTime - 5);
        updateFs();
    });
    overlay.querySelector('[data-fs="fwd5"]')?.addEventListener('click', () => {
        if (!fsVideo) return;
        fsVideo.currentTime = Math.min(fsVideo.duration || CIRCLE_MAX_DURATION, fsVideo.currentTime + 5);
        updateFs();
    });
    overlay.querySelector('[data-fs="stop"]')?.addEventListener('click', () => {
        if (!fsVideo) return;
        fsVideo.pause();
        fsVideo.currentTime = 0;
        updateFs();
    });
}

function bindCircleControls(root, video, ring, timeEl, overlay) {
    video.loop = true;
    const scrubFill = root.querySelector('.circle-scrub-fill');
    const scrubThumb = root.querySelector('.circle-scrub-thumb');
    const scrubTrack = root.querySelector('.circle-scrub-track');

    const updateUI = () => {
        const dur = video.duration || CIRCLE_MAX_DURATION;
        const pct = dur ? video.currentTime / dur : 0;
        setRingProgress(ring, pct);
        if (timeEl) timeEl.textContent = formatVideoTime(video.currentTime);
        if (overlay) overlay.style.opacity = video.paused ? '1' : '0';
        if (scrubFill) scrubFill.style.width = (pct * 100) + '%';
        if (scrubThumb) scrubThumb.style.left = (pct * 100) + '%';
    };

    const toggle = () => {
        if (activeCircleVideo && activeCircleVideo !== video) {
            activeCircleVideo.pause();
            activeCircleVideo.closest('.circle-video-wrap')?.classList.remove('playing');
        }
        if (video.paused) {
            video.play().catch(() => {});
            activeCircleVideo = video;
            root.classList.add('playing');
        } else {
            video.pause();
            root.classList.remove('playing');
        }
    };

    root.querySelector('.circle-video-tap')?.addEventListener('click', toggle);

    if (scrubTrack) {
        let scrubbing = false;
        const getPos = (e) => {
            const rect = scrubTrack.getBoundingClientRect();
            const x = (e.touches?.[0] || e).clientX - rect.left;
            return Math.max(0, Math.min(1, x / rect.width));
        };
        const seekTo = (e) => {
            const pos = getPos(e);
            video.currentTime = pos * (video.duration || CIRCLE_MAX_DURATION);
            updateUI();
        };
        scrubTrack.addEventListener('mousedown', (e) => { scrubbing = true; seekTo(e); });
        scrubTrack.addEventListener('touchstart', (e) => { scrubbing = true; seekTo(e); }, { passive: true });
        document.addEventListener('mousemove', (e) => { if (scrubbing) seekTo(e); });
        document.addEventListener('touchmove', (e) => { if (scrubbing) seekTo(e); }, { passive: true });
        document.addEventListener('mouseup', () => { scrubbing = false; });
        document.addEventListener('touchend', () => { scrubbing = false; });
    }

    video.addEventListener('timeupdate', updateUI);
    video.addEventListener('loadedmetadata', updateUI);
    updateUI();
}

export function createCirclePlayerHTML(src) {
    return `
        <div class="circle-video-wrap" data-src="${src}">
            <div class="circle-video-tap">
                <svg class="circle-playback-ring" viewBox="0 0 120 120">
                    <circle class="ring-bg" cx="60" cy="60" r="${CIRCLE_RING_R}"/>
                    <circle class="ring-progress" cx="60" cy="60" r="${CIRCLE_RING_R}"/>
                </svg>
                <video class="circle-video-el" src="${src}" playsinline webkit-playsinline preload="metadata" loop></video>
                <div class="circle-play-overlay"><i class="fas fa-play"></i></div>
                <span class="circle-duration">0:00</span>
            </div>
            <div class="circle-scrub-bar">
                <div class="circle-scrub-track">
                    <div class="circle-scrub-fill"></div>
                    <div class="circle-scrub-thumb"></div>
                </div>
            </div>
        </div>`;
}

export function initCirclePlayer(container) {
    if (!container) return;
    const root = container.querySelector('.circle-video-wrap') || container;
    const video = root.querySelector('.circle-video-el');
    const ring = root.querySelector('.ring-progress');
    const timeEl = root.querySelector('.circle-duration');
    const overlay = root.querySelector('.circle-play-overlay');
    if (!video) return;
    bindCircleControls(root, video, ring, timeEl, overlay);
}

export function openCircleFullscreen(src, startTime = 0) {
    bindFullscreenControls();
    const overlay = document.getElementById('circleFullscreenOverlay');
    const fsVideo = document.getElementById('circleFullscreenVideo');
    const fsRing = document.getElementById('circleFsRing');
    const fsTime = document.getElementById('circleFsTime');
    if (!overlay || !fsVideo) return;

    fsVideo.src = src;
    fsVideo.currentTime = startTime;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    const updateFs = () => {
        const dur = fsVideo.duration || CIRCLE_MAX_DURATION;
        setRingProgress(fsRing, dur ? fsVideo.currentTime / dur : 0);
        if (fsTime) fsTime.textContent = formatVideoTime(fsVideo.currentTime);
    };

    fsVideo.onloadedmetadata = () => { fsVideo.currentTime = startTime; updateFs(); };
    fsVideo.play().catch(() => {});
}

export function closeCircleFullscreen() {
    const overlay = document.getElementById('circleFullscreenOverlay');
    const fsVideo = document.getElementById('circleFullscreenVideo');
    if (fsVideo) { fsVideo.pause(); fsVideo.src = ''; }
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
}