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
const config = require('../config');
const emailService = require('../services/email');
const googleAuth = require('../services/google-auth');

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

function chuanHoaEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function emailHopLe(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160;
}

function laSoAdmin(phone) {
    const admins = (config.auth && Array.isArray(config.auth.adminPhones))
        ? config.auth.adminPhones.map(chuanHoaSdt) : [];
    return admins.includes(chuanHoaSdt(phone));
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
// Dien thoai va may tinh deu giu dang nhap cho den khi nguoi dung chu dong
// dang xuat, doi/khoi phuc mat khau, xoa du lieu trinh duyet, hoac thiet bi
// khac tiep quan. Cot expires_at van bat buoc trong database, nen dung moc
// ISO toi da thay cho null/"vo han".
const PHIEN_GHI_NHO_LAU_DAI = '9999-12-31T23:59:59.999Z';
const YEU_CAU_PHUT = 10;

function sha256(v) {
    return crypto.createHash('sha256').update(String(v)).digest('hex');
}

function thongTinThietBi(input = {}, req = null) {
    const ua = String((req && req.headers && req.headers['user-agent']) || '');
    const ip = String((req && req.socket && req.socket.remoteAddress) || 'local');
    let id = String(input.device_id || '').trim().slice(0, 80);
    if (!/^[A-Za-z0-9._:-]{12,80}$/.test(id)) id = 'legacy_' + sha256(ua + '|' + ip).slice(0, 24);
    const tuUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ? 'mobile' : 'desktop';
    const type = ['mobile', 'desktop'].includes(input.device_type) ? input.device_type : tuUA;
    const tenMacDinh = type === 'mobile' ? 'Điện thoại' : 'Máy tính';
    const name = String(input.device_name || tenMacDinh).replace(/[<>]/g, '').trim().slice(0, 80) || tenMacDinh;
    return { device_id: id, device_type: type, device_name: name };
}

function taoPhien(userId, device = {}) {
    const token = crypto.randomBytes(32).toString('hex');
    const hetHan = PHIEN_GHI_NHO_LAU_DAI;
    db.sessionCreate(token, userId, hetHan, device);
    return { token, expires_at: hetHan };
}

function taoYeuCau(user, device, kind = 'takeover') {
    db.loginRequestPurge();
    const requestId = crypto.randomBytes(12).toString('hex');
    const secret = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + YEU_CAU_PHUT * 60000).toISOString();
    db.loginRequestCreate({
        request_id: requestId, secret_hash: sha256(secret), kind,
        user_id: user ? user.id : null, ...device, expires_at: expiresAt,
    });
    return { request_id: requestId, request_secret: secret, expires_at: expiresAt };
}

function yeuCauHopLe(input = {}) {
    const r = db.loginRequestGet(String(input.request_id || ''));
    if (!r || !bangNhau(sha256(input.request_secret || ''), r.secret_hash)) return null;
    if (r.status === 'pending' && Date.parse(r.expires_at) < Date.now()) {
        db.loginRequestResolve(r.request_id, 'expired');
        r.status = 'expired';
    }
    return r;
}

function dangNhapCoGioiHan(user, device) {
    db.sessionPurgeExpired();
    const sessions = db.sessionListUser(user.id);
    const cungMay = sessions.find(s => s.device_id === device.device_id);
    if (cungMay) {
        db.sessionDeleteByDevice(user.id, device.device_id);
        return { user: loBoNhayCam(user), ...taoPhien(user.id, device) };
    }
    const dangDung = sessions.find(s => s.device_type === device.device_type);
    if (!dangDung) return { user: loBoNhayCam(user), ...taoPhien(user.id, device) };

    const yc = taoYeuCau(user, device);
    return {
        approval_required: true,
        ...yc,
        device_type: device.device_type,
        device_name: device.device_name,
        email_hint: user.email ? String(user.email).replace(/^(.{2}).*(@.*)$/, '$1***$2') : '',
        message: `Tài khoản đã có ${device.device_type === 'mobile' ? 'điện thoại' : 'máy tính'} đang sử dụng. Cần máy cũ đồng ý hoặc xác nhận qua Gmail.`,
    };
}

/** Bo cac truong nhay cam truoc khi tra ve trinh duyet. */
function loBoNhayCam(u) {
    if (!u) return null;
    return {
        id: u.id,
        phone: u.phone,
        email: u.email || '',
        name: u.name,
        role: u.role,
        is_admin: laSoAdmin(u.phone),
        avatar: u.avatar || '',
        created_at: u.created_at,
    };
}

// ================================================================
// CAC VIEC CHINH
// ================================================================

function dangKy({ phone, email, name, password, role, ...deviceInput }, req) {
    const sdt = chuanHoaSdt(phone);
    const thu = chuanHoaEmail(email);

    if (!sdtHopLe(sdt)) return { error: [400, 'Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 0)'] };
    if (!emailHopLe(thu)) return { error: [400, 'Vui lòng nhập email hợp lệ để khôi phục mật khẩu'] };
    if (!name || String(name).trim().length < 2) return { error: [400, 'Vui lòng nhập họ tên'] };
    if (!password || String(password).length < 6) return { error: [400, 'Mật khẩu phải từ 6 ký tự trở lên'] };
    if (String(password).length > 200) return { error: [400, 'Mật khẩu quá dài'] };

    if (db.userByPhone(sdt)) return { error: [409, 'Số điện thoại này đã có tài khoản'] };
    if (db.userByEmail(thu)) return { error: [409, 'Email này đã được dùng cho tài khoản khác'] };

    const { salt, hash } = bamMatKhau(password);
    const id = db.userCreate({
        phone: sdt,
        email: thu,
        name: String(name).trim().slice(0, 80),
        role: String(role || 'Trại trưởng').slice(0, 40),
        pass_salt: salt,
        pass_hash: hash,
    });

    const user = db.userById(id);
    const phien = taoPhien(id, thongTinThietBi(deviceInput, req));
    return { user: loBoNhayCam(user), ...phien };
}

function dangNhap({ phone, password, ...deviceInput }, req) {
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
    return dangNhapCoGioiHan(user, thongTinThietBi(deviceInput, req));
}

/**
 * Đăng nhập Google bằng ID token đã được xác minh trên máy chủ.
 * Google không cung cấp số điện thoại, nên lần đầu người dùng vẫn đăng ký
 * VAST bằng email đó; lần đăng nhập Google đầu tiên sẽ tự liên kết tài khoản.
 */
async function dangNhapGoogle({ credential, ...deviceInput } = {}, req) {
    let google;
    try {
        google = await googleAuth.xacMinhCredential(credential);
    } catch (error) {
        const status = Number(error && error.status) || 401;
        return { error: [status, error.message || 'Không xác minh được tài khoản Google'] };
    }

    let user = db.userByGoogleSub(google.sub);
    if (!user) {
        user = db.userByEmail(google.email);
        if (!user) {
            return { error: [404, 'Email Google này chưa có tài khoản VAST. Vui lòng đăng ký bằng email này trước.'] };
        }
        if (!google.authoritativeEmail) {
            return { error: [409, 'Email Google này không phải Gmail hoặc Google Workspace nên chưa thể tự liên kết an toàn. Vui lòng đăng nhập bằng số điện thoại.'] };
        }
        if (user.google_sub && user.google_sub !== google.sub) {
            return { error: [409, 'Email này đã liên kết với một tài khoản Google khác.'] };
        }
        try {
            db.userSetGoogleSub(user.id, google.sub);
        } catch {
            return { error: [409, 'Tài khoản Google này đã được liên kết với tài khoản VAST khác.'] };
        }
        user = db.userById(user.id);
    }

    db.userTouch(user.id);
    return dangNhapCoGioiHan(user, thongTinThietBi(deviceInput, req));
}

function hoanTatYeuCau(r) {
    const user = db.userById(r.user_id);
    if (!user) return { error: [404, 'Tài khoản không còn tồn tại'] };
    // Chi thu hoi dung KHE thiet bi dang chuyen. Chuyen dien thoai khong
    // lam PC out va nguoc lai.
    db.sessionDeleteByType(user.id, r.device_type);
    const phien = taoPhien(user.id, {
        device_id: r.device_id, device_type: r.device_type, device_name: r.device_name,
    });
    db.loginRequestResolve(r.request_id, 'approved', phien.token);
    return { user: loBoNhayCam(user), ...phien };
}

function trangThaiYeuCau(input) {
    const r = yeuCauHopLe(input);
    if (!r) return { error: [404, 'Yêu cầu đăng nhập không hợp lệ'] };
    if (r.status === 'approved' && r.session_token) {
        const user = db.userById(r.user_id);
        const token = r.session_token;
        const phien = db.sessionGet(token);
        db.loginRequestConsume(r.request_id);
        return { status: 'approved', token, expires_at: phien && phien.expires_at,
            user: loBoNhayCam(user) };
    }
    return { status: r.status, expires_at: r.expires_at };
}

async function guiMaDangNhap(input) {
    const r = yeuCauHopLe(input);
    if (!r || r.kind !== 'takeover' || !r.user_id) return { error: [404, 'Yêu cầu đăng nhập không hợp lệ'] };
    if (r.status !== 'pending') return { error: [409, 'Yêu cầu này không còn hiệu lực'] };
    const user = db.userById(r.user_id);
    if (!user || !emailHopLe(user.email || '')) return { error: [400, 'Tài khoản chưa có Gmail hợp lệ'] };
    const lanTruoc = Date.parse(r.otp_requested_at || '');
    if (Number.isFinite(lanTruoc) && Date.now() - lanTruoc < 60000) {
        return { ok: true, retry_after_seconds: 60, message: 'Mã đã được gửi. Vui lòng chờ trước khi gửi lại.' };
    }
    if (process.env.NODE_ENV === 'production' && !emailService.cauHinhSanSang()) {
        return { error: [503, 'Dịch vụ email chưa được cấu hình'] };
    }
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const { salt, hash } = bamMatKhau(code);
    db.loginRequestSetOtp(r.request_id, salt, hash, new Date(Date.now() + 10 * 60000).toISOString());
    try {
        const delivery = await emailService.guiOtpDangNhap({
            to: user.email, name: user.name, code, expiresMinutes: 10, deviceName: r.device_name,
        });
        return { ok: true, retry_after_seconds: 60, dev_delivery: !!delivery.dev,
            message: 'Mã xác nhận đã được gửi tới Gmail đăng ký.' };
    } catch (e) {
        console.error('[EMAIL] Khong gui duoc OTP dang nhap:', e.message);
        return { error: [503, 'Chưa gửi được mã Gmail. Vui lòng thử lại.'] };
    }
}

function xacNhanMaDangNhap(input) {
    const r = yeuCauHopLe(input);
    const code = String(input.code || '').replace(/\D/g, '');
    const baoLoi = { error: [401, 'Mã xác nhận không đúng hoặc đã hết hạn'] };
    if (!r || r.kind !== 'takeover' || r.status !== 'pending' || !r.otp_hash || code.length !== 6) return baoLoi;
    if ((r.otp_attempts || 0) >= 5 || !r.otp_expires_at || Date.parse(r.otp_expires_at) < Date.now()) {
        db.loginRequestResolve(r.request_id, 'expired'); return baoLoi;
    }
    const { hash } = bamMatKhau(code, r.otp_salt);
    if (!bangNhau(hash, r.otp_hash)) { db.loginRequestAttempt(r.request_id); return baoLoi; }
    const kq = hoanTatYeuCau(r);
    if (!kq.error) db.loginRequestConsume(r.request_id);
    return kq;
}

function danhSachYeuCau(req) {
    const u = nguoiDungTuRequest(req);
    if (!u) return { error: [401, 'Chưa đăng nhập'] };
    const s = u._session;
    if (!s || !s.device_id || !s.device_type) return { requests: [] };
    return { requests: db.loginRequestPending(u.id, s.device_type, s.device_id) };
}

function quyetDinhYeuCau(req, input, chapNhan) {
    const u = nguoiDungTuRequest(req);
    if (!u) return { error: [401, 'Chưa đăng nhập'] };
    const r = db.loginRequestGet(String(input.request_id || ''));
    if (!r || r.kind !== 'takeover' || r.user_id !== u.id || r.status !== 'pending') {
        return { error: [404, 'Yêu cầu không còn tồn tại'] };
    }
    const s = u._session;
    if (!s || s.device_type !== r.device_type || s.device_id === r.device_id) {
        return { error: [403, 'Thiết bị này không có quyền quyết định yêu cầu'] };
    }
    if (!chapNhan) { db.loginRequestResolve(r.request_id, 'denied'); return { status: 'denied' }; }
    const kq = hoanTatYeuCau(r);
    return kq.error ? kq : { status: 'approved', logout_current: true };
}

function taoQrDangNhap(input, req) {
    const device = thongTinThietBi({ ...input, device_type: 'desktop' }, req);
    device.device_type = 'desktop';
    return taoYeuCau(null, device, 'qr');
}

function kiemTraQr(input) {
    const r = yeuCauHopLe(input);
    return !!(r && r.kind === 'qr' && r.status === 'pending');
}

function chapNhanQr(req, input) {
    const u = nguoiDungTuRequest(req);
    if (!u) return { error: [401, 'Hãy đăng nhập trên điện thoại trước khi cấp quyền cho máy tính'] };
    if (!u._session || u._session.device_type !== 'mobile') {
        return { error: [403, 'Mã QR phải được chấp thuận từ điện thoại đã đăng nhập'] };
    }
    const r = yeuCauHopLe(input);
    if (!r || r.kind !== 'qr' || r.status !== 'pending') return { error: [404, 'Mã QR không hợp lệ hoặc đã hết hạn'] };
    if (!db.loginRequestClaim(r.request_id, u.id)) return { error: [409, 'Mã QR đã được sử dụng'] };
    r.user_id = u.id;
    const kq = hoanTatYeuCau(r);
    return kq.error ? kq : { status: 'approved', device_name: r.device_name };
}

/** Gửi OTP 6 số qua email nhưng không để lộ email nào có tài khoản. */
async function guiMaDatLai({ email } = {}) {
    const thu = chuanHoaEmail(email);
    const thongBao = 'Nếu email đã đăng ký, mã xác nhận sẽ được gửi trong ít phút.';
    const devDelivery = process.env.NODE_ENV !== 'production' && !emailService.cauHinhSanSang();
    const guiLaiSauGiay = 60;
    if (process.env.NODE_ENV === 'production' && !emailService.cauHinhSanSang()) {
        return { error: [503, 'Dịch vụ email chưa được cấu hình. Vui lòng liên hệ quản trị viên.'] };
    }
    if (!emailHopLe(thu)) return { ok: true, message: thongBao, dev_delivery: devDelivery, retry_after_seconds: guiLaiSauGiay };

    const user = db.userByEmail(thu);
    if (!user) return { ok: true, message: thongBao, dev_delivery: devDelivery, retry_after_seconds: guiLaiSauGiay };

    const lanTruoc = Date.parse(user.reset_requested_at || '');
    if (Number.isFinite(lanTruoc) && Date.now() - lanTruoc < guiLaiSauGiay * 1000) {
        return { ok: true, message: thongBao, dev_delivery: devDelivery, retry_after_seconds: guiLaiSauGiay };
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const { salt, hash } = bamMatKhau(code);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    db.userSetReset(user.id, salt, hash, expiresAt);

    try {
        const delivery = await emailService.guiOtpKhoiPhuc({
            to: user.email,
            name: user.name,
            code,
            expiresMinutes: 10,
        });
        return {
            ok: true,
            message: thongBao,
            dev_delivery: !!delivery.dev,
            retry_after_seconds: guiLaiSauGiay,
        };
    } catch (e) {
        db.userClearReset(user.id);
        console.error('[EMAIL] Khong gui duoc OTP:', e.message);
        return { error: [503, 'Chưa gửi được email. Vui lòng thử lại sau hoặc liên hệ quản trị viên.'] };
    }
}

/** Xác minh OTP một lần, đổi mật khẩu rồi hủy mọi phiên đăng nhập cũ. */
function khoiPhucMatKhau({ email, code, newPassword } = {}) {
    const thu = chuanHoaEmail(email);
    if (!emailHopLe(thu)) return { error: [400, 'Email không hợp lệ'] };
    if (!newPassword || String(newPassword).length < 6) {
        return { error: [400, 'Mật khẩu mới phải từ 6 ký tự trở lên'] };
    }
    if (String(newPassword).length > 200) return { error: [400, 'Mật khẩu mới quá dài'] };

    const user = db.userByEmail(thu);
    const ma = String(code || '').replace(/\D/g, '');
    const baoLoi = { error: [401, 'Mã xác nhận không đúng hoặc đã hết hạn'] };
    if (!user || !user.reset_salt || !user.reset_hash || ma.length !== 6) return baoLoi;
    if ((user.reset_attempts || 0) >= 5) {
        db.userClearReset(user.id);
        return { error: [429, 'Bạn đã nhập sai quá nhiều lần. Vui lòng yêu cầu mã mới.'] };
    }
    if (!user.reset_expires_at || Date.parse(user.reset_expires_at) < Date.now()) {
        db.userClearReset(user.id);
        return baoLoi;
    }

    const { hash: codeHash } = bamMatKhau(ma, user.reset_salt);
    if (!bangNhau(codeHash, user.reset_hash)) {
        db.userIncrementResetAttempts(user.id);
        return baoLoi;
    }

    const moi = bamMatKhau(String(newPassword));
    db.userSetPassword(user.id, moi.salt, moi.hash);
    db.userClearReset(user.id);
    db.sessionDeleteByUser(user.id);
    return { ok: true };
}

// ================================================================
// MA KHOI PHUC DU PHONG
// ================================================================
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const recoveryCodeFailures = new Map();

function taoChuoiKhoiPhuc() {
    let raw = '';
    for (let i = 0; i < 16; i++) raw += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
    return `VAST-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
}

function chuanHoaMaKhoiPhuc(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^VAST/, '');
}

function bamMaKhoiPhuc(code) {
    return sha256('VAST-RECOVERY|' + chuanHoaMaKhoiPhuc(code));
}

function trangThaiMaKhoiPhuc(req) {
    const u = nguoiDungTuRequest(req);
    if (!u) return { error: [401, 'Chưa đăng nhập'] };
    return db.recoveryCodeStatus(u.id);
}

function taoLaiMaKhoiPhuc(req, { password } = {}) {
    const u = nguoiDungTuRequest(req);
    if (!u) return { error: [401, 'Chưa đăng nhập'] };
    const full = db.userById(u.id);
    const { hash } = bamMatKhau(String(password || ''), full.pass_salt);
    if (!bangNhau(hash, full.pass_hash)) return { error: [401, 'Mật khẩu hiện tại không đúng'] };

    const codes = Array.from({ length: 8 }, taoChuoiKhoiPhuc);
    db.recoveryCodeReplace(u.id, codes.map(bamMaKhoiPhuc));
    return { ok: true, codes, generated_at: new Date().toISOString() };
}

function khoiPhucBangMa({ phone, recoveryCode, newPassword } = {}) {
    const sdt = chuanHoaSdt(phone);
    const key = sdt || 'invalid';
    const fail = recoveryCodeFailures.get(key);
    if (fail && fail.until > Date.now()) {
        return { error: [429, 'Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.'] };
    }
    if (!newPassword || String(newPassword).length < 6 || String(newPassword).length > 200) {
        return { error: [400, 'Mật khẩu mới phải từ 6 đến 200 ký tự'] };
    }
    const user = db.userByPhone(sdt);
    const normalized = chuanHoaMaKhoiPhuc(recoveryCode);
    const row = normalized.length === 16 ? db.recoveryCodeGet(bamMaKhoiPhuc(recoveryCode)) : null;
    const invalid = !user || !row || row.user_id !== user.id;
    if (invalid) {
        const current = fail && fail.until > Date.now() - 15 * 60000 ? fail : { count: 0, until: 0 };
        current.count += 1;
        if (current.count >= 5) current.until = Date.now() + 15 * 60000;
        recoveryCodeFailures.set(key, current);
        return { error: [401, 'Số điện thoại hoặc mã khôi phục không đúng'] };
    }
    if (!db.recoveryCodeUse(row.id)) return { error: [409, 'Mã khôi phục này đã được sử dụng'] };
    const moi = bamMatKhau(String(newPassword));
    db.userSetPassword(user.id, moi.salt, moi.hash);
    db.userClearReset(user.id);
    db.sessionDeleteByUser(user.id);
    recoveryCodeFailures.delete(key);
    emailService.guiCanhBaoBaoMat({
        to: user.email, name: user.name,
        message: 'Mật khẩu vừa được đặt lại bằng một mã khôi phục dự phòng. Tất cả thiết bị cũ đã bị đăng xuất.',
    }).catch(e => console.error('[EMAIL] Khong gui duoc canh bao khoi phuc:', e.message));
    return { ok: true };
}

// ================================================================
// HO TRO KHOI PHUC THU CONG
// ================================================================
function guiYeuCauHoTro({ phone, newEmail, pondCode, deviceCode, note } = {}) {
    const sdt = chuanHoaSdt(phone);
    const email = chuanHoaEmail(newEmail);
    const pondText = String(pondCode || '').trim();
    const deviceText = String(deviceCode || '').trim();
    const noteText = String(note || '').trim();
    if (!sdtHopLe(sdt)) return { error: [400, 'Số điện thoại đăng nhập không hợp lệ'] };
    if (!emailHopLe(email)) return { error: [400, 'Gmail mới không hợp lệ'] };
    if (!pondText && !deviceText && noteText.length < 10) {
        return { error: [400, 'Nếu không còn mã ao hoặc mã thiết bị, hãy mô tả cách bạn có thể xác minh quyền sở hữu'] };
    }
    const requestId = 'RCV-' + crypto.randomBytes(12).toString('hex').toUpperCase();
    const user = db.userByPhone(sdt);
    db.accountRecoveryCreate({
        request_id: requestId, user_id: user ? user.id : null, lookup_phone: sdt,
        new_email: email, pond_code: pondText.slice(0, 80),
        device_code: deviceText.slice(0, 100),
        note: noteText.slice(0, 500),
    });
    return {
        ok: true, request_id: requestId,
        message: 'Đã tiếp nhận yêu cầu. Hãy lưu mã hồ sơ để theo dõi và nhận mã sau khi VAST xác minh.',
    };
}

function trangThaiHoTro({ requestId } = {}) {
    const r = db.accountRecoveryGet(String(requestId || '').trim().toUpperCase());
    if (!r) return { error: [404, 'Không tìm thấy hồ sơ khôi phục'] };
    return { status: r.status, created_at: r.created_at, reviewed_at: r.reviewed_at || null };
}

function adminTuRequest(req) {
    const u = nguoiDungTuRequest(req);
    return u && laSoAdmin(u.phone) ? u : null;
}

function danhSachHoTro(req) {
    const admin = adminTuRequest(req);
    if (!admin) return { error: [403, 'Tài khoản này không có quyền quản trị hỗ trợ'] };
    const requests = db.accountRecoveryList(100).map(r => {
        const ponds = r.user_id ? db.pondList(r.user_id) : [];
        const pondIds = new Set(ponds.map(p => p.pond_id));
        const devices = db.listDevices().filter(d => pondIds.has(d.pond_id));
        const pondInput = String(r.pond_code || '').trim().toLowerCase();
        const deviceInput = String(r.device_code || '').trim().toLowerCase();
        const emailOwner = db.userByEmail(r.new_email);
        return {
            ...r,
            otp_salt: undefined, otp_hash: undefined,
            ponds: ponds.map(p => ({ pond_id: p.pond_id, name: p.name })),
            devices: devices.map(d => ({ device_id: d.device_id, pond_id: d.pond_id, name: d.name })),
            evidence: {
                account_found: !!r.user_id,
                email_available: !emailOwner || emailOwner.id === r.user_id,
                pond_match: !!pondInput && ponds.some(p => String(p.pond_id).toLowerCase() === pondInput
                    || String(p.trace_code || '').toLowerCase() === pondInput),
                device_match: !!deviceInput && devices.some(d => String(d.device_id).toLowerCase() === deviceInput),
            },
        };
    });
    return { requests, audit: db.adminAuditList(50) };
}

async function xuLyHoTro(req, input = {}) {
    const admin = adminTuRequest(req);
    if (!admin) return { error: [403, 'Tài khoản này không có quyền quản trị hỗ trợ'] };
    const adminFull = db.userById(admin.id);
    const adminCheck = bamMatKhau(String(input.adminPassword || ''), adminFull.pass_salt);
    if (!bangNhau(adminCheck.hash, adminFull.pass_hash)) {
        return { error: [401, 'Mật khẩu Admin không đúng. Hệ thống chưa thực hiện thay đổi.'] };
    }
    const id = String(input.requestId || '').trim().toUpperCase();
    const r = db.accountRecoveryGet(id);
    if (!r || r.status !== 'pending') return { error: [404, 'Yêu cầu không còn ở trạng thái chờ xử lý'] };
    const note = String(input.reviewNote || '').trim().slice(0, 500);
    if (note.length < 5) return { error: [400, 'Vui lòng ghi lý do hoặc cách đã xác minh'] };

    if (input.approve !== true) {
        db.accountRecoveryReject(id, admin.id, note);
        db.adminAuditCreate(admin.id, 'recovery_rejected', id, note);
        return { ok: true, status: 'rejected' };
    }
    if (input.verified !== true) return { error: [400, 'Admin phải xác nhận đã đối chiếu chủ tài khoản'] };
    if (!r.user_id) return { error: [400, 'Không tìm thấy tài khoản tương ứng; không thể phê duyệt'] };
    const ponds = db.pondList(r.user_id);
    const pondIds = new Set(ponds.map(p => p.pond_id));
    const devices = db.listDevices().filter(d => pondIds.has(d.pond_id));
    const pondInput = String(r.pond_code || '').trim().toLowerCase();
    const deviceInput = String(r.device_code || '').trim().toLowerCase();
    const pondMatch = !!pondInput && ponds.some(p => String(p.pond_id).toLowerCase() === pondInput
        || String(p.trace_code || '').toLowerCase() === pondInput);
    const deviceMatch = !!deviceInput && devices.some(d => String(d.device_id).toLowerCase() === deviceInput);
    const verificationMethod = String(input.verificationMethod || '').trim().toLowerCase();
    const allowedMethods = new Set(['phone', 'video', 'direct', 'documents']);
    const strongMethods = new Set(['video', 'direct', 'documents']);
    if (!allowedMethods.has(verificationMethod)) {
        return { error: [400, 'Vui lòng chọn phương thức xác minh hợp lệ'] };
    }
    if (!pondMatch && !deviceMatch && !strongMethods.has(verificationMethod)) {
        return { error: [400, 'Khi không có mã khớp, phải xác minh qua video, gặp trực tiếp hoặc giấy tờ mua thiết bị'] };
    }
    const duplicate = db.userByEmail(r.new_email);
    if (duplicate && duplicate.id !== r.user_id) return { error: [409, 'Gmail mới đã thuộc một tài khoản khác'] };
    if (process.env.NODE_ENV === 'production' && !emailService.cauHinhSanSang()) {
        return { error: [503, 'Dịch vụ email chưa được cấu hình'] };
    }
    const code = String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
    const otp = bamMatKhau(code);
    const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
    if (!db.accountRecoveryApprove(id, admin.id, otp.salt, otp.hash, expiresAt, note)) {
        return { error: [409, 'Yêu cầu đã được người khác xử lý'] };
    }
    const user = db.userById(r.user_id);
    try {
        const delivery = await emailService.guiOtpHoTro({
            to: r.new_email, name: user.name, code, expiresMinutes: 30,
        });
        db.adminAuditCreate(admin.id, 'recovery_approved', id, note);
        return { ok: true, status: 'approved', dev_delivery: !!delivery.dev };
    } catch (e) {
        db.accountRecoveryBackToPending(id);
        console.error('[EMAIL] Khong gui duoc ma ho tro:', e.message);
        return { error: [503, 'Không gửi được mã tới Gmail mới; yêu cầu chưa được phê duyệt'] };
    }
}

function hoanTatHoTro({ requestId, code, newPassword } = {}) {
    const id = String(requestId || '').trim().toUpperCase();
    const r = db.accountRecoveryGet(id);
    const ma = String(code || '').replace(/\D/g, '');
    const invalid = { error: [401, 'Mã xác nhận không đúng hoặc đã hết hạn'] };
    if (!r || r.status !== 'approved' || !r.user_id || !r.otp_hash || ma.length !== 8) return invalid;
    if ((r.otp_attempts || 0) >= 5) return { error: [429, 'Đã nhập sai quá nhiều lần. Vui lòng liên hệ hỗ trợ để cấp mã mới.'] };
    if (!r.otp_expires_at || Date.parse(r.otp_expires_at) < Date.now()) return invalid;
    if (!newPassword || String(newPassword).length < 6 || String(newPassword).length > 200) {
        return { error: [400, 'Mật khẩu mới phải từ 6 đến 200 ký tự'] };
    }
    const checked = bamMatKhau(ma, r.otp_salt);
    if (!bangNhau(checked.hash, r.otp_hash)) {
        db.accountRecoveryAttempt(id); return invalid;
    }
    const user = db.userById(r.user_id);
    const oldEmail = user.email;
    const duplicate = db.userByEmail(r.new_email);
    if (duplicate && duplicate.id !== user.id) return { error: [409, 'Gmail mới đã thuộc tài khoản khác'] };
    const moi = bamMatKhau(String(newPassword));
    db.userSetPassword(user.id, moi.salt, moi.hash);
    db.userReplaceEmail(user.id, r.new_email); // Xoa lien ket Google cu khi doi Gmail.
    db.userClearReset(user.id);
    db.sessionDeleteByUser(user.id);
    db.accountRecoveryComplete(id);
    db.adminAuditCreate(r.reviewed_by || 0, 'recovery_completed', id, `Email moi: ${r.new_email}`);
    const message = 'Tài khoản vừa được khôi phục qua bộ phận hỗ trợ; mật khẩu đã đổi và mọi thiết bị cũ đã bị đăng xuất.';
    Promise.allSettled([
        emailService.guiCanhBaoBaoMat({ to: oldEmail, name: user.name, message }),
        oldEmail === r.new_email ? Promise.resolve() : emailService.guiCanhBaoBaoMat({ to: r.new_email, name: user.name, message }),
    ]).catch(() => {});
    return { ok: true };
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

    let phien = db.sessionGet(String(token));
    if (!phien) return null;

    if (phien.expires_at && Date.parse(phien.expires_at) < Date.now()) {
        db.sessionDelete(String(token));
        return null;
    }

    const meta = thongTinThietBi({
        device_id: req.headers['x-vast-device-id'],
        device_type: req.headers['x-vast-device-type'],
        device_name: req.headers['x-vast-device-name'],
    }, req);
    if (!phien.device_id) {
        // Nang cap mem cho cac phien tao truoc khi co chinh sach thiet bi.
        db.sessionBind(String(token), meta);
        phien = { ...phien, ...meta };
    } else if (phien.device_id !== meta.device_id) {
        // Token bi copy sang may khac khong duoc bien thanh mot lan dang nhap moi.
        return null;
    } else if (!phien.last_seen || Date.now() - Date.parse(phien.last_seen) > 60000) {
        db.sessionTouch(String(token));
    }

    // Nang cap cac phien cu (ca dien thoai va may tinh) sang ghi nho lau dai.
    if (phien.expires_at !== PHIEN_GHI_NHO_LAU_DAI) {
        db.sessionSetExpiry(String(token), PHIEN_GHI_NHO_LAU_DAI);
        phien = { ...phien, expires_at: PHIEN_GHI_NHO_LAU_DAI };
    }

    const u = db.userById(phien.user_id);
    return u ? { ...loBoNhayCam(u), _token: String(token), _session: phien } : null;
}

function dangXuat(req) {
    const u = nguoiDungTuRequest(req);
    if (u) db.sessionDelete(u._token);
    return { ok: true };
}

function doiThongTin(userId, { name, role, avatar, email }) {
    const u = db.userById(userId);
    if (!u) return { error: [404, 'Không tìm thấy tài khoản'] };

    const thu = email !== undefined ? chuanHoaEmail(email) : (u.email || '');
    if (!emailHopLe(thu)) return { error: [400, 'Email khôi phục là bắt buộc và phải hợp lệ'] };
    const trung = db.userByEmail(thu);
    if (trung && trung.id !== userId) return { error: [409, 'Email này đã được dùng cho tài khoản khác'] };

    db.userUpdate(userId, {
        name: name !== undefined ? String(name).trim().slice(0, 80) : u.name,
        role: role !== undefined ? String(role).slice(0, 40) : u.role,
        // Anh dai dien luu dang data URL. Chan 700KB de database khong phinh
        // vi vai tam anh chup dien thoai.
        avatar: avatar !== undefined ? String(avatar).slice(0, 700000) : u.avatar,
        email: thu,
    });
    return { user: loBoNhayCam(db.userById(userId)) };
}

function doiMatKhau(userId, { oldPassword, newPassword }, currentDevice = {}) {
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
    // Tao lai phien ghi nho lau dai cho chinh thiet bi dang doi mat khau.
    const phien = taoPhien(userId, {
        device_id: currentDevice.device_id,
        device_type: currentDevice.device_type,
        device_name: currentDevice.device_name,
    });

    return { ok: true, ...phien };
}

module.exports = {
    dangKy,
    dangNhap,
    dangNhapGoogle,
    trangThaiYeuCau,
    guiMaDangNhap,
    xacNhanMaDangNhap,
    danhSachYeuCau,
    quyetDinhYeuCau,
    taoQrDangNhap,
    kiemTraQr,
    chapNhanQr,
    guiMaDatLai,
    khoiPhucMatKhau,
    trangThaiMaKhoiPhuc,
    taoLaiMaKhoiPhuc,
    khoiPhucBangMa,
    guiYeuCauHoTro,
    trangThaiHoTro,
    danhSachHoTro,
    xuLyHoTro,
    hoanTatHoTro,
    dangXuat,
    doiThongTin,
    doiMatKhau,
    nguoiDungTuRequest,
    chuanHoaSdt,
    chuanHoaEmail,
    loBoNhayCam,
    thongTinThietBi,
    googleClientId: googleAuth.clientId,
};
