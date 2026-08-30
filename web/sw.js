'use strict';

self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

    const title = data.title || 'Cảnh báo VAST';
    const options = {
        body: data.body || 'Ao nuôi có trạng thái cần kiểm tra.',
        icon: data.icon || '/assets/icon.png',
        badge: '/assets/icon.png',
        tag: data.tag || 'vast-alert',
        renotify: data.level === 'danger',
        requireInteraction: data.level === 'danger',
        vibrate: data.level === 'danger' ? [300, 120, 300, 120, 500] : [180, 80, 180],
        data: {
            url: data.url || '/dashboard.html',
            pond_id: data.pond_id || null,
            code: data.code || null,
        },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || '/dashboard.html', self.location.origin).href;
    event.waitUntil((async () => {
        const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            if (new URL(client.url).origin === self.location.origin) {
                await client.navigate(target);
                return client.focus();
            }
        }
        return clients.openWindow(target);
    })());
});

self.addEventListener('pushsubscriptionchange', event => {
    // Trinh duyet se cap subscription moi khi nguoi dung mo lai VAST; push.js
    // dong bo lai voi server. Khong gui token phien tu service worker.
    event.waitUntil(Promise.resolve());
});
