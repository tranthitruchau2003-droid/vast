// ================================================================
// harvest.js - CO VAN THU HOACH
//
// Tra loi mot cau duy nhat, bang so that:
//
//     "Ban bay gio, hay nuoi them it ngay nua cho len size roi ban?"
//
// ================================================================
// VI SAO VIET LAI PHAN NAY
// ----------------------------------------------------------------
// The "Co van Thu hoach AI" tren giao dien von la mot cai anh: ten ao,
// size, so ngay nuoi them, chi phi cam - tat ca deu go cung trong HTML.
// Ao nao mo ra cung thay "Ao so 1, size 50, nuoi them 12 ngay, ton
// ~15 trieu". Nut "Giu lai nuoi tiep" tham chi khong co @click.
//
// Loi khuyen ban hay giu la loi khuyen ve TIEN. Bia mot con so o day
// la day nguoi ta chot ban sai thoi diem - hai truc tiep vao tui ho.
//
// ================================================================
// NGUYEN TAC: THIEU DU LIEU THI NOI THIEU, KHONG DOAN
// ----------------------------------------------------------------
// Muon tra loi duoc can DU BON thu:
//
//   1. Tom dang co bao nhieu? -> chai mau gan nhat (pond_feed)
//   2. Tom lon nhanh cham the nao? -> can IT NHAT HAI lan chai mau
//   3. Trong ao co bao nhieu ky tom? -> sinh khoi tu cong thuc feed.js
//   4. Gia thi truong tung size -> market.js
//
// Thieu bat ky cai nao thi tra ve `thieu[]` va KHONG dua ra con so.
// ================================================================

'use strict';

const db = require('../lib/db');
const feed = require('./feed');
const kb = require('./kb');

/** Size (con/kg) tu trong luong trung binh 1 con (gam). */
function sizeTuTrongLuong(g) {
    const w = Number(g);
    return w > 0 ? 1000 / w : null;
}

/** Trong luong 1 con (gam) tu size. */
function trongLuongTuSize(size) {
    const s = Number(size);
    return s > 0 ? 1000 / s : null;
}

/**
 * Toc do lon: bao nhieu GAM MOI NGAY.
 *
 * Lay tu hai lan chai mau xa nhau nhat trong 60 ngay gan day. Dung hai
 * lan gan nhau qua thi sai so cua can va cua viec bat ngau nhien lan at
 * ca muc tang that.
 *
 * @returns {{g_moi_ngay:number, so_ngay:number, tu:string, den:string}|null}
 */
function tocDoLon(pondId) {
    const ds = (db.sampleList(pondId) || [])
        .filter(s => Number(s.avg_weight_g) > 0)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

    if (ds.length < 2) return null;

    const cuoi = ds[ds.length - 1];
    // Tim lan chai xa nhat nhung khong qua 60 ngay truoc lan cuoi
    const mocCu = Date.parse(cuoi.created_at) - 60 * 86400000;
    const dau = ds.find(s => Date.parse(s.created_at) >= mocCu) || ds[0];

    const soNgay = (Date.parse(cuoi.created_at) - Date.parse(dau.created_at)) / 86400000;
    if (!(soNgay >= 1)) return null;                 // hai lan qua gan nhau

    const tang = Number(cuoi.avg_weight_g) - Number(dau.avg_weight_g);
    if (!(tang > 0)) return null;                    // khong lon, hoac can sai

    return {
        g_moi_ngay: Math.round((tang / soNgay) * 1000) / 1000,
        so_ngay: Math.round(soNgay),
        tu: dau.created_at,
        den: cuoi.created_at,
        w_dau: dau.avg_weight_g,
        w_cuoi: cuoi.avg_weight_g,
    };
}

/**
 * Bang gia cua dung loai tom trong ao, chi lay hang thuong pham co size,
 * sap theo size tang dan (tom to -> tom nho).
 */
function bangGia(snapshot, loai) {
    return (snapshot.items || [])
        .filter(i => i.species === loai && !i.is_seed && i.unit === 'đ/kg'
            && Number.isFinite(i.size) && Number.isFinite(i.price) && i.price > 0)
        .sort((a, b) => a.size - b.size);
}

/**
 * ================================================================
 * PHAN TICH: NEN BAN NGAY HAY NUOI THEM?
 * ================================================================
 * @param {object} pond      dong trong bang ponds
 * @param {object} snapshot  ket qua market.snapshot()
 * @param {number} giaCamKg  gia 1 kg cam (dong). Khong biet thi truyen null.
 */
function phanTich(pond, snapshot, giaCamKg = null) {
    const thieu = [];
    const pondId = pond.pond_id;

    const f = db.feedGet(pondId) || {};
    const loai = kb.chuanHoaLoai(pond.seed_type) || 'the';
    const tenLoai = kb.loaiTom(loai).ten;

    // ---- 1. Tom dang co bao nhieu ----
    const wHienTai = Number(f.avg_weight_g) || null;
    if (!wHienTai) thieu.push('trọng lượng trung bình (chài mẫu)');

    const sizeHienTai = sizeTuTrongLuong(wHienTai);

    // ---- 2. Sinh khoi ----
    const khauPhan = feed.tinhKhauPhan({
        seedCount: f.seed_count || pond.seed_count,
        survivalPct: f.survival_pct,
        avgWeightG: wHienTai,
    }, {});
    if (!khauPhan.ok) {
        for (const m of khauPhan.missing || []) if (!thieu.includes(m)) thieu.push(m);
    }
    const sinhKhoiKg = khauPhan.ok ? khauPhan.sinhKhoiKg : null;

    // ---- 3. Toc do lon ----
    const toc = tocDoLon(pondId);
    if (!toc) thieu.push('tốc độ lớn (cần ít nhất hai lần chài mẫu cách nhau vài ngày)');

    // ---- 4. Gia thi truong ----
    const bang = bangGia(snapshot, loai);
    if (bang.length < 2) thieu.push('bảng giá thị trường của ' + tenLoai.toLowerCase());

    if (thieu.length) {
        return { ok: false, loai, ten_loai: tenLoai, size_hien_tai: sizeHienTai, thieu };
    }

    // ---- Tim moc size KE TIEP (tom to hon = so size nho hon) ----
    // Chi xet cac moc THAT SU to hon tom hien tai.
    const mocTo = bang.filter(i => i.size < sizeHienTai);
    if (!mocTo.length) {
        return {
            ok: false,
            loai, ten_loai: tenLoai, size_hien_tai: Math.round(sizeHienTai),
            thieu: [],
            ket_luan: 'Tôm đã đạt cỡ lớn nhất trong bảng giá — nuôi thêm không lên được bậc giá nào nữa.',
        };
    }

    // Moc gan nhat phia tren = size lon nhat trong nhom nho hon size hien tai
    const moc = mocTo[mocTo.length - 1];

    // Gia HIEN TAI: lay moc size gan nhat phia duoi (tom nho hon hoac bang)
    const mocNho = bang.filter(i => i.size >= sizeHienTai);
    const giaHienTai = mocNho.length ? mocNho[0] : bang[bang.length - 1];

    // ---- So ngay can de len size do ----
    const wMucTieu = trongLuongTuSize(moc.size);
    const soNgay = Math.ceil((wMucTieu - wHienTai) / toc.g_moi_ngay);

    if (!(soNgay > 0)) {
        return {
            ok: false, loai, ten_loai: tenLoai, size_hien_tai: Math.round(sizeHienTai), thieu: [],
            ket_luan: 'Tôm đã qua mốc size này rồi.',
        };
    }

    // ---- Sinh khoi luc thu hoach ----
    // Tom lon len thi sinh khoi tang theo, khong phai giu nguyen.
    const soTom = khauPhan.soTom;
    const sinhKhoiSau = Math.round((soTom * wMucTieu / 1000) * 10) / 10;

    // ---- Tien ----
    const doanhThuNay = Math.round(sinhKhoiKg * giaHienTai.price);
    const doanhThuSau = Math.round(sinhKhoiSau * moc.price);

    // ---- Chi phi cam cho nhung ngay nuoi them ----
    // Khau phan tinh theo sinh khoi TRUNG BINH cua giai doan.
    let chiPhiCam = null;
    let camKg = null;
    if (giaCamKg > 0) {
        const sinhKhoiTB = (sinhKhoiKg + sinhKhoiSau) / 2;
        const tyLe = khauPhan.ratePct;                       // % trong luong than / ngay
        camKg = Math.round((sinhKhoiTB * tyLe / 100) * soNgay * 10) / 10;
        chiPhiCam = Math.round(camKg * giaCamKg);
    }

    const chenhLech = doanhThuSau - doanhThuNay;
    const loiRong = chiPhiCam === null ? null : chenhLech - chiPhiCam;

    const ngayDuKien = new Date(Date.now() + soNgay * 86400000).toISOString().slice(0, 10);

    return {
        ok: true,
        loai, ten_loai: tenLoai,

        size_hien_tai: Math.round(sizeHienTai),
        w_hien_tai_g: wHienTai,
        size_muc_tieu: moc.size,
        w_muc_tieu_g: Math.round(wMucTieu * 100) / 100,

        gia_hien_tai: giaHienTai.price,
        gia_hien_tai_size: giaHienTai.size,
        gia_muc_tieu: moc.price,
        chenh_gia_kg: moc.price - giaHienTai.price,

        toc_do_lon_g_ngay: toc.g_moi_ngay,
        toc_do_do_tu: toc,
        so_ngay_nuoi_them: soNgay,
        ngay_du_kien: ngayDuKien,

        sinh_khoi_kg: sinhKhoiKg,
        sinh_khoi_sau_kg: sinhKhoiSau,
        doanh_thu_nay: doanhThuNay,
        doanh_thu_sau: doanhThuSau,
        chenh_lech: chenhLech,

        cam_them_kg: camKg,
        gia_cam_kg: giaCamKg,
        chi_phi_cam: chiPhiCam,
        loi_rong: loiRong,

        // Khong co gia cam thi KHONG ket luan nen giu hay ban - vi con
        // thieu mot ve cua phep tinh. Noi ro de nguoi dung tu nhap gia cam.
        khuyen_nghi: loiRong === null
            ? null
            : (loiRong > 0 ? 'giu_lai' : 'ban_ngay'),
        ly_do: loiRong === null
            ? 'Chưa biết giá cám nên chưa tính được lời ròng. Nhập giá cám để có khuyến nghị.'
            : (loiRong > 0
                ? `Nuôi thêm ${soNgay} ngày ước lời thêm khoảng ${loiRong.toLocaleString('vi-VN')} đ `
                  + 'sau khi trừ tiền cám.'
                : `Nuôi thêm ${soNgay} ngày thì tiền cám ăn hết phần chênh giá — bán bây giờ gọn hơn.`),

        luu_y: 'Đây là ước tính từ tốc độ lớn đo được và giá hôm nay. Giá tôm đổi từng ngày, '
            + 'và tôm còn rủi ro dịch bệnh trong những ngày nuôi thêm. Con số này để tham khảo, '
            + 'không thay được quyết định của người nuôi.',
    };
}

/**
 * Cac ao da bam "giu lai nuoi tiep" va DA TOI NGAY du kien.
 * Dung cho phan nhac viec tren giao dien.
 */
function nhacToiHan(userId) {
    const homNay = new Date().toISOString().slice(0, 10);
    const ra = [];

    for (const kh of db.harvestPlanAll() || []) {
        if (kh.da_nhac) continue;
        if (!kh.ngay_du_kien || kh.ngay_du_kien > homNay) continue;

        const pond = db.pondGet(kh.pond_id);
        if (!pond || pond.user_id !== userId) continue;

        ra.push({
            pond_id: kh.pond_id,
            pond_name: pond.name,
            ngay_du_kien: kh.ngay_du_kien,
            size_muc_tieu: kh.size_muc_tieu,
            loi_lai_uoc: kh.loi_lai_uoc,
            // Khong them chu "Ao" o dau: ten ao nguoi dung dat thuong da co
            // san chu do roi -> "Ao Ao so 1".
            noi_dung: `${pond.name} đã tới ngày dự kiến đạt size ${kh.size_muc_tieu} con/kg. `
                + 'Chài mẫu lại để kiểm tra rồi tính chuyện thu hoạch.',
        });
    }
    return ra;
}

module.exports = { phanTich, tocDoLon, nhacToiHan, sizeTuTrongLuong, trongLuongTuSize };
