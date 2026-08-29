// ================================================================
// advisor.js - CO VAN NUOI TOM DUA TREN SO LIEU THAT CUA AO
//
// KHONG CAN npm install. Day la MODULE LUAT, khong goi mo hinh ngon ngu nao.
//
// ================================================================
// NOI RO DAY LA CAI GI
// ----------------------------------------------------------------
// Day KHONG phai tri tue nhan tao biet suy nghi. Day la mot BO LUAT
// chay tren so lieu THAT cua ao ban: DO, nhiet do tu ESP32, ngay tuoi
// tom, gia thi truong, mua vu.
//
// Diem manh that su cua no khong phai la "thong minh", ma la
// NOI BANG SO CUA CHINH AO BAN:
//     "DO 3.1 mg/L luc 4 gio sang, tom 62 ngay tuoi"
// thay vi cau chung chung ai cung noi duoc:
//     "Nen duy tri oxy hoa tan tren 5 mg/L"
//
// Giao dien phai goi dung ten no, khong duoc dan nhan "AI" de nguoi
// dung tuong no thong minh hon thuc te.
//
// ================================================================
// GIOI HAN TU DAT RA - RAT QUAN TRONG
// ----------------------------------------------------------------
// 1. KHONG CHAN DOAN BENH.
//    Chi noi "dieu kien dang thuan loi cho benh X" dua tren nhiet do,
//    DO va mua vu. Muon biet ao co benh that khong PHAI XET NGHIEM MAU.
//    Nhin nuoc doan benh la cach mat ca vu tom.
//
// 2. KHONG KE THUOC, KHONG CHO LIEU LUONG.
//    Khang sinh dung sai lieu -> ton du -> lo hang bi tra ve, mat
//    ma so co so nuoi. Viec nay phai do can bo thu y thuy san quyet dinh.
//
// 3. MOI LOI KHUYEN PHAI KEM SO LIEU DUNG DE SUY RA.
//    Truong "can_cu" bat buoc co. Nguoi nuoi phai kiem duoc con so
//    tu dau ra thi moi dam tin.
// ================================================================

'use strict';

const db = require('../lib/db');
const feedCalc = require('./feed');

// ================================================================
// MUA VU DONG BANG SONG CUU LONG
// ----------------------------------------------------------------
// Day la dac diem mua vu pho bien vung nuoi tom DBSCL, dung de canh bao
// TRUOC khi chuyen mua - luc do la luc tom de soc nhat.
// ================================================================
const MUA_VU = {
    kho: {
        thang: [12, 1, 2, 3, 4],
        ten: 'Mùa khô',
        dac_diem: 'Nắng nóng, độ mặn tăng cao, nước bốc hơi nhanh',
        rui_ro: [
            'Nhiệt độ nước cao vào buổi trưa — tôm giảm ăn, dễ stress',
            'Độ mặn tăng dần, tôm lột xác khó',
            'Đáy ao tích tụ khí độc (NH₃, H₂S) do phân hủy nhanh',
        ],
    },
    mua: {
        thang: [5, 6, 7, 8, 9, 10, 11],
        ten: 'Mùa mưa',
        dac_diem: 'Mưa nhiều, độ mặn giảm, nước dễ phân tầng',
        rui_ro: [
            'Mưa lớn làm tụt pH và tụt độ mặn đột ngột — tôm sốc',
            'Nước phân tầng, tầng đáy thiếu oxy',
            'Giao mùa nhiệt độ dao động mạnh — thời điểm bệnh đốm trắng hay bùng phát',
        ],
    },
};

function muaHienTai(thang) {
    return MUA_VU.kho.thang.includes(thang) ? MUA_VU.kho : MUA_VU.mua;
}

// ================================================================
// DIEU KIEN THUAN LOI CHO TUNG BENH
// ----------------------------------------------------------------
// Day la CAC MOI LIEN HE DA DUOC GHI NHAN pho bien trong nghe nuoi tom,
// KHONG phai cong cu chan doan.
//
// Cach doc dung:
//   "Nhiet do 33 do + DO thap  ->  dieu kien thuan loi cho benh gan tuy"
//   KHONG co nghia la "ao ban dang bi benh gan tuy".
//
// Muon biet co benh that khong: quan sat tom (bo an, gan tuy nhat mau,
// ruot rong, tap trung bo ao) VA GUI MAU XET NGHIEM.
// ================================================================
const BENH = [
    {
        ma: 'AHPND',
        ten: 'Hoại tử gan tụy cấp (EMS/AHPND)',
        dieu_kien(ctx) {
            const t = ctx.nhietDo;
            const tuoi = ctx.ngayTuoi;
            if (!(t !== null && t > 32)) return null;

            const dungTuoi = tuoi !== null && tuoi >= 15 && tuoi <= 50;
            return {
                can_cu: dungTuoi
                    ? `Nhiệt độ ${t}°C (trên 32°C) và tôm ${tuoi} ngày tuổi — đúng giai đoạn và điều kiện bệnh hay xuất hiện`
                    : `Nhiệt độ ${t}°C (trên 32°C) — vi khuẩn Vibrio phát triển nhanh hơn`,
                // Chi noi ve giai doan khi tuoi tom THUC SU nam trong khoang do.
                // Noi "thuong gap o 20-45 ngay" trong khi tom da 65 ngay chi lam
                // nguoi doc roi tri, tuong he thong khong biet tom minh may tuoi.
                giai_doan: dungTuoi
                    ? `Tôm ${tuoi} ngày tuổi — nằm trong giai đoạn bệnh hay xuất hiện (20–45 ngày)`
                    : (tuoi !== null
                        ? `Tôm ${tuoi} ngày tuổi — đã qua giai đoạn dễ mắc nhất (20–45 ngày), nhưng nhiệt độ cao vẫn là điều kiện thuận lợi cho vi khuẩn`
                        : null),
            };
        },
        dau_hieu: 'Tôm bỏ ăn đột ngột, gan tụy nhạt màu hoặc teo, ruột rỗng, tôm tấp mé',
        phong: [
            'Giảm khẩu phần khi nhiệt độ vượt 32°C — cám thừa làm đáy ao bẩn thêm',
            'Tăng sục khí, đặc biệt lúc 3–6 giờ sáng',
            'Siphon đáy thường xuyên hơn',
        ],
    },
    {
        ma: 'WSSV',
        ten: 'Đốm trắng (WSSV)',
        dieu_kien(ctx) {
            const t = ctx.nhietDo;
            const gd = 'Có thể xuất hiện ở mọi giai đoạn nuôi, nặng nhất khi trời trở lạnh';
            if (t !== null && t < 25) {
                return { can_cu: `Nhiệt độ ${t}°C (dưới 25°C) — nước lạnh, sức đề kháng của tôm giảm mạnh`, giai_doan: gd };
            }
            if (t !== null && t < 28) {
                return { can_cu: `Nhiệt độ ${t}°C (dưới 28°C) — khoảng nhiệt độ bệnh đốm trắng hay bùng phát`, giai_doan: gd };
            }
            if (ctx.giaoMua) {
                return { can_cu: 'Đang giai đoạn giao mùa, nhiệt độ dao động mạnh giữa ngày và đêm', giai_doan: gd };
            }
            return null;
        },
        dau_hieu: 'Đốm trắng tròn dưới vỏ đầu ngực, tôm đỏ thân, dạt bờ, chết nhanh hàng loạt',
        phong: [
            'Không cấp nước trực tiếp từ kênh khi vùng đang có dịch',
            'Kiểm tra lưới chắn chim và cua còng — đây là đường lây chính',
            'Giữ mực nước sâu để nhiệt độ ít dao động',
        ],
    },
    {
        ma: 'PHAN_TRANG',
        ten: 'Bệnh phân trắng',
        dieu_kien(ctx) {
            const t = ctx.nhietDo;
            const tuoi = ctx.ngayTuoi;
            if (tuoi !== null && tuoi > 40 && t !== null && t > 31) {
                return {
                    can_cu: `Tôm ${tuoi} ngày tuổi, nhiệt độ ${t}°C — giai đoạn và nhiệt độ bệnh hay gặp`,
                    giai_doan: `Tôm ${tuoi} ngày tuổi — bệnh này thường từ 40 ngày trở đi`,
                };
            }
            return null;
        },
        dau_hieu: 'Phân trắng nổi trên mặt nước hoặc trong nhá, tôm chậm lớn, ruột đứt khúc',
        phong: [
            'Kiểm tra sàng ăn kỹ — cho ăn thừa là nguyên nhân hàng đầu',
            'Xử lý đáy ao định kỳ bằng vi sinh',
        ],
    },
    {
        ma: 'THIEU_OXY',
        ten: 'Thiếu oxy về đêm',
        dieu_kien(ctx) {
            const d = ctx.do;
            if (d !== null && d < 5) {
                return {
                    can_cu: `DO hiện tại ${d} mg/L — ban đêm tảo hô hấp sẽ còn kéo xuống thấp hơn nữa`,
                    giai_doan: 'Nặng nhất lúc 3–6 giờ sáng',
                };
            }
            return null;
        },
        dau_hieu: 'Tôm nổi đầu, tấp mé, bơi lờ đờ trên mặt vào sáng sớm',
        phong: [
            'Chạy quạt/sục khí suốt đêm, không tắt',
            'Giảm cho ăn cữ cuối ngày',
        ],
    },
];

// ================================================================
// TIEN ICH
// ================================================================
const so = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const lamTron = (v, n = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : null);
const dinhDang = v => (Number.isFinite(Number(v))
    ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(v)) : '--');

/**
 * Gom toan bo boi canh cua 1 ao: cam bien, khau phan, gia thi truong, mua vu.
 * Moi loi khuyen ben duoi deu doc tu day.
 */
function boiCanh(pondId, opts = {}) {
    const pond = db.pondGet(String(pondId));
    if (!pond) return null;

    const device = db.listDevices().find(d => d.pond_id === pond.pond_id) || null;
    const latest = device ? db.getLatest(device.device_id) : null;

    // Thiet bi mat ket noi -> so cam bien la SO CU, khong duoc dung de khuyen
    const online = device && device.last_seen
        ? (Date.now() - Date.parse(device.last_seen)) / 1000 <= 60
        : false;

    const f = db.feedGet(pond.pond_id);

    let ngayTuoi = null;
    if (pond.stocking_date) {
        ngayTuoi = Math.max(0, Math.round((Date.now() - Date.parse(pond.stocking_date)) / 86400000));
    }

    const now = opts.now ? new Date(opts.now) : new Date();
    const thang = now.getMonth() + 1;
    const gio = now.getHours();
    const mua = muaHienTai(thang);

    // Giao mua = thang dau va cuoi cua moi mua
    const giaoMua = [4, 5, 11, 12].includes(thang);

    const sizeConKg = (f && f.avg_weight_g > 0) ? Math.round(1000 / f.avg_weight_g) : null;

    return {
        pond,
        device,
        online,
        nhietDo: online && latest ? so(latest.temperature) : null,
        do: online && latest ? so(latest.do_value) : null,
        ph: online && latest ? so(latest.ph) : null,
        guongDangBat: !!(latest && latest.aerator_status),
        bomDangBat: !!(latest && latest.pump_status),

        feed: f,
        ngayTuoi,
        sizeConKg,
        trongLuongTB: f ? so(f.avg_weight_g) : null,
        soGiong: pond.seed_count || (f ? f.seed_count : null),
        tyLeSong: f ? so(f.survival_pct) : null,

        thang, gio, mua, giaoMua,
        now,
    };
}

// ================================================================
// SINH LOI KHUYEN
// ================================================================

function khuyen(muc, nhom, tieuDe, noiDung, canCu, viecCanLam) {
    return {
        muc,                 // 'nguy_hiem' | 'canh_bao' | 'goi_y' | 'thong_tin'
        nhom,                // 'oxy' | 'nhiet_do' | 'benh' | 'thi_truong' | 'cho_an' | 'mua_vu'
        tieu_de: tieuDe,
        noi_dung: noiDung,
        can_cu: canCu,       // BAT BUOC: so lieu dung de suy ra loi khuyen nay
        viec_can_lam: viecCanLam || [],
    };
}

/** Nhom 1: OXY - viec gap nhat, luon xet dau tien. */
function luatOxy(ctx) {
    const ra = [];
    if (ctx.do === null) {
        if (!ctx.online) {
            ra.push(khuyen('canh_bao', 'oxy', 'Không đọc được oxy',
                'Thiết bị đang mất kết nối nên không biết oxy trong ao hiện bao nhiêu. '
                + 'Số cũ trên màn hình không dùng để quyết định được.',
                'ESP32 không gửi số liệu về',
                ['Kiểm tra nguồn điện và Wi-Fi của thiết bị', 'Ra ao quan sát tôm trực tiếp']));
        }
        return ra;
    }

    if (ctx.do < 3) {
        ra.push(khuyen('nguy_hiem', 'oxy', 'Oxy ở mức nguy hiểm',
            `DO chỉ còn ${ctx.do} mg/L. Dưới 3 mg/L tôm bắt đầu ngạt, kéo dài vài giờ là chết hàng loạt.`,
            `DO ${ctx.do} mg/L đo lúc ${String(ctx.gio).padStart(2, '0')} giờ`,
            [
                'Chạy toàn bộ quạt và sục khí NGAY',
                'NGƯNG cho ăn cho tới khi DO lên trên 4 mg/L',
                'Thay 20–30% nước nếu có nguồn nước sạch',
                'Ra ao xem tôm có nổi đầu, tấp mé không',
            ]));
    } else if (ctx.do < 4) {
        ra.push(khuyen('canh_bao', 'oxy', 'Oxy thấp',
            `DO ${ctx.do} mg/L. Tôm còn sống được nhưng ăn kém và chậm lớn.`,
            `DO ${ctx.do} mg/L, ngưỡng an toàn là trên 5 mg/L`,
            ['Bật thêm quạt', 'Giảm nửa khẩu phần cữ tới']));
    } else if (ctx.do < 5) {
        ra.push(khuyen('goi_y', 'oxy', 'Oxy hơi thấp',
            `DO ${ctx.do} mg/L, chưa nguy hiểm nhưng nên nâng lên trên 5.`,
            `DO ${ctx.do} mg/L`,
            ['Bật quạt sớm hơn thường lệ']));
    }

    // Rang sang la luc oxy thap nhat trong ngay
    if (ctx.gio >= 22 || ctx.gio <= 6) {
        if (ctx.do < 6) {
            ra.push(khuyen('canh_bao', 'oxy', 'Đang vào giờ oxy thấp nhất trong ngày',
                'Từ khoảng 3 đến 6 giờ sáng tảo ngừng quang hợp và chuyển sang hô hấp, '
                + 'oxy trong ao xuống thấp nhất. Đây là lúc tôm hay nổi đầu.',
                `Hiện ${String(ctx.gio).padStart(2, '0')} giờ, DO đang ${ctx.do} mg/L`,
                ['Không tắt quạt qua đêm', 'Dậy xem ao khoảng 4–5 giờ sáng']));
        }
    }
    return ra;
}

/** Nhom 2: NHIET DO. */
function luatNhietDo(ctx) {
    const ra = [];
    if (ctx.nhietDo === null) return ra;
    const t = ctx.nhietDo;

    if (t > 33) {
        ra.push(khuyen('canh_bao', 'nhiet_do', 'Nước quá nóng',
            `Nhiệt độ ${t}°C. Trên 33°C tôm giảm ăn rõ rệt, đồng thời oxy hòa tan trong nước cũng giảm theo.`,
            `Nhiệt độ nước ${t}°C`,
            ['Nâng mực nước ao lên cao hơn', 'Giảm khẩu phần cữ trưa', 'Chạy quạt để đảo nước, tránh phân tầng']));
    } else if (t > 32) {
        ra.push(khuyen('goi_y', 'nhiet_do', 'Nước nóng',
            `Nhiệt độ ${t}°C, vượt ngưỡng thoải mái của tôm (28–32°C).`,
            `Nhiệt độ nước ${t}°C`,
            ['Giảm khoảng 20% khẩu phần', 'Kiểm tra sàng ăn kỹ hơn bình thường']));
    } else if (t < 25) {
        ra.push(khuyen('canh_bao', 'nhiet_do', 'Nước lạnh',
            `Nhiệt độ ${t}°C. Dưới 25°C tôm ăn rất kém và sức đề kháng giảm.`,
            `Nhiệt độ nước ${t}°C`,
            ['Giảm mạnh khẩu phần, tránh cám thừa thối đáy', 'Giữ mực nước sâu để ổn định nhiệt']));
    }
    return ra;
}

/** Nhom 3: DIEU KIEN BENH - chi canh bao dieu kien, KHONG chan doan. */
function luatBenh(ctx) {
    const ra = [];
    for (const b of BENH) {
        const dk = b.dieu_kien(ctx);
        if (!dk) continue;

        // dieu_kien() tra ve { can_cu, giai_doan }. giai_doan chi co khi
        // no dung voi tuoi tom hien tai - khong noi cau lac de.
        const canCu = typeof dk === 'string' ? dk : dk.can_cu;
        const giaiDoan = typeof dk === 'string' ? null : dk.giai_doan;

        ra.push(khuyen('canh_bao', 'benh', `Điều kiện thuận lợi cho ${b.ten}`,
            (giaiDoan ? giaiDoan + '. ' : '') + `Dấu hiệu cần để ý: ${b.dau_hieu}.`,
            canCu,
            [
                ...b.phong,
                'Thấy dấu hiệu nghi ngờ thì GỬI MẪU XÉT NGHIỆM, đừng đoán bệnh bằng mắt',
            ]));
    }

    if (ra.length) {
        ra.push(khuyen('thong_tin', 'benh', 'Lưu ý về các cảnh báo bệnh ở trên',
            'Hệ thống chỉ đối chiếu nhiệt độ, oxy, ngày tuổi và mùa vụ để nói điều kiện đang '
            + 'thuận lợi cho bệnh nào. Nó KHÔNG chẩn đoán được ao bạn có bệnh hay không, '
            + 'và KHÔNG kê thuốc. Muốn biết chắc phải gửi mẫu xét nghiệm; dùng kháng sinh phải '
            + 'do cán bộ thú y thủy sản chỉ định — dùng sai gây tồn dư, lô hàng bị trả về.',
            'Giới hạn của hệ thống', []));
    }
    return ra;
}

/** Nhom 4: MUA VU. */
function luatMuaVu(ctx) {
    const ra = [];
    ra.push(khuyen('thong_tin', 'mua_vu', `${ctx.mua.ten} — tháng ${ctx.thang}`,
        `${ctx.mua.dac_diem}. Cần để ý: ${ctx.mua.rui_ro.join('; ')}.`,
        `Tháng ${ctx.thang}, vùng Đồng bằng sông Cửu Long`,
        ctx.mua === MUA_VU.mua
            ? ['Chuẩn bị sẵn vôi nông nghiệp để tạt bờ khi mưa lớn', 'Sau mưa kiểm tra pH ngay']
            : ['Theo dõi độ mặn tăng', 'Siphon đáy thường xuyên hơn']));

    if (ctx.giaoMua) {
        ra.push(khuyen('canh_bao', 'mua_vu', 'Đang giai đoạn giao mùa',
            'Nhiệt độ dao động mạnh giữa ngày và đêm, tôm dễ bị sốc. '
            + 'Đây cũng là thời điểm bệnh đốm trắng hay bùng phát trong vùng.',
            `Tháng ${ctx.thang} là tháng chuyển mùa`,
            ['Giữ mực nước sâu để nhiệt độ ít dao động', 'Hạn chế thay nước nhiều một lúc']));
    }
    return ra;
}

/** Nhom 5: CHO AN. */
function luatChoAn(ctx) {
    const ra = [];
    const f = ctx.feed;

    if (!f || !f.avg_weight_g) {
        ra.push(khuyen('goi_y', 'cho_an', 'Chưa có số chài mẫu',
            'Không có trọng lượng trung bình thì không tính được sinh khối, '
            + 'nên cũng không tính được khẩu phần. Đây là con số quyết định cả việc cho ăn.',
            'Ao chưa ghi nhận lần chài mẫu nào',
            ['Chài khoảng 30 con, cân lên rồi nhập vào mục Chài mẫu']));
        return ra;
    }

    // Chai mau qua lau -> so sinh khoi dang dung da cu
    if (f.sample_at) {
        const ngay = Math.round((Date.now() - Date.parse(f.sample_at)) / 86400000);
        if (ngay > 10) {
            ra.push(khuyen('canh_bao', 'cho_an', 'Số chài mẫu đã cũ',
                `Lần chài gần nhất cách đây ${ngay} ngày. Tôm lớn lên mỗi ngày, `
                + 'dùng số cũ để tính khẩu phần là cho ăn thiếu.',
                `Chài mẫu lần cuối ${ngay} ngày trước`,
                ['Chài mẫu lại tuần này']));
        }
    }

    // Kho cam sap het
    if (f.feed_stock_kg !== null && f.feed_stock_max_kg) {
        const kh = feedCalc.tinhKhauPhan({
            seedCount: f.seed_count, survivalPct: f.survival_pct, avgWeightG: f.avg_weight_g,
            ratePct: f.rate_pct, mealsPerDay: f.meals_per_day,
            feedStockKg: f.feed_stock_kg, feedStockMaxKg: f.feed_stock_max_kg,
        }, {});
        if (kh.ok && kh.soNgayConCam !== null && kh.soNgayConCam < 2) {
            ra.push(khuyen('canh_bao', 'cho_an', 'Sắp hết cám trong máy',
                `Còn ${dinhDang(f.feed_stock_kg)} kg, với khẩu phần hiện tại chỉ đủ khoảng `
                + `${dinhDang(kh.soNgayConCam)} ngày.`,
                `Kho ${dinhDang(f.feed_stock_kg)} kg / khẩu phần ${dinhDang(kh.camNgayKg)} kg mỗi ngày`,
                ['Nạp thêm cám vào máy']));
        }
    }
    return ra;
}

/** Nhom 6: THI TRUONG - nen ban bay gio hay nuoi them. */
function luatThiTruong(ctx, giaThiTruong) {
    const ra = [];
    if (!ctx.sizeConKg || !giaThiTruong || !giaThiTruong.length) return ra;

    const loai = (ctx.pond.seed_type || '').toLowerCase().includes('sú') ? 'su' : 'the';
    const bang = giaThiTruong
        .filter(i => i.species === loai && !i.is_seed && i.unit === 'đ/kg' && Number.isFinite(i.size))
        .sort((a, b) => a.size - b.size);
    if (bang.length < 2) return ra;

    // Tim muc gia gan voi co tom hien tai nhat
    let hienTai = bang[0];
    for (const i of bang) {
        if (Math.abs(i.size - ctx.sizeConKg) < Math.abs(hienTai.size - ctx.sizeConKg)) hienTai = i;
    }
    // Size nho hon = con to hon = gia cao hon
    const toHon = bang.filter(i => i.size < hienTai.size).sort((a, b) => b.size - a.size)[0];
    if (!toHon) {
        ra.push(khuyen('thong_tin', 'thi_truong', 'Tôm đã đạt cỡ lớn nhất trong bảng giá',
            `Cỡ hiện tại khoảng ${ctx.sizeConKg} con/kg, giá ${dinhDang(hienTai.price)} đ/kg.`,
            `Bảng giá ${hienTai.region || 'thị trường'}, cập nhật ${hienTai.source_date || 'gần nhất'}`,
            ['Cân nhắc thu hoạch']));
        return ra;
    }

    const chenh = toHon.price - hienTai.price;
    if (chenh <= 0) return ra;

    // Uoc san luong hien tai
    const soTom = feedCalc.tinhSoTom(ctx.soGiong, ctx.tyLeSong || 85);
    const sinhKhoi = feedCalc.tinhSinhKhoi(soTom, ctx.trongLuongTB);

    ra.push(khuyen('goi_y', 'thi_truong', 'Chênh lệch giá giữa hai cỡ tôm',
        `Tôm đang khoảng ${ctx.sizeConKg} con/kg, giá ${dinhDang(hienTai.price)} đ/kg. `
        + `Nuôi lên ${toHon.size} con/kg thì được ${dinhDang(toHon.price)} đ/kg — `
        + `chênh ${dinhDang(chenh)} đ mỗi ký.`
        + (sinhKhoi > 0 ? ` Với khoảng ${dinhDang(lamTron(sinhKhoi, 0))} kg tôm dưới ao, phần chênh này là ${dinhDang(lamTron(chenh * sinhKhoi, 0))} đ.` : ''),
        `Bảng giá ${hienTai.region || 'thị trường'}${hienTai.source_date ? ', ngày ' + hienTai.source_date : ''}`
        + (sinhKhoi > 0 ? ` · sinh khối ước ${dinhDang(lamTron(sinhKhoi, 0))} kg` : ''),
        [
            'Trừ tiếp tiền cám và tiền điện của những ngày nuôi thêm rồi mới quyết định',
            'Giá này là giá tham khảo, chốt bán vẫn phải hỏi thương lái',
        ]));

    return ra;
}

// ================================================================
// PHAN TICH MOT AO
// ================================================================
function phanTich(pondId, opts = {}) {
    const ctx = boiCanh(pondId, opts);
    if (!ctx) return { ok: false, error: 'Không tìm thấy ao' };

    let giaThiTruong = [];
    try {
        const market = require('./market');
        giaThiTruong = market.snapshot({}).items || [];
    } catch { /* khong co gia thi bo qua phan thi truong */ }

    const tatCa = [
        ...luatOxy(ctx),
        ...luatNhietDo(ctx),
        ...luatBenh(ctx),
        ...luatChoAn(ctx),
        ...luatThiTruong(ctx, giaThiTruong),
        ...luatMuaVu(ctx),
    ];

    // Viec gap len truoc
    const thuTu = { nguy_hiem: 0, canh_bao: 1, goi_y: 2, thong_tin: 3 };
    tatCa.sort((a, b) => thuTu[a.muc] - thuTu[b.muc]);

    return {
        ok: true,
        pond_id: ctx.pond.pond_id,
        pond_name: ctx.pond.name,
        cam_bien_online: ctx.online,
        tom_tat: {
            nhiet_do: ctx.nhietDo,
            do: ctx.do,
            ngay_tuoi: ctx.ngayTuoi,
            co_tom: ctx.sizeConKg ? `${ctx.sizeConKg} con/kg` : null,
            mua: ctx.mua.ten,
        },
        so_viec_gap: tatCa.filter(x => x.muc === 'nguy_hiem').length,
        loi_khuyen: tatCa,
        ghi_chu: 'Đây là cố vấn dựa trên luật, chạy trên số liệu thật của ao. '
            + 'Không phải chẩn đoán bệnh và không thay được người ra ao xem tôm.',
        tinh_luc: new Date().toISOString(),
    };
}

module.exports = {
    phanTich,
    boiCanh,
    muaHienTai,
    MUA_VU,
    BENH,
    _internals: { luatOxy, luatNhietDo, luatBenh, luatChoAn, luatThiTruong, luatMuaVu },
};
