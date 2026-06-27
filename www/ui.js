import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

const languages = {
    ru: {
        chats: "Чаты", settings: "Настройки", notifications: "Уведомления", profile: "Мой профиль",
        appearance: "Оформление", lang: "Язык", logout: "Выйти из аккаунта", search: "Поиск по @username...",
        security: "Безопасность", storage: "Хранилище", message: "Сообщение...", offline: "не в сети",
        online: "в сети", noChats: "Нет чатов", noMessages: "Нет сообщений", pinChat: "Закрепить чат",
        unpinChat: "Открепить чат", muteChat: "Без звука", unmuteChat: "Включить звук",
        clearHistory: "Очистить историю", deleteChat: "Удалить чат", editMsg: "Изменить",
        deleteMsg: "Удалить", cancel: "Отмена", save: "Сохранить", about: "О себе",
        birthday: "Дата рождения", noInfo: "Информация отсутствует", notSpecified: "Не указана",
        incomingCall: "Входящий звонок", incomingAudio: "Входящий аудиозвонок",
        incomingVideo: "Входящий видеозвонок", calling: "Звонок...", swipeHint: "НАЖМИТЕ ДЛЯ ВХОДА",
        continue: "ПРОДОЛЖИТЬ", login: "ВОЙТИ", register: "ЗАРЕГИСТРИРОВАТЬСЯ", newProfile: "Новый профиль",
        changePhoto: "Сменить фото", saveProfile: "Сохранить изменения", clearCache: "Очистить кэш",
        langChanged: "Язык изменён", lightTheme: "Светлая тема", darkTheme: "Тёмная тема",
        cacheCleared: "Кэш очищен", callMissed: "не ответил(а) на звонок", callAnswered: "ответил(а) на звонок",
        audioCall: "аудиозвонок", videoCall: "видеозвонок", friend: "Друг", chat: "Чат",
        notFound: "Никого не найдено", noMessagesPreview: "Нет сообщений", edited: "(ред.)"
    },
    en: {
        chats: "Chats", settings: "Settings", notifications: "Notifications", profile: "My Profile",
        appearance: "Appearance", lang: "Language", logout: "Log Out", search: "Search by @username...",
        security: "Security", storage: "Storage", message: "Message...", offline: "offline",
        online: "online", noChats: "No chats", noMessages: "No messages", pinChat: "Pin chat",
        unpinChat: "Unpin chat", muteChat: "Mute", unmuteChat: "Unmute",
        clearHistory: "Clear history", deleteChat: "Delete chat", editMsg: "Edit",
        deleteMsg: "Delete", cancel: "Cancel", save: "Save", about: "About",
        birthday: "Birthday", noInfo: "No information", notSpecified: "Not specified",
        incomingCall: "Incoming call", incomingAudio: "Incoming audio call",
        incomingVideo: "Incoming video call", calling: "Calling...", swipeHint: "TAP TO ENTER",
        continue: "CONTINUE", login: "LOG IN", register: "REGISTER", newProfile: "New profile",
        changePhoto: "Change photo", saveProfile: "Save changes", clearCache: "Clear cache",
        langChanged: "Language changed", lightTheme: "Light theme", darkTheme: "Dark theme",
        cacheCleared: "Cache cleared", callMissed: "didn't answer", callAnswered: "answered the call",
        audioCall: "audio call", videoCall: "video call", friend: "Friend", chat: "Chat",
        notFound: "No one found", noMessagesPreview: "No messages", edited: "(edited)"
    },
    uk: {
        chats: "Чати", settings: "Налаштування", notifications: "Сповіщення", profile: "Мій профіль",
        appearance: "Оформлення", lang: "Мова", logout: "Вийти з акаунта", search: "Пошук за @username...",
        security: "Безпека", storage: "Сховище", message: "Повідомлення...", offline: "не в мережі",
        online: "в мережі", noChats: "Немає чатів", noMessages: "Немає повідомлень", pinChat: "Закріпити чат",
        unpinChat: "Відкріпити чат", muteChat: "Без звуку", unmuteChat: "Увімкнути звук",
        clearHistory: "Очистити історію", deleteChat: "Видалити чат", editMsg: "Змінити",
        deleteMsg: "Видалити", cancel: "Скасувати", save: "Зберегти", about: "Про себе",
        birthday: "Дата народження", noInfo: "Інформація відсутня", notSpecified: "Не вказано",
        incomingCall: "Вхідний дзвінок", incomingAudio: "Вхідний аудіодзвінок",
        incomingVideo: "Вхідний відеодзвінок", calling: "Дзвінок...", swipeHint: "НАТИСНІТЬ ДЛЯ ВХОДУ",
        continue: "ПРОДОВЖИТИ", login: "УВІЙТИ", register: "ЗАРЕЄСТРУВАТИСЯ", newProfile: "Новий профіль",
        changePhoto: "Змінити фото", saveProfile: "Зберегти зміни", clearCache: "Очистити кеш",
        langChanged: "Мову змінено", lightTheme: "Світла тема", darkTheme: "Темна тема",
        cacheCleared: "Кеш очищено", callMissed: "не відповів(ла)", callAnswered: "відповів(ла) на дзвінок",
        audioCall: "аудіодзвінок", videoCall: "відеодзвінок", friend: "Друг", chat: "Чат",
        notFound: "Нікого не знайдено", noMessagesPreview: "Немає повідомлень", edited: "(ред.)"
    },
    kk: {
        chats: "Чаттар", settings: "Баптаулар", notifications: "Хабарландырулар", profile: "Менің профилім",
        appearance: "Әрлеу", lang: "Тіл", logout: "Аккаунттан шығу", search: "@username бойынша іздеу...",
        security: "Қауіпсіздік", storage: "Сақтау", message: "Хабарлама...", offline: "желіде емес",
        online: "желіде", noChats: "Чаттар жоқ", noMessages: "Хабарламалар жоқ", pinChat: "Чатты бекіту",
        unpinChat: "Бекітуді алу", muteChat: "Дыбыссыз", unmuteChat: "Дыбысты қосу",
        clearHistory: "Тарихты тазалау", deleteChat: "Чатты жою", editMsg: "Өзгерту",
        deleteMsg: "Жою", cancel: "Болдырмау", save: "Сақтау", about: "Өзі туралы",
        birthday: "Туған күні", noInfo: "Ақпарат жоқ", notSpecified: "Көрсетілмеген",
        incomingCall: "Кіріс қоңырау", incomingAudio: "Кіріс аудио қоңырау",
        incomingVideo: "Кіріс бейне қоңырау", calling: "Қоңырау...", swipeHint: "КІРУ ҮШІН БАСЫҢЫЗ",
        continue: "ЖАЛҒАСТЫРУ", login: "КІРУ", register: "ТІРКЕЛУ", newProfile: "Жаңа профиль",
        changePhoto: "Фото өзгерту", saveProfile: "Өзгерістерді сақтау", clearCache: "Кэшті тазалау",
        langChanged: "Тіл өзгертілді", lightTheme: "Жарық тема", darkTheme: "Қараңғы тема",
        cacheCleared: "Кэш тазаланды", callMissed: "жауап бермеді", callAnswered: "қоңырауға жауап берді",
        audioCall: "аудио қоңырау", videoCall: "бейне қоңырау", friend: "Дос", chat: "Чат",
        notFound: "Ешкім табылмады", noMessagesPreview: "Хабарламалар жоқ", edited: "(ред.)"
    }
};

export function getLang() {
    return localStorage.getItem('spark-lang') || 'ru';
}

export function t(key) {
    const dict = languages[getLang()] || languages.ru;
    return dict[key] || languages.ru[key] || key;
}

export function renderAvatar(el, { avatarUrl, name } = {}) {
    if (!el) return;
    const initial = (name || '?')[0]?.toUpperCase() || '?';
    if (avatarUrl) {
        el.innerHTML = `<img src="${avatarUrl}" alt="">`;
    } else {
        el.textContent = initial;
    }
}

const MONO_ACCENTS = ['#ffffff', '#e8e8e8', '#cccccc', '#999999', '#666666', '#333333', '#1a1a1a', '#000000'];

export function applyAccentColor(c) {
    document.documentElement.style.setProperty('--accent', c);
    localStorage.setItem('spark-accent', c);
}

export function applySavedLanguage() {
    const dict = languages[getLang()];
    if (!dict) return;

    const map = {
        'tab-chats-btn': `<i class="fas fa-comment-alt"></i>${dict.chats}`,
        'tab-settings-btn': `<i class="fas fa-cog"></i>${dict.settings}`,
        'label-notifications': `<i class="fas fa-bell"></i> ${dict.notifications}`,
        'btn-profile-edit': `<i class="fas fa-user"></i> ${dict.profile}`,
        'btn-theme-edit': `<i class="fas fa-palette"></i> ${dict.appearance}`,
        'btn-lang-edit': `<i class="fas fa-globe"></i> ${dict.lang}`,
        'btn-security-edit': `<i class="fas fa-shield-alt"></i> ${dict.security}`,
        'btn-storage-edit': `<i class="fas fa-database"></i> ${dict.storage}`,
        'btn-logout': `<i class="fas fa-sign-out-alt"></i> ${dict.logout}`,
        'btnChangeAvatar': `<i class="fas fa-camera"></i> ${dict.changePhoto}`,
        'btnSaveProfile': dict.saveProfile,
        'btnClearCache': dict.clearCache,
        'btnStep1': dict.continue,
        'btnStep2': dict.login,
        'btnRegister': dict.register,
        'btnCancelEdit': dict.cancel,
        'btnSaveEdit': dict.save,
        'label-about': dict.about,
        'label-birthday': dict.birthday,
        'swipeHint': dict.swipeHint,
        'incomingCallType': dict.incomingCall
    };

    Object.entries(map).forEach(([id, text]) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = text;
    });

    const searchBar = document.getElementById('searchBar');
    if (searchBar) searchBar.placeholder = dict.search;
    const msgInput = document.getElementById('msgInput');
    if (msgInput) msgInput.placeholder = dict.message;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (dict[key]) el.textContent = dict[key];
    });

    const pinBtn = document.getElementById('btnMenuPin');
    const muteBtn = document.getElementById('btnMenuMute');
    if (pinBtn) pinBtn.querySelector('span').textContent = dict.pinChat;
    if (muteBtn) muteBtn.querySelector('span').textContent = dict.muteChat;
}

export function applySavedWallpaper() {
    const wallpaper = localStorage.getItem('spark-chat-wallpaper') || 'grid';
    const area = document.getElementById('messagesArea');
    if (!area) return;

    area.className = "messages-area";
    if (wallpaper === 'oled') area.classList.add('wp-oled');
    else if (wallpaper === 'dots') area.classList.add('wp-dots');
    else if (wallpaper === 'lines') area.classList.add('wp-lines');
    else if (wallpaper === 'space') area.classList.add('wp-space');
    else area.classList.add('wp-grid');
}

export function syncProfile(currentUser) {
    if (!currentUser) return;
    const avatarSrc = currentUser.avatarUrl || currentUser.avatar;

    const nameEl = document.getElementById('myNameDisplay');
    const userEl = document.getElementById('myUserDisplay');
    const avatarEl = document.getElementById('mySettingsAvatar');
    const editNameEl = document.getElementById('editName');
    const editBirthEl = document.getElementById('editBirth');
    const editBioEl = document.getElementById('editBio');
    const previewEl = document.getElementById('profileAvatarPreview');

    if (nameEl) nameEl.textContent = currentUser.name;
    if (userEl) userEl.textContent = currentUser.username;
    renderAvatar(avatarEl, { avatarUrl: avatarSrc, name: currentUser.name });
    if (editNameEl) editNameEl.value = currentUser.name || '';
    if (editBirthEl) editBirthEl.value = currentUser.birth || '';
    if (editBioEl) editBioEl.value = currentUser.bio || '';
    renderAvatar(previewEl, { avatarUrl: avatarSrc, name: currentUser.name });
}

export function switchTab(tab, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`pane-${tab}`)?.classList.add('active');
}

export function openPanel(id) {
    document.querySelectorAll('.full-pane.active').forEach(p => p.classList.remove('active'));
    const panelId = `panel${id.charAt(0).toUpperCase() + id.slice(1)}`;
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.add('active');
}

export function closePanel(id) {
    const panelId = `panel${id.charAt(0).toUpperCase() + id.slice(1)}`;
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.remove('active');
}

export function applySavedTheme() {
    const theme = localStorage.getItem('spark-theme') || 'dark';
    document.body.classList.toggle('light', theme === 'light');
    document.body.classList.toggle('dark', theme !== 'light');
    const accent = localStorage.getItem('spark-accent');
    if (accent) applyAccentColor(accent);
}

function buildThemeGrid() {
    const grid = document.getElementById('themeGrid');
    if (!grid || grid.children.length) return;
    const saved = localStorage.getItem('spark-accent') || '#ffffff';
    MONO_ACCENTS.forEach(color => {
        const sq = document.createElement('div');
        sq.className = 'color-sq' + (color === saved ? ' active' : '');
        sq.style.background = color;
        sq.style.border = color === '#000000' || color === '#1a1a1a' ? '1px solid rgba(255,255,255,0.2)' : 'none';
        sq.onclick = () => {
            grid.querySelectorAll('.color-sq').forEach(s => s.classList.remove('active'));
            sq.classList.add('active');
            applyAccentColor(color);
        };
        grid.appendChild(sq);
    });
}

function setWallpaper(key) {
    localStorage.setItem('spark-chat-wallpaper', key);
    applySavedWallpaper();
}

export function initPanelHandlers({ showToast } = {}) {
    buildThemeGrid();

    ['ru', 'en', 'uk', 'kk'].forEach(lang => {
        document.getElementById(`btn-lang-${lang}`)?.addEventListener('click', () => {
            localStorage.setItem('spark-lang', lang);
            applySavedLanguage();
            closePanel('language');
            showToast?.(t('langChanged'), 'success');
        });
    });

    document.getElementById('btnThemeLight')?.addEventListener('click', () => {
        localStorage.setItem('spark-theme', 'light');
        localStorage.setItem('spark-chat-wallpaper', 'grid');
        applySavedTheme();
        applySavedWallpaper();
        showToast?.(t('lightTheme'), 'success');
    });

    document.getElementById('btnThemeDark')?.addEventListener('click', () => {
        localStorage.setItem('spark-theme', 'dark');
        localStorage.setItem('spark-chat-wallpaper', 'oled');
        applySavedTheme();
        applySavedWallpaper();
        showToast?.(t('darkTheme'), 'success');
    });

    document.getElementById('btnWallpaperGrid')?.addEventListener('click', () => setWallpaper('grid'));
    document.getElementById('btnWallpaperOled')?.addEventListener('click', () => setWallpaper('oled'));
    document.getElementById('btnWallpaperDots')?.addEventListener('click', () => setWallpaper('dots'));
    document.getElementById('btnWallpaperLines')?.addEventListener('click', () => setWallpaper('lines'));
    document.getElementById('btnWallpaperSpace')?.addEventListener('click', () => setWallpaper('space'));

    document.getElementById('btnClearCache')?.addEventListener('click', () => {
        const keys = Object.keys(localStorage).filter(k => k.startsWith('spark-cache-'));
        keys.forEach(k => localStorage.removeItem(k));
        if ('caches' in window) {
            caches.keys().then(names => names.forEach(n => caches.delete(n)));
        }
        showToast?.(t('cacheCleared'), 'success');
    });

    document.getElementById('notificationToggle')?.addEventListener('change', (e) => {
        localStorage.setItem('spark-notifications', e.target.checked);
        if (e.target.checked && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    });

    const notifSaved = localStorage.getItem('spark-notifications');
    const notifToggle = document.getElementById('notificationToggle');
    if (notifToggle && notifSaved !== null) notifToggle.checked = notifSaved !== 'false';
}
