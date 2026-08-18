// ================================================================
// server.js - Backend VAST IoT (KHONG CAN npm install)
//
// Chi dung module co san cua Node.js: http, fs, path, url, crypto, node:sqlite
//
// Vai tro:
//   1) Phuc vu toan bo website tinh hien co (index.html, dashboard.html,
//      login.html, register.html, components/...) -> frontend GIU NGUYEN duong dan.
//   2) Cung cap API /api/iot/* cho ESP32 va cho dashboard.
//
// CHAY:
//     cd server
//     node server.js
// MO :
//     http://localhost:3000/dashboard.html
// ================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const config = require('./config');
const db = require('./db');
const { handlers, matchDynamic, handleDynamic, send } = require('./api');

const WEB_ROOT = path.resolve(__dirname, '..');   // thu muc chua index.html, dashboard.html...
const PORT = config.port;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
};

// ----------------------------------------------------------------
// DOC BODY JSON (gioi han 64KB -> chong spam payload lon)
// ----------------------------------------------------------------
function readJsonBody(req) {
    return new Promise((resolve) => {
        let raw = '';
        let tooBig = false;
        req.on('data', chunk => {
            raw += chunk;
            if (raw.length > 65536) { tooBig = true; req.destroy(); }
        });
        req.on('end', () => {
            if (tooBig) return resolve({ __error: 'Body qua lon' });
            if (!raw) return resolve({});
            try { resolve(JSON.parse(raw)); }
            catch { resolve({ __error: 'JSON khong hop le' }); }
        });
        req.on('error', () => resolve({ __error: 'Loi doc du lieu' }));
    });
}

// ----------------------------------------------------------------
// PHUC VU FILE TINH (co chong path traversal)
// ----------------------------------------------------------------
function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';

    const filePath = path.resolve(WEB_ROOT, '.' + rel);

    // CHAN truy cap ra ngoai thu muc web va vao thu muc server (chua database/token)
    if (!filePath.startsWith(WEB_ROOT) || filePath.startsWith(path.join(WEB_ROOT, 'server'))) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('403 - Khong duoc phep truy cap');
    }

    fs.stat(filePath, (err, st) => {
        if (err || !st.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end('<h1>404</h1><p>Khong tim thay: ' + rel + '</p>');
        }
        const ext = path.extname(filePath).toLowerCase();
        const type = MIME[ext] || 'application/octet-stream';

        // ------------------------------------------------------------------
        // CACHE: KHONG duoc cache HTML/JS/CSS/JSON.
        //
        // Truoc day cache JS 5 phut -> khi sua code, trinh duyet nap
        // dashboard.html MOI nhung van dung js/iot.js CU -> goi ham chua
        // ton tai -> bieu do trang tron. Rat kho doan ra.
        // Chi cache anh va font (nhung thu hau nhu khong doi).
        // ------------------------------------------------------------------
        const KHONG_CACHE = ['.html', '.js', '.css', '.json', '.md', '.txt'];
        const cache = KHONG_CACHE.includes(ext)
            ? 'no-store, no-cache, must-revalidate'
            : 'public, max-age=86400';

        res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': st.size,
            'Cache-Control': cache,
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

// ----------------------------------------------------------------
// SERVER
// ----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
    let parsed;
    try {
        parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
        res.writeHead(400); return res.end('Bad Request');
    }

    const pathname = parsed.pathname;
    req.query = parsed.searchParams;

    // --- CORS: cho phep mo dashboard tu Live Server hoac dien thoai ---
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    // --- API ---
    if (pathname.startsWith('/api/')) {
        console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${req.method} ${req.url}`);

        try {
            const key = `${req.method} ${pathname}`;

            if (handlers[key]) {
                let body = null;
                if (req.method === 'POST') {
                    body = await readJsonBody(req);
                    if (body.__error) return send(res, 400, { ok: false, error: body.__error });
                }
                return handlers[key](req, res, body);
            }

            const dyn = matchDynamic(req.method, pathname);
            if (dyn) return handleDynamic(dyn, req, res);

            return send(res, 404, { ok: false, error: 'Khong tim thay API nay' });
        } catch (e) {
            console.error('LOI API:', e);
            // Khong bao gio de server sap vi 1 request loi
            if (!res.headersSent) return send(res, 500, { ok: false, error: 'Loi server noi bo' });
            return res.end();
        }
    }

    // --- FILE TINH (website hien co) ---
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405); return res.end('Method Not Allowed');
    }
    serveStatic(req, res, pathname);
});

// ----------------------------------------------------------------
// DON DEP LICH SU CU (giu 60 ngay) - chay 1 lan/gio
// ----------------------------------------------------------------
setInterval(() => {
    try {
        const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
        db.purgeHistoryBefore(cutoff);
    } catch (e) {
        console.error('Loi don dep lich su:', e.message);
    }
}, 3600 * 1000).unref?.();

process.on('uncaughtException', e => console.error('uncaughtException:', e));
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));

// ----------------------------------------------------------------
server.listen(PORT, '0.0.0.0', () => {
    const devices = db.listDevices();
    console.log('');
    console.log('==============================================================');
    console.log('   VAST IoT SERVER DA CHAY');
    console.log('==============================================================');
    console.log(`   Trang chu   : http://localhost:${PORT}/`);
    console.log(`   Dashboard   : http://localhost:${PORT}/dashboard.html`);
    console.log(`   API health  : http://localhost:${PORT}/api/health`);
    console.log(`   Database    : ${db.backend}`);
    console.log(`   Bao Offline : sau ${config.deviceOfflineSeconds}s khong co telemetry`);
    console.log(`   Luu lich su : moi ${config.historySampleSeconds}s`);
    console.log('--------------------------------------------------------------');
    if (devices.length === 0) {
        console.log('   !! CHUA CO THIET BI NAO. Hay chay:   node seed.js');
    } else {
        console.log('   Thiet bi da dang ky:');
        devices.forEach(d => console.log(`     - ${d.device_id}   (ao: ${d.pond_id})`));
    }
    console.log('--------------------------------------------------------------');
    console.log('   De ESP32 ket noi, dung IP LAN cua may nay trong config.h,');
    console.log('   vi du: http://192.168.1.10:' + PORT);
    console.log('==============================================================');
    console.log('');
});
