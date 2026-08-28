// ================================================================
// seed.js - DANG KY THIET BI ESP32 VOI MAY CHU
//
// VI SAO CAN FILE NAY:
//   ESP32 gui du lieu len kem device_id + device_token. May chu CHI nhan
//   neu device_id do da co san trong bang iot_devices. Chua dang ky thi
//   moi goi telemetry bi tra ve:
//       404  "device_id chua duoc dang ky tren server"
//   -> Web khong thay thiet bi nao, o chon "Thiet bi ESP32" trong man hinh
//      "Them Ao Nuoi Moi" trong tron.
//
// CACH DUNG:
//
//   node seed.js --list
//       Xem may chu dang biet nhung thiet bi nao (chan doan truoc tien).
//
//   node seed.js
//       Dang ky thiet bi mac dinh ESP32_POND_01. Neu da co thi GIU NGUYEN
//       token cu (khong phai nap lai code ESP32).
//
//   node seed.js --id ESP32_POND_02 --pond pond_02 --name "Ao 2"
//       Dang ky them thiet bi khac.
//
//   node seed.js --token c0723afd...
//       Dat DUNG token ban dang co trong esp32/esp32_vast/config.h.
//       Dung khi database bi tao lai ma khong muon nap lai code ESP32.
//
//   node seed.js --id ESP32_POND_01 --moi-token
//       Cap token MOI (phai chep vao config.h roi nap lai ESP32).
//
// SAU KHI CHAY: khoi dong lai  node server.js
// ================================================================

'use strict';

const crypto = require('crypto');
const db = require('./db');

// ----------------------------------------------------------------
// DOC THAM SO DONG LENH
// ----------------------------------------------------------------
function thamSo(ten, macDinh = null) {
    const i = process.argv.indexOf('--' + ten);
    if (i === -1) return macDinh;
    const v = process.argv[i + 1];
    return (v && !v.startsWith('--')) ? v : true;
}
const co = ten => process.argv.includes('--' + ten);

const deviceId = String(thamSo('id', 'ESP32_POND_01'));
const pondId = String(thamSo('pond', 'pond_01'));
const ten = String(thamSo('name', 'Thiết bị ao 1'));
const tokenChiDinh = thamSo('token', null);
const moiToken = co('moi-token');

// ----------------------------------------------------------------
// Duoc require tu server.js -> chi xuat ham, khong chay gi ca
// ----------------------------------------------------------------
const chayTrucTiep = require.main === module;

// ----------------------------------------------------------------
// --list : chan doan
// ----------------------------------------------------------------
if (chayTrucTiep && co('list')) {
    const ds = db.listDevices();
    console.log('');
    if (!ds.length) {
        console.log('  MAY CHU CHUA BIET THIET BI NAO.');
        console.log('');
        console.log('  Do la ly do o chon "Thiet bi ESP32" bi trong.');
        console.log('  Chay:   node seed.js --token <token trong config.h>');
        console.log('');
        process.exit(0);
    }
    console.log(`  MAY CHU DANG BIET ${ds.length} THIET BI:`);
    console.log('');
    for (const d of ds) {
        const ao = db.pondGet ? db.pondGet(d.pond_id) : null;
        console.log(`  device_id : ${d.device_id}`);
        console.log(`  gan vao ao: ${d.pond_id}` + (ao ? ` (ao "${ao.name}" co that)` : '  <-- AO NAY KHONG TON TAI'));
        console.log(`  token     : ${d.device_token.slice(0, 12)}...${d.device_token.slice(-6)}`);
        console.log(`  lan cuoi thay: ${d.last_seen || 'CHUA BAO GIO - ESP32 chua goi duoc len'}`);
        console.log('');
    }
    console.log('  So sanh device_id va token o tren voi esp32/esp32_vast/config.h.');
    console.log('  Lech mot ky tu la ESP32 bi tu choi.');
    console.log('');
    process.exit(0);
}

// ----------------------------------------------------------------
// DANG KY / CAP NHAT  (chi khi chay truc tiep:  node seed.js )
// ----------------------------------------------------------------
if (chayTrucTiep) {
const daCo = db.getDevice(deviceId);

let token;
if (tokenChiDinh && tokenChiDinh !== true) {
    // Nguoi dung dua token dang nam trong config.h -> dung dung no,
    // khoi phai nap lai code ESP32.
    token = String(tokenChiDinh).trim();
} else if (daCo && !moiToken) {
    // DA CO: giu nguyen token cu. Doi token ma khong bao truoc se lam
    // ESP32 dang chay ngoai ao bi tu choi im lang.
    token = daCo.device_token;
} else {
    token = crypto.randomBytes(24).toString('hex');
}

if (daCo) {
    db.updateDevice({ device_id: deviceId, device_token: token, pond_id: pondId, name: ten });
    console.log('');
    console.log(`  DA CAP NHAT thiet bi: ${deviceId}`);
} else {
    db.createDevice({ device_id: deviceId, device_token: token, pond_id: pondId, name: ten });
    console.log('');
    console.log(`  DA DANG KY thiet bi MOI: ${deviceId}`);
}

// Co phai nap lai code ESP32 khong?
//
// KHONG can, neu nguoi dung tu dua token bang --token: token do chinh la
// token dang nam trong config.h roi. Bao "phai nap lai" o day la day ho
// di thao may, go ESP32 ra khoi ao mot cach vo ich.
const tuDuaToken = tokenChiDinh && tokenChiDinh !== true;
const doiToken = !tuDuaToken && (!daCo || moiToken || daCo.device_token !== token);

console.log('');
console.log('  ----------------------------------------------------------');
console.log(`  #define DEVICE_ID       "${deviceId}"`);
console.log(`  #define POND_ID         "${pondId}"`);
console.log(`  #define DEVICE_TOKEN    "${token}"`);
console.log('  ----------------------------------------------------------');
console.log('');

if (doiToken) {
    console.log('  !! TOKEN DA THAY DOI.');
    console.log('     Chep 3 dong tren vao  esp32/esp32_vast/config.h');
    console.log('     roi NAP LAI code vao ESP32. Khong nap lai thi ESP32');
    console.log('     van gui token cu va bi may chu tu choi.');
} else if (tuDuaToken) {
    console.log('  Da dung DUNG token ban dua vao -> KHONG can nap lai code ESP32.');
} else {
    console.log('  Token giu nguyen -> KHONG can nap lai code ESP32.');
}

console.log('');
console.log('  Buoc tiep theo:');
console.log('    1. Khoi dong lai:  node server.js');
console.log('    2. Bat ESP32, xem cua so Serial Monitor co dong "HTTP 200" khong');
console.log('    3. Vao web -> Them Ao Nuoi Moi -> o "Thiet bi ESP32" se co ten thiet bi');
console.log('');
}

// ================================================================
// DOC THANG TU config.h CUA ESP32
//
// VI SAO CO PHAN NAY:
//   config.h (ben ESP32) va bang iot_devices (ben may chu) phai KHOP
//   nhau tung ky tu. Lech mot chut la ESP32 bi tu choi im lang, web
//   khong thay thiet bi nao, va khong co gi tren man hinh noi vi sao.
//   Da xay ra that: token trong config.h duoc tao boi seed.js, nhung
//   file seed.js bi mat, database tao lai -> thiet bi bien mat vinh vien.
//
//   Nay may chu tu doc config.h khi khoi dong va tu dang ky lai.
// ================================================================

const fs = require('fs');
const pathMod = require('path');

/**
 * Doc DEVICE_ID / POND_ID / DEVICE_TOKEN tu esp32/esp32_vast/config.h
 * @returns {{device_id:string, pond_id:string, device_token:string}|null}
 */
function docConfigH(duongDan) {
    const f = duongDan || pathMod.join(__dirname, '..', 'esp32', 'esp32_vast', 'config.h');
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch { return null; }

    const lay = ten => {
        const m = txt.match(new RegExp('#define\\s+' + ten + '\\s+"([^"]+)"'));
        return m ? m[1].trim() : null;
    };
    const device_id = lay('DEVICE_ID');
    const device_token = lay('DEVICE_TOKEN');
    const pond_id = lay('POND_ID') || 'pond_01';
    if (!device_id || !device_token) return null;
    return { device_id, pond_id, device_token, file: f };
}

/**
 * Tu dang ky thiet bi theo config.h neu may chu chua biet no.
 * Goi luc khoi dong server. KHONG bao gio ghi de token cua thiet bi
 * dang chay ngon lanh - chi bao neu thay lech.
 *
 * @returns {{hanhDong:string, chiTiet:string}}
 */
function tuDongDongBo() {
    const cfg = docConfigH();
    if (!cfg) return { hanhDong: 'khong_doc_duoc', chiTiet: 'Khong doc duoc esp32/esp32_vast/config.h' };

    const daCo = db.getDevice(cfg.device_id);

    if (!daCo) {
        db.createDevice({
            device_id: cfg.device_id,
            device_token: cfg.device_token,
            pond_id: cfg.pond_id,
            name: 'Thiết bị ' + cfg.pond_id,
        });
        return {
            hanhDong: 'da_dang_ky',
            chiTiet: `Da tu dang ky ${cfg.device_id} theo config.h (ao: ${cfg.pond_id})`,
        };
    }

    if (daCo.device_token !== cfg.device_token) {
        // KHONG tu sua. Lech token co the vi nguoi dung vua cap token moi
        // ma chua nap lai ESP32, hoac nguoc lai. Doan sai la ESP32 ngoai ao
        // mat ket noi. Chi bao ro va noi cach xu ly.
        return {
            hanhDong: 'lech_token',
            chiTiet: `Token trong config.h KHAC token tren may chu cho ${cfg.device_id}`,
        };
    }

    return { hanhDong: 'da_khop', chiTiet: `${cfg.device_id} da dang ky va khop config.h` };
}

module.exports = { docConfigH, tuDongDongBo };
