// ================================================================
// ask.js - HIEU CAU TIENG VIET CUA NGUOI NUOI
//
// Hai viec:
//   1) phanLoaiNhatKy()  - noi/go mot cau -> vao dung AO nao, thuoc loai viec gi
//   2) traLoi()          - hoi mot cau -> tra loi bang so lieu that cua ao
//
// KHONG dung mo hinh ngon ngu. Day la doi chieu tu khoa - don gian nhung
// du dung cho vai chuc loai cau ma nguoi nuoi thuc su noi hang ngay,
// va quan trong hon: KHONG BAO GIO BIA. Khong hieu thi noi la khong hieu.
//
// ================================================================
// VI SAO KHONG DOAN BUA
// ----------------------------------------------------------------
// Ban cu cua submitAILog() chi biet dung 2 cau:
//     text.includes("ao 1")  -> "Ao so 1"
//     text.includes("ao 2")  -> "Ao so 2"
// Ten ao nao khac deu roi het vao "He thong chung".
//
// Gio doi chieu voi TEN AO THAT trong database. Va neu cau noi khong
// nhac ao nao, khong doan lung tung - ghi vao ao dang xem, hoac hoi lai.
// ================================================================

'use strict';

const db = require('./db');
const advisor = require('./advisor');
const kb = require('./kb');

// ----------------------------------------------------------------
// CHUAN HOA TIENG VIET
// ----------------------------------------------------------------

/** Bo dau tieng Viet + ve chu thuong -> so sanh de hon. */
function boDau(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** Doi so viet bang chu sang so: "nam ky" -> "5 ky". */
const SO_CHU = {
    khong: 0, mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9, muoi: 10,
    'mot tram': 100, 'hai tram': 200, 'nam tram': 500, nghin: 1000, ngan: 1000,
};

function doiSoChu(s) {
    let t = ' ' + boDau(s) + ' ';
    // Sap theo do dai giam dan de "mot tram" duoc thay truoc "mot"
    for (const chu of Object.keys(SO_CHU).sort((a, b) => b.length - a.length)) {
        t = t.replace(new RegExp('(?<=\\s)' + chu + '(?=\\s)', 'g'), String(SO_CHU[chu]));
    }
    return t.trim();
}

// ================================================================
// 1) PHAN LOAI NHAT KY
// ================================================================

// ----------------------------------------------------------------
// CAC LOAI VIEC
// ----------------------------------------------------------------
// Dung BIEU THUC thay vi so sanh chuoi thang, vi nguoi ta noi
// "cho ao 1 an 5 ky cam" - chu "cho" va chu "an" bi tach roi nhau.
//
// "uu_tien" cang cao cang duoc chon truoc khi mot cau khop nhieu loai.
// THUOC va BENH uu tien cao nhat: cau "tron khang sinh cho an" phai vao
// muc THUOC chu khong phai CHO AN, vi thuoc con phai ghi thoi gian ngung
// truoc thu hoach - xep nham la mat dau vet ca lo hang.
// ----------------------------------------------------------------
const LOAI_VIEC = [
    {
        ma: 'thuoc',
        ten: 'Dùng thuốc',
        icon: 'pill',
        uu_tien: 100,
        mau: [/khang sinh/, /thuoc/, /tri benh/, /oxytetra/, /sulfa/, /florfenicol/, /enro/],
    },
    {
        ma: 'benh',
        ten: 'Dấu hiệu bệnh',
        icon: 'alert-triangle',
        uu_tien: 90,
        mau: [/tom (benh|chet|yeu)/, /noi dau/, /tap me/, /bo an/, /dom trang/,
            /gan tuy/, /phan trang/, /ruot (rong|dut)/, /do than/, /cham lon/, /chet rai rac/],
    },
    {
        ma: 'thu_hoach',
        ten: 'Thu hoạch',
        icon: 'package',
        uu_tien: 80,
        mau: [/thu hoach/, /ban tom/, /keo tom/, /can ban/, /thu ta/],
    },
    {
        ma: 'tha_giong',
        ten: 'Thả giống',
        icon: 'sprout',
        uu_tien: 75,
        mau: [/tha (giong|tom|post|con giong)/, /tha \d+ ?(con|van|nghin)/],
    },
    {
        ma: 'chai_mau',
        ten: 'Chài mẫu',
        icon: 'ruler',
        uu_tien: 70,
        mau: [/chai (mau|tom)/, /can tom/, /do size/, /kiem tra trong luong/, /\d+ ?g\/con/],
    },
    {
        ma: 'xu_ly',
        ten: 'Xử lý môi trường',
        icon: 'flask-conical',
        uu_tien: 60,
        mau: [/(danh|tat) voi/, /vi sinh/, /xu ly day/, /diet khuan/, /yucca/,
            /khoang/, /zeolite/, /siphon/, /hut day/, /gay mau/],
    },
    {
        ma: 'thay_nuoc',
        ten: 'Thay nước / cấp nước',
        icon: 'droplets',
        uu_tien: 55,
        mau: [/thay nuoc/, /cap nuoc/, /bom nuoc/, /xa nuoc/, /rut nuoc/, /thay \d+ ?%/],
    },
    {
        ma: 'thiet_bi',
        ten: 'Thiết bị',
        icon: 'settings',
        uu_tien: 50,
        mau: [/(bat|tat) (quat|suc khi|guong|bom|may)/, /sua (may|quat|bom)/, /thay may/],
    },
    {
        ma: 'cho_an',
        ten: 'Cho ăn',
        icon: 'utensils',
        uu_tien: 40,
        // "cho ao 1 an", "cho an", "an 5 ky", "rai cam", "xa cu"
        mau: [/cho .{0,12}an\b/, /\ban \d/, /rai cam/, /xa (cam|cu)/, /nap cam/,
            /do cam/, /thuc an/, /\d+ ?(kg|ky) ?cam/, /cho tom an/],
    },
];

/**
 * Xac dinh loai viec.
 * Cham diem tat ca cac loai roi lay loai diem cao nhat; bang diem thi
 * lay loai co uu tien cao hon. Nho vay "tron khang sinh cho an" vao
 * muc THUOC chu khong phai CHO AN.
 */
function timLoaiViec(text) {
    const t = boDau(text);
    let tot = null, diemTot = 0;

    for (const l of LOAI_VIEC) {
        let khop = 0;
        for (const m of l.mau) if (m.test(t)) khop++;
        if (!khop) continue;

        // Diem = so mau khop, cong them uu tien de pha the hoa
        const diem = khop * 1000 + l.uu_tien;
        if (diem > diemTot) { diemTot = diem; tot = l; }
    }
    return tot;
}

/** Tim ao duoc nhac den trong cau. Tra null neu khong chac. */
function timAo(text, ponds) {
    const t = boDau(text);

    // 1) Khop TEN AO THAT trong database (chinh xac nhat)
    for (const p of ponds) {
        const ten = boDau(p.name);
        if (ten && ten.length >= 3 && t.includes(ten)) {
            return { pond: p, cach: 'khớp tên ao' };
        }
    }

    // 2) "ao 1", "ao so 1", "ao thu 2" -> tim ao co so do trong ten
    const m = t.match(/ao\s*(?:so|thu)?\s*(\d{1,2})\b/);
    if (m) {
        const soAo = m[1];
        for (const p of ponds) {
            if (boDau(p.name).match(new RegExp('\\b' + soAo + '\\b'))) {
                return { pond: p, cach: `nhắc "ao ${soAo}"` };
            }
        }
        // Co nhac so ao nhung khong ao nao trung -> NOI RO, khong gan bua
        return { pond: null, cach: 'khong_khop', soAo };
    }

    return { pond: null, cach: 'khong_nhac' };
}

/** Rut so lieu trong cau: "5 ky cam", "30 phan tram nuoc". */
function timSoLieu(text) {
    const t = doiSoChu(text);
    const ra = {};

    let m = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|ky|ki lo|kilo)/);
    if (m) ra.kg = Number(m[1].replace(',', '.'));

    m = t.match(/(\d+(?:[.,]\d+)?)\s*(g|gam|gram)\b/);
    if (m && !ra.kg) ra.gam = Number(m[1].replace(',', '.'));

    m = t.match(/(\d+)\s*(?:%|phan tram)/);
    if (m) ra.phan_tram = Number(m[1]);

    m = t.match(/(\d+)\s*con/);
    if (m) ra.con = Number(m[1]);

    m = t.match(/(\d{1,2})\s*(?:gio|h)\b/);
    if (m) ra.gio = Number(m[1]);

    return ra;
}

/**
 * Phan loai mot cau nhat ky.
 * @param {string} text        cau nguoi dung noi hoac go
 * @param {number} userId
 * @param {string} pondDangXem ao dang mo tren man hinh (dung khi cau khong nhac ao)
 */
function phanLoaiNhatKy(text, userId, pondDangXem) {
    const noiDung = String(text || '').trim();
    if (!noiDung) return { ok: false, error: 'Chưa có nội dung' };

    const ponds = db.pondList(userId);
    const ao = timAo(noiDung, ponds);
    const viec = timLoaiViec(noiDung);
    const soLieu = timSoLieu(noiDung);

    let pondId = null;
    let cachChon = '';
    let hoiLai = null;

    if (ao.pond) {
        pondId = ao.pond.pond_id;
        cachChon = ao.cach;
    } else if (ao.cach === 'khong_khop') {
        // Nhac "ao 3" ma khong co ao nao ten do -> HOI LAI, khong gan bua
        hoiLai = `Câu này nhắc "ao ${ao.soAo}" nhưng không có ao nào tên như vậy. Ghi vào ao nào?`;
    } else if (pondDangXem && db.pondGet(pondDangXem)) {
        pondId = pondDangXem;
        cachChon = 'ao đang mở trên màn hình';
    } else if (ponds.length === 1) {
        pondId = ponds[0].pond_id;
        cachChon = 'chỉ có một ao';
    } else if (ponds.length > 1) {
        hoiLai = 'Câu này không nhắc ao nào. Ghi vào ao nào?';
    }

    return {
        ok: true,
        noi_dung: noiDung,
        pond_id: pondId,
        pond_name: pondId ? (db.pondGet(pondId) || {}).name : null,
        cach_chon_ao: cachChon,
        hoi_lai: hoiLai,
        loai: viec ? viec.ma : null,
        loai_ten: viec ? viec.ten : 'Ghi chú',
        loai_icon: viec ? viec.icon : 'pencil',
        so_lieu: soLieu,
        // Nhac dung thuoc -> gan lien voi ho so truy xuat, vi thoi gian
        // ngung thuoc la thu quyet dinh ngay duoc phep thu hoach
        nhac_them: viec && viec.ma === 'thuoc'
            ? 'Có dùng thuốc thì nhớ ghi vào hồ sơ truy xuất kèm số ngày ngừng trước thu hoạch — '
            + 'thiếu con số này là không tính được ngày thu hoạch an toàn.'
            : null,
        danh_sach_ao: ponds.map(p => ({ pond_id: p.pond_id, name: p.name })),
    };
}

// ================================================================
// 2) TRA LOI CAU HOI
// ================================================================

/**
 * Cac cau hoi goi y san. Moi cau co:
 *   - tu khoa de nhan dang
 *   - ham tra loi, duoc truyen boi canh ao THAT
 *
 * Nguyen tac: cau tra loi nao dung duoc so lieu cua ao thi PHAI dung,
 * dung noi chung chung khi da co so that.
 */
const CAU_HOI = [
    {
        ma: 'giong_nang_suat',
        goi_y: 'Tôm nào cho năng suất cao?',
        tu: ['giong nao', 'tom nao', 'nang suat cao', 'nuoi loai nao', 'the hay su'],
        traLoi(ctx) {
            const doan = [
                {
                    tieu_de: 'Tôm thẻ chân trắng',
                    noi_dung: 'Lớn nhanh, nuôi được mật độ cao, vòng nuôi ngắn (khoảng 3 tháng). '
                        + 'Sản lượng trên cùng một diện tích cao hơn tôm sú. Đổi lại giá bán thấp hơn '
                        + 'và đòi hỏi quản lý môi trường chặt hơn vì nuôi dày.',
                },
                {
                    tieu_de: 'Tôm sú',
                    noi_dung: 'Lớn chậm hơn, nuôi mật độ thưa, vòng nuôi dài hơn. '
                        + 'Bù lại giá bán cao hơn hẳn, chịu được độ mặn biến động tốt hơn, '
                        + 'và hợp với mô hình quảng canh, tôm–lúa, tôm–rừng.',
                },
            ];

            let soSanh = null;
            if (ctx.gia && ctx.gia.the && ctx.gia.su) {
                soSanh = `Giá thị trường hiện tại: tôm thẻ size ${ctx.gia.the.size} khoảng `
                    + `${dinhDangSo(ctx.gia.the.price)} đ/kg, tôm sú size ${ctx.gia.su.size} khoảng `
                    + `${dinhDangSo(ctx.gia.su.price)} đ/kg.`;
            }

            return {
                tra_loi: 'Không có loại nào "tốt hơn" chung chung — tùy vốn, tùy ao và tùy thị trường bạn bán.',
                chi_tiet: doan,
                so_lieu_that: soSanh,
                luu_y: 'Năng suất cao nhất không đồng nghĩa lời nhiều nhất. Nuôi dày thì chi phí cám, '
                    + 'điện quạt và rủi ro dịch bệnh đều tăng theo. Nên tính trên tiền lời mỗi vụ, '
                    + 'không tính trên số tấn.',
            };
        },
    },
    {
        ma: 'mua_benh',
        goi_y: 'Mùa nào tôm dễ bệnh?',
        tu: ['mua nao', 'thang nay', 'de benh', 'hay benh', 'mua benh', 'thoi tiet nay benh gi'],
        traLoi(ctx) {
            const chiTiet = advisor.BENH.map(b => ({
                tieu_de: b.ten,
                noi_dung: `Dấu hiệu: ${b.dau_hieu}`,
            }));

            let hienTai = `Hiện đang ${ctx.mua.ten.toLowerCase()} (tháng ${ctx.thang}). `
                + `${ctx.mua.dac_diem}. Cần để ý: ${ctx.mua.rui_ro.join('; ')}.`;

            if (ctx.nhietDo !== null) {
                hienTai += ` Nhiệt độ ao bạn đang ${ctx.nhietDo}°C`;
                if (ctx.nhietDo < 28) hienTai += ' — khoảng nhiệt độ bệnh đốm trắng hay bùng phát.';
                else if (ctx.nhietDo > 32) hienTai += ' — nóng, vi khuẩn Vibrio phát triển nhanh.';
                else hienTai += ' — nằm trong khoảng thoải mái của tôm.';
            }

            return {
                tra_loi: hienTai,
                chi_tiet: chiTiet,
                luu_y: 'Đây là các mối liên hệ thường gặp, KHÔNG phải chẩn đoán. '
                    + 'Thấy tôm bỏ ăn, tấp mé, gan tụy nhạt màu thì gửi mẫu xét nghiệm ngay — '
                    + 'đoán bệnh bằng mắt rồi đánh thuốc là cách mất cả vụ.',
            };
        },
    },
    {
        ma: 'khi_nao_ban',
        goi_y: 'Khi nào nên bán tôm?',
        tu: ['khi nao ban', 'nen ban', 'ban bay gio', 'thu hoach', 'nuoi them', 'giu lai nuoi'],
        traLoi(ctx) {
            if (!ctx.sizeConKg) {
                return {
                    tra_loi: 'Chưa tính được vì ao chưa có số chài mẫu. '
                        + 'Chài khoảng 30 con, cân lên rồi nhập vào mục Chài mẫu, hệ thống sẽ so giá giúp bạn.',
                    chi_tiet: [],
                };
            }
            const tt = ctx.loiKhuyenThiTruong;
            if (!tt) {
                return {
                    tra_loi: `Tôm đang khoảng ${ctx.sizeConKg} con/kg. `
                        + 'Chưa lấy được bảng giá thị trường nên chưa so được chênh lệch giữa các cỡ.',
                    chi_tiet: [],
                    luu_y: 'Bấm Làm mới ở tab Thông tin thị trường để lấy giá.',
                };
            }
            return {
                tra_loi: tt.noi_dung,
                chi_tiet: [{ tieu_de: 'Căn cứ', noi_dung: tt.can_cu }],
                luu_y: 'Nhớ trừ tiền cám, tiền điện quạt và rủi ro của những ngày nuôi thêm. '
                    + 'Giá trên bảng là giá tham khảo, chốt bán vẫn phải hỏi thương lái.',
            };
        },
    },
    {
        ma: 'oxy',
        tu: ['oxy', 'do thap', 'suc khi', 'quat nuoc', 'noi dau'],
        goi_y: 'Oxy trong ao đang thế nào?',
        traLoi(ctx) {
            if (ctx.do === null) {
                return {
                    tra_loi: ctx.online
                        ? 'Thiết bị đang online nhưng chưa có số oxy.'
                        : 'Thiết bị đang mất kết nối nên không đọc được oxy. Số cũ trên màn hình không dùng để quyết định được.',
                    chi_tiet: [],
                };
            }
            let danhGia;
            if (ctx.do < 3) danhGia = 'NGUY HIỂM — tôm bắt đầu ngạt';
            else if (ctx.do < 4) danhGia = 'thấp — tôm ăn kém, chậm lớn';
            else if (ctx.do < 5) danhGia = 'hơi thấp';
            else danhGia = 'tốt';

            return {
                tra_loi: `DO hiện tại ${ctx.do} mg/L — ${danhGia}. Ngưỡng an toàn là trên 5 mg/L.`,
                chi_tiet: [{
                    tieu_de: 'Giờ nguy hiểm nhất',
                    noi_dung: 'Khoảng 3–6 giờ sáng, tảo ngừng quang hợp và chuyển sang hô hấp, '
                        + 'oxy trong ao xuống thấp nhất. Đây là lúc tôm hay nổi đầu.',
                }],
                luu_y: ctx.do < 5 ? 'Không tắt quạt qua đêm.' : null,
            };
        },
    },
    {
        ma: 'cho_an_bao_nhieu',
        tu: ['cho an bao nhieu', 'bao nhieu kg', 'khau phan', 'luong cam', 'an may ky'],
        goi_y: 'Hôm nay cho ăn bao nhiêu?',
        traLoi(ctx) {
            const kh = ctx.khauPhan;
            if (!kh || !kh.ok) {
                return {
                    tra_loi: kh ? kh.message : 'Chưa đủ dữ liệu để tính khẩu phần.',
                    chi_tiet: [],
                    luu_y: 'Cần số con giống đã thả, tỷ lệ sống dự kiến và trọng lượng trung bình từ chài mẫu.',
                };
            }
            return {
                tra_loi: `${dinhDangSo(kh.camNgayKg)} kg mỗi ngày, chia ${kh.mealsPerDay} cữ — `
                    + `mỗi cữ ${dinhDangSo(kh.camMoiCuKg)} kg.`,
                chi_tiet: [{
                    tieu_de: 'Cách tính',
                    noi_dung: `${dinhDangSo(kh.soTom)} con × ${dinhDangSo(kh.buoc2.avgWeightG)} g `
                        + `= ${dinhDangSo(kh.sinhKhoiKg)} kg sinh khối × ${kh.ratePct}% trọng lượng thân`,
                }],
                luu_y: 'Con số này là điểm xuất phát. Sau mỗi cữ 1,5–2 giờ kiểm tra sàng ăn: '
                    + 'còn thừa thì giảm, hết sạch thì tăng. Máy không nhìn được sàng ăn.',
            };
        },
    },

    // ============================================================
    // CAC CAU DUOI DAY LAY SO TU kb.js - KHO KIEN THUC RUT TU
    // "Tai lieu nuoi tom". Khong go so truc tiep vao day.
    // ============================================================

    {
        ma: 'nguong_nuoc',
        tu: ['nguong an toan', 'bao nhieu la an toan', 'chi so nuoc', 'muc an toan',
            'nhiet do bao nhieu', 'ph bao nhieu', 'do man', 'khi doc', 'ammonia', 'nitrite'],
        goi_y: 'Chỉ số nước bao nhiêu là an toàn?',
        traLoi(ctx) {
            const ng = kb.nguong(ctx.loai);
            const ten = kb.loaiTom(ctx.loai).ten;

            const chiTiet = Object.values(ng).map(m => ({
                tieu_de: m.ten,
                noi_dung: moTaNguong(m) + ' — ' + m.vi_sao,
            }));

            // Doi chieu voi so THAT cua ao, chi khi thiet bi dang online
            const doChieu = [];
            if (ctx.online) {
                if (ctx.nhietDo !== null) doChieu.push(soSanh('Nhiệt độ', ctx.nhietDo, ng.nhiet_do));
                if (ctx.do !== null) doChieu.push(soSanh('DO', ctx.do, ng.do));
                if (ctx.ph !== null) doChieu.push(soSanh('pH', ctx.ph, ng.ph));
            }

            return {
                tra_loi: `Ngưỡng chuẩn cho ${ten.toLowerCase()}:`,
                chi_tiet: chiTiet,
                so_lieu_that: doChieu.length
                    ? 'Ao bạn hiện tại — ' + doChieu.join(' · ')
                    : (ctx.online ? null : 'Thiết bị đang mất kết nối nên chưa đối chiếu được với số thật của ao.'),
                luu_y: 'Ao chỉ có cảm biến nhiệt độ và DO. Độ mặn, Ammonia và Nitrite phải đo bằng '
                    + 'bộ test tay — hệ thống không tự biết được.',
            };
        },
    },

    {
        ma: 'lich_cu_an',
        tu: ['chia cu', 'may cu', 'bao nhieu cu', 'gio cho an', 'lich cho an', 'cu an luc may'],
        goi_y: 'Chia cữ cho ăn thế nào?',
        traLoi(ctx) {
            const l = kb.loaiTom(ctx.loai);
            const lich = kb.lichCu(ctx.loai, ctx.ngayTuoi);
            const kh = ctx.khauPhan;

            const chiTiet = lich.cu.map(c => {
                let nd = `${c.phan_tram}% tổng lượng cám trong ngày`;
                if (kh && kh.ok) nd += ` (≈ ${dinhDangSo(kh.camNgayKg * c.phan_tram / 100)} kg)`;
                if (c.ghi_chu) nd += ` — ${c.ghi_chu}`;
                return { tieu_de: `Cữ ${c.gio}`, noi_dung: nd };
            });

            const np = lich.nhip_phun;
            chiTiet.push({
                tieu_de: 'Nhịp phun của máy',
                noi_dung: `Phun ${khoang(np.phun_giay, 'giây')}, nghỉ ${khoang(np.nghi_phut, 'phút')}. `
                    + lich.vi_sao_nhip,
            });

            return {
                tra_loi: `${l.ten} cài ${lich.cu.length} cữ/ngày. Các cữ KHÔNG chia đều nhau — `
                    + 'cữ chiều luôn nặng nhất.',
                chi_tiet: chiTiet,
                luu_y: ctx.ngayTuoi !== null && ctx.ngayTuoi <= kb.TOM_BABY.den_ngay_tuoi
                    ? `Tôm ao bạn mới ${ctx.ngayTuoi} ngày tuổi — ${kb.TOM_BABY.ket_luan}`
                    : null,
            };
        },
    },

    {
        ma: 'tom_baby',
        tu: ['moi tha', 'tom nho', 'tom baby', 'thang dau', 'dung may duoc chua', 'may cho an duoc chua'],
        goi_y: 'Tôm mới thả dùng máy cho ăn được chưa?',
        traLoi(ctx) {
            const b = kb.TOM_BABY;
            return {
                tra_loi: b.ket_luan,
                chi_tiet: [
                    { tieu_de: 'Vì sao', noi_dung: b.vi_sao },
                    { tieu_de: 'Nếu cứ bật máy', noi_dung: b.hau_qua },
                    { tieu_de: 'Cho ăn tay thì được gì', noi_dung: b.loi_ich },
                ],
                so_lieu_that: ctx.ngayTuoi === null
                    ? 'Ao chưa khai ngày thả giống nên chưa biết tôm mấy ngày tuổi.'
                    : (ctx.ngayTuoi <= b.den_ngay_tuoi
                        ? `Ao bạn mới ${ctx.ngayTuoi} ngày tuổi — CHƯA được dùng máy.`
                        : `Ao bạn đã ${ctx.ngayTuoi} ngày tuổi — dùng máy được rồi.`),
            };
        },
    },

    {
        ma: 'fcr',
        tu: ['fcr', 'he so thuc an', 'ton cam', 'an ton cam khong', 'he so chuyen doi'],
        goi_y: 'FCR bao nhiêu là tốt?',
        traLoi(ctx) {
            const l = kb.loaiTom(ctx.loai);
            const b = kb.FCR[kb.chuanHoaLoai(ctx.loai) || 'the'];

            const chiTiet = [
                {
                    tieu_de: 'Cách tính',
                    noi_dung: 'FCR tuần = tổng cám đã cho ăn trong tuần (kg) ÷ (sinh khối cuối tuần − '
                        + 'sinh khối đầu tuần) (kg). Nghĩa là ăn hết mấy ký cám mới tăng được 1 ký tôm.',
                },
                {
                    tieu_de: 'Dải chuẩn',
                    noi_dung: `${l.ten}: FCR ${b.chuan[0]}–${b.chuan[1]} là bình thường. `
                        + `Từ ${b.do_tu} trở lên là cảnh báo đỏ.`,
                },
                { tieu_de: 'Khi FCR vọt cao', noi_dung: b.y_nghia_do },
            ];
            if (b.y_nghia_qua_thap) {
                chiTiet.push({ tieu_de: 'Khi FCR quá thấp', noi_dung: b.y_nghia_qua_thap });
            }
            if (b.ghi_chu) chiTiet.push({ tieu_de: 'Ghi chú', noi_dung: b.ghi_chu });

            return {
                tra_loi: `FCR là số ký cám cần để tạo ra 1 ký tôm — càng thấp càng đỡ tốn, `
                    + `nhưng thấp bất thường cũng là dấu hiệu xấu.`,
                chi_tiet: chiTiet,
                luu_y: 'Hệ thống chưa tự tính FCR cho ao bạn vì cần hai lần chài mẫu cách nhau một '
                    + 'tuần và tổng lượng cám đã xả trong tuần đó.',
            };
        },
    },

    {
        ma: 'chai_mau_cach',
        tu: ['chai mau the nao', 'cach chai', 'can tom', 'do trong luong', 'abw', 'chai bao nhieu con'],
        goi_y: 'Chài mẫu thế nào cho đúng?',
        traLoi() {
            const c = kb.CHAI_MAU;
            return {
                tra_loi: `${c.cong_thuc}. Ví dụ: ${c.vi_du}.`,
                chi_tiet: [
                    ...c.cac_buoc.map((b, i) => ({ tieu_de: `Bước ${i + 1}`, noi_dung: b })),
                    { tieu_de: 'Vì sao vài chục con là đủ', noi_dung: c.vi_sao_dung },
                ],
                luu_y: c.luu_y.join(' '),
            };
        },
    },

    {
        ma: 'canh_bao_do',
        tu: ['canh bao do', 'gap su co', 'xu ly the nao', 'cap cuu', 'tom noi dau lam gi',
            'mat dien', 'quat hong'],
        goi_y: 'Gặp cảnh báo đỏ thì làm gì?',
        traLoi(ctx) {
            const ds = kb.kichBan(ctx.loai);
            return {
                tra_loi: 'Bốn tình huống hay gặp nhất và việc cần làm ngay:',
                chi_tiet: ds.map(k => ({
                    tieu_de: k.ten,
                    noi_dung: (k.khi_nao ? k.khi_nao + ' → ' : '') + k.viec_can_lam.join(' '),
                })),
                luu_y: 'Việc cần làm ở đây là xử lý ngoài ao, hệ thống không tự làm thay được. '
                    + 'Guồng oxy và máy bơm thì ESP32 tự bật theo ngưỡng ngay tại ao.',
            };
        },
    },

    {
        ma: 'khoa_cho_an',
        tu: ['ngung cho an', 'ngat may', 'khoa may', 'khong cho an', 'lien dong', 'dung cho an',
            'khi nao ngung'],
        goi_y: 'Khi nào phải ngưng cho ăn?',
        traLoi(ctx) {
            const chiTiet = kb.KHOA_CHO_AN.map(k => ({
                tieu_de: k.dieu_kien,
                noi_dung: `${k.hanh_dong}. ${k.vi_sao}`,
            }));

            let that = null;
            if (ctx.online && ctx.do !== null) {
                that = ctx.do < 4.0
                    ? `Ao bạn đang DO ${ctx.do} mg/L — DƯỚI ngưỡng, phải ngưng cho ăn.`
                    : `Ao bạn đang DO ${ctx.do} mg/L — trên ngưỡng, cho ăn bình thường.`;
            }

            return {
                tra_loi: 'Có hai điều kiện bắt buộc khoá máy cho ăn:',
                chi_tiet: chiTiet,
                so_lieu_that: that,
                luu_y: 'Đây là khoá cứng, không phải gợi ý. Xả cám lúc thiếu oxy là cách nhanh nhất '
                    + 'làm chết cả ao.',
            };
        },
    },

    {
        ma: 'tha_giong_khi_nao',
        tu: ['khi nao tha', 'tha giong thang may', 'mua vu tha', 'tha luc may gio', 'thuan tom'],
        goi_y: 'Khi nào thả giống là tốt nhất?',
        traLoi(ctx) {
            const t = kb.THA_GIONG;
            return {
                tra_loi: `Nên thả vào ${t.gio_nen_tha}`,
                chi_tiet: [
                    { tieu_de: 'Mùa vụ tốt nhất', noi_dung: t.mua_tot },
                    { tieu_de: 'Mùa nên tránh', noi_dung: t.mua_tranh },
                    ...t.gio_tranh.map(g => ({ tieu_de: 'Giờ phải tránh', noi_dung: g })),
                    { tieu_de: 'Thuần hoá trước khi thả', noi_dung: t.thuan_hoa },
                ],
                so_lieu_that: `Hiện đang ${ctx.mua.ten.toLowerCase()} (tháng ${ctx.thang}).`,
            };
        },
    },
];

/** '28–32 °C', 'từ 5 mg/L trở lên', 'dưới 0.05 mg/L' — tuỳ kiểu ngưỡng. */
function moTaNguong(m) {
    const dv = m.don_vi ? ' ' + m.don_vi : '';
    let s;
    if (m.toi_uu) s = `Tối ưu ${m.toi_uu[0]}–${m.toi_uu[1]}${dv}`;
    else if (m.toi_uu_tu !== undefined) s = `Tối ưu từ ${m.toi_uu_tu}${dv} trở lên`;
    else if (m.toi_uu_den !== undefined) s = `Tối ưu dưới ${m.toi_uu_den}${dv}`;
    else s = 'Chưa có dải tối ưu';

    const nguy = [];
    if (m.nguy_hiem_duoi !== undefined) nguy.push(`dưới ${m.nguy_hiem_duoi}${dv}`);
    if (m.nguy_hiem_tren !== undefined) nguy.push(`trên ${m.nguy_hiem_tren}${dv}`);
    if (nguy.length) s += `. Nguy hiểm khi ${nguy.join(' hoặc ')}`;
    return s;
}

/** 'DO 4.2 (thấp)' — doi chieu 1 so do thuc voi nguong. */
function soSanh(ten, giaTri, m) {
    let nhan = 'ổn';
    if (m.nguy_hiem_duoi !== undefined && giaTri < m.nguy_hiem_duoi) nhan = 'NGUY HIỂM';
    else if (m.nguy_hiem_tren !== undefined && giaTri > m.nguy_hiem_tren) nhan = 'NGUY HIỂM';
    else if (m.toi_uu && (giaTri < m.toi_uu[0] || giaTri > m.toi_uu[1])) nhan = 'lệch khỏi dải tối ưu';
    else if (m.toi_uu_tu !== undefined && giaTri < m.toi_uu_tu) nhan = 'thấp';
    return `${ten} ${giaTri} (${nhan})`;
}

/** [5, 10] -> '5–10 giây'. [5, 5] -> '5 giây'. */
function khoang(v, dv) {
    return v[0] === v[1] ? `${v[0]} ${dv}` : `${v[0]}–${v[1]} ${dv}`;
}

function dinhDangSo(v) {
    return Number.isFinite(Number(v))
        ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(v))
        : '--';
}

/** Danh sach cau goi y de hien thanh cac nut bam. */
function goiYCauHoi() {
    return CAU_HOI.map(c => ({ ma: c.ma, cau: c.goi_y }));
}

// ================================================================
// HANG RAO PHAM VI
// ----------------------------------------------------------------
// Tro ly nay KHONG duoc tra loi bat cu chuyen gi ngoai nuoi tom va
// ao cua nguoi dung.
//
// Vi sao phai chan cung o day: bo doi chieu tu khoa ben duoi cham
// diem theo so tu trung. Mot cau hoan toan lac de van co the trung
// dung mot tu (vi du "thu hoach" trong cau hoi ve lua) roi duoc gan
// vao mot chu de nuoi tom va nhan mot cau tra loi nghe rat chac
// chan. Nguoi nuoi tin loi cua may.
//
// Nen: cau hoi phai cham it nhat MOT tu khoa nganh o duoi, hoac
// phai trung it nhat HAI tu khoa cua cung mot chu de, thi moi duoc
// tra loi. Khong thi noi thang la ngoai pham vi.
// ================================================================
const TU_KHOA_NGANH = [
    // Con tom va cai ao
    'tom', 'ao', 'ao nuoi', 'nuoc ao', 'chat luong nuoc', 'day ao', 'bo ao', 'vuong',
    // Cho an
    'cho an', 'thuc an', 'cam', 'khau phan', 'cu an', 'sang an', 'fcr', 'sinh khoi',
    'xa moi', 'cat moi', 'bo an',
    // Moi truong
    'oxy', 'do hoa tan', 'ph', 'nhiet do', 'do man', 'khi doc', 'ammonia', 'nitrite', 'tan',
    'tao', 'kiem', 'khoang', 'moi truong',
    // Con giong, vong nuoi
    'giong', 'tha', 'ngay tuoi', 'lot xac', 'lot vo', 'thu hoach', 'chai mau', 'abw',
    'size', 'ty le song', 'doc',
    // Benh
    'benh', 'dom trang', 'wssv', 'vibrio', 'ehp', 'gan tuy', 'phan trang', 'dau vang',
    // Thiet bi
    'quat', 'guong', 'bom', 'may cho an', 'relay', 'esp32', 'cam bien', 'thiet bi', 'tu dien',
    // Xu ly
    'voi', 'vi sinh', 'ri duong', 'zeolite', 'chlorine', 'siphong', 'probiotic',
    // Van hanh he thong
    'canh bao', 'bao dong', 'su co', 'gia tom', 'thi truong',
];

// Khop theo RANH GIOI TU, khong phai chuoi con.
//
// Ban dau dung t.includes(tu) va lot ngay: 'ph' trung trong "pho",
// 'cam' trung trong "cam on", 'nuoc' trung trong "nuoc Phap". Cau hoi
// hoan toan lac de van duoc coi la thuoc nganh.
//
// Tieng Viet viet roi tung am tiet nen \b hoat dong dung.
const RE_NGANH = new RegExp(
    '\\b(' + TU_KHOA_NGANH.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b'
);

/** Cau hoi co dinh dang den nuoi tom khong. `t` da bo dau, viet thuong. */
function trongPhamVi(t) {
    return RE_NGANH.test(t);
}

/**
 * Tra loi mot cau hoi.
 * @param {string} question
 * @param {number} userId
 * @param {string} pondId  ao dang xem
 */
function traLoi(question, userId, pondId) {
    const q = String(question || '').trim();
    if (!q) return { ok: false, error: 'Chưa có câu hỏi' };

    const t = boDau(q);

    // Tim cau hoi khop nhat (dem so tu khoa trung)
    let tot = null, diemTot = 0;
    for (const c of CAU_HOI) {
        let diem = 0;
        for (const tu of c.tu) if (t.includes(tu)) diem++;
        if (diem > diemTot) { diemTot = diem; tot = c; }
    }

    // Dung boi canh ao that
    const ponds = db.pondList(userId);
    const aoDung = pondId && db.pondGet(pondId) ? pondId : (ponds[0] ? ponds[0].pond_id : null);

    let ctx = { mua: advisor.muaHienTai(new Date().getMonth() + 1), thang: new Date().getMonth() + 1,
        nhietDo: null, do: null, ph: null, online: false, sizeConKg: null, khauPhan: null,
        loiKhuyenThiTruong: null, gia: null, loai: null, ngayTuoi: null };

    if (aoDung) {
        const bc = advisor.boiCanh(aoDung);
        if (bc) {
            const pt = advisor.phanTich(aoDung);
            ctx = {
                ...bc,
                // Loai tom cua ao. Chua khai bao thi kb tu lui ve tom the -
                // loai pho bien nhat - va cau tra loi van noi ro dang noi ve loai nao.
                loai: kb.chuanHoaLoai(bc.pond.seed_type),
                khauPhan: bc.feed ? require('./feed').tinhKhauPhan({
                    seedCount: bc.feed.seed_count, survivalPct: bc.feed.survival_pct,
                    avgWeightG: bc.feed.avg_weight_g, ratePct: bc.feed.rate_pct,
                    mealsPerDay: bc.feed.meals_per_day,
                }, {}) : null,
                loiKhuyenThiTruong: (pt.loi_khuyen || []).find(x => x.nhom === 'thi_truong') || null,
                gia: layGiaTieuBieu(),
            };
        }
    }

    // --- HANG RAO PHAM VI ---
    // Trung 1 tu khoa cua chu de thoi thi chua du: phai co dau hieu ro rang
    // day la cau hoi nuoi tom, hoac phai trung tu 2 tu khoa tro len.
    const lienQuan = trongPhamVi(t);
    if (!lienQuan && diemTot < 2) {
        return {
            ok: true,
            hieu_duoc: false,
            ngoai_pham_vi: true,
            cau_hoi: q,
            tra_loi: 'Mình chỉ trả lời được về nuôi tôm và ao của bạn — môi trường nước, cho ăn, '
                + 'con giống, bệnh, thiết bị ngoài ao và giá tôm. Câu này nằm ngoài phạm vi đó '
                + 'nên mình không trả lời, để tránh nói sai.',
            goi_y: goiYCauHoi(),
            ghi_chu: 'Trợ lý VAST chỉ dùng số liệu trong tài liệu kỹ thuật của nhóm và số đo thật '
                + 'của ao. Không phải mô hình ngôn ngữ, không tự suy ra kiến thức ngoài.',
        };
    }

    if (!tot) {
        return {
            ok: true,
            hieu_duoc: false,
            ngoai_pham_vi: false,
            cau_hoi: q,
            tra_loi: 'Câu này đúng là chuyện nuôi tôm nhưng mình chưa có mục trả lời cho nó. '
                + 'Chọn một câu gợi ý bên dưới, hoặc hỏi ngắn gọn hơn.',
            goi_y: goiYCauHoi(),
            ghi_chu: 'Đây là cố vấn dựa trên luật, chưa phải trợ lý hiểu được mọi câu hỏi.',
        };
    }

    const kq = tot.traLoi(ctx);
    return {
        ok: true,
        hieu_duoc: true,
        cau_hoi: q,
        chu_de: tot.ma,
        ...kq,
        pond_name: aoDung ? (db.pondGet(aoDung) || {}).name : null,
        goi_y: goiYCauHoi().filter(g => g.ma !== tot.ma),
        ghi_chu: 'Cố vấn dựa trên luật + số liệu thật của ao, không phải mô hình ngôn ngữ.',
    };
}

/** Lay 1 muc gia tieu bieu cua tom the va tom su de so sanh. */
function layGiaTieuBieu() {
    try {
        const market = require('./market');
        const items = market.snapshot({}).items || [];
        const the = items.filter(i => i.species === 'the' && !i.is_seed && i.unit === 'đ/kg')
            .sort((a, b) => (a.size ?? 999) - (b.size ?? 999))[0] || null;
        const su = items.filter(i => i.species === 'su' && !i.is_seed && i.unit === 'đ/kg')
            .sort((a, b) => (a.size ?? 999) - (b.size ?? 999))[0] || null;
        return (the || su) ? { the, su } : null;
    } catch {
        return null;
    }
}

module.exports = {
    phanLoaiNhatKy,
    traLoi,
    goiYCauHoi,
    LOAI_VIEC,
    _internals: { boDau, doiSoChu, timAo, timLoaiViec, timSoLieu },
};
