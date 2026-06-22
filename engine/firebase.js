/* ============================================================
   SPARK ENGINE — Firebase Abstraction Layer
   Typed operations for users, chats, messages, calls, circles
   ============================================================ */

import { signal, effect } from './core.js';
import {
    collection, addDoc, doc, updateDoc, deleteDoc,
    onSnapshot, serverTimestamp, query, where, orderBy,
    limit, getDoc, getDocs, arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { db } from '../firebase-config.js';

// ─── Reactive Collections ───────────────────────────────────

export function reactiveQuery(collName, queryConstraints = []) {
    const data = signal([]);
    const loading = signal(true);
    const error = signal(null);

    let unsub = null;

    function start() {
        loading.value = true;
        const q = queryConstraints.length
            ? query(collection(db, collName), ...queryConstraints)
            : collection(db, collName);

        unsub = onSnapshot(q, (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            data.value = items;
            loading.value = false;
        }, (err) => {
            error.value = err;
            loading.value = false;
        });
    }

    function stop() {
        if (unsub) { unsub(); unsub = null; }
    }

    return { data, loading, error, start, stop };
}

export function reactiveDoc(collName, docId) {
    const data = signal(null);
    const loading = signal(true);
    const error = signal(null);

    let unsub = null;

    function start(id) {
        if (id) docId = id;
        if (!docId) return;
        loading.value = true;
        unsub = onSnapshot(doc(db, collName, docId), (d) => {
            data.value = d.exists() ? { id: d.id, ...d.data() } : null;
            loading.value = false;
        }, (err) => {
            error.value = err;
            loading.value = false;
        });
    }

    function stop() {
        if (unsub) { unsub(); unsub = null; }
    }

    return { data, loading, error, start, stop };
}

// ─── Users API ──────────────────────────────────────────────

export const Users = {
    async get(uid) {
        const snap = await getDoc(doc(db, 'users', uid));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },

    async getByUsername(username) {
        const q = query(collection(db, 'users'), where('username', '==', username), limit(1));
        const snap = await getDocs(q);
        return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    },

    async create(uid, data) {
        return addDoc(collection(db, 'users'), { uid, ...data, createdAt: serverTimestamp() });
    },

    async update(uid, data) {
        const q = query(collection(db, 'users'), where('uid', '==', uid), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
            return updateDoc(snap.docs[0].ref, data);
        }
    },

    observe(uid, callback) {
        const q = query(collection(db, 'users'), where('uid', '==', uid), limit(1));
        return onSnapshot(q, (snap) => {
            if (!snap.empty) callback({ id: snap.docs[0].id, ...snap.docs[0].data() });
        });
    },

    observeAll(callback) {
        return onSnapshot(collection(db, 'users'), (snap) => {
            const users = [];
            snap.forEach(d => users.push({ id: d.id, ...d.data() }));
            callback(users);
        });
    }
};

// ─── Chats API ──────────────────────────────────────────────

export const Chats = {
    async get(chatId) {
        const snap = await getDoc(doc(db, 'chats', chatId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },

    async findPrivate(userId1, userId2) {
        const q = query(
            collection(db, 'chats'),
            where('type', '==', 'private'),
            where('members', 'array-contains', userId1)
        );
        const snap = await getDocs(q);
        for (const d of snap.docs) {
            const data = d.data();
            if (data.members.includes(userId2)) return { id: d.id, ...data };
        }
        return null;
    },

    async createPrivate(userId1, userId2) {
        return addDoc(collection(db, 'chats'), {
            type: 'private',
            members: [userId1, userId2],
            createdAt: serverTimestamp(),
            lastMessage: '',
            lastMessageTime: serverTimestamp()
        });
    },

    async createGroup(name, memberIds, createdBy) {
        return addDoc(collection(db, 'chats'), {
            type: 'group',
            name,
            members: memberIds,
            createdBy,
            createdAt: serverTimestamp(),
            lastMessage: '',
            lastMessageTime: serverTimestamp()
        });
    },

    async createChannel(name, description, createdBy) {
        return addDoc(collection(db, 'chats'), {
            type: 'channel',
            name,
            description,
            createdBy,
            members: [createdBy],
            createdAt: serverTimestamp(),
            lastMessage: '',
            lastMessageTime: serverTimestamp()
        });
    },

    async updateLastMessage(chatId, text) {
        return updateDoc(doc(db, 'chats', chatId), {
            lastMessage: text,
            lastMessageTime: serverTimestamp()
        });
    },

    observeForUser(userId, callback) {
        const q = query(
            collection(db, 'chats'),
            where('members', 'array-contains', userId),
            orderBy('lastMessageTime', 'desc')
        );
        return onSnapshot(q, (snap) => {
            const chats = [];
            snap.forEach(d => chats.push({ id: d.id, ...d.data() }));
            callback(chats);
        });
    }
};

// ─── Messages API ───────────────────────────────────────────

export const Messages = {
    async send(chatId, data) {
        return addDoc(collection(db, 'messages'), {
            chatId,
            ...data,
            timestamp: serverTimestamp()
        });
    },

    async sendText(chatId, senderId, senderName, text) {
        return this.send(chatId, {
            type: 'text',
            content: text,
            senderId,
            senderName
        });
    },

    async sendImage(chatId, senderId, senderName, imageUrl) {
        return this.send(chatId, {
            type: 'image',
            content: imageUrl,
            senderId,
            senderName
        });
    },

    async sendVoice(chatId, senderId, senderName, voiceData, duration) {
        return this.send(chatId, {
            type: 'voice',
            content: voiceData,
            duration,
            senderId,
            senderName
        });
    },

    async sendCircle(chatId, senderId, senderName, videoData, duration) {
        return this.send(chatId, {
            type: 'circle',
            content: videoData,
            duration,
            senderId,
            senderName
        });
    },

    async react(messageId, emoji, userId) {
        const msgRef = doc(db, 'messages', messageId);
        const snap = await getDoc(msgRef);
        if (!snap.exists()) return;
        const msg = snap.data();
        const reactions = msg.reactions || {};
        const users = reactions[emoji] || [];

        if (users.includes(userId)) {
            const updated = users.filter(u => u !== userId);
            if (updated.length === 0) {
                const { [emoji]: _, ...rest } = reactions;
                await updateDoc(msgRef, { reactions: rest });
            } else {
                await updateDoc(msgRef, { [`reactions.${emoji}`]: updated });
            }
        } else {
            const newReactions = {};
            for (const [e, u] of Object.entries(reactions)) {
                newReactions[e] = u.filter(uid => uid !== userId);
                if (newReactions[e].length === 0) delete newReactions[e];
            }
            newReactions[emoji] = [...(newReactions[emoji] || []), userId];
            await updateDoc(msgRef, { reactions: newReactions });
        }
    },

    observeChat(chatId, callback, messageLimit = 100) {
        const q = query(
            collection(db, 'messages'),
            where('chatId', '==', chatId),
            orderBy('timestamp', 'asc'),
            limit(messageLimit)
        );
        return onSnapshot(q, (snap) => {
            const messages = [];
            snap.forEach(d => messages.push({ id: d.id, ...d.data() }));
            callback(messages);
        });
    }
};

// ─── Calls API ──────────────────────────────────────────────

export const Calls = {
    async create(data) {
        return addDoc(collection(db, 'calls'), {
            ...data,
            status: 'calling',
            timestamp: serverTimestamp()
        });
    },

    async update(callId, data) {
        return updateDoc(doc(db, 'calls', callId), data);
    },

    async end(callId) {
        return this.update(callId, { status: 'ended' });
    },

    async addCandidate(callId, candidate, sender) {
        return addDoc(collection(db, 'calls', callId, 'candidates'), {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
            sender,
            ts: Date.now()
        });
    },

    observeCall(callId, callback) {
        return onSnapshot(doc(db, 'calls', callId), (snap) => {
            if (snap.exists()) callback({ id: snap.id, ...snap.data() });
        });
    },

    observeIncoming(userId, callback) {
        const q = query(collection(db, 'calls'), where('targetId', '==', userId));
        return onSnapshot(q, (snap) => {
            const calls = [];
            snap.forEach(d => calls.push({ id: d.id, ...d.data() }));
            callback(calls);
        });
    },

    observeCandidates(callId, callback) {
        return onSnapshot(collection(db, 'calls', callId, 'candidates'), (snap) => {
            const candidates = [];
            snap.forEach(d => candidates.push({ id: d.id, ...d.data() }));
            callback(candidates);
        });
    }
};

// ─── Presence API ───────────────────────────────────────────

export const Presence = {
    setOnline(userId) {
        const presenceRef = doc(db, 'presence', userId);
        return updateDoc(presenceRef, {
            online: true,
            lastSeen: serverTimestamp()
        }).catch(() => {
            return addDoc(collection(db, 'presence'), {
                uid: userId,
                online: true,
                lastSeen: serverTimestamp()
            });
        });
    },

    setOffline(userId) {
        const presenceRef = doc(db, 'presence', userId);
        return updateDoc(presenceRef, {
            online: false,
            lastSeen: serverTimestamp()
        }).catch(() => {});
    },

    observe(userId, callback) {
        return onSnapshot(doc(db, 'presence', userId), (snap) => {
            if (snap.exists()) callback(snap.data());
        });
    }
};

// ─── Storage Helpers (base64 fallback) ──────────────────────

export const Storage = {
    async uploadAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    async uploadImageAsThumb(file, maxDim = 800) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
                    canvas.width = img.width * ratio;
                    canvas.height = img.height * ratio;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.85));
                };
                img.onerror = reject;
                img.src = reader.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
};
