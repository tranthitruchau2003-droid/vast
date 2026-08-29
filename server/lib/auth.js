// ================================================================
// auth.js - TAI KHOAN NGUOI DUNG
//
// KHONG CAN npm install. Chi dung module crypto co san cua Node.
//
// ================================================================
// VI SAO PHAI VIET LAI PHAN NAY
// ----------------------------------------------------------------
// Ban cu (login.html / register.html) chi lam the nay:
//
//     localStorage.setItem('currentUser', JSON.stringify({ name: ... }))
//     window.location.href = 'dashboard.html'
//
// Nghia la: KHONG kiem mat khau, KHONG co tai khoan that. Ai go bat ky
// so dien thoai nao cung vao duoc. Va vi du lieu nam trong localStorage
// cua trinh duyet nen:
//   - Doi may / doi dien thoai la mat sach so sach
//   - Xoa lich su trinh duyet la mat sach
//   - Khong the xem chung mot ao tu 2 thiet bi
//
// File nay lam that:
//   - Mat khau bam bang PBKDF2 (khong bao gio luu mat khau goc)
//   - Dang nhap tra ve phien lam viec (token) co han su dung
//   - Chan do mat khau bang cach gioi han so lan sai
// ================================================================

'use strict';

const crypto = require('crypto');
const db = require('./db');

// ----------------------------------------------------------------
// BAM MAT KHAU
// ----------------------------------------------------------------
// PBKDF2 + muoi ngau nhien cho tung nguoi.
// 120.000 vong: du cham de do mat khau khong boi duoc, nhung nguoi dung
// van khong thay do (khoang 50-100ms tren may thuong).
// ----------------------------------------------------------------
const PBKDF2_ITER = 120000;
const PBKDF2_LEN = 32;
const PBKDF2_ALG = 'sha256';

function bamMatKhau(matKhau, muoi) {
    const salt = muoi || crypto.randomBytes(16).toString('hex');
    const hash = crypto
        .pbkdf2Sync(String(matKhau), salt, PBKDF2_ITER, PBKDF2_LEN, PBKDF2_ALG)
        .toString('hex');
    return { salt, hash };
}

/** So sanh kieu constant-time -> khong lo lot thong tin qua do tre. */
function bangNhau(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
        return false;
    }
}

// ----------------------------------------------------------------
// CHUAN HOA SO DIEN THOAI
// ----------------------------------------------------------------
// "0912 345 678", "+84912345678", "84912345678" -> deu ve "0912345678"
// De nguoi dung go kieu nao cung dang nhap duoc dung tai khoan.
// ----------------------------------------------------------------
function chuanHoaSdt(sdt) {
    let s = String(sdt || '').replace(/[^\d+]/g, '');
    if (s.startsWith('+84')) s = '0' + s.slice(3);
    else if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
    return s;
}

function sdtHopLe(sdt) {
    return /^0\d{9}$/.test(sdt);
}

// ----------------------------------------------------------------
// CHAN DO MAT KHAU
// ----------------------------------------------------------------
// Dem so lan sai theo tung so dien thoai. Sai 5 lan trong 15 phut thi
// khoa tam 15 phut. Luu trong bo nho -> khoi dong lai server la reset,
// du dung cho quy mo mot trai tom.
// ----------------------------------------------------------------
const soLanSai = new Map();
const MAX_SAI = 5;
const KHOA_MS = 15 * 60 * 1000;

function dangBiKhoa(sdt) {
    const r = soLanSai.get(sdt);
    if (!r) return 0;
    if (Date.now() - r.at > KHOA_MS) { soLanSai.delete(sdt); return 0; }
    if (r.n < MAX_SAI) return 0;
    return Math.ceil((KHOA_MS - (Date.now() - r.at)) / 60000);   // con bao nhieu phut
}

function ghiNhanSai(sdt) {
    const r = soLanSai.get(sdt);
    if (!r || Date.now() - r.at > KHOA_MS) soLanSai.set(sdt, { n: 1, at: Date.now() });
    else { r.n++; r.at = Date.now(); }
}

function xoaLanSai(sdt) {
    soLanSai.delete(sdt);
}

// ----------------------------------------------------------------
// PHIEN LAM VIEC
// ----------------------------------------------------------------
const PHIEN_NGAY = 30;

function taoPhien(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const hetHan = new Date(Date.now() + PHIEN_NGAY * 86400000).toISOString();
    db.sessionCreate(token, userId, hetHan);
    return { token, expires_at: hetHan };
}

/** Bo cac truong nhay cam truoc khi tra ve trinh duyet. */
function loBoNhayCam(u) {
    if (!u) return null;
    return {
        id: u.id,
        phone: u.phone,
        name: u.name,
        role: u.role,
        avatar: u.avatar || '',
        created_at: u.created_at,
    };
}

// ================================================================
// CAC VIEC CHINH
// ================================================================

function dangKy({ phone, name, password, role }) {
    const sdt = chuanHoaSdt(phone);

    if (!sdtHopLe(sdt)) return { error: [400, 'Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 0)'] };
    if (!name || String(name).trim().length < 2) return { error: [400, 'Vui lòng nhập họ tên'] };
    if (!password || String(password).length < 6) return { error: [400, 'Mật khẩu phải từ 6 ký tự trở lên'] };
    if (String(password).length > 200) return { error: [400, 'Mật khẩu quá dài'] };

    if (db.userByPhone(sdt)) return { error: [409, 'Số điện thoại này đã có tài khoản'] };

    const { salt, hash } = bamMatKhau(password);
    const id = db.userCreate({
        phone: sdt,
        name: String(name).trim().slice(0, 80),
        role: String(role || 'Trại trưởng').slice(0, 40),
        pass_salt: salt,
        pass_hash: hash,
    });

    const user = db.userById(id);
    const phien = taoPhien(id);
    return { user: loBoNhayCam(user), ...phien };
}

function dangNhap({ phone, password }) {
    const sdt = chuanHoaSdt(phone);

    const conKhoa = dangBiKhoa(sdt);
    if (conKhoa) {
        return { error: [429, `Sai mật khẩu quá nhiều lần. Thử lại sau ${conKhoa} phút.`] };
    }

    const user = db.userByPhone(sdt);

    // Sai so dien thoai va sai mat khau tra ve CUNG mot cau bao loi,
    // de nguoi la khong do duoc so nao da co tai khoan.
    const baoLoi = { error: [401, 'Số điện thoại hoặc mật khẩu không đúng'] };

    if (!user) {
        // Van bam mot lan cho ton thoi gian tuong duong -> khong lo qua do tre
        bamMatKhau(String(password || ''), 'khong-co-tai-khoan');
        ghiNhanSai(sdt);
        return baoLoi;
    }

    const { hash } = bamMatKhau(String(password || ''), user.pass_salt);
    if (!bangNhau(hash, user.pass_hash)) {
        ghiNhanSai(sdt);
        return baoLoi;
    }

    xoaLanSai(sdt);
    db.userTouch(user.id);
    const phien = taoPhien(user.id);
    return { user: loBoNhayCam(user), ...phien };
}

/**
 * Doc token tu request -> tra ve nguoi dung, hoac null.
 * Token nam trong header, KHONG nam tren URL (URL bi ghi vao log server,
 * lich su trinh duyet, va lo ra khi chia se duong dan).
 */
function nguoiDungTuRequest(req) {
    let token = req.headers['x-session-token'];
    if (!token) {
        const auth = req.headers['authorization'] || '';
        if (auth.startsWith('Bearer ')) token = auth.slice(7);
    }
    if (!token) return null;

    const phien = db.sessionGet(String(token));
    if (!phien) return null;

    if (phien.expires_at && Date.parse(phien.expires_at) < Date.now()) {
        db.sessionDelete(String(token));
        return null;
    }

    const u = db.userById(phien.user_id);
    return u ? { ...loBoNhayCam(u), _token: String(token) } : null;
}

function dangXuat(req) {
    const u = nguoiDungTuRequest(req);
    if (u) db.sessionDelete(u._token);
    return { ok: true };
}

function doiThongTin(userId, { name, role, avatar }) {
    const u = db.userById(userId);
    if (!u) return { error: [404, 'Không tìm thấy tài khoản'] };

    db.userUpdate(userId, {
        name: name !== undefined ? String(name).trim().slice(0, 80) : u.name,
        role: role !== undefined ? String(role).slice(0, 40) : u.role,
        // Anh dai dien luu dang data URL. Chan 700KB de database khong phinh
        // vi vai tam anh chup dien thoai.
        avatar: avatar !== undefined ? String(avatar).slice(0, 700000) : u.avatar,
    });
    return { user: loBoNhayCam(db.userById(userId)) };
}

function doiMatKhau(userId, { oldPassword, newPassword }) {
    const u = db.userById(userId);
    if (!u) return { error: [404, 'Không tìm thấy tài khoản'] };

    const { hash } = bamMatKhau(String(oldPassword || ''), u.pass_salt);
    if (!bangNhau(hash, u.pass_hash)) return { error: [401, 'Mật khẩu hiện tại không đúng'] };

    if (!newPassword || String(newPassword).length < 6) {
        return { error: [400, 'Mật khẩu mới phải từ 6 ký tự trở lên'] };
    }

    const moi = bamMatKhau(newPassword);
    db.userSetPassword(userId, moi.salt, moi.hash);

    // Doi mat khau thi HUY het cac phien cu -> ai dang dang nhap tren may
    // khac bi dang xuat. Day chinh la muc dich cua viec doi mat khau.
    db.sessionDeleteByUser(userId);
    const phien = taoPhien(userId);

    return { ok: true, ...phien };
}

module.exports = {
    dangKy,
    dangNhap,
    dangXuat,
    doiThongTin,
    doiMatKhau,
    nguoiDungTuRequest,
    chuanHoaSdt,
    loBoNhayCam,
};
