# Tài khoản, lưu dữ liệu & QR truy xuất nguồn gốc

Ba việc trong lần này:

1. **Tài khoản thật** — thay cho đăng nhập giả lập
2. **Dữ liệu nằm ở server** — thay cho localStorage
3. **QR truy xuất nguồn gốc** — chuẩn xuất khẩu, thay cho số cứng in sẵn

---

## 1. Chạy thử

```bash
cd server
node index.js
```

Mở `http://localhost:3000/register.html` → tạo tài khoản → tự vào dashboard.

Dữ liệu nằm trong `server/data/vast.db`. **Sao lưu file này là sao lưu toàn bộ trại.**

---

## 2. Vì sao phải bỏ localStorage

Bản cũ đăng nhập thế này:

```js
localStorage.setItem('currentUser', JSON.stringify({ name: 'Nông dân ' + phone.slice(-4) }));
window.location.href = 'dashboard.html';
```

Không kiểm mật khẩu. Gõ số nào cũng vào được. Và vì sổ sách nằm trong localStorage của trình duyệt:

| Chuyện xảy ra | Hậu quả cũ |
|---|---|
| Đổi máy, đổi điện thoại | Mất sạch sổ sách |
| Xóa lịch sử trình duyệt | Mất sạch |
| Vợ ở nhà, chồng ngoài ao | Hai người thấy hai số khác nhau |
| Người lạ cầm điện thoại | Vào được ngay |

Giờ: mật khẩu băm **PBKDF2 120.000 vòng** + muối riêng từng người, sai 5 lần khóa 15 phút. localStorage **chỉ còn giữ mã phiên** — mất thì đăng nhập lại, dữ liệu vẫn nguyên.

---

## 3. Đã lưu những gì

| Bảng | Nội dung |
|---|---|
| `users`, `sessions` | Tài khoản, phiên đăng nhập |
| `ponds` | Ao nuôi + mã truy xuất |
| `transactions` | Sổ sách thu chi |
| `ai_logs` | Nhật ký hoạt động |
| `user_settings` | Giá điện, tên trại, GPS, mã cơ sở nuôi |
| `pond_feed`, `feed_log` | Thông số & nhật ký cho ăn |
| `trace_inputs` | Giống, cám, thuốc, chất xử lý |
| `trace_harvests` | Thu hoạch, số lô chế biến |
| `trace_lab_tests` | Kết quả kiểm nghiệm |
| `trace_shipments` | Vận chuyển, cảng xuất |

Mỗi tài khoản chỉ thấy dữ liệu của mình — đã kiểm thử bằng 4 phép thử cách ly.

---

## 4. QR truy xuất nguồn gốc

Người mua quét mã → mở `trace.html?code=VAST-XXXX`. **Không cần đăng nhập.**

### Bốn nhóm thông tin

| Nhóm | Nội dung |
|---|---|
| 1. Vùng nuôi | Mã cơ sở nuôi, mã nội bộ, hộ/HTX, GPS, diện tích |
| 2. Đầu vào | Giống (công ty + mã lô), cám, thuốc, chất xử lý |
| 3. Quá trình nuôi | Ngày thả, lịch cho ăn, chất lượng nước, **thời gian ngừng thuốc** |
| 4. Chế biến & logistics | Thu hoạch, số lô, kiểm nghiệm, cảng xuất |

### Ba điều đã sửa cho đúng sự thật

**Bỏ nhãn "Blockchain Verified".** Không có blockchain nào cả. Thay bằng **chuỗi băm chống sửa**: mỗi bản ghi mang `SHA-256(hash bản ghi trước + nội dung của nó)`. Sửa một dòng cũ → các dòng sau không khớp → phát hiện được. Đã kiểm thử bằng cách sửa thẳng vào SQLite: hệ thống chỉ đúng 2 bản ghi bị sửa. Và nó **được gọi đúng tên** trên trang QR — sổ nhật ký có dấu niêm phong, không phải blockchain.

**Tách mã chính thức khỏi mã nội bộ.** `VAST-xxxx` là mã nội bộ, **không phải** mã do cơ quan nông nghiệp cấp. Mã cơ sở nuôi chính thức khai trong cài đặt (`farm_official_code`), hiện ở ô riêng. Chưa khai thì trang QR ghi thẳng: *"Mã nội bộ VAST-… KHÔNG phải mã do cơ quan quản lý cấp."*

**Tách số máy ghi khỏi số người khai.** Trang QR có riêng một khối nói rõ:

- **Máy tự ghi** — nhiệt độ, oxy hòa tan, pH, nhật ký cho ăn. ESP32 ghi, không qua tay người.
- **Người khai báo** — giống, thuốc, kiểm nghiệm, cảng xuất. Hệ thống lưu nguyên văn, ghi lại thời điểm nhập, phát hiện nếu sau đó bị sửa — nhưng **không thể tự xác minh**. Cần đối chiếu thì dùng số phiếu tra tại đơn vị kiểm nghiệm.

### Cảnh báo ngừng thuốc

Đây là chỗ lô hàng hay bị trả về nhất.

- Ghi thuốc **bắt buộc** phải có số ngày ngừng — API từ chối nếu thiếu
- Hệ thống tự tính ngày thu hoạch an toàn sớm nhất
- Thu hoạch trước ngày đó → **cảnh báo đỏ trên đầu trang QR**, người mua thấy ngay

```
Dùng Oxytetracycline 01/08, ngừng 14 ngày  →  an toàn từ 15/08
Ghi thu hoạch 10/08                         →  ⚠ sớm hơn 5 ngày
```

### Nhịp cập nhật

Bạn hỏi 1 tiếng hay 5 tiếng. Mình không dùng đồng hồ đếm thuần, vì như vậy vừa nhập phiếu kiểm nghiệm xong mà khách quét vẫn thấy hồ sơ cũ — sai đúng lúc cần nhất.

Cách làm: kết quả giữ trong bộ nhớ đệm **60 phút** (đổi ở `config.json` → `trace.cacheMinutes`, đặt 300 nếu muốn 5 tiếng), **nhưng bộ đệm bị xóa ngay** khi ao đó có bản ghi mới. Vừa nhập là khách quét thấy ngay, máy chủ vẫn không phải tính lại phần nặng (trung bình nước 30 ngày) mỗi lần có người quét.

### Ảnh mã QR

Ảnh QR lấy từ `api.qrserver.com` nên **cần mạng**. Không tải được thì hiện mã chữ để tra thủ công. Chấp nhận được vì mã QR trỏ tới một trang web — không có mạng thì quét ra cũng không mở được.

---

## 5. API

| Endpoint | Việc |
|---|---|
| `POST /api/auth/register` \| `login` \| `logout` \| `profile` \| `password` | Tài khoản |
| `GET /api/auth/me` | Ai đang đăng nhập + cài đặt |
| `GET/POST /api/ponds`, `/api/ponds/update`, `/api/ponds/delete` | Ao nuôi |
| `GET/POST /api/transactions`, `/update`, `/delete` | Sổ sách |
| `GET/POST /api/logs` | Nhật ký |
| `GET/POST /api/settings` | Cài đặt (danh sách trắng khóa) |
| `POST /api/trace/input` \| `harvest` \| `labtest` \| `shipment` | Ghi hồ sơ truy xuất |
| `GET /api/trace/records?pond_id=` | Đọc hồ sơ (cần đăng nhập) |
| `GET /api/trace?code=` | **Công khai** — người mua quét QR |
| `GET /api/trace/verify?code=` | **Công khai** — kiểm dấu niêm phong |

Mã phiên gửi qua header `X-Session-Token`, **không** để trên URL (URL bị ghi vào log máy chủ và lịch sử trình duyệt).

---

## 6. Đã kiểm thử

29 phép thử đầu-cuối, đạt hết:

- Đăng ký / đăng nhập / chặn trùng số / chặn mật khẩu ngắn / chặn sai mật khẩu
- Ao: tạo, đọc lại, sửa
- Sổ sách: lưu, tính tổng, sửa, xóa — **đọc được số kiểu Việt Nam** `"5.000.000"`
- Cho ăn: N = 255.000 con, B = 2.550 kg, F = B × tỷ lệ, mỗi cữ = F ÷ số cữ
- Truy xuất: chặn thuốc thiếu ngày ngừng, tính ngày an toàn, cảnh báo thu sớm, niêm phong nguyên vẹn
- QR công khai: quét được khi chưa đăng nhập, **không lộ số điện thoại**, **không lộ sổ sách**, không có nhãn blockchain giả
- Cách ly: người khác không thấy / không sửa được ao, sổ sách, hồ sơ truy xuất

Hai lỗi thật bắt được trong lúc kiểm thử:

1. **Sổ sách từ chối `"5.000.000"`.** Ô nhập tiền trên giao diện tự chèn dấu chấm rồi mới gửi lên, mà server chỉ hiểu `5000000`. Mọi giao dịch nhập qua giao diện đều sẽ bị từ chối.
2. **Dấu niêm phong lúc nào cũng báo "đã bị sửa".** Hash tính trên một mốc thời gian còn database ghi mốc khác. Mọi phiếu truy xuất đều sẽ hiện cảnh báo đỏ oan.
