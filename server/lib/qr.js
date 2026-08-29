// ================================================================
// qr.js - TU SINH MA QR, KHONG CAN MANG VA KHONG CAN npm install
//
// ================================================================
// VI SAO PHAI TU VIET
// ----------------------------------------------------------------
// Truoc day dashboard.html lay anh QR tu api.qrserver.com:
//
//     <img src="https://api.qrserver.com/v1/create-qr-code/?data=...">
//
// Hai van de that:
//
//   1) MAT MANG LA MAT MA QR. Ao tom o vung sau, mang chap chon
//      hoac cat han. Dung luc thu hoach can in ma dan thung xop
//      thi khong co ma - tinh nang truy xuat nguon goc coi nhu
//      khong ton tai. Da xay ra that (anh chup cua nguoi dung).
//
//   2) LO DUONG DAN AO RA NGOAI. Moi lan mo hop thoai la dia chi
//      ao (ke ca IP LAN cua may chu) duoc gui sang may chu cua mot
//      cong ty khac. Khong can thiet.
//
// File nay sinh ma QR ngay tai may chu. Chi dung Javascript thuan,
// khong thu vien, dung dung tinh than cua ca du an.
//
// ================================================================
// PHAM VI
// ----------------------------------------------------------------
// - Che do BYTE (ma hoa UTF-8) - du cho moi duong dan http
// - Phien ban 1 den 10, tuc toi da 213 ky tu o muc sua loi M
//   (duong dan truy xuat cua VAST dai khoang 55 ky tu)
// - Xuat ra SVG: net o moi co in, khong vo hat nhu PNG phong to
//
// CHAY THU:  node qr.js --test
// ================================================================

'use strict';

// ================================================================
// 1. BANG THONG SO THEO PHIEN BAN
// ----------------------------------------------------------------
// Moi dong: [so tu ma sua loi moi khoi, so khoi nhom 1, so tu du
//            lieu moi khoi nhom 1, so khoi nhom 2, so tu du lieu
//            moi khoi nhom 2]
//
// So lieu lay tu chuan ISO/IEC 18004. Ham kiemTraBang() ben duoi
// tu doi chieu lai voi tong so tu ma cua tung phien ban - go sai
// mot con so la no bao ngay luc nap file, khong de lot ra ma QR
// hong ma khong ai biet.
// ================================================================
const KHOI = {
    L: [
        null,
        [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0],
        [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0],
        [30, 2, 116, 0, 0], [18, 2, 68, 2, 69],
    ],
    M: [
        null,
        [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
        [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
        [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
    ],
    Q: [
        null,
        [13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0],
        [18, 2, 15, 2, 16], [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19],
        [20, 4, 16, 4, 17], [24, 6, 19, 2, 20],
    ],
    H: [
        null,
        [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0],
        [22, 2, 11, 2, 12], [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15],
        [24, 4, 12, 4, 13], [28, 6, 15, 2, 16],
    ],
};

/** Tong so tu ma (du lieu + sua loi) cua tung phien ban. */
const TONG_TU_MA = [null, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/** Toa do tam cua cac o dinh vi phu, theo phien ban. */
const TAM_ODINHVI = [
    null,
    [], [6, 18], [6, 22], [6, 26], [6, 30],
    [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/** Ma hai bit cua muc sua loi khi ghi vao vung thong tin dinh dang. */
const MA_MUC = { L: 1, M: 0, Q: 3, H: 2 };

const PHIEN_BAN_TOI_DA = 10;

/**
 * Tu kiem tra bang o tren. Tong so tu ma cua moi khoi cong lai phai
 * dung bang tong so tu ma cua phien ban do.
 */
function kiemTraBang() {
    for (const muc of Object.keys(KHOI)) {
        for (let v = 1; v <= PHIEN_BAN_TOI_DA; v++) {
            const [ecc, k1, d1, k2, d2] = KHOI[muc][v];
            const tong = k1 * (d1 + ecc) + k2 * (d2 + ecc);
            if (tong !== TONG_TU_MA[v]) {
                throw new Error(
                    `qr.js: bang KHOI sai o ${muc}-${v}: tinh ra ${tong} tu ma, dang le ${TONG_TU_MA[v]}`
                );
            }
        }
    }
}
kiemTraBang();

// ================================================================
// 2. TRUONG GALOIS GF(256) - NEN CUA MA SUA LOI REED-SOLOMON
// ----------------------------------------------------------------
// Da thuc nguyen thuy 0x11D theo chuan QR.
// ================================================================
const LOG = new Uint8Array(256);
const MU = new Uint8Array(512);
(function dungBangLog() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        MU[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) MU[i] = MU[i - 255];
})();

function nhanGF(a, b) {
    if (a === 0 || b === 0) return 0;
    return MU[LOG[a] + LOG[b]];
}

/** Da thuc sinh bac `n` cua Reed-Solomon. */
function daThucSinh(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
        const moi = new Array(g.length + 1).fill(0);
        for (let j = 0; j < g.length; j++) {
            moi[j] ^= g[j];
            moi[j + 1] ^= nhanGF(g[j], MU[i]);
        }
        g = moi;
    }
    return g;
}

/** Tinh `soTuECC` tu ma sua loi cho mot khoi du lieu. */
function tinhECC(duLieu, soTuECC) {
    const g = daThucSinh(soTuECC);
    const du = new Array(duLieu.length + soTuECC).fill(0);
    for (let i = 0; i < duLieu.length; i++) du[i] = duLieu[i];

    for (let i = 0; i < duLieu.length; i++) {
        const heSo = du[i];
        if (heSo === 0) continue;
        for (let j = 0; j < g.length; j++) {
            du[i + j] ^= nhanGF(g[j], heSo);
        }
    }
    return du.slice(duLieu.length);
}

// ================================================================
// 3. MA BCH - DUNG CHO THONG TIN DINH DANG VA PHIEN BAN
// ----------------------------------------------------------------
// Tinh ra chu khong go san: go san 40 hang so nhi phan la kieu sai
// mot bit thi khong ai do ra duoc.
// ================================================================
function soBit(x) {
    let n = 0;
    while (x !== 0) { n++; x >>>= 1; }
    return n;
}

function bch(giaTri, daThuc, doDai) {
    let d = giaTri << (soBit(daThuc) - 1);
    while (soBit(d) >= soBit(daThuc)) {
        d ^= daThuc << (soBit(d) - soBit(daThuc));
    }
    return ((giaTri << (soBit(daThuc) - 1)) | d) & ((1 << doDai) - 1);
}

/** 15 bit thong tin dinh dang: muc sua loi + kieu mat na. */
function thongTinDinhDang(muc, matNa) {
    const v = (MA_MUC[muc] << 3) | matNa;
    return bch(v, 0x537, 15) ^ 0x5412;
}

/** 18 bit thong tin phien ban (chi phien ban 7 tro len moi ghi). */
function thongTinPhienBan(v) {
    return bch(v, 0x1f25, 18);
}

// ================================================================
// 4. MA HOA DU LIEU (CHE DO BYTE)
// ================================================================

/** Gom cac bit lai thanh mang byte. */
function DongBit() {
    const bit = [];
    return {
        them(giaTri, soLuong) {
            for (let i = soLuong - 1; i >= 0; i--) bit.push((giaTri >>> i) & 1);
        },
        get soBit() { return bit.length; },
        veByte() {
            while (bit.length % 8 !== 0) bit.push(0);
            const ra = [];
            for (let i = 0; i < bit.length; i += 8) {
                let b = 0;
                for (let j = 0; j < 8; j++) b = (b << 1) | bit[i + j];
                ra.push(b);
            }
            return ra;
        },
    };
}

/** So tu du lieu (chua ke ma sua loi) cua mot phien ban + muc. */
function soTuDuLieu(v, muc) {
    const [, k1, d1, k2, d2] = KHOI[muc][v];
    return k1 * d1 + k2 * d2;
}

/** Phien ban nho nhat chua vua `soByte` byte o muc sua loi da chon. */
function chonPhienBan(soByte, muc) {
    for (let v = 1; v <= PHIEN_BAN_TOI_DA; v++) {
        // 4 bit chi che do + 8 hoac 16 bit chi so ky tu
        const bitTieuDe = 4 + (v < 10 ? 8 : 16);
        if (soTuDuLieu(v, muc) * 8 >= bitTieuDe + soByte * 8) return v;
    }
    return null;
}

/**
 * Chuoi -> mang tu ma da xen ke (du lieu + sua loi), san sang xep vao luoi.
 */
function taoTuMa(text, muc) {
    const byte = Array.from(Buffer.from(String(text), 'utf8'));

    const v = chonPhienBan(byte.length, muc);
    if (v === null) {
        throw new Error(
            `qr.js: chuoi dai ${byte.length} byte, vuot suc chua cua phien ban `
            + `${PHIEN_BAN_TOI_DA} o muc sua loi ${muc}`
        );
    }

    // --- Ghep dong bit ---
    const dong = DongBit();
    dong.them(0b0100, 4);                        // che do byte
    dong.them(byte.length, v < 10 ? 8 : 16);     // so ky tu
    for (const b of byte) dong.them(b, 8);

    const sucChuaBit = soTuDuLieu(v, muc) * 8;
    dong.them(0, Math.min(4, sucChuaBit - dong.soBit));   // dau ket thuc

    const tu = dong.veByte();
    // Chen day 0xEC / 0x11 xen ke cho day suc chua
    const canCo = soTuDuLieu(v, muc);
    for (let i = 0; tu.length < canCo; i++) tu.push(i % 2 === 0 ? 0xec : 0x11);

    // --- Chia khoi, tinh ma sua loi ---
    const [soECC, k1, d1, k2, d2] = KHOI[muc][v];
    const khoiDuLieu = [];
    const khoiECC = [];
    let vt = 0;
    for (let i = 0; i < k1 + k2; i++) {
        const dai = i < k1 ? d1 : d2;
        const kh = tu.slice(vt, vt + dai);
        vt += dai;
        khoiDuLieu.push(kh);
        khoiECC.push(tinhECC(kh, soECC));
    }

    // --- Xen ke: lay tu ma thu i cua tung khoi, roi moi sang thu i+1 ---
    const ra = [];
    const daiNhat = Math.max(d1, d2);
    for (let i = 0; i < daiNhat; i++) {
        for (const kh of khoiDuLieu) if (i < kh.length) ra.push(kh[i]);
    }
    for (let i = 0; i < soECC; i++) {
        for (const kh of khoiECC) ra.push(kh[i]);
    }

    return { tuMa: ra, phienBan: v };
}

// ================================================================
// 5. XEP LUOI
// ================================================================

/** null = o chua ghi gi, true = o den, false = o trang. */
function luoiTrong(kichThuoc) {
    return Array.from({ length: kichThuoc }, () => new Array(kichThuoc).fill(null));
}

function datODinhVi(m, r, c) {
    const n = m.length;
    for (let i = -1; i <= 7; i++) {
        for (let j = -1; j <= 7; j++) {
            const y = r + i, x = c + j;
            if (y < 0 || y >= n || x < 0 || x >= n) continue;
            const trong = (i >= 0 && i <= 6 && (j === 0 || j === 6))
                || (j >= 0 && j <= 6 && (i === 0 || i === 6))
                || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
            m[y][x] = trong;
        }
    }
}

function datODinhViPhu(m, v) {
    const tam = TAM_ODINHVI[v];
    for (const r of tam) {
        for (const c of tam) {
            // Bo qua 3 goc - da co o dinh vi chinh o do
            if (m[r][c] !== null) continue;
            for (let i = -2; i <= 2; i++) {
                for (let j = -2; j <= 2; j++) {
                    m[r + i][c + j] = Math.max(Math.abs(i), Math.abs(j)) !== 1;
                }
            }
        }
    }
}

function datNhipTho(m) {
    const n = m.length;
    for (let i = 8; i < n - 8; i++) {
        const den = i % 2 === 0;
        if (m[6][i] === null) m[6][i] = den;
        if (m[i][6] === null) m[i][6] = den;
    }
}

/** Danh dau truoc vung thong tin dinh dang de khong bi du lieu de len. */
function giuChoDinhDang(m, v) {
    const n = m.length;
    for (let i = 0; i < 9; i++) {
        if (m[i][8] === null) m[i][8] = false;
        if (m[8][i] === null) m[8][i] = false;
    }
    for (let i = 0; i < 8; i++) {
        if (m[8][n - 1 - i] === null) m[8][n - 1 - i] = false;
        if (m[n - 1 - i][8] === null) m[n - 1 - i][8] = false;
    }
    if (v >= 7) {
        for (let i = 0; i < 18; i++) {
            const a = Math.floor(i / 3);
            const b = (i % 3) + n - 8 - 3;
            m[a][b] = false;
            m[b][a] = false;
        }
    }
}

function ghiDinhDang(m, muc, matNa) {
    const n = m.length;
    const d = thongTinDinhDang(muc, matNa);

    for (let i = 0; i < 15; i++) {
        const bit = ((d >> i) & 1) === 1;
        // Ban doc theo cot ben trai
        if (i < 6) m[i][8] = bit;
        else if (i < 8) m[i + 1][8] = bit;
        else m[n - 15 + i][8] = bit;

        // Ban doc theo hang tren
        if (i < 8) m[8][n - i - 1] = bit;
        else if (i < 9) m[8][15 - i - 1 + 1] = bit;
        else m[8][15 - i - 1] = bit;
    }
    m[n - 8][8] = true;   // o den co dinh, luon bat
}

function ghiPhienBan(m, v) {
    if (v < 7) return;
    const n = m.length;
    const bits = thongTinPhienBan(v);
    for (let i = 0; i < 18; i++) {
        const bit = ((bits >> i) & 1) === 1;
        m[Math.floor(i / 3)][(i % 3) + n - 8 - 3] = bit;
        m[(i % 3) + n - 8 - 3][Math.floor(i / 3)] = bit;
    }
}

function matNaBat(kieu, i, j) {
    switch (kieu) {
        case 0: return (i + j) % 2 === 0;
        case 1: return i % 2 === 0;
        case 2: return j % 3 === 0;
        case 3: return (i + j) % 3 === 0;
        case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
        case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
        case 7: return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
        default: throw new Error('qr.js: kieu mat na khong hop le: ' + kieu);
    }
}

/** Rai tu ma vao cac o con trong theo duong zic zac tu goc duoi phai. */
function raiDuLieu(m, tuMa, matNa) {
    const n = m.length;
    let huong = -1;
    let hang = n - 1;
    let viTriBit = 7;
    let viTriByte = 0;

    for (let cot = n - 1; cot > 0; cot -= 2) {
        if (cot === 6) cot--;            // bo qua cot nhip tho
        for (;;) {
            for (let c = 0; c < 2; c++) {
                if (m[hang][cot - c] !== null) continue;

                let den = false;
                if (viTriByte < tuMa.length) {
                    den = ((tuMa[viTriByte] >>> viTriBit) & 1) === 1;
                }
                if (matNaBat(matNa, hang, cot - c)) den = !den;
                m[hang][cot - c] = den;

                viTriBit--;
                if (viTriBit === -1) { viTriByte++; viTriBit = 7; }
            }
            hang += huong;
            if (hang < 0 || hang >= n) { hang -= huong; huong = -huong; break; }
        }
    }
}

// ================================================================
// 6. CHAM DIEM MAT NA
// ----------------------------------------------------------------
// Diem CANG THAP CANG TOT. Bon quy tac theo chuan - phat nhung
// hinh dang lam may quet doc nham.
// ================================================================
function chamDiem(m) {
    const n = m.length;
    let diem = 0;

    // Quy tac 1: chuoi tu 5 o cung mau tro len
    for (let i = 0; i < n; i++) {
        for (const theoHang of [true, false]) {
            let dem = 1;
            for (let j = 1; j < n; j++) {
                const a = theoHang ? m[i][j] : m[j][i];
                const b = theoHang ? m[i][j - 1] : m[j - 1][i];
                if (a === b) {
                    dem++;
                } else {
                    if (dem >= 5) diem += 3 + (dem - 5);
                    dem = 1;
                }
            }
            if (dem >= 5) diem += 3 + (dem - 5);
        }
    }

    // Quy tac 2: khoi 2x2 cung mau
    for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < n - 1; j++) {
            const a = m[i][j];
            if (a === m[i][j + 1] && a === m[i + 1][j] && a === m[i + 1][j + 1]) diem += 3;
        }
    }

    // Quy tac 3: hinh giong o dinh vi (1011101 kem 4 o trang)
    const mau1 = [true, false, true, true, true, false, true, false, false, false, false];
    const mau2 = [false, false, false, false, true, false, true, true, true, false, true];
    const khop = (lay, bd, mau) => mau.every((v, k) => lay(bd + k) === v);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= n - 11; j++) {
            const hang = k => m[i][k];
            const cot = k => m[k][i];
            if (khop(hang, j, mau1) || khop(hang, j, mau2)) diem += 40;
            if (khop(cot, j, mau1) || khop(cot, j, mau2)) diem += 40;
        }
    }

    // Quy tac 4: lech ty le den/trang khoi muc 50%
    let den = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (m[i][j]) den++;
    const phanTram = (den * 100) / (n * n);
    diem += Math.floor(Math.abs(phanTram - 50) / 5) * 10;

    return diem;
}

// ================================================================
// 7. HAM CHINH
// ================================================================

/**
 * Sinh luoi o cua ma QR.
 * @param {string} text  noi dung (thuong la duong dan http)
 * @param {object} opts  { muc: 'L'|'M'|'Q'|'H' }  mac dinh 'M'
 * @returns {{ kichThuoc:number, phienBan:number, muc:string, matNa:number, o:boolean[][] }}
 */
function taoLuoi(text, opts = {}) {
    const muc = String(opts.muc || 'M').toUpperCase();
    if (!KHOI[muc]) throw new Error('qr.js: muc sua loi phai la L, M, Q hoac H');
    if (!String(text || '')) throw new Error('qr.js: chua co noi dung de ma hoa');

    const { tuMa, phienBan } = taoTuMa(text, muc);
    const kichThuoc = phienBan * 4 + 17;

    // Thu ca 8 kieu mat na, giu kieu diem thap nhat.
    // opts.matNa ep dung mot kieu co dinh - chi dung khi kiem thu.
    const dsMatNa = opts.matNa === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [opts.matNa];

    let tot = null;
    for (const matNa of dsMatNa) {
        const m = luoiTrong(kichThuoc);
        datODinhVi(m, 0, 0);
        datODinhVi(m, 0, kichThuoc - 7);
        datODinhVi(m, kichThuoc - 7, 0);
        datODinhViPhu(m, phienBan);
        datNhipTho(m);
        giuChoDinhDang(m, phienBan);
        raiDuLieu(m, tuMa, matNa);
        ghiPhienBan(m, phienBan);
        ghiDinhDang(m, muc, matNa);

        const diem = chamDiem(m);
        if (tot === null || diem < tot.diem) tot = { diem, matNa, o: m };
    }

    return { kichThuoc, phienBan, muc, matNa: tot.matNa, o: tot.o };
}

/**
 * Sinh ma QR duoi dang SVG.
 *
 * SVG chu khong phai PNG: in ra giay o co nao cung sac net, va la
 * van ban thuan nen nhet thang vao trang web duoc, khong can tep anh.
 *
 * @param {string} text
 * @param {object} opts
 *   muc      'L'|'M'|'Q'|'H'   mac dinh 'M'
 *   coO      so diem anh moi o QR, mac dinh 4
 *   le       so o trang chua quanh vien, mac dinh 4 (chuan yeu cau toi thieu 4)
 *   mauDen / mauTrang
 */
function taoSVG(text, opts = {}) {
    const { kichThuoc, o } = taoLuoi(text, opts);
    const coO = Math.max(1, Math.round(opts.coO || 4));
    const le = opts.le === undefined ? 4 : Math.max(0, Math.round(opts.le));
    const mauDen = opts.mauDen || '#0f172a';
    const mauTrang = opts.mauTrang || '#ffffff';

    const canh = (kichThuoc + le * 2) * coO;

    // Gop cac o den lien nhau tren cung mot hang thanh mot hinh chu nhat
    // -> tep SVG nho hon nhieu so voi ve tung o mot.
    const hinh = [];
    for (let i = 0; i < kichThuoc; i++) {
        let j = 0;
        while (j < kichThuoc) {
            if (!o[i][j]) { j++; continue; }
            let dai = 1;
            while (j + dai < kichThuoc && o[i][j + dai]) dai++;
            hinh.push(
                `<rect x="${(j + le) * coO}" y="${(i + le) * coO}" `
                + `width="${dai * coO}" height="${coO}"/>`
            );
            j += dai;
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${canh}" height="${canh}" `
        + `viewBox="0 0 ${canh} ${canh}" shape-rendering="crispEdges">`
        + `<rect width="${canh}" height="${canh}" fill="${mauTrang}"/>`
        + `<g fill="${mauDen}">${hinh.join('')}</g>`
        + `</svg>`;
}

// ================================================================
// 8. GIAI MA NGUOC - DE TU KIEM TRA
// ----------------------------------------------------------------
// Khong dung de doc anh chup. Muc dich duy nhat: doc lai chinh luoi
// vua sinh ra, xem co ve dung chuoi ban dau khong.
//
// Vi sao dang gia mot ham rieng: ma QR sai thi NHIN KHONG RA. No van
// vuong van den trang van co ba o vuong o goc, chi la dien thoai quet
// khong len. Neu khong co ham nay, mot lan sua nham bang so o tren
// se lot ra tan cai nhan dan thung tom di ban.
// ================================================================
function giaiMa(luoi) {
    const { kichThuoc: n, phienBan: v, muc, matNa, o } = luoi;

    // Dung lai ban do o bi chiem y het luc ghi
    const m = luoiTrong(n);
    datODinhVi(m, 0, 0);
    datODinhVi(m, 0, n - 7);
    datODinhVi(m, n - 7, 0);
    datODinhViPhu(m, v);
    datNhipTho(m);
    giuChoDinhDang(m, v);

    // Di lai duong zic zac, go mat na, gom bit
    const bit = [];
    let huong = -1;
    let hang = n - 1;
    for (let cot = n - 1; cot > 0; cot -= 2) {
        if (cot === 6) cot--;
        for (;;) {
            for (let c = 0; c < 2; c++) {
                if (m[hang][cot - c] !== null) continue;
                let den = o[hang][cot - c];
                if (matNaBat(matNa, hang, cot - c)) den = !den;
                bit.push(den ? 1 : 0);
            }
            hang += huong;
            if (hang < 0 || hang >= n) { hang -= huong; huong = -huong; break; }
        }
    }

    const tu = [];
    for (let i = 0; i + 8 <= bit.length; i += 8) {
        let x = 0;
        for (let j = 0; j < 8; j++) x = (x << 1) | bit[i + j];
        tu.push(x);
    }

    // Go xen ke, ghep lai cac khoi du lieu theo dung thu tu ban dau
    const [, k1, d1, k2, d2] = KHOI[muc][v];
    const khoi = Array.from({ length: k1 + k2 }, () => []);
    let p = 0;
    for (let i = 0; i < Math.max(d1, d2); i++) {
        for (let b = 0; b < k1 + k2; b++) {
            if (i < (b < k1 ? d1 : d2)) khoi[b].push(tu[p++]);
        }
    }
    const dong = [].concat(...khoi);

    // Doc dong bit: 4 bit che do, roi so ky tu, roi du lieu
    let vt = 0;
    const doc = (soBit) => {
        let x = 0;
        for (let i = 0; i < soBit; i++) {
            x = (x << 1) | ((dong[vt >> 3] >> (7 - (vt & 7))) & 1);
            vt++;
        }
        return x;
    };

    const cheDo = doc(4);
    if (cheDo !== 0b0100) {
        throw new Error(`qr.js: doc nguoc ra che do ${cheDo}, dang le 4 (byte)`);
    }
    const soKyTu = doc(v < 10 ? 8 : 16);
    const byte = [];
    for (let i = 0; i < soKyTu; i++) byte.push(doc(8));

    return Buffer.from(byte).toString('utf8');
}

module.exports = {
    taoLuoi,
    taoSVG,
    giaiMa,
    chonPhienBan,
    PHIEN_BAN_TOI_DA,
};

// ================================================================
// CHAY THU:  node qr.js --test
// ================================================================
if (require.main === module) {
    // ---- Tu kiem tra: sinh ra roi doc lai, phai ra dung chuoi ban dau ----
    const mau = [
        'HI',
        'xin chao',
        'http://192.168.1.10:3000/trace.html?code=VAST-3E13D0C57A',
        'http://localhost:3000/trace.html?code=VAST-0123456789',
        'Ao tôm số 1 — Cà Mau',                    // co dau tieng Viet (UTF-8 nhieu byte)
        'x'.repeat(110),                            // day len phien ban lon (vua ca 4 muc)
    ];
    let hong = 0;
    console.log('KIEM TRA SINH ROI DOC LAI');
    for (const s of mau) {
        for (const muc of ['L', 'M', 'Q', 'H']) {
            let ket;
            try {
                const g = taoLuoi(s, { muc });
                const lai = giaiMa(g);
                ket = lai === s ? null : `doc lai ra "${lai.slice(0, 30)}"`;
            } catch (e) {
                ket = e.message;
            }
            if (ket) { hong++; console.log(`  HONG [${muc}] "${s.slice(0, 34)}" -> ${ket}`); }
        }
    }
    console.log(hong === 0
        ? `  Dat: ${mau.length} chuoi x 4 muc sua loi deu doc lai dung.\n`
        : `  CO ${hong} truong hop hong.\n`);

    const noiDung = process.argv[3] || 'http://192.168.1.10:3000/trace.html?code=VAST-3E13D0C57A';
    const kq = taoLuoi(noiDung, { muc: 'M' });

    console.log('Noi dung :', noiDung);
    console.log('Phien ban:', kq.phienBan, `(${kq.kichThuoc}x${kq.kichThuoc} o)`);
    console.log('Muc sua loi:', kq.muc, '| mat na:', kq.matNa);
    console.log('');

    // In ra terminal bang ky tu nua khoi - quet thu bang dien thoai duoc
    const le = 2;
    const n = kq.kichThuoc;
    const den = (i, j) => (i < 0 || j < 0 || i >= n || j >= n) ? false : kq.o[i][j];
    for (let i = -le; i < n + le; i += 2) {
        let dong = '';
        for (let j = -le; j < n + le; j++) {
            const tren = den(i, j);
            const duoi = den(i + 1, j);
            dong += tren && duoi ? '█' : tren ? '▀' : duoi ? '▄' : ' ';
        }
        console.log(dong);
    }
}
