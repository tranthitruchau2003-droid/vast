(function () {
    'use strict';

    const state = { supported: false, permission: 'default', enabled: false, busy: false };

    function api(path) {
        return (window.VAST_CONFIG?.API_BASE || '').replace(/\/$/, '') + path;
    }

    async function call(path, options = {}) {
        const response = await fetch(api(path), {
            ...options,
            headers: {
                ...window.VAST_DEVICE.authHeaders(!!options.body),
                ...(options.headers || {}),
            },
        });
        let data = null;
        try { data = await response.json(); } catch { data = null; }
        if (!response.ok || !data?.ok) throw new Error(data?.error || 'Không kết nối được máy chủ');
        return data;
    }

    function applicationKey(value) {
        const padding = '='.repeat((4 - value.length % 4) % 4);
        const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
    }

    function message(text, error = false) {
        const box = document.getElementById('pushMessage');
        if (!box) return;
        box.textContent = text || '';
        box.hidden = !text;
        box.className = 'mt-4 p-4 rounded-2xl font-bold border '
            + (error ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-800 border-green-200');
    }

    function render() {
        const status = document.getElementById('pushStatus');
        const enable = document.getElementById('pushEnableButton');
        const disable = document.getElementById('pushDisableButton');
        const test = document.getElementById('pushTestButton');
        if (!status || !enable || !disable || !test) return;

        if (!state.supported) {
            status.textContent = 'Trình duyệt này chưa hỗ trợ thông báo nền.';
            status.className = 'font-black text-red-700';
        } else if (state.permission === 'denied') {
            status.textContent = 'Thông báo đang bị chặn trong cài đặt trình duyệt.';
            status.className = 'font-black text-red-700';
        } else if (state.enabled) {
            status.textContent = 'Đã bật trên điện thoại này';
            status.className = 'font-black text-green-700';
        } else {
            status.textContent = 'Chưa bật trên điện thoại này';
            status.className = 'font-black text-amber-700';
        }

        enable.hidden = !state.supported || state.enabled || state.permission === 'denied';
        disable.hidden = !state.enabled;
        test.hidden = !state.enabled;
        for (const button of [enable, disable, test]) button.disabled = state.busy;
    }

    async function registration() {
        return navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }

    async function refresh() {
        state.supported = window.isSecureContext
            && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        state.permission = 'Notification' in window ? Notification.permission : 'denied';
        if (!state.supported) { state.enabled = false; render(); return; }
        try {
            const reg = await registration();
            const subscription = await reg.pushManager.getSubscription();
            state.enabled = !!subscription && Notification.permission === 'granted';
            if (subscription) {
                // Tu sua subscription bi mat tren server sau restore database/deploy.
                await call('/api/push/subscribe', {
                    method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }),
                });
            }
        } catch {
            state.enabled = false;
        }
        render();
    }

    async function enable() {
        if (state.busy) return;
        state.busy = true; message(''); render();
        try {
            if (!state.supported) throw new Error('Điện thoại hoặc trình duyệt chưa hỗ trợ Web Push.');
            const permission = await Notification.requestPermission();
            state.permission = permission;
            if (permission !== 'granted') throw new Error('Bạn chưa cho phép VAST gửi thông báo.');

            const reg = await registration();
            const config = await call('/api/push/config');
            let subscription = await reg.pushManager.getSubscription();
            if (!subscription) {
                subscription = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: applicationKey(config.public_key),
                });
            }
            await call('/api/push/subscribe', {
                method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }),
            });
            state.enabled = true;
            message('Đã bật cảnh báo nền. VAST vẫn có thể báo khi ứng dụng đang đóng.');
        } catch (error) {
            message(error.message || 'Chưa bật được thông báo.', true);
        } finally {
            state.busy = false; render();
        }
    }

    async function disable() {
        if (state.busy) return;
        state.busy = true; message(''); render();
        try {
            const reg = await registration();
            const subscription = await reg.pushManager.getSubscription();
            if (subscription) {
                await call('/api/push/unsubscribe', {
                    method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }),
                });
                await subscription.unsubscribe();
            }
            state.enabled = false;
            message('Đã tắt cảnh báo nền trên thiết bị này.');
        } catch (error) {
            message(error.message || 'Chưa tắt được thông báo.', true);
        } finally {
            state.busy = false; render();
        }
    }

    async function test() {
        if (state.busy) return;
        state.busy = true; message('Đang gửi thông báo thử...'); render();
        try {
            await call('/api/push/test', { method: 'POST', body: '{}' });
            message('Đã gửi. Hãy kiểm tra thanh thông báo của điện thoại.');
        } catch (error) {
            message(error.message || 'Chưa gửi được thông báo thử.', true);
        } finally {
            state.busy = false; render();
        }
    }

    window.VAST_PUSH = { refresh, enable, disable, test, render };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refresh, { once: true });
    } else {
        refresh();
    }
    document.addEventListener('htmx:afterSwap', () => setTimeout(refresh, 0));
})();
