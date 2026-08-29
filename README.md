# VAST — Vietnam AI Smart Tracking

Hệ thống quản lý ao nuôi tôm thông minh: IoT + AI.
ESP32 đo môi trường nước và tự điều khiển thiết bị, website theo dõi và điều khiển từ xa theo thời gian thực.

> **Người mới vào nhóm đọc mục [Chạy thử trong 3 phút](#chạy-thử-trong-3-phút) là chạy được ngay.**

---

## Hệ thống làm được gì

- Đo **nhiệt độ nước** (DS18B20) và **oxy hoà tan DO**, hiển thị trên web theo thời gian thực (độ trễ ~10 ms)
- Đo **điện áp, dòng điện, công suất** của guồng oxy và máy bơm (INA219)
- **Chế độ AUTO**: ESP32 tự bật guồng oxy khi DO thấp, tự bật bơm khi nước nóng — chạy ngay trên thiết bị, **không cần Internet**
- **Chế độ MANUAL**: bật/tắt từ web, có xác nhận hai chiều từ thiết bị thật
- Cảnh báo DO thấp, nhiệt độ cao, mất kết nối thiết bị
- Biểu đồ môi trường realtime, sổ sách thu chi, nhật ký bằng giọng nói

---

## Cấu trúc thư mục

```
vast/
├── web/                    GIAO DIỆN — mọi thứ trình duyệt tải về
│   ├── index.html, login.html, register.html
│   ├── dashboard.html                      Màn hình chính (Alpine.js)
│   ├── trace.html                          Trang công khai cho người quét mã QR
│   ├── components/                         Các khối giao diện nạp động (HTMX)
│   ├── js/                                 iot, market, feed, store, ai
│   └── assets/                             logo, icon
│
├── server/                 BACKEND Node.js (KHÔNG cần npm install)
│   ├── index.js                            Điểm khởi chạy: HTTP server + phục vụ web
│   ├── config.js                           Cấu hình + giá trị mặc định
│   ├── routes/api.js                       Toàn bộ endpoint HTTP
│   ├── services/                           Phần nghiệp vụ, không dính HTTP
│   │   ├── feed.js                         Công thức khẩu phần (N → B → F)
│   │   ├── harvest.js                      Cố vấn thu hoạch: bán ngay hay nuôi thêm
│   │   ├── kb.js                           Kho kiến thức nuôi tôm (3 loài)
│   │   ├── ask.js, advisor.js              Trợ lý và cố vấn dựa trên luật
│   │   ├── market.js, market_source.js     Giá tôm, giá vật tư
│   │   └── trace.js                        Hồ sơ truy xuất nguồn gốc
│   ├── lib/                                Hạ tầng dùng chung
│   │   ├── db.js                           SQLite (tự lui về JSON nếu Node cũ)
│   │   ├── auth.js                         Tài khoản, phiên đăng nhập
│   │   └── qr.js                           Tự sinh mã QR, không cần mạng
│   ├── tools/                              Chạy tay khi cần
│   │   ├── seed.js                         Đăng ký thiết bị, sinh device_token
│   │   └── simulate_esp32.js               Giả lập ESP32 khi chưa có mạch
│   └── data/                               Database (đã bị .gitignore chặn)
│
├── firmware/               MÃ NẠP VÀO ESP32
│   ├── esp32_vast/                         Firmware chính
│   └── esp32_i2c_scan/                     Công cụ chẩn đoán INA219
│
├── docs/                   Tài liệu kỹ thuật
│
├── CHAY_SERVER.bat                         Nhảy đúp để chạy (Windows)
└── CHAY_GIA_LAP_ESP32.bat                  Giả lập ESP32
```

---

## Công nghệ

**Web:** HTML tĩnh + Tailwind CSS + Alpine.js + HTMX + Chart.js. Không có build tool, sửa file là chạy.

**Backend:** Node.js thuần, **không dùng thư viện ngoài nào**. Chỉ cần cài Node.js ≥ 18 (khuyến nghị ≥ 22.5 để dùng SQLite tích hợp).

**Firmware:** Arduino cho ESP32.

---

## Chạy thử trong 3 phút

Cần cài sẵn [Node.js](https://nodejs.org) bản LTS.

**Windows:** nhảy đúp `CHAY_SERVER.bat`. Xong.

**Cách thủ công (mọi hệ điều hành):**

```bash
cd server
node tools/seed.js      # chỉ lần đầu — copy device_token in ra
node index.js
```

Mở http://localhost:3000/dashboard.html

**Chưa có mạch ESP32?** Mở thêm một cửa sổ nữa:

```bash
cd server
node tools/simulate_esp32.js
```

Phím `q`/`a` giảm/tăng DO, `w`/`s` giảm/tăng nhiệt độ. Trên web sẽ thấy số nhảy và cảnh báo hiện ra y như thiết bị thật.

---

## Nạp code cho ESP32

**Thư viện cần cài** (Arduino IDE → Tools → Manage Libraries):
OneWire · DallasTemperature · Adafruit INA219 · **ArduinoJson**

Board: **ESP32 Dev Module** · Serial Monitor: **115200**

**Bước bắt buộc trước khi nạp** — tạo file cấu hình riêng của bạn:

```bash
cd firmware/esp32_vast
copy config.example.h config.h        # Windows
cp config.example.h config.h          # macOS / Linux
```

Rồi mở `config.h` điền 4 dòng:

```c
#define WIFI_SSID       "tên wifi của bạn"
#define WIFI_PASSWORD   "mật khẩu wifi"
#define SERVER_URL      "http://192.168.1.10:3000"   // IP máy chạy server, chạy ipconfig để xem
#define DEVICE_TOKEN    "token từ lệnh node tools/seed.js"
```

> **`config.h` đã được `.gitignore` chặn lại — mật khẩu của bạn không bao giờ bị đẩy lên GitHub. Đừng bao giờ xoá dòng đó khỏi `.gitignore`.**

**Hai lỗi hay gặp nhất:**

- ESP32 **chỉ bắt được Wi-Fi 2.4GHz**, không bắt được 5GHz. Phát hotspot từ điện thoại thì nhớ vào cài đặt chọn băng tần 2.4GHz.
- `SERVER_URL` phải là **IP thật của máy tính**, không dùng `localhost` (với ESP32, `localhost` là chính nó). IP của hotspot đổi mỗi lần tắt/bật, đổi rồi phải nạp lại.

---

## Sơ đồ nối dây — KHÔNG ĐƯỢC ĐỔI

| Thiết bị | Chân ESP32 |
|---|---|
| DS18B20 DATA | GPIO4 |
| Biến trở B10K (mô phỏng DO) | GPIO35 |
| Relay 1 → **guồng oxy** | GPIO26 |
| Relay 2 → **máy bơm** | GPIO27 |
| INA219 SDA / SCL | GPIO21 / GPIO22 (địa chỉ 0x40) |
| Cảm biến pH (chưa gắn) | GPIO34 |

Relay **HIGH TRIGGER**: HIGH = bật, LOW = tắt.

Ngưỡng tự động (hysteresis, tránh relay nhấp nháy quanh ngưỡng):
DO < 5.0 mg/L bật guồng, ≥ 5.5 tắt · Nhiệt độ > 32.0°C bật bơm, ≤ 31.5 tắt.

---

## API

**ESP32 gọi** (bắt buộc header `X-Device-Token`):

| Method | Endpoint | |
|---|---|---|
| POST | `/api/iot/telemetry` | Gửi dữ liệu cảm biến |
| GET | `/api/iot/command?device_id=...` | Lấy lệnh đang chờ |
| POST | `/api/iot/ack` | Xác nhận đã thực hiện |

**Web gọi:**

| Method | Endpoint | |
|---|---|---|
| GET | `/api/iot/stream` | Luồng realtime (SSE) — server đẩy xuống tức thì |
| GET | `/api/iot/latest` | Dữ liệu mới nhất + cảnh báo |
| GET | `/api/iot/history/:id?range=1d&max=300` | Lịch sử vẽ biểu đồ |
| POST | `/api/iot/command` | Tạo lệnh điều khiển |
| GET | `/api/health` | Kiểm tra server sống |

Lệnh hỗ trợ: `SET_MODE` (AUTO/MANUAL) · `SET_PUMP` · `SET_AERATOR`.
Đã chừa sẵn `FEED_NOW` / `FEED_AMOUNT` / `FEED_SCHEDULE` cho máy cho ăn tự động.

---

## Vài nguyên tắc thiết kế (đọc trước khi sửa)

**Logic an toàn chạy trên ESP32, không phụ thuộc server.** DO thấp bật guồng, nước nóng bật bơm — đều xử lý ngay tại thiết bị. Mất Internet ao vẫn được bảo vệ. Đừng chuyển phần này lên server hay AI.

**Fail-safe:** đang MANUAL mà mất liên lạc server quá 60 giây, ESP32 **tự quay về AUTO**. Vì MANUAL nghĩa là có người đang điều khiển; mất mạng thì không còn ai, giữ nguyên MANUAL rất nguy hiểm.

**Nút bật/tắt không tự đổi trạng thái.** Web gửi lệnh → ESP32 thực hiện → gửi trạng thái thật về → lúc đó nút mới đổi. Không bao giờ đoán trước.

**Không bịa số liệu.** Cảm biến pH chưa gắn thì gửi `null` và hiển thị "Chưa kết nối cảm biến", không hiện số giả.

**Không đặt đối tượng Chart.js vào dữ liệu Alpine.** Alpine bọc Proxy làm Chart.js không vẽ lại được. Biểu đồ giữ trong `web/js/iot.js`, truy cập qua `iotGetChart()`.

**Sửa file trong `web/js/` thì phải tăng số `?v=` trong `web/dashboard.html`**, nếu không trình duyệt sẽ dùng bản cũ trong bộ nhớ đệm.

---

## Còn phải làm

- **Cảm biến pH**: đấu GPIO34, đổi `ENABLE_PH_SENSOR` thành `1`, hiệu chỉnh `PH_CAL_*` bằng dung dịch chuẩn pH 7.0 và 4.0. Code đọc, cột database, validate API đều đã sẵn.
- **Máy cho ăn tự động**: motor cấp cám, đĩa rải, load cell HX711, hẹn giờ. API và database đã chừa chỗ.
- **Chạy offline**: hiện web tải Tailwind/Alpine/Chart.js từ CDN nên cần Internet. Nên tải về thư mục `vendor/`.
- **Bảo mật**: hiện dùng HTTP trong mạng LAN, phù hợp demo. Nếu mở ra Internet cần HTTPS và xác thực người dùng thật phía server (hiện đăng nhập mới chỉ lưu localStorage).

Tài liệu kỹ thuật đầy đủ: [`docs/HUONG_DAN_TICH_HOP_ESP32.md`](docs/HUONG_DAN_TICH_HOP_ESP32.md)

---

Trường Cao đẳng Nghề An Giang · Developed by Van Dieu & Truc Hau
