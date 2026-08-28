/* ================================================================
   store.js - LUU DU LIEU THAT cho VAST (thay cho localStorage)
   ----------------------------------------------------------------
   Cach dung: trong dashboard.html, farmApp() tra ve
        return { ...iotModule(), ...marketModule(), ...feedModule(),
                 ...storeModule(), ...(phan cu) }
   roi goi  await this.initStore()  trong initApp().

   ================================================================
   VI SAO PHAI BO localStorage
   ----------------------------------------------------------------
   Ban cu luu user / so sach / ao / nhat ky trong localStorage:

       localStorage.setItem('currentUser', JSON.stringify({...}))

   Cach do co 4 van de that su nghiem trong voi mot trai tom:

     1. Doi may, doi dien thoai  -> MAT SACH so sach thu chi
     2. Xoa lich su trinh duyet  -> MAT SACH
     3. Khong xem chung duoc     -> vo o nha va chong ngoai ao thay 2 so khac nhau
     4. Khong co tai khoan that  -> ai go so dien thoai nao cung vao duoc

   Gio: du lieu nam trong database o server. localStorage CHI con giu
   dung mot thu la MA PHIEN DANG NHAP (token) - giong cai chia khoa,
   mat chia khoa thi dang nhap lai, do dac trong nha van con nguyen.
   ================================================================ */

function storeModule() {
    const CFG = window.VAST_CONFIG || {};
    const API = (CFG.API_BASE || '').replace(/\/$/, '');

    const TOKEN_KEY = 'vast_session_token';

    function layToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
    }
    function datToken(t) {
        try {
            if (t) localStorage.setItem(TOKEN_KEY, t);
            else localStorage.removeItem(TOKEN_KEY);
        } catch { /* trinh duyet chan localStorage -> van chay duoc trong phien nay */ }
    }

    /**
     * Goi API kem ma phien.
     * Nem loi co gan them .status va .needLogin de cho goi biet phai lam gi.
     */
    async function goiApi(duongDan, tuyChon = {}) {
        const headers = { ...(tuyChon.headers || {}) };
        const token = layToken();
        if (token) headers['X-Session-Token'] = token;
        if (tuyChon.body) headers['Content-Type'] = 'application/json';

        const r = await fetch(API + duongDan, {
            method: tuyChon.method || 'GET',
            headers,
            body: tuyChon.body ? JSON.stringify(tuyChon.body) : undefined,
            cache: 'no-store',
        });

        let d = null;
        try { d = await r.json(); } catch { d = null; }

        if (!r.ok || !d || d.ok === false) {
            const e = new Error((d && d.error) || `Lỗi máy chủ (${r.status})`);
            e.status = r.status;
            e.needLogin = !!(d && d.need_login) || r.status === 401;
            throw e;
        }
        return d;
    }

    /** Them truong amountFormatted cho giao dien cu dung lai duoc. */
    function dinhDangGiaoDich(t) {
        return {
            ...t,
            amountFormatted: new Intl.NumberFormat('vi-VN').format(t.amount || 0),
        };
    }

    /** Doi nhat ky tu server sang dang giao dien dang hien. */
    function dinhDangNhatKy(l) {
        const d = new Date(l.created_at);
        return {
            id: l.id,
            time: d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            date: d.toLocaleDateString('vi-VN'),
            content: l.content,
            targetPond: l.pond_name || l.pond_id || '',
            pond_id: l.pond_id,
        };
    }

    return {
        /* ---------------- TRANG THAI ---------------- */
        store: {
            ready: false,
            loading: false,
            saving: false,
            needLogin: false,
            serverOk: true,
            error: '',
            lastSync: null,
        },

        /* ================= KHOI DONG ================= */
        async initStore() {
            this.store.loading = true;
            try {
                const me = await goiApi('/api/auth/me');

                if (!me.user) {
                    // Chua dang nhap -> ve trang dang nhap.
                    // KHONG hien dashboard voi du lieu rong, vi nguoi dung
                    // se tuong la mat het du lieu.
                    this.store.needLogin = true;
                    this.store.ready = true;
                    return false;
                }

                this.user = {
                    id: me.user.id,
                    name: me.user.name,
                    role: me.user.role,
                    avatar: me.user.avatar || '',
                    phone: me.user.phone,
                };

                this.storeApplySettings(me.settings || {});
                await this.storeLoadAll();

                this.store.serverOk = true;
                this.store.ready = true;
                return true;

            } catch (e) {
                if (e.needLogin) {
                    this.store.needLogin = true;
                } else {
                    // Mat server: KHONG duoc im lang. Nguoi dung phai biet
                    // so tren man hinh co the khong phai so moi nhat.
                    this.store.serverOk = false;
                    this.store.error = e.message;
                }
                this.store.ready = true;
                return false;
            } finally {
                this.store.loading = false;
            }
        },

        /** Neu chua dang nhap thi chuyen ve trang dang nhap. */
        storeGuard() {
            if (this.store.needLogin) {
                window.location.href = 'login.html';
                return false;
            }
            return true;
        },

        async storeLoadAll() {
            await Promise.all([
                this.storeLoadPonds(),
                this.storeLoadTransactions(),
                this.storeLoadLogs(),
            ]);
            await this.storeLoadDevices();
            this.store.lastSync = new Date().toISOString();
        },

        /* ================= THIET BI ESP32 ================= */

        // Danh sach ESP32 da dang ky tren server (chay: node seed.js)
        devices: [],

        async storeLoadDevices() {
            try {
                const d = await goiApi('/api/devices');
                this.devices = d.devices || [];
            } catch (e) {
                this.devices = [];
            }
        },

        /** Cac thiet bi con gan duoc vao ao moi. */
        storeFreeDevices() {
            return (this.devices || []).filter(d => d.gan_duoc);
        },

        /** Thiet bi may chu CO biet nhung dang bi vuong, kem ly do. */
        storeBlockedDevices() {
            return (this.devices || []).filter(d => !d.gan_duoc);
        },

        /**
         * Vi sao o chon thiet bi trong? Tra ve cau giai thich dung viec
         * phai lam tiep, thay vi de nguoi dung doan.
         */
        storeDeviceHint() {
            const tong = (this.devices || []).length;
            if (tong === 0) {
                return {
                    muc: 'chua_dang_ky',
                    text: 'Máy chủ chưa biết thiết bị nào. Mở thư mục server rồi chạy '
                        + 'node seed.js --list để xem, và node seed.js --token <token trong config.h> để đăng ký.',
                };
            }
            if (this.storeFreeDevices().length === 0) {
                return {
                    muc: 'bi_vuong',
                    text: 'Máy chủ có ' + tong + ' thiết bị nhưng đều đang gắn vào ao của tài khoản khác.',
                };
            }
            const chuaGui = this.storeFreeDevices().filter(d => !d.da_tung_gui).length;
            if (chuaGui) {
                return {
                    muc: 'chua_gui',
                    text: 'Có thiết bị đã đăng ký nhưng chưa lần nào gửi dữ liệu lên. '
                        + 'Kiểm tra SERVER_URL trong config.h có đúng IP máy này không, '
                        + 'và ESP32 có cùng mạng Wi-Fi không.',
                };
            }
            return null;
        },

        /* ================= AO NUOI ================= */
        async storeLoadPonds() {
            try {
                const d = await goiApi('/api/ponds');
                this.ponds = d.ponds || [];
                this.store.serverOk = true;
            } catch (e) {
                this.store.serverOk = false;
                this.store.error = e.message;
            }
        },

        /**
         * Tao ao tu cac ESP32 dang co - cho nguoi dung khoi phai go lai
         * khi moi chuyen sang luu bang database.
         */
        async storeAdoptDevices() {
            this.store.saving = true;
            try {
                const d = await goiApi('/api/ponds/adopt', { method: 'POST', body: {} });
                await this.storeLoadPonds();
                await this.storeLoadDevices();

                if (d.created && d.created.length) {
                    this.showToast?.(d.note, 'success');
                } else {
                    this.showToast?.(d.note || 'Không có thiết bị nào chưa gắn ao', 'info');
                }
                return d;
            } catch (e) {
                this.showToast?.(e.message, 'error');
                return null;
            } finally {
                this.store.saving = false;
            }
        },

        /** Co ESP32 nao dang cho gan vao ao khong. */
        storeCoThietBiChoGan() {
            return (this.devices || []).some(d => d.gan_duoc && !d.pond_name);
        },

        async storeAddPond(p) {
            this.store.saving = true;
            try {
                const d = await goiApi('/api/ponds', { method: 'POST', body: p });
                await this.storeLoadPonds();
                await this.storeLoadDevices();

                // Ao tao xong nhung gan thiet bi hut -> phai noi ro, khong
                // de nguoi dung tuong da gan roi roi ngoi doi so lieu mai.
                if (d.canh_bao) this.showToast?.(d.canh_bao, 'warning');
                else this.showToast?.('Đã thêm ao mới', 'success');
                return d.pond;
            } catch (e) {
                this.showToast?.(e.message, 'error');
                return null;
            } finally {
                this.store.saving = false;
            }
        },

        async storeUpdatePond(pondId, p) {
            this.store.saving = true;
            try {
                await goiApi('/api/ponds/update', { method: 'POST', body: { pond_id: pondId, ...p } });
                await this.storeLoadPonds();
                return true;
            } catch (e) {
                this.showToast?.(e.message, 'error');
                return false;
            } finally {
                this.store.saving = false;
            }
        },

        async storeDeletePond(pondId) {
            this.store.saving = true;
            try {
                const d = await goiApi('/api/ponds/delete', { method: 'POST', body: { pond_id: pondId } });
                await this.storeLoadPonds();
                this.showToast?.(d.note || 'Đã xóa ao', 'success');
                return true;
            } catch (e) {
                this.showToast?.(e.message, 'error');
                return false;
            } finally {
                this.store.saving = false;
            }
        },

        /* ================= SO SACH ================= */
        async storeLoadTransactions() {
            try {
                const d = await goiApi('/api/transactions');
                this.transactions = (d.transactions || []).map(dinhDangGiaoDich);
                this.store.serverOk = true;
            } catch (e) {
                this.store.serverOk = false;
                this.store.error = e.message;
            }
        },

        async storeAddTransaction(t) {
            this.store.saving = true;
            try {
                await goiApi('/api/transactions', { method: 'POST', body: t });
                await this.storeLoadTransactions();
                return true;
            } catch (e) {
                this.showToast?.(e.message, 'error');
                return false;
            } finally {
                this.store.saving = false;
            }
        },

        async storeUpdateTransaction(id, t) {
            this.store.saving = true;
            try {
                await goiApi('/api/transactions/update', { method: 'POST', body: { id, ...t } });
                await this.storeLoadTransactions();
                return true;
            } catch (e) {
                this.showToast?.(e.message, 'error');
                return false;
            } finally {
                this.store.saving = false;
            }
        },

        async storeDeleteTransaction(id) {
            this.store.saving = true;
            try {
                await goiApi('/api/transactions/delete', { method: 'POST', body: { id } });
                await this.storeLoadTransactions();
                return true;
            } catch (e) {
                this.showToast?.(e.message, 'error');
                return false;
            } finally {
                this.store.saving = false;
            }
        },

        /* ================= NHAT KY ================= */
        async storeLoadLogs() {
            try {
                const d = await goiApi('/api/logs');
                const tenAo = {};
                for (const p of (this.ponds || [])) tenAo[p.pond_id] = p.name;
                this.aiLogs = (d.logs || []).map(l => dinhDangNhatKy({ ...l, pond_name: tenAo[l.pond_id] }));
            } catch (e) {
                /* Nhat ky hong khong lam sap giao dien - bo qua */
            }
        },

        async storeAddLog(content, pondId) {
            try {
                await goiApi('/api/logs', { method: 'POST', body: { content, pond_id: pondId || null } });
                await this.storeLoadLogs();
                return true;
            } catch (e) {
                this.showToast?.(e.message, 'error');
                return false;
            }
        },

        /* ================= CAI DAT ================= */
        storeApplySettings(s) {
            if (s.electricity_price && Number(s.electricity_price) > 0) {
                this.electricityPrice = Number(s.electricity_price);
            }
            if (s.feed_alert_threshold) this.feedAlertThreshold = s.feed_alert_threshold;
            if (s.fingerprint_enabled !== undefined) {
                this.isFingerprintEnabled = s.fingerprint_enabled === 'true' || s.fingerprint_enabled === true;
            }
            this.storeSettings = { ...s };
        },

        storeSettings: {},

        async storeSaveSettings(obj) {
            try {
                const d = await goiApi('/api/settings', { method: 'POST', body: obj });
                this.storeSettings = d.settings || {};
                return true;
            } catch (e) {
                this.showToast?.(e.message, 'error');
                return false;
            }
        },

        /* ================= TAI KHOAN ================= */
        async storeSaveProfile({ name, avatar, role }) {
            this.store.saving = true;
            try {
                const d = await goiApi('/api/auth/profile', { method: 'POST', body: { name, avatar, role } });
                this.user = { ...this.user, ...d.user, avatar: d.user.avatar || '' };
                return true;
            } catch (e) {
                this.showToast?.(e.message, 'error');
                return false;
            } finally {
                this.store.saving = false;
            }
        },

        async storeChangePassword(oldPassword, newPassword) {
            try {
                const d = await goiApi('/api/auth/password', { method: 'POST', body: { oldPassword, newPassword } });
                // Doi mat khau xong server cap phien MOI (cac may khac bi dang xuat)
                if (d.token) datToken(d.token);
                this.showToast?.('Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.', 'success');
                return true;
            } catch (e) {
                this.showToast?.(e.message, 'error');
                return false;
            }
        },

        async storeLogout() {
            try { await goiApi('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* van dang xuat */ }
            datToken('');
            window.location.href = 'login.html';
        },

        /* ================= TRUY XUAT NGUON GOC (QR) ================= */

        // Ho so truy xuat cua ao dang xem
        qrData: null,
        qrLink: null,      // { code, url, card_mang, dia_chi_khac, canh_bao, ghi_chu }
        qrLoading: false,
        qrError: '',

        /** Mo modal QR va nap ho so THAT (khong hien so cung nua). */
        async openQR() {
            this.showQRModal = true;
            this.qrData = null;
            this.qrError = '';

            const ma = this.storeTraceCode();
            if (!ma) {
                this.qrError = 'Ao này chưa có mã truy xuất. Hãy tạo lại ao hoặc liên hệ hỗ trợ.';
                return;
            }

            this.qrLoading = true;
            try {
                // Hoi may chu xem ma QR dang chua dia chi nao, de chu duoi ma
                // khop voi cai that su nam trong ma. Loi o day khong chan viec
                // xem ho so -> bat rieng.
                fetch(`${API}/api/trace/link?code=${encodeURIComponent(ma)}`, { cache: 'no-store' })
                    .then(r => r.json())
                    .then(d => { if (d && d.ok) this.qrLink = d; })
                    .catch(() => { /* van hien duoc ho so */ });

                // Goi dung API CONG KHAI ma nguoi mua se goi -> cai chu ao
                // nhin thay tren man hinh dung bang cai khach hang nhin thay.
                const r = await fetch(`${API}/api/trace?code=${encodeURIComponent(ma)}`, { cache: 'no-store' });
                const d = await r.json();
                if (!r.ok || !d.ok) throw new Error(d.error || 'Không tra cứu được hồ sơ');
                this.qrData = d;
            } catch (e) {
                this.qrError = e.message;
            } finally {
                this.qrLoading = false;
                this.$nextTick(() => window.lucide?.createIcons());
            }
        },

        qrNhomLabel(nhom) {
            return ({
                giong: 'Con giống',
                thuc_an: 'Thức ăn',
                xu_ly: 'Chất xử lý',
                thuoc: 'Thuốc',
            })[nhom] || nhom;
        },

        qrCoDauVao() {
            const dv = this.qrData && this.qrData.dau_vao;
            if (!dv) return false;
            return Object.values(dv).some(x => Array.isArray(x) && x.length);
        },


        /** Duong dan cong khai cho nguoi mua tom quet ma. */
        /**
         * Duong dan truy xuat cong khai.
         *
         * Uu tien dia chi do MAY CHU tra ve, khong tu ghep tu window.location.
         * Ly do: chu ao hay mo dashboard bang http://localhost:3000. Neu ghep
         * tu do thi chu duoi ma QR ghi "localhost" trong khi ma QR lai chua
         * IP LAN - hai dang khac nhau, va cai localhost thi dien thoai nguoi
         * khac quet vao khong bao gio ra.
         */
        storeTraceUrl(pond) {
            const p = pond || this.selectedPond;
            if (!p || !p.trace_code) return '';
            if (this.qrLink && this.qrLink.code === p.trace_code) return this.qrLink.url;
            return `${window.location.origin}/trace.html?code=${encodeURIComponent(p.trace_code)}`;
        },

        storeTraceCode(pond) {
            const p = pond || this.selectedPond;
            return p && p.trace_code ? p.trace_code : '';
        },

        /**
         * Duong dan anh QR do may chu tu ve (SVG).
         * Khong goi ra Internet -> ngoai ao mat mang van in duoc ma dan thung tom.
         */
        storeTraceQrUrl(pond) {
            const ma = this.storeTraceCode(pond);
            return ma ? `${API}/api/trace/qr?code=${encodeURIComponent(ma)}` : '';
        },

        /* ---- Tien ich ---- */
        storeToken: layToken,
        storeSetToken: datToken,
        storeApi: goiApi,
    };
}
