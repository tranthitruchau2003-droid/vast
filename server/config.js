// ================================================================
// config.js - Cau hinh backend VAST IoT
//
// Thu tu uu tien:  bien moi truong  >  file config.json  >  gia tri mac dinh
// Muon doi cau hinh: sua file server/config.json (tao tu config.example.json)
//
// KHONG dat mat khau / token nhay cam trong bat ky file nao cua frontend.
// device_token cua ESP32 duoc luu trong database, khong bao gio tra ve frontend.
// ================================================================

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    // Cong chay web + API
    port: 3000,

    // Qua bao nhieu giay khong nhan telemetry thi coi ESP32 la MAT KET NOI.
    // Yeu cau de bai: 15-30 giay.
    deviceOfflineSeconds: 20,

    // Khoang cach toi thieu giua 2 ban ghi LICH SU cam bien (giay).
    // ESP32 gui lien tuc nhung chi luu lich su theo nhip nay -> database khong phinh nhanh.
    // Card realtime tren dashboard van cap nhat theo TUNG goi telemetry (khong bi anh huong).
    //
    // 10 giay: bieu do muot, nhin ro thay doi khi demo. Toan 1 thiet bi tao ra
    // khoang 8.600 dong/ngay - rat nhe voi SQLite.
    // Muon tiet kiem dung luong hon nua (chay dai han) thi tang len 30-60.
    historySampleSeconds: 10,

    // Nguong canh bao (dung chung voi ESP32 - de website giai thich cho nguoi dung).
    // LUU Y: logic BAT/TAT relay that su chay TREN ESP32, khong phu thuoc server.
    thresholds: {
        doOn: 5.0,        // DO < 5.0 mg/L -> bat guong oxy
        doOff: 5.5,       // DO >= 5.5 mg/L -> tat guong oxy
        tempPumpOn: 32.0, // Nhiet do > 32.0 C -> bat may bom
        tempPumpOff: 31.5,// Nhiet do <= 31.5 C -> tat may bom
    },

    // Canh bao dong dien bat thuong tu INA219 (chuan bi cho canh bao motor/bom ket).
    // Hien tai chi tao CAU TRUC, chua bat canh bao that (enabled = false).
    currentAlarm: {
        enabled: false,
        maxCurrentMa: 3000,   // vuot nguong nay -> nghi ngo ket tai / chap
        minRunningMa: 50,     // relay dang BAT ma dong < nguong nay -> nghi ngo dut tai
    },
};

function loadFileConfig() {
    const p = path.join(__dirname, 'config.json');
    if (!fs.existsSync(p)) return {};
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        console.warn('[CONFIG] config.json khong doc duoc, dung gia tri mac dinh:', e.message);
        return {};
    }
}

function deepMerge(base, override) {
    const out = { ...base };
    for (const [k, v] of Object.entries(override || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(base[k] || {}, v);
        else if (v !== undefined && v !== null) out[k] = v;
    }
    return out;
}

const config = deepMerge(DEFAULTS, loadFileConfig());

// Bien moi truong de uu tien cao nhat (tien khi deploy)
if (process.env.PORT) config.port = parseInt(process.env.PORT, 10);
if (process.env.DEVICE_OFFLINE_SECONDS) config.deviceOfflineSeconds = parseInt(process.env.DEVICE_OFFLINE_SECONDS, 10);
if (process.env.HISTORY_SAMPLE_SECONDS) config.historySampleSeconds = parseInt(process.env.HISTORY_SAMPLE_SECONDS, 10);

module.exports = config;
