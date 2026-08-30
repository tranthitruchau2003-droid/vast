(function () {
    'use strict';
    const KEY = 'vast_device_id';

    function id() {
        let value = '';
        try { value = localStorage.getItem(KEY) || ''; } catch { /* bo qua */ }
        if (!/^[A-Za-z0-9._:-]{12,80}$/.test(value)) {
            const random = (crypto && crypto.randomUUID)
                ? crypto.randomUUID().replace(/-/g, '')
                : (Date.now().toString(36) + Math.random().toString(36).slice(2));
            value = 'dev_' + random.slice(0, 40);
            try { localStorage.setItem(KEY, value); } catch { /* bo qua */ }
        }
        return value;
    }

    function type() {
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
            ? 'mobile' : 'desktop';
    }

    function name() {
        const mobile = type() === 'mobile';
        let browser = 'Trình duyệt';
        const ua = navigator.userAgent || '';
        if (/Edg\//.test(ua)) browser = 'Edge';
        else if (/Chrome\//.test(ua)) browser = 'Chrome';
        else if (/Firefox\//.test(ua)) browser = 'Firefox';
        else if (/Safari\//.test(ua)) browser = 'Safari';
        return (mobile ? 'Dien thoai' : 'May tinh') + ' - ' + browser;
    }

    function get() {
        return { device_id: id(), device_type: type(), device_name: name() };
    }

    function headers() {
        const d = get();
        return {
            'X-VAST-Device-ID': d.device_id,
            'X-VAST-Device-Type': d.device_type,
            'X-VAST-Device-Name': d.device_name,
        };
    }

    function authHeaders(json = false) {
        const h = headers();
        try {
            const token = localStorage.getItem('vast_session_token') || '';
            if (token) h['X-Session-Token'] = token;
        } catch { /* bo qua */ }
        if (json) h['Content-Type'] = 'application/json';
        return h;
    }

    window.VAST_DEVICE = { get, headers, authHeaders };
})();
