// ================================================================
// db.js - Lop luu tru du lieu IoT cho VAST
//
// KHONG CAN CAI DAT GI THEM (khong npm install, khong MySQL).
//
//  - Uu tien dung SQLite co san trong Node (module "node:sqlite",
//    co tu Node 22.5 tro len). File DB: server/data/vast.db
//  - Neu Node qua cu khong co node:sqlite -> tu dong chuyen sang
//    luu file JSON (server/data/vast.json). Cung API, van chay duoc,
//    chi kem hieu nang khi lich su rat lon.
//
// BANG DU LIEU (theo dung yeu cau muc 8):
//   iot_devices        - thiet bi ESP32 + token + ao tuong ung
//   iot_latest_data    - du lieu MOI NHAT (dashboard doc cai nay)
//   iot_sensor_history - lich su cam bien (ve bieu do)
//   iot_commands       - hang doi lenh Website -> ESP32
// ================================================================

const fs = require('fs');
const path = require('path');

// db.js nam trong lib/ nen phai lui mot cap moi toi server/data
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ----------------------------------------------------------------
// Thoi gian: luu dang ISO UTC ("2026-08-17T14:30:00.000Z") cho ca 2 backend
// -> frontend chi can new Date(chuoi) la ra gio dia phuong dung.
// ----------------------------------------------------------------
const nowIso = () => new Date().toISOString();

let impl = null;

// ================================================================
// BACKEND 1: SQLITE (uu tien)
// ================================================================
function createSqliteImpl() {
    let sqlite;
    try {
        sqlite = require('node:sqlite');
        if (!sqlite || !sqlite.DatabaseSync) return null;
    } catch (e) {
        return null;
    }

    const db = new sqlite.DatabaseSync(path.join(DATA_DIR, 'vast.db'));
    db.exec('PRAGMA journal_mode = WAL');

    db.exec(`
    CREATE TABLE IF NOT EXISTS iot_devices (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id     TEXT UNIQUE NOT NULL,
        device_token  TEXT NOT NULL,
        pond_id       TEXT NOT NULL,
        name          TEXT,
        mode          TEXT NOT NULL DEFAULT 'AUTO',
        last_seen     TEXT,
        created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS iot_latest_data (
        device_id      TEXT PRIMARY KEY,
        temperature    REAL,
        do_value       REAL,
        ph             REAL,
        voltage        REAL,
        current_ma     REAL,
        power_w        REAL,
        pump_status    INTEGER DEFAULT 0,
        aerator_status INTEGER DEFAULT 0,
        mode           TEXT DEFAULT 'AUTO',
        wifi_rssi      INTEGER,
        updated_at     TEXT
    );

    CREATE TABLE IF NOT EXISTS iot_sensor_history (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id      TEXT NOT NULL,
        temperature    REAL,
        do_value       REAL,
        ph             REAL,
        voltage        REAL,
        current_ma     REAL,
        power_w        REAL,
        pump_status    INTEGER,
        aerator_status INTEGER,
        created_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hist ON iot_sensor_history(device_id, created_at);

    CREATE TABLE IF NOT EXISTS iot_commands (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id    TEXT NOT NULL,
        command      TEXT NOT NULL,
        value        TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TEXT NOT NULL,
        sent_at      TEXT,
        executed_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cmd ON iot_commands(device_id, status);

    -- ============ THI TRUONG: GIA TOM ============
    -- market_prices    : gia MOI NHAT cua tung size (dashboard doc cai nay)
    -- market_history   : gia theo NGAY (ve bieu do xu huong)
    -- market_manual    : gia do nguoi dung nhap tay - UU TIEN hon gia tu dong
    -- market_meta      : ghi nho lan lay gia gan nhat, loi gan nhat...
    CREATE TABLE IF NOT EXISTS market_prices (
        code          TEXT PRIMARY KEY,
        name          TEXT,
        species       TEXT,
        species_label TEXT,
        size          INTEGER,
        size_label    TEXT,
        is_seed       INTEGER DEFAULT 0,
        price         REAL,
        prev_price    REAL,
        unit          TEXT,
        change_pct    REAL,
        change_period TEXT,          -- ky han cua % ("3 tháng") - PHAI hien ra
        region        TEXT,
        source        TEXT,
        source_url    TEXT,
        source_date   TEXT,
        source_age_days   INTEGER,
        source_updated_text TEXT,
        changed_at    TEXT,
        updated_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS market_history (
        code       TEXT NOT NULL,
        day        TEXT NOT NULL,
        price      REAL,
        unit       TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (code, day)
    );

    CREATE TABLE IF NOT EXISTS market_manual (
        code       TEXT PRIMARY KEY,
        name       TEXT,
        species    TEXT,
        size       INTEGER,
        price      REAL,
        unit       TEXT,
        region     TEXT,
        note       TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS market_meta (
        key   TEXT PRIMARY KEY,
        value TEXT
    );

    -- ============ GIA VAT TU DAU VAO ============
    -- Co 3 nguon, uu tien tu tren xuong:
    --   1. market_supplies      - GIA DAI LY BAO CHO CHINH BAN (chuan nhat)
    --   2. market_supply_auto   - gia tham khao toan quoc, tu dong tu tepbac
    --                             (trang /gia-thuy-san/gia/vat-tu)
    --   3. gia con giong        - lay tu bang gia tom (market_prices, is_seed)
    -- Bang duoi day giu phan NGUOI NUOI TU NHAP.
    CREATE TABLE IF NOT EXISTS market_supplies (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        loai       TEXT NOT NULL,     -- 'cam' | 'xu_ly' | 'thuoc' | 'khac'
        ten        TEXT NOT NULL,
        quy_cach   TEXT,              -- "Bao 20kg", "Goi 227g"
        nha_cung_cap TEXT,
        gia        REAL NOT NULL,
        gia_truoc  REAL,
        don_vi     TEXT,              -- "d/kg", "d/goi"
        ghi_chu    TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_supply ON market_supplies(user_id, loai);
    `);

    // ============================================================
    // NANG CAP CAU TRUC BANG (migration)
    //
    // LOI DA XAY RA THAT, PHAI DOC KY TRUOC KHI SUA:
    //   CREATE TABLE IF NOT EXISTS chi tao bang khi CHUA CO. Bang da ton
    //   tai tu ban cu thi cot moi KHONG duoc them vao. Ket qua: cau lenh
    //   INSERT nhac toi cot moi -> SQLite nem loi
    //       "table market_prices has no column named source_age_days"
    //   -> may chu roi ve backend JSON -> TOAN BO ao, so sach, nhat ky,
    //      QR trong vast.db BIEN MAT khoi giao dien (van con trong file,
    //      nhung khong duoc doc).
    //
    //   Truoc day chi vá tay dung cot moi nhat nen van sot. Nay do TU DONG:
    //   so cot thuc te trong bang voi danh sach mong doi, thieu cai nao
    //   them cai do.
    // ============================================================
    const COT_MONG_DOI = {
        market_prices: {
            change_pct: 'REAL', change_period: 'TEXT',
            source_url: 'TEXT', source_date: 'TEXT',
            source_age_days: 'INTEGER', source_updated_text: 'TEXT',
            is_seed: 'INTEGER', prev_price: 'REAL', changed_at: 'TEXT',
        },
        market_supply_auto: {
            loai_nuoi: 'TEXT', gia_truoc: 'REAL', change_pct: 'REAL',
            change_period: 'TEXT', source: 'TEXT', source_url: 'TEXT',
            source_date: 'TEXT', source_age_days: 'INTEGER',
            source_updated_text: 'TEXT',
        },
        market_supplies: {
            quy_cach: 'TEXT', nha_cung_cap: 'TEXT', gia_truoc: 'REAL',
            don_vi: 'TEXT', ghi_chu: 'TEXT', updated_at: 'TEXT',
        },
        iot_devices: { name: 'TEXT', last_seen: 'TEXT' },
    };

    let daThem = 0;
    for (const [bang, cot] of Object.entries(COT_MONG_DOI)) {
        let dangCo;
        try {
            dangCo = new Set(db.prepare(`PRAGMA table_info(${bang})`).all().map(r => r.name));
        } catch (e) {
            continue;                      // bang chua ton tai - CREATE o tren lo roi
        }
        if (!dangCo.size) continue;        // khong co bang nay
        for (const [ten, kieu] of Object.entries(cot)) {
            if (dangCo.has(ten)) continue;
            try {
                db.exec(`ALTER TABLE ${bang} ADD COLUMN ${ten} ${kieu}`);
                console.log(`[DB] Nang cap: them cot ${bang}.${ten}`);
                daThem++;
            } catch (e) {
                console.warn(`[DB] Khong them duoc cot ${bang}.${ten}: ${e.message}`);
            }
        }
    }
    if (daThem) console.log(`[DB] Da nang cap ${daThem} cot. Du lieu cu giu nguyen.`);

    db.exec(`

    -- Gia vat tu THAM KHAO lay tu dong tu tepbac (chung cho moi tai khoan).
    -- Tach rieng khoi market_supplies vi day KHONG phai gia cua rieng ai,
    -- va bi ghi de moi lan lay gia - khong duoc de dam vao so cua nguoi dung.
    CREATE TABLE IF NOT EXISTS market_supply_auto (
        code       TEXT PRIMARY KEY,
        ten        TEXT NOT NULL,
        loai       TEXT NOT NULL,     -- 'cam' | 'xu_ly' | 'thuoc' | 'khac'
        loai_nuoi  TEXT,              -- 'tom' | 'ca' | 'chung'
        gia        REAL NOT NULL,
        gia_truoc  REAL,
        don_vi     TEXT,
        change_pct REAL,
        change_period TEXT,
        source     TEXT,
        source_url TEXT,
        source_date TEXT,
        source_age_days INTEGER,
        source_updated_text TEXT,
        updated_at TEXT NOT NULL
    );

    -- ============ MAY CHO AN TU DONG ============
    -- pond_feed : thong so tinh khau phan cua tung ao
    --             (so giong tha, ty le song, trong luong chai mau, kho cam)
    -- feed_log  : nhat ky cac cu da xa / cac lan nap cam
    CREATE TABLE IF NOT EXISTS pond_feed (
        pond_id           TEXT PRIMARY KEY,
        seed_count        INTEGER,
        survival_pct      REAL,
        avg_weight_g      REAL,
        sample_at         TEXT,     -- lan chai mau gan nhat
        rate_pct          REAL,     -- tu dat, de trong thi tra bang theo co tom
        meals_per_day     INTEGER,
        meal_times        TEXT,     -- JSON: ["06:00","10:00",...]
        feed_stock_kg     REAL,
        feed_stock_max_kg REAL,
        auto_enabled      INTEGER DEFAULT 1,
        updated_at        TEXT
    );

    CREATE TABLE IF NOT EXISTS feed_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        pond_id    TEXT NOT NULL,
        kind       TEXT NOT NULL,     -- 'auto' | 'manual' | 'refill' | 'sample'
        amount_kg  REAL,
        note       TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feedlog ON feed_log(pond_id, created_at);

    -- pond_samples : LICH SU chai mau.
    --
    -- pond_feed chi giu trong luong CUA LAN GAN NHAT, nen khong the biet
    -- tom lon nhanh hay cham. Muon tra loi "nuoi them bao nhieu ngay nua
    -- thi len duoc size 40" thi bat buoc phai co it nhat HAI lan can.
    CREATE TABLE IF NOT EXISTS pond_samples (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        pond_id      TEXT NOT NULL,
        avg_weight_g REAL NOT NULL,
        sample_count INTEGER,
        total_g      REAL,
        created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sample ON pond_samples(pond_id, created_at);

    -- pond_harvest_plan : quyet dinh "giu lai nuoi tiep".
    --
    -- Chu ao xem co van thu hoach roi bam giu lai -> ghi lai moc size dang
    -- nham toi va ngay du kien dat duoc, de den ngay do he thong con nhac.
    -- Truoc day nut nay khong lam gi ca.
    CREATE TABLE IF NOT EXISTS pond_harvest_plan (
        pond_id        TEXT PRIMARY KEY,
        size_hien_tai  REAL,
        size_muc_tieu  REAL,
        ngay_du_kien   TEXT,
        loi_lai_uoc    REAL,
        ghi_chu        TEXT,
        da_nhac        INTEGER DEFAULT 0,
        created_at     TEXT NOT NULL,
        updated_at     TEXT
    );

    -- ============ TAI KHOAN & DU LIEU NGUOI DUNG ============
    -- Truoc day toan bo phan nay nam trong localStorage cua trinh duyet:
    -- doi may la mat sach. Chuyen han vao database.
    CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        phone      TEXT UNIQUE NOT NULL,
        name       TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'Trại trưởng',
        avatar     TEXT,
        pass_salt  TEXT NOT NULL,
        pass_hash  TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id);

    -- Ao nuoi: truoc day la mang cung trong dashboard.html
    CREATE TABLE IF NOT EXISTS ponds (
        pond_id       TEXT PRIMARY KEY,
        user_id       INTEGER NOT NULL,
        name          TEXT NOT NULL,
        area_m2       REAL,
        seed_type     TEXT,
        seed_count    INTEGER,
        stocking_date TEXT,
        status        TEXT DEFAULT 'safe',
        note          TEXT,
        trace_code    TEXT UNIQUE,   -- ma QR truy xuat nguon goc
        created_at    TEXT NOT NULL,
        updated_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pond_user ON ponds(user_id);

    -- So sach thu chi
    CREATE TABLE IF NOT EXISTS transactions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        pond_id    TEXT,
        type       TEXT NOT NULL,      -- 'thu' | 'chi'
        amount     REAL NOT NULL,
        category   TEXT,
        date       TEXT NOT NULL,      -- YYYY-MM-DD
        note       TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_txn ON transactions(user_id, date);

    -- Nhat ky AI / nhat ky hoat dong
    CREATE TABLE IF NOT EXISTS ai_logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        pond_id    TEXT,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ailog ON ai_logs(user_id, created_at);

    -- Cai dat rieng cua tung nguoi (gia dien, nguong canh bao, van tay...)
    CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER NOT NULL,
        key     TEXT NOT NULL,
        value   TEXT,
        PRIMARY KEY (user_id, key)
    );

    -- ============ TRUY XUAT NGUON GOC (QR XUAT KHAU) ============
    -- 4 nhom thong tin theo yeu cau cua thi truong xuat khau:
    --   1. Vung nuoi        -> bang ponds (da co) + ma co so nuoi chinh thuc
    --   2. Dau vao          -> trace_inputs   (giong, cam, thuoc, xu ly)
    --   3. Qua trinh nuoi   -> feed_log + iot_sensor_history (da co, MAY tu ghi)
    --   4. Che bien/logistics -> trace_harvests + trace_lab_tests + trace_shipments
    --
    -- CHONG SUA: moi ban ghi mang record_hash = sha256(prev_hash + noi dung).
    -- Sua lai mot dong cu la cac dong sau no khong con khop -> phat hien duoc.
    -- Day KHONG phai blockchain, chi la so nhat ky co dau niem phong.

    CREATE TABLE IF NOT EXISTS trace_inputs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        pond_id       TEXT NOT NULL,
        user_id       INTEGER NOT NULL,
        kind          TEXT NOT NULL,   -- 'giong' | 'thuc_an' | 'xu_ly' | 'thuoc'
        name          TEXT NOT NULL,
        supplier      TEXT,            -- cong ty cung cap
        batch_code    TEXT,            -- ma lo
        quantity      REAL,
        unit          TEXT,
        active_ingredient TEXT,        -- hoat chat (voi thuoc)
        used_at       TEXT,            -- ngay dung (YYYY-MM-DD)
        withdrawal_days INTEGER,       -- thoi gian NGUNG THUOC truoc thu hoach
        note          TEXT,
        prev_hash     TEXT,
        record_hash   TEXT,
        created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tin ON trace_inputs(pond_id, id);

    CREATE TABLE IF NOT EXISTS trace_harvests (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        pond_id       TEXT NOT NULL,
        user_id       INTEGER NOT NULL,
        harvested_at  TEXT NOT NULL,   -- ngay gio thu hoach
        quantity_kg   REAL,
        size_count_kg INTEGER,         -- con/kg
        lot_code      TEXT,            -- so lo che bien
        factory       TEXT,            -- nha may che bien
        factory_code  TEXT,            -- ma so nha may (DL code)
        buyer         TEXT,
        note          TEXT,
        prev_hash     TEXT,
        record_hash   TEXT,
        created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_thv ON trace_harvests(pond_id, id);

    CREATE TABLE IF NOT EXISTS trace_lab_tests (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        harvest_id    INTEGER,
        pond_id       TEXT NOT NULL,
        user_id       INTEGER NOT NULL,
        lab_name      TEXT,            -- don vi kiem nghiem
        cert_code     TEXT,            -- so phieu ket qua
        parameter     TEXT NOT NULL,   -- chi tieu, vd Chloramphenicol
        result_value  TEXT,
        unit          TEXT,
        limit_value   TEXT,
        passed        INTEGER,         -- 1 dat / 0 khong dat
        tested_at     TEXT,
        note          TEXT,
        prev_hash     TEXT,
        record_hash   TEXT,
        created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tlt ON trace_lab_tests(pond_id, id);

    CREATE TABLE IF NOT EXISTS trace_shipments (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        harvest_id     INTEGER,
        pond_id        TEXT NOT NULL,
        user_id        INTEGER NOT NULL,
        route          TEXT,           -- tuyen van chuyen
        port           TEXT,           -- cang xuat khau
        destination    TEXT,           -- thi truong den
        container_code TEXT,
        shipped_at     TEXT,
        note           TEXT,
        prev_hash      TEXT,
        record_hash    TEXT,
        created_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tsh ON trace_shipments(pond_id, id);
    `);

    const q = {
        listDevices: db.prepare('SELECT * FROM iot_devices ORDER BY id'),
        getDevice: db.prepare('SELECT * FROM iot_devices WHERE device_id = ?'),
        insertDevice: db.prepare(
            'INSERT INTO iot_devices (device_id, device_token, pond_id, name, mode, created_at) VALUES (?,?,?,?,?,?)'
        ),
        updateDevice: db.prepare('UPDATE iot_devices SET device_token=?, pond_id=?, name=? WHERE device_id=?'),
        touchDevice: db.prepare('UPDATE iot_devices SET last_seen=?, mode=? WHERE device_id=?'),
        setDevicePond: db.prepare('UPDATE iot_devices SET pond_id=? WHERE device_id=?'),

        getLatest: db.prepare('SELECT * FROM iot_latest_data WHERE device_id = ?'),
        insertLatest: db.prepare(`INSERT INTO iot_latest_data
            (device_id, temperature, do_value, ph, voltage, current_ma, power_w,
             pump_status, aerator_status, mode, wifi_rssi, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
        updateLatest: db.prepare(`UPDATE iot_latest_data SET
            temperature=?, do_value=?, ph=?, voltage=?, current_ma=?, power_w=?,
            pump_status=?, aerator_status=?, mode=?, wifi_rssi=?, updated_at=?
            WHERE device_id=?`),

        lastHistory: db.prepare('SELECT created_at FROM iot_sensor_history WHERE device_id=? ORDER BY id DESC LIMIT 1'),
        insertHistory: db.prepare(`INSERT INTO iot_sensor_history
            (device_id, temperature, do_value, ph, voltage, current_ma, power_w, pump_status, aerator_status, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`),
        historySince: db.prepare(
            'SELECT * FROM iot_sensor_history WHERE device_id=? AND created_at >= ? ORDER BY created_at ASC'
        ),

        pendingCommands: db.prepare("SELECT * FROM iot_commands WHERE device_id=? AND status='pending' ORDER BY id ASC"),
        markSent: db.prepare("UPDATE iot_commands SET status='sent', sent_at=? WHERE id=?"),
        markDone: db.prepare("UPDATE iot_commands SET status='done', executed_at=? WHERE id=? AND device_id=?"),
        supersede: db.prepare("UPDATE iot_commands SET status='ignored' WHERE device_id=? AND command=? AND status IN ('pending','sent')"),
        insertCommand: db.prepare('INSERT INTO iot_commands (device_id, command, value, status, created_at) VALUES (?,?,?,?,?)'),
        recentCommands: db.prepare('SELECT * FROM iot_commands WHERE device_id=? ORDER BY id DESC LIMIT ?'),
        purgeHistory: db.prepare('DELETE FROM iot_sensor_history WHERE created_at < ?'),

        // ---- THI TRUONG ----
        mktList: db.prepare('SELECT * FROM market_prices ORDER BY species, size, code'),
        mktGet: db.prepare('SELECT * FROM market_prices WHERE code = ?'),
        mktInsert: db.prepare(`INSERT INTO market_prices
            (code, name, species, species_label, size, size_label, is_seed,
             price, prev_price, unit, change_pct, change_period, region, source, source_url,
             source_date, source_age_days, source_updated_text, changed_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
        mktUpdate: db.prepare(`UPDATE market_prices SET
            name=?, species=?, species_label=?, size=?, size_label=?, is_seed=?,
            price=?, prev_price=?, unit=?, change_pct=?, change_period=?, region=?, source=?,
            source_url=?, source_date=?, source_age_days=?, source_updated_text=?,
            changed_at=?, updated_at=?
            WHERE code=?`),

        mktHistUpsert: db.prepare(`INSERT INTO market_history (code, day, price, unit, created_at)
            VALUES (?,?,?,?,?)
            ON CONFLICT(code, day) DO UPDATE SET price=excluded.price, unit=excluded.unit`),
        mktHistSince: db.prepare('SELECT day, price, unit FROM market_history WHERE code=? AND day >= ? ORDER BY day ASC'),
        mktHistPurge: db.prepare('DELETE FROM market_history WHERE day < ?'),
        mktHistPrev: db.prepare('SELECT day, price FROM market_history WHERE code=? AND day < ? ORDER BY day DESC LIMIT 1'),

        mktManualList: db.prepare('SELECT * FROM market_manual'),
        mktManualUpsert: db.prepare(`INSERT INTO market_manual
            (code, name, species, size, price, unit, region, note, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(code) DO UPDATE SET
              name=excluded.name, species=excluded.species, size=excluded.size,
              price=excluded.price, unit=excluded.unit, region=excluded.region,
              note=excluded.note, updated_at=excluded.updated_at`),
        mktManualDelete: db.prepare('DELETE FROM market_manual WHERE code = ?'),

        mktMetaGet: db.prepare('SELECT value FROM market_meta WHERE key = ?'),
        mktMetaSet: db.prepare(`INSERT INTO market_meta (key, value) VALUES (?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value`),

        // ---- VAT TU DAU VAO ----
        vtList: db.prepare('SELECT * FROM market_supplies WHERE user_id=? ORDER BY loai, ten'),
        vtGet: db.prepare('SELECT * FROM market_supplies WHERE id=? AND user_id=?'),
        vtInsert: db.prepare(`INSERT INTO market_supplies
            (user_id, loai, ten, quy_cach, nha_cung_cap, gia, gia_truoc, don_vi, ghi_chu, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
        vtUpdate: db.prepare(`UPDATE market_supplies SET
            loai=?, ten=?, quy_cach=?, nha_cung_cap=?, gia=?, gia_truoc=?, don_vi=?, ghi_chu=?, updated_at=?
            WHERE id=? AND user_id=?`),
        vtDelete: db.prepare('DELETE FROM market_supplies WHERE id=? AND user_id=?'),

        vtAutoAll: db.prepare('SELECT * FROM market_supply_auto ORDER BY loai, ten'),
        vtAutoGet: db.prepare('SELECT * FROM market_supply_auto WHERE code=?'),
        vtAutoUpsert: db.prepare(`INSERT INTO market_supply_auto
            (code, ten, loai, loai_nuoi, gia, gia_truoc, don_vi, change_pct, change_period,
             source, source_url, source_date, source_age_days, source_updated_text, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(code) DO UPDATE SET
                ten=?, loai=?, loai_nuoi=?, gia=?, gia_truoc=?, don_vi=?, change_pct=?,
                change_period=?, source=?, source_url=?, source_date=?, source_age_days=?,
                source_updated_text=?, updated_at=?`),

        // ---- MAY CHO AN ----
        feedGet: db.prepare('SELECT * FROM pond_feed WHERE pond_id = ?'),
        feedAll: db.prepare('SELECT * FROM pond_feed'),
        feedUpsert: db.prepare(`INSERT INTO pond_feed
            (pond_id, seed_count, survival_pct, avg_weight_g, sample_at, rate_pct,
             meals_per_day, meal_times, feed_stock_kg, feed_stock_max_kg, auto_enabled, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(pond_id) DO UPDATE SET
              seed_count=excluded.seed_count, survival_pct=excluded.survival_pct,
              avg_weight_g=excluded.avg_weight_g, sample_at=excluded.sample_at,
              rate_pct=excluded.rate_pct, meals_per_day=excluded.meals_per_day,
              meal_times=excluded.meal_times, feed_stock_kg=excluded.feed_stock_kg,
              feed_stock_max_kg=excluded.feed_stock_max_kg, auto_enabled=excluded.auto_enabled,
              updated_at=excluded.updated_at`),
        feedStock: db.prepare('UPDATE pond_feed SET feed_stock_kg = ?, updated_at = ? WHERE pond_id = ?'),

        feedLogAdd: db.prepare('INSERT INTO feed_log (pond_id, kind, amount_kg, note, created_at) VALUES (?,?,?,?,?)'),
        feedLogRecent: db.prepare('SELECT * FROM feed_log WHERE pond_id=? ORDER BY id DESC LIMIT ?'),
        feedLogSince: db.prepare('SELECT * FROM feed_log WHERE pond_id=? AND created_at >= ? ORDER BY created_at ASC'),

        // ---- LICH SU CHAI MAU ----
        sampleAdd: db.prepare(`INSERT INTO pond_samples
            (pond_id, avg_weight_g, sample_count, total_g, created_at) VALUES (?,?,?,?,?)`),
        sampleList: db.prepare('SELECT * FROM pond_samples WHERE pond_id=? ORDER BY created_at ASC'),

        // ---- QUYET DINH GIU LAI NUOI TIEP ----
        hpGet: db.prepare('SELECT * FROM pond_harvest_plan WHERE pond_id=?'),
        hpAll: db.prepare('SELECT * FROM pond_harvest_plan'),
        hpSave: db.prepare(`INSERT INTO pond_harvest_plan
            (pond_id, size_hien_tai, size_muc_tieu, ngay_du_kien, loi_lai_uoc, ghi_chu, da_nhac, created_at, updated_at)
            VALUES (?,?,?,?,?,?,0,?,?)
            ON CONFLICT(pond_id) DO UPDATE SET
              size_hien_tai=excluded.size_hien_tai, size_muc_tieu=excluded.size_muc_tieu,
              ngay_du_kien=excluded.ngay_du_kien, loi_lai_uoc=excluded.loi_lai_uoc,
              ghi_chu=excluded.ghi_chu, da_nhac=0, updated_at=excluded.updated_at`),
        hpDanhDauNhac: db.prepare('UPDATE pond_harvest_plan SET da_nhac=1, updated_at=? WHERE pond_id=?'),
        hpXoa: db.prepare('DELETE FROM pond_harvest_plan WHERE pond_id=?'),

        // ---- TAI KHOAN ----
        userByPhone: db.prepare('SELECT * FROM users WHERE phone = ?'),
        userById: db.prepare('SELECT * FROM users WHERE id = ?'),
        userInsert: db.prepare(`INSERT INTO users (phone, name, role, avatar, pass_salt, pass_hash, created_at)
            VALUES (?,?,?,?,?,?,?)`),
        userUpdate: db.prepare('UPDATE users SET name=?, role=?, avatar=? WHERE id=?'),
        userPass: db.prepare('UPDATE users SET pass_salt=?, pass_hash=? WHERE id=?'),
        userTouch: db.prepare('UPDATE users SET last_login=? WHERE id=?'),

        sessInsert: db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)'),
        sessGet: db.prepare('SELECT * FROM sessions WHERE token = ?'),
        sessDelete: db.prepare('DELETE FROM sessions WHERE token = ?'),
        sessDeleteUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
        sessPurge: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),

        // ---- AO NUOI ----
        pondList: db.prepare('SELECT * FROM ponds WHERE user_id = ? ORDER BY created_at'),
        pondGet: db.prepare('SELECT * FROM ponds WHERE pond_id = ?'),
        pondByTrace: db.prepare('SELECT * FROM ponds WHERE trace_code = ?'),
        pondInsert: db.prepare(`INSERT INTO ponds
            (pond_id, user_id, name, area_m2, seed_type, seed_count, stocking_date, status, note, trace_code, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
        pondUpdate: db.prepare(`UPDATE ponds SET
            name=?, area_m2=?, seed_type=?, seed_count=?, stocking_date=?, status=?, note=?, updated_at=?
            WHERE pond_id=? AND user_id=?`),
        pondDelete: db.prepare('DELETE FROM ponds WHERE pond_id=? AND user_id=?'),

        // ---- SO SACH ----
        txnList: db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC, id DESC LIMIT ?'),
        txnListPond: db.prepare('SELECT * FROM transactions WHERE user_id=? AND pond_id=? ORDER BY date DESC, id DESC LIMIT ?'),
        txnGet: db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?'),
        txnInsert: db.prepare(`INSERT INTO transactions
            (user_id, pond_id, type, amount, category, date, note, created_at) VALUES (?,?,?,?,?,?,?,?)`),
        txnUpdate: db.prepare(`UPDATE transactions SET
            pond_id=?, type=?, amount=?, category=?, date=?, note=? WHERE id=? AND user_id=?`),
        txnDelete: db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?'),

        // ---- NHAT KY ----
        logList: db.prepare('SELECT * FROM ai_logs WHERE user_id=? ORDER BY id DESC LIMIT ?'),
        logInsert: db.prepare('INSERT INTO ai_logs (user_id, pond_id, content, created_at) VALUES (?,?,?,?)'),
        logPurge: db.prepare('DELETE FROM ai_logs WHERE created_at < ?'),

        // ---- CAI DAT ----
        setList: db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?'),
        setUpsert: db.prepare(`INSERT INTO user_settings (user_id, key, value) VALUES (?,?,?)
            ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value`),

        // ---- TRUY XUAT NGUON GOC ----
        tinList: db.prepare('SELECT * FROM trace_inputs WHERE pond_id=? ORDER BY id'),
        tinInsert: db.prepare(`INSERT INTO trace_inputs
            (pond_id, user_id, kind, name, supplier, batch_code, quantity, unit,
             active_ingredient, used_at, withdrawal_days, note, prev_hash, record_hash, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
        tinDelete: db.prepare('DELETE FROM trace_inputs WHERE id=? AND user_id=?'),

        thvList: db.prepare('SELECT * FROM trace_harvests WHERE pond_id=? ORDER BY id'),
        thvInsert: db.prepare(`INSERT INTO trace_harvests
            (pond_id, user_id, harvested_at, quantity_kg, size_count_kg, lot_code,
             factory, factory_code, buyer, note, prev_hash, record_hash, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),
        thvDelete: db.prepare('DELETE FROM trace_harvests WHERE id=? AND user_id=?'),

        tltList: db.prepare('SELECT * FROM trace_lab_tests WHERE pond_id=? ORDER BY id'),
        tltInsert: db.prepare(`INSERT INTO trace_lab_tests
            (harvest_id, pond_id, user_id, lab_name, cert_code, parameter, result_value,
             unit, limit_value, passed, tested_at, note, prev_hash, record_hash, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
        tltDelete: db.prepare('DELETE FROM trace_lab_tests WHERE id=? AND user_id=?'),

        tshList: db.prepare('SELECT * FROM trace_shipments WHERE pond_id=? ORDER BY id'),
        tshInsert: db.prepare(`INSERT INTO trace_shipments
            (harvest_id, pond_id, user_id, route, port, destination, container_code,
             shipped_at, note, prev_hash, record_hash, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
        tshDelete: db.prepare('DELETE FROM trace_shipments WHERE id=? AND user_id=?'),
    };

    return {
        backend: 'sqlite',

        listDevices: () => q.listDevices.all(),
        getDevice: id => q.getDevice.get(id) || null,
        createDevice: (d) => q.insertDevice.run(d.device_id, d.device_token, d.pond_id, d.name, 'AUTO', nowIso()),
        updateDevice: (d) => q.updateDevice.run(d.device_token, d.pond_id, d.name, d.device_id),
        touchDevice: (id, mode) => q.touchDevice.run(nowIso(), mode, id),

        /** Gan thiet bi ESP32 vao mot ao. Day la cai noi web voi phan cung. */
        deviceSetPond: (deviceId, pondId) => q.setDevicePond.run(pondId, deviceId).changes,

        getLatest: id => q.getLatest.get(id) || null,
        saveLatest(p) {
            const exists = q.getLatest.get(p.device_id);
            const args = [p.temperature, p.do_value, p.ph, p.voltage, p.current_ma, p.power_w,
                p.pump_status, p.aerator_status, p.mode, p.wifi_rssi, nowIso()];
            if (exists) q.updateLatest.run(...args, p.device_id);
            else q.insertLatest.run(p.device_id, ...args);
        },

        lastHistoryAt: id => {
            const r = q.lastHistory.get(id);
            return r ? r.created_at : null;
        },
        addHistory(p) {
            q.insertHistory.run(p.device_id, p.temperature, p.do_value, p.ph, p.voltage,
                p.current_ma, p.power_w, p.pump_status, p.aerator_status, nowIso());
        },
        historySince: (id, sinceIso) => q.historySince.all(id, sinceIso),
        purgeHistoryBefore: sinceIso => q.purgeHistory.run(sinceIso),

        pendingCommands: id => q.pendingCommands.all(id),
        markSent: cmdId => q.markSent.run(nowIso(), cmdId),
        markDone: (cmdId, devId) => q.markDone.run(nowIso(), cmdId, devId).changes,
        supersede: (devId, cmd) => q.supersede.run(devId, cmd),
        addCommand(devId, cmd, value) {
            const info = q.insertCommand.run(devId, cmd, value, 'pending', nowIso());
            return Number(info.lastInsertRowid);
        },
        recentCommands: (id, limit = 20) => q.recentCommands.all(id, limit),

        // ================= THI TRUONG: GIA TOM =================
        marketList: () => q.mktList.all(),
        marketGet: code => q.mktGet.get(code) || null,

        /**
         * Xoa cac dong TU DONG khong con trong lan lay gia moi nhat.
         *
         * VI SAO CAN: khi bo doc duoc sua, khoa cua mot muc co the doi
         * (vi du "TCX10_TOM_CANG_XANH_LOAI_6_15_CON_KG" -> "TCX10").
         * Dong cu khong ai ghi de nen nam lai mai trong database, va giao
         * dien hien CA HAI - nguoi nuoi thay 1 size co 2 gia khac nhau,
         * mot cai dung mot cai sai. Da xay ra that.
         *
         * CHI xoa dong tu dong. Gia NHAP TAY giu nguyen - do la so nguoi
         * dung tu ghi, nguon khong co cung khong duoc dung.
         *
         * @param {string[]} codesConDung ma cua cac muc vua lay ve duoc
         * @returns {number} so dong da xoa
         */
        /** Xoa 1 dong gia theo ma. Khong dung toi bang gia nhap tay. */
        marketDelete: code => db.prepare('DELETE FROM market_prices WHERE code=?').run(code).changes,

        marketPurgeMissing(codesConDung) {
            const giu = new Set(codesConDung || []);
            if (!giu.size) return 0;                 // khong lay duoc gi -> KHONG xoa gi
            let n = 0;
            for (const r of q.mktList.all()) {
                if (giu.has(r.code)) continue;
                if (r.manual) continue;              // gia nhap tay: khong dung toi
                if (r.source && r.source !== 'tepbac' && r.source !== 'json') continue;
                db.prepare('DELETE FROM market_prices WHERE code=?').run(r.code);
                n++;
            }
            return n;
        },

        /**
         * Ghi gia moi nhat cua 1 size.
         * Neu gia THAY DOI so voi lan truoc -> nho lai gia cu (prev_price)
         * de giao dien hien duoc "+2.000 d" / "-500 d" that, khong phai so bia.
         */
        marketSavePrice(it) {
            const old = q.mktGet.get(it.code);
            const now = nowIso();

            let prev = old ? old.prev_price : null;
            let changedAt = old ? old.changed_at : now;
            if (old && Number.isFinite(old.price) && old.price !== it.price) {
                prev = old.price;
                changedAt = now;
            }

            // node:sqlite nem loi neu bat ky tham so nao la undefined.
            // Thieu DUNG MOT truong la ca lan lay gia do vo -> nguoi nuoi
            // mat sach bang gia. Doi het undefined thanh null cho chac.
            const n0 = v => (v === undefined ? null : v);

            const args = [
                n0(it.name), n0(it.species), n0(it.species_label), n0(it.size), n0(it.size_label),
                it.is_seed ? 1 : 0, n0(it.price), n0(prev), n0(it.unit), n0(it.change_pct),
                n0(it.change_period), n0(it.region), n0(it.source), n0(it.source_url), n0(it.source_date),
                n0(it.source_age_days), n0(it.source_updated_text), changedAt, now,
            ];
            if (old) q.mktUpdate.run(...args, it.code);
            else q.mktInsert.run(it.code, ...args);
        },

        marketAddHistory: (code, day, price, unit) => q.mktHistUpsert.run(code, day, price, unit, nowIso()),
        marketHistorySince: (code, sinceDay) => q.mktHistSince.all(code, sinceDay),
        /** Gia gan nhat TRUOC ngay dua vao - dung de tinh "tang/giam so voi hom qua". */
        marketPrevPrice(code, beforeDay) {
            const r = q.mktHistPrev.get(code, beforeDay);
            return r ? r.price : null;
        },
        marketPurgeHistoryBefore: day => q.mktHistPurge.run(day),

        marketManualList: () => q.mktManualList.all(),
        marketManualSave: m => q.mktManualUpsert.run(m.code, m.name, m.species, m.size,
            m.price, m.unit, m.region, m.note, nowIso()),
        marketManualDelete: code => q.mktManualDelete.run(code),

        marketMeta(key) {
            const r = q.mktMetaGet.get(key);
            return r ? r.value : null;
        },
        marketSetMeta: (key, value) => q.mktMetaSet.run(key, String(value)),

        // ================= VAT TU DAU VAO =================
        supplyList: userId => q.vtList.all(userId),
        supplyGet: (id, userId) => q.vtGet.get(id, userId) || null,
        supplyCreate(v) {
            const info = q.vtInsert.run(v.user_id, v.loai, v.ten, v.quy_cach, v.nha_cung_cap,
                v.gia, null, v.don_vi, v.ghi_chu, nowIso(), nowIso());
            return Number(info.lastInsertRowid);
        },
        supplyUpdate(id, userId, v) {
            const cu = q.vtGet.get(id, userId);
            if (!cu) return 0;
            // Doi gia thi nho gia cu de tinh duoc muc tang/giam
            const giaTruoc = (Number.isFinite(cu.gia) && cu.gia !== v.gia) ? cu.gia : cu.gia_truoc;
            return q.vtUpdate.run(v.loai, v.ten, v.quy_cach, v.nha_cung_cap, v.gia,
                giaTruoc, v.don_vi, v.ghi_chu, nowIso(), id, userId).changes;
        },
        supplyDelete: (id, userId) => q.vtDelete.run(id, userId).changes,

        // --- gia vat tu tu dong (tepbac) ---
        supplyAutoAll: () => q.vtAutoAll.all(),
        supplyAutoPurgeMissing(codesConDung) {
            const giu = new Set(codesConDung || []);
            if (!giu.size) return 0;
            let n = 0;
            for (const r of q.vtAutoAll.all()) {
                if (giu.has(r.code)) continue;
                db.prepare('DELETE FROM market_supply_auto WHERE code=?').run(r.code);
                n++;
            }
            return n;
        },
        supplyAutoSave(v) {
            const cu = q.vtAutoGet.get(v.code);
            // Giu lai gia lan truoc de tinh duoc muc tang/giam khi nguon
            // khong cong bo % (tepbac co cong bo, nhung khong phai luc nao cung co)
            const giaTruoc = (cu && Number.isFinite(cu.gia) && cu.gia !== v.gia) ? cu.gia : (cu ? cu.gia_truoc : null);
            const now = nowIso();
            q.vtAutoUpsert.run(
                v.code, v.ten, v.loai, v.loai_nuoi ?? null, v.gia, giaTruoc ?? null,
                v.don_vi ?? null, v.change_pct ?? null, v.change_period ?? null,
                v.source ?? null, v.source_url ?? null,
                v.source_date ?? null, v.source_age_days ?? null, v.source_updated_text ?? null, now,
                v.ten, v.loai, v.loai_nuoi ?? null, v.gia, giaTruoc ?? null,
                v.don_vi ?? null, v.change_pct ?? null, v.change_period ?? null,
                v.source ?? null, v.source_url ?? null,
                v.source_date ?? null, v.source_age_days ?? null, v.source_updated_text ?? null, now
            );
        },

        // ================= MAY CHO AN TU DONG =================
        feedGet: pondId => q.feedGet.get(pondId) || null,
        feedAll: () => q.feedAll.all(),
        feedSave(f) {
            q.feedUpsert.run(
                f.pond_id, f.seed_count, f.survival_pct, f.avg_weight_g, f.sample_at,
                f.rate_pct, f.meals_per_day,
                f.meal_times ? JSON.stringify(f.meal_times) : null,
                f.feed_stock_kg, f.feed_stock_max_kg,
                f.auto_enabled === 0 ? 0 : 1, nowIso()
            );
        },
        feedSetStock: (pondId, kg) => q.feedStock.run(kg, nowIso(), pondId),

        feedLogAdd: (pondId, kind, amountKg, note) =>
            q.feedLogAdd.run(pondId, kind, amountKg, note || null, nowIso()),
        feedLogRecent: (pondId, limit = 20) => q.feedLogRecent.all(pondId, limit),
        feedLogSince: (pondId, sinceIso) => q.feedLogSince.all(pondId, sinceIso),

        // ---- LICH SU CHAI MAU ----
        sampleAdd: (pondId, w, soCon, tongG) =>
            q.sampleAdd.run(pondId, w, soCon || null, tongG || null, nowIso()),
        sampleList: pondId => q.sampleList.all(pondId),

        // ---- QUYET DINH GIU LAI NUOI TIEP ----
        harvestPlanGet: pondId => q.hpGet.get(pondId) || null,
        harvestPlanAll: () => q.hpAll.all(),
        harvestPlanSave: (p) => q.hpSave.run(
            p.pond_id, p.size_hien_tai ?? null, p.size_muc_tieu ?? null,
            p.ngay_du_kien ?? null, p.loi_lai_uoc ?? null, p.ghi_chu ?? null,
            nowIso(), nowIso()),
        harvestPlanDanhDauNhac: pondId => q.hpDanhDauNhac.run(nowIso(), pondId),
        harvestPlanXoa: pondId => q.hpXoa.run(pondId),

        // ================= TAI KHOAN =================
        userByPhone: phone => q.userByPhone.get(phone) || null,
        userById: id => q.userById.get(id) || null,
        userCreate(u) {
            const info = q.userInsert.run(u.phone, u.name, u.role, u.avatar || null,
                u.pass_salt, u.pass_hash, nowIso());
            return Number(info.lastInsertRowid);
        },
        userUpdate: (id, u) => q.userUpdate.run(u.name, u.role, u.avatar || null, id),
        userSetPassword: (id, salt, hash) => q.userPass.run(salt, hash, id),
        userTouch: id => q.userTouch.run(nowIso(), id),

        sessionCreate: (token, userId, expiresAt) => q.sessInsert.run(token, userId, nowIso(), expiresAt),
        sessionGet: token => q.sessGet.get(token) || null,
        sessionDelete: token => q.sessDelete.run(token),
        sessionDeleteByUser: userId => q.sessDeleteUser.run(userId),
        sessionPurgeExpired: () => q.sessPurge.run(nowIso()),

        // ================= AO NUOI =================
        pondList: userId => q.pondList.all(userId),
        pondGet: pondId => q.pondGet.get(pondId) || null,
        pondByTrace: code => q.pondByTrace.get(code) || null,
        pondCreate(p) {
            q.pondInsert.run(p.pond_id, p.user_id, p.name, p.area_m2, p.seed_type,
                p.seed_count, p.stocking_date, p.status || 'safe', p.note || null,
                p.trace_code, nowIso(), nowIso());
        },
        pondUpdate: (pondId, userId, p) => q.pondUpdate.run(p.name, p.area_m2, p.seed_type,
            p.seed_count, p.stocking_date, p.status || 'safe', p.note || null, nowIso(), pondId, userId).changes,
        pondDelete: (pondId, userId) => q.pondDelete.run(pondId, userId).changes,

        // ================= SO SACH =================
        txnList: (userId, limit = 500) => q.txnList.all(userId, limit),
        txnListPond: (userId, pondId, limit = 500) => q.txnListPond.all(userId, pondId, limit),
        txnGet: (id, userId) => q.txnGet.get(id, userId) || null,
        txnCreate(t) {
            const info = q.txnInsert.run(t.user_id, t.pond_id || null, t.type, t.amount,
                t.category || null, t.date, t.note || null, nowIso());
            return Number(info.lastInsertRowid);
        },
        txnUpdate: (id, userId, t) => q.txnUpdate.run(t.pond_id || null, t.type, t.amount,
            t.category || null, t.date, t.note || null, id, userId).changes,
        txnDelete: (id, userId) => q.txnDelete.run(id, userId).changes,

        // ================= NHAT KY =================
        logList: (userId, limit = 100) => q.logList.all(userId, limit),
        logCreate: (userId, pondId, content) => q.logInsert.run(userId, pondId || null, content, nowIso()),
        logPurgeBefore: iso => q.logPurge.run(iso),

        // ================= BAO TRI =================
        /**
         * Gom file WAL ve database chinh roi cat ngan no lai.
         *
         * O che do WAL, moi thay doi ghi vao vast.db-wal truoc. SQLite tu don
         * khi WAL day, nhung "day" o day la nguong theo so trang, va voi mot
         * server chay lien tuc thi file van co the phinh rat lau moi duoc cat.
         * Thuc te da thay vast.db 311 KB ma vast.db-wal 4,1 MB.
         *
         * TRUNCATE = don xong thi cat file ve 0 byte. Neu luc do dang co giao
         * dich khac doc/ghi, SQLite tu bo qua, khong cho va khong loi - nen goi
         * dinh ky la an toan.
         *
         * @returns {{daDon:boolean, soTrang:number}}
         */
        checkpointWal() {
            try {
                // Tra ve 1 dong: busy | log | checkpointed
                const r = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
                return { daDon: !!r && r.busy === 0, soTrang: (r && r.log) || 0 };
            } catch (e) {
                console.error('Loi don WAL:', e.message);
                return { daDon: false, soTrang: 0 };
            }
        },

        // ================= CAI DAT =================
        settingsGet(userId) {
            const out = {};
            for (const r of q.setList.all(userId)) out[r.key] = r.value;
            return out;
        },
        settingsSet: (userId, key, value) => q.setUpsert.run(userId, key, value === null ? null : String(value)),

        // ================= TRUY XUAT NGUON GOC =================
        traceInputs: pondId => q.tinList.all(pondId),
        traceInputAdd: r => Number(q.tinInsert.run(r.pond_id, r.user_id, r.kind, r.name,
            r.supplier, r.batch_code, r.quantity, r.unit, r.active_ingredient, r.used_at,
            r.withdrawal_days, r.note, r.prev_hash, r.record_hash, r.created_at || nowIso()).lastInsertRowid),
        traceInputDelete: (id, userId) => q.tinDelete.run(id, userId).changes,

        traceHarvests: pondId => q.thvList.all(pondId),
        traceHarvestAdd: r => Number(q.thvInsert.run(r.pond_id, r.user_id, r.harvested_at,
            r.quantity_kg, r.size_count_kg, r.lot_code, r.factory, r.factory_code, r.buyer,
            r.note, r.prev_hash, r.record_hash, r.created_at || nowIso()).lastInsertRowid),
        traceHarvestDelete: (id, userId) => q.thvDelete.run(id, userId).changes,

        traceLabTests: pondId => q.tltList.all(pondId),
        traceLabTestAdd: r => Number(q.tltInsert.run(r.harvest_id, r.pond_id, r.user_id,
            r.lab_name, r.cert_code, r.parameter, r.result_value, r.unit, r.limit_value,
            r.passed, r.tested_at, r.note, r.prev_hash, r.record_hash, r.created_at || nowIso()).lastInsertRowid),
        traceLabTestDelete: (id, userId) => q.tltDelete.run(id, userId).changes,

        traceShipments: pondId => q.tshList.all(pondId),
        traceShipmentAdd: r => Number(q.tshInsert.run(r.harvest_id, r.pond_id, r.user_id,
            r.route, r.port, r.destination, r.container_code, r.shipped_at, r.note,
            r.prev_hash, r.record_hash, r.created_at || nowIso()).lastInsertRowid),
        traceShipmentDelete: (id, userId) => q.tshDelete.run(id, userId).changes,
    };
}

// ================================================================
// BACKEND 2: JSON FILE (du phong khi Node cu, khong co node:sqlite)
// ================================================================
function createJsonImpl() {
    const FILE = path.join(DATA_DIR, 'vast.json');

    const blank = {
        devices: [], latest: {}, history: [], commands: [],
        seq: { command: 0, history: 0, device: 0, user: 0, txn: 0, log: 0, trace: 0, supply: 0 },
        // --- THI TRUONG ---
        market: {},        // { code: {..gia moi nhat..} }
        pondFeed: {},      // { pond_id: {..thong so may cho an..} }
        feedLog: [],       // nhat ky cho an
        // --- TAI KHOAN & DU LIEU NGUOI DUNG ---
        users: [],         // [{id, phone, name, role, avatar, pass_salt, pass_hash, ...}]
        sessions: {},      // { token: {user_id, created_at, expires_at} }
        ponds: {},         // { pond_id: {...} }
        transactions: [],  // so sach
        aiLogs: [],        // nhat ky
        settings: {},      // { user_id: { key: value } }
        traceInputs: [], traceHarvests: [], traceLabTests: [], traceShipments: [],
        supplies: [],      // gia vat tu tu nhap
        supplies_auto: [], // gia vat tu tham khao lay tu dong tu tepbac
        marketHistory: {}, // { code: { 'YYYY-MM-DD': {price, unit} } }
        marketManual: {},  // { code: {..gia nhap tay..} }
        marketMeta: {},    // { key: value }
    };
    let data = blank;
    try {
        if (fs.existsSync(FILE)) data = { ...blank, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    } catch (e) {
        console.warn('[DB] vast.json hong, tao moi:', e.message);
    }

    let saveTimer = null;
    function save() {
        // Ghi tre 200ms de khong ghi dia lien tuc khi telemetry ve day
        if (saveTimer) return;
        saveTimer = setTimeout(() => {
            saveTimer = null;
            try {
                fs.writeFileSync(FILE + '.tmp', JSON.stringify(data));
                fs.renameSync(FILE + '.tmp', FILE);
            } catch (e) {
                console.error('[DB] Loi ghi file:', e.message);
            }
        }, 200);
    }

    return {
        backend: 'json',

        listDevices: () => data.devices.slice(),
        getDevice: id => data.devices.find(d => d.device_id === id) || null,
        createDevice(d) {
            data.devices.push({
                id: ++data.seq.device, device_id: d.device_id, device_token: d.device_token,
                pond_id: d.pond_id, name: d.name, mode: 'AUTO', last_seen: null, created_at: nowIso(),
            });
            save();
        },
        updateDevice(d) {
            const dev = data.devices.find(x => x.device_id === d.device_id);
            if (dev) { dev.device_token = d.device_token; dev.pond_id = d.pond_id; dev.name = d.name; save(); }
        },
        touchDevice(id, mode) {
            const dev = data.devices.find(x => x.device_id === id);
            if (dev) { dev.last_seen = nowIso(); dev.mode = mode; save(); }
        },
        deviceSetPond(deviceId, pondId) {
            const dev = data.devices.find(x => x.device_id === deviceId);
            if (!dev) return 0;
            dev.pond_id = pondId;
            save();
            return 1;
        },

        getLatest: id => data.latest[id] || null,
        saveLatest(p) {
            data.latest[p.device_id] = { ...p, updated_at: nowIso() };
            save();
        },

        lastHistoryAt(id) {
            for (let i = data.history.length - 1; i >= 0; i--) {
                if (data.history[i].device_id === id) return data.history[i].created_at;
            }
            return null;
        },
        addHistory(p) {
            data.history.push({ id: ++data.seq.history, ...p, created_at: nowIso() });
            save();
        },
        historySince: (id, sinceIso) =>
            data.history.filter(h => h.device_id === id && h.created_at >= sinceIso),
        purgeHistoryBefore(sinceIso) {
            const before = data.history.length;
            data.history = data.history.filter(h => h.created_at >= sinceIso);
            if (data.history.length !== before) save();
        },

        pendingCommands: id => data.commands.filter(c => c.device_id === id && c.status === 'pending'),
        markSent(cmdId) {
            const c = data.commands.find(x => x.id === cmdId);
            if (c) { c.status = 'sent'; c.sent_at = nowIso(); save(); }
        },
        markDone(cmdId, devId) {
            const c = data.commands.find(x => x.id === cmdId && x.device_id === devId);
            if (!c) return 0;
            c.status = 'done'; c.executed_at = nowIso(); save();
            return 1;
        },
        supersede(devId, cmd) {
            data.commands.forEach(c => {
                if (c.device_id === devId && c.command === cmd && (c.status === 'pending' || c.status === 'sent')) {
                    c.status = 'ignored';
                }
            });
            save();
        },
        addCommand(devId, cmd, value) {
            const id = ++data.seq.command;
            data.commands.push({
                id, device_id: devId, command: cmd, value, status: 'pending',
                created_at: nowIso(), sent_at: null, executed_at: null,
            });
            // Giu toi da 500 lenh gan nhat cho gon file
            if (data.commands.length > 500) data.commands = data.commands.slice(-500);
            save();
            return id;
        },
        recentCommands: (id, limit = 20) =>
            data.commands.filter(c => c.device_id === id).slice(-limit).reverse(),

        // ================= THI TRUONG: GIA TOM =================
        marketList: () => Object.values(data.market)
            .sort((x, y) => (x.species || '').localeCompare(y.species || '') || (x.size || 0) - (y.size || 0)),
        marketGet: code => data.market[code] || null,

        marketDelete(code) {
            if (!data.market[code]) return 0;
            delete data.market[code];
            save();
            return 1;
        },

        marketPurgeMissing(codesConDung) {
            const giu = new Set(codesConDung || []);
            if (!giu.size) return 0;
            let n = 0;
            for (const code of Object.keys(data.market)) {
                if (giu.has(code)) continue;
                const r = data.market[code];
                if (r.manual) continue;
                if (r.source && r.source !== 'tepbac' && r.source !== 'json') continue;
                delete data.market[code];
                n++;
            }
            if (n) save();
            return n;
        },

        marketSavePrice(it) {
            const old = data.market[it.code];
            const now = nowIso();
            let prev = old ? old.prev_price : null;
            let changedAt = old ? old.changed_at : now;
            if (old && Number.isFinite(old.price) && old.price !== it.price) {
                prev = old.price;
                changedAt = now;
            }
            data.market[it.code] = {
                ...it, is_seed: it.is_seed ? 1 : 0,
                prev_price: prev, changed_at: changedAt, updated_at: now,
            };
            save();
        },

        marketAddHistory(code, day, price, unit) {
            if (!data.marketHistory[code]) data.marketHistory[code] = {};
            data.marketHistory[code][day] = { price, unit };
            save();
        },
        marketHistorySince(code, sinceDay) {
            const h = data.marketHistory[code] || {};
            return Object.keys(h).filter(d => d >= sinceDay).sort()
                .map(d => ({ day: d, price: h[d].price, unit: h[d].unit }));
        },
        marketPrevPrice(code, beforeDay) {
            const h = data.marketHistory[code] || {};
            const days = Object.keys(h).filter(d => d < beforeDay).sort();
            return days.length ? h[days[days.length - 1]].price : null;
        },
        marketPurgeHistoryBefore(day) {
            let touched = false;
            for (const code of Object.keys(data.marketHistory)) {
                for (const d of Object.keys(data.marketHistory[code])) {
                    if (d < day) { delete data.marketHistory[code][d]; touched = true; }
                }
            }
            if (touched) save();
        },

        marketManualList: () => Object.values(data.marketManual),
        marketManualSave(m) {
            data.marketManual[m.code] = { ...m, updated_at: nowIso() };
            save();
        },
        marketManualDelete(code) {
            delete data.marketManual[code];
            save();
        },

        marketMeta: key => (data.marketMeta[key] !== undefined ? data.marketMeta[key] : null),
        marketSetMeta(key, value) { data.marketMeta[key] = String(value); save(); },

        // ================= MAY CHO AN TU DONG =================
        feedGet: pondId => data.pondFeed[pondId] || null,
        feedAll: () => Object.values(data.pondFeed),
        feedSave(f) {
            data.pondFeed[f.pond_id] = {
                ...f,
                meal_times: f.meal_times ? JSON.stringify(f.meal_times) : null,
                auto_enabled: f.auto_enabled === 0 ? 0 : 1,
                updated_at: nowIso(),
            };
            save();
        },
        feedSetStock(pondId, kg) {
            if (data.pondFeed[pondId]) {
                data.pondFeed[pondId].feed_stock_kg = kg;
                data.pondFeed[pondId].updated_at = nowIso();
                save();
            }
        },
        feedLogAdd(pondId, kind, amountKg, note) {
            data.feedLog.push({
                id: data.feedLog.length + 1, pond_id: pondId, kind,
                amount_kg: amountKg, note: note || null, created_at: nowIso(),
            });
            if (data.feedLog.length > 2000) data.feedLog = data.feedLog.slice(-2000);
            save();
        },
        feedLogRecent: (pondId, limit = 20) =>
            data.feedLog.filter(l => l.pond_id === pondId).slice(-limit).reverse(),
        feedLogSince: (pondId, sinceIso) =>
            data.feedLog.filter(l => l.pond_id === pondId && l.created_at >= sinceIso),

        // ---- LICH SU CHAI MAU ----
        sampleAdd(pondId, w, soCon, tongG) {
            if (!data.samples) data.samples = [];
            data.samples.push({
                id: data.samples.length + 1, pond_id: pondId, avg_weight_g: w,
                sample_count: soCon || null, total_g: tongG || null, created_at: nowIso(),
            });
            save();
        },
        sampleList: pondId => (data.samples || []).filter(x => x.pond_id === pondId),

        // ---- QUYET DINH GIU LAI NUOI TIEP ----
        harvestPlanGet: pondId => (data.harvestPlan || {})[pondId] || null,
        harvestPlanAll: () => Object.values(data.harvestPlan || {}),
        harvestPlanSave(p) {
            if (!data.harvestPlan) data.harvestPlan = {};
            data.harvestPlan[p.pond_id] = { ...p, da_nhac: 0, created_at: nowIso(), updated_at: nowIso() };
            save();
        },
        harvestPlanDanhDauNhac(pondId) {
            if (data.harvestPlan && data.harvestPlan[pondId]) {
                data.harvestPlan[pondId].da_nhac = 1;
                data.harvestPlan[pondId].updated_at = nowIso();
                save();
            }
        },
        harvestPlanXoa(pondId) {
            if (data.harvestPlan) { delete data.harvestPlan[pondId]; save(); }
        },

        // ================= TAI KHOAN =================
        userByPhone: phone => data.users.find(u => u.phone === phone) || null,
        userById: id => data.users.find(u => u.id === id) || null,
        userCreate(u) {
            const id = ++data.seq.user;
            data.users.push({ id, ...u, avatar: u.avatar || null, created_at: nowIso(), last_login: null });
            save();
            return id;
        },
        userUpdate(id, u) {
            const x = data.users.find(v => v.id === id);
            if (x) { x.name = u.name; x.role = u.role; x.avatar = u.avatar || null; save(); }
        },
        userSetPassword(id, salt, hash) {
            const x = data.users.find(v => v.id === id);
            if (x) { x.pass_salt = salt; x.pass_hash = hash; save(); }
        },
        userTouch(id) {
            const x = data.users.find(v => v.id === id);
            if (x) { x.last_login = nowIso(); save(); }
        },

        sessionCreate(token, userId, expiresAt) {
            data.sessions[token] = { token, user_id: userId, created_at: nowIso(), expires_at: expiresAt };
            save();
        },
        sessionGet: token => data.sessions[token] || null,
        sessionDelete(token) { delete data.sessions[token]; save(); },
        sessionDeleteByUser(userId) {
            for (const t of Object.keys(data.sessions)) {
                if (data.sessions[t].user_id === userId) delete data.sessions[t];
            }
            save();
        },
        sessionPurgeExpired() {
            const now = nowIso();
            let doi = false;
            for (const t of Object.keys(data.sessions)) {
                if (data.sessions[t].expires_at < now) { delete data.sessions[t]; doi = true; }
            }
            if (doi) save();
        },

        // ================= AO NUOI =================
        pondList: userId => Object.values(data.ponds)
            .filter(p => p.user_id === userId)
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
        pondGet: pondId => data.ponds[pondId] || null,
        pondByTrace: code => Object.values(data.ponds).find(p => p.trace_code === code) || null,
        pondCreate(p) {
            data.ponds[p.pond_id] = { ...p, status: p.status || 'safe', created_at: nowIso(), updated_at: nowIso() };
            save();
        },
        pondUpdate(pondId, userId, p) {
            const x = data.ponds[pondId];
            if (!x || x.user_id !== userId) return 0;
            Object.assign(x, {
                name: p.name, area_m2: p.area_m2, seed_type: p.seed_type, seed_count: p.seed_count,
                stocking_date: p.stocking_date, status: p.status || 'safe', note: p.note || null,
                updated_at: nowIso(),
            });
            save();
            return 1;
        },
        pondDelete(pondId, userId) {
            const x = data.ponds[pondId];
            if (!x || x.user_id !== userId) return 0;
            delete data.ponds[pondId];
            save();
            return 1;
        },

        // ================= SO SACH =================
        txnList: (userId, limit = 500) => data.transactions
            .filter(t => t.user_id === userId)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id)
            .slice(0, limit),
        txnListPond: (userId, pondId, limit = 500) => data.transactions
            .filter(t => t.user_id === userId && t.pond_id === pondId)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id)
            .slice(0, limit),
        txnGet: (id, userId) => data.transactions.find(t => t.id === id && t.user_id === userId) || null,
        txnCreate(t) {
            const id = ++data.seq.txn;
            data.transactions.push({ id, ...t, pond_id: t.pond_id || null, created_at: nowIso() });
            save();
            return id;
        },
        txnUpdate(id, userId, t) {
            const x = data.transactions.find(v => v.id === id && v.user_id === userId);
            if (!x) return 0;
            Object.assign(x, {
                pond_id: t.pond_id || null, type: t.type, amount: t.amount,
                category: t.category || null, date: t.date, note: t.note || null,
            });
            save();
            return 1;
        },
        txnDelete(id, userId) {
            const truoc = data.transactions.length;
            data.transactions = data.transactions.filter(t => !(t.id === id && t.user_id === userId));
            const doi = truoc !== data.transactions.length;
            if (doi) save();
            return doi ? 1 : 0;
        },

        // ================= NHAT KY =================
        logList: (userId, limit = 100) => data.aiLogs
            .filter(l => l.user_id === userId).slice(-limit).reverse(),
        logCreate(userId, pondId, content) {
            data.aiLogs.push({
                id: ++data.seq.log, user_id: userId, pond_id: pondId || null,
                content, created_at: nowIso(),
            });
            if (data.aiLogs.length > 5000) data.aiLogs = data.aiLogs.slice(-5000);
            save();
        },
        logPurgeBefore(iso) {
            const truoc = data.aiLogs.length;
            data.aiLogs = data.aiLogs.filter(l => l.created_at >= iso);
            if (truoc !== data.aiLogs.length) save();
        },

        // ================= BAO TRI =================
        /** Ban JSON khong co WAL - khong co gi de don. */
        checkpointWal: () => ({ daDon: false, soTrang: 0 }),

        // ================= CAI DAT =================
        settingsGet: userId => ({ ...(data.settings[userId] || {}) }),
        settingsSet(userId, key, value) {
            if (!data.settings[userId]) data.settings[userId] = {};
            data.settings[userId][key] = value === null ? null : String(value);
            save();
        },

        // ================= TRUY XUAT NGUON GOC =================
        traceInputs: pondId => data.traceInputs.filter(r => r.pond_id === pondId),
        traceInputAdd(r) {
            const id = ++data.seq.trace;
            data.traceInputs.push({ id, ...r, created_at: r.created_at || nowIso() });
            save();
            return id;
        },
        traceInputDelete(id, userId) {
            const truoc = data.traceInputs.length;
            data.traceInputs = data.traceInputs.filter(r => !(r.id === id && r.user_id === userId));
            const doi = truoc !== data.traceInputs.length;
            if (doi) save();
            return doi ? 1 : 0;
        },

        traceHarvests: pondId => data.traceHarvests.filter(r => r.pond_id === pondId),
        traceHarvestAdd(r) {
            const id = ++data.seq.trace;
            data.traceHarvests.push({ id, ...r, created_at: r.created_at || nowIso() });
            save();
            return id;
        },
        traceHarvestDelete(id, userId) {
            const truoc = data.traceHarvests.length;
            data.traceHarvests = data.traceHarvests.filter(r => !(r.id === id && r.user_id === userId));
            const doi = truoc !== data.traceHarvests.length;
            if (doi) save();
            return doi ? 1 : 0;
        },

        traceLabTests: pondId => data.traceLabTests.filter(r => r.pond_id === pondId),
        traceLabTestAdd(r) {
            const id = ++data.seq.trace;
            data.traceLabTests.push({ id, ...r, created_at: r.created_at || nowIso() });
            save();
            return id;
        },
        traceLabTestDelete(id, userId) {
            const truoc = data.traceLabTests.length;
            data.traceLabTests = data.traceLabTests.filter(r => !(r.id === id && r.user_id === userId));
            const doi = truoc !== data.traceLabTests.length;
            if (doi) save();
            return doi ? 1 : 0;
        },

        traceShipments: pondId => data.traceShipments.filter(r => r.pond_id === pondId),
        traceShipmentAdd(r) {
            const id = ++data.seq.trace;
            data.traceShipments.push({ id, ...r, created_at: r.created_at || nowIso() });
            save();
            return id;
        },
        traceShipmentDelete(id, userId) {
            const truoc = data.traceShipments.length;
            data.traceShipments = data.traceShipments.filter(r => !(r.id === id && r.user_id === userId));
            const doi = truoc !== data.traceShipments.length;
            if (doi) save();
            return doi ? 1 : 0;
        },

        // ================= VAT TU DAU VAO =================
        supplyList: userId => data.supplies.filter(v => v.user_id === userId),
        supplyGet: (id, userId) => data.supplies.find(v => v.id === id && v.user_id === userId) || null,
        supplyCreate(v) {
            const id = ++data.seq.supply;
            data.supplies.push({ id, ...v, gia_truoc: null, created_at: nowIso(), updated_at: nowIso() });
            save();
            return id;
        },
        supplyUpdate(id, userId, v) {
            const cu = data.supplies.find(x => x.id === id && x.user_id === userId);
            if (!cu) return 0;
            const giaTruoc = (Number.isFinite(cu.gia) && cu.gia !== v.gia) ? cu.gia : cu.gia_truoc;
            Object.assign(cu, v, { gia_truoc: giaTruoc, updated_at: nowIso() });
            save();
            return 1;
        },
        supplyAutoAll: () => (data.supplies_auto || []).slice()
            .sort((a, b) => (a.loai + a.ten).localeCompare(b.loai + b.ten)),
        supplyAutoPurgeMissing(codesConDung) {
            const giu = new Set(codesConDung || []);
            if (!giu.size || !data.supplies_auto) return 0;
            const truoc = data.supplies_auto.length;
            data.supplies_auto = data.supplies_auto.filter(v => giu.has(v.code));
            const n = truoc - data.supplies_auto.length;
            if (n) save();
            return n;
        },
        supplyAutoSave(v) {
            if (!data.supplies_auto) data.supplies_auto = [];
            const cu = data.supplies_auto.find(x => x.code === v.code);
            const giaTruoc = (cu && Number.isFinite(cu.gia) && cu.gia !== v.gia) ? cu.gia : (cu ? cu.gia_truoc : null);
            const moi = { ...v, gia_truoc: giaTruoc ?? null, updated_at: nowIso() };
            if (cu) Object.assign(cu, moi); else data.supplies_auto.push(moi);
            save();
        },
        supplyDelete(id, userId) {
            const truoc = data.supplies.length;
            data.supplies = data.supplies.filter(v => !(v.id === id && v.user_id === userId));
            const doi = truoc !== data.supplies.length;
            if (doi) save();
            return doi ? 1 : 0;
        },
    };
}

// ----------------------------------------------------------------
// CHON BACKEND
// ----------------------------------------------------------------
// SQLite co the mo that bai vi nhieu ly do THAT ngoai doi: file vast.db bi
// khoa boi mot ban server khac dang chay, o dia day, thu muc chi doc, hoac
// file .db-wal con sot lai. Truoc day loi do lam CHET ca may chu -> nguoi
// nuoi mat toan bo giao dien. Bay gio bao ro roi chay tiep bang file JSON.
let loiSqlite = null;
try {
    impl = createSqliteImpl();
} catch (e) {
    loiSqlite = e;
    impl = null;
}

if (impl) {
    console.log('[DB] Dung SQLite (node:sqlite) -> server/data/vast.db');
} else if (loiSqlite) {
    // ============================================================
    // KHONG MO DUOC vast.db MA FILE DO CO THAT -> DUNG HAN.
    //
    // Truoc day cho chay tiep bang file JSON. Nghe thi "an toan" nhung
    // that ra la cach lam MAT DU LIEU: vast.db van con nguyen ao, so
    // sach, nhat ky, QR - nhung may chu doc file JSON RONG. Nguoi dung
    // thay trang tron, tuong mat het, roi nhap lai tu dau vao JSON.
    // Luc sua duoc vast.db thi co HAI ban du lieu khac nhau, khong biet
    // ban nao dung.
    //
    // Tha khong chay con hon chay voi database rong.
    // ============================================================
    const coFileDb = (() => {
        try { return require('fs').existsSync(path.join(DATA_DIR, 'vast.db')); }
        catch { return false; }
    })();

    if (coFileDb) {
        console.error('');
        console.error('==============================================================');
        console.error('   DUNG MAY CHU: KHONG MO DUOC server/data/vast.db');
        console.error('==============================================================');
        console.error('   Ly do: ' + loiSqlite.message);
        console.error('');
        console.error('   File vast.db VAN CON NGUYEN du lieu cua ban (ao, so sach,');
        console.error('   nhat ky, QR). May chu KHONG tu chay bang file rong de');
        console.error('   tranh viec ban nhap lai tu dau roi co 2 ban du lieu.');
        console.error('');
        if (/no column named/.test(loiSqlite.message)) {
            console.error('   Loi nay la do BANG CU THIEU COT MOI.');
            console.error('   Ban dang chay db.js CU. Chep db.js moi nhat vao roi');
            console.error('   chay lai - no tu them cot con thieu, khong mat du lieu.');
        } else {
            console.error('   Thuong gap:');
            console.error('     - Mot ban  node server.js  khac dang chay va giu file');
            console.error('       (dong cua so lenh do, hoac Ctrl+C)');
            console.error('     - O dia day');
            console.error('     - Thu muc server/data khong ghi duoc');
        }
        console.error('==============================================================');
        console.error('');
        process.exit(1);
    }

    // Chua co vast.db -> chua co du lieu gi de mat, dung JSON cung duoc
    impl = createJsonImpl();
    console.warn('[DB] Khong mo duoc SQLite (' + loiSqlite.message + ')');
    console.warn('[DB] Chua co vast.db nen tam dung file JSON: server/data/vast.json');
} else {
    impl = createJsonImpl();
    console.log('[DB] Node cua ban chua ho tro node:sqlite -> dung file JSON: server/data/vast.json');
    console.log('[DB] (Muon dung SQLite that: cai Node.js phien ban 22.5 tro len)');
}

module.exports = impl;
