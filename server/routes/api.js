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
const os = require('os');
const db = require('../lib/db');
const config = require('../config');
const market = require('../services/market');
const feed = require('../services/feed');
const auth = require('../lib/auth');
const trace = require('../services/trace');
const advisor = require('../services/advisor');
const ask = require('../services/ask');
const qr = require('../lib/qr');
const kb = require('../services/kb');
const harvest = require('../services/harvest');

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

        // --- MAY CHO AN ---
        feeder: trangThaiChoAn.get(device.device_id) || null,

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
            title: 'MẤT KẾT NỐI',
            message: `ESP32 (${d.device_id}) mất kết nối`,
            recommendation: 'Kiểm tra nguồn điện và Wi-Fi của thiết bị. Chế độ AUTO vẫn chạy trên ESP32.',
        });
        return alerts; // Offline thi so lieu da cu, khong canh bao theo so cu nua
    }

    if (d.do_value !== null && d.do_value < th.doOn) {
        alerts.push({
            code: 'DO_LOW',
            level: 'danger',
            title: 'DO THẤP',
            message: `DO ${d.do_value.toFixed(2)} mg/L (dưới ${th.doOn}) — hệ thống đang bật guồng oxy`,
            recommendation: 'ESP32 đã tự động bật guồng oxy. Theo dõi đến khi DO ≥ ' + th.doOff + ' mg/L.',
        });
    }

    if (d.temperature !== null && d.temperature > th.tempPumpOn) {
        alerts.push({
            code: 'TEMP_HIGH',
            level: 'warning',
            title: 'NHIỆT ĐỘ CAO',
            message: `Nhiệt độ nước ${d.temperature.toFixed(1)}°C (trên ${th.tempPumpOn}°C) — hệ thống đang bật máy bơm`,
            recommendation: 'ESP32 đã tự động bật máy bơm cấp nước. Cân nhắc che thêm lưới chắn nắng nếu kéo dài.',
        });
    }

    // --- CAU TRUC SAN cho canh bao motor/bom ket (chua bat mac dinh) ---
    const ca = config.currentAlarm;
    if (ca.enabled && d.current_ma !== null) {
        if (d.current_ma > ca.maxCurrentMa) {
            alerts.push({
                code: 'CURRENT_HIGH',
                level: 'danger',
                title: 'DÒNG ĐIỆN BẤT THƯỜNG',
                message: `Dòng điện ${Math.round(d.current_ma)} mA vượt ngưỡng ${ca.maxCurrentMa} mA`,
                recommendation: 'Nghi ngờ motor hoặc bơm bị kẹt, hoặc chập tải. Kiểm tra ngay.',
            });
        } else if ((d.pump || d.aerator) && d.current_ma < ca.minRunningMa) {
            alerts.push({
                code: 'CURRENT_LOW',
                level: 'warning',
                title: 'THIẾT BỊ KHÔNG ĂN DÒNG',
                message: `Relay đang BẬT nhưng dòng điện chỉ ${Math.round(d.current_ma)} mA`,
                recommendation: 'Nghi ngờ đứt dây hoặc hỏng motor. Kiểm tra đường tải.',
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

// Trang thai may cho an do ESP32 bao len (khong can luu database).
// Mat dien ESP32 -> mat luon, dung: luc do web cung phai coi la khong biet.
const trangThaiChoAn = new Map();   // device_id -> { state, busy, last_g, meals, at }

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

    // --- MAY CHO AN TU DONG ---
    FEED_NOW: () => 'true',
    FEED_AMOUNT: v => String(num(v, 0, 100000) ?? 0),
    FEED_SCHEDULE: v => String(v ?? '').slice(0, 255),
    FEED_STOP: () => 'true',

    // Chay thu rieng 1 motor. Dang:
    //   "1" / "2"     chay 3 giay (nghe tieng motor)
    //   "1:15"        giu 15 giay - du lau de cam dong ho do dien ap ra OUT
    FEED_TEST: v => {
        const m = String(v).match(/^([12])(?::(\d{1,2}))?$/);
        if (!m) return '1';
        const giay = m[2] ? Math.min(60, Math.max(1, parseInt(m[2], 10))) : 0;
        return giay ? `${m[1]}:${giay}` : m[1];
    },

    // Quay vit tai N giay de can cam (hieu chuan). Chan 1-60 giay.
    FEED_CALIBRATE: v => String(num(v, 1, 60) ?? 10),

    // He so hieu chuan (gam/giay) web tinh san -> ESP32 ghi vao bo nho trong.
    // Khoang cho phep rong nhung khong the la 0 hay so am, vi chia cho no.
    FEED_SET_CALIB: v => String(num(v, 0.1, 100000) ?? 0),
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

        // ---- MAY CHO AN: trang thai THAT tu ESP32 ----
        // Khong luu vao bang lich su (khong can ve bieu do), chi giu trong
        // bo nho de dashboard biet motor co dang quay khong.
        trangThaiChoAn.set(deviceId, {
            state: typeof b.feeder_state === 'string' ? b.feeder_state.slice(0, 40) : null,
            busy: b.feeder_busy === true,
            last_g: num(b.feeder_last_g, 0, 100000),
            meals: num(b.feeder_meals, 0, 100000),
            grams_per_sec: num(b.feeder_gps, 0, 100000),
            at: new Date().toISOString(),
        });

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

// ================================================================
// NHOM 3 - THI TRUONG: GIA TOM
// ----------------------------------------------------------------
//   GET  /api/market/prices?species=the|su   bang gia hien tai
//   GET  /api/market/history?code=THE30&days=30   lich su de ve bieu do
//   POST /api/market/refresh                 lay gia ngay (nut "Lam moi")
//   POST /api/market/manual                  nhap gia tay (co bao ve)
//
// Gia tri tra ve LUON kem updated_at + stale, de giao dien noi THAT
// voi nguoi nuoi la so lieu moi hay cu - khong bao gio hien gia gia.
// ================================================================

handlers['GET /api/market/prices'] = (req, res) => {
    const sp = req.query.get('species');
    const species = ['the', 'su', 'cang_xanh', 'hum', 'other'].includes(sp) ? sp : null;
    send(res, 200, market.snapshot({ species }));
};

// ================================================================
// GIA VAT TU DAU VAO
// ----------------------------------------------------------------
// SU THAT VE NGUON:
//   - CON GIONG: tepbac CO cong bo -> lay tu dong, cap nhat y het gia tom
//   - CAM, VI SINH, HOA CHAT: tepbac KHONG theo doi. Da kiem: trang gia
//     cua ho chi co "Gia tom" va "Gia ca", khong co muc nao cho vat tu.
//     Cung khong tim duoc nguon mien phi nao cong bo gia cam theo ngay.
//     -> Phai do nguoi nuoi nhap gia dai ly bao. Bu lai gia do CHINH XAC
//        HON gia tham khao, vi la gia that ban mua.
//
// Giao dien phai ghi RO dong nao tu dong, dong nao tu nhap. Tron lan
// hai loai la nguoi dung tuong ca bang deu duoc cap nhat tu dong.
// ================================================================

const LOAI_VAT_TU = {
    cam: { ten: 'Thức ăn', icon: 'package' },
    xu_ly: { ten: 'Xử lý môi trường', icon: 'flask-conical' },
    thuoc: { ten: 'Thuốc', icon: 'pill' },
    khac: { ten: 'Khác', icon: 'box' },
};

handlers['GET /api/market/supplies'] = (req, res) => {
    const u = canDangNhap(req, res); if (!u) return;

    // 1) CON GIONG - lay tu bang gia tepbac (that, tu dong)
    const snap = market.snapshot({});
    const giong = (snap.items || [])
        .filter(i => i.is_seed && Number.isFinite(i.price))
        .map(i => ({
            id: 'auto_' + i.code,
            loai: 'giong',
            loai_ten: 'Con giống',
            icon: 'droplets',
            ten: i.name,
            quy_cach: i.species_label,
            nha_cung_cap: null,
            gia: i.price,
            don_vi: i.unit,
            change_pct: i.change_pct,
            change_period: i.change_period,
            direction: i.direction,
            tu_dong: true,
            nguon: 'Tép Bạc',
            cap_nhat_text: i.source_updated_text,
            cu: i.source_stale,
        }));

    // 2) CAM / VOI / HOA CHAT - gia tham khao toan quoc, tu dong tu tepbac
    //    (trang https://tepbac.com/gia-thuy-san/gia/vat-tu)
    //    Bo cac muc danh cho CA: nguoi dung nuoi tom.
    const tuDong = (db.supplyAutoAll() || [])
        .filter(v => v.loai_nuoi !== 'ca' && Number.isFinite(v.gia))
        .map(v => ({
            id: 'auto_vt_' + v.code,
            loai: v.loai,
            loai_ten: (LOAI_VAT_TU[v.loai] || LOAI_VAT_TU.khac).ten,
            icon: (LOAI_VAT_TU[v.loai] || LOAI_VAT_TU.khac).icon,
            ten: v.ten,
            quy_cach: null,
            nha_cung_cap: null,
            gia: v.gia,
            gia_truoc: v.gia_truoc,
            don_vi: v.don_vi,
            change_pct: v.change_pct,
            change_period: v.change_period,
            direction: !Number.isFinite(v.change_pct) || v.change_pct === 0
                ? 'flat' : (v.change_pct > 0 ? 'up' : 'down'),
            tu_dong: true,
            nguon: 'Tép Bạc',
            cap_nhat_text: v.source_updated_text,
            cu: Number.isFinite(v.source_age_days) && v.source_age_days > 14,
        }));

    // 3) CAM / HOA CHAT / THUOC - nguoi dung tu nhap
    const tuNhap = db.supplyList(u.id).map(v => {
        let pct = null;
        if (Number.isFinite(v.gia_truoc) && v.gia_truoc > 0) {
            pct = Math.round(((v.gia - v.gia_truoc) / v.gia_truoc) * 1000) / 10;
        }
        const ngay = v.updated_at
            ? Math.floor((Date.now() - Date.parse(v.updated_at)) / 86400000) : null;

        return {
            id: v.id,
            loai: v.loai,
            loai_ten: (LOAI_VAT_TU[v.loai] || LOAI_VAT_TU.khac).ten,
            icon: (LOAI_VAT_TU[v.loai] || LOAI_VAT_TU.khac).icon,
            ten: v.ten,
            quy_cach: v.quy_cach,
            nha_cung_cap: v.nha_cung_cap,
            gia: v.gia,
            gia_truoc: v.gia_truoc,
            don_vi: v.don_vi,
            ghi_chu: v.ghi_chu,
            change_pct: pct,
            direction: pct === null || pct === 0 ? 'flat' : (pct > 0 ? 'up' : 'down'),
            tu_dong: false,
            nguon: 'Bạn tự nhập',
            cap_nhat_text: ngay === null ? null
                : (ngay === 0 ? 'hôm nay' : (ngay === 1 ? 'hôm qua' : ngay + ' ngày trước')),
            // Gia vat tu tu nhap qua 30 ngay thi gan nhu chac chan da doi
            cu: ngay !== null && ngay > 30,
            updated_at: v.updated_at,
        };
    });

    send(res, 200, {
        ok: true,
        giong,
        tu_dong: tuDong,
        tu_nhap: tuNhap,
        loai: LOAI_VAT_TU,
        vt_loi: market.state.vtLastError || null,
        ghi_chu_nguon: 'Con giống và giá vật tư tham khảo lấy tự động từ Tép Bạc, '
            + 'cập nhật cùng nhịp với giá tôm. Giá tham khảo là giá trung bình toàn quốc — '
            + 'giá đại lý báo cho trại bạn thường lệch, nên phần "Bạn tự nhập" mới là '
            + 'con số đúng để tính chi phí.',
    });
};

/**
 * Khoa nhan dang 1 muc vat tu: ten (bo dau, bo khoang trang thua) + don vi.
 * Dung de biet nguoi dung dang NHAP LAI gia cua muc da co, khong phai them moi.
 */
function khoaVatTu(ten, donVi) {
    const t = String(ten || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0111/g, 'd').replace(/\u0110/g, 'D')
        .toLowerCase().replace(/\s+/g, ' ').trim();
    const d = String(donVi || '').toLowerCase().replace(/\s+/g, '').trim();
    return t + '|' + d;
}

handlers['POST /api/market/supplies'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const b = body || {};

    const ten = String(b.ten || '').replace(/\s+/g, ' ').trim();
    if (!ten) return send(res, 400, { ok: false, error: 'Vui lòng nhập tên vật tư' });

    const gia = soTien(b.gia);
    if (gia === null || gia <= 0) return send(res, 400, { ok: false, error: 'Giá không hợp lệ' });

    const loai = LOAI_VAT_TU[b.loai] ? b.loai : 'khac';
    const duLieu = {
        user_id: u.id,
        loai,
        ten: ten.slice(0, 120),
        quy_cach: b.quy_cach ? String(b.quy_cach).slice(0, 60) : null,
        nha_cung_cap: b.nha_cung_cap ? String(b.nha_cung_cap).slice(0, 120) : null,
        gia,
        don_vi: String(b.don_vi || 'đ/kg').slice(0, 20),
        ghi_chu: b.ghi_chu ? String(b.ghi_chu).slice(0, 200) : null,
    };

    if (b.id) {
        const n = db.supplyUpdate(parseInt(b.id, 10), u.id, duLieu);
        if (!n) return send(res, 404, { ok: false, error: 'Không tìm thấy vật tư' });
        return send(res, 200, { ok: true, id: parseInt(b.id, 10), updated: true });
    }

    // Nguoi nuoi bao gia lai bang cach bam "Them" roi go lai dung ten cu
    // (vi du dai ly bao gia cam moi thang). Neu cu the ma tao dong moi thi
    // danh sach day ban trung va % tang/giam khong bao gio tinh duoc.
    // -> Trung ten (bo dau, bo hoa thuong) + trung don vi thi COI LA SUA GIA.
    const dsCu = db.supplyList(u.id);
    const khoa = khoaVatTu(duLieu.ten, duLieu.don_vi);
    const trung = dsCu.find(v => khoaVatTu(v.ten, v.don_vi) === khoa);
    if (trung) {
        // Giu nguyen ten da luu: nguoi dung dang bao GIA MOI chu khong doi ten.
        // (Muon sua ten thi bam nut but chi - duong di co b.id o tren.)
        db.supplyUpdate(trung.id, u.id, { ...duLieu, ten: trung.ten });
        return send(res, 200, { ok: true, id: trung.id, updated: true, gop: true });
    }

    if (dsCu.length >= 50) {
        return send(res, 400, { ok: false, error: 'Tối đa 50 mục vật tư' });
    }
    const id = db.supplyCreate(duLieu);
    send(res, 200, { ok: true, id, created: true });
};

handlers['POST /api/market/supplies/delete'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const id = parseInt((body || {}).id, 10);
    if (!Number.isInteger(id)) return send(res, 400, { ok: false, error: 'id không hợp lệ' });
    const n = db.supplyDelete(id, u.id);
    if (!n) return send(res, 404, { ok: false, error: 'Không tìm thấy vật tư' });
    send(res, 200, { ok: true });
};

handlers['GET /api/market/history'] = (req, res) => {
    const code = req.query.get('code');
    if (!code) return send(res, 400, { ok: false, error: 'Thiếu tham số code' });
    send(res, 200, market.history(code, req.query.get('days') || 30));
};

handlers['POST /api/market/refresh'] = async (req, res) => {
    const r = await market.refresh({ force: false });
    // Du lay that bai van tra ve bang gia cu -> giao dien khong bi trong
    send(res, 200, {
        ...market.snapshot({}),
        refreshed: r.ok === true && !r.skipped,
        refresh_result: r,
    });
};

/**
 * Kiem tra quyen nhap gia tay.
 *  - Co dat market.adminToken  -> bat buoc header X-Admin-Token dung
 *  - Khong dat                 -> CHI cho phep tu chinh may chay server
 * Lam vay de khong ai trong mang LAN sua duoc bang gia cua ban.
 */
function canEditMarket(req) {
    const token = config.market && config.market.adminToken;
    if (token) {
        const given = req.headers['x-admin-token'];
        return typeof given === 'string' && safeEqual(String(token), given);
    }
    const ip = String(req.socket.remoteAddress || '');
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

handlers['POST /api/market/manual'] = (req, res, body) => {
    if (!canEditMarket(req)) {
        return send(res, 403, {
            ok: false,
            error: 'Không có quyền sửa bảng giá. Đặt market.adminToken trong server/config.json '
                + 'rồi gửi kèm header X-Admin-Token, hoặc thao tác ngay trên máy chạy server.',
        });
    }

    const b = body || {};
    const items = Array.isArray(b.items) ? b.items : (b.code ? [b] : null);
    if (!items || !items.length) {
        return send(res, 400, { ok: false, error: 'Thiếu danh sách items (mỗi mục cần code và price)' });
    }
    if (items.length > 100) {
        return send(res, 400, { ok: false, error: 'Tối đa 100 mục mỗi lần' });
    }

    const r = market.saveManual(items);
    send(res, 200, { ok: true, ...r, ...market.snapshot({}) });
};

// ================================================================
// NHOM 4 - MAY CHO AN TU DONG
// ----------------------------------------------------------------
//   GET  /api/feed/plan?pond_id=...   khau phan hom nay cua 1 ao
//   GET  /api/feed/plans              khau phan tat ca cac ao
//   POST /api/feed/settings           luu thong so ao (giong, ty le song, lich cu)
//   POST /api/feed/sample             ghi ket qua CHAI MAU -> cap nhat W
//   POST /api/feed/refill             nap them cam vao may
//   POST /api/feed/run                xa 1 cu NGAY BAY GIO
//   GET  /api/feed/logs?pond_id=...   nhat ky cho an
//
// Cong thuc nam trong feed.js, o day chi lo phan ghep du lieu.
// ================================================================

/** Ghep thong so ao + so lieu cam bien -> khau phan hoan chinh. */
function buildFeedPlan(pondId) {
    const row = db.feedGet(pondId);
    const device = db.listDevices().find(d => d.pond_id === pondId) || null;
    const latest = device ? shapeLatest(device) : null;

    let mealTimes = null;
    if (row && row.meal_times) {
        try { mealTimes = JSON.parse(row.meal_times); } catch { mealTimes = null; }
    }

    const ao = {
        seedCount: row ? row.seed_count : null,
        survivalPct: row ? row.survival_pct : null,
        avgWeightG: row ? row.avg_weight_g : null,
        ratePct: row ? row.rate_pct : null,
        mealsPerDay: row ? row.meals_per_day : null,
        mealTimes,
        feedStockKg: row ? row.feed_stock_kg : null,
        feedStockMaxKg: row ? row.feed_stock_max_kg : null,
    };

    // QUAN TRONG: chi dieu chinh khau phan theo cam bien khi thiet bi ONLINE.
    // Neu ESP32 mat ket noi, so DO/nhiet do trong database la so CU - dung no
    // de cat khau phan thi tom bi doi oan. Offline thi cho an theo bang chuan.
    const online = !!(latest && latest.online);
    const env = online ? { do_value: latest.do_value, temperature: latest.temperature } : {};

    const plan = feed.tinhKhauPhan(ao, env, config.feed || {});

    plan.pond_id = pondId;
    plan.device_id = device ? device.device_id : null;
    plan.sensor_online = online;
    plan.sensor_note = online
        ? null
        : 'Thiết bị mất kết nối — khẩu phần tính theo bảng chuẩn, chưa điều chỉnh theo oxy/nhiệt độ thực tế.';
    plan.auto_enabled = row ? row.auto_enabled !== 0 : true;
    plan.sample_at = row ? row.sample_at : null;
    plan.updated_at = row ? row.updated_at : null;

    if (plan.ok) {
        plan.next_meal = feed.cuAnKeTiep(plan.mealTimes);

        // Da xa bao nhieu cu trong hom nay
        const dauNgay = new Date(); dauNgay.setHours(0, 0, 0, 0);
        const logs = db.feedLogSince(pondId, dauNgay.toISOString())
            .filter(l => l.kind === 'auto' || l.kind === 'manual');
        plan.today_meals = logs.length;
        plan.today_fed_kg = Math.round(logs.reduce((t, l) => t + (l.amount_kg || 0), 0) * 100) / 100;
    }

    return plan;
}

handlers['GET /api/feed/plan'] = (req, res) => {
    const pondId = req.query.get('pond_id');
    if (!pondId) return send(res, 400, { ok: false, error: 'Thiếu pond_id' });
    send(res, 200, { ok: true, server_time: new Date().toISOString(), plan: buildFeedPlan(String(pondId)) });
};

handlers['GET /api/feed/plans'] = (req, res) => {
    // Gop cac ao co trong bang thiet bi VA cac ao da khai bao thong so cho an
    const ids = new Set();
    db.listDevices().forEach(d => ids.add(d.pond_id));
    db.feedAll().forEach(f => ids.add(f.pond_id));

    send(res, 200, {
        ok: true,
        server_time: new Date().toISOString(),
        plans: [...ids].map(id => buildFeedPlan(id)),
    });
};

handlers['POST /api/feed/settings'] = (req, res, body) => {
    const b = body || {};
    const pondId = String(b.pond_id || '').trim();
    if (!pondId) return send(res, 400, { ok: false, error: 'Thiếu pond_id' });

    const cu = db.feedGet(pondId) || {};
    const soCu = (v, cuV) => {
        if (v === undefined || v === null || v === '') return cuV ?? null;
        const x = Number(v);
        return Number.isFinite(x) ? x : (cuV ?? null);
    };

    // Chan so vo ly ngay tu cua vao - sai 1 con so o day la sai ca khau phan
    const seed = soCu(b.seed_count, cu.seed_count);
    const sv = soCu(b.survival_pct, cu.survival_pct);
    const w = soCu(b.avg_weight_g, cu.avg_weight_g);
    if (seed !== null && (seed < 0 || seed > 100000000)) return send(res, 400, { ok: false, error: 'Số con giống không hợp lệ' });
    if (sv !== null && (sv <= 0 || sv > 100)) return send(res, 400, { ok: false, error: 'Tỷ lệ sống phải trong khoảng 1-100%' });
    if (w !== null && (w <= 0 || w > 200)) return send(res, 400, { ok: false, error: 'Trọng lượng trung bình không hợp lệ (0-200 g/con)' });

    let mealTimes = null;
    if (Array.isArray(b.meal_times)) {
        mealTimes = b.meal_times
            .map(t => String(t).trim())
            .filter(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))
            .slice(0, 8);
        if (!mealTimes.length) mealTimes = null;
    } else if (cu.meal_times) {
        try { mealTimes = JSON.parse(cu.meal_times); } catch { mealTimes = null; }
    }

    db.feedSave({
        pond_id: pondId,
        seed_count: seed,
        survival_pct: sv,
        avg_weight_g: w,
        sample_at: (w !== null && w !== cu.avg_weight_g) ? new Date().toISOString() : (cu.sample_at || null),
        rate_pct: soCu(b.rate_pct, cu.rate_pct),
        meals_per_day: soCu(b.meals_per_day, cu.meals_per_day),
        meal_times: mealTimes,
        feed_stock_kg: soCu(b.feed_stock_kg, cu.feed_stock_kg),
        feed_stock_max_kg: soCu(b.feed_stock_max_kg, cu.feed_stock_max_kg),
        auto_enabled: b.auto_enabled === false ? 0 : (b.auto_enabled === true ? 1 : (cu.auto_enabled ?? 1)),
    });

    send(res, 200, { ok: true, plan: buildFeedPlan(pondId) });
};

/**
 * Ghi ket qua CHAI MAU.
 * Nhap 1 trong 2 cach:
 *   - avg_weight_g truc tiep, hoac
 *   - sample_count + total_weight_g  (chai 30 con, can duoc 300 g -> 10 g/con)
 */
handlers['POST /api/feed/sample'] = (req, res, body) => {
    const b = body || {};
    const pondId = String(b.pond_id || '').trim();
    if (!pondId) return send(res, 400, { ok: false, error: 'Thiếu pond_id' });

    let w = Number(b.avg_weight_g);
    if (!Number.isFinite(w) || w <= 0) {
        const soCon = Number(b.sample_count);
        const tong = Number(b.total_weight_g);
        if (Number.isFinite(soCon) && soCon > 0 && Number.isFinite(tong) && tong > 0) {
            w = tong / soCon;
        }
    }
    if (!Number.isFinite(w) || w <= 0 || w > 200) {
        return send(res, 400, {
            ok: false,
            error: 'Cần avg_weight_g, hoặc sample_count + total_weight_g (ví dụ 30 con nặng 300 g)',
        });
    }

    const cu = db.feedGet(pondId) || {};
    db.feedSave({
        ...cu,
        pond_id: pondId,
        avg_weight_g: Math.round(w * 100) / 100,
        sample_at: new Date().toISOString(),
        meal_times: cu.meal_times ? JSON.parse(cu.meal_times) : null,
    });
    db.feedLogAdd(pondId, 'sample', null, `Chài mẫu: ${Math.round(w * 100) / 100} g/con`);

    // Luu them vao LICH SU chai mau.
    // pond_feed chi giu lan gan nhat; muon biet tom lon nhanh hay cham -
    // tuc muon tra loi "nuoi them may ngay nua thi len size" - thi phai
    // co it nhat hai lan can de so voi nhau.
    db.sampleAdd(pondId, Math.round(w * 100) / 100,
        Number(b.sample_count) || null, Number(b.total_weight_g) || null);

    send(res, 200, { ok: true, avg_weight_g: Math.round(w * 100) / 100, plan: buildFeedPlan(pondId) });
};

/**
 * Cong cam vao kho ao. Dung chung cho nut "Nap thuc an" va cho nhat ky
 * giong noi ("nap 50kg cam") - hai duong khac nhau nhung phai ra cung
 * mot ket qua, khong duoc cai cong cai khong.
 *
 * Bao ro khi bi CAT BOT. Truoc day thung chua 20kg ma nap 50kg thi may
 * lang le vut di 30kg, man hinh khong noi gi - nguoi dung tuong may hong.
 *
 * @returns {{ok:boolean, error?:string, trong_may_kg?:number, da_cat_bot_kg?:number}}
 */
function napCamVaoMay(pondId, kg, ghiChu) {
    const cu = db.feedGet(pondId);
    if (!cu) return { ok: false, error: 'Ao này chưa khai báo thông số máy cho ăn' };

    const truoc = cu.feed_stock_kg || 0;
    const sucChua = cu.feed_stock_max_kg || null;
    const congDon = truoc + kg;
    const sau = sucChua ? Math.min(congDon, sucChua) : congDon;

    db.feedSetStock(pondId, sau);
    db.feedLogAdd(pondId, 'refill', kg, ghiChu || null);

    return {
        ok: true,
        trong_may_kg: Math.round(sau * 10) / 10,
        suc_chua_kg: sucChua,
        da_cat_bot_kg: Math.round((congDon - sau) * 10) / 10,
    };
}

handlers['POST /api/feed/refill'] = (req, res, body) => {
    const b = body || {};
    const pondId = String(b.pond_id || '').trim();
    const kg = Number(b.amount_kg);
    if (!pondId) return send(res, 400, { ok: false, error: 'Thiếu pond_id' });
    if (!Number.isFinite(kg) || kg <= 0 || kg > 10000) {
        return send(res, 400, { ok: false, error: 'Số kg nạp vào không hợp lệ' });
    }

    const r = napCamVaoMay(pondId, kg, b.note);
    if (!r.ok) return send(res, 404, { ok: false, error: r.error });

    send(res, 200, {
        ok: true,
        ...r,
        canh_bao: r.da_cat_bot_kg > 0
            ? `Thùng chỉ chứa được ${r.suc_chua_kg} kg nên đã bỏ qua ${r.da_cat_bot_kg} kg. `
                + 'Nếu thùng của bạn to hơn, sửa lại sức chứa trong mục Chài mẫu & thông số cho ăn.'
            : null,
        plan: buildFeedPlan(pondId),
    });
};

/**
 * XA 1 CU NGAY BAY GIO.
 * Server KHONG tu quay motor - no chi dat lenh vao hang doi, ESP32 lay lenh
 * roi tu quay va bao trang thai that ve. Giong het cach dieu khien bom/guong.
 */
handlers['POST /api/feed/run'] = (req, res, body) => {
    const b = body || {};
    const pondId = String(b.pond_id || '').trim();
    if (!pondId) return send(res, 400, { ok: false, error: 'Thiếu pond_id' });

    const plan = buildFeedPlan(pondId);
    if (!plan.ok) return send(res, 400, { ok: false, error: plan.message, missing: plan.missing });

    if (plan.ngungChoAn) {
        return send(res, 409, {
            ok: false,
            error: 'Đang khuyến cáo NGƯNG cho ăn: ' + plan.adjustReasons.join('; '),
            plan,
        });
    }

    let kg = Number(b.amount_kg);
    if (!Number.isFinite(kg) || kg <= 0) kg = plan.camMoiCuKg;
    if (kg > 500) return send(res, 400, { ok: false, error: 'Lượng xả quá lớn' });

    // Khong con du cam trong may thi bao truoc, khong xa hut
    if (plan.feedStockKg !== null && plan.feedStockKg < kg) {
        return send(res, 409, {
            ok: false,
            error: `Máy chỉ còn ${plan.feedStockKg} kg cám, không đủ cho cữ ${kg} kg. Hãy nạp thêm.`,
            plan,
        });
    }

    const device = db.listDevices().find(d => d.pond_id === pondId);
    if (!device) return send(res, 404, { ok: false, error: 'Ao này chưa gắn thiết bị ESP32' });

    // Gui luong can xa (gam) truoc, roi lenh xa
    const grams = Math.round(kg * 1000);
    db.supersede(device.device_id, 'FEED_AMOUNT');
    db.addCommand(device.device_id, 'FEED_AMOUNT', String(grams));
    const cmdId = db.addCommand(device.device_id, 'FEED_NOW', 'true');

    // Tru kho + ghi nhat ky
    if (plan.feedStockKg !== null) db.feedSetStock(pondId, Math.max(0, plan.feedStockKg - kg));
    db.feedLogAdd(pondId, b.kind === 'auto' ? 'auto' : 'manual', kg, b.note || null);

    send(res, 200, {
        ok: true,
        command_id: cmdId,
        amount_kg: kg,
        amount_g: grams,
        device_id: device.device_id,
        note: 'Lệnh đã vào hàng đợi. ESP32 lấy trong 1-3 giây rồi quay motor và báo trạng thái thật về.',
        plan: buildFeedPlan(pondId),
    });
};

/**
 * KIEM TRA MAY CHO AN TU TRANG WEB.
 * ----------------------------------------------------------------
 * Truoc day phai cam laptop vao ESP32 roi go TEST1/TEST2 trong
 * Serial Monitor. Ra ao thi khong ai mang laptop theo.
 *
 * Cac viec:
 *   motor1 / motor2  chay thu rieng tung motor 3 giay
 *   calib            quay vit tai N giay de can cam
 *   set_calib        gui he so hieu chuan -> ESP32 GHI VAO BO NHO TRONG
 *   stop             dung ngay
 *
 * LUU Y: server chi DAT LENH vao hang doi. ESP32 lay lenh trong 1-3 giay
 * roi tu quay motor va bao trang thai THAT ve - giong het cach dieu khien
 * bom va guong oxy. Server khong bao gio tu quay motor.
 */
/**
 * CHAN DOAN: lenh vua gui da toi ESP32 chua?
 * ----------------------------------------------------------------
 * Khi bam nut ma motor khong quay, co 2 kha nang hoan toan khac nhau:
 *   1. Lenh CHUA toi ESP32   -> loi mang / server / device_token
 *   2. Lenh DA toi ESP32     -> loi phan cung (nguon, day, chan EEP)
 *
 * Phan biet duoc hai cai nay la biet phai di sua o dau. Truoc day phai
 * cam laptop vao doc Serial Monitor moi biet. Gio doc thang trang thai
 * lenh trong hang doi:
 *     pending = ESP32 chua he lay lenh
 *     sent    = ESP32 da lay lenh roi
 *     done    = ESP32 da lam xong va bao ve
 */
handlers['GET /api/feed/command-status'] = (req, res) => {
    const pondId = req.query.get('pond_id');
    if (!pondId) return send(res, 400, { ok: false, error: 'Thiếu pond_id' });

    const device = db.listDevices().find(d => d.pond_id === String(pondId));
    if (!device) return send(res, 404, { ok: false, error: 'Ao này chưa gắn thiết bị ESP32' });

    const lenh = db.recentCommands(device.device_id, 10)
        .filter(c => String(c.command).startsWith('FEED_'));

    const moiNhat = lenh[0] || null;
    const tt = trangThaiChoAn.get(device.device_id) || null;

    // ESP32 co dang song khong (dua vao telemetry gan nhat)
    const online = isOnline(device.last_seen);

    let ketLuan, muc;
    if (!moiNhat) {
        ketLuan = 'Chưa gửi lệnh nào cho máy cho ăn.';
        muc = 'info';
    } else if (!online) {
        ketLuan = 'ESP32 đang MẤT KẾT NỐI — lệnh nằm chờ trong hàng đợi, chưa ai lấy.';
        muc = 'danger';
    } else if (moiNhat.status === 'pending') {
        const cho = Math.round((Date.now() - Date.parse(moiNhat.created_at)) / 1000);
        ketLuan = cho > 8
            ? `ESP32 chưa lấy lệnh sau ${cho} giây. Kiểm tra DEVICE_TOKEN trong config.h có khớp không.`
            : 'Lệnh vừa vào hàng đợi, ESP32 lấy trong 1–3 giây…';
        muc = cho > 8 ? 'danger' : 'info';
    } else {
        // ESP32 da lay va thuc hien xong lenh.
        //
        // TRUOC DAY o day ghi: "Motor khong quay la do phan cung".
        // SAI: may chu KHONG BIET motor co quay hay khong - khong co cam
        // bien nao bao ve. No chi biet ESP32 da nhan lenh. Khang dinh nhu
        // vay la doan mo roi noi nhu that, va khi motor chay duoc that thi
        // bang chan doan van cai la hong phan cung.
        //
        // Nay chi noi dung phan biet chac, roi HOI nguoi dung ket qua that.
        ketLuan = 'ESP32 đã nhận và thực hiện xong lệnh. Phần mềm chạy đúng tới đây.';
        muc = 'da_nhan';
    }

    send(res, 200, {
        ok: true,
        device_id: device.device_id,
        esp32_online: online,
        last_seen: device.last_seen,
        lenh_moi_nhat: moiNhat ? {
            id: moiNhat.id,
            command: moiNhat.command,
            value: moiNhat.value,
            status: moiNhat.status,
            created_at: moiNhat.created_at,
            sent_at: moiNhat.sent_at,
            executed_at: moiNhat.executed_at,
        } : null,
        may_cho_an: tt,
        ket_luan: ketLuan,
        muc,
    });
};

handlers['POST /api/feed/test'] = (req, res, body) => {
    const b = body || {};
    const pondId = String(b.pond_id || '').trim();
    if (!pondId) return send(res, 400, { ok: false, error: 'Thiếu pond_id' });

    const device = db.listDevices().find(d => d.pond_id === pondId);
    if (!device) {
        return send(res, 404, {
            ok: false,
            error: 'Ao này chưa gắn thiết bị ESP32. Vào sửa ao để chọn thiết bị.',
        });
    }

    const viec = String(b.action || '');
    let cmd, val, moTa;

    switch (viec) {
        case 'motor1':
        case 'motor2': {
            const so = viec === 'motor2' ? '2' : '1';
            const ten = viec === 'motor2' ? 'motor 2 (đĩa văng 130)' : 'motor 1 (vít tải N20)';
            // giu lau de nguoi dung kip cam dong ho do dien ap ra OUT
            const giay = num(b.seconds, 1, 60);
            cmd = 'FEED_TEST';
            val = giay ? `${so}:${Math.round(giay)}` : so;
            moTa = `Chạy thử ${ten} trong ${giay ? Math.round(giay) : 3} giây`;
            break;
        }
        case 'calib': {
            const giay = num(b.seconds, 1, 60) ?? 10;
            cmd = 'FEED_CALIBRATE'; val = String(giay);
            moTa = `Vít tải quay ${giay} giây — hứng xô và cân cám`;
            break;
        }
        case 'stop':
            cmd = 'FEED_STOP'; val = 'true';
            moTa = 'Dừng máy cho ăn';
            break;
        case 'set_calib': {
            // Web co the gui thang gam/giay, hoac gui (so gam can duoc + so giay)
            let gps = Number(b.grams_per_sec);
            if (!Number.isFinite(gps) || gps <= 0) {
                const gam = Number(b.grams);
                const giay = Number(b.seconds);
                if (Number.isFinite(gam) && gam > 0 && Number.isFinite(giay) && giay > 0) {
                    gps = gam / giay;
                }
            }
            if (!Number.isFinite(gps) || gps <= 0 || gps > 100000) {
                return send(res, 400, {
                    ok: false,
                    error: 'Cần số gam cân được và số giây đã quay (hoặc grams_per_sec trực tiếp)',
                });
            }
            gps = Math.round(gps * 100) / 100;
            cmd = 'FEED_SET_CALIB'; val = String(gps);
            moTa = `Lưu hệ số hiệu chuẩn ${gps} g/giây vào bộ nhớ ESP32`;
            break;
        }
        default:
            return send(res, 400, {
                ok: false,
                error: 'action phải là: motor1 | motor2 | calib | stop | set_calib',
            });
    }

    // Huy lenh cu cung loai con dang cho -> bam nhieu lan chi chay lenh MOI NHAT
    db.supersede(device.device_id, cmd);
    const id = db.addCommand(device.device_id, cmd, val);

    if (viec === 'set_calib') {
        db.logCreate(
            db.pondGet(pondId).user_id, pondId,
            `Hiệu chuẩn máy cho ăn: ${val} g/giây`
        );
    }

    send(res, 200, {
        ok: true,
        command_id: id,
        command: cmd,
        value: val,
        device_id: device.device_id,
        mo_ta: moTa,
        note: 'Lệnh đã vào hàng đợi. ESP32 lấy trong 1-3 giây rồi thực hiện và báo trạng thái thật về.',
    });
};

handlers['GET /api/feed/logs'] = (req, res) => {
    const pondId = req.query.get('pond_id');
    if (!pondId) return send(res, 400, { ok: false, error: 'Thiếu pond_id' });
    const limit = Math.min(200, Math.max(1, parseInt(req.query.get('limit') || '20', 10) || 20));
    send(res, 200, { ok: true, logs: db.feedLogRecent(String(pondId), limit) });
};

// ================================================================
// NHOM 5 - TAI KHOAN & DU LIEU NGUOI DUNG
// ----------------------------------------------------------------
// Truoc day: user / so sach / ao / nhat ky deu nam trong localStorage
// cua trinh duyet -> doi may la mat sach, khong xem chung duoc.
// Gio nam trong database, dang nhap tu may nao cung thay du lieu cua minh.
//
//   POST /api/auth/register | login | logout | profile | password
//   GET  /api/auth/me
//   GET/POST /api/ponds ...          ao nuoi
//   GET/POST /api/transactions ...   so sach thu chi
//   GET/POST /api/logs               nhat ky hoat dong
//   GET/POST /api/settings           cai dat rieng (gia dien, nguong...)
//   GET  /api/trace?code=...         truy xuat nguon goc (CONG KHAI)
// ================================================================

/** Bat buoc dang nhap. Tra ve null va da gui loi neu chua dang nhap. */
function canDangNhap(req, res) {
    const u = auth.nguoiDungTuRequest(req);
    if (!u) {
        send(res, 401, { ok: false, error: 'Chưa đăng nhập', need_login: true });
        return null;
    }
    return u;
}

/**
 * Ep ve so tien hop le (VND, khong am, khong vuot 1 nghin ty).
 *
 * PHAI doc duoc CACH VIET SO CUA NGUOI VIET, vi o tren giao dien
 * o nhap tien tu chen dau cham:  formatCurrency() bien "5000000"
 * thanh "5.000.000" roi moi gui len. Neu chi Number("5.000.000")
 * thi ra NaN -> giao dich bi tu choi ma nguoi dung khong hieu vi sao.
 *
 *   "5.000.000" -> 5000000      "5,000,000" -> 5000000
 *   "5000000"   -> 5000000      "1500.5"    -> 1501
 */
function soTien(v) {
    if (typeof v === 'number') {
        return Number.isFinite(v) && v >= 0 && v <= 1e15 ? Math.round(v) : null;
    }

    const t = String(v ?? '').replace(/[^\d.,-]/g, '').trim();
    if (!t) return null;

    let n;
    if (/^-?\d{1,3}([.,]\d{3})+$/.test(t)) {
        n = Number(t.replace(/[.,]/g, ''));          // 5.000.000 hoac 5,000,000
    } else if (/^-?\d+[.,]\d{1,2}$/.test(t)) {
        n = Number(t.replace(',', '.'));             // 1500,5
    } else if (/^-?\d+$/.test(t)) {
        n = Number(t);
    } else {
        return null;
    }

    if (!Number.isFinite(n) || n < 0 || n > 1e15) return null;
    return Math.round(n);
}

/** Ngay dang YYYY-MM-DD. */
function ngay(v) {
    const s = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// ---------------- DANG KY / DANG NHAP ----------------

handlers['POST /api/auth/register'] = (req, res, body) => {
    const r = auth.dangKy(body || {});
    if (r.error) return send(res, r.error[0], { ok: false, error: r.error[1] });
    send(res, 200, { ok: true, ...r });
};

handlers['POST /api/auth/login'] = (req, res, body) => {
    const r = auth.dangNhap(body || {});
    if (r.error) return send(res, r.error[0], { ok: false, error: r.error[1] });
    send(res, 200, { ok: true, ...r });
};

handlers['POST /api/auth/logout'] = (req, res) => {
    send(res, 200, auth.dangXuat(req));
};

handlers['GET /api/auth/me'] = (req, res) => {
    const u = auth.nguoiDungTuRequest(req);
    if (!u) return send(res, 200, { ok: true, user: null });
    delete u._token;
    send(res, 200, { ok: true, user: u, settings: db.settingsGet(u.id) });
};

handlers['POST /api/auth/profile'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const r = auth.doiThongTin(u.id, body || {});
    if (r.error) return send(res, r.error[0], { ok: false, error: r.error[1] });
    send(res, 200, { ok: true, ...r });
};

handlers['POST /api/auth/password'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const r = auth.doiMatKhau(u.id, body || {});
    if (r.error) return send(res, r.error[0], { ok: false, error: r.error[1] });
    send(res, 200, r);
};

// ---------------- AO NUOI ----------------

/** Gop thong tin ao + trang thai cam bien + khau phan -> 1 goi cho web. */
/**
 * ================================================================
 * DU BAO THU HOACH
 * ----------------------------------------------------------------
 * Truoc day the "Du bao thu hoach" tren dashboard go SO CUNG vao
 * HTML: tien do 75%, uoc tinh 12.0 kg/m2. Ao vua tha hom nay cung
 * hien 75%. Do khong phai du bao, do la mot buc anh.
 *
 * Nay tinh tu so lieu THAT nguoi dung da nhap luc tao ao:
 *
 *   Ngay tuoi   = hom nay - ngay tha
 *   Tien do     = ngay tuoi / vong nuoi cua loai  (chan tren 100%)
 *   Thu hoach   = ngay tha + vong nuoi
 *   Sinh khoi   = so giong x ty le song x trong luong TB / 1000
 *   kg/m2       = sinh khoi / dien tich ao
 *
 * Vong nuoi tung loai lay tu kb.js (tai lieu ky thuat), khong go tay.
 *
 * Thieu so lieu nao thi NOI RO thieu gi, khong doan. Mot con so
 * nang suat bia ra co the lam nguoi ta quyet dinh sai thoi diem ban.
 * ================================================================
 */
function duBaoThuHoach(p) {
    const thieu = [];
    if (!p.stocking_date) thieu.push('ngày thả giống');
    if (!(p.area_m2 > 0)) thieu.push('diện tích ao');

    const loai = kb.chuanHoaLoai(p.seed_type);
    const vong = kb.loaiTom(loai).vong_nuoi_ngay;      // [som nhat, muon nhat]
    const tenLoai = kb.loaiTom(loai).ten;

    let ngayTuoi = null, tienDo = null, thuHoachTu = null, thuHoachDen = null;
    if (p.stocking_date) {
        const moc = new Date(p.stocking_date);
        moc.setHours(0, 0, 0, 0);
        const homNay = new Date();
        homNay.setHours(0, 0, 0, 0);

        ngayTuoi = Math.max(0, Math.round((homNay - moc) / 86400000));
        // Chia cho moc MUON NHAT -> tien do khong bao gio vuot thuc te
        tienDo = Math.min(100, Math.round((ngayTuoi / vong[1]) * 100));

        const cong = (n) => new Date(moc.getTime() + n * 86400000).toISOString().slice(0, 10);
        thuHoachTu = cong(vong[0]);
        thuHoachDen = cong(vong[1]);
    }

    // Sinh khoi can trong luong trung binh tu CHAI MAU
    const f = db.feedGet(p.pond_id) || {};
    const soGiong = p.seed_count || f.seed_count || null;
    const tyLeSong = f.survival_pct || null;
    const wTB = f.avg_weight_g || null;

    if (!soGiong) thieu.push('số con giống đã thả');
    if (!tyLeSong) thieu.push('tỷ lệ sống dự kiến');
    if (!wTB) thieu.push('trọng lượng trung bình (chài mẫu)');

    let sinhKhoiKg = null, kgTrenM2 = null;
    if (soGiong && tyLeSong && wTB) {
        sinhKhoiKg = Math.round((soGiong * (tyLeSong / 100) * wTB / 1000) * 10) / 10;
        if (p.area_m2 > 0) kgTrenM2 = Math.round((sinhKhoiKg / p.area_m2) * 100) / 100;
    }

    return {
        loai: loai,
        ten_loai: tenLoai,
        ngay_tuoi: ngayTuoi,
        vong_nuoi_ngay: vong,
        tien_do_pct: tienDo,
        thu_hoach_tu: thuHoachTu,
        thu_hoach_den: thuHoachDen,
        sinh_khoi_kg: sinhKhoiKg,
        kg_tren_m2: kgTrenM2,
        thieu,
        ghi_chu: loai ? null : 'Ao chưa khai loại giống — đang tạm tính theo tôm thẻ chân trắng.',
    };
}

function shapePond(p) {
    const device = db.listDevices().find(d => d.pond_id === p.pond_id) || null;
    const latest = device ? shapeLatest(device) : null;

    return {
        du_bao: duBaoThuHoach(p),
        id: p.pond_id,
        pond_id: p.pond_id,
        name: p.name,
        area_m2: p.area_m2,
        seed: p.seed_type,
        seed_type: p.seed_type,
        seed_count: p.seed_count,
        stockingDate: p.stocking_date,
        stocking_date: p.stocking_date,
        status: p.status || 'safe',
        note: p.note,
        trace_code: p.trace_code,

        // So lieu cam bien THAT (null neu chua co thiet bi hoac chua co du lieu)
        device_id: device ? device.device_id : null,
        online: latest ? latest.online : false,
        temperature: latest ? latest.temperature : null,
        ph: latest ? latest.ph : null,
        do: latest ? latest.do_value : null,
        fan: latest ? latest.aerator : false,
        pump: latest ? latest.pump : false,

        created_at: p.created_at,
        updated_at: p.updated_at,
    };
}

/**
 * Danh sach thiet bi ESP32 va ao dang gan.
 * Dung de nguoi dung CHON thiet bi khi tao ao - day la cai noi giua
 * web va phan cung. Khong co buoc nay thi ao tao tren web va ESP32
 * ngoai ao khong bao gio gap nhau.
 */
handlers['GET /api/devices'] = (req, res) => {
    const u = canDangNhap(req, res); if (!u) return;

    const aoCuaToi = {};
    for (const p of db.pondList(u.id)) aoCuaToi[p.pond_id] = p.name;

    send(res, 200, {
        ok: true,
        devices: db.listDevices().map(d => {
            const aoNguoiKhac = !!d.pond_id && !aoCuaToi[d.pond_id] && !!db.pondGet(d.pond_id);
            // Thiet bi dang gan vao ao cua NGUOI KHAC thi khong cho gan lai
            // - tranh cuop thiet bi cua nhau.
            const ganDuoc = !aoNguoiKhac;

            // NOI RO VI SAO khong gan duoc. Truoc day thiet bi bi loai am
            // tham khoi danh sach -> nguoi dung thay o chon trong tron va
            // tuong may chu chua nhan thiet bi, di chay seed.js vo ich.
            let lyDo = null;
            if (aoNguoiKhac) lyDo = `Đang gắn vào ao "${d.pond_id}" của tài khoản khác`;

            return {
                device_id: d.device_id,
                name: d.name,
                pond_id: d.pond_id,
                pond_name: aoCuaToi[d.pond_id] || null,
                gan_duoc: ganDuoc,
                ly_do: lyDo,
                // Da tung gui du lieu len chua? Chua bao gio = ESP32 khong
                // goi toi duoc may chu (sai IP / sai token / khac mang).
                da_tung_gui: !!d.last_seen,
                online: isOnline(d.last_seen),
                last_seen: d.last_seen,
            };
        }),
    });
};

handlers['GET /api/ponds'] = (req, res) => {
    const u = canDangNhap(req, res); if (!u) return;
    send(res, 200, { ok: true, ponds: db.pondList(u.id).map(shapePond) });
};

/**
 * Gan 1 thiet bi ESP32 vao 1 ao.
 * Chan viec gan thiet bi dang thuoc ao cua NGUOI KHAC.
 */
function ganThietBi(u, deviceId, pondId) {
    const dev = db.getDevice(deviceId);
    if (!dev) {
        return { error: `Không tìm thấy thiết bị "${deviceId}". Kiểm tra DEVICE_ID trong config.h của ESP32.` };
    }

    // Thiet bi dang gan vao ao con ton tai va KHONG phai ao cua minh -> chan
    if (dev.pond_id && dev.pond_id !== pondId) {
        const aoCu = db.pondGet(dev.pond_id);
        if (aoCu && aoCu.user_id !== u.id) {
            return { error: 'Thiết bị này đang được gắn vào ao của tài khoản khác' };
        }
    }

    db.deviceSetPond(deviceId, pondId);
    return { ok: true };
}

handlers['POST /api/ponds'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const b = body || {};

    const ten = String(b.name || '').trim();
    if (!ten) return send(res, 400, { ok: false, error: 'Vui lòng nhập tên ao' });
    if (db.pondList(u.id).length >= 50) return send(res, 400, { ok: false, error: 'Tối đa 50 ao' });

    // Ma ao: tu sinh, khong de trinh duyet tu dat -> tranh trung va tranh
    // nguoi dung go ma cua ao nguoi khac.
    const pondId = 'pond_' + crypto.randomBytes(6).toString('hex');
    const traceCode = 'VAST-' + crypto.randomBytes(5).toString('hex').toUpperCase();

    db.pondCreate({
        pond_id: pondId,
        user_id: u.id,
        name: ten.slice(0, 80),
        area_m2: Number(b.area_m2) > 0 ? Number(b.area_m2) : null,
        seed_type: b.seed_type ? String(b.seed_type).slice(0, 80) : null,
        seed_count: Number(b.seed_count) > 0 ? Math.round(Number(b.seed_count)) : null,
        stocking_date: ngay(b.stocking_date),
        status: 'safe',
        note: b.note ? String(b.note).slice(0, 500) : null,
        trace_code: traceCode,
    });

    // Ao moi co san so giong -> dua luon sang phan tinh khau phan,
    // khoi phai go lai lan nua.
    if (Number(b.seed_count) > 0) {
        db.feedSave({
            pond_id: pondId,
            seed_count: Math.round(Number(b.seed_count)),
            survival_pct: Number(b.survival_pct) > 0 ? Number(b.survival_pct) : 85,
            avg_weight_g: null, sample_at: null, rate_pct: null,
            meals_per_day: null, meal_times: null,
            feed_stock_kg: null, feed_stock_max_kg: null, auto_enabled: 1,
        });
    }

    // Gan thiet bi ESP32 vao ao nay (neu nguoi dung co chon)
    if (b.device_id) {
        const kq = ganThietBi(u, String(b.device_id), pondId);
        if (kq.error) {
            // Ao van tao xong, chi la chua gan duoc thiet bi -> bao ro
            db.logCreate(u.id, pondId, `Tạo ao mới: ${ten}`);
            return send(res, 200, {
                ok: true,
                pond: shapePond(db.pondGet(pondId)),
                canh_bao: kq.error,
            });
        }
    }

    db.logCreate(u.id, pondId, `Tạo ao mới: ${ten}`);
    send(res, 200, { ok: true, pond: shapePond(db.pondGet(pondId)) });
};

/**
 * TAO AO TU CAC THIET BI ESP32 DANG CO.
 * ----------------------------------------------------------------
 * Vi sao can cai nay: truoc day "Ao so 1" / "Ao so 2" la hai dong go
 * cung trong dashboard.html. Khi chuyen sang database, tai khoan moi
 * dang nhap se thay danh sach ao TRONG - nhin nhu mat du lieu, du that
 * ra chua bao gio co ao nao trong database ca.
 *
 * Ham nay quet cac ESP32 da dang ky (chay node seed.js) ma CHUA thuoc
 * ao nao, roi tao san mot ao cho tung thiet bi va gan lien vao.
 * Bam mot cai la co ngay ao voi so lieu cam bien that.
 *
 * AN TOAN: chi nhan thiet bi CHUA gan vao ao nao con ton tai.
 * Thiet bi dang thuoc ao cua nguoi khac se bi bo qua.
 */
handlers['POST /api/ponds/adopt'] = (req, res) => {
    const u = canDangNhap(req, res); if (!u) return;

    const daTao = [];
    const boQua = [];

    for (const dev of db.listDevices()) {
        // Thiet bi dang gan vao mot ao CON TON TAI -> khong dung toi
        if (dev.pond_id) {
            const aoCu = db.pondGet(dev.pond_id);
            if (aoCu) {
                boQua.push({
                    device_id: dev.device_id,
                    ly_do: aoCu.user_id === u.id
                        ? `Đã thuộc ao "${aoCu.name}" của bạn`
                        : 'Đang thuộc ao của tài khoản khác',
                });
                continue;
            }
        }

        const pondId = 'pond_' + crypto.randomBytes(6).toString('hex');
        const traceCode = 'VAST-' + crypto.randomBytes(5).toString('hex').toUpperCase();

        // Lay ten tu ten thiet bi neu co, khong thi dat theo so thu tu
        const ten = (dev.name && String(dev.name).trim())
            ? String(dev.name).trim().slice(0, 80)
            : `Ao ${db.pondList(u.id).length + daTao.length + 1}`;

        db.pondCreate({
            pond_id: pondId,
            user_id: u.id,
            name: ten,
            area_m2: null,
            seed_type: null,
            seed_count: null,
            stocking_date: null,
            status: 'safe',
            note: `Tạo tự động từ thiết bị ${dev.device_id}`,
            trace_code: traceCode,
        });

        db.deviceSetPond(dev.device_id, pondId);
        db.logCreate(u.id, pondId, `Tạo ao từ thiết bị ${dev.device_id}`);
        daTao.push({ pond_id: pondId, name: ten, device_id: dev.device_id });
    }

    send(res, 200, {
        ok: true,
        created: daTao,
        skipped: boQua,
        ponds: db.pondList(u.id).map(shapePond),
        note: daTao.length
            ? `Đã tạo ${daTao.length} ao. Vào từng ao bổ sung ngày thả và số con giống để tính được khẩu phần.`
            : 'Không có thiết bị nào chưa gắn ao.',
    });
};

handlers['POST /api/ponds/update'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const b = body || {};
    const cu = db.pondGet(String(b.pond_id || ''));
    if (!cu || cu.user_id !== u.id) return send(res, 404, { ok: false, error: 'Không tìm thấy ao' });

    const doi = (v, cuV) => (v === undefined || v === null || v === '' ? cuV : v);

    db.pondUpdate(cu.pond_id, u.id, {
        name: String(doi(b.name, cu.name)).slice(0, 80),
        area_m2: b.area_m2 !== undefined ? (Number(b.area_m2) > 0 ? Number(b.area_m2) : null) : cu.area_m2,
        seed_type: doi(b.seed_type, cu.seed_type),
        seed_count: b.seed_count !== undefined ? (Number(b.seed_count) > 0 ? Math.round(Number(b.seed_count)) : null) : cu.seed_count,
        stocking_date: b.stocking_date !== undefined ? ngay(b.stocking_date) : cu.stocking_date,
        status: doi(b.status, cu.status),
        note: b.note !== undefined ? String(b.note || '').slice(0, 500) : cu.note,
    });

    // Doi thiet bi gan vao ao nay
    let canhBao = null;
    if (b.device_id !== undefined) {
        if (b.device_id === null || b.device_id === '') {
            // Go thiet bi ra khoi ao
            const dangGan = db.listDevices().find(d => d.pond_id === cu.pond_id);
            if (dangGan) db.deviceSetPond(dangGan.device_id, null);
        } else {
            const kq = ganThietBi(u, String(b.device_id), cu.pond_id);
            if (kq.error) canhBao = kq.error;
        }
    }

    send(res, 200, {
        ok: true,
        pond: shapePond(db.pondGet(cu.pond_id)),
        ...(canhBao ? { canh_bao: canhBao } : {}),
    });
};

handlers['POST /api/ponds/delete'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const pondId = String((body || {}).pond_id || '');
    const cu = db.pondGet(pondId);
    if (!cu || cu.user_id !== u.id) return send(res, 404, { ok: false, error: 'Không tìm thấy ao' });

    // Go thiet bi ra truoc, khong thi no treo lo lung o mot ao khong con ton tai
    const dangGan = db.listDevices().find(d => d.pond_id === pondId);
    if (dangGan) db.deviceSetPond(dangGan.device_id, null);

    db.pondDelete(pondId, u.id);
    db.logCreate(u.id, null, `Xóa ao: ${cu.name}`);

    // Giao dich cu KHONG bi xoa theo: day la so sach tien bac, xoa ao ma
    // mat luon lich su thu chi thi khong doi chieu duoc nua.
    send(res, 200, { ok: true, note: 'Đã xóa ao. Các giao dịch cũ vẫn được giữ trong sổ sách.' });
};

// ---------------- SO SACH THU CHI ----------------

handlers['GET /api/transactions'] = (req, res) => {
    const u = canDangNhap(req, res); if (!u) return;
    const pondId = req.query.get('pond_id');
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.get('limit') || '500', 10) || 500));

    const rows = pondId ? db.txnListPond(u.id, String(pondId), limit) : db.txnList(u.id, limit);

    let thu = 0, chi = 0;
    for (const t of rows) {
        if (t.type === 'thu') thu += t.amount;
        else chi += t.amount;
    }

    send(res, 200, {
        ok: true,
        transactions: rows,
        summary: { thu, chi, con_lai: thu - chi, so_giao_dich: rows.length },
    });
};

handlers['POST /api/transactions'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const b = body || {};

    const tien = soTien(b.amount);
    if (tien === null || tien <= 0) return send(res, 400, { ok: false, error: 'Số tiền không hợp lệ' });

    const loai = b.type === 'thu' ? 'thu' : 'chi';
    const ng = ngay(b.date) || new Date().toISOString().slice(0, 10);

    const id = db.txnCreate({
        user_id: u.id,
        pond_id: b.pond_id ? String(b.pond_id) : null,
        type: loai,
        amount: tien,
        category: b.category ? String(b.category).slice(0, 60) : null,
        date: ng,
        note: b.note ? String(b.note).slice(0, 300) : null,
    });

    send(res, 200, { ok: true, id, transaction: db.txnGet(id, u.id) });
};

handlers['POST /api/transactions/update'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const b = body || {};
    const id = parseInt(b.id, 10);
    const cu = Number.isInteger(id) ? db.txnGet(id, u.id) : null;
    if (!cu) return send(res, 404, { ok: false, error: 'Không tìm thấy giao dịch' });

    const tien = b.amount !== undefined ? soTien(b.amount) : cu.amount;
    if (tien === null || tien <= 0) return send(res, 400, { ok: false, error: 'Số tiền không hợp lệ' });

    db.txnUpdate(id, u.id, {
        pond_id: b.pond_id !== undefined ? (b.pond_id || null) : cu.pond_id,
        type: b.type !== undefined ? (b.type === 'thu' ? 'thu' : 'chi') : cu.type,
        amount: tien,
        category: b.category !== undefined ? String(b.category || '').slice(0, 60) : cu.category,
        date: b.date !== undefined ? (ngay(b.date) || cu.date) : cu.date,
        note: b.note !== undefined ? String(b.note || '').slice(0, 300) : cu.note,
    });

    send(res, 200, { ok: true, transaction: db.txnGet(id, u.id) });
};

handlers['POST /api/transactions/delete'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const id = parseInt((body || {}).id, 10);
    if (!Number.isInteger(id)) return send(res, 400, { ok: false, error: 'id không hợp lệ' });
    const n = db.txnDelete(id, u.id);
    if (!n) return send(res, 404, { ok: false, error: 'Không tìm thấy giao dịch' });
    send(res, 200, { ok: true });
};

// ---------------- NHAT KY ----------------

// ================================================================
// NHOM 6 - CO VAN & TRO LY
// ----------------------------------------------------------------
//   GET  /api/advisor?pond_id=      loi khuyen cho 1 ao
//   GET  /api/advisor/all           loi khuyen tat ca cac ao
//   POST /api/ask                   hoi mot cau
//   GET  /api/ask/suggestions       cac cau hoi goi y
//   POST /api/logs/classify         phan loai cau noi truoc khi ghi nhat ky
//
// LUU Y: day la CO VAN DUA TREN LUAT chay tren so lieu that cua ao,
// khong phai mo hinh ngon ngu. Moi loi khuyen deu kem truong "can_cu"
// ghi ro con so nao dan toi ket luan do.
// ================================================================

// ================================================================
// CO VAN THU HOACH: BAN NGAY HAY NUOI THEM?
// ----------------------------------------------------------------
//   GET  /api/harvest?pond_id=...            phan tich bang so that
//   POST /api/harvest/keep                   bam "Giu lai nuoi tiep"
//   POST /api/harvest/cancel                 bo quyet dinh do
//   GET  /api/harvest/reminders              cac ao da toi ngay du kien
// ================================================================

handlers['GET /api/harvest'] = async (req, res) => {
    const u = canDangNhap(req, res); if (!u) return;

    const pondId = String(req.query.get('pond_id') || '');
    const pond = db.pondGet(pondId);
    if (!pond || pond.user_id !== u.id) return send(res, 404, { ok: false, error: 'Không tìm thấy ao' });

    // Gia cam: uu tien so nguoi dung tu nhap trong Cai dat, vi gia dai ly
    // bao cho tung trai lech nhau nhieu. Khong co thi de null va noi ro.
    const cai = db.settingsGet(u.id) || {};
    const giaCam = Number(cai.gia_cam_kg) > 0 ? Number(cai.gia_cam_kg) : null;

    const kq = harvest.phanTich(pond, market.snapshot({}), giaCam);

    send(res, 200, {
        ok: true,
        pond_id: pondId,
        pond_name: pond.name,
        phan_tich: kq,
        quyet_dinh: db.harvestPlanGet(pondId),
    });
};

handlers['POST /api/harvest/keep'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const b = body || {};
    const pondId = String(b.pond_id || '');
    const pond = db.pondGet(pondId);
    if (!pond || pond.user_id !== u.id) return send(res, 404, { ok: false, error: 'Không tìm thấy ao' });

    // Tinh lai o may chu, KHONG tin so tu trinh duyet gui len.
    // Nguoi dung co the da mo trang tu hom qua, gia da doi.
    const cai = db.settingsGet(u.id) || {};
    const giaCam = Number(cai.gia_cam_kg) > 0 ? Number(cai.gia_cam_kg) : null;
    const pt = harvest.phanTich(pond, market.snapshot({}), giaCam);

    if (!pt.ok) {
        return send(res, 400, {
            ok: false,
            error: pt.ket_luan || ('Chưa đủ dữ liệu để đặt mốc: còn thiếu ' + (pt.thieu || []).join(', ')),
            phan_tich: pt,
        });
    }

    db.harvestPlanSave({
        pond_id: pondId,
        size_hien_tai: pt.size_hien_tai,
        size_muc_tieu: pt.size_muc_tieu,
        ngay_du_kien: pt.ngay_du_kien,
        loi_lai_uoc: pt.loi_rong,
        ghi_chu: b.note || null,
    });

    db.logCreate(u.id, pondId,
        `[Thu hoạch] Giữ lại nuôi tiếp tới size ${pt.size_muc_tieu} con/kg, `
        + `dự kiến ${pt.ngay_du_kien} (còn ${pt.so_ngay_nuoi_them} ngày)`);

    send(res, 200, {
        ok: true,
        quyet_dinh: db.harvestPlanGet(pondId),
        thong_bao: `Đã đặt mốc: nuôi thêm ${pt.so_ngay_nuoi_them} ngày tới size ${pt.size_muc_tieu} con/kg. `
            + `Tới ngày ${pt.ngay_du_kien} hệ thống sẽ nhắc.`,
    });
};

handlers['POST /api/harvest/cancel'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const pondId = String((body || {}).pond_id || '');
    const pond = db.pondGet(pondId);
    if (!pond || pond.user_id !== u.id) return send(res, 404, { ok: false, error: 'Không tìm thấy ao' });

    db.harvestPlanXoa(pondId);
    send(res, 200, { ok: true });
};

handlers['GET /api/harvest/reminders'] = (req, res) => {
    const u = canDangNhap(req, res); if (!u) return;
    send(res, 200, { ok: true, nhac: harvest.nhacToiHan(u.id) });
};

handlers['POST /api/harvest/reminder-seen'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const pondId = String((body || {}).pond_id || '');
    const pond = db.pondGet(pondId);
    if (!pond || pond.user_id !== u.id) return send(res, 404, { ok: false, error: 'Không tìm thấy ao' });
    db.harvestPlanDanhDauNhac(pondId);
    send(res, 200, { ok: true });
};

handlers['GET /api/advisor'] = (req, res) => {
    const u = canDangNhap(req, res); if (!u) return;

    const pondId = req.query.get('pond_id');
    if (!pondId) return send(res, 400, { ok: false, error: 'Thiếu pond_id' });

    const pond = db.pondGet(String(pondId));
    if (!pond || pond.user_id !== u.id) return send(res, 404, { ok: false, error: 'Không tìm thấy ao' });

    send(res, 200, advisor.phanTich(pond.pond_id));
};

handlers['GET /api/advisor/all'] = (req, res) => {
    const u = canDangNhap(req, res); if (!u) return;

    const ketQua = db.pondList(u.id).map(p => advisor.phanTich(p.pond_id));

    // Gom cac viec GAP cua moi ao len dau, de man hinh chinh hien duoc ngay
    const viecGap = [];
    for (const r of ketQua) {
        if (!r.ok) continue;
        for (const lk of r.loi_khuyen) {
            if (lk.muc === 'nguy_hiem' || lk.muc === 'canh_bao') {
                viecGap.push({ pond_id: r.pond_id, pond_name: r.pond_name, ...lk });
            }
        }
    }
    const thuTu = { nguy_hiem: 0, canh_bao: 1 };
    viecGap.sort((a, b) => thuTu[a.muc] - thuTu[b.muc]);

    send(res, 200, { ok: true, ao: ketQua, viec_gap: viecGap, tinh_luc: new Date().toISOString() });
};

handlers['GET /api/ask/suggestions'] = (req, res) => {
    send(res, 200, { ok: true, goi_y: ask.goiYCauHoi() });
};

handlers['POST /api/ask'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const b = body || {};

    const cauHoi = String(b.question || '').trim();
    if (!cauHoi) return send(res, 400, { ok: false, error: 'Chưa có câu hỏi' });
    if (cauHoi.length > 500) return send(res, 400, { ok: false, error: 'Câu hỏi quá dài' });

    // Chi tra loi tren ao CUA MINH
    let pondId = b.pond_id ? String(b.pond_id) : null;
    if (pondId) {
        const p = db.pondGet(pondId);
        if (!p || p.user_id !== u.id) pondId = null;
    }

    send(res, 200, ask.traLoi(cauHoi, u.id, pondId));
};

/**
 * Phan loai mot cau truoc khi ghi vao nhat ky.
 * Web goi cai nay TRUOC, hien cho nguoi dung xem "se ghi vao Ao so 1,
 * loai: Cho an" roi moi ghi that. Nho vay khong bao gio ghi nham ao.
 */
handlers['POST /api/logs/classify'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const b = body || {};
    const kq = ask.phanLoaiNhatKy(String(b.text || ''), u.id, b.pond_id ? String(b.pond_id) : null);
    if (!kq.ok) return send(res, 400, kq);
    send(res, 200, kq);
};

handlers['GET /api/logs'] = (req, res) => {
    const u = canDangNhap(req, res); if (!u) return;
    const limit = Math.min(500, Math.max(1, parseInt(req.query.get('limit') || '100', 10) || 100));
    send(res, 200, { ok: true, logs: db.logList(u.id, limit) });
};

handlers['POST /api/logs'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const b = body || {};
    const noiDung = String(b.content || '').trim();
    if (!noiDung) return send(res, 400, { ok: false, error: 'Thiếu nội dung' });

    // Ghi kem loai viec o dau dong -> nhat ky doc ra la biet ngay viec gi,
    // va loc duoc theo loai.
    let pondId = b.pond_id ? String(b.pond_id) : null;
    if (pondId) {
        const p = db.pondGet(pondId);
        if (!p || p.user_id !== u.id) pondId = null;   // khong ghi vao ao nguoi khac
    }

    const phanLoai = ask.phanLoaiNhatKy(noiDung, u.id, pondId);
    const loai = b.loai || (phanLoai.ok ? phanLoai.loai : null);
    const nhan = loai ? `[${(phanLoai.loai_ten || loai)}] ` : '';

    db.logCreate(u.id, pondId, (nhan + noiDung).slice(0, 500));

    // ================================================================
    // GHI "NAP 50KG CAM" THI PHAI CONG THAT VAO KHO
    // ----------------------------------------------------------------
    // Truoc day nhat ky chi luu chu. Nguoi dung noi "nap 50kg thuc an",
    // nhat ky hien dep de, nhung the may cho an van bao con 0kg - tuong
    // may hong. Hai duong di cung mot viec ma khong noi chuyen voi nhau.
    //
    // Chi cong khi CHAC CHAN: dung loai viec 'nap_cam', co so kg ro rang,
    // va biet dang ghi cho ao nao. Thieu mot trong ba thi khong doan.
    // ================================================================
    let napCam = null;
    if (loai === 'nap_cam' && pondId && phanLoai.ok && phanLoai.so_lieu && phanLoai.so_lieu.kg > 0) {
        const r = napCamVaoMay(pondId, phanLoai.so_lieu.kg, 'Ghi từ nhật ký');
        if (r.ok) {
            napCam = {
                da_cong_kg: phanLoai.so_lieu.kg,
                trong_may_kg: r.trong_may_kg,
                canh_bao: r.da_cat_bot_kg > 0
                    ? `Thùng chỉ chứa được ${r.suc_chua_kg} kg nên chỉ ghi nhận tới mức đầy.`
                    : null,
            };
        }
    }

    send(res, 200, {
        ok: true,
        loai,
        loai_ten: phanLoai.ok ? phanLoai.loai_ten : null,
        nap_cam: napCam,
        pond_name: pondId ? (db.pondGet(pondId) || {}).name : null,
        nhac_them: phanLoai.ok ? phanLoai.nhac_them : null,
        logs: db.logList(u.id, 100),
    });
};

// ---------------- CAI DAT RIENG ----------------

const CAI_DAT_CHO_PHEP = new Set([
    'electricity_price',      // gia dien (d/kWh)
    'feed_alert_threshold',   // nguong bao het cam
    'fingerprint_enabled',    // bat van tay
    'finance_timeframe',      // Ngay / Thang / Nam
    'farm_name',              // ten trai / hop tac xa - hien tren QR truy xuat
    'farm_gps',               // toa do GPS - hien tren QR truy xuat
    'farm_official_code',     // MA CO SO NUOI do co quan nong nghiep cap (khac ma noi bo)
    'farm_address',           // dia chi vung nuoi
    'gia_cam_kg',             // gia 1 kg cam (d) - de tinh chi phi khi co van thu hoach
]);

handlers['GET /api/settings'] = (req, res) => {
    const u = canDangNhap(req, res); if (!u) return;
    send(res, 200, { ok: true, settings: db.settingsGet(u.id) });
};

handlers['POST /api/settings'] = (req, res, body) => {
    const u = canDangNhap(req, res); if (!u) return;
    const b = (body && body.settings) || body || {};

    let luu = 0;
    const boQua = [];
    for (const [k, v] of Object.entries(b)) {
        // Danh sach TRANG: chi nhan cac khoa da biet -> khong ai nhoi rac
        // vao database qua API nay.
        if (!CAI_DAT_CHO_PHEP.has(k)) { boQua.push(k); continue; }
        db.settingsSet(u.id, k, v === null ? null : String(v).slice(0, 300));
        luu++;
    }

    send(res, 200, { ok: true, saved: luu, ignored: boQua, settings: db.settingsGet(u.id) });
};

// ---------------- TRUY XUAT NGUON GOC (QR) ----------------
// CONG KHAI: nguoi mua tom quet ma QR la xem duoc, khong can dang nhap.
// Vi vay o day CHI tra ra thong tin ve con tom va vung nuoi.
// KHONG BAO GIO tra ra so dien thoai, so sach thu chi hay bat ky
// thong tin ca nhan / kinh doanh nao cua chu ao.

handlers['GET /api/trace'] = (req, res) => {
    const r = trace.hoSo(req.query.get('code'));
    if (r.error) return send(res, r.error[0], { ok: false, error: r.error[1] });
    send(res, 200, r.data);
};

// ----------------------------------------------------------------
// DIA CHI DE NHET VAO MA QR
// ----------------------------------------------------------------
// Cai bay da vap phai: ma QR sinh ra chua "http://localhost:3000/...".
// Nguoi dung quet bang dien thoai -> khong ra gi ca. Vi voi dien thoai,
// localhost la CHINH NO, khong phai may chu ngoai ao.
//
// Ma QR nay danh cho MAY KHAC quet (dien thoai chu ao, dien thoai thuong
// lai). Nen no bat buoc phai chua dia chi ma may khac goi toi duoc.
// ----------------------------------------------------------------

// Ten card mang AO - may lam do an thuong cai VMware, Radmin, Docker...
// va chung deu co IPv4 "that" nhu ai. Lay nham la ma QR tro vao hu khong.
//
// Da vap that: may nay co 4 dia chi, chi 1 cai dung.
//   26.205.48.207  Radmin VPN                     <- lay nham cai nay
//   192.168.6.1    VMware Network Adapter VMnet1
//   192.168.147.1  VMware Network Adapter VMnet8
//   10.31.117.176  Wi-Fi                          <- moi la cai that
const TEN_CARD_AO = /vmware|virtualbox|vbox|hyper-?v|vethernet|docker|radmin|hamachi|vpn|tap|loopback|tailscale|zerotier|wsl/i;
const TEN_CARD_THAT = /wi-?fi|wireless|wlan|ethernet|^en\d|^eth\d|^wl/i;

/**
 * Cac dia chi LAN co the dung, sap theo do dang tin.
 * @returns {{ip:string, card:string}[]}
 */
function dsIpLan() {
    const ra = [];
    for (const [card, ds] of Object.entries(os.networkInterfaces())) {
        for (const n of ds || []) {
            if (n.family !== 'IPv4' || n.internal) continue;
            if (n.address.startsWith('169.254.')) continue;   // dia chi tu cap khi khong co DHCP

            let diem = 0;
            if (TEN_CARD_AO.test(card)) diem -= 10;
            if (TEN_CARD_THAT.test(card)) diem += 5;
            ra.push({ ip: n.address, card, diem });
        }
    }
    ra.sort((a, b) => b.diem - a.diem);
    return ra.map(({ ip, card }) => ({ ip, card }));
}

/** IP LAN dang tin nhat cua may dang chay server. */
function ipLan() {
    const ds = dsIpLan();
    return ds.length ? ds[0].ip : null;
}

function laCucBo(host) {
    return /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(String(host || ''));
}

/**
 * Dia chi goc de dung link cong khai.
 *   1. config.publicUrl neu co dat tay (khi dua ra Internet that)
 *   2. Dia chi trinh duyet dang dung, neu do khong phai localhost
 *   3. IP LAN cua may chu
 */
function diaChiCongKhai(req) {
    if (config.publicUrl) return String(config.publicUrl).replace(/\/+$/, '');

    const host = String(req.headers.host || '');
    if (host && !laCucBo(host)) return `http://${host}`;

    const ip = ipLan();
    return ip ? `http://${ip}:${config.port}` : `http://${host || 'localhost:' + config.port}`;
}

/**
 * Duong dan cong khai + canh bao, de giao dien hien DUNG cai ma QR chua.
 * Truoc day dashboard tu ghep tu window.location.origin -> chu ao mo bang
 * localhost thi chu duoi ma QR mot dang, ma QR mot neo.
 */
handlers['GET /api/trace/link'] = (req, res) => {
    const ma = String(req.query.get('code') || '').trim().toUpperCase();
    if (!ma) return send(res, 400, { ok: false, error: 'Thiếu mã truy xuất' });
    if (!db.pondByTrace(ma)) return send(res, 404, { ok: false, error: 'Mã truy xuất không tồn tại' });

    const goc = diaChiCongKhai(req);
    const ds = dsIpLan();

    // Neu may co nhieu card mang thi noi ro dang chon cai nao va con cai
    // nao khac - de nguoi dung tu doi khi doan sai, khong phai ngoi mo code.
    const khac = ds.filter(x => !goc.includes(x.ip))
        .map(x => ({ url: `http://${x.ip}:${config.port}/trace.html?code=${encodeURIComponent(ma)}`, card: x.card }));

    send(res, 200, {
        ok: true,
        code: ma,
        url: `${goc}/trace.html?code=${encodeURIComponent(ma)}`,
        card_mang: config.publicUrl ? null : (ds[0] ? ds[0].card : null),
        dia_chi_khac: khac,
        canh_bao: (!config.publicUrl && !ds.length)
            ? 'Máy chủ chưa nối mạng LAN nên mã QR đang trỏ về localhost — điện thoại quét sẽ '
                + 'không ra gì. Nối máy vào cùng Wi-Fi với điện thoại rồi mở lại trang này.'
            : null,
        ghi_chu: config.publicUrl
            ? null
            : 'Điện thoại quét mã phải ở cùng mạng Wi-Fi với máy chạy server.',
    });
};

/**
 * Anh QR cua mot ma truy xuat, dang SVG.
 *
 * Truoc day dashboard lay anh tu api.qrserver.com -> mat mang la mat ma QR,
 * dung luc thu hoach can in dan thung xop thi khong co. Va moi lan mo hop
 * thoai la dia chi ao bi gui sang may chu cua mot cong ty khac.
 *
 * Nay may chu tu ve. Cong khai nhu /api/trace vi thuong lai phai quet duoc.
 * Chi nhan ma CO THAT trong database - khong bien thanh dich vu sinh QR
 * mien phi cho ca thien ha.
 */
handlers['GET /api/trace/qr'] = (req, res) => {
    const ma = String(req.query.get('code') || '').trim().toUpperCase();
    if (!ma) return send(res, 400, { ok: false, error: 'Thiếu mã truy xuất' });
    if (!db.pondByTrace(ma)) return send(res, 404, { ok: false, error: 'Mã truy xuất không tồn tại' });

    const url = `${diaChiCongKhai(req)}/trace.html?code=${encodeURIComponent(ma)}`;

    const coO = Math.min(20, Math.max(2, parseInt(req.query.get('o') || '8', 10) || 8));

    let svg;
    try {
        // Muc sua loi Q: ma van doc duoc khi nhan dan bi xuoc hoac dinh nuoc
        // ao - dieu chac chan xay ra voi thung tom.
        svg = qr.taoSVG(url, { muc: 'Q', coO });
    } catch (e) {
        console.error('LOI sinh QR:', e);
        return send(res, 500, { ok: false, error: 'Không sinh được mã QR' });
    }

    res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(svg),
        'Cache-Control': 'no-store',
    });
    res.end(svg);
};

/** Kiem tra dau niem phong cua ho so - ai cung goi duoc de doi chieu. */
handlers['GET /api/trace/verify'] = (req, res) => {
    const code = String(req.query.get('code') || '').trim().toUpperCase();
    const pond = db.pondByTrace(code);
    if (!pond) return send(res, 404, { ok: false, error: 'Mã truy xuất không tồn tại' });

    const kq = trace.kiemTraChuoi(pond.pond_id);
    send(res, 200, {
        ok: true,
        ma_truy_xuat: code,
        nguyen_ven: kq.ok,
        so_ban_ghi_da_kiem: kq.checked,
        ban_ghi_bat_thuong: kq.broken,
        kiem_luc: new Date().toISOString(),
        ghi_chu: kq.ok
            ? 'Chưa phát hiện dấu hiệu sửa đổi trên các bản ghi đã lưu.'
            : 'PHÁT HIỆN BẤT THƯỜNG: có bản ghi bị sửa sau khi lưu. Không nên dùng hồ sơ này để đối chiếu.',
    });
};

// ---------------- NHAP DU LIEU TRUY XUAT (can dang nhap) ----------------

/** Chi chu ao moi duoc ghi vao ho so truy xuat cua ao do. */
function aoCuaToi(req, res, pondId) {
    const u = canDangNhap(req, res);
    if (!u) return null;
    const pond = db.pondGet(String(pondId || ''));
    if (!pond || pond.user_id !== u.id) {
        send(res, 404, { ok: false, error: 'Không tìm thấy ao' });
        return null;
    }
    return { user: u, pond };
}

const LOAI_DAU_VAO = new Set(['giong', 'thuc_an', 'xu_ly', 'thuoc']);

handlers['GET /api/trace/records'] = (req, res) => {
    const ctx = aoCuaToi(req, res, req.query.get('pond_id'));
    if (!ctx) return;
    send(res, 200, {
        ok: true,
        pond_id: ctx.pond.pond_id,
        trace_code: ctx.pond.trace_code,
        dau_vao: db.traceInputs(ctx.pond.pond_id),
        thu_hoach: db.traceHarvests(ctx.pond.pond_id),
        kiem_nghiem: db.traceLabTests(ctx.pond.pond_id),
        van_chuyen: db.traceShipments(ctx.pond.pond_id),
        ngung_thuoc: trace.kiemTraNgungThuoc(ctx.pond.pond_id),
        niem_phong: trace.kiemTraChuoi(ctx.pond.pond_id),
    });
};

/** Vat tu dau vao: con giong, thuc an, chat xu ly, thuoc. */
handlers['POST /api/trace/input'] = (req, res, body) => {
    const b = body || {};
    const ctx = aoCuaToi(req, res, b.pond_id);
    if (!ctx) return;

    const kind = String(b.kind || '').trim();
    if (!LOAI_DAU_VAO.has(kind)) {
        return send(res, 400, { ok: false, error: 'kind phải là: giong | thuc_an | xu_ly | thuoc' });
    }
    if (!String(b.name || '').trim()) {
        return send(res, 400, { ok: false, error: 'Vui lòng nhập tên sản phẩm' });
    }

    // Thuoc ma khong ghi thoi gian ngung la LO HONG nguy hiem nhat
    // trong ca ho so -> chan ngay tu cua vao.
    const ngungNgay = b.withdrawal_days === undefined || b.withdrawal_days === null || b.withdrawal_days === ''
        ? null : parseInt(b.withdrawal_days, 10);
    if (kind === 'thuoc' && (!Number.isInteger(ngungNgay) || ngungNgay < 0)) {
        return send(res, 400, {
            ok: false,
            error: 'Thuốc bắt buộc phải ghi thời gian ngừng trước thu hoạch (số ngày). '
                + 'Không có con số này thì không tính được ngày thu hoạch an toàn.',
        });
    }

    const id = trace.themDauVao({
        pond_id: ctx.pond.pond_id,
        user_id: ctx.user.id,
        kind,
        name: String(b.name).trim().slice(0, 120),
        supplier: b.supplier ? String(b.supplier).slice(0, 120) : null,
        batch_code: b.batch_code ? String(b.batch_code).slice(0, 60) : null,
        quantity: Number(b.quantity) > 0 ? Number(b.quantity) : null,
        unit: b.unit ? String(b.unit).slice(0, 20) : null,
        active_ingredient: b.active_ingredient ? String(b.active_ingredient).slice(0, 120) : null,
        used_at: ngay(b.used_at),
        withdrawal_days: Number.isInteger(ngungNgay) ? ngungNgay : null,
        note: b.note ? String(b.note).slice(0, 300) : null,
    });

    db.logCreate(ctx.user.id, ctx.pond.pond_id, `Ghi hồ sơ đầu vào: ${b.name}`);
    send(res, 200, { ok: true, id, ngung_thuoc: trace.kiemTraNgungThuoc(ctx.pond.pond_id) });
};

/** Thu hoach + so lo che bien. */
handlers['POST /api/trace/harvest'] = (req, res, body) => {
    const b = body || {};
    const ctx = aoCuaToi(req, res, b.pond_id);
    if (!ctx) return;

    const luc = String(b.harvested_at || '').trim();
    if (!luc) return send(res, 400, { ok: false, error: 'Vui lòng nhập ngày giờ thu hoạch' });

    const id = trace.themThuHoach({
        pond_id: ctx.pond.pond_id,
        user_id: ctx.user.id,
        harvested_at: luc.slice(0, 25),
        quantity_kg: Number(b.quantity_kg) > 0 ? Number(b.quantity_kg) : null,
        size_count_kg: Number(b.size_count_kg) > 0 ? Math.round(Number(b.size_count_kg)) : null,
        lot_code: b.lot_code ? String(b.lot_code).slice(0, 60) : null,
        factory: b.factory ? String(b.factory).slice(0, 120) : null,
        factory_code: b.factory_code ? String(b.factory_code).slice(0, 40) : null,
        buyer: b.buyer ? String(b.buyer).slice(0, 120) : null,
        note: b.note ? String(b.note).slice(0, 300) : null,
    });

    // Bao NGAY neu thu som hon ngay an toan - khong doi den luc khach quet QR
    const nt = trace.kiemTraNgungThuoc(ctx.pond.pond_id);
    db.logCreate(ctx.user.id, ctx.pond.pond_id, `Ghi thu hoạch lô ${b.lot_code || '#' + id}`);

    send(res, 200, {
        ok: true,
        id,
        ngung_thuoc: nt,
        canh_bao: nt.canh_bao.length ? nt.canh_bao : null,
    });
};

/** Ket qua kiem nghiem (khang sinh, vi sinh...). */
handlers['POST /api/trace/labtest'] = (req, res, body) => {
    const b = body || {};
    const ctx = aoCuaToi(req, res, b.pond_id);
    if (!ctx) return;

    if (!String(b.parameter || '').trim()) {
        return send(res, 400, { ok: false, error: 'Vui lòng nhập chỉ tiêu kiểm nghiệm' });
    }

    const id = trace.themKiemNghiem({
        harvest_id: Number.isInteger(parseInt(b.harvest_id, 10)) ? parseInt(b.harvest_id, 10) : null,
        pond_id: ctx.pond.pond_id,
        user_id: ctx.user.id,
        lab_name: b.lab_name ? String(b.lab_name).slice(0, 150) : null,
        cert_code: b.cert_code ? String(b.cert_code).slice(0, 60) : null,
        parameter: String(b.parameter).trim().slice(0, 120),
        result_value: b.result_value !== undefined ? String(b.result_value).slice(0, 60) : null,
        unit: b.unit ? String(b.unit).slice(0, 20) : null,
        limit_value: b.limit_value !== undefined ? String(b.limit_value).slice(0, 60) : null,
        passed: b.passed === true || b.passed === 'true' || b.passed === 1 ? 1 : 0,
        tested_at: ngay(b.tested_at),
        note: b.note ? String(b.note).slice(0, 300) : null,
    });

    send(res, 200, { ok: true, id });
};

/** Van chuyen / cang xuat khau. */
handlers['POST /api/trace/shipment'] = (req, res, body) => {
    const b = body || {};
    const ctx = aoCuaToi(req, res, b.pond_id);
    if (!ctx) return;

    const id = trace.themVanChuyen({
        harvest_id: Number.isInteger(parseInt(b.harvest_id, 10)) ? parseInt(b.harvest_id, 10) : null,
        pond_id: ctx.pond.pond_id,
        user_id: ctx.user.id,
        route: b.route ? String(b.route).slice(0, 200) : null,
        port: b.port ? String(b.port).slice(0, 120) : null,
        destination: b.destination ? String(b.destination).slice(0, 120) : null,
        container_code: b.container_code ? String(b.container_code).slice(0, 40) : null,
        shipped_at: b.shipped_at ? String(b.shipped_at).slice(0, 25) : null,
        note: b.note ? String(b.note).slice(0, 300) : null,
    });

    send(res, 200, { ok: true, id });
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
        market: {
            enabled: config.market.enabled !== false,
            provider: config.market.provider,
            refreshMinutes: config.market.refreshMinutes,
            last_ok_at: market.state.lastOkAt,
            last_error: market.state.lastError,
            items: market.state.lastCount,
            next_refresh_at: market.state.nextAt,
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
