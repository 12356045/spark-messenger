// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDGQObyd4h5dYzLgZOxSFDaBY_f9ulJpdI",
  authDomain: "spark-ead35.firebaseapp.com",
  projectId: "spark-ead35",
  storageBucket: "spark-ead35.firebasestorage.app",
  messagingSenderId: "391789994095",
  appId: "1:391789994095:web:374032b2838133dd076d9a"
});

const messaging = firebase.messaging();

// Фоновые уведомления
messaging.onBackgroundMessage((payload) => {
  console.log('📨 Background message:', payload);
  
  const notification = payload.notification || {};
  const data = payload.data || {};
  
  const title = notification.title || 'SPARK';
  const body = notification.body || 'Новое сообщение';
  const icon = notification.icon || '/icon.png';
  const chatId = data.chatId || '';

  const options = {
    body: body,
    icon: icon,
    badge: '/icon.png',
    vibrate: [200, 100, 200],
    tag: `spark-${chatId || Date.now()}`,
    requireInteraction: true,
    data: {
      chatId: chatId,
      timestamp: Date.now()
    }
  };

  self.registration.showNotification(title, options);
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const action = event.action;
  const chatId = event.notification.data?.chatId;
  
  if (action === 'dismiss') return;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes('/') && 'focus' in client) {
            if (chatId) {
              client.postMessage({ action: 'openChat', chatId });
            }
            return client.focus();
          }
        }
        const url = chatId ? `/?chat=${chatId}` : '/';
        return clients.openWindow(url);
      })
  );
});

// Push-событие
self.addEventListener('push', (event) => {
  let data = { title: 'SPARK', body: 'Новое сообщение' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'SPARK', body: event.data.text() };
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'SPARK', {
      body: data.body || 'Новое сообщение',
      icon: data.icon || '/icon.png',
      badge: '/icon.png',
      vibrate: [200, 100, 200],
      data: data.data || {}
    })
  );
});