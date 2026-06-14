const CACHE_NAME = 'spark-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('fetch', e => { e.respondWith(fetch(e.request)); });
self.addEventListener('push', e => {
    let data = { title: 'SPARK', body: 'Новое сообщение' };
    if (e.data) try { data = e.data.json(); } catch(e) {}
    e.waitUntil(self.registration.showNotification(data.title || 'SPARK', {
        body: data.body, icon: 'https://spark-ead35.web.app/icon-192.png',
        badge: 'https://spark-ead35.web.app/icon-192.png', vibrate: [200, 100, 200]
    }));
});
self.addEventListener('notificationclick', e => {
    e.notification.close();
    e.waitUntil(clients.openWindow('/'));
});