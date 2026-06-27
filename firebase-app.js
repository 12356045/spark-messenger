// firebase-app.js - использует уже созданный app
import { getApps } from './vendor/firebase/firebase-app.js';
import { getMessaging, getToken, onMessage } from './vendor/firebase/firebase-messaging.js';

function getApp() {
  const apps = getApps();
  if (apps.length > 0) return apps[0];
  return null;
}

let messagingInstance = null;

function getMessagingInstance() {
  if (messagingInstance) return messagingInstance;
  const app = getApp();
  if (!app) return null;
  try {
    messagingInstance = getMessaging(app);
    return messagingInstance;
  } catch (e) {
    console.warn('Messaging init error:', e);
    return null;
  }
}

export async function getFCMToken() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const messaging = getMessagingInstance();
    if (!messaging) return null;
    const token = await getToken(messaging, {
      vapidKey: '5WsL4TYD7V21o8iCNYR5VJ4qess2PAVMfpoTs_AiihM'
    });
    return token;
  } catch (error) {
    return null;
  }
}

export function listenForMessages(callback) {
  try {
    const messaging = getMessagingInstance();
    if (!messaging) return;
    onMessage(messaging, (payload) => {
      if (callback) callback(payload);
    });
  } catch (e) {
    console.warn('FCM listener error:', e);
  }
}
