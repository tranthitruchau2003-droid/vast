// ================================================================
// trace.js - TRUY XUAT NGUON GOC (ma QR tren bao bi tom)
//
// KHONG CAN npm install. Chi dung crypto co san cua Node.
//
// ================================================================
// 4 NHOM THONG TIN THEO YEU CAU CUA THI TRUONG XUAT KHAU
// ----------------------------------------------------------------
//   1. Vung nuoi        ma so co so nuoi, toa do GPS, ho/hop tac xa
//   2. Dau vao          nguon giong (cong ty + ma lo), thuc an, chat xu ly
//   3. Qua trinh nuoi   ngay tha, lich cho an, NGUNG THUOC truoc thu hoach
//   4. Che bien & logistics  ngay thu hoach, so lo, kiem nghiem, cang xuat
//
// ================================================================
// BA DIEU PHAI NOI THAT TREN PHIEU TRUY XUAT
// ----------------------------------------------------------------
// Day la giay to di kem lo tom xuat khau. Ghi sai la lo hang bi tra ve,
// nen o day khong duoc "lam dep so lieu" o bat ky cho nao.
//
// 1) KHONG CO BLOCKCHAIN.
//    Ban cu cua giao dien co dan nhan "Blockchain Verified" - hoan toan
//    khong dung, khong co gi duoc kiem chung ca. O day thay bang thu that:
//    CHUOI BAM CHONG SUA. Moi ban ghi mang record_hash = sha256 cua
//    (hash ban ghi truoc + noi dung ban ghi nay). Sua len mot dong cu thi
//    tat ca cac dong sau khong con khop -> phat hien duoc ngay.
//    Goi dung ten: SO NHAT KY CO DAU NIEM PHONG, khong phai blockchain.
//
// 2) MA AO CUA HE THONG NAY LA MA NOI BO.
//    Xuat khau chinh ngach doi MA SO CO SO NUOI do co quan nong nghiep cap.
//    Ma VAST-xxxx chi de tra cuu noi bo. Hai loai ma duoc tra ve o hai
//    truong RIENG, khong tron lan, de khong ai nham cai nay la cai kia.
//
// 3) SO LIEU CO HAI NGUON, DO TIN CAY KHAC NHAU:
//      - MAY GHI   : DO, nhiet do, luong cam da xa. ESP32 tu ghi, khong qua tay nguoi.
//      - NGUOI KHAI: giong, thuoc, ket qua kiem nghiem, cang xuat.
//    Phieu QR PHAI ghi ro dong nao thuoc nhom nao. He thong khong the
//    xac nhan phieu kiem nghiem la that - no chi luu lai so phieu, don vi
//    kiem, ai nhap, nhap luc nao, va phat hien neu sau do co ai sua.
// ================================================================

'use strict';

const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const TR = config.trace || {};

// ----------------------------------------------------------------
// CHUOI BAM CHONG SUA
// ----------------------------------------------------------------

/**
 * Bam mot ban ghi cung voi hash cua ban ghi lien truoc.
 * Cac truong duoc sap xep theo ten -> cung du lieu luon ra cung hash,
 * khong phu thuoc thu tu khoa trong object.
 */
function bamBanGhi(prevHash, banGhi) {
    const boQua = new Set(['id', 'prev_hash', 'record_hash']);
    const sach = {};
    for (const k of Object.keys(banGhi).sort()) {
        if (boQua.has(k)) continue;
        const v = banGhi[k];
        sach[k] = v === undefined ? null : v;
    }
    return crypto
        .createHash('sha256')
        .update(String(prevHash || 'VAST-GENESIS') + '|' + JSON.stringify(sach))
        .digest('hex');
}

/** Hash cua ban ghi cuoi cung trong mot danh sach (de noi tiep chuoi). */
function hashCuoi(danhSach) {
    if (!danhSach || !danhSach.length) return null;
    return danhSach[danhSach.length - 1].record_hash || null;
}

/**
 * Hash cuoi cung cua CA AO - gop het 4 loai ban ghi lai.
 * Nho vay them mot phieu kiem nghiem cung lam doi "dau niem phong"
 * cua toan bo ho so, khong the them/bot le mot nhom nao ma khong lo.
 */
function hashHienTai(pondId) {
    const tatCa = [
        ...db.traceInputs(pondId),
        ...db.traceHarvests(pondId),
        ...db.traceLabTests(pondId),
        ...db.traceShipments(pondId),
    ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return hashCuoi(tatCa);
}

/**
 * Kiem tra chuoi bam cua 1 ao con nguyen ven khong.
 * Tra ve { ok, checked, broken: [{loai, id, ly_do}] }
 */
function kiemTraChuoi(pondId) {
    const nhom = [
        ['dau_vao', db.traceInputs(pondId)],
        ['thu_hoach', db.traceHarvests(pondId)],
        ['kiem_nghiem', db.traceLabTests(pondId)],
        ['van_chuyen', db.traceShipments(pondId)],
    ];

    const hong = [];
    let daKiem = 0;

    for (const [ten, rows] of nhom) {
        for (const r of rows) {
            daKiem++;
            if (!r.record_hash) {
                hong.push({ loai: ten, id: r.id, ly_do: 'Bản ghi chưa có dấu niêm phong' });
                continue;
            }
            const tinhLai = bamBanGhi(r.prev_hash, r);
            if (tinhLai !== r.record_hash) {
                hong.push({ loai: ten, id: r.id, ly_do: 'Nội dung đã bị sửa sau khi ghi' });
            }
        }
    }

    return { ok: hong.length === 0, checked: daKiem, broken: hong };
}

// ----------------------------------------------------------------
// GHI BAN GHI MOI (tu dong noi vao chuoi bam)
// ----------------------------------------------------------------

function themDauVao(r) {
    const prev = hashHienTai(r.pond_id);
    const banGhi = { ...r, created_at: new Date().toISOString() };
    banGhi.prev_hash = prev;
    banGhi.record_hash = bamBanGhi(prev, banGhi);
    xoaCache(r.pond_id);
    return db.traceInputAdd(banGhi);
}

function themThuHoach(r) {
    const prev = hashHienTai(r.pond_id);
    const banGhi = { ...r, created_at: new Date().toISOString() };
    banGhi.prev_hash = prev;
    banGhi.record_hash = bamBanGhi(prev, banGhi);
    xoaCache(r.pond_id);
    return db.traceHarvestAdd(banGhi);
}

function themKiemNghiem(r) {
    const prev = hashHienTai(r.pond_id);
    const banGhi = { ...r, created_at: new Date().toISOString() };
    banGhi.prev_hash = prev;
    banGhi.record_hash = bamBanGhi(prev, banGhi);
    xoaCache(r.pond_id);
    return db.traceLabTestAdd(banGhi);
}

function themVanChuyen(r) {
    const prev = hashHienTai(r.pond_id);
    const banGhi = { ...r, created_at: new Date().toISOString() };
    banGhi.prev_hash = prev;
    banGhi.record_hash = bamBanGhi(prev, banGhi);
    xoaCache(r.pond_id);
    return db.traceShipmentAdd(banGhi);
}

// ================================================================
// NGUNG THUOC TRUOC THU HOACH
// ----------------------------------------------------------------
// Day la cho lo tom hay bi tra ve nhat: du luong khang sinh.
// Moi loai thuoc co thoi gian ngung (withdrawal period) rieng.
// Dung thuoc ngay 10/8, ngung 14 ngay -> som nhat 24/8 moi duoc thu.
//
// He thong tu tinh ngay som nhat duoc phep thu, va neu da co ban ghi
// thu hoach TRUOC ngay do thi canh bao DO ngay tren phieu QR.
// ================================================================

function ngayThem(ngayISO, soNgay) {
    const t = Date.parse(ngayISO);
    if (Number.isNaN(t)) return null;
    return new Date(t + soNgay * 86400000).toISOString().slice(0, 10);
}

function kiemTraNgungThuoc(pondId) {
    const thuoc = db.traceInputs(pondId).filter(
        i => (i.kind === 'thuoc' || i.kind === 'xu_ly') && i.withdrawal_days > 0 && i.used_at
    );

    if (!thuoc.length) {
        return {
            co_dung_thuoc: false,
            ngay_duoc_thu_som_nhat: null,
            canh_bao: [],
            ghi_chu: 'Chưa ghi nhận thuốc hoặc chất xử lý nào có thời gian ngừng.',
        };
    }

    // Ngay an toan = ngay muon nhat trong tat ca cac loai thuoc da dung
    let somNhat = null;
    const chiTiet = [];

    for (const t of thuoc) {
        const anToan = ngayThem(t.used_at, t.withdrawal_days);
        if (!anToan) continue;
        chiTiet.push({
            ten: t.name,
            hoat_chat: t.active_ingredient || null,
            ngay_dung: t.used_at,
            ngung_ngay: t.withdrawal_days,
            duoc_thu_tu: anToan,
        });
        if (!somNhat || anToan > somNhat) somNhat = anToan;
    }

    // Doi chieu voi cac lan thu hoach da ghi
    const canhBao = [];
    for (const h of db.traceHarvests(pondId)) {
        const ngayThu = String(h.harvested_at || '').slice(0, 10);
        if (!ngayThu || !somNhat) continue;
        if (ngayThu < somNhat) {
            canhBao.push({
                muc: 'nghiem_trong',
                lo: h.lot_code || `#${h.id}`,
                thu_ngay: ngayThu,
                le_ra_tu: somNhat,
                thieu_ngay: Math.round((Date.parse(somNhat) - Date.parse(ngayThu)) / 86400000),
                noi_dung: `Lô thu hoạch ngày ${ngayThu} sớm hơn ngày an toàn ${somNhat} — `
                    + 'chưa hết thời gian ngừng thuốc, có nguy cơ tồn dư kháng sinh.',
            });
        }
    }

    return {
        co_dung_thuoc: true,
        ngay_duoc_thu_som_nhat: somNhat,
        con_lai_ngay: somNhat
            ? Math.max(0, Math.ceil((Date.parse(somNhat) - Date.now()) / 86400000))
            : null,
        chi_tiet: chiTiet,
        canh_bao: canhBao,
    };
}

// ================================================================
// BO NHO DEM CHO TRANG QR
// ----------------------------------------------------------------
// Mot ma QR co the bi hang tram nguoi mua quet cung luc. Tinh lai toan bo
// ho so moi lan quet la phi.
//
// NHUNG: khong duoc dung dong ho cung nhac. Neu chi "cu 1 tieng lam moi"
// thi vua nhap xong phieu kiem nghiem, khach quet van thay ho so cu -
// dung luc can nhat lai sai nhat.
//
// Cach lam o day:
//   - Co san ket qua trong bo dem, dung lai trong  cacheMinutes  phut
//     (mac dinh 60 phut - dung nhip ban muon)
//   - Nhung HE THONG XOA BO DEM NGAY khi ao do co ban ghi moi
//     (them thuoc, thu hoach, kiem nghiem, van chuyen)
//   -> Vua nhap la khach quet thay ngay, ma may chu van khong bi qua tai.
// ================================================================

const boDem = new Map();          // pond_id -> { at, data }

function xoaCache(pondId) {
    boDem.delete(pondId);
}

function layCache(pondId) {
    const c = boDem.get(pondId);
    if (!c) return null;
    const hanMs = (TR.cacheMinutes ?? 60) * 60000;
    if (Date.now() - c.at > hanMs) { boDem.delete(pondId); return null; }
    return c;
}

// ================================================================
// DUNG HO SO TRUY XUAT
// ================================================================

function hoSo(code) {
    const ma = String(code || '').trim().toUpperCase();
    if (!ma) return { error: [400, 'Thiếu mã truy xuất'] };

    const pond = db.pondByTrace(ma);
    if (!pond) return { error: [404, 'Mã truy xuất không tồn tại'] };

    const cache = layCache(pond.pond_id);
    if (cache) {
        return {
            data: {
                ...cache.data,
                tinh_luc: new Date(cache.at).toISOString(),
                tu_bo_nho_dem: true,
            },
        };
    }

    const data = dungHoSo(pond);
    boDem.set(pond.pond_id, { at: Date.now(), data });
    return { data: { ...data, tinh_luc: new Date().toISOString(), tu_bo_nho_dem: false } };
}

function dungHoSo(pond) {
    const chuAo = db.userById(pond.user_id);
    const caiDat = chuAo ? db.settingsGet(chuAo.id) : {};

    // ---- 1. VUNG NUOI ----
    const vungNuoi = {
        ma_noi_bo: pond.trace_code,
        ma_co_so_nuoi: caiDat.farm_official_code || null,   // do co quan nong nghiep cap
        ten_ao: pond.name,
        ho_nuoi: caiDat.farm_name || (chuAo ? chuAo.name : null),
        gps: caiDat.farm_gps || null,
        dien_tich_m2: pond.area_m2,
        // Noi ro de khong ai nham 2 loai ma nay voi nhau
        ghi_chu_ma: caiDat.farm_official_code
            ? 'Mã cơ sở nuôi là mã chính thức do cơ quan quản lý cấp. Mã nội bộ chỉ dùng để tra cứu trên hệ thống này.'
            : 'CHƯA khai báo mã cơ sở nuôi chính thức. Mã nội bộ VAST-… KHÔNG phải mã do cơ quan quản lý cấp.',
    };

    // ---- 2. DAU VAO ----
    const dauVaoTho = db.traceInputs(pond.pond_id);
    const nhomDauVao = { giong: [], thuc_an: [], xu_ly: [], thuoc: [] };
    for (const i of dauVaoTho) {
        const muc = {
            ten: i.name,
            nha_cung_cap: i.supplier || null,
            ma_lo: i.batch_code || null,
            so_luong: i.quantity,
            don_vi: i.unit || null,
            hoat_chat: i.active_ingredient || null,
            ngay_dung: i.used_at || null,
            ngung_truoc_thu_hoach_ngay: i.withdrawal_days || null,
            ghi_chu: i.note || null,
        };
        (nhomDauVao[i.kind] || (nhomDauVao[i.kind] = [])).push(muc);
    }

    // Con giong: uu tien ban ghi chi tiet, khong co thi lay tu thong tin ao
    if (!nhomDauVao.giong.length && pond.seed_type) {
        nhomDauVao.giong.push({
            ten: pond.seed_type,
            nha_cung_cap: null,
            ma_lo: null,
            so_luong: pond.seed_count,
            don_vi: 'con',
            ngay_dung: pond.stocking_date,
            ghi_chu: 'Khai báo tổng quát khi tạo ao, chưa có mã lô giống chi tiết.',
        });
    }

    // ---- 3. QUA TRINH NUOI ----
    let soNgayNuoi = null;
    if (pond.stocking_date) {
        soNgayNuoi = Math.max(0, Math.round((Date.now() - Date.parse(pond.stocking_date)) / 86400000));
    }

    const f = db.feedGet(pond.pond_id);
    const sizeConKg = (f && f.avg_weight_g > 0) ? Math.round(1000 / f.avg_weight_g) : null;

    const nhatKyCam = db.feedLogRecent(pond.pond_id, 500)
        .filter(l => l.kind === 'auto' || l.kind === 'manual');
    const tongCamKg = nhatKyCam.reduce((t, l) => t + (l.amount_kg || 0), 0);

    // 10 lan cho an gan nhat - de nguoi mua thay lich cho an that
    const lichChoAn = nhatKyCam.slice(0, 10).map(l => ({
        luc: l.created_at,
        kg: l.amount_kg,
        kieu: l.kind === 'auto' ? 'Máy tự động' : 'Người bấm',
    }));

    const quaTrinhNuoi = {
        ngay_tha: pond.stocking_date,
        so_ngay_nuoi: soNgayNuoi,
        so_luong_tha: pond.seed_count,
        co_tom_hien_tai: sizeConKg ? `~${sizeConKg} con/kg` : null,
        trong_luong_tb_g: f ? f.avg_weight_g : null,
        lan_chai_mau_gan_nhat: f ? f.sample_at : null,
        tong_cam_da_cho_an_kg: Math.round(tongCamKg * 10) / 10,
        so_lan_cho_an: nhatKyCam.length,
        lich_cho_an_gan_nhat: lichChoAn,
        ngung_thuoc: kiemTraNgungThuoc(pond.pond_id),
    };

    // ---- CHAT LUONG NUOC (MAY TU GHI - phan dang tin nhat) ----
    const device = db.listDevices().find(d => d.pond_id === pond.pond_id);
    let nuoc = null;
    if (device) {
        const since = new Date(Date.now() - 30 * 86400000).toISOString();
        const rows = db.historySince(device.device_id, since);
        if (rows.length) {
            const gom = key => {
                const v = rows.map(r => r[key]).filter(x => Number.isFinite(x));
                if (!v.length) return null;
                return {
                    tb: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10,
                    thap_nhat: Math.round(Math.min(...v) * 10) / 10,
                    cao_nhat: Math.round(Math.max(...v) * 10) / 10,
                };
            };
            nuoc = {
                khoang: '30 ngày gần nhất',
                so_diem_do: rows.length,
                nhiet_do: gom('temperature'),
                oxy_hoa_tan: gom('do_value'),
                ph: gom('ph'),
                thiet_bi: device.device_id,
            };
        }
    }

    // ---- 4. CHE BIEN & LOGISTICS ----
    const thuHoach = db.traceHarvests(pond.pond_id).map(h => ({
        id: h.id,
        thu_luc: h.harvested_at,
        san_luong_kg: h.quantity_kg,
        co_tom: h.size_count_kg ? `${h.size_count_kg} con/kg` : null,
        so_lo_che_bien: h.lot_code || null,
        nha_may: h.factory || null,
        ma_nha_may: h.factory_code || null,
        ben_mua: h.buyer || null,
        ghi_chu: h.note || null,
    }));

    const kiemNghiem = db.traceLabTests(pond.pond_id).map(t => ({
        id: t.id,
        thuoc_lo: t.harvest_id,
        chi_tieu: t.parameter,
        ket_qua: t.result_value,
        don_vi: t.unit || null,
        gioi_han: t.limit_value || null,
        dat: t.passed === 1,
        don_vi_kiem: t.lab_name || null,
        so_phieu: t.cert_code || null,
        ngay_kiem: t.tested_at || null,
        khai_bao_luc: t.created_at,
    }));

    const vanChuyen = db.traceShipments(pond.pond_id).map(s => ({
        id: s.id,
        thuoc_lo: s.harvest_id,
        tuyen: s.route || null,
        cang_xuat: s.port || null,
        thi_truong: s.destination || null,
        so_container: s.container_code || null,
        di_luc: s.shipped_at || null,
    }));

    // ---- DAU NIEM PHONG ----
    const chuoi = kiemTraChuoi(pond.pond_id);

    return {
        ok: true,
        ma_truy_xuat: pond.trace_code,

        vung_nuoi: vungNuoi,
        dau_vao: nhomDauVao,
        qua_trinh_nuoi: quaTrinhNuoi,
        chat_luong_nuoc: nuoc,
        che_bien: thuHoach,
        kiem_nghiem: kiemNghiem,
        van_chuyen: vanChuyen,

        // ---- NOI RO SO LIEU NAO TU DAU RA ----
        do_tin_cay: {
            may_tu_ghi: [
                'Chất lượng nước (nhiệt độ, oxy hòa tan, pH)',
                'Nhật ký cho ăn (thời điểm và số kg từng cữ)',
            ],
            nguoi_khai_bao: [
                'Nguồn giống và mã lô',
                'Thuốc và chất xử lý môi trường',
                'Kết quả kiểm nghiệm',
                'Thông tin chế biến và vận chuyển',
            ],
            ghi_chu: 'Số liệu do máy ghi được thiết bị IoT tại ao tự động ghi nhận, không qua tay người. '
                + 'Số liệu do người khai báo là do cơ sở nuôi tự nhập — hệ thống lưu lại nguyên văn, '
                + 'ghi nhận thời điểm nhập và phát hiện nếu sau đó bị sửa, nhưng KHÔNG thể tự xác minh tính xác thực. '
                + 'Cần đối chiếu, hãy dùng số phiếu kiểm nghiệm để tra tại đơn vị kiểm nghiệm.',
        },

        niem_phong: {
            nguyen_ven: chuoi.ok,
            so_ban_ghi: chuoi.checked,
            ban_ghi_bat_thuong: chuoi.broken,
            dau_hien_tai: hashHienTai(pond.pond_id),
            cach_hoat_dong: 'Mỗi bản ghi mang mã băm SHA-256 của bản ghi liền trước cộng nội dung của chính nó. '
                + 'Sửa một dòng cũ sẽ làm toàn bộ các dòng sau không còn khớp và bị phát hiện. '
                + 'Đây KHÔNG phải blockchain — không có mạng lưới xác thực phân tán, '
                + 'chỉ là sổ nhật ký có dấu niêm phong trên máy chủ của cơ sở nuôi.',
        },
    };
}

module.exports = {
    hoSo,
    kiemTraChuoi,
    kiemTraNgungThuoc,
    themDauVao,
    themThuHoach,
    themKiemNghiem,
    themVanChuyen,
    xoaCache,
    hashHienTai,
    bamBanGhi,
};
