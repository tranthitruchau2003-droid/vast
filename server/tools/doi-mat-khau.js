// ================================================================
// doi-mat-khau.js - DAT LAI MAT KHAU CHO MOT TAI KHOAN
//
//     node tools/doi-mat-khau.js 0912345678
//     node tools/doi-mat-khau.js 0912345678 matkhaumoi
//     node tools/doi-mat-khau.js --list
//
// ================================================================
// VI SAO PHAI LAM BANG DONG LENH
// ----------------------------------------------------------------
// Nut "Quen mat khau?" tren trang dang nhap von la mot lien ket chet
// (href="#"). Bam khong ra gi.
//
// Muon nguoi dung TU dat lai mat khau thi phai chung minh duoc ho la
// chu tai khoan. Chi co hai duong:
//
//   - Gui ma OTP qua SMS  -> can dich vu nhan tin, tra tien theo tin
//   - Gui duong dan qua email -> can may chu email, va nguoi nuoi tom
//                                thuong khong dung email
//
// He thong nay khong co ca hai. Va TUYET DOI khong duoc lam kieu
// "nhap so dien thoai la doi duoc mat khau" - nhu vay ai biet so dien
// thoai cua chu trai cung chiem duoc tai khoan, cung voi no la quyen
// bat tat guong oxy ngoai ao.
//
// Nhung day la he thong CHAY TREN MAY CUA CHINH TRAI. Ai ngoi truoc
// may chu thi da la nguoi co quyen cao nhat roi. Nen duong dat lai
// mat khau dung dan o day la: chu trai mo may chu ra va chay lenh nay.
//
// Khi nao len VPS va co so dien thoai that thi lam OTP, luc do trang
// web moi tu dat lai duoc.
// ================================================================

'use strict';

const crypto = require('crypto');
const db = require('../lib/db');
const auth = require('../lib/auth');

const PBKDF2_ITER = 120000;
const PBKDF2_LEN = 32;
const PBKDF2_ALG = 'sha256';

/** Bam mat khau y het lib/auth.js - khong duoc lech, lech la dang nhap khong duoc. */
function bam(matKhau) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto
        .pbkdf2Sync(String(matKhau), salt, PBKDF2_ITER, PBKDF2_LEN, PBKDF2_ALG)
        .toString('hex');
    return { salt, hash };
}

/** Sinh mat khau tam de doc duoc qua dien thoai, khong lan chu de nham. */
function matKhauTam() {
    const chu = 'abcdefghjkmnpqrstuvwxyz';   // bo i l o
    const so = '23456789';                    // bo 0 1
    let s = '';
    for (let i = 0; i < 4; i++) s += chu[crypto.randomInt(chu.length)];
    for (let i = 0; i < 4; i++) s += so[crypto.randomInt(so.length)];
    return s;
}

function inDanhSach() {
    const ds = db.userList ? db.userList() : null;
    console.log('');
    if (!ds || !ds.length) {
        // db khong co ham liet ke -> doc truc tiep cho don gian
        console.log('  Khong liet ke duoc danh sach tai khoan tu day.');
        console.log('  Chay:  node tools/doi-mat-khau.js <so dien thoai>');
        console.log('');
        return;
    }
    console.log('  CAC TAI KHOAN DANG CO:');
    console.log('');
    for (const u of ds) {
        console.log(`    ${String(u.phone).padEnd(13)} ${u.name}`);
    }
    console.log('');
}

function main() {
    const args = process.argv.slice(2);

    if (!args.length || args[0] === '--help' || args[0] === '-h') {
        console.log('');
        console.log('  DAT LAI MAT KHAU');
        console.log('');
        console.log('    node tools/doi-mat-khau.js --list                  xem cac tai khoan');
        console.log('    node tools/doi-mat-khau.js 0912345678             dat mat khau ngau nhien');
        console.log('    node tools/doi-mat-khau.js 0912345678 matkhaumoi  dat mat khau tu chon');
        console.log('');
        console.log('  Mat khau moi phai tu 6 ky tu tro len.');
        console.log('  Doi xong thi MOI PHIEN DANG NHAP CU deu bi huy.');
        console.log('');
        return;
    }

    if (args[0] === '--list') return inDanhSach();

    const sdt = auth.chuanHoaSdt(args[0]);
    const u = db.userByPhone(sdt);

    if (!u) {
        console.log('');
        console.log(`  Khong co tai khoan nao mang so ${sdt}.`);
        console.log('  Xem danh sach:  node tools/doi-mat-khau.js --list');
        console.log('');
        process.exitCode = 1;
        return;
    }

    let moi = args[1];
    let tuSinh = false;
    if (!moi) { moi = matKhauTam(); tuSinh = true; }

    if (String(moi).length < 6) {
        console.log('');
        console.log('  Mat khau phai tu 6 ky tu tro len.');
        console.log('');
        process.exitCode = 1;
        return;
    }

    const { salt, hash } = bam(moi);
    db.userSetPassword(u.id, salt, hash);

    // Huy het phien cu: doi mat khau ma may khac van dang dang nhap thi
    // viec doi coi nhu vo nghia.
    db.sessionDeleteByUser(u.id);

    console.log('');
    console.log('  ============================================');
    console.log('   DA DAT LAI MAT KHAU');
    console.log('  ============================================');
    console.log(`   Tai khoan : ${u.name}  (${sdt})`);
    console.log(`   Mat khau  : ${moi}`);
    if (tuSinh) {
        console.log('');
        console.log('   Day la mat khau tam do may sinh. Dang nhap xong');
        console.log('   nen vao Cai dat doi lai mat khau cua rieng minh.');
    }
    console.log('');
    console.log('   Moi phien dang nhap cu da bi huy - cac may khac');
    console.log('   dang mo se bi dang xuat.');
    console.log('  ============================================');
    console.log('');
}

main();
