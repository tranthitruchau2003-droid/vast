/* ================================================================
   iot.js - Module ket noi ESP32 THAT cho dashboard VAST
   ----------------------------------------------------------------
   Cach dung: trong dashboard.html, farmApp() tra ve
        return { ...iotModule(), ...(phan cu giu nguyen) }
   roi goi  this.initIot()  trong initApp().

   Module nay KHONG dung toi bat ky bien/ham cu nao cua giao dien,
   chi THEM du lieu that vao cac ao da co san.

   NGUYEN TAC QUAN TRONG (yeu cau muc 6):
   Khi nguoi dung bam BAT/TAT, web KHONG tu doi mau nut ngay.
   Web gui lenh -> ESP32 thuc hien -> ESP32 gui trang thai THAT ve
   -> luc do nut moi doi. Trong luc cho, nut hien trang thai "dang gui...".
   ================================================================ */

function iotModule() {
    const CFG = window.VAST_CONFIG || {};
    const API = (CFG.API_BASE || '').replace(/\/$/, '');
    const POLL_MS = CFG.POLL_MS || 2000;
    const CMD_TIMEOUT = CFG.COMMAND_TIMEOUT_MS || 15000;
    const CHART_REFRESH_MS = CFG.CHART_REFRESH_MS || 3000;

    /* ================================================================
       KHO CHUA DOI TUONG BIEU DO - NAM NGOAI VUNG QUAN LY CUA ALPINE
       ----------------------------------------------------------------
       VI SAO PHAI LAM THE NAY:
       Alpine.js boc MOI thuoc tinh cua component bang Proxy de theo doi
       thay doi. Neu luu doi tuong Chart vao this.chartInstance thi no
       cung bi boc Proxy.

       Chart.js so sanh THAM CHIEU noi bo de biet du lieu co doi khong.
       Qua lop Proxy, phep so sanh do sai -> goi chart.update() khong ve
       lai duoc. Ve MOI hoan toan thi van chay, nen truoc day phai F5
       hoac thoat ra vao lai moi thay duong bieu do cap nhat.

       Giu chart trong bien closure nay (Alpine khong dung toi) thi
       update() chay dung. Ngoai ra con nhanh hon nhieu, vi doi tuong
       Chart rat lon, bat Alpine theo doi no la rat ton.
       ================================================================ */
    const _bieuDo = { overview: null, detail: null, finance: null };

    return {
        /* ---------------- TRANG THAI IOT ---------------- */
        iot: {
            ready: false,          // da lay duoc danh sach thiet bi chua
            serverOk: false,       // co lien lac duoc backend khong
            streamOk: false,       // luong day realtime (SSE) dang chay tot khong
            _stream: null,
            byPond: {},            // { pond_id: <du lieu thiet bi> }
            thresholds: { doOn: 5.0, doOff: 5.5, tempPumpOn: 32.0, tempPumpOff: 31.5 },
            pending: {},           // { "pond_id:pump": {value, at} } - lenh dang cho ESP32 xac nhan
            lastError: '',
        },

        /* ================= KHOI DONG ================= */
        initIot() {
            // 1) Duong CHINH: server day du lieu xuong tuc thi
            this.iotConnectStream();

            // 2) Lay ngay 1 lan de co so lieu hien lien
            this.iotPoll();

            // 3) Duong DU PHONG: neu luong day bi hong thi quay ve hoi-dap.
            //    Khi luong day dang chay tot thi chi hoi tham thua thot cho chac.
            setInterval(() => {
                if (!this.iot.streamOk) this.iotPoll();
            }, POLL_MS);
            setInterval(() => this.iotPoll(), 10000);

            // ===== TU DONG CAP NHAT BIEU DO (realtime) =====
            // Lich su ghi 30s/lan, nhung diem cuoi cung cua duong bieu do la
            // gia tri DANG DOC ngay luc nay, nen duong ve van nhuc nhich lien tuc.
            setInterval(() => this.iotRefreshCharts(), CHART_REFRESH_MS);
        },

        /* Ve lai bieu do CHI TIET AO ma KHONG giat man hinh.
           Bieu do "moi truong chung" o man hinh tong quan da duoc bo. */
        async iotRefreshCharts() {
            if (document.hidden) return;              // tab dang chay nen -> khoi ton tai nguyen
            if (this.selectedPondId) await this.refreshDetailChart();
        },

        /* ================= LAY DU LIEU VE BIEU DO =================
           Tra ve { labels, datasets } lay tu LICH SU THAT cua ESP32,
           diem cuoi cung la gia tri REALTIME dang doc.
           Tra ve null neu ao do chua gan ESP32 -> noi goi se dung so demo cu. */
        async iotChartData(pondId, range = '1d') {
            const d = this.iot.byPond[pondId];
            if (!d) return null;

            let pts = [];
            try {
                const r = await fetch(
                    `${API}/api/iot/history/${encodeURIComponent(d.device_id)}?range=${range}&max=300`,
                    { cache: 'no-store' }
                );
                const j = await r.json();
                pts = j.points || [];
            } catch (e) {
                return null;                          // mat server -> giu nguyen bieu do cu
            }

            const gio = t => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const labels = pts.map(p => gio(p.t));
            const nhietDo = pts.map(p => p.temperature);
            const oxy = pts.map(p => p.do_value);
            const congSuat = pts.map(p => p.power_w);

            // ===== DIEM REALTIME =====
            // Them gia tri DANG DOC vao cuoi -> duong bieu do chay theo thoi gian thuc,
            // khong phai doi 30 giay moi thay nhuc nhich.
            if (d.online) {
                labels.push(gio(d.updated_at || Date.now()));
                nhietDo.push(d.temperature);
                oxy.push(d.do_value);
                congSuat.push(d.power_w);
            }

            if (labels.length === 0) {
                return {
                    labels: ['Đang chờ dữ liệu...'],
                    datasets: [{ label: 'Chưa có dữ liệu', data: [null], borderColor: '#cbd5e1' }],
                    empty: true,
                };
            }

            return {
                labels,
                datasets: [
                    {
                        label: 'Nhiệt độ (°C)', data: nhietDo, yAxisID: 'yTemp',
                        borderColor: '#16a34a', backgroundColor: 'rgba(22, 163, 74, 0.08)',
                        borderWidth: 3, tension: 0.35, fill: true, spanGaps: true, pointRadius: 0,
                    },
                    {
                        label: 'DO (mg/L)', data: oxy, yAxisID: 'yDo',
                        borderColor: '#3b82f6', borderWidth: 3, tension: 0.35,
                        spanGaps: true, pointRadius: 0,
                    },
                    {
                        label: 'Công suất (W)', data: congSuat, yAxisID: 'yPow',
                        borderColor: '#eab308', borderWidth: 2, tension: 0.35,
                        spanGaps: true, pointRadius: 0, borderDash: [5, 4],
                    },
                ],
            };
        },

        /* ================= CAU HINH BIEU DO =================
           MOI DAI LUONG MOT TRUC RIENG.
           Truoc day nhiet do (~29) va DO (~6) dung chung 1 truc 0..30,
           nen nhiet do doi 0.5 do chi nhich 1 pixel -> nhin nhu duong thang.
           Tach truc ra thi moi duong tu co gian theo khoang cua no,
           thay doi nho van nhin thay ro. */
        iotChartOptions() {
            return {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,                       // khong hieu ung -> cap nhat muot
                interaction: { mode: 'index', intersect: false },

                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, boxWidth: 8, padding: 16, font: { weight: 'bold', size: 12 } },
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const v = ctx.parsed.y;
                                if (v === null || v === undefined) return ctx.dataset.label + ': --';
                                const soLe = ctx.dataset.yAxisID === 'yTemp' ? 2 : 2;
                                return `${ctx.dataset.label}: ${v.toFixed(soLe)}`;
                            },
                        },
                    },
                },

                scales: {
                    // Truc TRAI - nhiet do, tu co gian quanh gia tri thuc
                    yTemp: {
                        type: 'linear', position: 'left',
                        beginAtZero: false, grace: '25%',   // chua le tren duoi cho de nhin
                        title: { display: true, text: 'Nhiệt độ (°C)', color: '#16a34a', font: { weight: 'bold' } },
                        ticks: { color: '#16a34a', maxTicksLimit: 6 },
                        grid: { color: '#f1f5f9' },
                    },
                    // Truc PHAI - DO
                    yDo: {
                        type: 'linear', position: 'right',
                        beginAtZero: false, grace: '25%',
                        title: { display: true, text: 'DO (mg/L)', color: '#3b82f6', font: { weight: 'bold' } },
                        ticks: { color: '#3b82f6', maxTicksLimit: 6 },
                        grid: { drawOnChartArea: false },   // khong ve luoi chong len luoi truc trai
                    },
                    // Cong suat: van ve duong nhung an truc cho do roi mat
                    yPow: { type: 'linear', display: false, beginAtZero: true, grace: '30%' },

                    x: {
                        grid: { display: false },
                        ticks: { maxTicksLimit: 8, autoSkip: true, maxRotation: 0 },
                    },
                },
            };
        },

        /* ---- Luu / lay doi tuong bieu do (dat ngoai vung Alpine) ---- */
        iotSetChart(ten, chart) {
            if (_bieuDo[ten]) { try { _bieuDo[ten].destroy(); } catch (e) { } }
            _bieuDo[ten] = chart;
            return chart;
        },

        /**
         * Huy bieu do dang bam tren MOT THE CANVAS, truoc khi ve cai moi.
         *
         * ================================================================
         * VI SAO CAN HAM NAY
         * ----------------------------------------------------------------
         * Cach viet cu:
         *
         *     this.iotSetChart('detail', new Chart(ctx, {...}))
         *
         * Nhin thi tuong iotSetChart se huy bieu do cu. Nhung Javascript
         * tinh doi so TRUOC khi goi ham: `new Chart(...)` chay truoc, gap
         * canvas dang con bieu do cu bam vao nen Chart.js nem loi
         *
         *     "Canvas is already in use. Chart with ID '1' must be
         *      destroyed before the canvas can be reused."
         *
         * Loi nem ra giua chung nen iotSetChart KHONG BAO GIO duoc goi,
         * bieu do cu van con nguyen. Ket qua: bam 1 Ngay / 7 Ngay / 30 Ngay
         * khong doi gi het, va loi thi nam im trong console.
         *
         * Nen: goi ham nay TRUOC khi new Chart().
         * ================================================================
         */
        iotHuyChartTren(canvas) {
            if (!canvas) return;
            try {
                const cu = (window.Chart && Chart.getChart) ? Chart.getChart(canvas) : null;
                if (cu) cu.destroy();
            } catch (e) { /* khong co gi de huy */ }
            for (const ten of Object.keys(_bieuDo)) {
                if (_bieuDo[ten] && _bieuDo[ten].canvas === canvas) _bieuDo[ten] = null;
            }
        },
        iotGetChart(ten) {
            return _bieuDo[ten];
        },

        /* Cap nhat du lieu VAO BIEU DO CO SAN (khong ve lai tu dau -> khong nhap nhay) */
        iotApplyChartData(chart, data) {
            if (!chart || !data) return;
            chart.data.labels = data.labels;

            // Neu so duong thay doi (vi du tu demo sang du lieu that) thi thay ca bo
            if (chart.data.datasets.length !== data.datasets.length) {
                chart.data.datasets = data.datasets;
            } else {
                data.datasets.forEach((ds, i) => {
                    chart.data.datasets[i].label = ds.label;
                    chart.data.datasets[i].data = ds.data;
                });
            }
            chart.update('none');     // 'none' = khong chay hieu ung -> muot, khong giat
        },

        /* ================= LUONG REALTIME (server tu day xuong) =================
           Day la duong CHINH lay du lieu: server day xuong ngay khi ESP32 gui len,
           do tre gan nhu bang 0. Neu trinh duyet khong ho tro hoac ket noi hong
           thi tu dong quay ve kieu hoi-dap (iotPoll) ben duoi. */
        iotConnectStream() {
            if (typeof EventSource === 'undefined') return;   // trinh duyet qua cu

            try {
                const es = new EventSource(API + '/api/iot/stream');

                es.onmessage = (ev) => {
                    try {
                        this.iotApplyPayload(JSON.parse(ev.data));
                        this.iot.streamOk = true;
                    } catch (e) { /* goi hong -> bo qua, goi sau se bu */ }
                };

                es.onopen = () => { this.iot.streamOk = true; };

                // EventSource TU DONG ket noi lai, khong can lam gi them
                es.onerror = () => { this.iot.streamOk = false; };

                this.iot._stream = es;
            } catch (e) {
                this.iot.streamOk = false;
            }
        },

        /* ================= LAY DU LIEU KIEU HOI-DAP (du phong) ================= */
        async iotPoll() {
            try {
                const r = await fetch(API + '/api/iot/latest', { cache: 'no-store' });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                this.iotApplyPayload(await r.json());
            } catch (e) {
                this.iot.serverOk = false;
                this.iot.lastError = 'Khong ket noi duoc server: ' + e.message;
            }
        },

        /* Do goi du lieu (tu SSE hoac tu poll) vao giao dien */
        iotApplyPayload(j) {
            if (!j || !j.data) return;

            this.iot.serverOk = true;
            this.iot.lastError = '';
            this.iot.ready = true;
            if (j.thresholds) this.iot.thresholds = j.thresholds;

            const map = {};
            j.data.forEach(d => { map[d.pond_id] = d; });
            this.iot.byPond = map;

            // Do du lieu that vao cac ao dang hien tren giao dien
            j.data.forEach(d => this.iotSyncPond(d));

            this.iotBuildAlerts(j.data);
        },

        /* Do du lieu ESP32 vao object ao co san -> giao dien cu tu dong hien so that */
        iotSyncPond(d) {
            const pond = this.ponds.find(p => p.id === d.pond_id);
            if (!pond) return;

            pond.iot = d;   // gan nguyen cuc du lieu de template dung truc tiep

            if (!d.online) {
                // MAT KET NOI: khong ghi de so lieu cu, chi danh dau nguy hiem.
                // Khong duoc hien Online gia (yeu cau muc 5).
                pond.status = 'danger';
                return;
            }

            if (d.temperature !== null && d.temperature !== undefined) {
                pond.temperature = Math.round(d.temperature * 10) / 10;
            }
            if (d.do_value !== null && d.do_value !== undefined) {
                pond.do = Math.round(d.do_value * 100) / 100;
            }

            // pH: ESP32 chua gan cam bien -> giu nguyen so demo cu, chi danh dau
            // la KHONG PHAI du lieu that de giao dien ghi "Chua ket noi cam bien".
            pond.phLive = !!d.ph_connected;
            if (d.ph_connected && d.ph !== null) pond.ph = Math.round(d.ph * 100) / 100;

            // Trang thai relay THAT tu ESP32 (day moi la nguon su that)
            pond.fan = !!d.aerator;    // GPIO26 - guong oxy
            pond.pump = !!d.pump;      // GPIO27 - may bom

            // Lenh nao da duoc ESP32 xac nhan thi xoa khoi hang cho
            this.iotClearPendingIfMatched(d);

            // Trang thai mau the ao
            const th = this.iot.thresholds;
            if ((d.do_value !== null && d.do_value < th.doOn) ||
                (d.temperature !== null && d.temperature > th.tempPumpOn)) {
                pond.status = 'danger';
            } else if ((d.do_value !== null && d.do_value < th.doOff) ||
                (d.temperature !== null && d.temperature > th.tempPumpOff)) {
                pond.status = 'warning';
            } else {
                pond.status = 'safe';
            }
        },

        /* ================= CANH BAO ================= */
        /* Chi thay the cac canh bao do IoT sinh ra (code bat dau bang 'IOT_'),
           giu nguyen canh bao demo cu (vi du nut "Demo Tut pH"). */
        iotBuildAlerts(list) {
            const keepOld = (this.alerts || []).filter(a => !a.iot);
            const iotAlerts = [];

            list.forEach(d => {
                const pond = this.ponds.find(p => p.id === d.pond_id);
                const pondName = pond ? pond.name : d.pond_id;

                (d.alerts || []).forEach(a => {
                    iotAlerts.push({
                        id: 'iot_' + d.device_id + '_' + a.code,
                        iot: true,
                        pondId: d.pond_id,
                        title: a.title,
                        message: a.message.replace(d.device_id, pondName),
                        timestamp: new Date().toLocaleTimeString('vi-VN'),
                        recommendation: a.recommendation,
                    });
                });
            });

            this.alerts = [...iotAlerts, ...keepOld];
        },

        /* ================= GUI LENH XUONG ESP32 ================= */
        async iotSendCommand(pondId, command, value) {
            const d = this.iot.byPond[pondId];
            if (!d) { this.showToast('Ao nay chua gan thiet bi ESP32', 'info'); return false; }

            if (!d.online) {
                this.errorMessage = 'ESP32 dang MAT KET NOI. Khong the gui lenh luc nay.';
                this.showErrorModal = true;
                return false;
            }

            try {
                const r = await fetch(API + '/api/iot/command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ device_id: d.device_id, command, value }),
                });
                const j = await r.json();
                if (!j.ok) throw new Error(j.error || 'Loi khong ro');
                return true;
            } catch (e) {
                this.errorMessage = 'Gui lenh that bai: ' + e.message;
                this.showErrorModal = true;
                return false;
            }
        },

        /* --- Chuyen AUTO / MANUAL --- */
        async iotSetMode(pondId, mode) {
            const key = pondId + ':mode';
            this.iot.pending[key] = { value: mode, at: Date.now() };
            const ok = await this.iotSendCommand(pondId, 'SET_MODE', mode);
            if (!ok) { delete this.iot.pending[key]; return; }
            this.showToast(`Da gui lenh chuyen sang che do ${mode}. Dang cho ESP32 xac nhan...`, 'info');
        },

        /* --- Bat/tat MAY BOM (GPIO27) hoac GUONG OXY (GPIO26) --- */
        async iotSetDevice(pondId, which, value) {
            const d = this.iot.byPond[pondId];
            if (!d) return;

            if (d.mode !== 'MANUAL') {
                this.errorMessage = 'Dang o che do AUTO - ESP32 tu dieu khien. Hay chuyen sang MANUAL truoc.';
                this.showErrorModal = true;
                return;
            }

            const key = pondId + ':' + which;
            this.iot.pending[key] = { value, at: Date.now() };

            const cmd = which === 'pump' ? 'SET_PUMP' : 'SET_AERATOR';
            const ok = await this.iotSendCommand(pondId, cmd, value);
            if (!ok) { delete this.iot.pending[key]; return; }

            this.showToast(
                `Da gui lenh ${value ? 'BAT' : 'TAT'} ${which === 'pump' ? 'may bom' : 'guong oxy'}. Dang cho thiet bi xac nhan...`,
                'info'
            );
        },

        /* Xoa hang cho khi ESP32 da bao trang thai dung nhu lenh */
        iotClearPendingIfMatched(d) {
            const p = d.pond_id;
            const check = (key, actual) => {
                const pend = this.iot.pending[key];
                if (!pend) return;
                if (pend.value === actual) {
                    delete this.iot.pending[key];
                    this.showToast('Thiet bi da xac nhan thuc hien xong!', 'success');
                } else if (Date.now() - pend.at > CMD_TIMEOUT) {
                    delete this.iot.pending[key];
                    this.errorMessage = 'ESP32 khong phan hoi lenh trong ' + (CMD_TIMEOUT / 1000) + ' giay. Vui long thu lai.';
                    this.showErrorModal = true;
                }
            };
            check(p + ':pump', !!d.pump);
            check(p + ':aerator', !!d.aerator);
            check(p + ':mode', d.mode);
        },

        /* ================= TIEN ICH CHO GIAO DIEN ================= */

        /** Ao nay co gan ESP32 that khong? */
        hasIot(pond) {
            return !!(pond && this.iot.byPond[pond.id]);
        },

        /** Lenh cua ao nay dang cho ESP32 xac nhan? */
        iotPending(pondId, which) {
            return !!this.iot.pending[pondId + ':' + which];
        },

        /** "21:35:12" - thoi diem ESP32 gui du lieu lan cuoi */
        iotLastUpdate(pond) {
            const d = pond && this.iot.byPond[pond.id];
            if (!d || !d.updated_at) return '--:--:--';
            return new Date(d.updated_at).toLocaleTimeString('vi-VN');
        },

        /** "3 giay truoc" */
        iotAgoText(pond) {
            const d = pond && this.iot.byPond[pond.id];
            if (!d || !d.updated_at) return 'chua co du lieu';
            const s = Math.max(0, Math.round((Date.now() - new Date(d.updated_at).getTime()) / 1000));
            if (s < 60) return s + ' giay truoc';
            if (s < 3600) return Math.floor(s / 60) + ' phut truoc';
            return Math.floor(s / 3600) + ' gio truoc';
        },

        /** Hien thi so co don vi, tra '--' neu chua co du lieu */
        iotNum(v, digits, unit) {
            if (v === null || v === undefined) return '--';
            return Number(v).toFixed(digits === undefined ? 2 : digits) + (unit ? ' ' + unit : '');
        },

        /** Chat luong song Wi-Fi cho de doc */
        iotWifiText(pond) {
            const d = pond && this.iot.byPond[pond.id];
            if (!d || d.rssi === null || d.rssi === undefined) return '';
            const r = d.rssi;
            const q = r > -55 ? 'Manh' : r > -70 ? 'Trung binh' : 'Yeu';
            return `${q} (${r} dBm)`;
        },
    };
}
