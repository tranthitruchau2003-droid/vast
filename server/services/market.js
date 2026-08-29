// ================================================================
// market.js - DICH VU GIA TOM THEO THI TRUONG
//
// Nhiem vu:
//   1) Cu moi X phut (mac dinh 60) tu dong lay bang gia tom tu nguon
//   2) Luu vao database: gia MOI NHAT + lich su theo NGAY (de ve bieu do)
//   3) Neu lay hut (mat mang / trang nguon doi) -> GIU gia cu, danh dau
//      "stale" de giao dien noi ro "so lieu cu", KHONG bao gio de trang trang
//   4) Gia NHAP TAY luon de len tren gia tu dong
//
// Chay thu rieng module nay (khong can bat server):
//     node market.js --once            lay gia 1 lan roi in ra
//     node market.js --once --debug    luu ca trang HTML tho vao data/ de soi
// ================================================================

'use strict';

const path = require('path');
const db = require('../lib/db');
const config = require('../config');
const { fetchPrices, fetchSupplies, _internals } = require('./market_source');
const { classify } = _internals;

const MK = config.market || {};

// ----------------------------------------------------------------
// BANG GIA DU PHONG
// ----------------------------------------------------------------
// Chi dung khi database CHUA CO GI va lan lay dau tien that bai
// (vi du may chua noi mang). Muc dich la de tab "Thong tin thi truong"
// khong bao gio trong tron khi demo.
// Luon duoc danh dau source = 'default' -> giao dien hien ro
// "Chua lay duoc gia thi truong".
// ----------------------------------------------------------------
const FALLBACK = [
    { code: 'THE30', name: 'Tôm thẻ (30 con/kg) tại ao', species: 'the', size: 30, price: 145000 },
    { code: 'THE40', name: 'Tôm thẻ (40 con/kg) tại ao', species: 'the', size: 40, price: 125000 },
    { code: 'THE50', name: 'Tôm thẻ (50 con/kg) tại ao', species: 'the', size: 50, price: 105000 },
    { code: 'THE100', name: 'Tôm thẻ (100 con/kg) tại ao', species: 'the', size: 100, price: 82000 },
    { code: 'SU20', name: 'Tôm sú (20 con/kg) tại ao', species: 'su', size: 20, price: 220000 },
    { code: 'SU30', name: 'Tôm sú (30 con/kg) tại ao', species: 'su', size: 30, price: 160000 },
    { code: 'SU40', name: 'Tôm sú (40 con/kg) tại ao', species: 'su', size: 40, price: 130000 },
    { code: 'TCX20', name: 'Tôm càng xanh loại 15-20 con/kg', species: 'cang_xanh', size: 20, price: 115000 },
].map(x => ({
    ...x,
    species_label: x.species === 'the' ? 'Tôm thẻ chân trắng'
        : x.species === 'su' ? 'Tôm sú' : 'Tôm càng xanh',
    size_label: `Size ${x.size} con/kg`,
    is_seed: 0,
    unit: 'đ/kg',
    prev_price: null,
    change_pct: null,
    region: 'Tham khảo',
    source: 'default',
    source_url: null,
    change_period: null,
    source_date: null,
    source_age_days: null,
    source_updated_text: null,
    changed_at: null,
    updated_at: null,
}));

// ----------------------------------------------------------------
// TRANG THAI TRONG BO NHO
// ----------------------------------------------------------------
const state = {
    busy: false,
    lastTryAt: null,      // lan lay gia gan nhat (ke ca that bai)
    lastOkAt: null,       // lan lay gia THANH CONG gan nhat
    lastError: null,
    lastCount: 0,
    lastSource: null,
    nextAt: null,
    timer: null,

    // Gia vat tu (cam, voi, hoa chat) - trang rieng cua tepbac.
    // Theo doi tach biet voi gia tom: trang vat tu chet KHONG duoc lam
    // hong bang gia tom, va nguoc lai.
    vtLastOkAt: null,
    vtLastError: null,
    vtLastCount: 0,
    daBaoGiaXau: false,   // chi in canh bao gia vo ly 1 lan, khong spam log
};

// Khoi phuc trang thai tu database khi server khoi dong lai
try {
    state.lastOkAt = db.marketMeta('market_last_ok_at');
    state.lastTryAt = db.marketMeta('market_last_try_at');
    state.lastError = db.marketMeta('market_last_error') || null;
    state.lastSource = db.marketMeta('market_last_source');
    state.lastCount = parseInt(db.marketMeta('market_last_count') || '0', 10) || 0;
} catch { /* database moi tinh - bo qua */ }

const nowIso = () => new Date().toISOString();

/** Ngay dia phuong dang YYYY-MM-DD (theo gio Viet Nam cua may chay server). */
function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ================================================================
// LAY GIA VE VA LUU VAO DATABASE
// ================================================================

/**
 * @param {{force?:boolean, debug?:boolean}} opts
 * @returns {Promise<{ok:boolean, count?:number, source?:string, error?:string, skipped?:boolean}>}
 */
/**
 * Lay bang gia vat tu tham khao (cam, voi, hoa chat) tu tepbac.
 * KHONG nem loi ra ngoai: day la so tham khao, khong duoc lam hong
 * viec lay gia tom - thu ma nguoi nuoi dung de chot ban.
 */
async function layGiaVatTu(opts = {}) {
    if (MK.suppliesEnabled === false) return;
    try {
        const res = await fetchSupplies(MK, {
            debugFile: opts.debug ? path.join(__dirname, '..', 'data', 'market_supply_debug.html') : null,
        });
        let n = 0;
        for (const it of res.items) {
            if (!Number.isFinite(it.price) || it.price <= 0) continue;
            db.supplyAutoSave({
                code: it.code, ten: it.name, loai: it.loai, loai_nuoi: it.loai_nuoi,
                gia: it.price, don_vi: it.unit, change_pct: it.change_pct,
                change_period: it.change_period,
                source: it.source, source_url: it.source_url, source_date: it.source_date,
                source_age_days: it.source_age_days, source_updated_text: it.source_updated_text,
            });
            n++;
        }
        const vtXoa = db.supplyAutoPurgeMissing(res.items.map(i => i.code));
        if (vtXoa) console.log(`[THI TRUONG] Đã dọn ${vtXoa} dòng vật tư cũ không còn trên nguồn`);

        state.vtLastOkAt = nowIso();
        state.vtLastError = null;
        state.vtLastCount = n;
        console.log(`[THI TRUONG] Đã cập nhật ${n} giá vật tư từ ${res.url}`);
    } catch (e) {
        state.vtLastError = e.message;
        console.warn('[THI TRUONG] Lấy giá vật tư thất bại:', e.message, '- giữ nguyên giá cũ');
    }
}

/** Phien ban bo doc gia. In ra luc khoi dong de biet chac file moi da duoc nap. */
const BAN_BO_DOC = '2026-08-23c';

/**
 * Xoa thang cac dong gia VO LY con sot trong database, khong cho toi
 * lan lay gia thanh cong ke tiep.
 *
 * Dung khi vua cap nhat bo doc: dong hong cu co khoa khac dong moi nen
 * khong bi ghi de, nam lai va hien song song voi dong dung.
 *
 * @returns {number} so dong da xoa
 */
function donRac() {
    let n = 0;
    for (const r of db.marketList()) {
        if (r.manual) continue;                       // gia nhap tay: khong dung toi
        const xau = !Number.isFinite(r.price) || r.price <= 0
            || (r.unit === 'đ/con' && (r.price < 5 || r.price > 5000))
            || (r.unit === 'đ/kg' && r.price < 5000);
        if (!xau) continue;
        db.marketDelete(r.code);
        n++;
    }
    if (n) console.log(`[THI TRUONG] Đã xoá ${n} dòng giá vô lý khỏi database`);
    else console.log('[THI TRUONG] Không có dòng giá vô lý nào trong database');
    return n;
}

async function refresh(opts = {}) {
    if (MK.enabled === false) return { ok: false, error: 'Tính năng giá thị trường đang tắt trong config' };
    if (state.busy) return { ok: false, error: 'Đang lấy giá, vui lòng đợi', skipped: true };

    // Chong bam nut "Lam moi" lien tuc -> khong lam phien trang nguon
    const minGap = (MK.minRefreshSeconds ?? 60) * 1000;
    if (!opts.force && state.lastTryAt && Date.now() - Date.parse(state.lastTryAt) < minGap) {
        return { ok: true, skipped: true, error: 'Vừa lấy giá xong, dùng lại số liệu hiện có' };
    }

    state.busy = true;
    state.lastTryAt = nowIso();
    db.marketSetMeta('market_last_try_at', state.lastTryAt);

    try {
        const res = await fetchPrices(MK, {
            debugFile: opts.debug ? path.join(__dirname, '..', 'data', 'market_debug.html') : null,
        });

        const day = today();
        let saved = 0;

        for (const it of res.items) {
            if (!Number.isFinite(it.price) || it.price <= 0) continue;
            db.marketSavePrice(it);
            db.marketAddHistory(it.code, it.source_date || day, it.price, it.unit);
            saved++;
        }

        if (!saved) throw new Error('Nguồn trả về nhưng không có mục nào hợp lệ');

        // Don cac dong tu dong khong con trong lan lay nay.
        // Bat buoc phai co: khi bo doc duoc sua, khoa cua mot muc doi
        // (vd "TCX10_TOM_CANG_XANH_..." -> "TCX10"), dong cu nam lai
        // trong database va giao dien hien CA HAI gia cho cung 1 size.
        const daXoa = db.marketPurgeMissing(res.items.map(i => i.code));
        if (daXoa) console.log(`[THI TRUONG] Đã dọn ${daXoa} dòng giá cũ không còn trên nguồn`);
        state.daBaoGiaXau = false;

        state.lastOkAt = nowIso();
        state.lastError = null;
        state.lastCount = saved;
        state.lastSource = res.source;

        db.marketSetMeta('market_last_ok_at', state.lastOkAt);
        db.marketSetMeta('market_last_error', '');
        db.marketSetMeta('market_last_count', saved);
        db.marketSetMeta('market_last_source', res.source);

        // Don lich su qua cu cho nhe database
        const keepDays = MK.historyDays ?? 400;
        const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
        db.marketPurgeHistoryBefore(cutoff);

        console.log(`[THI TRUONG] Đã cập nhật ${saved} mức giá từ ${res.source} (${res.url})`);

        // Lay them GIA VAT TU (trang khac cua tepbac). Chay sau va bat loi
        // rieng: vat tu hong thi gia tom van tinh la thanh cong.
        await layGiaVatTu(opts);

        return { ok: true, count: saved, source: res.source };

    } catch (e) {
        state.lastError = e.message;
        db.marketSetMeta('market_last_error', e.message);
        console.warn('[THI TRUONG] Lấy giá thất bại:', e.message, '- giữ nguyên giá cũ trong database');
        return { ok: false, error: e.message };

    } finally {
        state.busy = false;
    }
}

// ================================================================
// DOC RA CHO WEBSITE
// ================================================================

/** Bien 1 dong trong database thanh doi tuong gui cho web. */
function shape(row, manualByCode, day) {
    const man = manualByCode[row.code];

    // Gia nhap tay uu tien tuyet doi
    const price = man && Number.isFinite(man.price) ? man.price : row.price;

    // ================================================================
    // MUC TANG / GIAM - phai lay dung nguon
    // ----------------------------------------------------------------
    // TRANG NGUON TU CONG BO % THAY DOI TRONG NGAY. Con so do moi la dung.
    //
    // Truoc day o day lay hieu so giua gia hien tai va "gia lan lay truoc"
    // trong database. Nghe hop ly nhung SAI, vi lan lay truoc co the cach
    // day nhieu ngay - ra mot con so khong phai thay doi trong ngay.
    //
    // Tac hai that: tom size 60 tren trang nguon dang GIAM 6,3%, nhung
    // lan lay truoc cua minh cach day may hom (luc gia thap hon) nen phep
    // tru ra so DUONG -> giao dien hien mui ten XANH DI LEN cho mot mat
    // hang dang RO XUONG. Nguoi nuoi nhin vao do quyet dinh ban hay giu
    // thi bi dan sai huong hoan toan.
    //
    // Nen: co % cua nguon thi dung %, tu do suy nguoc ra gia hom truoc.
    // Khong co thi moi dung den moc trong database.
    // ================================================================
    let prev = null;
    let change_abs = null;
    const pct = row.change_pct;

    if (!man && Number.isFinite(pct) && pct !== 0 && Number.isFinite(price)) {
        // Nguon co ghi % -> tin so cua nguon
        const truoc = price / (1 + pct / 100);
        if (Number.isFinite(truoc) && truoc > 0) {
            prev = Math.round(truoc);
            change_abs = Math.round(price - truoc);
        }
    }

    if (change_abs === null) {
        // Khong co % (hoac gia nhap tay) -> so voi gia gan nhat cua NGAY TRUOC
        try { prev = db.marketPrevPrice(row.code, day); } catch { prev = null; }
        if (!Number.isFinite(prev) && !man) prev = row.prev_price;
        if (Number.isFinite(price) && Number.isFinite(prev)) change_abs = price - prev;
    }

    let direction = 'flat';
    if (Number.isFinite(change_abs) && change_abs !== 0) direction = change_abs > 0 ? 'up' : 'down';
    else if (Number.isFinite(pct) && pct !== 0) direction = pct > 0 ? 'up' : 'down';

    return {
        code: row.code,
        name: row.name,
        species: row.species,
        species_label: row.species_label,
        size: row.size,
        size_label: row.size_label,
        is_seed: !!row.is_seed,

        price,
        prev_price: prev ?? null,
        change_abs,
        change_pct: row.change_pct ?? null,
        direction,

        unit: (man && man.unit) || row.unit || 'đ/kg',
        region: (man && man.region) || row.region || null,

        source: man ? 'manual' : (row.source || 'unknown'),
        manual: !!man,
        manual_note: man ? (man.note || null) : null,
        change_period: row.change_period || null,
        source_date: row.source_date || null,
        // Dong nay tren trang nguon da cu bao nhieu ngay.
        // Khong phai dong nao cung moi: gia tom the co the cap nhat hom nay
        // trong khi gia tom cang xanh da 38 ngay chua doi. Hai so do khong
        // the tin ngang nhau, nen phai hien rieng cho tung dong.
        source_age_days: row.source_age_days ?? null,
        source_updated_text: row.source_updated_text || null,
        // Qua 14 ngay khong doi thi coi la CU, canh bao rieng dong do
        source_stale: Number.isFinite(row.source_age_days) && row.source_age_days > 14,
        changed_at: row.changed_at || null,
        updated_at: (man && man.updated_at) || row.updated_at || null,
    };
}

/**
 * Toan bo bang gia hien tai + thong tin "moi/cu".
 * @param {{species?:string}} filter
 */
function snapshot(filter = {}) {
    const manualByCode = {};
    for (const m of db.marketManualList()) manualByCode[m.code] = m;

    let rows = db.marketList();
    let usingFallback = false;

    if (!rows.length) {
        rows = FALLBACK;
        usingFallback = true;
    }

    const day = today();
    let items = rows.map(r => shape(r, manualByCode, day));

    // ----------------------------------------------------------------
    // LUOI CHAN CUOI CUNG: khong bao gio hien gia KHONG THE DUNG.
    //
    // Da co lan bo doc bi loi lam gia tom cang xanh 380.000 d/kg hien
    // thanh "38 d", va tom giong 189 d/con hien thanh "18.949 d/con".
    // Dep trong database la chua du: dong hong con nam lai o may nguoi
    // dung cho toi khi lay gia thanh cong lan sau. Nen chan luon o day.
    //
    // Gia NHAP TAY khong bi chan - do la so nguoi dung tu ghi, ho tu chiu
    // trach nhiem, minh khong duoc tu y giau di.
    // ----------------------------------------------------------------
    const bay = [];
    items = items.filter(i => {
        if (i.manual) return true;
        if (!Number.isFinite(i.price) || i.price <= 0) { bay.push(i); return false; }
        if (i.unit === 'đ/con' && (i.price < 5 || i.price > 5000)) { bay.push(i); return false; }
        if (i.unit === 'đ/kg' && i.price < 5000) { bay.push(i); return false; }
        return true;
    });
    if (bay.length && !state.daBaoGiaXau) {
        state.daBaoGiaXau = true;
        console.warn('[THI TRUONG] Ẩn ' + bay.length + ' dòng giá vô lý còn sót trong database: '
            + bay.map(b => `${b.code}=${b.price}${b.unit}`).join(', '));
        console.warn('[THI TRUONG] Chúng sẽ bị xoá hẳn ở lần lấy giá thành công kế tiếp.');
    }

    // Them cac ma CHI co trong bang nhap tay (nguoi dung tu them size moi)
    for (const m of Object.values(manualByCode)) {
        if (items.some(i => i.code === m.code)) continue;
        items.push(shape({
            code: m.code, name: m.name || m.code, species: m.species || 'other',
            species_label: m.species === 'su' ? 'Tôm sú' : m.species === 'the' ? 'Tôm thẻ chân trắng' : 'Tôm khác',
            size: m.size ?? null, size_label: m.size ? `Size ${m.size} con/kg` : (m.name || m.code),
            is_seed: 0, price: m.price, prev_price: null, unit: m.unit, change_pct: null,
            region: m.region, source: 'manual', source_date: null,
            changed_at: m.updated_at, updated_at: m.updated_at,
        }, manualByCode, day));
    }

    if (filter.species) items = items.filter(i => i.species === filter.species);

    // Sap xep: tom to (size nho) len truoc, tom giong xuong cuoi
    items.sort((a, b) =>
        (a.is_seed ? 1 : 0) - (b.is_seed ? 1 : 0) ||
        (a.size ?? 999) - (b.size ?? 999) ||
        String(a.code).localeCompare(String(b.code))
    );

    // ----------------------------------------------------------------
    // TINH TRANG THAI "MOI hay CU" CHO DUNG
    // ----------------------------------------------------------------
    // 3 loai gia tron lan nhau, khong duoc go chung mot ro:
    //   default - bang du phong, KHONG phai gia that      -> phai canh bao
    //   manual  - nguoi dung tu nhap, la gia THAT          -> khong phai canh bao
    //   tu dong - lay tu nguon, co the cu neu mat mang     -> canh bao khi qua han
    // Truoc day chi can co 1 dong default la ca bang bi dan nhan
    // "chua lay duoc gia", lam gia nhap tay dung cung bi nghi ngo.
    // ----------------------------------------------------------------
    const defaultCount = items.filter(i => i.source === 'default').length;
    const manualCount = items.filter(i => i.manual).length;
    const autoCount = items.length - defaultCount - manualCount;

    // Lan nhap tay gan nhat cung duoc tinh la "moi cap nhat"
    let latestManual = null;
    for (const m of Object.values(manualByCode)) {
        if (m.updated_at && (!latestManual || m.updated_at > latestManual)) latestManual = m.updated_at;
    }
    const updatedAt = [state.lastOkAt, latestManual].filter(Boolean).sort().pop() || null;

    // ----------------------------------------------------------------
    // KIEM TRA DU LIEU CO HOP LY KHONG
    // ----------------------------------------------------------------
    // Quy luat cua bang gia tom: SIZE cang LON (nhieu con/kg = tom cang nho)
    // thi gia cang THAP. Size 20 phai dat hon size 30, size 30 dat hon size 40...
    //
    // Neu bang gia doc ve bi NGUOC quy luat nay o nhieu cho, gan nhu chac chan
    // la doc nham cot: trang nguon co the co nhieu cot so (gia hom nay, gia
    // hom qua, gia cao nhat...) va bo doc dang lay nham cot.
    //
    // Phai bao ra, khong duoc im lang. Nguoi nuoi ban tom that bang so nay.
    const nghiNgo = kiemTraHopLy(items);

    const ageSeconds = updatedAt
        ? Math.round((Date.now() - Date.parse(updatedAt)) / 1000)
        : null;
    const staleAfter = (MK.staleAfterHours ?? 26) * 3600;

    const autoAge = state.lastOkAt ? (Date.now() - Date.parse(state.lastOkAt)) / 1000 : null;
    const autoStale = autoCount > 0 && (autoAge === null || autoAge > staleAfter);

    return {
        ok: true,
        server_time: nowIso(),

        // --- TRANG THAI CAP NHAT (giao dien can cai nay de noi that voi nguoi dung) ---
        updated_at: updatedAt,
        age_seconds: ageSeconds,
        stale: defaultCount > 0 || autoStale,
        using_fallback: defaultCount > 0,
        all_fallback: defaultCount > 0 && defaultCount === items.length,
        counts: { auto: autoCount, manual: manualCount, fallback: defaultCount },
        provider: MK.provider || 'tepbac',
        source: manualCount === items.length && items.length
            ? 'manual'
            : (state.lastSource || (defaultCount ? 'default' : null)),
        last_error: state.lastError || null,
        next_refresh_at: state.nextAt,
        refresh_minutes: MK.refreshMinutes ?? 60,

        count: items.length,
        // Canh bao khi so lieu doc ve co dau hieu sai (vi du gia size lon
        // lai cao hon size nho) - de nguoi dung khong chot ban bang so sai.
        nghi_ngo: nghiNgo,
        items,
    };
}

/**
 * Doi chieu bang gia voi quy luat "tom cang to gia cang cao".
 * Tra ve danh sach cho bi nguoc, hoac mang rong neu bang gia hop ly.
 */
function kiemTraHopLy(items) {
    const loi = [];

    for (const loai of ['the', 'su']) {
        const bang = items
            .filter(i => i.species === loai && !i.is_seed && i.unit === 'đ/kg'
                && Number.isFinite(i.size) && Number.isFinite(i.price))
            .sort((a, b) => a.size - b.size);

        for (let i = 1; i < bang.length; i++) {
            const to = bang[i - 1];    // size nho hon = con to hon
            const nho = bang[i];
            if (nho.price > to.price) {
                loi.push({
                    loai,
                    noi_dung: `Size ${nho.size} (${nho.price.toLocaleString('vi-VN')} đ) `
                        + `cao hơn size ${to.size} (${to.price.toLocaleString('vi-VN')} đ) — `
                        + 'ngược quy luật, tôm nhỏ hơn mà đắt hơn',
                    size_a: to.size, gia_a: to.price,
                    size_b: nho.size, gia_b: nho.price,
                });
            }
        }
    }

    if (!loi.length) return null;
    return {
        co_van_de: true,
        so_cho_nguoc: loi.length,
        chi_tiet: loi,
        ket_luan: loi.length >= 2
            ? 'Bảng giá có nhiều chỗ ngược quy luật — nhiều khả năng bộ đọc đang lấy nhầm cột '
              + 'trên trang nguồn. ĐỪNG dùng bảng này để chốt bán cho tới khi kiểm lại.'
            : 'Có một chỗ ngược quy luật. Thị trường thật thỉnh thoảng cũng vậy, '
              + 'nhưng nên đối chiếu lại với trang nguồn.',
        cach_kiem: 'Chạy: node market.js --once --debug  → xem file server/data/market_debug.html',
    };
}

/** Lich su gia theo ngay cua 1 ma - de ve bieu do xu huong. */
function history(code, days = 30) {
    const d = Math.min(400, Math.max(2, parseInt(days, 10) || 30));
    const since = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const rows = db.marketHistorySince(String(code), since);
    return {
        ok: true,
        code: String(code),
        days: d,
        points: rows.map(r => ({ day: r.day, price: r.price, unit: r.unit })),
    };
}

// ================================================================
// NHAP GIA TAY
// ================================================================

/**
 * @param {Array} items  [{ code, price, name?, species?, size?, unit?, region?, note?, clear? }]
 */
function saveManual(items) {
    const out = { saved: 0, cleared: 0, errors: [] };

    for (const raw of (items || [])) {
        const code = String(raw.code || '').trim().toUpperCase();
        if (!code) { out.errors.push('Thiếu mã (code)'); continue; }

        if (raw.clear === true || raw.price === null || raw.price === '') {
            db.marketManualDelete(code);
            out.cleared++;
            continue;
        }

        const price = Number(String(raw.price).replace(/[^\d.]/g, ''));
        if (!Number.isFinite(price) || price <= 0 || price > 100000000) {
            out.errors.push(`${code}: giá không hợp lệ`);
            continue;
        }

        // Biet gi ve ma nay roi? Uu tien bang gia that, roi den bang du phong,
        // cuoi cung tu doan tu chinh ma (THE30 -> tom the, size 30).
        const known = db.marketGet(code) || FALLBACK.find(f => f.code === code) || null;
        const guess = classify(raw.name || (known && known.name) || code, code);

        let size = raw.size !== undefined && raw.size !== null && raw.size !== ''
            ? parseInt(raw.size, 10)
            : (known && known.size != null ? known.size : guess.size);

        db.marketManualSave({
            code,
            name: String(raw.name || (known && known.name) || code).slice(0, 120),
            species: String(raw.species || (known && known.species) || guess.species || 'other'),
            size: Number.isFinite(size) ? size : null,
            price,
            unit: String(raw.unit || (known && known.unit) || 'đ/kg').slice(0, 16),
            region: String(raw.region || (known && known.region) || 'Nhập tay').slice(0, 60),
            note: String(raw.note || '').slice(0, 200),
        });

        // Ghi luon vao lich su de bieu do co diem hom nay
        db.marketAddHistory(code, today(), price, raw.unit || 'đ/kg');
        out.saved++;
    }

    return out;
}

// ================================================================
// LICH CHAY TU DONG
// ================================================================

function scheduleNext(ms) {
    if (state.timer) clearTimeout(state.timer);
    state.nextAt = new Date(Date.now() + ms).toISOString();
    state.timer = setTimeout(tick, ms);
    state.timer.unref?.();
}

async function tick() {
    await refresh();
    scheduleNext((MK.refreshMinutes ?? 60) * 60 * 1000);
}

/** Goi 1 lan tu server.js khi khoi dong. */
function start() {
    if (MK.enabled === false) {
        console.log('[THI TRUONG] Đang TẮT (market.enabled = false)');
        return;
    }

    console.log(`[THI TRUONG] Bản bộ đọc giá: ${BAN_BO_DOC}`);

    // DON RAC NGAY LUC KHOI DONG - khong duoc cho lan lay gia ke tiep.
    //
    // LOI DA GAP: sua bo doc xong, dong hong cu (gia 38 d/kg) van nam trong
    // database vi khoa cua no khac khoa moi. Nguoi dung khoi dong lai server,
    // nhung neu lan lay gia gan nhat chua qua 30 phut thi doan ngay duoi day
    // KHONG lay lai -> khong don -> man hinh van hien song song 2 gia cho
    // cung 1 size, mot dung mot sai. Phai don o day, VO DIEU KIEN.
    const daXoa = donRac();

    const everyMs = (MK.refreshMinutes ?? 60) * 60 * 1000;
    const sinceOk = state.lastOkAt ? Date.now() - Date.parse(state.lastOkAt) : Infinity;

    // Vua xoa dong hong -> PHAI lay gia lai ngay, du moi lay xong.
    // Neu khong, cho nao vua xoa se trong, giao dien roi ve bang du phong
    // (so tham khao) suot 30 phut - trong khi gia that lay ve trong 2 giay.
    // Khoi dong lai server nhieu lan trong 1 gio ma KHONG xoa gi thi moi
    // hoan lai, tranh goi trang nguon lien tuc mot cach vo ich.
    if (daXoa > 0 || sinceOk >= everyMs) {
        setTimeout(() => tick(), 4000).unref?.();   // cho server len xong da
        state.nextAt = new Date(Date.now() + 4000).toISOString();
    } else {
        scheduleNext(everyMs - sinceOk);
    }

    console.log(`[THI TRUONG] Tự động lấy giá tôm mỗi ${MK.refreshMinutes ?? 60} phút (nguồn: ${MK.provider || 'tepbac'})`);
}

module.exports = { start, refresh, snapshot, history, saveManual, layGiaVatTu, donRac, state, BAN_BO_DOC, FALLBACK };

// ================================================================
// CHAY THU TRUC TIEP:  node market.js --once [--debug]
// ================================================================
if (require.main === module) {
    const debug = process.argv.includes('--debug');

    // node market.js --dondep   -> xoa ngay cac dong gia vo ly, khong lay gia moi
    if (process.argv.includes('--dondep')) {
        console.log('Bản bộ đọc giá:', BAN_BO_DOC);
        donRac();
        process.exit(0);
    }

    refresh({ force: true, debug }).then(r => {
        console.log('\nKET QUA:', r);
        const snap = snapshot();
        console.log(`\nBANG GIA (${snap.count} mục, nguồn: ${snap.source}, cũ: ${snap.stale}):`);
        for (const i of snap.items) {
            const mui = i.direction === 'up' ? '▲' : i.direction === 'down' ? '▼' : ' ';
            const delta = Number.isFinite(i.change_abs) && i.change_abs !== 0
                ? ` (${i.change_abs > 0 ? '+' : ''}${i.change_abs.toLocaleString('vi-VN')})` : '';
            console.log(
                `  ${String(i.code).padEnd(10)} ${String(i.size_label).padEnd(22)} ` +
                `${String(i.price?.toLocaleString('vi-VN')).padStart(10)} ${i.unit} ${mui}${delta}`
            );
        }
        // In luon bang GIA VAT TU vua lay duoc, de kiem tra bang mat
        const vt = db.supplyAutoAll() || [];
        console.log(`\nGIA VAT TU (${vt.length} mục` +
            (state.vtLastError ? `, LỖI: ${state.vtLastError}` : '') + '):');
        if (!vt.length) {
            console.log('  (chưa lấy được mục nào — xem lỗi ở trên)');
        }
        for (const v of vt) {
            const mui = !Number.isFinite(v.change_pct) || v.change_pct === 0
                ? ' ' : (v.change_pct > 0 ? '▲' : '▼');
            console.log(
                `  ${String(v.code).padEnd(10)} ${String(v.ten).padEnd(30)} ` +
                `${String(v.gia?.toLocaleString('vi-VN')).padStart(10)} ${v.don_vi} ${mui} ` +
                `${v.change_pct ?? 0}%  ${v.source_updated_text || ''}  [${v.loai}/${v.loai_nuoi}]`
            );
        }
        console.log('\nTrang nguồn vật tư: https://tepbac.com/gia-thuy-san/gia/vat-tu');

        if (debug) {
            console.log('\nĐã lưu HTML thô vào server/data/market_debug.html');
            console.log('Và trang vật tư vào server/data/market_supply_debug.html');
        }
        process.exit(r.ok ? 0 : 1);
    });
}
