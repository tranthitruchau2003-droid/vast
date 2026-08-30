'use strict';

const fs = require('fs');
const path = require('path');
const webPush = require('web-push');
const db = require('../lib/db');

const DATA_DIR = path.join(__dirname, '..', 'data');
const KEY_FILE = path.join(DATA_DIR, 'push-vapid.json');
const activeAlerts = new Map();
const REMIND_MS = 15 * 60 * 1000;

function loadKeys() {
    const fromEnv = {
        publicKey: String(process.env.VAPID_PUBLIC_KEY || '').trim(),
        privateKey: String(process.env.VAPID_PRIVATE_KEY || '').trim(),
    };
    if (fromEnv.publicKey && fromEnv.privateKey) return fromEnv;

    try {
        const saved = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
        if (saved.publicKey && saved.privateKey) return saved;
    } catch { /* tao moi o duoi */ }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    const generated = webPush.generateVAPIDKeys();
    fs.writeFileSync(KEY_FILE, JSON.stringify(generated, null, 2), { mode: 0o600 });
    return generated;
}

const keys = loadKeys();
webPush.setVapidDetails(
    String(process.env.VAPID_SUBJECT || 'mailto:support@vast.vn'),
    keys.publicKey,
    keys.privateKey
);

function publicKey() { return keys.publicKey; }

function parseSubscription(row) {
    try { return JSON.parse(row.subscription_json); }
    catch { return null; }
}

async function sendRow(row, payload) {
    const subscription = parseSubscription(row);
    if (!subscription || !subscription.endpoint) {
        db.pushSubscriptionDeleteEndpoint(row.endpoint);
        return false;
    }
    try {
        await webPush.sendNotification(subscription, JSON.stringify(payload), {
            TTL: 120,
            urgency: payload.level === 'danger' ? 'high' : 'normal',
        });
        return true;
    } catch (error) {
        const status = Number(error && error.statusCode);
        if (status === 404 || status === 410) {
            db.pushSubscriptionDeleteEndpoint(row.endpoint);
            return false;
        }
        console.error('[PUSH] Khong gui duoc:', error && error.message || error);
        return false;
    }
}

async function sendUser(userId, payload) {
    const rows = db.pushSubscriptionListUser(userId);
    const results = await Promise.all(rows.map(row => sendRow(row, payload)));
    return { total: rows.length, sent: results.filter(Boolean).length };
}

function register(userId, deviceId, subscription) {
    if (!subscription || typeof subscription !== 'object'
        || !String(subscription.endpoint || '').startsWith('https://')
        || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
        return { error: 'Thông tin đăng ký thông báo không hợp lệ' };
    }
    db.pushSubscriptionUpsert(userId, deviceId, subscription);
    return { ok: true };
}

function unregister(userId, endpoint) {
    db.pushSubscriptionDelete(userId, String(endpoint || ''));
    return { ok: true };
}

function status(userId, endpoint) {
    const rows = db.pushSubscriptionListUser(userId);
    return {
        enabled: !!endpoint && rows.some(row => row.endpoint === endpoint),
        devices: rows.length,
    };
}

async function sendTest(userId) {
    return sendUser(userId, {
        title: 'VAST đã bật thông báo',
        body: 'Điện thoại này sẽ nhận cảnh báo ao nuôi ngay cả khi ứng dụng đang đóng.',
        level: 'info',
        tag: 'vast-push-test',
        url: '/dashboard.html',
        icon: '/assets/icon.png',
        timestamp: Date.now(),
    });
}

/**
 * Gui khi canh bao moi xuat hien, va nhac lai sau 15 phut neu van nguy hiem.
 * Khi chi so tro ve an toan, xoa trang thai de lan nguy hiem sau lai duoc bao.
 */
async function evaluateDevice(device, alerts) {
    if (!device || !device.pond_id) return;
    const pond = db.pondGet(device.pond_id);
    if (!pond || !pond.user_id) return;

    const currentCodes = new Set((alerts || []).map(alert => alert.code));
    const prefix = `${pond.user_id}|${device.device_id}|`;
    for (const key of [...activeAlerts.keys()]) {
        if (key.startsWith(prefix) && !currentCodes.has(key.slice(prefix.length))) activeAlerts.delete(key);
    }

    for (const alert of alerts || []) {
        const key = prefix + alert.code;
        const previous = activeAlerts.get(key);
        const now = Date.now();
        if (previous && now - previous.sentAt < REMIND_MS) continue;

        const result = await sendUser(pond.user_id, {
            title: `VAST – ${pond.name}: ${alert.title}`,
            body: `${alert.message}. ${alert.recommendation || ''}`.trim(),
            level: alert.level || 'warning',
            tag: `vast-${device.device_id}-${alert.code}`,
            url: `/dashboard.html?pond=${encodeURIComponent(pond.pond_id)}`,
            icon: '/assets/icon.png',
            pond_id: pond.pond_id,
            device_id: device.device_id,
            code: alert.code,
            timestamp: now,
        });
        // Van ghi nho khi chua co subscription, tranh loop gui moi 3 giay.
        activeAlerts.set(key, { sentAt: now, sent: result.sent });
    }
}

module.exports = {
    publicKey,
    register,
    unregister,
    status,
    sendTest,
    evaluateDevice,
};
