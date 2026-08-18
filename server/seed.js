// ================================================================
// seed.js - Dang ky thiet bi ESP32 vao database
//
// CHAY:            node seed.js
// DOI TOKEN MOI:   node seed.js --reset
//
// Script se:
//   - Tao thiet bi ESP32_POND_01 gan voi ao 'pond_01' (Ao so 1 tren web)
//   - Sinh device_token ngau nhien (chay lai KHONG lam mat token cu)
//   - In token ra man hinh de ban COPY vao  esp32/config.h
// ================================================================

const crypto = require('crypto');
const db = require('./db');

const RESET = process.argv.includes('--reset');

// ----------------------------------------------------------------
// DANH SACH THIET BI
// Them ESP32 thu 2: copy them 1 dong, doi device_id va pond_id.
// pond_id phai TRUNG voi id ao ben frontend (dashboard.html -> ponds[]).
// ----------------------------------------------------------------
const DEVICES = [
    { device_id: 'ESP32_POND_01', pond_id: 'pond_01', name: 'ESP32 Ao so 1' },
    // { device_id: 'ESP32_POND_02', pond_id: 'pond_02', name: 'ESP32 Ao so 2' },
];

console.log('');
console.log('==============================================================');
console.log('   DANG KY THIET BI ESP32 VAO DATABASE VAST');
console.log('==============================================================');

for (const d of DEVICES) {
    const existing = db.getDevice(d.device_id);
    let token;

    if (!existing) {
        token = crypto.randomBytes(24).toString('hex');
        db.createDevice({ ...d, device_token: token });
        console.log(`   [TAO MOI]  ${d.device_id}`);
    } else if (RESET) {
        token = crypto.randomBytes(24).toString('hex');
        db.updateDevice({ ...d, device_token: token });
        console.log(`   [DOI TOKEN] ${d.device_id}  -> nho NAP LAI code ESP32!`);
    } else {
        token = existing.device_token;
        console.log(`   [DA CO]    ${d.device_id}`);
    }

    console.log(`      pond_id      : ${d.pond_id}`);
    console.log(`      device_token : ${token}`);
    console.log('');
}

console.log('--------------------------------------------------------------');
console.log('   COPY device_token o tren vao file:');
console.log('       esp32/config.h    ->    #define DEVICE_TOKEN "..."');
console.log('==============================================================');
console.log('');
