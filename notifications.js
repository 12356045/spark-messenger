// notifications.js - standalone, no FCM app init
import { db } from './firebase-config.js';
import {
  doc, updateDoc, arrayUnion, addDoc, collection,
  query, where, getDoc, onSnapshot, deleteDoc
} from './vendor/firebase/firebase-firestore.js';

let notifUnsubscribe = null;

// Real-time listener на входящие уведомления
function startNotificationsListener(userId, callback) {
  if (notifUnsubscribe) notifUnsubscribe();
  try {
    const q = query(collection(db, 'notifications'), where('recipientId', '==', userId));
    notifUnsubscribe = onSnapshot(q, async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'added') {
          const d = change.doc.data();
          if (d.read) continue;
          const title = d.senderName || 'SPARK';
          let body = d.messageText || 'Новое сообщение';
          if (body.length > 100) body = body.substring(0, 100) + '...';
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              const n = new Notification(title, { body, icon: '/icon.png', tag: `spark-${d.chatId || Date.now()}` });
              n.onclick = () => { window.focus(); n.close(); };
              setTimeout(() => n.close(), 8000);
            } catch (e) {}
          }
          if (callback) callback({ notification: { title, body }, data: d });
          try { await deleteDoc(change.doc.ref); } catch (e) {}
        }
      }
    }, (error) => console.warn('Notif listener error:', error));
  } catch (e) { console.warn('Notif start error:', e); }
}

export function initNotifications(userId, callback) {
  if (!userId) return;
  startNotificationsListener(userId, callback);
}

export async function sendPushNotification(recipientId, senderName, messageText, chatId, messageType) {
  if (!recipientId || !senderName) return;
  try {
    await addDoc(collection(db, 'notifications'), {
      recipientId, senderName,
      messageText: messageText || 'Новое сообщение',
      chatId: chatId || '', messageType: messageType || 'text',
      timestamp: new Date(), read: false
    });
  } catch (error) { console.error('Send notif error:', error); }
}

export function stopNotificationsListener() {
  if (notifUnsubscribe) { notifUnsubscribe(); notifUnsubscribe = null; }
}
