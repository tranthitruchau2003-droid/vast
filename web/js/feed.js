/* ================================================================
   feed.js - Module MAY CHO AN TU DONG cho dashboard VAST
   ----------------------------------------------------------------
   Cach dung: trong dashboard.html, farmApp() tra ve
        return { ...iotModule(), ...marketModule(), ...feedModule(), ... }
   roi goi  this.initFeed()  trong initApp().

   CONG THUC (tinh o server/feed.js, day chi hien ket qua):
       Buoc 1   N = So giong tha x Ty le song (%)
       Buoc 2   B = N x W / 1000                    (kg)
       Buoc 3   F = B x Ty le cho an (% trong luong than)   (kg/ngay)
       Moi cu   = F / so cu trong ngay

   LUU Y GIONG PHAN IoT / GIA TOM:
   - KHONG dung getter ( get abc() ), vi farmApp() gop bang phep trai
     { ...feedModule() } - getter se bi lay gia tri 1 lan roi dong bang.
     Moi thu viet thanh HAM, giao dien goi kem dau ngoac.
   - Thieu du lieu thi NOI RO THIEU GI, khong bia so. Cho an sai luong
     la mat tien that va hong ao that.
   ================================================================ */

function feedModule() {
    const CFG = window.VAST_CONFIG || {};
    const API = (CFG.API_BASE || '').replace(/\/$/, '');
    const POLL_MS = CFG.FEED_POLL_MS || 60 * 1000;

    return {
        /* ---------------- TRANG THAI ---------------- */
        feed: {
            ready: false,
            loading: false,
            busy: false,          // dang gui lenh xa cu
            error: '',
            plans: {},            // { pond_id: <khau phan> }

            // Modal khai bao thong so / chai mau
            showSetupModal: false,
            setupPondId: '',
            setupSeedCount: '',
            setupSurvivalPct: '',
            setupSampleCount: '',
            setupTotalWeightG: '',
            setupAvgWeightG: '',
            setupStockMaxKg: '',
            setupMealTimes: '06:00, 10:00, 14:00, 18:00',

            // Modal ghi nhan so cam vua do them vao thung
            showRefillModal: false,
            refillPondId: '',
            refillAmountKg: '',
            refillBusy: false,
            refillError: '',
        },

        /* ================= KHOI DONG ================= */
        initFeed() {
            this.feedFetch();
            setInterval(() => this.feedFetch(), POLL_MS);
        },

        async feedFetch() {
            try {
                const r = await fetch(`${API}/api/feed/plans`, {
                    cache: 'no-store', headers: window.VAST_DEVICE.authHeaders(),
                });
                const d = await r.json();
                if (d && d.ok) {
                    const m = {};
                    for (const p of d.plans || []) m[p.pond_id] = p;
                    this.feed.plans = m;
                    this.feed.error = '';
                }
            } catch (e) {
                this.feed.error = 'Không kết nối được máy chủ';
            } finally {
                this.feed.ready = true;
            }
        },

        /* ================= DOC KHAU PHAN ================= */

        /** Khau phan cua ao dang xem (hoac ao chi dinh). */
        feedPlan(pondId) {
            const id = pondId || this.selectedPondId;
            if (!id) return null;
            return this.feed.plans[id] || null;
        },

        /** Da du du lieu de tinh chua. */
        feedHasPlan(pondId) {
            const p = this.feedPlan(pondId);
            return !!(p && p.ok);
        },

        /** Con thieu gi -> cau chu de hien cho nguoi dung biet phai nhap gi. */
        feedMissingText(pondId) {
            const p = this.feedPlan(pondId);
            if (!p) return 'Chưa có dữ liệu cho ao này.';
            if (p.ok) return '';
            return p.message || 'Chưa đủ dữ liệu để tính khẩu phần.';
        },

        /* ---- Kho cam ---- */
        feedStockPct(pondId) {
            const p = this.feedPlan(pondId);
            return (p && p.ok && p.feedStockPct !== null) ? p.feedStockPct : null;
        },

        feedStockText(pondId) {
            const p = this.feedPlan(pondId);
            if (!p || !p.ok || p.feedStockKg === null) return 'Chưa khai báo';
            const max = p.feedStockMaxKg ? ` / ${this.feedNum(p.feedStockMaxKg)}kg` : '';
            return `${this.feedNum(p.feedStockKg)}kg${max}`;
        },

        feedStockBarClass(pondId) {
            const pct = this.feedStockPct(pondId);
            if (pct === null) return 'bg-slate-300';
            if (pct <= 15) return 'bg-red-500';
            if (pct <= 35) return 'bg-amber-500';
            return 'bg-green-500';
        },

        feedStockTextClass(pondId) {
            const pct = this.feedStockPct(pondId);
            if (pct === null) return 'text-slate-400';
            if (pct <= 15) return 'text-red-600';
            if (pct <= 35) return 'text-amber-600';
            return 'text-green-600';
        },

        /** Khoang trong con lai trong thung (kg); null neu chua khai bao suc chua. */
        feedRefillRemainingKg(pondId) {
            const p = this.feedPlan(pondId || this.feed.refillPondId);
            if (!p || !p.ok || !(Number(p.feedStockMaxKg) > 0)) return null;
            const conLai = Number(p.feedStockMaxKg) - Number(p.feedStockKg || 0);
            return Math.max(0, Math.round(conLai * 100) / 100);
        },

        /** Mo hop nhap so kg vua do vao thung. */
        feedOpenRefill(pondId) {
            const id = pondId || this.selectedPondId;
            const p = this.feedPlan(id);

            if (!id || !p || !p.ok) {
                this.showToast?.(this.feedMissingText(id), 'error');
                return;
            }
            if (!(Number(p.feedStockMaxKg) > 0)) {
                this.showToast?.('Hãy khai báo sức chứa thùng cám trước', 'error');
                return;
            }

            const conLai = this.feedRefillRemainingKg(id);
            if (conLai !== null && conLai <= 0) {
                this.showToast?.('Thùng cám đang đầy', 'info');
                return;
            }

            this.feed.refillPondId = id;
            this.feed.refillAmountKg = '';
            this.feed.refillError = '';
            this.feed.showRefillModal = true;
            this.$nextTick(() => window.lucide?.createIcons());
        },

        /** Dien nhanh dung phan suc chua con trong. */
        feedRefillToMax() {
            const conLai = this.feedRefillRemainingKg();
            if (conLai !== null && conLai > 0) this.feed.refillAmountKg = conLai;
        },

        async feedSubmitRefill() {
            const id = this.feed.refillPondId;
            const amount = Number(this.feed.refillAmountKg);
            const conLai = this.feedRefillRemainingKg();

            this.feed.refillError = '';
            if (!Number.isFinite(amount) || amount <= 0) {
                this.feed.refillError = 'Nhập số kg cám vừa đổ vào thùng';
                return;
            }
            if (conLai !== null && amount > conLai) {
                this.feed.refillError = `Số cám đã nhập vượt quá sức chứa còn lại của thùng. Tối đa ${this.feedNum(conLai)} kg.`;
                return;
            }

            this.feed.refillBusy = true;
            try {
                const d = await this.feedRefill(id, amount);
                if (!d) return;

                this.feed.showRefillModal = false;
                this.feed.refillAmountKg = '';
                this.showToast?.(
                    `Đã nạp ${this.feedNum(amount)} kg — trong thùng hiện có ${this.feedNum(d.trong_may_kg)} kg`,
                    'success'
                );
            } finally {
                this.feed.refillBusy = false;
            }
        },

        /** "Đủ 3,5 ngày" / "Chưa đủ 1 ngày" - cai nguoi nuoi thuc su can biet. */
        feedDaysLeftText(pondId) {
            const p = this.feedPlan(pondId);
            if (!p || !p.ok || p.soNgayConCam === null) return '';
            if (p.soNgayConCam < 1) return 'Không đủ cho hôm nay';
            if (p.soNgayConCam < 2) return 'Đủ khoảng 1 ngày';
            return `Đủ khoảng ${this.feedNum(p.soNgayConCam)} ngày`;
        },

        feedDaysLeftClass(pondId) {
            const p = this.feedPlan(pondId);
            if (!p || !p.ok || p.soNgayConCam === null) return 'text-slate-400';
            return p.soNgayConCam < 2 ? 'text-red-600 font-bold' : 'text-slate-500';
        },

        /* ---- Cu an ke tiep ---- */
        feedNextMealText(pondId) {
            const p = this.feedPlan(pondId);
            if (!p || !p.ok || !p.next_meal) return '--';
            const m = p.next_meal.inMinutes;
            const gio = Math.floor(m / 60);
            const phut = m % 60;
            const dem = gio > 0
                ? `${String(gio).padStart(2, '0')} giờ ${String(phut).padStart(2, '0')} phút`
                : `${phut} phút`;
            return dem;
        },

        feedNextMealAt(pondId) {
            const p = this.feedPlan(pondId);
            if (!p || !p.ok || !p.next_meal) return '';
            return p.next_meal.time + (p.next_meal.isTomorrow ? ' (mai)' : '');
        },

        /* ---- Luong xa moi cu ---- */
        feedPerMealKg(pondId) {
            const p = this.feedPlan(pondId);
            return (p && p.ok) ? p.camMoiCuKg : null;
        },

        /** Cau giai thich con so tu dau ra - de nguoi dung TIN duoc con so. */
        feedExplain(pondId) {
            const p = this.feedPlan(pondId);
            if (!p || !p.ok) return '';
            return `${this.feedNum(p.soTom)} con × ${this.feedNum(p.buoc2.avgWeightG)} g `
                + `= ${this.feedNum(p.sinhKhoiKg)} kg sinh khối × ${p.ratePct}% `
                + `= ${this.feedNum(p.camNgayKg)} kg/ngày, chia ${p.mealsPerDay} cữ`;
        },

        /** Hom nay da xa may cu roi. */
        feedTodayText(pondId) {
            const p = this.feedPlan(pondId);
            if (!p || !p.ok) return '';
            return `Hôm nay đã xả ${p.today_meals || 0}/${p.mealsPerDay} cữ`
                + (p.today_fed_kg ? ` (${this.feedNum(p.today_fed_kg)} kg)` : '');
        },

        /* ---- Canh bao dieu chinh theo moi truong ---- */
        feedAdjustNote(pondId) {
            const p = this.feedPlan(pondId);
            if (!p || !p.ok) return null;

            if (p.ngungChoAn) {
                return { level: 'danger', text: p.adjustReasons.join('; ') };
            }
            if (p.adjustFactor < 1) {
                const giam = Math.round((1 - p.adjustFactor) * 100);
                return {
                    level: 'warning',
                    text: `Đã giảm ${giam}% khẩu phần: ${p.adjustReasons.join('; ')}`,
                };
            }
            if (!p.sensor_online && p.sensor_note) {
                return { level: 'info', text: p.sensor_note };
            }
            return null;
        },

        /* ================= XA CU NGAY ================= */
        async feedRunNow(pondId) {
            const id = pondId || this.selectedPondId;
            if (!id || this.feed.busy) return;

            const p = this.feedPlan(id);
            if (!p || !p.ok) {
                this.showToast?.(this.feedMissingText(id), 'error');
                return;
            }

            this.feed.busy = true;
            try {
                const r = await fetch(`${API}/api/feed/run`, {
                    method: 'POST',
                    headers: window.VAST_DEVICE.authHeaders(true),
                    body: JSON.stringify({ pond_id: id }),
                });
                const d = await r.json();

                if (d.ok) {
                    // Server chi DAT LENH vao hang doi. ESP32 lay lenh roi moi quay
                    // motor va bao trang thai that ve - giong het cach bat bom/guong.
                    this.showToast?.(`Đã gửi lệnh xả ${this.feedNum(d.amount_kg)} kg cám`, 'success');
                    if (d.plan) this.feed.plans[id] = d.plan;
                    this.aiLogs?.unshift?.({
                        id: Date.now(),
                        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                        date: new Date().toLocaleDateString('vi-VN'),
                        content: `Xả ${this.feedNum(d.amount_kg)} kg cám (${p.mealsPerDay} cữ/ngày)`,
                        targetPond: this.selectedPond?.name || id,
                    });
                } else {
                    this.showToast?.(d.error || 'Không xả được cữ này', 'error');
                    if (d.plan) this.feed.plans[id] = d.plan;
                }
            } catch (e) {
                this.showToast?.('Không kết nối được máy chủ', 'error');
            } finally {
                this.feed.busy = false;
            }
        },

        /* ================= KIEM TRA MAY CHO AN ================= */

        feedTest: {
            show: false,
            busy: false,
            ketQua: '',
            loi: '',
            calibGiay: 10,      // quay bao nhieu giay khi hieu chuan
            calibGam: '',       // so gam can duoc sau khi quay
            daChayCalib: false, // da bam chay hieu chuan chua
            chanDoan: null,     // lenh da toi ESP32 chua
            motorQuay: null,    // nguoi dung tu bao: motor co quay khong (may chu khong the biet)
            giuLau: false,      // giu motor 15 giay de kip cam dong ho do
        },

        feedOpenTest() {
            this.feedTest.show = true;
            this.feedTest.ketQua = '';
            this.feedTest.loi = '';
            this.feedTest.calibGam = '';
            this.feedTest.daChayCalib = false;
            this.feedTest.chanDoan = null;
            this.feedTest.motorQuay = null;
            this.feedKiemTraLenh();
            this.$nextTick(() => window.lucide?.createIcons());
        },

        /** Trang thai THAT cua may, do ESP32 bao len qua telemetry. */
        feedMayTrangThai() {
            const d = this.iot?.byPond?.[this.selectedPondId];
            return (d && d.feeder) ? d.feeder : null;
        },

        feedMayDangChay() {
            const f = this.feedMayTrangThai();
            return !!(f && f.busy);
        },

        /** He so hieu chuan ESP32 dang dung (doc tu telemetry). */
        feedHeSoHienTai() {
            const f = this.feedMayTrangThai();
            return (f && Number.isFinite(f.grams_per_sec)) ? f.grams_per_sec : null;
        },

        async feedGuiLenhTest(action, them = {}) {
            const id = this.selectedPondId;
            if (!id) return null;

            this.feedTest.busy = true;
            this.feedTest.loi = '';
            try {
                const r = await fetch(`${API}/api/feed/test`, {
                    method: 'POST',
                    headers: window.VAST_DEVICE.authHeaders(true),
                    body: JSON.stringify({ pond_id: id, action, ...them }),
                });
                const d = await r.json();

                if (!r.ok || !d.ok) {
                    this.feedTest.loi = d.error || 'Không gửi được lệnh';
                    this.showToast?.(this.feedTest.loi, 'error');
                    return null;
                }

                this.feedTest.ketQua = d.mo_ta;
                this.showToast?.(d.mo_ta, 'success');
                return d;
            } catch (e) {
                this.feedTest.loi = 'Không kết nối được máy chủ';
                this.showToast?.(this.feedTest.loi, 'error');
                return null;
            } finally {
                this.feedTest.busy = false;
            }
        },

        /* ---- CHAN DOAN: lenh da toi ESP32 chua ---- */

        async feedKiemTraLenh() {
            const id = this.selectedPondId;
            if (!id) return;
            try {
                const r = await fetch(
                    `${API}/api/feed/command-status?pond_id=${encodeURIComponent(id)}`,
                    { cache: 'no-store', headers: window.VAST_DEVICE.authHeaders() }
                );
                const d = await r.json();
                if (d.ok) this.feedTest.chanDoan = d;
            } catch (e) { /* khong lam gi - chan doan hong khong quan trong bang viec chinh */ }
        },

        /**
         * Sau khi bam nut, tu kiem tra 5 lan trong 10 giay xem ESP32
         * co lay lenh khong. Nho vay nguoi dung biet ngay loi o dau
         * ma khong phai cam laptop doc Serial Monitor.
         */
        feedTheoDoiLenh() {
            let lan = 0;
            const chay = async () => {
                await this.feedKiemTraLenh();
                lan++;
                if (lan < 5) setTimeout(chay, 2000);
            };
            setTimeout(chay, 1200);
        },

        feedThuMotor(so) {
            // Giu lau khi nguoi dung dang cam dong ho do - 3 giay khong kip
            // dat que do vao chan OUT.
            const them = this.feedTest.giuLau ? { seconds: 15 } : {};
            const p = this.feedGuiLenhTest(so === 2 ? 'motor2' : 'motor1', them);
            this.feedTheoDoiLenh();
            return p;
        },

        feedDungMay() {
            return this.feedGuiLenhTest('stop');
        },

        async feedChayHieuChuan() {
            const giay = Number(this.feedTest.calibGiay) || 10;
            const d = await this.feedGuiLenhTest('calib', { seconds: giay });
            this.feedTheoDoiLenh();
            if (d) {
                this.feedTest.daChayCalib = true;
                this.feedTest.calibGam = '';
            }
        },

        /** Xem thu he so se ra bao nhieu, truoc khi luu. */
        feedHeSoTinhDuoc() {
            const gam = Number(this.feedTest.calibGam);
            const giay = Number(this.feedTest.calibGiay) || 10;
            if (!Number.isFinite(gam) || gam <= 0 || giay <= 0) return null;
            return Math.round((gam / giay) * 100) / 100;
        },

        async feedLuuHieuChuan() {
            const gps = this.feedHeSoTinhDuoc();
            if (gps === null) {
                this.feedTest.loi = 'Nhập số gam cân được đã';
                return;
            }
            // Gui ca so gam va so giay de SERVER tu tinh lai - hai ben cung
            // ra mot ket qua thi moi chac, khong tin mot phia lam tron.
            const d = await this.feedGuiLenhTest('set_calib', {
                grams: Number(this.feedTest.calibGam),
                seconds: Number(this.feedTest.calibGiay) || 10,
            });
            if (d) {
                this.feedTest.daChayCalib = false;
                this.feedTest.calibGam = '';
                this.showToast?.('ESP32 đã lưu hệ số vào bộ nhớ trong — không cần nạp lại code', 'success');
            }
        },

        /* ================= KHAI BAO THONG SO / CHAI MAU ================= */
        feedOpenSetup(pondId) {
            const id = pondId || this.selectedPondId;
            if (!id) return;

            const p = this.feedPlan(id);
            this.feed.setupPondId = id;
            this.feed.setupSeedCount = p && p.ok ? p.buoc1.seedCount : '';
            this.feed.setupSurvivalPct = p && p.ok ? p.buoc1.survivalPct : 85;
            this.feed.setupAvgWeightG = p && p.ok ? p.buoc2.avgWeightG : '';
            this.feed.setupSampleCount = '';
            this.feed.setupTotalWeightG = '';
            this.feed.setupStockMaxKg = p && p.ok && p.feedStockMaxKg ? p.feedStockMaxKg : '';
            this.feed.setupMealTimes = p && p.ok && p.mealTimes ? p.mealTimes.join(', ') : '06:00, 10:00, 14:00, 18:00';
            this.feed.showSetupModal = true;
            this.$nextTick(() => window.lucide?.createIcons());
        },

        /** Chai 30 con can 390 g -> tu tinh ra 13 g/con. */
        feedSampleAvg() {
            const soCon = Number(this.feed.setupSampleCount);
            const tong = Number(this.feed.setupTotalWeightG);
            if (!Number.isFinite(soCon) || soCon <= 0 || !Number.isFinite(tong) || tong <= 0) return null;
            return Math.round((tong / soCon) * 100) / 100;
        },

        async feedSaveSetup() {
            const id = this.feed.setupPondId;
            if (!id) return;

            // Uu tien so chai mau vi day la so DO DUOC, chinh xac hon so go tay
            const tuChaiMau = this.feedSampleAvg();
            const w = tuChaiMau !== null ? tuChaiMau : Number(this.feed.setupAvgWeightG);

            const mealTimes = String(this.feed.setupMealTimes || '')
                .split(',').map(t => t.trim())
                .filter(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));

            const payload = { pond_id: id };
            if (Number(this.feed.setupSeedCount) > 0) payload.seed_count = Number(this.feed.setupSeedCount);
            if (Number(this.feed.setupSurvivalPct) > 0) payload.survival_pct = Number(this.feed.setupSurvivalPct);
            if (Number.isFinite(w) && w > 0) payload.avg_weight_g = w;
            if (Number(this.feed.setupStockMaxKg) > 0) payload.feed_stock_max_kg = Number(this.feed.setupStockMaxKg);
            if (mealTimes.length) { payload.meal_times = mealTimes; payload.meals_per_day = mealTimes.length; }

            this.feed.loading = true;
            try {
                const r = await fetch(`${API}/api/feed/settings`, {
                    method: 'POST',
                    headers: window.VAST_DEVICE.authHeaders(true),
                    body: JSON.stringify(payload),
                });
                const d = await r.json();
                if (d.ok) {
                    this.feed.plans[id] = d.plan;
                    this.feed.showSetupModal = false;
                    this.showToast?.('Đã cập nhật thông số cho ăn', 'success');
                } else {
                    this.showToast?.(d.error || 'Lưu không được', 'error');
                }
            } catch (e) {
                this.showToast?.('Không kết nối được máy chủ', 'error');
            } finally {
                this.feed.loading = false;
            }
        },

        /** Nap them cam vao may. Tra ve du lieu server neu thanh cong. */
        async feedRefill(pondId, kg) {
            const id = pondId || this.selectedPondId;
            const amount = Number(kg);
            if (!id || !Number.isFinite(amount) || amount <= 0) return null;

            try {
                const r = await fetch(`${API}/api/feed/refill`, {
                    method: 'POST',
                    headers: window.VAST_DEVICE.authHeaders(true),
                    body: JSON.stringify({ pond_id: id, amount_kg: amount }),
                });
                const d = await r.json();
                if (d.ok) {
                    this.feed.plans[id] = d.plan;
                    return d;
                }
                this.feed.refillError = d.error || 'Nạp cám không được';
                this.showToast?.(this.feed.refillError, 'error');
                return null;
            } catch (e) {
                this.feed.refillError = 'Không kết nối được máy chủ';
                this.showToast?.('Không kết nối được máy chủ', 'error');
                return null;
            }
        },

        /* ---- Dinh dang so kieu Viet Nam ---- */
        feedNum(v) {
            if (!Number.isFinite(Number(v))) return '--';
            return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(v));
        },
    };
}
