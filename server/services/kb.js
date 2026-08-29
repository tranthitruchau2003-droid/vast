// ================================================================
// kb.js - KHO KIEN THUC NUOI TOM
//
// Toan bo so lieu trong file nay rut ra tu "Tai lieu nuoi tom"
// (Google Doc cua nhom), von dan nguon tu World Bank, Zenodo,
// Journal of Ecological Engineering (Scopus Q3) va Elsevier.
//
// ================================================================
// VI SAO TACH RA MOT FILE RIENG
// ----------------------------------------------------------------
// Truoc day so lieu nghe nghiep nam rai rac trong ask.js va
// advisor.js duoi dang chuoi viet tay. Hau qua:
//   - Sua mot nguong (vi du DO nguy hiem) phai di tim o 3 cho
//   - Khong biet con so nao lay tu tai lieu, con so nao ai do go dai
//   - Khong the tra loi rieng cho tung loai tom
//
// Gio MOI con so nghe nghiep nam o day. ask.js / advisor.js chi DOC,
// khong tu che them so.
//
// ================================================================
// NGUYEN TAC QUAN TRONG NHAT: KHONG TRA LOI RA NGOAI KHO NAY
// ----------------------------------------------------------------
// Tro ly cua VAST KHONG phai mo hinh ngon ngu. No khong "biet" gi
// ngoai file nay va so lieu that cua ao. Cau nao khong nam trong
// pham vi -> phai tra loi THANG la khong biet.
//
// Doan bua mot cau ve lieu luong thuoc hay nguong khi doc co the
// giet ca ao tom cua nguoi ta. Tha noi "toi khong biet".
// ================================================================

'use strict';

// ================================================================
// NGUON TAI LIEU
// ================================================================
const NGUON = [
    { ten: 'World Bank', loai: 'Discussion Paper nong nghiep & phat trien nong thon' },
    { ten: 'Zenodo (CERN / OpenAIRE)', loai: 'Kho du lieu khoa hoc mo, co DOI' },
    { ten: 'Journal of Ecological Engineering', loai: 'Tap chi Scopus Q3, co phan bien' },
    { ten: 'Elsevier / ScienceDirect', loai: 'Nha xuat ban hoc thuat' },
];

// ================================================================
// BANG THONG SO MOI TRUONG THEO TUNG LOAI TOM
// ----------------------------------------------------------------
// toi_uu     : dai an toan, tom phat trien tot
// nguy_hiem  : cham nguong nay la phai xu ly ngay
// vi_sao     : co so khoa hoc - de tro ly GIAI THICH duoc, khong chi
//              doc so. Nguoi nuoi tin con so khi hieu tai sao.
// ================================================================
const NGUONG = {
    the: {
        nhiet_do: {
            ten: 'Nhiệt độ nước', don_vi: '°C',
            toi_uu: [28, 32], nguy_hiem_duoi: 25, nguy_hiem_tren: 35,
            vi_sao: 'Ao thâm canh ổn định nhất ở 26–30°C. Nhiệt độ thấp kết hợp mưa lớn '
                + 'dễ kích hoạt virus đốm trắng (WSSV) bùng phát.',
        },
        ph: {
            ten: 'Độ pH', don_vi: '',
            toi_uu: [6.5, 8.5], dep_nhat: [7.2, 7.9], nguy_hiem_duoi: 6.0, nguy_hiem_tren: 9.0,
            vi_sao: 'pH thấp cản trở phân hủy hữu cơ, vỏ tôm mềm và yếu. '
                + 'pH trên 9.0 làm tăng cực nhanh độc tính của khí độc Ammonia.',
        },
        do: {
            ten: 'Oxy hoà tan (DO)', don_vi: 'mg/L',
            toi_uu_tu: 5.0, nguy_hiem_duoi: 3.0,
            vi_sao: 'Tôm thẻ bơi lội năng động nên cực kỳ tốn oxy. DO dưới 3 mg/L làm tôm nổi đầu, '
                + 'giảm miễn dịch, dễ nhiễm khuẩn Vibrio và bùng dịch đốm trắng.',
        },
        do_man: {
            ten: 'Độ mặn', don_vi: '‰',
            toi_uu: [26, 32], nguy_hiem_duoi: 10,
            vi_sao: 'Tôm thẻ chịu mặn thấp rất giỏi, sống được ở 16–23‰, thậm chí 1–2‰. '
                + 'Nhưng mưa lớn làm giảm độ mặn ĐỘT NGỘT thì tỷ lệ sống giảm tới 15%.',
        },
        tan: {
            ten: 'Khí độc Ammonia (TAN)', don_vi: 'mg/L',
            toi_uu_den: 0.05, tieu_chuan_vn: 0.1, nguy_hiem_tren: 1.0,
            vi_sao: 'Phát sinh từ thức ăn thừa và phân tôm. Ở ao thâm canh TAN có thể vọt lên '
                + '5.85 mg/L. Ammonia cao làm tôm ngộ độc, bỏ ăn, chậm lớn.',
        },
        nitrite: {
            ten: 'Khí độc Nitrite', don_vi: 'mg/L',
            toi_uu_den: 0.23, tieu_chuan: 0.02, nguy_hiem_tren: 1.0,
            vi_sao: 'Nitrite cao gây ức chế hô hấp. Ở ao thâm canh, Nitrite thường đạt đỉnh '
                + 'rất cao vào tuần nuôi thứ 3 và thứ 4.',
        },
    },

    su: {
        nhiet_do: {
            ten: 'Nhiệt độ nước', don_vi: '°C',
            toi_uu: [27, 30], nguy_hiem_duoi: 25, nguy_hiem_tren: 32,
            vi_sao: 'Dao động nhiệt độ tại ao sú Cà Mau rất ổn định trong khoảng 26–30.2°C.',
        },
        ph: {
            ten: 'Độ pH', don_vi: '',
            toi_uu: [7.2, 8.2], nguy_hiem_duoi: 6.5, nguy_hiem_tren: 8.5,
            vi_sao: 'pH dưới 6.0 làm suy giảm Canxi và khoáng ở lớp vỏ, gây bệnh mềm vỏ kinh niên.',
        },
        do: {
            ten: 'Oxy hoà tan (DO)', don_vi: 'mg/L',
            toi_uu_tu: 4.5, nguy_hiem_duoi: 3.4,
            vi_sao: 'Tôm sú bơi chậm, sống đáy nên chịu oxy thấp giỏi hơn tôm thẻ. Nhưng DO thấp '
                + 'kéo dài gây stress nặng, giảm miễn dịch, dễ nhiễm Vibrio hại gan tụy. '
                + 'Ở ao tôm–rừng Cà Mau, lá đước rụng phân huỷ kéo DO xuống 3.4–4.6 mg/L.',
        },
        do_man: {
            ten: 'Độ mặn', don_vi: '‰',
            toi_uu: [15, 30], nguy_hiem_duoi: 5,
            vi_sao: 'Mưa lớn dồn dập kéo độ mặn xuống 2‰ gây sốc thẩm thấu, tỷ lệ sống giảm 15%.',
        },
        tan: {
            ten: 'Khí độc Ammonia (TAN)', don_vi: 'mg/L',
            toi_uu_den: 0.1, nguy_hiem_tren: 1.0,
            vi_sao: 'Phát sinh từ phân và hữu cơ tích tụ đáy ao, dễ bùng phát bệnh đầu vàng.',
        },
        nitrite: {
            ten: 'Khí độc Nitrite', don_vi: 'mg/L',
            toi_uu_den: 0.02, nguy_hiem_tren: 0.23,
            vi_sao: 'Nitrite cao ngăn tôm hấp thụ oxy, làm tôm còi cọc và chậm lớn.',
        },
    },

    cang_xanh: {
        nhiet_do: {
            ten: 'Nhiệt độ nước', don_vi: '°C',
            toi_uu: [28, 31], nguy_hiem_duoi: 24, nguy_hiem_tren: 33,
            vi_sao: 'Tôm lờ đờ bỏ ăn khi nước lạnh; sốc nhiệt làm tăng tỷ lệ tử vong.',
        },
        ph: {
            ten: 'Độ pH', don_vi: '',
            toi_uu: [7.0, 8.2], nguy_hiem_duoi: 6.5, nguy_hiem_tren: 8.5,
            vi_sao: 'pH thấp làm mềm vỏ tôm càng xanh; pH cao kích hoạt độc tính Ammonia.',
        },
        do: {
            ten: 'Oxy hoà tan (DO)', don_vi: 'mg/L',
            toi_uu_tu: 4.5, nguy_hiem_duoi: 3.5,
            vi_sao: 'DO thấp kéo dài ức chế chu kỳ lột xác của tôm càng xanh.',
        },
        do_man: {
            ten: 'Độ mặn', don_vi: '‰',
            toi_uu: [0, 5], nguy_hiem_tren: 10,
            vi_sao: 'Loài nước ngọt hoặc lợ nhẹ cửa sông. Độ mặn trên 10‰ gây sốc thẩm thấu.',
        },
        tan: {
            ten: 'Khí độc Ammonia (TAN)', don_vi: 'mg/L',
            toi_uu_den: 0.1, nguy_hiem_tren: 1.0,
            vi_sao: 'Gây ngộ độc máu và suy giảm khả năng hô hấp đáy của tôm càng xanh.',
        },
    },
};

// ================================================================
// DAC TINH & TAP TINH TUNG LOAI
// ================================================================
const LOAI_TOM = {
    the: {
        ma: 'the',
        ten: 'Tôm thẻ chân trắng',
        ten_kh: 'Litopenaeus vannamei',
        tap_tinh: 'Bơi lội năng động khắp các tầng nước, ăn liên tục, lớn nhanh, nuôi được mật độ '
            + 'rất dày. Đổi lại tiêu thụ oxy cực lớn và rất nhạy với thiếu khí.',
        so_cu_ngay: [4, 6],
        so_cu_may: 4,
        mat_do_con_m2: 'Thâm canh vi sinh ghi nhận tới 76 con/m²',
        vong_nuoi_ngay: [85, 88],
        size_thu_hoach: '~65 con/kg sau khoảng 88 ngày',
        nang_suat: 'Thâm canh vi sinh đạt 11.206 kg/ha',
        moc_giong: 'Giai đoạn hậu ấu trùng PL5–PL12 là mốc quan trọng để đánh giá chất lượng '
            + 'con giống và quyết định thời điểm thả ao.',
    },
    su: {
        ma: 'su',
        ten: 'Tôm sú',
        ten_kh: 'Penaeus monodon',
        tap_tinh: 'Sống và tìm mồi ở tầng đáy, di chuyển chậm rãi, ăn ít hơn tôm thẻ, nuôi mật độ '
            + 'thưa hơn. Chịu biến động môi trường tốt hơn nhưng thời gian nuôi kéo dài.',
        so_cu_ngay: [3, 4],
        so_cu_may: 3,
        mat_do_con_m2: 'Thâm canh vi sinh 20–40 con/m² (bắt buộc có quạt nước chạy liên tục). '
            + 'Mô hình cải tiến không sục khí: 3–6 con/m².',
        vong_nuoi_ngay: [120, 180],
        size_thu_hoach: '45–48 con/kg',
        nang_suat: 'Tôm–rừng tự nhiên Cà Mau 82,44 kg/ha/vụ; cluster không sục khí 735,6 kg/ha '
            + '(3 con/m²) và 854,4 kg/ha (6 con/m²); thâm canh vi sinh 6.975–7.750 kg/ha/vụ.',
        luu_y: 'Cứ mỗi 1 kg thức ăn dư thừa tích tụ đáy ao sẽ phân huỷ sinh ra tới 50 g khí độc Ammonia.',
    },
    cang_xanh: {
        ma: 'cang_xanh',
        ten: 'Tôm càng xanh',
        ten_kh: 'Macrobrachium rosenbergii',
        tap_tinh: 'Sống nước ngọt hoặc lợ nhẹ cửa sông. Ăn tạp thiên về động vật. Phân đàn, tranh '
            + 'giành thức ăn và ăn thịt lẫn nhau khi lột xác.',
        so_cu_ngay: [2, 3],
        so_cu_may: 3,
        dam_cam_pct: [28, 32],
        mat_do_con_m2: 'Ao không sục khí: 4 con/m². Ao có quạt nước: 8 con/m².',
        vong_nuoi_ngay: [180, 180],
        uong_giong: 'Ấu trùng mất ~30 ngày biến thái thành PL. Giống PL25 cần ương trong ao đất nhỏ '
            + '45–60 ngày trước khi thả ao lớn.',
        nang_suat: 'Quảng canh xen canh 350–625 kg/ha; không sục khí 895,68 kg/ha (2 con/m²) và '
            + '1.274 kg/ha (4 con/m²); có sục khí 1.494 kg/ha (4 con/m²) và 1.905 kg/ha (8 con/m²).',
        luu_y: 'Thả dày hơn mức khuyến nghị KHÔNG làm tăng sản lượng — tôm đực lớn thiết lập tôn ti '
            + 'thống trị, cạnh tranh không gian rồi ăn thịt đồng loại lúc lột vỏ.',
    },
};

// ================================================================
// TY LE CHO AN THEO THANG TUOI  (% trong luong than moi ngay)
// ----------------------------------------------------------------
// Khac voi bang theo TRONG LUONG trong feed.js. Bang nay tra theo
// NGAY TUOI - dung duoc ngay ca khi chua chai mau lan nao.
//
// Nguon: muc "TY LE CHO AN THEO TRONG LUONG THAN & GIAI DOAN"
// ================================================================
const TY_LE_THEO_THANG = {
    the: [
        { den_ngay: 30, rate: 8.0, ten: 'Tháng thứ nhất (PL8 → DOC30)', ghi_chu: 'Cho ăn tay, chưa dùng máy' },
        { den_ngay: 60, rate: 5.5, khoang: [5, 6], ten: 'Tháng thứ hai (DOC30 → DOC60)' },
        { den_ngay: 9999, rate: 2.5, khoang: [2, 3], ten: 'Tháng thứ ba trở đi (DOC61 → thu hoạch)' },
    ],
    su: [
        { den_ngay: 30, rate: 8.0, ten: 'Tháng thứ nhất', ghi_chu: 'Cho ăn tay, chưa dùng máy' },
        { den_ngay: 60, rate: 5.0, ten: 'Tháng thứ hai (ngày 31–60)' },
        { den_ngay: 9999, rate: 2.5, khoang: [2, 3], ten: 'Tháng thứ ba đến thu hoạch' },
    ],
    cang_xanh: [
        { den_ngay: 60, rate: 5.0, ten: 'Giai đoạn ương / đầu vụ', ghi_chu: 'Cho ăn tay' },
        {
            den_ngay: 9999, rate: 3.5, khoang: [2, 5], ten: 'Grow-out (ngày 61 → thu hoạch)',
            ghi_chu: 'Giảm dần từ 5% xuống còn 2–3%',
        },
    ],
};

// ================================================================
// LICH CU AN & NHIP PHUN CUA MAY
// ----------------------------------------------------------------
// `phan_tram` la ty le cua TONG luong cam trong ngay danh cho cu do.
// Tong cong luon bang 100.
// ================================================================
const LICH_CU = {
    the: {
        cu: [
            { gio: '07:00', phan_tram: 25, ghi_chu: 'Nắng ấm' },
            { gio: '10:30', phan_tram: 20, ghi_chu: 'Trưa' },
            { gio: '13:30', phan_tram: 20, ghi_chu: 'Đầu chiều' },
            { gio: '16:30', phan_tram: 35, ghi_chu: 'Chiều mát — tôm thẻ ăn mạnh nhất' },
        ],
        nhip_phun: { phun_giay: [5, 10], nghi_phut: [10, 15] },
        vi_sao_nhip: 'Nhịp phun nhanh giúp cám rơi tới đâu tôm thẻ lao lại ăn hết tới đó, '
            + 'không kịp rã ra nước.',
    },
    su: {
        cu: [
            { gio: '07:30', phan_tram: 35 },
            { gio: '11:30', phan_tram: 25, bo_khi_lon_hon_thang: 2, ghi_chu: 'Bỏ hẳn khi tôm trên 2 tháng tuổi' },
            { gio: '17:00', phan_tram: 40, ghi_chu: 'Cữ quan trọng nhất — tôm sú tìm mồi mạnh về đêm' },
        ],
        nhip_phun: { phun_giay: [3, 5], nghi_phut: [15, 20] },
        vi_sao_nhip: 'Nhịp nghỉ dài cho tôm sú ở tầng đáy đủ thời gian bò đến nhặt cám, tránh cám '
            + 'thừa dồn ứ thối đáy ao.',
    },
    cang_xanh: {
        cu: [
            { gio: '07:30', phan_tram: 35 },
            { gio: '11:30', phan_tram: 25, bo_khi_lon_hon_thang: 3, ghi_chu: 'Bỏ khi tôm trên 3 tháng tuổi' },
            { gio: '17:00', phan_tram: 40, ghi_chu: 'Cữ ăn chính' },
        ],
        nhip_phun: { phun_giay: [5, 5], nghi_phut: [15, 15] },
        vi_sao_nhip: 'Phải chỉnh đĩa quăng ở bán kính rộng tối đa. Nếu cám rơi tập trung một chỗ, '
            + 'tôm đực lớn sẽ chiếm giữ và cắn chết những con nhỏ bò lại ăn.',
    },
};

// ================================================================
// FCR - HE SO CHUYEN DOI THUC AN
// ----------------------------------------------------------------
//                  Tong luong cam da cho an trong tuan (kg)
//   FCR tuan = ----------------------------------------------------
//              Sinh khoi cuoi tuan (kg) - Sinh khoi dau tuan (kg)
//
// Nghia la: an het bao nhieu ky cam moi tang duoc 1 ky tom.
// ================================================================
const FCR = {
    the: {
        chuan: [1.07, 1.14],
        aquamimicry: [0.32, 0.39],
        xanh: [1.0, 1.26],
        vang: [1.3, 1.4],
        do_tu: 1.5,
        y_nghia_vang: 'Kiểm tra lại thời tiết (mưa lạnh đột ngột) hoặc xem đáy ao có bám bẩn '
            + 'làm tôm stress bỏ ăn không.',
        y_nghia_do: 'Tôm đang dư thừa thức ăn nghiêm trọng, hoặc lờ đờ bỏ ăn do chớm bệnh '
            + '(đốm trắng WSSV, Vibrio). Cắt ngay 20% lượng cám và siphong đáy gấp.',
        ghi_chu: 'Mô hình Aquamimicry (ủ men cám gạo FRB) cho FCR thức ăn viên xuống 0,32–0,39 '
            + 'nhờ tôm tận dụng sinh vật phù du tự nhiên trong ao.',
    },
    su: {
        chuan: [1.3, 1.5],
        xanh: [1.3, 1.5],
        do_tu: 1.6,
        y_nghia_do: 'Tôm sú ăn chậm, FCR cao chứng tỏ cám nằm lâu dưới đáy ao phân rã. '
            + 'Mỗi 1 kg cám dư sinh 50 g khí độc Ammonia. Rút bớt mồi cữ tiếp theo.',
        ghi_chu: 'Mô hình quảng canh / tôm–rừng ngập mặn có FCR = 0 vì tôm ăn hoàn toàn '
            + 'thức ăn tự nhiên trong rừng ngập mặn.',
    },
    cang_xanh: {
        chuan: [1.3, 1.5],
        khoang_rong: [1.5, 2.5],
        xanh: [1.3, 1.5],
        do_tu: 1.6,
        do_qua_thap_den: 1.0,
        y_nghia_do: 'Tôm bỏ ăn hoặc cám bị con đực lớn chiếm giữ, cám dư thối đáy.',
        y_nghia_qua_thap: 'FCR quá thấp KHÔNG phải chuyện tốt. Kèm sàng ăn trống rỗng nghĩa là '
            + 'đang cho ăn THIẾU. Tôm càng xanh khi đói sẽ cắn chết và ăn thịt đồng loại lúc lột '
            + 'xác, hao hụt đầu con nghiêm trọng. Phải tăng cám và rải đều hơn khắp ao.',
    },
};

// ================================================================
// KHOA LIEN DONG MAY CHO AN  (ap dung chung cho ca 3 loai)
// ----------------------------------------------------------------
// Day la LOGIC AN TOAN, khong phai goi y. Bat may xa cam luc thieu
// oxy la kich hoat hoai tu co bung (trang than) - tom chet hang loat.
// ================================================================
const KHOA_CHO_AN = [
    {
        dieu_kien: 'DO < 4.0 mg/L',
        hanh_dong: 'Khoá máy cho ăn, không xả cữ tiếp theo',
        vi_sao: 'Tôm tiêu thụ oxy cực lớn khi ăn và tiêu hoá cám. Oxy thấp mà vẫn xả cám thì tôm ăn '
            + 'vào sẽ bị ngạt thở, gây hoại tử cơ bụng (trắng thân) và chết hàng loạt.',
    },
    {
        dieu_kien: 'Nhiệt độ nước < 25°C',
        hanh_dong: 'Khoá máy, hoặc giảm 50% lượng nhả mồi',
        vi_sao: 'Nhiệt độ lạnh làm tôm stress và giảm hoặc ngừng bắt mồi. Cám xả xuống chỉ để thối đáy ao.',
    },
];

// ================================================================
// NGUONG TU DONG BAT QUAT / GUONG OXY THEO TUNG LOAI
// ================================================================
const AUTO_QUAT = {
    the: { bat_khi_do_duoi: 4.5, tat_bot_khi_do_tren: 6.0, coi_hu_khi_do_duoi: 3.0 },
    su: { bat_khi_do_duoi: 4.0, tat_bot_khi_do_tren: 5.5, coi_hu_khi_do_duoi: 3.4 },
    cang_xanh: { bat_khi_do_duoi: 4.0, tat_bot_khi_do_tren: 5.5, coi_hu_khi_do_duoi: 3.5 },
};

// ================================================================
// TOM DUOI 30 NGAY TUOI - KHONG DUNG MAY CHO AN TU DONG
// ----------------------------------------------------------------
// Day la canh bao quan trong nhat cua ca tai lieu doi voi mot du an
// may cho an tu dong. Phai noi ro, khong duoc de nguoi dung bat may
// tu ngay tha giong.
// ================================================================
const TOM_BABY = {
    den_ngay_tuoi: 30,
    ket_luan: 'Tháng nuôi đầu tiên KHÔNG dùng máy cho ăn tự động — phải cho ăn thủ công bằng tay, '
        + 'rải đều khắp ao, chia 4–6 cữ/ngày.',
    vi_sao: 'Tôm nhỏ bơi rất yếu, lờ đờ và phân bổ rải rác khắp các ngóc ngách trong ao. Máy cho ăn '
        + 'chỉ quăng cám trong bán kính cố định 5–10 m quanh máy.',
    hau_qua: 'Tôm nhỏ ở xa không bơi tới được vùng phun sẽ đói và còi cọc. Cùng lúc, lượng cám dồn '
        + 'cục một chỗ không ai ăn sẽ tan rã, tích thành lớp bùn thối đáy ao, giải phóng khí độc '
        + 'Ammonia (TAN) và Nitrite.',
    loi_ich: 'Chia nhỏ 4–6 cữ giúp tôm ở bất kỳ vị trí nào cũng tiếp cận được thức ăn tươi mới, '
        + 'gan tụy và đường ruột phát triển hoàn thiện.',
};

// ================================================================
// CHAI MAU - CACH DO TRONG LUONG TRUNG BINH (ABW)
// ================================================================
const CHAI_MAU = {
    cong_thuc: 'ABW = Tổng trọng lượng mẫu (gram) ÷ Số con đếm được',
    vi_du: '400 gram ÷ 40 con = 10 g/con',
    cac_buoc: [
        'Chọn 2–3 vị trí khác nhau trong ao (một điểm gần bờ, một điểm gần giữa ao), tránh khu vực '
        + 'hố siphong. Quăng chài bắt ngẫu nhiên 30–50 con.',
        'Bỏ tôm vào xô nước sạch có sục khí oxy cầm tay để tôm không bị ngạt.',
        'Đếm chính xác số con trong xô, vớt ra cho ráo nước rồi cân tổng trọng lượng.',
        'Lấy tổng gram chia cho số con ra trọng lượng trung bình 1 con.',
    ],
    vi_sao_dung: 'Tôm cùng ao được thả cùng ngày, ăn cùng loại cám, sống chung nguồn nước nên tốc độ '
        + 'phát triển tương đương (độ đồng đều thường trên 85–90%). Vì vậy trung bình của 40 con '
        + 'chài lên đại diện được cho cả ao.',
    luu_y: [
        'Chỉ chài vào sáng sớm hoặc chiều mát. Tuyệt đối không chài lúc trưa nắng gắt (tôm dễ đục '
        + 'cơ, đỏ thân) hoặc lúc trời đang mưa dông.',
        'Nếu tôm đang lột vỏ đồng loạt (vỏ nổi nhiều trên mặt nước), hoãn chài 1–2 ngày để tránh '
        + 'làm tôm dập nát, gãy râu, nhiễm khuẩn qua lớp vỏ mềm.',
        'Đếm và cân chỉ nên trong 2–3 phút, xong phải thả tôm về ao ngay.',
    ],
};

// ================================================================
// THA GIONG: MUA VU VA GIO TRONG NGAY
// ================================================================
const THA_GIONG = {
    mua_tot: 'Mùa khô (tháng 12 – tháng 4 năm sau). Gió mùa Đông Bắc mang thời tiết ấm áp, ít mưa '
        + 'dông, độ mặn và pH ao ổn định.',
    mua_tranh: 'Mùa mưa (tháng 5 – tháng 11). Mưa lớn làm độ mặn sụt đột ngột xuống còn 2‰ gây sốc '
        + 'thẩm thấu, tỷ lệ sống giảm 15%. Nhiệt độ nước hạ dưới 30°C kết hợp DO sụt giảm là tác '
        + 'nhân trực tiếp kích hoạt virus đốm trắng (WSSV) và đầu vàng (YHD) bùng phát.',
    gio_nen_tha: 'Sáng sớm 6:00–8:00 hoặc chiều mát 17:00–18:00.',
    gio_tranh: [
        'Trưa nắng gắt 11:00–14:00: bức xạ mạnh làm nhiệt độ nước tăng nhanh, pH dao động mạnh do '
        + 'tảo quang hợp. Tôm dễ sốc nhiệt, suy giảm miễn dịch, nhạy cảm với Vibrio.',
        'Nửa đêm đến rạng sáng 23:00–4:00: DO trong ao xuống thấp nhất trong ngày vì tảo và vi sinh '
        + 'ngừng quang hợp, chuyển sang hô hấp. Tôm giống bơi yếu, dễ ngạt và nổi đầu.',
    ],
    thuan_hoa: 'Ngâm nổi bọc tôm trên mặt ao 15–20 phút để cân bằng nhiệt độ, sau đó mở bọc cho nước '
        + 'ao tràn vào từ từ để tôm quen dần độ mặn và pH trước khi thả hoàn toàn.',
};

// ================================================================
// 4 KICH BAN XU LY KHI CO CANH BAO DO
// ----------------------------------------------------------------
// `nguong` khac nhau theo loai tom -> tra qua kichBan(loai).
// ================================================================
function kichBan(loai) {
    const l = chuanHoaLoai(loai) || 'the';
    const nguongDO = { the: 3.0, su: 3.4, cang_xanh: 3.5 }[l];

    return [
        {
            ma: 'oxy_tut',
            ten: `Oxy hoà tan sụt giảm (DO < ${nguongDO} mg/L)`,
            khi_nao: 'Thường từ 23h đêm đến 5h sáng; quạt đứt dây curoa, kẹt động cơ, hoặc mất điện lưới.',
            viec_can_lam: [
                'Chạy ngay máy nổ dầu Diesel dự phòng để vận hành dàn quạt.',
                'Rải khẩn cấp Oxy bột (Sodium Percarbonate) xuống ao, tập trung ở góc cuối gió và '
                + 'quanh khu vực tôm hay bơi.',
                'Cắt mồi — tuyệt đối không xả cám khi DO dưới 4.0 mg/L. Bắt tôm ăn lúc thiếu oxy sẽ '
                + 'kích hoạt hội chứng hoại tử cơ bụng đục thân, tôm ngạt chết hàng loạt.',
            ],
        },
        {
            ma: 'ph_tut',
            ten: 'pH tụt dốc (< 6.5)',
            khi_nao: 'Sau mưa dông lớn kéo axit và phèn từ bờ đất ao xuống.',
            viec_can_lam: [
                'Hoà vôi dolomite hoặc vôi nông nghiệp tạt đều khắp ao, liều 100–200 g/decimal '
                + '(khoảng 10–20 kg cho ao 1.000 m²), để nâng hệ đệm cacbonat.',
                'Rải vôi bột dọc đê và bờ ao trước và trong khi mưa, ngăn nước mưa mang axit từ đất '
                + 'phèn trôi xuống ao.',
                'Rải Zeolite hỗ trợ điều hoà và giữ pH ổn định.',
            ],
        },
        {
            ma: 'ph_vot',
            ten: 'pH vọt cao (> 8.8)',
            khi_nao: 'Buổi chiều nắng gắt, tảo nở hoa quá mức, quang hợp mạnh.',
            viec_can_lam: [
                'Đánh mật rỉ đường (25 kg/ha, tức 2,5 kg/1.000 m²) phối hợp cám gạo, tạt vào buổi '
                + 'sáng. Nguồn carbon này kích thích vi sinh dị dưỡng (Bacillus sp.) bùng sinh khối, '
                + 'cạnh tranh dinh dưỡng với tảo và kéo giảm pH tự nhiên.',
                'Xả bớt lớp nước mặt (nơi tảo dày nhất) vào ban ngày, cấp nước sạch từ ao lắng vào '
                + 'ban đêm để làm loãng mật độ tảo.',
            ],
        },
        {
            ma: 'khi_doc',
            ten: 'Khí độc tăng vọt (Ammonia/TAN > 1.0 mg/L hoặc Nitrite > 1.0 mg/L)',
            khi_nao: 'Cuối vụ nuôi, hoặc sau khi tôm lột vỏ đồng loạt làm đáy ao tích vỏ lột, mùn bã '
                + 'phân tôm và cám dư.',
            viec_can_lam: [
                'Cắt ngay 30–50% khẩu phần hàng ngày để chặn dòng hữu cơ nạp thêm xuống đáy ao.',
                'Đánh vi sinh dị dưỡng liều cao (Bacillus sp.) trộn rỉ đường, tạt trực tiếp xuống ao. '
                + 'Lợi khuẩn hấp thụ Ammonia độc hại và chuyển hoá thành protein không độc.',
                'Chạy quạt nước tối đa gom chất thải vào hố siphong và giải phóng khí độc — nhưng chỉ '
                + 'hiệu quả khi pH ao đã được kiểm soát ổn định.',
                'Siphong đáy ao hoặc thay bớt nước đáy để loại bỏ xác tảo tàn và chất hữu cơ tích tụ.',
            ],
        },
        {
            ma: 'soc_do_man',
            ten: 'Sốc môi trường do thời tiết (mưa lớn, độ mặn tụt đột ngột)',
            khi_nao: 'Các tháng mùa mưa (tháng 5 – tháng 11). Mưa lớn làm sụt độ mặn cực nhanh và '
                + 'phân tầng nước.',
            viec_can_lam: [
                'Bật quạt nước 24/24 trong lúc mưa để xáo trộn đều, tránh lớp nước ngọt nhẹ nổi trên '
                + 'mặt gây thiếu oxy tầng đáy và sốc thẩm thấu.',
                'Mở van xả tràn lớp nước ngọt bề mặt để bảo toàn độ mặn tầng đáy.',
                'Tạt khoáng chuyên dụng hoặc muối hột — độ mặn giảm đột ngột kích thích tôm lột xác '
                + 'đồng loạt, cần khoáng để nhanh cứng vỏ, tránh mềm vỏ kéo dài hoặc hoại tử cơ.',
            ],
        },
    ];
}

// ================================================================
// CANH BAO RIENG
// ================================================================
const CANH_BAO = [
    {
        ma: 'chlorine',
        ten: 'Chlorine chỉ dùng TRƯỚC khi thả giống',
        noi_dung: 'Chlorine / Bleaching powder diệt sạch mầm bệnh (đốm trắng, Vibrio) nhưng CHỈ được '
            + 'dùng ở giai đoạn cải tạo ao trước thả giống, liều 300–400 g/decimal (3–4 kg cho '
            + '100 m²). Tuyệt đối không đánh Chlorine khi đang có tôm trong ao — nó tiêu diệt toàn bộ '
            + 'hệ vi sinh có lợi và gây độc trực tiếp làm tôm chết hàng loạt.',
    },
    {
        ma: 'ehp_cang_xanh',
        ten: 'EHP đã xuất hiện trên tôm càng xanh',
        loai: 'cang_xanh',
        noi_dung: 'Các nghiên cứu gần đây tại Đông Nam Á và Bangladesh đã báo cáo mầm bệnh vi bào tử '
            + 'trùng Enterocytozoon hepatopenaei (EHP) tấn công tôm càng xanh — trước đây người nuôi '
            + 'chủ quan cho rằng EHP chỉ có trên tôm thẻ. Dấu hiệu: gan tụy tổn thương, teo nhỏ, tôm '
            + 'còi cọc và chết hao hụt âm thầm ở giai đoạn cuối vụ, gần thu hoạch. Phòng ngừa: dùng '
            + 'chế phẩm chứa Bacillus sp. trộn thức ăn và xử lý đáy ao liên tục từ đầu vụ.',
    },
];

// ================================================================
// PHAT HIEN SOM TOM BO AN QUA DO  (khong doi chai mau hang tuan)
// ================================================================
const DOC_DO_KHI_CHO_AN = {
    an_manh: 'Khi máy phun cám, tôm lao vào tranh mồi, trao đổi chất tăng mạnh nên DO sụt rất nhanh '
        + '(ví dụ từ mức tụt 0,1 mg/L/giờ vọt lên 0,5 mg/L/giờ). DO tụt nhanh sau khi xả mồi nghĩa '
        + 'là tôm khoẻ, bắt mồi tốt.',
    bo_an: 'Nếu máy phun cám mà DO vẫn đứng yên hoặc tụt rất ít, tôm đang lờ đờ không thèm ăn — '
        + 'thường do trời mưa lạnh, nước phân tầng, hoặc tôm chớm bệnh.',
    xu_ly: 'Hú còi cảnh báo và tự động ngắt điện máy cho ăn, ngăn cám tiếp tục xả xuống đáy ao gây '
        + 'lãng phí và thối nước.',
};

// ================================================================
// TIEN ICH TRA CUU
// ================================================================

/** 'Tôm thẻ', 'the', 'vannamei'... -> 'the'. Khong doan duoc thi null. */
function chuanHoaLoai(v) {
    const s = String(v || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase();
    if (!s) return null;
    // [\s_-]* : ten loai co the den duoi dang ma ('cang_xanh'), dang nguoi go
    // ('càng xanh'), hoac dang gach noi. Thieu dau _ o day tung lam
    // xepLoaiFCR('cang_xanh') roi ve mac dinh tom the -> canh bao sai loai.
    if (/cang[\s_-]*xanh|macrobrachium|rosenbergii/.test(s)) return 'cang_xanh';
    if (/\bsu\b|monodon|tiger/.test(s)) return 'su';
    if (/\bthe\b|chan[\s_-]*trang|vannamei|whiteleg/.test(s)) return 'the';
    return null;
}

/** Bang nguong cua 1 loai. Khong ro loai thi tra ve tom the (pho bien nhat). */
function nguong(loai) {
    return NGUONG[chuanHoaLoai(loai) || 'the'];
}

/** Thong tin dac tinh cua 1 loai. */
function loaiTom(loai) {
    return LOAI_TOM[chuanHoaLoai(loai) || 'the'];
}

/**
 * Ty le cho an (% trong luong than) theo NGAY TUOI cua tom.
 * Dung khi chua chai mau lan nao -> chua co trong luong trung binh.
 * @returns {{rate:number, ten:string, ghi_chu?:string, khoang?:number[]}|null}
 */
function tyLeTheoNgayTuoi(loai, ngayTuoi) {
    const bang = TY_LE_THEO_THANG[chuanHoaLoai(loai) || 'the'];
    const d = Number(ngayTuoi);
    if (!Number.isFinite(d) || d < 0) return null;
    return bang.find(m => d <= m.den_ngay) || bang[bang.length - 1];
}

/** Lich cu an chuan cua 1 loai (gio + % moi cu + nhip phun). */
function lichCu(loai, ngayTuoi = null) {
    const l = chuanHoaLoai(loai) || 'the';
    const g = LICH_CU[l];
    const thangTuoi = Number.isFinite(Number(ngayTuoi)) ? Number(ngayTuoi) / 30 : null;

    // Bo cu trua khi tom da lon - tai lieu noi ro moc nay cho su va cang xanh
    let cu = g.cu;
    if (thangTuoi !== null) {
        cu = cu.filter(c => !(c.bo_khi_lon_hon_thang && thangTuoi > c.bo_khi_lon_hon_thang));
    }

    // Da bo bot cu thi phai chia lai % cho du 100, khong thi thieu cam
    const tong = cu.reduce((t, c) => t + c.phan_tram, 0);
    if (tong > 0 && tong !== 100) {
        cu = cu.map(c => ({ ...c, phan_tram: Math.round((c.phan_tram / tong) * 1000) / 10 }));
    }

    return { ...g, cu };
}

/**
 * FCR tuan (Apparent FCR).
 *   FCR = cam da cho an trong tuan / (sinh khoi cuoi tuan - sinh khoi dau tuan)
 *
 * Tang sinh khoi <= 0 nghia la tom KHONG lon (hoac hao hut). Luc do FCR
 * khong con y nghia toan hoc - tra ve null va noi ro, khong chia cho 0
 * roi dua ra mot con so Infinity vo nghia.
 */
function tinhFCR(camTuanKg, sinhKhoiDauKg, sinhKhoiCuoiKg) {
    const cam = Number(camTuanKg);
    const dau = Number(sinhKhoiDauKg);
    const cuoi = Number(sinhKhoiCuoiKg);

    if (![cam, dau, cuoi].every(Number.isFinite) || cam <= 0) {
        return { ok: false, ly_do: 'Thiếu số liệu: cần lượng cám cả tuần và sinh khối đầu/cuối tuần.' };
    }

    const tang = cuoi - dau;
    if (tang <= 0) {
        return {
            ok: false,
            tang_sinh_khoi_kg: Math.round(tang * 10) / 10,
            ly_do: 'Sinh khối không tăng (hoặc giảm) trong tuần — chưa tính được FCR. '
                + 'Cần kiểm tra tôm có hao hụt, bỏ ăn hay chớm bệnh không.',
        };
    }

    return {
        ok: true,
        fcr: Math.round((cam / tang) * 100) / 100,
        cam_tuan_kg: Math.round(cam * 10) / 10,
        tang_sinh_khoi_kg: Math.round(tang * 10) / 10,
    };
}

/**
 * Xep loai FCR theo nguong cua tung loai tom.
 * @returns {{muc:'xanh'|'vang'|'do'|'do_thap', nhan:string, y_nghia:string}}
 */
function xepLoaiFCR(fcr, loai) {
    const l = chuanHoaLoai(loai) || 'the';
    const b = FCR[l];
    const v = Number(fcr);
    if (!Number.isFinite(v)) return null;

    if (b.do_qua_thap_den && v <= b.do_qua_thap_den) {
        return { muc: 'do_thap', nhan: 'Cảnh báo đỏ — cho ăn thiếu', y_nghia: b.y_nghia_qua_thap };
    }
    if (v >= b.do_tu) {
        return { muc: 'do', nhan: 'Cảnh báo đỏ', y_nghia: b.y_nghia_do };
    }
    if (b.vang && v >= b.vang[0]) {
        return { muc: 'vang', nhan: 'Cần chú ý', y_nghia: b.y_nghia_vang };
    }
    return {
        muc: 'xanh',
        nhan: 'Bình thường',
        y_nghia: `Nằm trong dải FCR chuẩn của ${LOAI_TOM[l].ten.toLowerCase()} `
            + `(${b.chuan[0]}–${b.chuan[1]}).`,
    };
}

/** Nguong tu dong bat/tat quat cua 1 loai. */
function autoQuat(loai) {
    return AUTO_QUAT[chuanHoaLoai(loai) || 'the'];
}

/** Canh bao rieng cho 1 loai + canh bao chung. */
function canhBao(loai) {
    const l = chuanHoaLoai(loai);
    return CANH_BAO.filter(c => !c.loai || c.loai === l);
}

module.exports = {
    // Du lieu tho
    NGUON,
    NGUONG,
    LOAI_TOM,
    TY_LE_THEO_THANG,
    LICH_CU,
    FCR,
    KHOA_CHO_AN,
    AUTO_QUAT,
    TOM_BABY,
    CHAI_MAU,
    THA_GIONG,
    CANH_BAO,
    DOC_DO_KHI_CHO_AN,

    // Tra cuu
    chuanHoaLoai,
    nguong,
    loaiTom,
    tyLeTheoNgayTuoi,
    lichCu,
    tinhFCR,
    xepLoaiFCR,
    autoQuat,
    canhBao,
    kichBan,
};
