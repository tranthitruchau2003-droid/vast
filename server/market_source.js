// ================================================================
// market_source.js - CAC NGUON LAY GIA TOM
//
// KHONG CAN npm install. Chi dung fetch() co san cua Node 18+.
//
// VI SAO PHAI LAM THE NAY:
//   Viet Nam hien KHONG co API gia tom chinh thuc, mien phi, on dinh.
//   Vi vay module nay thiet ke theo kieu "nhieu nguon co the thay the":
//
//     1) tepbac   - doc bang gia cong khai tren tepbac.com (cap nhat hang ngay)
//     2) json     - goi 1 API JSON bat ky (khi ban mua duoc dich vu gia,
//                   hoac tu dung 1 server gia rieng) -> chi can khai bao URL
//     3) manual   - gia do chinh ban / thuong lai nhap tay (uu tien cao nhat)
//
//   Neu tepbac doi giao dien -> parser co the doc hut. Luc do he thong
//   VAN CHAY: no giu lai gia cu trong database va danh dau "stale",
//   dong thoi ban co the nhap tay de dam bao so lieu dung.
//
// LUU Y PHAP LY: truoc khi dung lau dai, nen xin phep / kiem tra dieu khoan
// su dung cua trang nguon. Doc 1 lan/gio la rat nhe, khong gay tai.
// ================================================================

'use strict';

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0 Safari/537.36 VAST-Farm/1.0';

// ----------------------------------------------------------------
// TIEN ICH XU LY HTML (khong dung thu vien ngoai)
// ----------------------------------------------------------------

const ENTITIES = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'", '&apos;': "'", '&ndash;': '-', '&mdash;': '-',
};

/** Bo the HTML, giai ma ky tu dac biet, gom khoang trang. */
function text(html) {
    if (!html) return '';
    let s = String(html)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, ' ');
    s = s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
    s = s.replace(/&[a-zA-Z#0-9]+;/g, m => (ENTITIES[m] !== undefined ? ENTITIES[m] : ' '));
    return s.replace(/\s+/g, ' ').trim();
}

/**
 * Doc mot so tien kieu Viet Nam.
 *   "220,000" -> 220000      "220.000" -> 220000
 *   "1.415.000" -> 1415000   "150" -> 150
 *   "1,4" -> 1.4             "1.4" -> 1.4
 * Tra null neu khong phai so.
 */
function parseMoney(s) {
    if (s === null || s === undefined) return null;

    // LOI DA TUNG XAY RA: o "189 49 ngay" (gia 189 dinh lien o tuoi 49 ngay)
    // bi xoa het chu roi ghep thanh "18949" -> gia tom giong 189 d/con
    // hien thanh 18.949 d/con. Khoang trang KHONG phai dau phan cach hang
    // nghin -> co 2 cum so roi nhau thi tra ve null, de ben goi doc cach khac.
    const raw = String(s).trim();
    const cum = raw.match(/-?\d[\d.,]*/g);
    if (cum && cum.length > 1) return null;

    let t = String(s).replace(/[^\d.,-]/g, '').trim();
    if (!t) return null;

    // Dang co dau phan cach hang nghin: 220,000 / 1.415.000 / 1,415,000
    if (/^-?\d{1,3}([.,]\d{3})+$/.test(t)) {
        return Number(t.replace(/[.,]/g, ''));
    }
    // Dang thap phan: 1,4 hoac 1.4
    if (/^-?\d+[.,]\d{1,2}$/.test(t)) {
        return Number(t.replace(',', '.'));
    }
    // So nguyen thuan
    if (/^-?\d+$/.test(t)) return Number(t);

    return null;
}

/** Lay tat ca <tr>...</tr> trong 1 doan HTML. */
function rowsOf(html) {
    return html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
}

/** Lay noi dung tung o <td>/<th> cua 1 hang. */
function cellsOf(rowHtml) {
    const out = [];
    const re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let m;
    while ((m = re.exec(rowHtml)) !== null) out.push(m[1]);
    return out;
}

// ----------------------------------------------------------------
// PHAN LOAI TEN SAN PHAM -> loai tom + size
// ----------------------------------------------------------------

function classify(name, code) {
    const n = (name || '').toLowerCase();
    const c = (code || '').toUpperCase();

    let species = 'other';
    let species_label = 'Tôm khác';

    if (n.includes('càng xanh') || n.includes('cang xanh') || /^TCX/.test(c)) {
        // Xet TRUOC tom the/su: ten "Tom cang xanh giong" khong duoc lot
        // vao nhom khac chi vi co chu "giong".
        species = 'cang_xanh';
        species_label = 'Tôm càng xanh';
    } else if (n.includes('thẻ') || n.includes('the chan trang') || /^THE/.test(c)) {
        species = 'the';
        species_label = 'Tôm thẻ chân trắng';
    } else if (n.includes('sú') || n.includes('tom su') || /^SU/.test(c)) {
        species = 'su';
        species_label = 'Tôm sú';
    } else if (n.includes('hùm') || /^HUM/.test(c)) {
        species = 'hum';
        species_label = 'Tôm hùm';
    }

    // Size: "(30 con/kg)" hoac "loai 20 con" hoac ma "THE30"
    let size = null;

    // Dang khoang "loai 6-15 con/kg" -> lay dau LON (15) lam moc,
    // vi do la so con/kg cao nhat cua loai do.
    let m = n.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})\s*con/);
    if (m) {
        size = parseInt(m[2], 10);
    } else {
        m = n.match(/(\d{1,3})\s*con\s*\/?\s*kg/);
        if (!m) m = n.match(/loại\s*(\d{1,3})\s*con/);
        if (!m) m = n.match(/\((\d{1,3})\s*con/);
        if (m) size = parseInt(m[1], 10);
    }
    if (size === null) {
        const mc = c.match(/^(?:THE|SU)(\d{1,3})$/);
        if (mc) size = parseInt(mc[1], 10);
    }

    // Tom giong (post larvae) - ban theo con, khong phai size con/kg
    const isSeed = /post|\bp1[0-9]\b|giống|pl\d/.test(n) || /P\d{1,2}$/.test(c);

    return { species, species_label, size, isSeed };
}

/**
 * Doc cot "Cap nhat" cua trang nguon: "hom nay", "4 ngay truoc", "38 ngay"...
 * Tra ve so NGAY ke tu lan trang nguon cap nhat dong do.
 *
 * VI SAO QUAN TRONG: khong phai dong nao tren trang cung moi. Vi du gia
 * tom cang xanh co the da 38 ngay chua doi, trong khi tom the cap nhat
 * hom nay. Hai con so do KHONG the tin ngang nhau - phai hien ro cho
 * nguoi nuoi biet dong nao cu.
 */
function docTuoiDuLieu(txt) {
    const t = String(txt || '').toLowerCase();

    if (/hôm nay|hom nay|vừa xong|vua xong/.test(t)) return 0;
    if (/hôm qua|hom qua/.test(t)) return 1;

    let m = t.match(/(\d+)\s*(?:phút|phut|giờ|gio)/);
    if (m) return 0;                                   // trong ngay

    m = t.match(/(\d+)\s*ngày|(\d+)\s*ngay/);
    if (m) return parseInt(m[1] || m[2], 10);

    m = t.match(/(\d+)\s*(?:tuần|tuan)/);
    if (m) return parseInt(m[1], 10) * 7;

    m = t.match(/(\d+)\s*(?:tháng|thang)/);
    if (m) return parseInt(m[1], 10) * 30;

    return null;                                        // khong doc duoc
}

/** Doan chieu tang/giam tu HTML tho cua hang (mau sac / mui ten). */
function guessDirection(rowHtml, changePct) {
    const h = rowHtml.toLowerCase();
    if (/▲|&#9650;|caret-up|fa-up|arrow-up|text-success|green|tang|increase|\bup\b/.test(h)) return 1;
    if (/▼|&#9660;|caret-down|fa-down|arrow-down|text-danger|red|giam|decrease|\bdown\b/.test(h)) return -1;
    if (typeof changePct === 'number' && changePct !== 0) return changePct > 0 ? 1 : -1;
    return 0;
}

// ================================================================
// NGUON 1: TEPBAC  (https://tepbac.com/gia-thuy-san/gia/tom)
// ----------------------------------------------------------------
// Parser viet theo kieu "chiu duoc thay doi":
//   - Khong bam vao class/id cu the (nhung thu de bi doi nhat)
//   - Quet MOI hang cua MOI bang, hang nao co "tôm" + 1 con so gia
//     thi lay. Bang co them/bot cot van chay duoc.
// ================================================================

/**
 * Doi tuoi cua 1 dong ("38 ngay truoc") thanh ngay that cua dong do.
 * @param {string|null} ngayTrang  ngay in o dau trang (YYYY-MM-DD)
 * @param {number|null} tuoiNgay   dong nay cu bao nhieu ngay
 * @returns {string|null} YYYY-MM-DD
 */
function ngayCuaDong(ngayTrang, tuoiNgay) {
    if (!Number.isFinite(tuoiNgay)) return ngayTrang;
    // Moc de tru lui: ngay tren trang neu doc duoc, khong thi lay hom nay
    const moc = ngayTrang ? Date.parse(ngayTrang + 'T00:00:00Z') : Date.now();
    if (!Number.isFinite(moc)) return ngayTrang;
    const d = new Date(moc - tuoiNgay * 86400000);
    return d.toISOString().slice(0, 10);
}

/**
 * Cat cum chi tuoi ("38 ngay", "hom nay", "3 thang") ra khoi chuoi.
 * Tra ve { con, tuoi, tuoiText }.
 *
 * Can ham nay vi trang nguon co dong gop GIA va TUOI vao cung 1 o:
 *   "380.000 đ/KG 38 ngày"   "150 49 ngày"
 * Neu khong tach, o do bi coi la o tuoi va ca dong gia bi bo.
 */
function tachTuoi(txt) {
    const t = String(txt || '');
    const re = /(hôm nay|hôm qua|\d+\s*(?:phút|giờ|ngày|tuần|tháng|năm))(\s*trước)?/i;
    const m = t.match(re);
    if (!m) return { con: t, tuoi: null, tuoiText: null };
    const tuoi = docTuoiDuLieu(m[0]);
    return { con: (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(),
             tuoi, tuoiText: m[0].trim() };
}

/**
 * Doc % thay doi tu 1 o. PHAI cat lay dung cum sat dau %, khong duoc
 * dua ca o vao parseMoney.
 *
 * O % tren trang nguon co dang: "▼  3.8%  3 tháng" - co TOI 2 cum so.
 * parseMoney (da duoc siet lai de khong ghep 2 so roi nhau) se tra ve
 * null cho ca o nay -> moi dong deu hien "Khong doi" du trang co ghi %.
 */
function docPhanTram(txt) {
    const m = String(txt || '').match(/(-?\d+(?:[.,]\d+)?)\s*%/);
    if (!m) return null;
    const v = Number(m[1].replace(',', '.'));
    return Number.isFinite(v) ? v : null;
}

/**
 * Doc KY HAN cua con so % ("3 tháng", "1 tuần", "30 ngày").
 *
 * QUAN TRONG: trang nguon ghi % kem ky han - "▲ 9.1% (3 tháng)" nghia la
 * tang 9,1% SO VOI 3 THANG TRUOC, khong phai so voi hom qua. Neu chi hien
 * mui ten do/xanh ma khong noi ky han, nguoi nuoi se tuong gia dang bien
 * dong hom nay va chot ban sai.
 *
 * @returns {string|null} vi du "3 tháng"
 */
function docKyHan(txt) {
    const t = String(txt || '');
    const sau = t.slice(t.indexOf('%') + 1);          // chi xet phan SAU dau %
    const m = sau.match(/(\d+)\s*(phút|giờ|ngày|tuần|tháng|năm)/i);
    return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
}

/**
 * Boc MA mat hang ra khoi o ten. Trang nguon in ma theo 2 kieu:
 *   "TCX10 Tôm càng xanh loại 6-15 con/kg"       -> ma o dau
 *   "Thức ăn cá tra TATRA Thức ăn cá tra"        -> ten lap lai, ma o giua
 *
 * Phai boc ra: neu khong, khoa cua muc sinh tu ca cau ten - trang doi ten
 * mot chu la thanh muc moi, mat sach lich su gia de tinh % tang giam.
 *
 * @returns {{code: string|null, ten: string}}
 */
function bocMa(name) {
    const t = String(name || '').replace(/\s+/g, ' ').trim();

    // Kieu 2 truoc: ten ... MA ... ten (chinh xac hon, it doan)
    const giua = t.match(/^(.{3,}?)\s+([A-Z][A-Z0-9_]{1,11})\s+\1$/i);
    if (giua && /^[A-Z0-9_]+$/.test(giua[2])) {
        return { code: giua[2], ten: giua[1].trim() };
    }

    // Kieu 1: ma o dau
    const dau = t.match(/^([A-Z][A-Z0-9_]{1,11})\s+(.{3,})$/);
    if (dau && /[a-zà-ỹ]/.test(dau[2])) {
        return { code: dau[1], ten: dau[2].trim() };
    }

    // Ten in 2 lan nhung khong co ma o giua
    const nua = t.match(/^(.{4,}?)\s+\1$/i);
    if (nua) return { code: null, ten: nua[1].trim() };

    // Kieu 3: ma o CUOI - "Trứng bào xác artemia ARTE"
    const cuoi = t.match(/^(.{3,}?)\s+([A-Z][A-Z0-9_]{2,11})$/);
    if (cuoi && /[a-zà-ỹ]/.test(cuoi[1])) {
        return { code: cuoi[2], ten: cuoi[1].trim() };
    }

    return { code: null, ten: t };
}

/** "380000" -> "380.000", de tim lai o nao dang chua gia. */
function m0(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Doc GIA va DON VI tu ca dong chu, theo dung cach trang nguon in ra:
 *   "380.000 đ/KG"   "120 đ/CON"   "1.415.000 đ/KG"
 *
 * Cach nay chac chan hon kieu cu ("lay so lon nhat trong hang"), vi hang
 * nao cung co san may so khac de lan: tuoi du lieu (38 ngay), % thay doi,
 * size (20 con/kg) trong chinh ten mat hang.
 */
function docGiaVaDonVi(rowTxt) {
    // Bo phan "(20 con/kg)" trong TEN mat hang, khong thi "20" bi doc thanh gia
    let t = rowTxt.replace(/\(\s*\d+\s*con\s*\/\s*kg\s*\)/gi, ' ');
    // Bo luon cum tuoi, khong thi "38 ngay" dinh vao gia
    t = tachTuoi(t).con;

    const m = t.match(/(\d[\d.,]*)\s*(?:đ|d|vnđ|đồng)\s*\/\s*(kg|kilogram|ký|con|lít|lit|bao|chai|gói|goi|tấn|tan)/i);
    if (m) {
        const gia = parseMoney(m[1]);
        if (gia !== null) return { price: gia, unit: chuanDonVi(m[2]), chacChan: true };
    }
    return null;
}

/** Ve dung 1 cach viet don vi, de sau nay so sanh va hien thi khong loan. */
function chuanDonVi(dv) {
    const d = String(dv || '').toLowerCase();
    if (/con/.test(d)) return 'đ/con';
    if (/l[íi]t|^l$/.test(d)) return 'đ/lít';
    if (/bao/.test(d)) return 'đ/bao';
    if (/chai/.test(d)) return 'đ/chai';
    if (/g[óo]i/.test(d)) return 'đ/gói';
    if (/t[ấa]n/.test(d)) return 'đ/tấn';
    return 'đ/kg';
}

/**
 * Gia doc ve co hop ly voi don vi khong.
 * Chan dung loai loi vua gap: 38 d/kg (thuc ra la "38 ngay"),
 * 18.949 d/con (thuc ra la 189 d/con ghep voi 49 ngay).
 */
function giaHopLy(price, unit) {
    if (!Number.isFinite(price) || price <= 0) return false;
    if (unit === 'đ/con') return price >= 5 && price <= 5000;      // tom giong: vai chuc den vai tram d/con
    return price >= 5000;                                          // tom thuong pham: it nhat vai nghin d/kg
}

function parseTepbac(html, sourceUrl) {
    const clean = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');

    // Ngay cap nhat hien tren trang: "21/08/2026"
    let source_date = null;
    const md = text(clean).match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);
    if (md) source_date = `${md[3]}-${md[2].padStart(2, '0')}-${md[1].padStart(2, '0')}`;

    // Khu vuc: "Toàn quốc", "Cà Mau", ...
    let region = 'Toàn quốc';
    const mr = text(clean).match(/Khu vực[:\s]+([^|.\n]{2,30})/i);
    if (mr) region = mr[1].trim();

    const items = [];
    const seen = new Set();
    const boQua = [];   // dong bi loai vi so vo ly - se bao ra, khong im lang

    for (const row of rowsOf(clean)) {
        const cells = cellsOf(row).map(c => ({ raw: c, txt: text(c) }));
        if (cells.length < 2) continue;

        // 1) O TEN: o dai nhat co chua chu "tôm"
        let nameCell = null;
        for (const c of cells) {
            if (/tôm|tom /i.test(c.txt) && c.txt.length >= 4) {
                if (!nameCell || c.txt.length > nameCell.txt.length) nameCell = c;
            }
        }
        if (!nameCell) continue;
        const name = nameCell.txt.replace(/\s*\|\s*$/, '').trim();
        if (name.length > 120) continue;             // gan nhu chac chan la doan van, khong phai ten

        // 2) O MA: chuoi in hoa ngan (SU20, THE30, SUP12...)
        let code = null;
        for (const c of cells) {
            if (c === nameCell) continue;
            if (/^[A-Z]{2,6}\d{0,3}$/.test(c.txt)) { code = c.txt; break; }
        }
        // Trang gop ma vao dau o ten: "TCX10 Tôm càng xanh loại 6-15 con/kg".
        // Phai boc ma ra, khong thi khoa cua muc bi sinh tu ca cau ten -
        // ten doi mot chu la thanh muc moi, mat sach lich su gia cu.
        let tenSach = name;
        {
            const b = bocMa(name);
            if (!code && b.code) code = b.code;
            tenSach = b.ten;
        }

        // 3+4) GIA VA DON VI
        const rowTxt = text(row);
        let price = null, unit = 'đ/kg', priceCell = null;

        // Cach 1 (chac chan): doc dung chuoi "380.000 đ/KG" tren ca dong
        const g = docGiaVaDonVi(rowTxt);
        if (g) {
            price = g.price;
            unit = g.unit;
            // Danh dau o nao chua gia de buoc 5 khong nham no la o tuoi
            priceCell = cells.find(c => c !== nameCell && c.txt.includes(String(m0(g.price)))) || null;
        }

        // Cach 2 (du phong): khong thay chuoi don vi thi moi quay ve
        // kieu cu - nhung PHAI bo qua o tuoi du lieu va o %.
        if (price === null) {
            if (/đ\s*\/\s*con|đồng\s*\/\s*con|\/\s*con/i.test(rowTxt)) unit = 'đ/con';
            for (const c of cells) {
                if (c === nameCell) continue;
                if (c.txt.includes('%')) continue;            // o % thay doi
                // Tach cum tuoi ra: o "150 49 ngay" van con gia 150 dung sau day
                const con = tachTuoi(c.txt).con;
                if (!con) continue;                           // o chi co moi tuoi
                const v = parseMoney(con);
                if (v !== null && v >= 10 && (price === null || v > price)) {
                    price = v; priceCell = c;
                }
            }
        }
        if (price === null) continue;

        const cls = classify(tenSach, code);

        // TOM GIONG LUON tinh theo CON, khong bao gio theo kg.
        // Khi trang gop o ("150 49 ngày") thi khong con chuoi "đ/CON" de doc,
        // luc do phai dua vao chinh mat hang ma suy ra don vi - neu khong
        // gia 150 d/con se bi cham la vo ly roi bo mat ca dong.
        if (cls.isSeed && !(g && g.chacChan)) unit = 'đ/con';

        // CHAN SO VO LY: tha bo dong con hon in ra gia sai.
        if (!giaHopLy(price, unit)) {
            boQua.push({ name: tenSach, price, unit, ly_do: 'giá không hợp lý với đơn vị' });
            continue;
        }

        // 5) CO CAP NHAT LUC NAO KHONG
        let tuoiNgay = null;
        let capNhatText = null;
        for (const c of cells) {
            if (c === nameCell) continue;
            // BO QUA O %: cum thoi gian trong o do ("▲ 9,1% (3 tháng)") la
            // KY HAN cua con so %, KHONG phai tuoi cua du lieu. Doc nham thi
            // dong cap nhat 16 ngay truoc bi bao thanh 90 ngay.
            if (c.txt.includes('%')) continue;
            // Quet CA o gia: trang hay gop "380.000 đ/KG 38 ngày" vao 1 o,
            // bo qua o gia thi mat luon tuoi du lieu cua dong do.
            const tt = tachTuoi(c.txt);
            if (tt.tuoi !== null) { tuoiNgay = tt.tuoi; capNhatText = tt.tuoiText; break; }
        }

        // 6) % THAY DOI
        let change_pct = null;
        let change_period = null;
        for (const c of cells) {
            if (!c.txt.includes('%')) continue;
            const v = docPhanTram(c.txt);
            if (v !== null) { change_pct = v; change_period = docKyHan(c.txt); break; }
        }
        if (change_pct !== null) {
            const dir = guessDirection(row, change_pct);
            change_pct = Math.abs(change_pct) * (dir === 0 ? 1 : dir);
        }

        // Khoa duy nhat: uu tien ma cua nguon, khong co thi tu sinh tu ten
        const key = code || slug(tenSach);
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({
            code: key,
            name: tenSach,
            species: cls.species,
            species_label: cls.species_label,
            size: cls.isSeed ? null : cls.size,
            size_label: cls.isSeed
                ? 'Tôm giống'
                : (cls.size ? `Size ${cls.size} con/kg` : tenSach),
            is_seed: cls.isSeed ? 1 : 0,
            price,
            unit,
            change_pct,
            // Ky han cua con so % ("3 tháng"). Bat buoc phai hien ra,
            // khong thi nguoi dung tuong day la thay doi trong ngay.
            change_period,
            region,
            source: 'tepbac',
            source_url: sourceUrl,
            // NGAY CUA CHINH DONG NAY, khong phai ngay in tren dau trang.
            // Trang nguon in 1 ngay chung o dau trang, nhung tung dong lai
            // co tuoi rieng ("hom nay", "38 ngay truoc"). Neu dung ngay
            // chung cho moi dong thi gia tom cang xanh cu 38 ngay se bi
            // ghi vao lich su nhu gia HOM NAY -> bieu do sai.
            source_date: ngayCuaDong(source_date, tuoiNgay),
            // Dong nay tren trang nguon da cu bao nhieu ngay
            source_age_days: tuoiNgay,
            source_updated_text: capNhatText,
        });
    }

    // KHONG im lang khi bo dong: neu trang doi cau truc lam gia doc ra vo ly
    // thi phai co dau vet trong log de con biet duong ma sua.
    if (boQua.length) {
        console.warn('[THI TRUONG] Bỏ qua ' + boQua.length + ' dòng vì số liệu vô lý: '
            + boQua.map(b => `${b.name}=${b.price}${b.unit}`).join(', '));
    }
    Object.defineProperty(items, 'boQua', { value: boQua, enumerable: false });
    return items;
}

// ----------------------------------------------------------------
// CHIEN LUOC 2: TRANG KHONG DUNG <table>
// ----------------------------------------------------------------
// Nhieu trang doi sang bo cuc <div>/<li>. Luc do khong con <tr> de quet.
// Cach nay doc THANG tu chuoi chu cua trang:
//     "Tôm thẻ (30 con/kg) tại ao ... 190,000 đ/kg"
// Kem chinh xac hon chien luoc bang, nhung cuu duoc truong hop trang doi giao dien.
// ----------------------------------------------------------------
function parseLoose(html, sourceUrl) {
    const flat = text(
        html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    );

    const items = [];
    const seen = new Set();

    // "<ten co chu tom> ... <so> d/kg"  hoac  "... <so> d/con"
    const re = /(T[ôo]m[^.|]{0,60}?)\s*[–—:-]?\s*([\d]{1,3}(?:[.,]\d{3})+|\d{2,7})\s*(?:đ|VNĐ|đồng)\s*\/\s*(kg|con)/gi;
    let m;
    while ((m = re.exec(flat)) !== null) {
        const name = m[1].trim().replace(/\s+/g, ' ');
        const price = parseMoney(m[2]);
        const unit = m[3].toLowerCase() === 'con' ? 'đ/con' : 'đ/kg';
        if (!Number.isFinite(price) || price < 10) continue;

        const cls = classify(name, null);
        const key = slug(name);
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({
            code: key, name,
            species: cls.species, species_label: cls.species_label,
            size: cls.isSeed ? null : cls.size,
            size_label: cls.isSeed ? 'Tôm giống' : (cls.size ? `Size ${cls.size} con/kg` : name),
            is_seed: cls.isSeed ? 1 : 0,
            price, unit, change_pct: null,
            region: 'Toàn quốc',
            source: 'tepbac-loose', source_url: sourceUrl, source_date: null,
        });
    }
    return items;
}

/** Sinh ma ngan gon tu ten tieng Viet (bo dau). */
function slug(s) {
    return String(s)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toUpperCase().replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '').slice(0, 40);
}

// ================================================================
// NGUON 2: API JSON TUY Y
// ----------------------------------------------------------------
// Dung khi ban co API gia rieng (mua dich vu, hoac server cua hiep hoi).
// Chi can API tra ve mang cac doi tuong, moi doi tuong co it nhat:
//     { name, price }   va tuy chon { code, size, unit, species, region }
// Khai bao trong server/config.json:
//     "market": { "provider": "json", "jsonUrl": "https://.../gia-tom" }
// ================================================================

function parseJsonSource(data, sourceUrl) {
    const arr = Array.isArray(data) ? data
        : Array.isArray(data && data.items) ? data.items
            : Array.isArray(data && data.data) ? data.data
                : [];

    return arr.map(o => {
        const name = String(o.name || o.ten || o.product || '').trim();
        const code = String(o.code || o.ma || slug(name)).toUpperCase();
        const cls = classify(name, code);
        const size = o.size !== undefined && o.size !== null ? Number(o.size) : cls.size;
        return {
            code,
            name,
            species: o.species || cls.species,
            species_label: o.species_label || cls.species_label,
            size: Number.isFinite(size) ? size : null,
            size_label: size ? `Size ${size} con/kg` : name,
            is_seed: cls.isSeed ? 1 : 0,
            price: parseMoney(o.price ?? o.gia),
            unit: o.unit || 'đ/kg',
            change_pct: o.change_pct !== undefined ? Number(o.change_pct) : null,
            region: o.region || o.khu_vuc || 'Toàn quốc',
            source: 'json',
            source_url: sourceUrl,
            source_date: o.date || o.ngay || null,
        };
    }).filter(x => x.name && Number.isFinite(x.price) && x.price > 0);
}

// ================================================================
// TAI TRANG / GOI API
// ================================================================

async function httpGet(url, timeoutMs = 15000) {
    const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache',
        },
    });
    if (!res.ok) {
        // Doc luon phan body de con GHI RA FILE khi chan doan (--debug).
        // Bi chan (403) va bi doi giao dien la 2 loi khac han nhau,
        // nhin duoc body thi phan biet duoc ngay.
        let body = '';
        try { body = await res.text(); } catch { /* bo qua */ }
        const err = new Error(`HTTP ${res.status} khi tải ${url}`);
        err.status = res.status;
        err.body = body;
        throw err;
    }
    return res;
}

/**
 * Lay gia tu nguon da cau hinh.
 * @returns {Promise<{items:Array, source:string, url:string, rawLength:number}>}
 */
async function fetchPrices(marketCfg, opts = {}) {
    const provider = marketCfg.provider || 'tepbac';

    if (provider === 'json') {
        const url = marketCfg.jsonUrl;
        if (!url) throw new Error('Chưa khai báo market.jsonUrl trong config.json');
        const res = await httpGet(url, marketCfg.timeoutMs);
        const data = await res.json();
        const items = parseJsonSource(data, url);
        if (!items.length) throw new Error('API JSON trả về nhưng không đọc được mục nào');
        return { items, source: 'json', url, rawLength: 0 };
    }

    // Mac dinh: tepbac
    const urls = (marketCfg.tepbacUrls && marketCfg.tepbacUrls.length)
        ? marketCfg.tepbacUrls
        : ['https://tepbac.com/gia-thuy-san/gia/tom'];

    const all = [];
    const errors = [];
    let rawLength = 0;
    let usedUrl = urls[0];

    for (const url of urls) {
        try {
            const res = await httpGet(url, marketCfg.timeoutMs);
            const html = await res.text();
            rawLength += html.length;
            usedUrl = url;

            if (opts.debugFile) {
                try { require('fs').writeFileSync(opts.debugFile, html); } catch { /* bo qua */ }
            }

            let items = parseTepbac(html, url);
            if (!items.length) {
                // Bang khong doc duoc -> thu cach doc thang tu chu tren trang
                items = parseLoose(html, url);
                if (items.length) errors.push(`${url}: bảng đổi cấu trúc, đã dùng cách đọc dự phòng`);
            }
            for (const it of items) {
                if (!all.some(x => x.code === it.code)) all.push(it);
            }
        } catch (e) {
            errors.push(`${url}: ${e.message}`);
            if (opts.debugFile && e.body) {
                try { require('fs').writeFileSync(opts.debugFile, e.body); } catch { /* bo qua */ }
            }
        }
    }

    if (!all.length) {
        throw new Error(
            'Không đọc được mục giá nào. ' +
            (errors.length ? errors.join(' | ') : 'Trang nguồn có thể đã đổi cấu trúc bảng.')
        );
    }

    return { items: all, source: 'tepbac', url: usedUrl, rawLength };
}


// ================================================================
// GIA VAT TU (cam, voi, hoa chat) - trang rieng cua tepbac
//   https://tepbac.com/gia-thuy-san/gia/vat-tu
// Trang nay KHONG nam trong menu chinh cua tepbac nen de bi bo sot.
// Cau truc bang giong het trang gia tom, chi khac o cot ten:
// ten o day khong co chu "tom" (vi du "Voi nung CaO") nen phai co
// cach nhan o ten rieng.
// ================================================================

/**
 * Xep 1 muc vat tu vao nhom, va cho biet no danh cho tom hay cho ca.
 * Tra ve null neu khong nhan ra -> dong do bi BO, khong doan bua.
 */
function classifyVatTu(name) {
    const n = boDauThuong(name);

    // Cho ca hay cho tom? Nguoi dung nuoi tom, giao dien se loc bot do cho ca.
    //
    // PHAI doc chu "ca" CO DAU tren ten goc. Neu bo dau roi moi so thi
    // "Khoang tat Ca-Mg" (Ca = canxi) bi nham thanh thuc an cho CA.
    const gocThuong = String(name || '').toLowerCase();
    let loai_nuoi = 'chung';
    if (/\bcá\b|cá tra|cá basa|cá lóc|cá điêu hồng|cá rô|cá giống/.test(gocThuong)) loai_nuoi = 'ca';
    else if (/\btôm\b|tôm sú|tôm thẻ|tôm càng/.test(gocThuong) || /\btom\b/.test(n)) loai_nuoi = 'tom';

    let loai = null;
    if (/thuc an|thuc a n|artemia|trung bao xac|cam /.test(n)) loai = 'cam';
    else if (/voi|cao\b|dolomite|zeolite|yucca|chlorine|clorin|thuoc tim|kmno|men vi sinh|vi sinh|khoang|phan bon|hoa chat|xu ly|dap|edta|soda/.test(n)) loai = 'xu_ly';
    else if (/khang sinh|thuoc/.test(n)) loai = 'thuoc';

    if (!loai) return null;
    return { loai, loai_nuoi };
}

/** Bo dau tieng Viet + ve chu thuong, de so khop ten cho de. */
function boDauThuong(s) {
    return String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'd')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Doc bang gia vat tu. Dung lai y het bo doc cua trang gia tom
 * (rowsOf / cellsOf / parseMoney / docTuoiDuLieu) - chi khac cach
 * chon o ten va cach xep nhom.
 */
function parseVatTu(html, sourceUrl) {
    const clean = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');

    let source_date = null;
    const md = text(clean).match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/);
    if (md) source_date = `${md[3]}-${md[2].padStart(2, '0')}-${md[1].padStart(2, '0')}`;

    const items = [];
    const seen = new Set();

    for (const row of rowsOf(clean)) {
        const cells = cellsOf(row).map(c => ({ raw: c, txt: text(c) }));
        if (cells.length < 2) continue;

        // 1) O TEN: o dai nhat co chu, khong phai so, khong phai %,
        //    khong phai cau "15 ngay truoc", khong phai ma in hoa.
        let nameCell = null;
        for (const c of cells) {
            const t = c.txt.trim();
            if (t.length < 3 || t.length > 120) continue;
            if (t.includes('%')) continue;
            if (!/\p{L}{3}/u.test(t)) continue;              // phai co chu that
            if (parseMoney(t) !== null) continue;            // o nay la so tien
            if (docTuoiDuLieu(t) !== null) continue;         // o nay la "15 ngay truoc"
            if (/^[A-Z]{2,6}\d{0,3}$/.test(t)) continue;     // o nay la ma
            if (!nameCell || t.length > nameCell.txt.length) nameCell = c;
        }
        if (!nameCell) continue;
        const name = nameCell.txt.replace(/\s*\|\s*$/, '').trim();

        // 2) O MA
        let code = null;
        for (const c of cells) {
            if (c === nameCell) continue;
            if (/^[A-Z]{2,8}\d{0,4}$/.test(c.txt)) { code = c.txt; break; }
        }
        // Trang gop ma vao dau ten: "VOICAO Vôi nung CaO", "TATRA Thức ăn cá tra".
        // Boc ma ra, khong thi khoa cua muc sinh tu ca cau ten - ten doi
        // mot chu la thanh muc moi, mat sach gia cu de tinh % tang giam.
        let tenSach = name;
        {
            const b = bocMa(name);
            if (!code && b.code) code = b.code;
            tenSach = b.ten;
        }

        // 3+4) GIA VA DON VI - y het ben gia tom:
        // doc dung chuoi "3.000 đ/KG" tren ca dong, vi trang gop ca
        // gia lan tuoi du lieu vao chung 1 o ("3.000 đ/KG 15 ngày").
        const rowTxt = text(row);
        let price = null, unit = 'đ/kg', priceCell = null;

        const g = docGiaVaDonVi(rowTxt);
        if (g) {
            price = g.price;
            unit = g.unit;
            priceCell = cells.find(c => c !== nameCell && c.txt.includes(String(m0(g.price)))) || null;
        }
        if (price === null) {
            for (const c of cells) {
                if (c === nameCell) continue;
                if (c.txt.includes('%')) continue;
                const con = tachTuoi(c.txt).con;      // bo cum "15 ngay" ra truoc
                if (!con) continue;
                const v = parseMoney(con);
                if (v !== null && v >= 10 && (price === null || v > price)) { price = v; priceCell = c; }
            }
        }
        if (price === null) continue;

        // 5) TUOI DU LIEU - quet ca o gia, vi tuoi hay bi gop vao do
        let tuoiNgay = null, capNhatText = null;
        for (const c of cells) {
            if (c === nameCell) continue;
            if (c.txt.includes('%')) continue;   // ky han cua %, khong phai tuoi du lieu
            const tt = tachTuoi(c.txt);
            if (tt.tuoi !== null) { tuoiNgay = tt.tuoi; capNhatText = tt.tuoiText; break; }
        }

        // 6) % THAY DOI
        let change_pct = null;
        let change_period = null;
        for (const c of cells) {
            if (!c.txt.includes('%')) continue;
            const v = docPhanTram(c.txt);
            if (v !== null) { change_pct = v; change_period = docKyHan(c.txt); break; }
        }
        if (change_pct !== null) {
            const dir = guessDirection(row, change_pct);
            change_pct = Math.abs(change_pct) * (dir === 0 ? 1 : dir);
        }

        // CHAN DONG RAC: hang tieu de khong co ca tuoi lan %.
        // Thieu ca hai thi gan nhu chac chan khong phai hang gia.
        if (tuoiNgay === null && change_pct === null) continue;

        // KHONG DOAN BUA: khong xep duoc nhom thi bo hang do.
        const cls = classifyVatTu(tenSach);
        if (!cls) continue;

        const key = code || slug(tenSach);
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({
            code: key,
            name: tenSach,
            loai: cls.loai,
            loai_nuoi: cls.loai_nuoi,
            price,
            unit,
            change_pct,
            change_period,
            source: 'tepbac',
            source_url: sourceUrl,
            source_date: ngayCuaDong(source_date, tuoiNgay),
            source_age_days: tuoiNgay,
            source_updated_text: capNhatText,
        });
    }

    return items;
}

/**
 * Lay bang gia vat tu tu tepbac. Loi thi nem ra de ben goi tu quyet dinh
 * (gia tom van chay binh thuong, khong keo nhau chet).
 */
async function fetchSupplies(marketCfg = {}, opts = {}) {
    const urls = (marketCfg.tepbacSupplyUrls && marketCfg.tepbacSupplyUrls.length)
        ? marketCfg.tepbacSupplyUrls
        : ['https://tepbac.com/gia-thuy-san/gia/vat-tu'];

    const all = [];
    const errors = [];
    let usedUrl = urls[0];

    for (const url of urls) {
        try {
            const res = await httpGet(url, marketCfg.timeoutMs);
            const html = await res.text();
            usedUrl = url;
            if (opts.debugFile) {
                try { require('fs').writeFileSync(opts.debugFile, html); } catch { /* bo qua */ }
            }
            for (const it of parseVatTu(html, url)) {
                if (!all.some(x => x.code === it.code)) all.push(it);
            }
        } catch (e) {
            errors.push(`${url}: ${e.message}`);
            if (opts.debugFile && e.body) {
                try { require('fs').writeFileSync(opts.debugFile, e.body); } catch { /* bo qua */ }
            }
        }
    }

    if (!all.length) {
        throw new Error('Không đọc được mục vật tư nào. ' +
            (errors.length ? errors.join(' | ') : 'Trang nguồn có thể đã đổi cấu trúc bảng.'));
    }
    return { items: all, source: 'tepbac', url: usedUrl };
}

module.exports = {
    fetchPrices,
    fetchSupplies,
    // xuat ra de test rieng tung phan
    _internals: { text, parseMoney, rowsOf, cellsOf, classify, parseTepbac, parseLoose, parseJsonSource, slug, docTuoiDuLieu, ngayCuaDong, parseVatTu, classifyVatTu, bocMa, tachTuoi, docPhanTram, docKyHan },
};
