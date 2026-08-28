# Trợ lý ao nuôi — giọng nói, cố vấn, hỏi đáp

## 1. Trước tiên: hai thứ trong bản cũ không thật

**Nút micro không dùng micro.** Code cũ:

```js
toggleRecording() {
    if (this.isRecording) {
        this.isRecording = false;
        this.voiceResult = "Cho ao số 1 ăn 5 ký thức ăn.";   // câu cứng
    } else {
        this.isRecording = true;
        setTimeout(() => this.toggleRecording(), 3000);       // chỉ đợi 3 giây
    }
}
```

Nói gì cũng ra đúng một câu đó. Đã thay bằng **Web Speech API** nhận tiếng Việt thật (`vi-VN`).

**Phân loại nhật ký chỉ biết 2 câu.** Code cũ:

```js
if (text.includes("ao 1")) detectedPondName = "Ao số 1";
else if (text.includes("ao 2")) detectedPondName = "Ao số 2";
```

Ao tên "Ao bờ đông" hay "Ao Năm Căn" đều rơi vào "Hệ thống chung". Giờ đối chiếu với **tên ao thật trong database**.

---

## 2. "AI" này thực chất là gì

**Không phải mô hình ngôn ngữ.** Dự án chưa có khóa API nào. Đây là **bộ luật chạy trên số liệu thật của ao**: DO, nhiệt độ từ ESP32, ngày tuổi tôm, giá thị trường, mùa vụ.

Điểm mạnh không phải "thông minh", mà là **nói bằng số của chính ao bạn**:

> "DO 3.4 mg/L, ngưỡng an toàn là trên 5 mg/L"

thay vì câu chung chung ai cũng nói được:

> "Nên duy trì oxy hòa tan trên 5 mg/L"

Mỗi lời khuyên đều kèm trường **`can_cu`** ghi rõ con số nào dẫn tới kết luận đó — bạn kiểm được, không phải tin suông. Giao diện gọi đúng tên nó là *"Cố vấn dựa trên số liệu thật của ao"*, không dán nhãn "AI thông minh".

Sau này bạn có khóa API thì chỗ cắm đã chừa sẵn trong `server/ask.js`.

---

## 3. Ba giới hạn tự đặt ra

**Không chẩn đoán bệnh.** Chỉ nói *"điều kiện đang thuận lợi cho bệnh X"* dựa trên nhiệt độ, DO, ngày tuổi và mùa. Muốn biết ao có bệnh thật không **phải xét nghiệm mẫu**.

**Không kê thuốc, không cho liều lượng.** Kháng sinh sai liều → tồn dư → lô hàng bị trả về, mất mã số cơ sở nuôi. Việc này phải do cán bộ thú y thủy sản quyết định.

**Không hiểu thì nói không hiểu.** Hỏi "giá vàng hôm nay bao nhiêu" thì trả lời *"Câu này mình chưa hiểu"* kèm các câu gợi ý — không bịa.

---

## 4. Ghi nhật ký bằng giọng nói

Vào **Trợ lý** → tab **Ghi nhật ký** → bấm micro → nói.

Chữ hiện dần ngay trong lúc bạn nói (cho thấy micro đang chạy thật). Nói xong, hệ thống hiện bảng xác nhận:

```
Sẽ ghi vào nhật ký
"cho ao 1 ăn 5 ký cám lúc 8 giờ"

[🍴 Cho ăn]  [5 kg]  [8 giờ]

Ao:  Ao số 1  ▾
Tự chọn theo: nhắc "ao 1"

        [ Ghi vào nhật ký ]
```

**Sửa được ao trước khi lưu** — không bao giờ ghi nhầm.

### Nhận ra 9 loại việc

| Loại | Ví dụ câu nói |
|---|---|
| Dùng thuốc | "trộn kháng sinh cho ao 1 ăn" |
| Dấu hiệu bệnh | "tôm nổi đầu tấp mé sáng nay" |
| Thu hoạch | "thu hoạch ao 1 được 4 tấn" |
| Thả giống | "thả 300000 con giống" |
| Chài mẫu | "chài mẫu ao 1 được 13 g/con" |
| Xử lý môi trường | "đánh vôi quanh bờ sau mưa" |
| Thay nước | "thay 30% nước ao 2" |
| Thiết bị | "bật quạt ao 1" |
| Cho ăn | "cho ao 1 ăn 5 ký cám lúc 8 giờ" |

**Thuốc và bệnh được ưu tiên cao nhất.** Câu *"trộn kháng sinh cho ăn"* xếp vào **Dùng thuốc**, không phải **Cho ăn** — vì thuốc còn phải ghi thời gian ngừng trước thu hoạch. Xếp nhầm là mất dấu vết cả lô hàng.

Ghi việc dùng thuốc xong, hệ thống nhắc luôn: *"nhớ ghi vào hồ sơ truy xuất kèm số ngày ngừng trước thu hoạch"*.

### Không đoán bừa

| Câu nói | Xử lý |
|---|---|
| "cho **ao 1** ăn 5 ký" | Ghi vào Ao số 1 |
| "**ao bờ đông** tôm nổi đầu" | Ghi vào Ao bờ đông (khớp tên thật) |
| "đánh vôi quanh bờ" | ❓ *"Câu này không nhắc ao nào. Ghi vào ao nào?"* |
| "cho **ao 5** ăn 3 ký" | ❓ *"Nhắc 'ao 5' nhưng không có ao nào tên như vậy"* |

Cũng đọc được số viết bằng chữ: *"cho ao 1 ăn **năm ký** cám"* → 5 kg.

---

## 5. Cố vấn tự động

Màn hình Trợ lý hiện **Việc cần làm ngay**, gom từ tất cả các ao, việc gấp lên trước.

Ví dụ thật khi DO 3.4 mg/L, nhiệt độ 33.2°C, tôm 65 ngày:

```
🟠 [oxy] Oxy thấp
   DO 3.4 mg/L. Tôm còn sống được nhưng ăn kém và chậm lớn.
   Căn cứ: DO 3.4 mg/L, ngưỡng an toàn là trên 5 mg/L
     • Bật thêm quạt
     • Giảm nửa khẩu phần cữ tới

🟠 [bệnh] Điều kiện thuận lợi cho Hoại tử gan tụy cấp (EMS/AHPND)
   Tôm 65 ngày tuổi — đã qua giai đoạn dễ mắc nhất (20–45 ngày),
   nhưng nhiệt độ cao vẫn là điều kiện thuận lợi cho vi khuẩn
   Căn cứ: Nhiệt độ 33.2°C (trên 32°C)

🔵 [thị trường] Chênh lệch giá giữa hai cỡ tôm
   Tôm đang khoảng 50 con/kg, giá 105.000 đ/kg. Nuôi lên 40 con/kg
   được 125.000 đ/kg — chênh 20.000 đ mỗi ký. Với khoảng 5.100 kg
   tôm dưới ao, phần chênh này là 102.000.000 đ.
```

### 6 nhóm luật

| Nhóm | Xét gì |
|---|---|
| **Oxy** | DO < 3 nguy hiểm / < 4 thấp / < 5 hơi thấp. Ban đêm cảnh báo riêng giờ 3–6 sáng |
| **Nhiệt độ** | > 33 quá nóng, > 32 nóng, < 25 lạnh |
| **Bệnh** | Đối chiếu nhiệt độ + DO + ngày tuổi + mùa với 4 bệnh thường gặp |
| **Cho ăn** | Chưa chài mẫu, số chài đã cũ > 10 ngày, sắp hết cám |
| **Thị trường** | So giá cỡ hiện tại với cỡ lớn hơn, nhân với sinh khối thật |
| **Mùa vụ** | Mùa khô / mùa mưa ĐBSCL, cảnh báo riêng lúc giao mùa |

**Thiết bị mất kết nối thì không dùng số cũ để khuyên** — nó nói thẳng *"Thiết bị đang mất kết nối nên không biết oxy hiện bao nhiêu. Số cũ trên màn hình không dùng để quyết định được."*

---

## 6. Hỏi đáp

Tab **Hỏi** — gõ hoặc bấm micro. Có sẵn các câu gợi ý:

- Tôm nào cho năng suất cao?
- Mùa nào tôm dễ bệnh?
- Khi nào nên bán tôm?
- Oxy trong ao đang thế nào?
- Hôm nay cho ăn bao nhiêu?

Câu trả lời **luôn kéo số liệu thật của ao vào**:

> **Hôm nay cho ăn bao nhiêu?**
> → 163,2 kg mỗi ngày, chia 4 cữ — mỗi cữ 40,8 kg.
> **Cách tính:** 255.000 con × 20 g = 5.100 kg sinh khối × 3,2% trọng lượng thân

> **Tôm nào cho năng suất cao?**
> → Không có loại nào "tốt hơn" chung chung — tùy vốn, tùy ao và tùy thị trường bạn bán.
> 📊 Giá hiện tại: tôm thẻ size 30 khoảng 145.000 đ/kg, tôm sú size 20 khoảng 220.000 đ/kg.
> ⚠ Năng suất cao nhất không đồng nghĩa lời nhiều nhất.

---

## 7. Micro cần gì

| | |
|---|---|
| Trình duyệt | **Chrome hoặc Edge**. Firefox không hỗ trợ — hệ thống báo rõ, không im lặng giả vờ chạy |
| Địa chỉ | `localhost` hoặc HTTPS. Bạn đang dùng `localhost:3000` nên chạy được |
| Quyền | Lần đầu trình duyệt hỏi cho phép Micro — bấm **Cho phép** |
| Mạng | Nhận dạng giọng nói cần Internet |

Từng loại lỗi được báo riêng, không gộp thành một câu chung: chưa cấp quyền, không nghe thấy gì, không tìm thấy micro, mất mạng.

---

## 8. File

| File | |
|---|---|
| `server/advisor.js` | **Mới** — 6 nhóm luật cố vấn, mùa vụ ĐBSCL, điều kiện 4 bệnh |
| `server/ask.js` | **Mới** — hiểu câu tiếng Việt, phân loại nhật ký, trả lời câu hỏi |
| `js/ai.js` | **Mới** — micro thật, xác nhận trước khi ghi, hiển thị cố vấn |
| `components/view_ai.html` | Viết lại: việc cần làm ngay, ghi nhật ký, hỏi đáp, nhật ký từng ao |
| `server/api.js` | Thêm `/api/advisor`, `/api/ask`, `/api/logs/classify` |
| `dashboard.html` | Nạp `js/ai.js`, bỏ micro giả, sửa `getPondLogs` lọc theo `pond_id` |

Còn một lỗi nhỏ đã sửa luôn: `getPondLogs()` cũ lọc nhật ký theo **tên ao** — đổi tên ao là mất hết nhật ký cũ. Giờ lọc theo `pond_id`.

---

## 9. Đã kiểm thử

**Phân loại 12 câu nói** — đúng cả 12, gồm cả `"trộn kháng sinh cho ăn"` phải vào **Dùng thuốc** chứ không phải **Cho ăn**.

**Cố vấn** — sinh đúng lời khuyên cho DO 3.4 / nhiệt 33.2 / tôm 65 ngày, mỗi lời khuyên đều có căn cứ số.

**Hỏi đáp** — 5 câu gợi ý trả lời bằng số thật; câu ngoài phạm vi ("giá vàng hôm nay") được từ chối thành thật.

**Bảo mật** — tài khoản khác không ghi được nhật ký vào ao của bạn, không hỏi được về ao của bạn.

**Một lỗi thật bắt được:** bệnh gan tụy in ra *"thường gặp ở 20–45 ngày tuổi"* trong khi tôm đã 65 ngày — câu cố định nên hiện sai ngữ cảnh, làm người đọc tưởng hệ thống không biết tôm mình mấy tuổi. Đã sửa để câu về giai đoạn chỉ hiện khi đúng với tuổi tôm thật.
