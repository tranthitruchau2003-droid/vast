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

const DATA_DIR = path.join(__dirname, 'data');
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
    `);

    const q = {
        listDevices: db.prepare('SELECT * FROM iot_devices ORDER BY id'),
        getDevice: db.prepare('SELECT * FROM iot_devices WHERE device_id = ?'),
        insertDevice: db.prepare(
            'INSERT INTO iot_devices (device_id, device_token, pond_id, name, mode, created_at) VALUES (?,?,?,?,?,?)'
        ),
        updateDevice: db.prepare('UPDATE iot_devices SET device_token=?, pond_id=?, name=? WHERE device_id=?'),
        touchDevice: db.prepare('UPDATE iot_devices SET last_seen=?, mode=? WHERE device_id=?'),

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
    };

    return {
        backend: 'sqlite',

        listDevices: () => q.listDevices.all(),
        getDevice: id => q.getDevice.get(id) || null,
        createDevice: (d) => q.insertDevice.run(d.device_id, d.device_token, d.pond_id, d.name, 'AUTO', nowIso()),
        updateDevice: (d) => q.updateDevice.run(d.device_token, d.pond_id, d.name, d.device_id),
        touchDevice: (id, mode) => q.touchDevice.run(nowIso(), mode, id),

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
    };
}

// ================================================================
// BACKEND 2: JSON FILE (du phong khi Node cu, khong co node:sqlite)
// ================================================================
function createJsonImpl() {
    const FILE = path.join(DATA_DIR, 'vast.json');

    const blank = { devices: [], latest: {}, history: [], commands: [], seq: { command: 0, history: 0, device: 0 } };
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
    };
}

// ----------------------------------------------------------------
// CHON BACKEND
// ----------------------------------------------------------------
impl = createSqliteImpl();
if (impl) {
    console.log('[DB] Dung SQLite (node:sqlite) -> server/data/vast.db');
} else {
    impl = createJsonImpl();
    console.log('[DB] Node cua ban chua ho tro node:sqlite -> dung file JSON: server/data/vast.json');
    console.log('[DB] (Muon dung SQLite that: cai Node.js phien ban 22.5 tro len)');
}

module.exports = impl;
