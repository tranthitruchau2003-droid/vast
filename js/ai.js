/* ================================================================
   ai.js - TRO LY: GIONG NOI THAT + CO VAN + HOI DAP
   ----------------------------------------------------------------
   Cach dung: trong dashboard.html, farmApp() tra ve
        return { ...iotModule(), ...marketModule(), ...feedModule(),
                 ...storeModule(), ...aiModule(), ...(phan cu) }
   roi goi  this.initAi()  trong initApp().

   ================================================================
   NUT MICRO CU LA GIA - DAY LA BAN THAT
   ----------------------------------------------------------------
   Ban cu cua toggleRecording():

       toggleRecording() {
           if (this.isRecording) {
               this.isRecording = false;
               this.voiceResult = "Cho ao so 1 an 5 ky thuc an.";   // cau CUNG
           } else {
               this.isRecording = true;
               setTimeout(() => this.toggleRecording(), 3000);      // chi doi 3 giay
           }
       }

   Khong dung micro. Noi gi cung ra dung mot cau do.

   Ban nay dung Web Speech API co san trong Chrome/Edge, nhan tieng Viet
   that (vi-VN). Khong can cai gi, khong ton tien.
   Firefox khong ho tro -> BAO RO cho nguoi dung, khong im lang gia vo chay.

   ================================================================
   "AI" O DAY LA GI
   ----------------------------------------------------------------
   Khong phai mo hinh ngon ngu. La BO LUAT chay tren so lieu that cua ao:
   DO, nhiet do tu ESP32, ngay tuoi tom, gia thi truong, mua vu.
   Giao dien goi dung ten no, khong dan nhan "AI thong minh".
   ================================================================ */

function aiModule() {
    const CFG = window.VAST_CONFIG || {};
    const API = (CFG.API_BASE || '').replace(/\/$/, '');

    // Doi tuong nhan dang giong noi - giu ngoai vung Alpine quan ly
    const _mic = { rec: null, dangChay: false };

    /** Trinh duyet nay co ho tro nhan dang giong noi khong. */
    function coMicro() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    return {
        /* ---------------- TRANG THAI ---------------- */
        ai: {
            // --- giong noi ---
            micHoTro: true,
            micLoi: '',
            nghiTam: '',          // chu dang nghe do dang (interim)

            // --- cau vua noi/go, cho xac nhan truoc khi ghi ---
            nhap: '',
            phanLoai: null,       // ket qua /api/logs/classify
            dangPhanLoai: false,
            chonAo: '',           // nguoi dung chon tay khi he thong khong chac

            // --- hoi dap ---
            cauHoi: '',
            dangHoi: false,
            traLoi: null,
            goiY: [],

            // --- co van ---
            coVan: null,
            viecGap: [],
            dangTaiCoVan: false,

            cheDo: 'ghi',         // 'ghi' = ghi nhat ky | 'hoi' = hoi dap
        },

        /* ================= KHOI DONG ================= */
        initAi() {
            this.ai.micHoTro = coMicro();
            this.aiTaiGoiY();
            this.aiTaiCoVan();
            // Co van doc so cam bien -> lam moi dinh ky cho khop voi thuc te
            setInterval(() => this.aiTaiCoVan(), 3 * 60 * 1000);
        },

        /* ================= GIONG NOI THAT ================= */

        aiBatMicro() {
            if (!coMicro()) {
                this.ai.micHoTro = false;
                this.ai.micLoi = 'Trình duyệt này không nhận được giọng nói. '
                    + 'Hãy dùng Chrome hoặc Edge, hoặc gõ tay vào ô bên dưới.';
                return;
            }

            if (_mic.dangChay) { this.aiTatMicro(); return; }

            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            const rec = new SR();
            rec.lang = 'vi-VN';          // nhan tieng Viet
            rec.continuous = false;
            rec.interimResults = true;   // hien chu ngay trong luc noi
            rec.maxAlternatives = 1;

            this.ai.micLoi = '';
            this.ai.nghiTam = '';
            this.voiceResult = '';

            rec.onstart = () => {
                _mic.dangChay = true;
                this.isRecording = true;
            };

            rec.onresult = (e) => {
                let xong = '', dangDo = '';
                for (let i = e.resultIndex; i < e.results.length; i++) {
                    const t = e.results[i][0].transcript;
                    if (e.results[i].isFinal) xong += t;
                    else dangDo += t;
                }
                this.ai.nghiTam = dangDo;
                if (xong) {
                    this.voiceResult = xong.trim();
                    this.ai.nhap = xong.trim();
                    this.ai.nghiTam = '';
                    // Noi xong la phan loai luon, khong bat nguoi dung bam them
                    this.aiPhanLoai(xong.trim());
                }
            };

            rec.onerror = (e) => {
                _mic.dangChay = false;
                this.isRecording = false;
                // Noi RO tung loai loi, khong gop thanh mot cau chung chung
                const bang = {
                    'not-allowed': 'Trình duyệt chưa được cấp quyền dùng micro. '
                        + 'Bấm vào ổ khóa cạnh thanh địa chỉ rồi cho phép Micro.',
                    'service-not-allowed': 'Trình duyệt chặn nhận dạng giọng nói.',
                    'no-speech': 'Không nghe thấy gì. Nói to hơn và gần micro hơn.',
                    'audio-capture': 'Không tìm thấy micro nào trên máy.',
                    'network': 'Nhận dạng giọng nói cần mạng — kiểm tra kết nối Internet.',
                    'aborted': '',
                };
                this.ai.micLoi = bang[e.error] !== undefined
                    ? bang[e.error]
                    : `Lỗi nhận giọng nói: ${e.error}`;
            };

            rec.onend = () => {
                _mic.dangChay = false;
                this.isRecording = false;
                this.ai.nghiTam = '';
            };

            _mic.rec = rec;
            try {
                rec.start();
            } catch (e) {
                this.ai.micLoi = 'Không bật được micro: ' + e.message;
                _mic.dangChay = false;
                this.isRecording = false;
            }
        },

        aiTatMicro() {
            try { _mic.rec && _mic.rec.stop(); } catch { /* bo qua */ }
            _mic.dangChay = false;
            this.isRecording = false;
        },

        /* ================= PHAN LOAI TRUOC KHI GHI ================= */

        /**
         * Hoi server: cau nay thuoc AO nao, LOAI viec gi.
         * Hien cho nguoi dung xem roi moi ghi that -> khong bao gio ghi nham ao.
         */
        async aiPhanLoai(text) {
            const noiDung = String(text || this.ai.nhap || '').trim();
            if (!noiDung) return;

            this.ai.dangPhanLoai = true;
            this.ai.phanLoai = null;
            try {
                const d = await this.storeApi('/api/logs/classify', {
                    method: 'POST',
                    body: { text: noiDung, pond_id: this.selectedPondId || null },
                });
                this.ai.phanLoai = d;
                this.ai.chonAo = d.pond_id || '';
            } catch (e) {
                this.showToast?.(e.message, 'error');
            } finally {
                this.ai.dangPhanLoai = false;
                this.$nextTick(() => window.lucide?.createIcons());
            }
        },

        /** Ghi that vao nhat ky, sau khi nguoi dung da xac nhan ao. */
        async aiGhiNhatKy() {
            const pl = this.ai.phanLoai;
            if (!pl) return;

            const pondId = this.ai.chonAo || pl.pond_id || null;
            if (!pondId && (pl.danh_sach_ao || []).length > 1) {
                this.showToast?.('Chọn ao trước khi ghi', 'warning');
                return;
            }

            try {
                const d = await this.storeApi('/api/logs', {
                    method: 'POST',
                    body: { content: pl.noi_dung, pond_id: pondId, loai: pl.loai },
                });
                await this.storeLoadLogs();

                this.showToast?.(
                    `Đã ghi vào ${d.pond_name || 'nhật ký chung'}${d.loai_ten ? ' — ' + d.loai_ten : ''}`,
                    'success'
                );

                // Dung thuoc -> nhac ghi vao ho so truy xuat, vi thoi gian ngung
                // thuoc la thu quyet dinh ngay duoc phep thu hoach
                if (d.nhac_them) {
                    setTimeout(() => this.showToast?.(d.nhac_them, 'warning'), 1200);
                }

                this.aiXoaNhap();
                this.aiTaiCoVan();
            } catch (e) {
                this.showToast?.(e.message, 'error');
            }
        },

        aiXoaNhap() {
            this.ai.nhap = '';
            this.ai.phanLoai = null;
            this.ai.chonAo = '';
            this.voiceResult = '';
            this.aiTextInput = '';
        },

        /* ================= HOI DAP ================= */

        async aiTaiGoiY() {
            try {
                const r = await fetch(`${API}/api/ask/suggestions`, { cache: 'no-store' });
                const d = await r.json();
                if (d.ok) this.ai.goiY = d.goi_y || [];
            } catch { /* bo qua */ }
        },

        async aiHoi(cau) {
            const q = String(cau || this.ai.cauHoi || '').trim();
            if (!q) return;

            this.ai.dangHoi = true;
            this.ai.traLoi = null;
            this.ai.cauHoi = q;
            try {
                const d = await this.storeApi('/api/ask', {
                    method: 'POST',
                    body: { question: q, pond_id: this.selectedPondId || null },
                });
                this.ai.traLoi = d;
                if (d.goi_y) this.ai.goiY = d.goi_y;
            } catch (e) {
                this.showToast?.(e.message, 'error');
            } finally {
                this.ai.dangHoi = false;
                this.$nextTick(() => window.lucide?.createIcons());
            }
        },

        aiXoaTraLoi() {
            this.ai.traLoi = null;
            this.ai.cauHoi = '';
        },

        /* ================= CO VAN ================= */

        async aiTaiCoVan() {
            this.ai.dangTaiCoVan = true;
            try {
                const d = await this.storeApi('/api/advisor/all');
                this.ai.coVan = d;
                this.ai.viecGap = d.viec_gap || [];
            } catch (e) {
                /* chua dang nhap hoac mat server - khong lam sap giao dien */
            } finally {
                this.ai.dangTaiCoVan = false;
            }
        },

        /** Loi khuyen cua ao dang xem. */
        aiCoVanAo(pondId) {
            const id = pondId || this.selectedPondId;
            if (!id || !this.ai.coVan) return null;
            return (this.ai.coVan.ao || []).find(a => a.pond_id === id) || null;
        },

        aiLoiKhuyen(pondId) {
            const a = this.aiCoVanAo(pondId);
            return a && a.ok ? a.loi_khuyen : [];
        },

        /** Chi lay viec cần làm ngay (bo qua muc thong tin). */
        aiViecCanLam(pondId) {
            return this.aiLoiKhuyen(pondId).filter(x => x.muc === 'nguy_hiem' || x.muc === 'canh_bao');
        },

        aiMucClass(muc) {
            return ({
                nguy_hiem: 'bg-red-50 border-red-200',
                canh_bao: 'bg-amber-50 border-amber-200',
                goi_y: 'bg-blue-50 border-blue-200',
                thong_tin: 'bg-slate-50 border-slate-200',
            })[muc] || 'bg-slate-50 border-slate-200';
        },

        aiMucTextClass(muc) {
            return ({
                nguy_hiem: 'text-red-800',
                canh_bao: 'text-amber-800',
                goi_y: 'text-blue-800',
                thong_tin: 'text-slate-700',
            })[muc] || 'text-slate-700';
        },

        aiMucIcon(muc) {
            return ({
                nguy_hiem: 'alert-octagon',
                canh_bao: 'alert-triangle',
                goi_y: 'lightbulb',
                thong_tin: 'info',
            })[muc] || 'info';
        },

        aiNhomIcon(nhom) {
            return ({
                oxy: 'wind',
                nhiet_do: 'thermometer',
                benh: 'shield-alert',
                thi_truong: 'trending-up',
                cho_an: 'utensils',
                mua_vu: 'cloud-rain',
            })[nhom] || 'info';
        },

        /* ================= NHAT KY THEO AO ================= */

        /** Nhat ky cua 1 ao, moi nhat len truoc. */
        aiNhatKyAo(pondId) {
            const id = pondId || this.selectedPondId;
            if (!id) return this.aiLogs || [];
            return (this.aiLogs || []).filter(l => l.pond_id === id);
        },

        /** Gom nhat ky theo ao de hien o man hinh Tro ly. */
        aiNhatKyTheoAo() {
            const nhom = [];
            for (const p of (this.ponds || [])) {
                const logs = (this.aiLogs || []).filter(l => l.pond_id === p.pond_id);
                if (logs.length) nhom.push({ pond: p, logs });
            }
            const chung = (this.aiLogs || []).filter(l => !l.pond_id);
            if (chung.length) nhom.push({ pond: { pond_id: null, name: 'Chưa gắn ao' }, logs: chung });
            return nhom;
        },
    };
}
