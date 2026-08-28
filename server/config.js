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

    // Dia chi CONG KHAI de nhet vao ma QR truy xuat nguon goc.
    //
    // De trong thi may chu tu doan: dung dia chi ma trinh duyet goi vao,
    // va neu do la localhost thi thay bang IP LAN cua may (vi ma QR danh
    // cho DIEN THOAI NGUOI KHAC quet - voi ho localhost la chinh may ho).
    //
    // Chi dat tay khi ban dua he thong ra Internet that, vi du:
    //   "publicUrl": "https://tomcamau.vn"
    publicUrl: '',

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

    // ============================================================
    // THI TRUONG: GIA TOM
    // ------------------------------------------------------------
    // Viet Nam CHUA co API gia tom chinh thuc mien phi, nen server
    // tu doc bang gia cong khai theo lich va luu lai.
    // Doi cau hinh: sua server/config.json (khong sua file nay).
    // ============================================================
    market: {
        enabled: true,

        // 'tepbac' = doc bang gia cong khai tren tepbac.com
        // 'json'   = goi 1 API JSON rieng (dien them jsonUrl ben duoi)
        provider: 'tepbac',

        // Trang nguon. Co the them nhieu trang, he thong gop lai.
        tepbacUrls: [
            'https://tepbac.com/gia-thuy-san/gia/tom',
        ],

        // Trang gia VAT TU (cam, voi, hoa chat) - trang rieng, KHONG nam
        // trong menu chinh cua tepbac nen rat de bo sot.
        tepbacSupplyUrls: [
            'https://tepbac.com/gia-thuy-san/gia/vat-tu',
        ],

        // TAT theo yeu cau nguoi dung.
        //
        // Trang vat tu cua tepbac co cau truc o khac han trang gia tom
        // (ma dinh vao ten o nhieu kieu khac nhau, o % kem ky han "3 thang"
        // de bi doc nham thanh tuoi du lieu). Bo doc lay sai nhieu lan.
        // So SAI ve chi phi dau vao con hai hon la khong co so nao.
        //
        // Bat lai: doi thanh true VA khoi phuc khoi HTML "Gia Vat Tu Dau Vao"
        // trong components/view_market.html + cac ham vt* trong js/market.js.
        // Bang market_supplies va API /api/market/supplies van con nguyen,
        // gia ban da tu nhap KHONG bi mat.
        suppliesEnabled: false,

        // Chi dung khi provider = 'json'
        jsonUrl: '',

        // Bao lau lay gia 1 lan (phut).
        refreshMinutes: 30,

        // Het bao lau khong lay duoc gia moi thi coi la SO LIEU CU
        // -> giao dien hien "Giá cũ, chưa cập nhật được" thay vi hien gia gia.
        staleAfterHours: 26,

        // Gioi han thoi gian cho 1 lan tai trang (mili giay)
        timeoutMs: 15000,

        // Chong bam nut "Lam moi" lien tuc (giay)
        minRefreshSeconds: 60,

        // Giu lich su gia bao nhieu ngay (de ve bieu do xu huong)
        historyDays: 400,

        // Ma bao ve API nhap gia tay (POST /api/market/manual).
        // De TRONG = chi cho phep nhap tu chinh may chay server (localhost).
        // Muon nhap tu dien thoai trong nha thi dat 1 chuoi bi mat o day
        // trong server/config.json va gui kem header X-Admin-Token.
        adminToken: '',
    },

    // ============================================================
    // MAY CHO AN TU DONG
    // ------------------------------------------------------------
    // De TRONG thi dung bang chuan trong server/feed.js.
    // Muon chinh theo trai cua minh thi khai bao lai trong config.json,
    // vi du doi gio cho an hoac ty le cho an theo co tom.
    // ============================================================
    feed: {
        // Gio cho an mac dinh trong ngay
        mealTimes: ['06:00', '10:00', '14:00', '18:00', '22:00'],

        // Bo trong = dung bang trong feed.js (DEFAULT_RATE_TABLE).
        // Muon thay thi khai bao day du, dang:
        //   [{ "maxWeightG": 5, "ratePct": 6.5, "meals": 4 }, ...]
        rateTable: null,

        // Bo trong = dung nguong trong feed.js (DEFAULT_ADJUST):
        // giam khau phan khi DO thap hoac nhiet do lech khoi khoang thich hop.
        adjust: null,
    },

    // ============================================================
    // TRUY XUAT NGUON GOC (ma QR tren bao bi)
    // ============================================================
    trace: {
        // Giu ket qua trang QR trong bo nho bao lau (phut).
        // Mot ma QR co the bi hang tram nguoi mua quet cung luc, tinh lai
        // toan bo ho so moi lan quet la phi.
        //
        // KHONG phai "cu N phut moi cap nhat mot lan": he thong XOA bo dem
        // NGAY khi ao co ban ghi moi (them thuoc / thu hoach / kiem nghiem /
        // van chuyen). Vua nhap la khach quet thay ngay.
        // Con so nay chi de gioi han so lan tinh lai phan nang (trung binh
        // chat luong nuoc 30 ngay) khi khong co gi thay doi.
        //   60  = 1 tieng   (mac dinh)
        //   300 = 5 tieng   (nhe may hon, ho so it thay doi)
        cacheMinutes: 60,
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
if (process.env.MARKET_REFRESH_MINUTES) config.market.refreshMinutes = parseInt(process.env.MARKET_REFRESH_MINUTES, 10);
if (process.env.MARKET_ADMIN_TOKEN) config.market.adminToken = process.env.MARKET_ADMIN_TOKEN;

module.exports = config;
