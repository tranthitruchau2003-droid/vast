// ================================================================
// feed.js - CONG THUC TINH LUONG THUC AN THEO SINH KHOI
//
// KHONG CAN npm install. Day la module TINH TOAN THUAN TUY:
// khong doc file, khong goi mang -> de kiem thu, de dung lai o cho khac
// (server, ESP32 qua API, hoac chay thu bang node feed.js --test).
//
// ================================================================
// CONG THUC (3 buoc)
// ----------------------------------------------------------------
// Buoc 1 - So luong tom hien con duoi ao:
//
//     N = So giong tha  x  Ty le song (%)
//
//     Vi du: 300.000 con x 85% = 255.000 con
//
// Buoc 2 - Tong sinh khoi tom duoi ao:
//
//     B = N x W / 1000        (kg)
//
//     W = trong luong trung binh 1 con (gam), lay tu CHAI MAU hang tuan
//     Vi du: 255.000 x 10 / 1000 = 2.550 kg
//
// Buoc 3 - Luong thuc an moi ngay:
//
//     F = B x Ty le cho an (% trong luong than)     (kg/ngay)
//
//     Vi du: 2.550 kg x 3% = 76,5 kg/ngay
//
// Chia cho so cu an trong ngay -> luong xa moi cu.
// ================================================================
//
// HAI DIEU PHAI NHO KHI DUNG SO NAY:
//
// 1) Ty le song va trong luong trung binh la SO UOC. Sai o buoc 1-2 thi
//    buoc 3 sai theo. Vi vay phai CHAI MAU hang tuan de cap nhat W.
//
// 2) Con so tinh ra la DIEM XUAT PHAT, khong phai lenh cuoi cung.
//    Nguoi quyet dinh that su la SANG AN (nha): sau 1,5-2 gio kiem tra
//    sang, con thua thi giam, het sach thi tang. Phan mem khong nhin
//    duoc sang an - dung de no thay nguoi.
// ================================================================

'use strict';

// ----------------------------------------------------------------
// BANG TY LE CHO AN THEO CO TOM  (tom the chan trang)
// ----------------------------------------------------------------
// So % trong luong than moi ngay. Tom cang lon an cang it theo ty le.
// Day la KHOANG THAM KHAO pho bien trong nghe - moi trai, moi loai cam,
// moi mat do nuoi mot khac. Nen chinh lai theo so lieu that cua trai
// minh (sua trong server/config.json -> feed.rateTable).
// ----------------------------------------------------------------
const DEFAULT_RATE_TABLE = [
    // maxWeightG: ap dung cho tom co trong luong <= gia tri nay
    { maxWeightG: 1, ratePct: 10.0, meals: 5, note: 'Tôm mới thả, cỡ rất nhỏ' },
    { maxWeightG: 2, ratePct: 8.5, meals: 5, note: 'Giai đoạn đầu' },
    { maxWeightG: 3, ratePct: 7.5, meals: 4, note: '' },
    { maxWeightG: 5, ratePct: 6.5, meals: 4, note: '' },
    { maxWeightG: 8, ratePct: 5.5, meals: 4, note: '' },
    { maxWeightG: 12, ratePct: 4.5, meals: 4, note: '' },
    { maxWeightG: 15, ratePct: 3.8, meals: 4, note: '' },
    { maxWeightG: 20, ratePct: 3.2, meals: 4, note: 'Khoảng size 50 con/kg' },
    { maxWeightG: 25, ratePct: 2.8, meals: 3, note: 'Khoảng size 40 con/kg' },
    { maxWeightG: 35, ratePct: 2.3, meals: 3, note: 'Khoảng size 30 con/kg' },
    { maxWeightG: 9999, ratePct: 2.0, meals: 3, note: 'Tôm cỡ lớn' },
];

// Gio cho an mac dinh trong ngay (24h). So cu lay theo bang tren.
const DEFAULT_MEAL_TIMES = ['06:00', '10:00', '14:00', '18:00', '22:00'];

// ----------------------------------------------------------------
// HE SO DIEU CHINH THEO MOI TRUONG
// ----------------------------------------------------------------
// Tom an kem han han khi thieu oxy hoac nhiet do lech khoi khoang thich hop.
// Cho an du luong luc do = cam thua, thoi day ao, tut oxy them - hai gap doi.
// Cac nguong nay lay theo huong dan nuoi pho bien, co the chinh trong config.
// ----------------------------------------------------------------
const DEFAULT_ADJUST = {
    do: [
        { below: 3.0, factor: 0.0, reason: 'DO quá thấp — ngưng cho ăn, ưu tiên sục khí' },
        { below: 4.0, factor: 0.5, reason: 'DO thấp — giảm nửa khẩu phần' },
        { below: 5.0, factor: 0.7, reason: 'DO hơi thấp — giảm 30%' },
    ],
    temp: [
        { below: 22.0, factor: 0.4, reason: 'Nước lạnh — tôm ăn rất kém' },
        { below: 25.0, factor: 0.6, reason: 'Nước hơi lạnh — giảm 40%' },
        { above: 34.0, factor: 0.6, reason: 'Nước quá nóng — giảm 40%' },
        { above: 32.0, factor: 0.8, reason: 'Nước nóng — giảm 20%' },
    ],
    // Khong duoi mot he so nao thap hon muc nay tru khi la lenh NGUNG han
    minFactor: 0.3,
};

// ================================================================
// CAC HAM TINH
// ================================================================

/** Ep ve so, tra ve gia tri thay the neu khong hop le. */
function n(v, fallback = null) {
    const x = Number(v);
    return Number.isFinite(x) ? x : fallback;
}

/**
 * BUOC 1 - So tom hien con duoi ao.
 *   N = so giong tha x ty le song
 * @param {number} seedCount    so con giong da tha
 * @param {number} survivalPct  ty le song du kien, don vi %  (vi du 85)
 */
function tinhSoTom(seedCount, survivalPct) {
    const seed = n(seedCount, 0);
    const sv = n(survivalPct, 0);
    if (seed <= 0 || sv <= 0) return 0;
    return Math.round(seed * (Math.min(sv, 100) / 100));
}

/**
 * BUOC 2 - Tong sinh khoi tom duoi ao.
 *   B = N x W / 1000   (kg)
 * @param {number} soTom       so con tom (ket qua buoc 1)
 * @param {number} avgWeightG  trong luong trung binh 1 con, don vi gam
 */
function tinhSinhKhoi(soTom, avgWeightG) {
    const N = n(soTom, 0);
    const W = n(avgWeightG, 0);
    if (N <= 0 || W <= 0) return 0;
    return (N * W) / 1000;
}

/** Tra ve muc trong bang ty le cho an ung voi co tom hien tai. */
function traBangTyLe(avgWeightG, rateTable = DEFAULT_RATE_TABLE) {
    const W = n(avgWeightG, 0);
    if (W <= 0) return null;
    for (const muc of rateTable) {
        if (W <= muc.maxWeightG) return muc;
    }
    return rateTable[rateTable.length - 1];
}

/**
 * Size tom (con/kg) suy ra tu trong luong trung binh.
 *   size = 1000 / W
 * Dung de doi chieu voi bang gia thi truong.
 */
function tinhSize(avgWeightG) {
    const W = n(avgWeightG, 0);
    if (W <= 0) return null;
    return Math.round(1000 / W);
}

/**
 * BUOC 3 - Luong thuc an moi ngay.
 *   F = B x ty le cho an %
 */
function tinhLuongCam(sinhKhoiKg, ratePct) {
    const B = n(sinhKhoiKg, 0);
    const r = n(ratePct, 0);
    if (B <= 0 || r <= 0) return 0;
    return (B * r) / 100;
}

/**
 * He so dieu chinh theo moi truong that (lay tu cam bien ESP32).
 * Tra ve { factor, reasons[] }. factor = 1 nghia la cho an binh thuong.
 */
function heSoMoiTruong(env = {}, adjust = DEFAULT_ADJUST) {
    let factor = 1;
    const reasons = [];

    const doVal = n(env.do_value, null);
    if (doVal !== null) {
        for (const r of adjust.do) {
            if (doVal < r.below) { factor = Math.min(factor, r.factor); reasons.push(r.reason); break; }
        }
    }

    const temp = n(env.temperature, null);
    if (temp !== null) {
        for (const r of adjust.temp) {
            if (r.below !== undefined && temp < r.below) {
                factor = Math.min(factor, r.factor); reasons.push(r.reason); break;
            }
            if (r.above !== undefined && temp > r.above) {
                factor = Math.min(factor, r.factor); reasons.push(r.reason); break;
            }
        }
    }

    // San khong cho giam qua sau (tru truong hop NGUNG han - factor = 0)
    if (factor > 0 && factor < adjust.minFactor) factor = adjust.minFactor;

    return { factor, reasons };
}

/**
 * ============================================================
 * TINH DAY DU KHAU PHAN CHO 1 AO
 * ============================================================
 * @param {object} ao
 *   seedCount     so con giong da tha
 *   survivalPct   ty le song du kien (%)
 *   avgWeightG    trong luong trung binh 1 con (g) - tu chai mau
 *   ratePct       (tuy chon) ty le cho an tu dat, bo trong thi tra bang
 *   mealsPerDay   (tuy chon) so cu/ngay tu dat
 *   mealTimes     (tuy chon) danh sach gio cho an  ['06:00', ...]
 *   feedStockKg   (tuy chon) luong cam con trong may
 *   feedStockMaxKg(tuy chon) suc chua cua may
 * @param {object} env   { do_value, temperature } lay tu cam bien
 * @param {object} cfg   { rateTable, adjust, mealTimes }
 */
function tinhKhauPhan(ao = {}, env = {}, cfg = {}) {
    // cfg.rateTable / cfg.adjust co the la null (nghia la 'dung bang chuan')
    const rateTable = (cfg.rateTable && cfg.rateTable.length) ? cfg.rateTable : DEFAULT_RATE_TABLE;
    const adjust = cfg.adjust || DEFAULT_ADJUST;

    const seedCount = n(ao.seedCount, 0);
    const survivalPct = n(ao.survivalPct, 0);
    const avgWeightG = n(ao.avgWeightG, 0);

    // --- Thieu du lieu dau vao thi NOI RO THIEU GI, khong doan bua ---
    const thieu = [];
    if (seedCount <= 0) thieu.push('số con giống đã thả');
    if (survivalPct <= 0) thieu.push('tỷ lệ sống dự kiến');
    if (avgWeightG <= 0) thieu.push('trọng lượng trung bình (chài mẫu)');

    if (thieu.length) {
        return {
            ok: false,
            missing: thieu,
            message: 'Chưa tính được khẩu phần, còn thiếu: ' + thieu.join(', '),
        };
    }

    // --- Buoc 1, 2 ---
    const soTom = tinhSoTom(seedCount, survivalPct);
    const sinhKhoiKg = tinhSinhKhoi(soTom, avgWeightG);

    // --- Ty le cho an ---
    const muc = traBangTyLe(avgWeightG, rateTable);
    const tuDat = n(ao.ratePct, null);
    const ratePct = tuDat !== null && tuDat > 0 ? tuDat : muc.ratePct;

    // --- Buoc 3 ---
    const camNgayGoc = tinhLuongCam(sinhKhoiKg, ratePct);

    // --- Dieu chinh theo moi truong that ---
    const dc = heSoMoiTruong(env, adjust);
    const camNgay = camNgayGoc * dc.factor;

    // --- Chia cu ---
    const mealsPerDay = Math.max(1, Math.round(n(ao.mealsPerDay, muc.meals) || muc.meals));
    const mealTimes = (ao.mealTimes && ao.mealTimes.length)
        ? ao.mealTimes.slice(0, mealsPerDay)
        : ((cfg.mealTimes && cfg.mealTimes.length) ? cfg.mealTimes : DEFAULT_MEAL_TIMES).slice(0, mealsPerDay);
    const camMoiCu = camNgay / mealsPerDay;

    // --- Kho cam ---
    const stock = n(ao.feedStockKg, null);
    const stockMax = n(ao.feedStockMaxKg, null);
    const stockPct = (stock !== null && stockMax) ? Math.max(0, Math.min(100, (stock / stockMax) * 100)) : null;
    const soNgayConCam = (stock !== null && camNgay > 0) ? stock / camNgay : null;

    return {
        ok: true,

        // --- Ba buoc, tra ra het de giao dien giai thich duoc cho nguoi dung ---
        buoc1: { seedCount, survivalPct, soTom },
        buoc2: { avgWeightG, sinhKhoiKg: round(sinhKhoiKg, 1) },
        buoc3: {
            ratePct,
            ratePctTuBang: muc.ratePct,
            ratePctTuDat: tuDat !== null && tuDat > 0,
            camNgayGocKg: round(camNgayGoc, 2),
        },

        // --- Ket qua dung duoc ngay ---
        soTom,
        sinhKhoiKg: round(sinhKhoiKg, 1),
        sizeConKg: tinhSize(avgWeightG),
        ratePct,
        camNgayKg: round(camNgay, 2),
        mealsPerDay,
        mealTimes,
        camMoiCuKg: round(camMoiCu, 2),
        camMoiCuGram: Math.round(camMoiCu * 1000),

        // --- Dieu chinh moi truong ---
        adjustFactor: dc.factor,
        adjustReasons: dc.reasons,
        ngungChoAn: dc.factor === 0,

        // --- Kho cam ---
        feedStockKg: stock,
        feedStockMaxKg: stockMax,
        feedStockPct: stockPct === null ? null : round(stockPct, 0),
        soNgayConCam: soNgayConCam === null ? null : round(soNgayConCam, 1),

        ghiChuCoTom: muc.note || null,
    };
}

/** Lam tron n chu so thap phan. */
function round(v, d) {
    const m = Math.pow(10, d);
    return Math.round(v * m) / m;
}

/**
 * Cu an ke tiep tinh tu gio hien tai.
 * @returns {{time:string, inMinutes:number, isTomorrow:boolean}|null}
 */
function cuAnKeTiep(mealTimes, now = new Date()) {
    if (!mealTimes || !mealTimes.length) return null;

    const phutHienTai = now.getHours() * 60 + now.getMinutes();

    const list = mealTimes
        .map(t => {
            const [h, m] = String(t).split(':').map(x => parseInt(x, 10));
            if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
            return { time: t, phut: h * 60 + m };
        })
        .filter(Boolean)
        .sort((a, b) => a.phut - b.phut);

    if (!list.length) return null;

    for (const c of list) {
        if (c.phut > phutHienTai) {
            return { time: c.time, inMinutes: c.phut - phutHienTai, isTomorrow: false };
        }
    }
    // Het cu hom nay -> cu dau tien cua ngay mai
    const dau = list[0];
    return { time: dau.time, inMinutes: (24 * 60 - phutHienTai) + dau.phut, isTomorrow: true };
}

module.exports = {
    tinhSoTom,
    tinhSinhKhoi,
    tinhLuongCam,
    tinhSize,
    traBangTyLe,
    heSoMoiTruong,
    tinhKhauPhan,
    cuAnKeTiep,
    DEFAULT_RATE_TABLE,
    DEFAULT_MEAL_TIMES,
    DEFAULT_ADJUST,
};

// ================================================================
// CHAY THU:  node feed.js --test
// ================================================================
if (require.main === module) {
    const vd = tinhKhauPhan(
        { seedCount: 300000, survivalPct: 85, avgWeightG: 10, feedStockKg: 5, feedStockMaxKg: 15 },
        {}
    );
    console.log('=== VI DU TRONG TAI LIEU: 300.000 giong, ty le song 85%, W = 10 g/con ===');
    console.log(`  Bước 1  N = 300.000 x 85%           = ${vd.soTom.toLocaleString('vi-VN')} con`);
    console.log(`  Bước 2  B = ${vd.soTom.toLocaleString('vi-VN')} x 10 / 1000  = ${vd.sinhKhoiKg.toLocaleString('vi-VN')} kg`);
    console.log(`  Bước 3  F = ${vd.sinhKhoiKg.toLocaleString('vi-VN')} x ${vd.ratePct}%        = ${vd.camNgayKg.toLocaleString('vi-VN')} kg/ngày`);
    console.log(`          -> ${vd.mealsPerDay} cữ/ngày, mỗi cữ ${vd.camMoiCuKg} kg (${vd.camMoiCuGram} g)`);
    console.log(`          -> size ~${vd.sizeConKg} con/kg`);
    console.log(`          -> kho cám còn ${vd.feedStockKg}/${vd.feedStockMaxKg} kg = ${vd.feedStockPct}%, đủ ${vd.soNgayConCam} ngày`);
    console.log('\n=== KHI CAM BIEN BAO DO THAP (3,8 mg/L) ===');
    const vd2 = tinhKhauPhan(
        { seedCount: 300000, survivalPct: 85, avgWeightG: 10 },
        { do_value: 3.8, temperature: 29 }
    );
    console.log(`  Hệ số điều chỉnh = ${vd2.adjustFactor}  (${vd2.adjustReasons.join('; ')})`);
    console.log(`  Khẩu phần: ${vd2.buoc3.camNgayGocKg} -> ${vd2.camNgayKg} kg/ngày`);
    console.log('\n=== THIEU DU LIEU ===');
    console.log(' ', tinhKhauPhan({ seedCount: 300000 }).message);
    console.log('\n=== CU AN KE TIEP ===');
    console.log(' ', JSON.stringify(cuAnKeTiep(['06:00', '10:00', '14:00', '18:00'])));
}
