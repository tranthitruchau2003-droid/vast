// ================================================================
// simulate_esp32.js - GIA LAP ESP32 (dung de test website khi chua cam mach)
//
// Script nay lam DUNG NHU ESP32 that:
//   - gui telemetry moi 4 giay
//   - poll lenh moi 2 giay
//   - chay AUTO logic voi hysteresis y het firmware (DO 5.0/5.5, nhiet 32.0/31.5)
//   - nhan SET_MODE / SET_PUMP / SET_AERATOR roi ack lai
//
// CHAY:
//     node simulate_esp32.js
//
// Dieu khien nguon "cam bien" bang phim tren Terminal:
//     q / a  : giam / tang DO      (test bat-tat guong oxy)
//     w / s  : giam / tang nhiet do (test bat-tat may bom)
//     Ctrl+C : thoat
//
// LUU Y: day CHI la cong cu test. Khi cam ESP32 that thi tat script nay di.
// ================================================================

const db = require('../lib/db');
const config = require('../config');

const DEVICE_ID = process.argv[2] || 'ESP32_POND_01';
const BASE = `http://localhost:${config.port}`;

const device = db.getDevice(DEVICE_ID);
if (!device) {
    console.error(`Khong tim thay thiet bi "${DEVICE_ID}". Hay chay:  node seed.js`);
    process.exit(1);
}
const TOKEN = device.device_token;

// ----------------------------------------------------------------
// TRANG THAI GIA LAP (giong bien trong firmware)
// ----------------------------------------------------------------
let simDO = 6.2;            // mg/L
let simTemp = 29.6;         // °C
let mode = 'AUTO';
let aeratorOn = false;      // GPIO26
let pumpOn = false;         // GPIO27
let manualAerator = false;
let manualPump = false;
let lastServerOkMs = Date.now();

const TH = config.thresholds;
const MANUAL_TIMEOUT_MS = 60 * 1000;   // giong MANUAL_TIMEOUT_SEC ben ESP32

// ----------------------------------------------------------------
// LOGIC AUTO - COPY Y HET FIRMWARE (hysteresis)
// ----------------------------------------------------------------
function applyAuto() {
    if (simDO < TH.doOn) aeratorOn = true;
    else if (simDO >= TH.doOff) aeratorOn = false;

    if (simTemp > TH.tempPumpOn) pumpOn = true;
    else if (simTemp <= TH.tempPumpOff) pumpOn = false;
}

function tickControl() {
    // FAIL-SAFE: MANUAL ma mat server qua lau -> quay ve AUTO
    if (mode === 'MANUAL' && Date.now() - lastServerOkMs > MANUAL_TIMEOUT_MS) {
        console.log('\n[SIM] Mat server qua lau khi dang MANUAL -> TU DONG VE AUTO (fail-safe)\n');
        mode = 'AUTO';
    }

    if (mode === 'AUTO') applyAuto();
    else { aeratorOn = manualAerator; pumpOn = manualPump; }
}

// ----------------------------------------------------------------
async function sendTelemetry() {
    // Dao dong nhe cho giong cam bien that
    simTemp += (Math.random() - 0.5) * 0.06;
    simDO += (Math.random() - 0.5) * 0.04;
    simDO = Math.max(0, Math.min(12, simDO));

    const loadCount = (pumpOn ? 1 : 0) + (aeratorOn ? 1 : 0);
    const body = {
        device_id: DEVICE_ID,
        temperature: +simTemp.toFixed(2),
        do: +simDO.toFixed(2),
        ph: null,                                   // chua gan cam bien pH
        pump: pumpOn,
        aerator: aeratorOn,
        mode,
        voltage: +(5.0 + Math.random() * 0.05).toFixed(2),
        current: Math.round(loadCount * 420 + Math.random() * 30),
        power: +((loadCount * 420 + 20) * 5.0 / 1000).toFixed(2),
        rssi: -50 - Math.round(Math.random() * 15),
    };

    try {
        const r = await fetch(`${BASE}/api/iot/telemetry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Device-Token': TOKEN },
            body: JSON.stringify(body),
        });
        if (r.ok) lastServerOkMs = Date.now();
        printStatus(r.ok);
    } catch (e) {
        printStatus(false, e.message);
    }
}

async function pollCommand() {
    try {
        const r = await fetch(`${BASE}/api/iot/command?device_id=${encodeURIComponent(DEVICE_ID)}`, {
            headers: { 'X-Device-Token': TOKEN },
        });
        if (!r.ok) return;
        lastServerOkMs = Date.now();
        const j = await r.json();

        for (const c of j.commands || []) {
            if (c.command === 'SET_MODE') {
                mode = c.value === 'MANUAL' ? 'MANUAL' : 'AUTO';
                if (mode === 'MANUAL') { manualPump = pumpOn; manualAerator = aeratorOn; }
                console.log(`\n[SIM] >> Nhan lenh SET_MODE = ${mode}`);
            } else if (c.command === 'SET_PUMP') {
                manualPump = c.value === 'true';
                console.log(`\n[SIM] >> Nhan lenh SET_PUMP = ${manualPump}${mode !== 'MANUAL' ? ' (bo qua vi dang AUTO)' : ''}`);
            } else if (c.command === 'SET_AERATOR') {
                manualAerator = c.value === 'true';
                console.log(`\n[SIM] >> Nhan lenh SET_AERATOR = ${manualAerator}${mode !== 'MANUAL' ? ' (bo qua vi dang AUTO)' : ''}`);
            } else {
                console.log(`\n[SIM] >> Lenh chua ho tro: ${c.command}`);
            }

            tickControl();

            await fetch(`${BASE}/api/iot/ack`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Device-Token': TOKEN },
                body: JSON.stringify({ device_id: DEVICE_ID, command_id: c.id, result: 'ok' }),
            });
        }
    } catch { /* mat server -> im lang, AUTO van chay */ }
}

function printStatus(ok, err) {
    const line =
        `[${new Date().toLocaleTimeString('vi-VN')}] ` +
        `${mode.padEnd(6)} | ` +
        `T=${simTemp.toFixed(2)}C  DO=${simDO.toFixed(2)}mg/L | ` +
        `GUONG(26)=${aeratorOn ? 'BAT' : 'TAT'}  BOM(27)=${pumpOn ? 'BAT' : 'TAT'} | ` +
        `server=${ok ? 'OK' : 'LOI' + (err ? ' ' + err : '')}`;
    process.stdout.write('\r' + line.padEnd(120));
}

// ----------------------------------------------------------------
// BAN PHIM
// ----------------------------------------------------------------
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', k => {
        if (k === '') { console.log('\nThoat.'); process.exit(0); }
        if (k === 'q') simDO = Math.max(0, simDO - 0.5);
        if (k === 'a') simDO = Math.min(12, simDO + 0.5);
        if (k === 'w') simTemp -= 0.5;
        if (k === 's') simTemp += 0.5;
        tickControl();
    });
}

console.log('');
console.log('==============================================================');
console.log('   GIA LAP ESP32:', DEVICE_ID);
console.log('==============================================================');
console.log(`   Server : ${BASE}`);
console.log('   Phim   :  q/a = giam/tang DO     w/s = giam/tang nhiet do');
console.log('            Ctrl+C = thoat');
console.log('--------------------------------------------------------------');
console.log('');

tickControl();
setInterval(() => { tickControl(); sendTelemetry(); }, 4000);
setInterval(pollCommand, 2000);
sendTelemetry();
