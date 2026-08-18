// ================================================================
// api.js - Toan bo API IoT cua he thong VAST
//
// NHOM 1 - ESP32 goi (BAT BUOC header  X-Device-Token )
//   POST /api/iot/telemetry              gui du lieu cam bien (3-5 giay/lan)
//   GET  /api/iot/command?device_id=...  lay lenh dang cho (1-3 giay/lan)
//   POST /api/iot/ack                    xac nhan da thuc hien lenh
//
// NHOM 2 - Website goi
//   GET  /api/iot/devices                danh sach thiet bi
//   GET  /api/iot/latest                 du lieu realtime tat ca thiet bi
//   GET  /api/iot/latest/:deviceId       du lieu realtime 1 thiet bi
//   GET  /api/iot/history/:deviceId      lich su (ve bieu do)
//   POST /api/iot/command                tao lenh dieu khien moi
//   GET  /api/iot/commands/:deviceId     20 lenh gan nhat (debug)
//
// BAO MAT (yeu cau muc 14):
//   - device_token nam trong header, khong nam tren URL.
//   - So sanh token kieu constant-time.
//   - device_token KHONG BAO GIO tra ve frontend.
//   - Validate/ep kieu toan bo so lieu tu ESP32.
// ================================================================

const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

// ----------------------------------------------------------------
// TIEN ICH
// ----------------------------------------------------------------

/** Ep kieu so, tra null neu khong hop le hoac ngoai khoang vat ly. */
function num(v, min, max) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n < min || n > max) return null;
    return n;
}

/** Ep ve 0/1. */
function bool01(v) {
    return (v === true || v === 1 || v === '1' || v === 'true' || v === 'TRUE') ? 1 : 0;
}

/** So sanh chuoi kieu constant-time -> chong do token bang do tre. */
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
        return false;
    }
}

/** Thiet bi con online khong (dua vao last_seen). */
function isOnline(lastSeenIso) {
    if (!lastSeenIso) return false;
    const t = Date.parse(lastSeenIso);
    if (Number.isNaN(t)) return false;
    return (Date.now() - t) / 1000 <= config.deviceOfflineSeconds;
}

/** Gop device + latest thanh JSON goi ve frontend. */
function shapeLatest(device) {
    const l = db.getLatest(device.device_id) || {};
    const online = isOnline(device.last_seen);

    return {
        device_id: device.device_id,
        pond_id: device.pond_id,
        name: device.name,

        // --- TRANG THAI KET NOI ---
        // Neu ESP32 khong gui telemetry trong deviceOfflineSeconds giay,
        // online = false -> website PHAI hien "Thiet bi mat ket noi",
        // khong duoc hien Online gia (yeu cau muc 5).
        online,
        offline_threshold_seconds: config.deviceOfflineSeconds,

        // --- CAM BIEN ---
        temperature: online ? l.temperature ?? null : l.temperature ?? null,
        do_value: l.do_value ?? null,

        // pH: hien tai ESP32 gui null vi CHUA GAN CAM BIEN pH (se dung GPIO34).
        // Khong tu bia so gia -> frontend se hien "Chua ket noi cam bien".
        ph: l.ph ?? null,
        ph_connected: l.ph !== null && l.ph !== undefined,

        // --- INA219 ---
        voltage: l.voltage ?? null,
        current_ma: l.current_ma ?? null,
        power_w: l.power_w ?? null,

        // --- THIET BI ---
        pump: !!l.pump_status,
        aerator: !!l.aerator_status,
        mode: l.mode || device.mode || 'AUTO',
        rssi: l.wifi_rssi ?? null,

        updated_at: l.updated_at || null,
        last_seen: device.last_seen || null,
    };
}

/**
 * Sinh danh sach canh bao tu du lieu moi nhat (yeu cau muc 10).
 * LUU Y QUAN TRONG: day chi la CANH BAO HIEN THI cho nguoi dung.
 * Viec BAT/TAT relay that su do ESP32 tu quyet dinh (AUTO mode chay local),
 * server/AI khong tham gia vao vong bao ve an toan.
 */
function buildAlerts(d) {
    const alerts = [];
    const th = config.thresholds;

    if (!d.online) {
        alerts.push({
            code: 'DEVICE_OFFLINE',
            level: 'danger',
            title: 'MAT KET NOI',
            message: `ESP32 (${d.device_id}) mat ket noi`,
            recommendation: 'Kiem tra nguon dien va Wi-Fi cua thiet bi. Che do AUTO van chay tren ESP32.',
        });
        return alerts; // Offline thi so lieu da cu, khong canh bao theo so cu nua
    }

    if (d.do_value !== null && d.do_value < th.doOn) {
        alerts.push({
            code: 'DO_LOW',
            level: 'danger',
            title: 'DO THAP',
            message: `DO ${d.do_value.toFixed(2)} mg/L (duoi ${th.doOn}) - He thong dang bat guong oxy`,
            recommendation: 'ESP32 da tu dong bat guong oxy. Theo doi den khi DO >= ' + th.doOff + ' mg/L.',
        });
    }

    if (d.temperature !== null && d.temperature > th.tempPumpOn) {
        alerts.push({
            code: 'TEMP_HIGH',
            level: 'warning',
            title: 'NHIET DO CAO',
            message: `Nhiet do nuoc ${d.temperature.toFixed(1)}°C (tren ${th.tempPumpOn}°C) - He thong dang bat may bom`,
            recommendation: 'ESP32 da tu dong bat may bom cap nuoc. Che dat them luoi che nang neu keo dai.',
        });
    }

    // --- CAU TRUC SAN cho canh bao motor/bom ket (chua bat mac dinh) ---
    const ca = config.currentAlarm;
    if (ca.enabled && d.current_ma !== null) {
        if (d.current_ma > ca.maxCurrentMa) {
            alerts.push({
                code: 'CURRENT_HIGH',
                level: 'danger',
                title: 'DONG DIEN BAT THUONG',
                message: `Dong dien ${Math.round(d.current_ma)} mA vuot nguong ${ca.maxCurrentMa} mA`,
                recommendation: 'Nghi ngo motor/bom bi ket hoac chap tai. Kiem tra ngay.',
            });
        } else if ((d.pump || d.aerator) && d.current_ma < ca.minRunningMa) {
            alerts.push({
                code: 'CURRENT_LOW',
                level: 'warning',
                title: 'THIET BI KHONG AN DONG',
                message: `Relay dang BAT nhung dong dien chi ${Math.round(d.current_ma)} mA`,
                recommendation: 'Nghi ngo dut day / hong motor. Kiem tra duong tai.',
            });
        }
    }

    return alerts;
}

// ----------------------------------------------------------------
// XAC THUC THIET BI
// ----------------------------------------------------------------
function authDevice(req, body) {
    const deviceId = (body && body.device_id) || req.query.get('device_id');
    const token = req.headers['x-device-token'] || (body && body.device_token);

    if (!deviceId) return { error: [400, 'Thieu device_id'] };
    if (!token) return { error: [401, 'Thieu device_token (header X-Device-Token)'] };

    const device = db.getDevice(String(deviceId));
    if (!device) return { error: [404, 'device_id chua duoc dang ky tren server. Chay: node seed.js'] };
    if (!safeEqual(device.device_token, String(token))) return { error: [401, 'device_token khong dung'] };

    return { device };
}

// ================================================================
// SSE - SERVER-SENT EVENTS  (day du lieu xuong web TUC THI)
// ----------------------------------------------------------------
// Truoc day web phai hoi server 2 giay/lan -> co the tre toi 2 giay.
// Bay gio server GIU SAN ket noi voi trinh duyet va DAY du lieu xuong
// NGAY khi ESP32 gui telemetry len -> do tre gan nhu bang 0.
//
// Dung SSE thay WebSocket vi:
//   - Chay duoc voi module http co san, khong can cai thu vien
//   - Trinh duyet tu dong ket noi lai khi rot mang
//   - Du dung vi day chi can 1 chieu: server -> web
// ================================================================

const sseClients = new Set();

/** Gom toan bo trang thai hien tai thanh 1 goi gui cho web. */
function buildSnapshot() {
    const data = db.listDevices().map(dev => {
        const s = shapeLatest(dev);
        s.alerts = buildAlerts(s);
        return s;
    });
    return {
        ok: true,
        server_time: new Date().toISOString(),
        thresholds: config.thresholds,
        data,
    };
}

/** Day trang thai moi nhat xuong TAT CA trinh duyet dang mo dashboard. */
function sseBroadcast() {
    if (sseClients.size === 0) return;
    const payload = 'data: ' + JSON.stringify(buildSnapshot()) + '\n\n';
    for (const res of sseClients) {
        try {
            res.write(payload);
        } catch {
            sseClients.delete(res);
        }
    }
}

// Day dinh ky 3 giay/lan ngay ca khi ESP32 im lang.
// Can thiet de web biet thiet bi da MAT KET NOI (khong con telemetry nao ve).
setInterval(sseBroadcast, 3000).unref?.();


// ================================================================
// CAC HANDLER
// ================================================================

const ALLOWED_COMMANDS = {
    SET_MODE: v => (v === 'MANUAL' ? 'MANUAL' : 'AUTO'),
    SET_PUMP: v => (bool01(v) ? 'true' : 'false'),
    SET_AERATOR: v => (bool01(v) ? 'true' : 'false'),

    // --- CHUA IMPLEMENT (muc 16 - may cho an tu dong) ---
    // Da co san o day + trong bang iot_commands nen khi lam may cho an
    // chi can xu ly ben ESP32, KHONG phai sua database/API.
    FEED_NOW: () => 'true',
    FEED_AMOUNT: v => String(num(v, 0, 100000) ?? 0),
    FEED_SCHEDULE: v => String(v ?? '').slice(0, 255),
};

const handlers = {

    // ---------------- ESP32: GUI TELEMETRY ----------------
    'POST /api/iot/telemetry': (req, res, body) => {
        const auth = authDevice(req, body);
        if (auth.error) return send(res, auth.error[0], { ok: false, error: auth.error[1] });

        const deviceId = auth.device.device_id;
        const b = body || {};

        const payload = {
            device_id: deviceId,
            // DS18B20 loi thuong tra -127 -> chan bang khoang hop le
            temperature: num(b.temperature, -40, 90),
            do_value: num(b.do ?? b.do_value, 0, 25),
            // pH: hien tai luon null (chua gan cam bien). Sau nay ESP32 gui so that
            // la cot nay tu co du lieu - KHONG phai sua server.
            ph: num(b.ph, 0, 14),
            voltage: num(b.voltage, 0, 60),
            current_ma: num(b.current ?? b.current_ma, -20000, 20000),
            power_w: num(b.power ?? b.power_w, -1000, 1000),
            pump_status: bool01(b.pump ?? b.pump_status),
            aerator_status: bool01(b.aerator ?? b.aerator_status),
            mode: b.mode === 'MANUAL' ? 'MANUAL' : 'AUTO',
            wifi_rssi: num(b.rssi ?? b.wifi_rssi, -120, 0),
        };

        // 1) Luon cap nhat du lieu MOI NHAT -> card realtime tren web doi ngay
        db.saveLatest(payload);
        db.touchDevice(deviceId, payload.mode);

        // 2) Chi ghi LICH SU moi historySampleSeconds giay (mac dinh 30s)
        //    -> ESP32 gui 3-5s/lan nhung database khong phinh nhanh (muc 9)
        let logged = false;
        const last = db.lastHistoryAt(deviceId);
        if (!last || (Date.now() - Date.parse(last)) / 1000 >= config.historySampleSeconds) {
            db.addHistory(payload);
            logged = true;
        }

        send(res, 200, {
            ok: true,
            history_logged: logged,
            server_time: new Date().toISOString(),
        });

        // DAY NGAY xuong trinh duyet - day la mau chot lam web cap nhat tuc thi
        sseBroadcast();
    },

    // ---------------- ESP32: LAY LENH ----------------
    'GET /api/iot/command': (req, res) => {
        const auth = authDevice(req, null);
        if (auth.error) return send(res, auth.error[0], { ok: false, error: auth.error[1] });

        const rows = db.pendingCommands(auth.device.device_id);
        // Danh dau 'sent' ngay: neu ESP32 mat dien truoc khi ack, lenh KHONG
        // bi gui lai lien tuc -> relay khong nhay lien tuc (yeu cau muc 3).
        rows.forEach(r => db.markSent(r.id));

        send(res, 200, {
            ok: true,
            server_time: new Date().toISOString(),
            commands: rows.map(r => ({ id: r.id, command: r.command, value: r.value })),
        });
    },

    // ---------------- ESP32: XAC NHAN DA THUC HIEN ----------------
    'POST /api/iot/ack': (req, res, body) => {
        const auth = authDevice(req, body);
        if (auth.error) return send(res, auth.error[0], { ok: false, error: auth.error[1] });

        const id = parseInt(body && body.command_id, 10);
        if (!Number.isInteger(id)) return send(res, 400, { ok: false, error: 'command_id khong hop le' });

        const changed = db.markDone(id, auth.device.device_id);
        send(res, 200, { ok: true, updated: changed });
    },

    // ---------------- WEB: DANH SACH THIET BI ----------------
    'GET /api/iot/devices': (req, res) => {
        // KHONG tra device_token ra frontend
        const devices = db.listDevices().map(d => ({
            device_id: d.device_id,
            pond_id: d.pond_id,
            name: d.name,
            mode: d.mode,
            online: isOnline(d.last_seen),
            last_seen: d.last_seen,
        }));
        send(res, 200, { ok: true, devices });
    },

    // ---------------- WEB: DU LIEU REALTIME (kieu hoi-dap) ----------------
    'GET /api/iot/latest': (req, res) => {
        send(res, 200, buildSnapshot());
    },

    // ---------------- WEB: LUONG REALTIME (kieu server tu day xuong) ----------------
    'GET /api/iot/stream': (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',        // chan proxy gom bo dem lam tre du lieu
            'Access-Control-Allow-Origin': '*',
        });

        // Bao trinh duyet: neu dut ket noi thi 2 giay sau tu noi lai
        res.write('retry: 2000\n\n');

        // Gui ngay trang thai hien tai de web co so lieu lien, khong cho
        res.write('data: ' + JSON.stringify(buildSnapshot()) + '\n\n');

        sseClients.add(res);

        // Nhip tim: giu ket noi khong bi router/trinh duyet cat vi im lang qua lau
        const nhipTim = setInterval(() => {
            try { res.write(': ping\n\n'); } catch { /* se don o su kien close */ }
        }, 20000);

        const donDep = () => {
            clearInterval(nhipTim);
            sseClients.delete(res);
        };
        req.on('close', donDep);
        req.on('error', donDep);
        res.on('error', donDep);
    },
};

// Cac route co tham so tren duong dan -> xu ly rieng ben duoi
function matchDynamic(method, pathname) {
    let m;
    if (method === 'GET' && (m = pathname.match(/^\/api\/iot\/latest\/([\w.-]+)$/))) {
        return { name: 'latestOne', deviceId: decodeURIComponent(m[1]) };
    }
    if (method === 'GET' && (m = pathname.match(/^\/api\/iot\/history\/([\w.-]+)$/))) {
        return { name: 'history', deviceId: decodeURIComponent(m[1]) };
    }
    if (method === 'GET' && (m = pathname.match(/^\/api\/iot\/commands\/([\w.-]+)$/))) {
        return { name: 'commands', deviceId: decodeURIComponent(m[1]) };
    }
    return null;
}

function handleDynamic(route, req, res) {
    const device = db.getDevice(route.deviceId);
    if (!device) return send(res, 404, { ok: false, error: 'Khong tim thay thiet bi' });

    if (route.name === 'latestOne') {
        const shaped = shapeLatest(device);
        shaped.alerts = buildAlerts(shaped);
        return send(res, 200, {
            ok: true, server_time: new Date().toISOString(),
            thresholds: config.thresholds, data: shaped,
        });
    }

    if (route.name === 'history') {
        const range = req.query.get('range') || '1d';
        const hours = { '1h': 1, '1d': 24, '7d': 24 * 7, '30d': 24 * 30 }[range] || 24;
        const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
        let rows = db.historySince(device.device_id, since);

        // GIAM SO DIEM cho bieu do muot (mac dinh toi da 300 diem).
        // Lay deu tay tu dau den cuoi, LUON giu diem MOI NHAT o cuoi cung.
        const MAX_POINTS = Math.min(2000, Math.max(20, parseInt(req.query.get('max') || '300', 10) || 300));
        if (rows.length > MAX_POINTS) {
            const buoc = rows.length / MAX_POINTS;
            const rutGon = [];
            for (let i = 0; i < MAX_POINTS; i++) rutGon.push(rows[Math.floor(i * buoc)]);
            if (rutGon[rutGon.length - 1] !== rows[rows.length - 1]) rutGon.push(rows[rows.length - 1]);
            rows = rutGon;
        }

        return send(res, 200, {
            ok: true,
            range,
            total_points: rows.length,
            points: rows.map(r => ({
                t: r.created_at,
                temperature: r.temperature,
                do_value: r.do_value,
                ph: r.ph,
                voltage: r.voltage,
                current_ma: r.current_ma,
                power_w: r.power_w,
            })),
        });
    }

    if (route.name === 'commands') {
        return send(res, 200, { ok: true, commands: db.recentCommands(device.device_id, 20) });
    }
}

// ---------------- WEB: TAO LENH DIEU KHIEN ----------------
handlers['POST /api/iot/command'] = (req, res, body) => {
    const b = body || {};
    const device = b.device_id && db.getDevice(String(b.device_id));
    if (!device) return send(res, 404, { ok: false, error: 'device_id khong ton tai' });

    const cmd = String(b.command || '');
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_COMMANDS, cmd)) {
        return send(res, 400, { ok: false, error: 'command khong hop le' });
    }

    const value = ALLOWED_COMMANDS[cmd](b.value);

    // Huy cac lenh cu cung loai con dang cho: nguoi dung bam nhieu lan
    // thi ESP32 chi nhan lenh MOI NHAT -> relay khong bat/tat lien tuc.
    db.supersede(device.device_id, cmd);
    const id = db.addCommand(device.device_id, cmd, value);

    send(res, 200, {
        ok: true,
        command_id: id,
        command: cmd,
        value,
        note: 'Lenh da vao hang doi. ESP32 lay trong 1-3 giay va gui trang thai THAT ve.',
    });
};

// ---------------- HEALTH ----------------
handlers['GET /api/health'] = (req, res) => {
    send(res, 200, {
        ok: true,
        service: 'VAST IoT Server',
        db_backend: db.backend,
        time: new Date().toISOString(),
        config: {
            deviceOfflineSeconds: config.deviceOfflineSeconds,
            historySampleSeconds: config.historySampleSeconds,
            thresholds: config.thresholds,
        },
    });
};

// ----------------------------------------------------------------
function send(res, status, obj) {
    const payload = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Cache-Control': 'no-store',
    });
    res.end(payload);
}

module.exports = { handlers, matchDynamic, handleDynamic, send };
