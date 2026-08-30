// ================================================================
// EMAIL GIAO DICH - GUI OTP DAT LAI MAT KHAU
//
// Production dung Resend REST API, khong cai them thu vien npm.
// Secret CHI doc tu bien moi truong tren VPS:
//   RESEND_API_KEY=re_...
//   EMAIL_FROM=VAST <no-reply@tenmien.vn>
//
// Khi chay local/development ma chua co API key, OTP chi duoc in ra
// terminal cua server de lap trinh vien kiem thu. Production tuyet doi
// khong in OTP va se bao loi cau hinh thay vi gia vo da gui.
// ================================================================

'use strict';

require('../lib/env');
const fs = require('fs');
const path = require('path');

const LOGO_PATH = path.resolve(__dirname, '..', '..', 'web', 'assets', 'logo.png');
// Gmail ghep anh CID on dinh hon khi Content-ID co dang duy nhat nhu mot
// dia chi email, thay vi mot ten ngan co the bi may chu mail viet lai.
const LOGO_CONTENT_ID = 'vast-logo@vietnamaismarttracking.top';

function escapeHtml(v) {
    return String(v || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function cauHinhSanSang() {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    const from = String(process.env.EMAIL_FROM || '').trim();
    return !!(apiKey && from && !apiKey.includes('THAY_BANG') && !from.includes('tenmien-cua-ban'));
}

/**
 * Email dung table + inline CSS de Gmail, Outlook va dien thoai hien gan nhu
 * nhau. Khong dung Google Fonts vi nhieu ung dung email chan font ben ngoai.
 */
function taoNoiDungOtp({ name, code, expiresMinutes, purpose = 'password', deviceName = '', logoSrc = `cid:${LOGO_CONTENT_ID}` }) {
    const ten = escapeHtml(name || 'bạn');
    const ma = escapeHtml(code);
    const logo = escapeHtml(logoSrc);
    const soPhut = Number(expiresMinutes) > 0 ? Number(expiresMinutes) : 10;
    const dangNhap = purpose === 'login';
    const hoTro = purpose === 'support';
    const tieuDe = dangNhap ? 'Mã xác nhận đăng nhập thiết bị mới'
        : (hoTro ? 'Mã hoàn tất khôi phục tài khoản' : 'Mã xác nhận đặt lại mật khẩu');
    const moTa = dangNhap
        ? `VAST nhận được yêu cầu chuyển quyền đăng nhập sang thiết bị ${escapeHtml(deviceName || 'mới')}. Vui lòng nhập mã xác nhận dưới đây:`
        : (hoTro
            ? 'Bộ phận hỗ trợ VAST đã xác minh yêu cầu của bạn. Vui lòng nhập mã dưới đây để tự đặt mật khẩu mới. Nhân viên hỗ trợ không biết mật khẩu mới của bạn.'
            : 'VAST nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Vui lòng nhập mã xác nhận dưới đây:');

    return {
        subject: `${tieuDe} VAST`,
        text: `Xin chào ${name || 'bạn'}, ${tieuDe.toLowerCase()} VAST là ${code}. Mã hết hạn sau ${soPhut} phút và chỉ dùng được một lần. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
        html: `<!doctype html>
<html lang="vi">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Mã xác nhận VAST</title>
</head>
<body style="margin:0;padding:0;background:#eef3f1;font-family:Arial,Tahoma,sans-serif;color:#1e293b">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef3f1">
        <tr>
            <td align="center" style="padding:28px 12px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                    style="max-width:600px;background:#ffffff;border:1px solid #dbe5e1;border-radius:18px;overflow:hidden">
                    <tr>
                        <td align="center" style="padding:30px 28px 22px">
                            <img src="${logo}" width="76" height="76" alt="Logo VAST"
                                style="display:block;width:76px;height:76px;margin:0 auto 10px;object-fit:contain;border:0">
                            <div style="font-size:32px;line-height:38px;font-weight:800;letter-spacing:1px;color:#2a8b47">VAST</div>
                            <div style="margin-top:5px;font-size:11px;line-height:18px;font-weight:700;letter-spacing:1.5px;color:#64748b">
                                VIETNAM AI SMART TRACKING
                            </div>
                            <div style="width:52px;height:3px;margin:17px auto 0;background:#2a8b47;border-radius:3px"></div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 34px 32px">
                            <div style="height:12px;background:#f1f5f3;margin-bottom:26px"></div>
                            <h1 style="margin:0 0 18px;font-size:23px;line-height:32px;font-weight:700;text-align:center;color:#172033">
                                ${tieuDe}
                            </h1>
                            <p style="margin:0 0 9px;font-size:14px;line-height:22px;color:#334155">
                                Kính gửi: <strong>${ten}</strong>,
                            </p>
                            <p style="margin:0 0 18px;font-size:14px;line-height:22px;color:#475569">
                                ${moTa}
                            </p>
                            <div style="border:1px solid #2a8b47;background:#eaf7ef;padding:18px 12px;text-align:center">
                                <span style="font-size:32px;line-height:38px;font-weight:800;letter-spacing:10px;color:#166534">${ma}</span>
                            </div>
                            <p style="margin:16px 0 0;font-size:13px;line-height:21px;text-align:center;color:#475569">
                                Mã có hiệu lực trong <strong>${soPhut} phút</strong> và chỉ sử dụng được một lần.
                            </p>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:23px">
                                <tr>
                                    <td style="padding:14px 16px;background:#fff8e6;border-left:4px solid #f59e0b;font-size:12px;line-height:19px;color:#7c4a03">
                                        <strong>Lưu ý bảo mật:</strong> VAST không bao giờ yêu cầu bạn cung cấp mã này qua điện thoại hoặc tin nhắn. Nếu bạn không thực hiện yêu cầu, hãy bỏ qua email này.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:22px 34px;background:#f8faf9;border-top:1px solid #e2e8e5;text-align:center">
                            <p style="margin:0;font-size:12px;line-height:19px;font-weight:700;color:#2a8b47">
                                VAST — Quản lý ao nuôi thông minh
                            </p>
                            <p style="margin:6px 0 0;font-size:11px;line-height:18px;color:#94a3b8">
                                Đây là email được gửi tự động, vui lòng không chia sẻ mã xác nhận.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`,
    };
}

async function guiOtpKhoiPhuc({ to, name, code, expiresMinutes, purpose = 'password', deviceName = '' }) {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    const from = String(process.env.EMAIL_FROM || '').trim();
    const production = process.env.NODE_ENV === 'production';

    if (!cauHinhSanSang()) {
        if (production) {
            throw new Error('Thieu RESEND_API_KEY hoac EMAIL_FROM tren production');
        }

        console.log('');
        console.log('==============================================================');
        const nhan = purpose === 'login' ? 'DANG NHAP THIET BI'
            : (purpose === 'support' ? 'HO TRO KHOI PHUC' : 'DAT LAI MAT KHAU');
        console.log(`  OTP ${nhan} (CHI DEVELOPMENT)`);
        console.log(`  Email : ${to}`);
        console.log(`  Ma    : ${code}`);
        console.log(`  Het han sau ${expiresMinutes} phut`);
        console.log('==============================================================');
        console.log('');
        return { dev: true };
    }

    const noiDung = taoNoiDungOtp({ name, code, expiresMinutes, purpose, deviceName });
    const attachments = fs.existsSync(LOGO_PATH) ? [{
        content: fs.readFileSync(LOGO_PATH).toString('base64'),
        filename: 'vast-logo.png',
        content_id: LOGO_CONTENT_ID,
        content_type: 'image/png',
    }] : [];
    const payload = {
        from,
        to: [to],
        subject: noiDung.subject,
        text: noiDung.text,
        html: noiDung.html,
        ...(attachments.length ? { attachments } : {}),
    };

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    let body = null;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) {
        throw new Error((body && (body.message || body.error)) || `Resend HTTP ${response.status}`);
    }
    return { dev: false, id: body && body.id };
}

const guiOtpDangNhap = args => guiOtpKhoiPhuc({ ...args, purpose: 'login' });
const guiOtpHoTro = args => guiOtpKhoiPhuc({ ...args, purpose: 'support' });

async function guiCanhBaoBaoMat({ to, name, message }) {
    if (!to) return { skipped: true };
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    const from = String(process.env.EMAIL_FROM || '').trim();
    if (!cauHinhSanSang()) {
        if (process.env.NODE_ENV === 'production') throw new Error('Dịch vụ email chưa được cấu hình');
        console.log(`[EMAIL DEV] Cảnh báo bảo mật tới ${to}: ${message}`);
        return { dev: true };
    }
    const subject = 'Cảnh báo bảo mật tài khoản VAST';
    const safeName = escapeHtml(name || 'bạn');
    const safeMessage = escapeHtml(message);
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from, to: [to], subject,
            text: `Xin chào ${name || 'bạn'}, ${message} Nếu đây không phải bạn, hãy liên hệ VAST ngay.`,
            html: `<!doctype html><html lang="vi"><body style="margin:0;background:#eef3f1;font-family:Arial,sans-serif;color:#1e293b"><div style="max-width:560px;margin:28px auto;background:white;border:1px solid #dbe5e1;border-radius:18px;padding:32px"><h1 style="color:#2a8b47">VAST</h1><h2>Cảnh báo bảo mật</h2><p>Xin chào <strong>${safeName}</strong>,</p><p>${safeMessage}</p><p style="padding:14px;background:#fff8e6;border-left:4px solid #f59e0b">Nếu đây không phải bạn, hãy liên hệ bộ phận hỗ trợ VAST ngay.</p></div></body></html>`,
        }),
    });
    let body = null; try { body = await response.json(); } catch { body = null; }
    if (!response.ok) throw new Error((body && (body.message || body.error)) || `Resend HTTP ${response.status}`);
    return { dev: false, id: body && body.id };
}

module.exports = { guiOtpKhoiPhuc, guiOtpDangNhap, guiOtpHoTro, guiCanhBaoBaoMat,
    cauHinhSanSang, taoNoiDungOtp };
