'use strict';

// Xác minh Google ID token ngay trên máy chủ, không tin dữ liệu frontend.
// Chỉ dùng module có sẵn của Node.js, không cần cài thêm gói npm.
const crypto = require('crypto');
const https = require('https');
require('../lib/env');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
let jwksCache = { keys: [], expiresAt: 0 };

class GoogleAuthError extends Error {
    constructor(message, status = 401) {
        super(message);
        this.name = 'GoogleAuthError';
        this.status = status;
    }
}

function clientId() {
    return String(process.env.GOOGLE_CLIENT_ID || '').trim();
}

function decodeJsonPart(value, label) {
    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
        return parsed;
    } catch {
        throw new GoogleAuthError(`Google ID token có ${label} không hợp lệ`);
    }
}

function fetchJwks() {
    return new Promise((resolve, reject) => {
        const req = https.get(GOOGLE_JWKS_URL, { timeout: 8000 }, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                raw += chunk;
                if (raw.length > 512000) req.destroy(new Error('Google JWKS quá lớn'));
            });
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`Google JWKS HTTP ${res.statusCode}`));
                try {
                    const data = JSON.parse(raw);
                    if (!Array.isArray(data.keys) || !data.keys.length) throw new Error('Google JWKS rỗng');
                    const match = String(res.headers['cache-control'] || '').match(/max-age=(\d+)/i);
                    const maxAgeSeconds = match ? Number(match[1]) : 3600;
                    resolve({ keys: data.keys, expiresAt: Date.now() + Math.max(60, maxAgeSeconds) * 1000 });
                } catch (error) {
                    reject(error);
                }
            });
        });
        req.on('timeout', () => req.destroy(new Error('Google JWKS hết thời gian chờ')));
        req.on('error', reject);
    });
}

async function layKhoa(kid, forceRefresh = false) {
    if (forceRefresh || Date.now() >= jwksCache.expiresAt || !jwksCache.keys.length) {
        try {
            jwksCache = await fetchJwks();
        } catch {
            throw new GoogleAuthError('Chưa kết nối được dịch vụ xác minh Google. Vui lòng thử lại.', 503);
        }
    }
    return jwksCache.keys.find(key => key.kid === kid) || null;
}

async function xacMinhCredential(credential) {
    const expectedAudience = clientId();
    if (!expectedAudience) {
        throw new GoogleAuthError('Đăng nhập Google chưa được cấu hình trên máy chủ.', 503);
    }

    const token = String(credential || '');
    if (!token || token.length > 10000) throw new GoogleAuthError('Google ID token không hợp lệ');
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(part => !part)) throw new GoogleAuthError('Google ID token không hợp lệ');

    const header = decodeJsonPart(parts[0], 'phần đầu');
    const payload = decodeJsonPart(parts[1], 'nội dung');
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
        throw new GoogleAuthError('Thuật toán xác minh Google không hợp lệ');
    }

    let jwk = await layKhoa(header.kid);
    if (!jwk) jwk = await layKhoa(header.kid, true);
    if (!jwk) throw new GoogleAuthError('Không tìm thấy khóa xác minh Google phù hợp');

    let signatureOk = false;
    try {
        const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
        signatureOk = crypto.verify(
            'RSA-SHA256',
            Buffer.from(`${parts[0]}.${parts[1]}`),
            publicKey,
            Buffer.from(parts[2], 'base64url')
        );
    } catch {
        signatureOk = false;
    }
    if (!signatureOk) throw new GoogleAuthError('Chữ ký Google ID token không hợp lệ');

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.aud !== expectedAudience) throw new GoogleAuthError('Google ID token không dành cho ứng dụng VAST');
    if (!GOOGLE_ISSUERS.has(payload.iss)) throw new GoogleAuthError('Nhà phát hành Google ID token không hợp lệ');
    if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) throw new GoogleAuthError('Phiên Google đã hết hạn');
    if (Number.isFinite(payload.nbf) && payload.nbf > nowSeconds + 60) throw new GoogleAuthError('Google ID token chưa có hiệu lực');
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) {
        throw new GoogleAuthError('Tài khoản Google không có mã định danh hợp lệ');
    }
    if (payload.email_verified !== true || typeof payload.email !== 'string') {
        throw new GoogleAuthError('Email Google chưa được xác minh');
    }

    return {
        sub: payload.sub,
        email: payload.email.trim().toLowerCase(),
        name: typeof payload.name === 'string' ? payload.name.trim().slice(0, 80) : '',
        picture: typeof payload.picture === 'string' ? payload.picture : '',
        // Google là bên quản lý trực tiếp Gmail và tài khoản Workspace có claim hd.
        authoritativeEmail: /@gmail\.com$/i.test(payload.email)
            || (typeof payload.hd === 'string' && payload.hd.length > 0),
    };
}

module.exports = {
    GoogleAuthError,
    clientId,
    cauHinhSanSang: () => !!clientId(),
    xacMinhCredential,
};
