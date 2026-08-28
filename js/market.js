/* ================================================================
   market.js - Module GIA TOM THI TRUONG cho dashboard VAST
   ----------------------------------------------------------------
   Cach dung: trong dashboard.html, farmApp() tra ve
        return { ...iotModule(), ...marketModule(), ...(phan cu) }
   roi goi  this.initMarket()  trong initApp().

   NGUYEN TAC (giong phan IoT):
   KHONG BAO GIO hien gia bia. Neu server chua lay duoc gia moi thi
   giao dien phai noi ro "so lieu cu / chua cap nhat duoc", kem gio
   cap nhat gan nhat. Nguoi nuoi ban tom that bang so nay - hien sai
   1 lan la mat long tin.
   ================================================================ */

function marketModule() {
    /* LUU Y KY THUAT QUAN TRONG:
       O day KHONG duoc dung getter ( get abc() {...} ).
       farmApp() gop module bang phep trai  { ...marketModule() }  -
       phep nay LAY GIA TRI cua getter dung 1 lan roi bien no thanh
       hang so. Bang gia se dong bang, bam Lam moi cung khong doi.
       Vi vay moi thu deu viet thanh HAM, giao dien goi kem dau ngoac:
           x-text="marketUpdatedText()"       (khong phai marketUpdatedText)
       Phan iot.js cung theo dung nguyen tac nay. */
    const CFG = window.VAST_CONFIG || {};
    const API = (CFG.API_BASE || '').replace(/\/$/, '');

    // Web tu hoi lai server moi 5 phut. Server moi la ben lay gia that
    // (mac dinh 1 lan/gio) - web chi doc lai cho nhe.
    const POLL_MS = CFG.MARKET_POLL_MS || 5 * 60 * 1000;

    // Giu doi tuong Chart NGOAI vung Alpine quan ly.
    // Ly do y het phan bieu do IoT: Alpine boc Proxy len moi thuoc tinh,
    // Chart.js so sanh tham chieu noi bo se sai -> update() khong ve lai.
    const _bieuDoGia = { chart: null };

    return {
        /* ---------------- TRANG THAI ---------------- */
        market: {
            ready: false,
            loading: false,
            error: '',

            species: 'the',        // tab dang chon: 'the' | 'su'
            all: [],               // toan bo bang gia lay ve

            updatedAt: null,       // lan server lay duoc gia moi nhat
            ageSeconds: null,
            stale: true,           // so lieu da cu chua
            usingFallback: false,  // co dong nao la so tham khao khong
            allFallback: true,     // TAT CA deu la so tham khao (chua lay duoc gi)
            counts: { auto: 0, manual: 0, fallback: 0 },
            nghiNgo: null,         // bang gia co cho nguoc quy luat khong
            source: '',
            lastError: '',
            refreshMinutes: 30,
            region: '',

            selectedCode: null,    // size dang xem bieu do
            chartDays: 30,
            chartLoading: false,
        },

        /* ================= KHOI DONG ================= */
        initMarket() {
            this.marketFetch();
            setInterval(() => this.marketFetch(), POLL_MS);
        },

        /* ================= LAY BANG GIA ================= */
        async marketFetch() {
            try {
                const r = await fetch(`${API}/api/market/prices`, { cache: 'no-store' });
                const d = await r.json();
                this.marketApply(d);
            } catch (e) {
                this.market.error = 'Không kết nối được máy chủ giá';
                this.market.ready = true;
            }
        },

        /** Bam nut "Lam moi": bao server di lay gia NGAY bay gio. */
        async marketRefresh() {
            if (this.market.loading) return;
            this.market.loading = true;
            this.market.error = '';
            try {
                const r = await fetch(`${API}/api/market/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                });
                const d = await r.json();
                this.marketApply(d);

                if (d.refreshed) {
                    this.showToast?.('Đã cập nhật giá tôm mới nhất', 'success');
                } else if (d.refresh_result && d.refresh_result.skipped) {
                    this.showToast?.('Giá vừa được cập nhật, đang dùng số liệu mới nhất', 'info');
                } else {
                    this.showToast?.('Chưa lấy được giá mới, đang hiển thị giá gần nhất', 'warning');
                }
            } catch (e) {
                this.market.error = 'Không kết nối được máy chủ giá';
                this.showToast?.('Không kết nối được máy chủ giá', 'error');
            } finally {
                this.market.loading = false;
            }
        },

        /** Do du lieu server tra ve vao trang thai giao dien. */
        marketApply(d) {
            if (!d || !d.ok) {
                this.market.error = (d && d.error) || 'Máy chủ trả về dữ liệu không hợp lệ';
                this.market.ready = true;
                return;
            }

            this.market.all = d.items || [];
            this.market.updatedAt = d.updated_at;
            this.market.ageSeconds = d.age_seconds;
            this.market.stale = !!d.stale;
            this.market.usingFallback = !!d.using_fallback;
            this.market.allFallback = !!d.all_fallback;
            this.market.counts = d.counts || { auto: 0, manual: 0, fallback: 0 };
            this.market.nghiNgo = d.nghi_ngo || null;
            this.market.source = d.source || '';
            this.market.lastError = d.last_error || '';
            this.market.refreshMinutes = d.refresh_minutes || 30;
            this.market.error = '';
            this.market.ready = true;

            const dau = this.market.all.find(i => i.region);
            this.market.region = dau ? dau.region : '';

            // Chua chon size nao -> chon size dau tien de bieu do co cai ma ve
            const rows = this.marketRows();
            if (rows.length && !rows.some(r => r.code === this.market.selectedCode)) {
                this.market.selectedCode = rows[0].code;
                this.$nextTick(() => this.marketLoadChart());
            } else if (this.market.selectedCode) {
                this.$nextTick(() => this.marketLoadChart());
            }
        },

        /* ================= DU LIEU CHO GIAO DIEN ================= */

        /** Cac dong hien trong bang: dung loai tom dang chon, chi tom thuong pham. */
        marketRows() {
            return (this.market.all || [])
                .filter(i => i.species === this.market.species && !i.is_seed && i.unit === 'đ/kg')
                .filter(i => Number.isFinite(i.price) && i.price > 0);
        },

        /** Co du lieu tom su khong (khong co thi an tab di cho gon). */
        /** Cac loai tom co du lieu -> quyet dinh hien may tab. */
        marketLoaiTom() {
            const co = new Set((this.market.all || []).filter(i => !i.is_seed).map(i => i.species));
            return [
                { ma: 'the', ten: 'Thẻ chân trắng' },
                { ma: 'su', ten: 'Tôm Sú' },
                { ma: 'cang_xanh', ten: 'Càng xanh' },
            ].filter(x => co.has(x.ma));
        },

        marketHasSu() {
            return (this.market.all || []).some(i => i.species === 'su' && !i.is_seed);
        },

        marketSetSpecies(sp) {
            if (this.market.species === sp) return;
            this.market.species = sp;
            const rows = this.marketRows();
            this.market.selectedCode = rows.length ? rows[0].code : null;
            this.$nextTick(() => this.marketLoadChart());
        },

        marketSelect(code) {
            this.market.selectedCode = code;
            this.$nextTick(() => this.marketLoadChart());
        },

        /* ---- Dinh dang hien thi ---- */

        marketPrice(n) {
            if (!Number.isFinite(n)) return '--';
            return new Intl.NumberFormat('vi-VN').format(Math.round(n));
        },

        /**
         * Muc tang/giam hien bang PHAN TRAM - dung con so trang nguon cong bo.
         * Truoc day hien so tien (+2.000 d) tinh tu database cua minh, moc so
         * sanh khong phai la hom qua nen de ra so lech.
         */
        /**
         * Ky han cua con so %: "so voi 3 tháng trước".
         *
         * BAT BUOC hien ra. Trang nguon ghi "▲ 9.1% (3 tháng)" - la tang so
         * voi 3 THANG TRUOC, khong phai so voi hom qua. Chi hien mui ten do
         * xanh khong thi nguoi nuoi tuong gia dang bien dong trong ngay.
         */
        marketKyHan(i) {
            return i && i.change_period ? `so với ${i.change_period} trước` : '';
        },

        marketDelta(i) {
            if (!i) return '';
            const p = i.change_pct;
            if (!Number.isFinite(p) || p === 0) return '';
            return (p > 0 ? '+' : '-') + Math.abs(p) + '%';
        },

        /** So tien tuong ung, de trong ngoac cho de hinh dung. */
        marketDeltaTien(i) {
            if (!i || !Number.isFinite(i.change_abs) || i.change_abs === 0) return '';
            return (i.change_abs > 0 ? '+' : '-') + this.marketPrice(Math.abs(i.change_abs)) + ' đ';
        },

        /** "hom nay" / "38 ngay" - trang nguon cap nhat dong nay luc nao. */
        marketCapNhat(i) {
            if (!i) return '';
            if (i.source_updated_text) return i.source_updated_text;
            if (Number.isFinite(i.source_age_days)) {
                if (i.source_age_days === 0) return 'hôm nay';
                if (i.source_age_days === 1) return 'hôm qua';
                return i.source_age_days + ' ngày';
            }
            return '';
        },

        marketCapNhatClass(i) {
            return (i && i.source_stale) ? 'text-orange-600 font-bold' : 'text-slate-400';
        },

        /** Nhan nho canh ben ten size: cho biet con so nay tu dau ra. */
        marketBadge(i) {
            if (!i) return null;
            if (i.manual) return { text: 'Giá nhập tay', cls: 'text-purple-600' };
            if (i.source === 'default') return { text: 'Số tham khảo', cls: 'text-slate-400' };
            return null;
        },

        marketDeltaClass(i) {
            const p = i && i.change_pct;
            if (!Number.isFinite(p) || p === 0) return 'text-slate-400';
            return p > 0 ? 'text-green-600' : 'text-red-500';
        },

        marketDeltaIcon(i) {
            const p = i && i.change_pct;
            if (!Number.isFinite(p) || p === 0) return 'minus';
            return p > 0 ? 'trending-up' : 'trending-down';
        },

        /** Chu hien duoi tieu de: cap nhat luc nao, co dang la so cu khong. */
        marketUpdatedText() {
            if (this.market.allFallback) return 'Chưa lấy được giá thị trường';
            if (!this.market.updatedAt) return 'Chưa có dữ liệu';

            const t = new Date(this.market.updatedAt);
            const phut = Math.round((Date.now() - t.getTime()) / 60000);

            let khi;
            if (phut < 1) khi = 'vừa xong';
            else if (phut < 60) khi = `${phut} phút trước`;
            else if (phut < 60 * 24) khi = `${Math.round(phut / 60)} giờ trước`;
            else khi = t.toLocaleDateString('vi-VN');

            const gio = t.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            return `Cập nhật ${khi} (${gio})`;
        },

        /** Mau cua chip trang thai: xanh = moi, vang = cu, xam = chua co. */
        marketStatusClass() {
            if (this.market.allFallback) return 'bg-slate-100 text-slate-500';
            return this.market.stale
                ? 'bg-amber-100 text-amber-700'
                : 'bg-green-100 text-green-700';
        },

        /** Nguon so lieu, viet cho nguoi thuong doc. */
        marketSourceText() {
            const s = this.market.source;
            if (s === 'manual') return 'Nhập tay';
            if (s === 'tepbac' || s === 'tepbac-loose') return 'Tép Bạc';
            if (s === 'json') return 'API riêng';
            if (s === 'default') return 'Số tham khảo';
            return s || '--';
        },

        /* ================= CO VAN THU HOACH =================
           Tinh chenh lech gia giua size hien tai va size lon hon ngay ke.
           Dung SO THAT tu bang gia, khong bia. Neu thieu du lieu thi tra
           ve null va giao dien an khoi goi y di. */
        marketGap(sizeHienTai) {
            const rows = this.marketRows().filter(r => Number.isFinite(r.size));
            if (rows.length < 2) return null;

            const hienTai = rows.find(r => r.size === Number(sizeHienTai));
            if (!hienTai) return null;

            // Size NHO hon = con to hon = gia cao hon
            const toHon = rows
                .filter(r => r.size < hienTai.size)
                .sort((a, b) => b.size - a.size)[0];
            if (!toHon) return null;

            return {
                from: hienTai,
                to: toHon,
                diff: toHon.price - hienTai.price,
            };
        },

        /* ================= GIA VAT TU DAU VAO ================= */
        // ĐÃ BỎ theo yêu cầu người dùng. Bộ đọc giá vật tư của Tép Bạc
        // liên tục lấy sai (mã dính vào tên, % của 3 tháng bị hiểu thành
        // trong ngày) — số sai về chi phí đầu vào hại hơn là không có.
        // Phần server vẫn còn, chỉ tắt trong config.js (suppliesEnabled).

        /* ================= BIEU DO XU HUONG ================= */
        async marketLoadChart() {
            const code = this.market.selectedCode;
            const el = document.getElementById('marketChart');
            if (!code || !el || typeof Chart === 'undefined') return;

            this.market.chartLoading = true;
            try {
                const r = await fetch(
                    `${API}/api/market/history?code=${encodeURIComponent(code)}&days=${this.market.chartDays}`,
                    { cache: 'no-store' }
                );
                const d = await r.json();
                const points = (d.points || []).filter(p => Number.isFinite(p.price));

                const nhan = points.map(p => {
                    const [, m, ng] = p.day.split('-');
                    return `${ng}/${m}`;
                });
                const giaTri = points.map(p => p.price);

                if (_bieuDoGia.chart) {
                    _bieuDoGia.chart.data.labels = nhan;
                    _bieuDoGia.chart.data.datasets[0].data = giaTri;
                    _bieuDoGia.chart.data.datasets[0].label = this.marketChartLabel();
                    _bieuDoGia.chart.update();
                } else {
                    _bieuDoGia.chart = new Chart(el.getContext('2d'), {
                        type: 'line',
                        data: {
                            labels: nhan,
                            datasets: [{
                                label: this.marketChartLabel(),
                                data: giaTri,
                                borderColor: '#16a34a',
                                backgroundColor: 'rgba(22,163,74,0.10)',
                                borderWidth: 2.5,
                                pointRadius: points.length > 40 ? 0 : 3,
                                pointBackgroundColor: '#16a34a',
                                tension: 0.35,
                                fill: true,
                            }],
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            interaction: { mode: 'index', intersect: false },
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    callbacks: {
                                        label: c => `${new Intl.NumberFormat('vi-VN').format(c.parsed.y)} đ/kg`,
                                    },
                                },
                            },
                            scales: {
                                y: {
                                    ticks: {
                                        callback: v => (v >= 1000 ? (v / 1000) + 'k' : v),
                                        font: { size: 11 },
                                    },
                                    grid: { color: 'rgba(148,163,184,0.15)' },
                                },
                                x: {
                                    ticks: { maxTicksLimit: 8, font: { size: 11 } },
                                    grid: { display: false },
                                },
                            },
                        },
                    });
                }
            } catch (e) {
                /* Bieu do khong ve duoc thi thoi - bang gia van hien binh thuong */
            } finally {
                this.market.chartLoading = false;
            }
        },

        marketChartLabel() {
            const i = (this.market.all || []).find(x => x.code === this.market.selectedCode);
            return i ? i.size_label : 'Giá tôm';
        },

        /** So diem lich su dang co - it qua thi giao dien noi ro cho nguoi dung. */
        marketChartPointCount() {
            return _bieuDoGia.chart ? (_bieuDoGia.chart.data.labels || []).length : 0;
        },
    };
}
