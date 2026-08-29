# VAST — Tích hợp ESP32 thật vào website

Tài liệu hướng dẫn đầy đủ cho hệ thống quản lý ao nuôi tôm thông minh IoT + AI.

---

## 0. Kiến trúc hiện tại (kết quả kiểm tra source code)

Trước khi làm gì, đây là những gì đã đọc được từ project của bạn:

| Hạng mục | Thực tế trong project |
|---|---|
| Frontend framework | **Không có build tool.** HTML tĩnh + Tailwind CSS (CDN) + **Alpine.js** (state) + HTMX (nạp component) + Chart.js + Lucide icons |
| Backend | **Chưa có.** Toàn bộ là file tĩnh |
| Database | **Chưa có.** Dữ liệu ao nằm trong mảng `ponds[]` cứng trong `dashboard.html` |
| Authentication | `localStorage` phía trình duyệt (`login.html` chỉ lưu tên + số điện thoại, chưa có server) |
| Quản lý ao | Alpine component `farmApp()` trong `dashboard.html`, mỗi ao có `id`, `name`, `temperature`, `ph`, `do`, `fan`, `pump` |
| Dashboard | `web/components/view_overview.html` render card ao, nút bật/tắt gọi `toggleDevice()` — trước đây chỉ đổi biến local |

**Kết luận:** project chưa có backend nên phải tạo mới. Nguyên tắc đã tuân thủ: chọn công nghệ **không phá vỡ** kiến trúc hiện tại — backend Node.js thuần, phục vụ luôn file tĩnh, frontend giữ nguyên Alpine.js và chỉ được *thêm* một module IoT.

**Không có file HTML/CSS nào bị xoá. Không có chức năng cũ nào bị bỏ.** Các ao demo không gắn ESP32 vẫn chạy y như trước.

---

## A. Danh sách file đã sửa / tạo mới

### Tạo mới

| File | Vai trò |
|---|---|
| `server/index.js` | HTTP server: phục vụ website + route API |
| `server/routes/api.js` | Toàn bộ logic API IoT (telemetry, command, ack, latest, history) |
| `server/lib/db.js` | Lớp database (SQLite của Node, tự động fallback JSON) |
| `server/config.js` | Đọc cấu hình |
| `server/config.example.json` | Mẫu cấu hình |
| `server/tools/seed.js` | Đăng ký thiết bị ESP32, sinh `device_token` |
| `server/simulate_esp32.js` | Giả lập ESP32 để test web khi chưa cắm mạch |
| `server/package.json` | Metadata (không có dependency nào) |
| `server/.gitignore` | Chặn commit database và token |
| `js/vast-config.js` | Cấu hình phía web (địa chỉ backend, chu kỳ poll) |
| `web/js/iot.js` | Module Alpine kết nối ESP32 thật |
| `esp32_vast/esp32_vast.ino` | Firmware ESP32 hoàn chỉnh |
| `esp32_vast/config.h` | Toàn bộ cấu hình ESP32 (Wi-Fi, server, token, GPIO, ngưỡng) |

### Sửa (chỉ thêm, không xoá)

| File | Thay đổi |
|---|---|
| `dashboard.html` | Thêm 2 thẻ `<script>`; thêm `...iotModule()` vào `farmApp()`; gọi `this.initIot()` trong `initApp()`; `toggleDevice()`/`toggleAll()` nay gửi lệnh thật khi ao có ESP32; `initDetailChart()` vẽ lịch sử thật; `setChartTimeframe()` vẽ lại biểu đồ |
| `web/components/view_overview.html` | Badge ONLINE/OFFLINE thật; banner mất kết nối; khối điện năng INA219; nút AUTO/MANUAL; nhãn GPIO26/GPIO27; ghi chú "Chưa kết nối cảm biến" ở ô pH; khoá nút tay khi AUTO |

`sketch_aug17a/sketch_aug17a.ino` (code cũ) **được giữ nguyên** làm bản dự phòng.

---

## B. Database — không cần chạy migration thủ công

Database tự tạo lần đầu chạy server. Bạn chỉ cần chạy **một lệnh** để đăng ký thiết bị:

```
cd server
node tools/seed.js
```

Lệnh này in ra `device_token` — copy vào `esp32_vast/config.h`.

### Các bảng

**`iot_devices`** — thiết bị ESP32
`id, device_id, device_token, pond_id, name, mode, last_seen, created_at`

**`iot_latest_data`** — dữ liệu mới nhất (dashboard đọc bảng này)
`device_id, temperature, do_value, ph, voltage, current_ma, power_w, pump_status, aerator_status, mode, wifi_rssi, updated_at`

**`iot_sensor_history`** — lịch sử vẽ biểu đồ
`id, device_id, temperature, do_value, ph, voltage, current_ma, power_w, pump_status, aerator_status, created_at`

**`iot_commands`** — hàng đợi lệnh Web → ESP32
`id, device_id, command, value, status, created_at, sent_at, executed_at`

### Chống phình database

ESP32 gửi 4 giây/lần nhưng lịch sử **chỉ ghi mỗi 30 giây** (`historySampleSeconds`). Card realtime vẫn cập nhật theo từng gói. Lịch sử quá 60 ngày tự xoá mỗi giờ.

Ước tính: 1 thiết bị ≈ 2.880 bản ghi/ngày ≈ 86.400 bản ghi/tháng — SQLite xử lý thoải mái.

---

## C. API endpoint

### ESP32 gọi — bắt buộc header `X-Device-Token`

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/iot/telemetry` | Gửi dữ liệu cảm biến (3–5s/lần) |
| GET | `/api/iot/command?device_id=...` | Lấy lệnh đang chờ (1–3s/lần) |
| POST | `/api/iot/ack` | Xác nhận đã thực hiện lệnh |

### Website gọi

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/iot/latest` | Realtime tất cả thiết bị + cảnh báo |
| GET | `/api/iot/latest/:deviceId` | Realtime 1 thiết bị |
| GET | `/api/iot/history/:deviceId?range=1h\|1d\|7d\|30d` | Lịch sử vẽ biểu đồ |
| POST | `/api/iot/command` | Tạo lệnh mới |
| GET | `/api/iot/devices` | Danh sách thiết bị |
| GET | `/api/iot/commands/:deviceId` | 20 lệnh gần nhất (debug) |
| GET | `/api/health` | Kiểm tra server sống |

### Lệnh được hỗ trợ

| Command | Value | Ghi chú |
|---|---|---|
| `SET_MODE` | `"AUTO"` / `"MANUAL"` | |
| `SET_PUMP` | `true` / `false` | GPIO27, chỉ tác dụng khi MANUAL |
| `SET_AERATOR` | `true` / `false` | GPIO26, chỉ tác dụng khi MANUAL |
| `FEED_NOW`, `FEED_AMOUNT`, `FEED_SCHEDULE` | — | **Đã chừa sẵn** cho máy cho ăn, chưa implement |

### Mapping tên field

ESP32 gửi tên ngắn, server lưu tên dài — cả hai đều được chấp nhận:

| ESP32 gửi | Cột database |
|---|---|
| `do` | `do_value` |
| `pump` | `pump_status` |
| `aerator` | `aerator_status` |
| `current` (mA) | `current_ma` |
| `power` (W) | `power_w` |
| `rssi` | `wifi_rssi` |

---

## D. Code ESP32

Nằm ở `esp32_vast/`. Mở `esp32_vast.ino` bằng Arduino IDE (file `config.h` tự mở cùng tab).

**Thư viện cần cài** (Arduino IDE → Tools → Manage Libraries):

- OneWire — Paul Stoffregen
- DallasTemperature — Miles Burton
- Adafruit INA219 — Adafruit
- **ArduinoJson** — Benoit Blanchon ← *thư viện duy nhất phải cài thêm so với code cũ*

Board: **ESP32 Dev Module** · Serial Monitor: **115200**

GPIO giữ nguyên 100% so với mạch đã test: `TEMP_PIN 4`, `DO_PIN 35`, `RELAY_GUONG 26`, `RELAY_BOM 27`, `SDA 21`, `SCL 22`, relay HIGH TRIGGER.

---

## E. Chỗ nhập Wi-Fi / server / token

Toàn bộ nằm trong **`esp32_vast/config.h`**, 3 mục đầu file:

```c
#define WIFI_SSID       "TEN_WIFI_CUA_BAN"
#define WIFI_PASSWORD   "MAT_KHAU_WIFI"

#define SERVER_URL      "http://192.168.1.10:3000"   // IP máy tính, KHÔNG dùng localhost

#define DEVICE_ID       "ESP32_POND_01"
#define DEVICE_TOKEN    "dán token từ node tools/seed.js vào đây"
```

**Lấy IP máy tính (Windows):** mở Command Prompt → gõ `ipconfig` → tìm dòng `IPv4 Address` của card Wi-Fi.

ESP32 và máy tính **phải cùng một mạng Wi-Fi 2.4GHz** (ESP32 không bắt được 5GHz).

Phía web, nếu bạn mở dashboard bằng Live Server thay vì qua server Node, sửa `js/vast-config.js`:

```js
API_BASE: 'http://localhost:3000',
```

---

## F. Cách chạy backend

Cần **Node.js 18 trở lên** (khuyến nghị 22.5+ để dùng SQLite; nếu Node cũ hơn, hệ thống tự chuyển sang lưu file JSON, vẫn chạy bình thường).

```
cd "E:\Esp32 wifi\vietnamaismart-main\server"
node tools/seed.js          (chỉ chạy lần đầu — copy token in ra)
node index.js
```

Mở trình duyệt: **http://localhost:3000/dashboard.html**

Không cần `npm install`. Backend không dùng thư viện ngoài nào.

---

## G. Cách test ESP32 gửi dữ liệu

**Cách 1 — chưa cắm mạch, dùng giả lập:**

```
cd server
node tools/simulate_esp32.js
```

Phím điều khiển: `q`/`a` giảm/tăng DO · `w`/`s` giảm/tăng nhiệt độ · `Ctrl+C` thoát.

**Cách 2 — ESP32 thật:** nạp code, mở Serial Monitor 115200. Dấu hiệu thành công:

```
Wi-Fi: DA KET NOI | IP = 192.168.1.25 | RSSI = -54 dBm
SERVER        : OK  (12 thanh cong / 0 loi)
```

Trên web, card ao hiện badge **ONLINE** xanh và nhiệt độ/DO đổi theo cảm biến thật.

**Kiểm tra bằng lệnh (Command Prompt):**

```
curl http://localhost:3000/api/iot/latest
```

---

## H. Test nút Web → ESP32 → Relay thật

1. Trên card ao, bấm **MANUAL** → chờ ESP32 xác nhận (dòng "Đang chờ ESP32 xác nhận..." biến mất, nút MANUAL chuyển xanh dương).
2. Bấm nút **Máy Bơm (GPIO27)**.
3. Nút hiện `...` và dòng "Đang chờ thiết bị..." — **giao diện chưa đổi trạng thái**.
4. Serial Monitor in:
   ```
   >>> NHAN LENH #5 : SET_PUMP = true
       -> MAY BOM (GPIO27) = BAT
   ```
5. Nghe tiếng **"tách"** của relay 2, đèn relay sáng.
6. ESP32 gửi telemetry ngay lập tức → nút trên web chuyển sang **BẬT** màu xanh dương.

Đây chính là yêu cầu "không chỉ đổi nút trên giao diện mà chưa xác nhận thiết bị thật đã thực hiện" — trạng thái nút **luôn** lấy từ telemetry ESP32 gửi về, không bao giờ đoán trước.

---

## I. Cách kiểm tra AUTO

Bấm **AUTO** trên web. Nút bật/tắt tay sẽ **mờ đi và bị khoá**, kèm dòng giải thích ESP32 đang tự điều khiển.

- Vặn biến trở B10K để DO tụt xuống dưới 5.0 → relay 1 tách, guồng oxy chạy, web hiện cảnh báo đỏ *"DO thấp – Hệ thống đang bật guồng oxy"*.
- Vặn ngược lên trên 5.5 → guồng tự tắt.
- Hơ ấm đầu dò DS18B20 (hoặc nhúng nước ấm) cho vượt 32°C → relay 2 tách, máy bơm chạy.
- Để nguội xuống dưới 31.5°C → bơm tự tắt.

Vùng 5.0–5.5 mg/L và 31.5–32.0°C là vùng **hysteresis**: relay giữ nguyên trạng thái, không nhấp nháy quanh ngưỡng.

---

## J. Cách kiểm tra MANUAL

Bấm **MANUAL** → hai nút bật/tắt sáng lên. Bật/tắt tuỳ ý, quan sát relay.

Ở MANUAL, ESP32 **bỏ qua hoàn toàn** logic AUTO: dù DO tụt xuống 3.0 mg/L, guồng vẫn tắt nếu bạn đã tắt. Đây là chủ ý — MANUAL nghĩa là con người đang điều khiển. Chính vì vậy mới cần fail-safe ở mục K.

Khi vào MANUAL, ESP32 **giữ nguyên** trạng thái relay đang chạy, không đột ngột tắt hết.

---

## K. Cách kiểm tra ESP32 Offline + fail-safe

**Test mất kết nối:**

Rút nguồn ESP32 (hoặc `Ctrl+C` bộ giả lập). Sau ~20 giây:

- Badge card ao chuyển **OFFLINE** đỏ
- Hiện banner *"ESP32 MẤT KẾT NỐI"* kèm thời điểm cập nhật cuối
- Chuông thông báo hiện cảnh báo *"mất kết nối"*
- Nút bật/tắt bị khoá (không gửi lệnh vào hư không)

Ngưỡng chỉnh trong `server/config.json` → `deviceOfflineSeconds` (mặc định 20, yêu cầu 15–30).

**Test AUTO vẫn chạy khi mất Internet:**

Tắt server (`Ctrl+C` cửa sổ `node index.js`) nhưng **giữ nguyên nguồn ESP32**. Vặn B10K cho DO xuống dưới 5.0 → **relay vẫn tách, guồng oxy vẫn bật**. Serial Monitor vẫn in trạng thái bình thường, chỉ báo `SERVER: MAT KET NOI`.

Logic bảo vệ chạy hoàn toàn tại thiết bị, không phụ thuộc Internet/AI/server.

**Test fail-safe MANUAL:**

Chuyển sang MANUAL, tắt guồng, rồi tắt server. Sau 60 giây, Serial Monitor in:

```
!!! FAIL-SAFE !!!
Mat lien lac server 60s khi dang MANUAL
>>> TU DONG QUAY VE CHE DO AUTO de bao ve ao
```

**Vì sao chọn phương án này:** MANUAL nghĩa là "có người đang trực tiếp điều khiển". Khi mất mạng thì không còn ai điều khiển nữa. Nếu giữ nguyên MANUAL — ví dụ đang tắt guồng oxy để vệ sinh mà mất mạng, DO tụt xuống 3 mg/L và không ai bật lại — **tôm sẽ chết**. Quay về AUTO thì ESP32 tự bảo vệ ao theo ngưỡng, hoàn toàn không cần Internet. Đây là trạng thái an toàn nhất.

Chỉnh thời gian ở `config.h` → `MANUAL_TIMEOUT_SEC` (đặt `0` để tắt tính năng — không khuyến khích).

**Chống relay nhảy liên tục khi API lỗi:** lệnh được đánh dấu `sent` ngay khi ESP32 lấy về, nên nếu ESP32 mất điện trước khi `ack`, lệnh **không** bị gửi lại vòng lặp. Bấm nút nhiều lần thì các lệnh cũ cùng loại tự chuyển `ignored`, ESP32 chỉ nhận lệnh mới nhất.

---

## L. Phần còn lại cho pH sau này

Hiện tại ESP32 gửi `ph: null`, web hiện *"Chưa kết nối cảm biến (số demo)"*. **Không bịa số giả** hiển thị như dữ liệu cảm biến thật.

Khi có cảm biến pH, làm 3 bước:

1. Đấu chân `AO` của cảm biến vào **GPIO34**.
2. Trong `config.h`, đổi `#define ENABLE_PH_SENSOR 0` thành `1`.
3. Hiệu chỉnh: nhúng đầu dò vào dung dịch chuẩn pH 7.0, đọc điện áp trên Serial, điền vào `PH_CAL_V1`; làm tương tự với pH 4.0 cho `PH_CAL_V2`.

Code đọc pH đã viết sẵn trong `docCamBien()`, cột `ph` đã có sẵn trong database, API đã validate khoảng 0–14, frontend đã có `ph_connected`. **Không phải sửa server hay web dòng nào.**

---

## Kết quả kiểm thử đã chạy

**Logic firmware (biên dịch và chạy code thật, 19/19 PASS):**

TEST 1 DO=6.0 → guồng tắt · TEST 2 DO=4.5 → guồng tự bật · TEST 3 DO=5.6 → guồng tự tắt · TEST 4 T=29°C → bơm tắt · TEST 5 T=32.5°C → bơm tự bật · TEST 6 T=31.5°C → bơm tự tắt · TEST 7 MANUAL bật bơm GPIO27 · TEST 8 MANUAL bật guồng GPIO26 · TEST 9 fail-safe về AUTO · hysteresis giữ nguyên trạng thái trong vùng đệm · biên DO=5.00 và T=32.00 không kích hoạt · DS18B20 hỏng giữ nguyên trạng thái bơm · MANUAL bỏ qua AUTO dù DO=3.0.

**Logic frontend (chạy thật với server + ESP32 giả lập, 24/24 PASS):**

Đọc dữ liệu thật · pH đánh dấu chưa kết nối · ao demo không bị ghi đè · cảnh báo demo cũ được giữ · AUTO chặn lệnh tay · MANUAL gửi lệnh → giao diện **chưa** đổi → ESP32 xác nhận → giao diện mới đổi.

**Backend API:** telemetry, token sai bị chặn 401, hàng đợi lệnh không gửi lặp, ack, lệnh lạ bị chặn 400, DS18B20 lỗi −127 → null, offline sau 20s, lịch sử lấy mẫu 30s, chặn truy cập thư mục `server/` (403).

---

## Ghi chú bảo mật

- `device_token` nằm trong **header**, không nằm trên URL (không lọt vào log/lịch sử trình duyệt)
- So sánh token kiểu constant-time
- Token **không bao giờ** được trả về frontend
- Toàn bộ số liệu từ ESP32 được ép kiểu và kiểm tra khoảng hợp lệ
- Thư mục `server/` bị chặn truy cập qua HTTP (403)
- `.gitignore` chặn commit database và token
- Body request giới hạn 64KB

**Cảnh báo:** hệ thống hiện dùng HTTP trong mạng LAN — phù hợp cho demo và thi. Nếu sau này mở ra Internet, cần thêm HTTPS và xác thực người dùng phía server (hiện `login.html` mới chỉ lưu localStorage, chưa có phiên đăng nhập thật).
