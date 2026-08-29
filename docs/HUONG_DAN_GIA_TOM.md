# Giá tôm thị trường — Hướng dẫn

Tab **Thông tin thị trường** giờ lấy giá tôm thật, tự cập nhật, thay cho số cứng trong HTML.

---

## 1. Chạy thế nào

Không cần cài thêm gì (`npm install` vẫn không cần).

```bash
cd server
node index.js
```

Mở `http://localhost:3000/dashboard.html` → tab **Thông tin thị trường**.

Server tự lấy giá **mỗi 30 phút**. Lần đầu chạy sau ~4 giây.

### Thử riêng phần lấy giá (không cần bật server)

```bash
cd server
node market.js --once           # lấy 1 lần, in bảng giá ra màn hình
node market.js --once --debug   # lưu trang HTML thô vào server/data/market_debug.html
```

Lệnh này là chỗ đầu tiên cần chạy khi nghi giá không cập nhật.

---

## 2. Giá lấy từ đâu

Việt Nam **chưa có API giá tôm chính thức miễn phí**. Nên hệ thống làm theo kiểu nhiều nguồn thay thế được nhau:

| Nguồn | Mô tả | Cấu hình |
|---|---|---|
| `tepbac` *(mặc định)* | Đọc bảng giá công khai trên tepbac.com — tôm thẻ, tôm sú, **tôm càng xanh**, tôm hùm theo từng size, kèm **giá tôm giống** | `provider: "tepbac"` |
| `json` | Gọi một API JSON riêng, dùng khi bạn mua được dịch vụ giá hoặc tự dựng server giá | `provider: "json"` + `jsonUrl` |
| Nhập tay | Bạn hoặc thương lái nhập giá thu mua thật — **luôn đè lên giá tự động** | `POST /api/market/manual` |

> **Lưu ý:** nguồn `tepbac` là đọc trang web, không phải API chính thức. Trước khi dùng lâu dài nên xem điều khoản sử dụng của họ hoặc xin phép. Hệ thống chỉ đọc 1 lần / 30 phút nên không gây tải.

---

## 3. Khi lấy giá thất bại thì sao

Đây là phần được thiết kế kỹ nhất, vì người nuôi bán tôm thật bằng con số này.

- Giá cũ trong database **được giữ nguyên**, không bị xoá
- Giao diện hiện băng vàng: *"Giá tự động đã cũ, máy chủ chưa lấy được bản mới"*
- Chưa từng lấy được lần nào → hiện bảng giá tham khảo, mỗi dòng gắn nhãn **"Số tham khảo"**, kèm cảnh báo **đừng dùng để chốt bán**
- Dòng nào bạn nhập tay thì gắn nhãn **"Giá nhập tay"** và không bị dán nhãn cảnh báo — vì đó là giá thật

Nói cách khác: hệ thống **không bao giờ hiện số bịa mà im lặng**.

---

## 4. Nhập giá tay

Dùng khi thương lái báo giá thật, hoặc khi nguồn tự động chết.

```bash
curl -X POST http://localhost:3000/api/market/manual \
  -H "Content-Type: application/json" \
  -d '{"items":[
        {"code":"THE30","price":152000,"region":"Cà Mau","note":"Giá thương lái Năm Căn"},
        {"code":"THE40","price":128500,"region":"Cà Mau"}
      ]}'
```

Xoá giá nhập tay để quay về giá tự động:

```json
{"items":[{"code":"THE30","clear":true}]}
```

**Quyền:** mặc định chỉ nhập được **từ chính máy chạy server**. Muốn nhập từ điện thoại trong nhà thì đặt `market.adminToken` trong `server/config.json` rồi gửi kèm header `X-Admin-Token`.

---

## 5. Cấu hình

Sửa `server/config.json` (tạo từ `config.example.json`), **không sửa** `config.js`:

```json
{
  "market": {
    "enabled": true,
    "provider": "tepbac",
    "refreshMinutes": 30,
    "staleAfterHours": 26,
    "historyDays": 400,
    "adminToken": ""
  }
}
```

| Khoá | Ý nghĩa |
|---|---|
| `refreshMinutes` | Bao lâu lấy giá 1 lần. Nguồn đổi ~1 lần/ngày, để 30 giúp bắt thay đổi sớm và tự phục hồi khi lỗi mạng |
| `staleAfterHours` | Quá bao lâu không lấy được giá mới thì coi là số cũ và cảnh báo |
| `historyDays` | Giữ lịch sử giá bao nhiêu ngày (để vẽ biểu đồ xu hướng) |
| `adminToken` | Để trống = chỉ nhập giá tay được từ máy chủ |

---

## 6. API

| Endpoint | Việc |
|---|---|
| `GET /api/market/prices?species=the\|su\|cang_xanh\|hum` | Bảng giá hiện tại, kèm `updated_at`, `stale`, `counts` |
| `GET /api/market/supplies` | Giá vật tư: con giống + cám/hoá chất (tự động) + giá bạn nhập |
| `POST /api/market/supplies` | Thêm / sửa giá vật tư bạn nhập |
| `POST /api/market/supplies/delete` | Xoá 1 mục vật tư |
| `GET /api/market/history?code=THE30&days=30` | Lịch sử giá theo ngày, để vẽ biểu đồ |
| `POST /api/market/refresh` | Lấy giá ngay (nút **Làm mới**) |
| `POST /api/market/manual` | Nhập giá tay |
| `GET /api/health` | Có thêm mục `market`: lần lấy gần nhất, lỗi gần nhất, lần lấy kế tiếp |

---

## 6b. Cột "% thay đổi" và "ngày cập nhật"

Bảng giá hiện **phần trăm** tăng/giảm (số tiền để trong ngoặc, nhỏ hơn), và mỗi
dòng có **ngày cập nhật riêng của dòng đó**.

Hai chỗ này từng sai, nên ghi rõ cách làm đúng:

**Phần trăm lấy từ chính trang nguồn, không tự tính.** Trước đây hệ thống so giá
mới với "giá lần lấy trước" của chính nó. Nếu lần lấy trước cách đây mấy ngày thì
mũi tên chỉ sai chiều — app hiện 🟢▲ trong khi trang nguồn ghi 🔴▼. Giờ lấy đúng %
mà nguồn công bố, rồi suy ngược ra số tiền:

```
giá_trước = giá_hiện_tại / (1 + %/100)
```

**Mỗi dòng có tuổi riêng.** Trang nguồn in một ngày chung ở đầu trang, nhưng từng
dòng lại ghi "hôm nay" / "4 ngày trước" / "38 ngày trước". Tôm càng xanh thường cũ
hơn tôm thẻ khá nhiều. Dòng nào quá **14 ngày** thì ngày cập nhật hiện **màu cam**
kèm chữ *"· số cũ"* — để bạn biết đừng chốt bán bằng con số đó.

Ngày này cũng là ngày ghi vào lịch sử giá. Nếu dùng ngày chung của trang thì giá
tôm càng xanh cũ 38 ngày sẽ bị vẽ lên biểu đồ như giá hôm nay.

---

## 6c. Giá vật tư đầu vào — ĐÃ BỎ

Thẻ **Giá Vật Tư Đầu Vào** đã gỡ khỏi giao diện, và việc tự động lấy giá vật tư
đã tắt (`market.suppliesEnabled = false`).

**Lý do:** Tép Bạc có trang giá vật tư thật
(`https://tepbac.com/gia-thuy-san/gia/vat-tu`) nhưng trang đó nằm ngoài menu, cấu
trúc ô khác hẳn trang giá tôm, và bộ đọc lấy sai nhiều lần liên tiếp:

- mã mặt hàng dính vào tên theo 3 kiểu khác nhau (`VOICAO Vôi nung CaO`,
  `Trứng bào xác artemia ARTE`, `Thức ăn cá tra TATRA Thức ăn cá tra`), lại còn
  có emoji đứng trước mã
- ô `%` kèm kỳ hạn `(3 tháng)` bị đọc nhầm thành tuổi dữ liệu
- giá và tuổi gộp chung một ô làm giá `380.000` bị đọc thành `38`

Số **sai** về chi phí đầu vào hại hơn là không có số nào. Giá tôm dùng bộ đọc
riêng, không liên quan, vẫn chạy bình thường.

**Cái gì còn, cái gì mất:**

| | |
|---|---|
| Bảng `market_supplies` (giá bạn tự nhập) | **còn nguyên**, không mất dữ liệu |
| API `/api/market/supplies` | còn, chỉ không có giao diện gọi tới |
| Bảng `market_supply_auto` | còn, không được cập nhật nữa |
| Giá con giống (189/150/179/120/70/125 đ/con) | vẫn có trong `/api/market/prices`, chỉ không hiện ra |

**Bật lại nếu sau này muốn:**

1. `server/config.js` → `suppliesEnabled: true`
2. Khôi phục khối HTML *"Giá Vật Tư Đầu Vào"* trong `web/components/view_market.html`,
   modal trong `dashboard.html`, và các hàm `vt*` trong `web/js/market.js` (lấy từ git)

---

## 6d. Lỗi đọc số đã sửa (quan trọng)

Bản đầu in ra giá sai trên màn hình thật. Ghi lại để sau này không lặp:

| Chỗ hiện | Số app in ra | Số thật trên trang |
|---|---|---|
| Tôm càng xanh size 15 | **38 đ** | 380.000 đ/kg |
| Tôm sú Gia hóa Post 12 | **18.949 đ/con** | 189 đ/con |
| Giống tôm thẻ Post 10 | **7.038 đ/con** | 70 đ/con |

**Nguyên nhân:** trang nguồn gộp GIÁ và TUỔI DỮ LIỆU vào chung một ô
(`"380.000 đ/KG 38 ngày"`, `"189 49 ngày"`). Bộ đọc cũ xoá hết chữ rồi ghép số
còn lại: `189` + `49` thành `18949`. Chỗ khác thì nhặt nhầm số `38` của
"38 ngày" làm giá.

**Ba lớp chặn đã thêm:**

1. **Đọc theo đúng cách trang in giá** — bắt đúng chuỗi `380.000 đ/KG`,
   `120 đ/CON`, thay vì "lấy số lớn nhất trong hàng". Hàng nào cũng đầy số dễ
   lẫn: tuổi dữ liệu, %, và cả size nằm trong tên mặt hàng.
2. **Khoảng trắng không phải dấu phân cách hàng nghìn** — một ô có 2 cụm số rời
   nhau thì trả về `null`, không ghép.
3. **Chặn số vô lý theo đơn vị** — đ/kg phải ≥ 5.000; đ/con phải trong khoảng
   5–5.000. Dòng nào vượt thì **bỏ và ghi cảnh báo ra log**, không im lặng.

Ngoài ra mã mặt hàng (`TCX10`, `SUP12`) bị dính đầu tên nay được bóc riêng — nếu
không, khoá của mục sinh ra từ cả câu tên, tên đổi một chữ là mất sạch lịch sử giá.

**Lỗi kéo theo (đợt 2):** siết `parseMoney` lại xong thì cột **%** chết theo —
ô % trên trang là `"▼  3.8%  3 tháng"`, cũng có 2 cụm số, nên bị loại luôn và mọi
dòng hiện "Không đổi". Nay % được cắt bằng regex riêng (`docPhanTram`), không đưa
cả ô vào `parseMoney` nữa.

**Dòng cũ hỏng nằm lại trong database:** sửa bộ đọc xong thì khoá của mục đổi
(`TCX10_TOM_CANG_XANH_LOAI_6_15_CON_KG` → `TCX10`), dòng cũ không ai ghi đè nên
nằm lại — giao diện hiện **cả hai**, một size có 2 giá, một đúng một sai.
Nay sau mỗi lần lấy giá thành công, hệ thống **dọn các dòng tự động không còn
trên nguồn** (`marketPurgeMissing`). Ba điều đảm bảo:

- Lấy giá **thất bại** → không xoá gì, giữ nguyên bảng cũ
- Nguồn trả về **rỗng** → không xoá gì
- Giá **nhập tay** → không bao giờ bị xoá

**Vì sao khởi động lại vẫn không sạch (lỗi đợt 3):** đoạn dọn rác nằm *bên trong*
phần lấy giá, mà `start()` lại có luật "khởi động lại trong vòng 30 phút thì
không lấy lại". Nên khởi động bao nhiêu lần cũng không dọn. Nay có **3 lớp**:

1. `donRac()` chạy **ngay lúc khởi động**, vô điều kiện — và nếu có xoá thì
   **lấy giá lại ngay**, không để bảng trống rơi về số tham khảo suốt 30 phút
2. `snapshot()` **chặn lúc đọc ra**: đ/kg dưới 5.000 và đ/con trên 5.000 bị ẩn,
   dù database còn rác thì màn hình vẫn sạch
3. Khởi động in **`Bản bộ đọc giá: 2026-08-23c`** — hết phải đoán file mới đã nạp chưa

Dọn tay khi cần: `node market.js --dondep`

**Đã đối chiếu với trang nguồn:** 14/14 dòng khớp đúng giá, đơn vị, % và tuổi dữ liệu.
Đã dựng lại đúng database hỏng của người dùng và chạy thử: xoá sạch 8/8 dòng rác,
giá nhập tay còn nguyên, nguồn chết thì không xoá oan.

---

## 7. File đã thêm / sửa

| File | |
|---|---|
| `server/services/market_source.js` | **Mới** — đọc giá tôm + **giá vật tư**, 2 chiến lược dự phòng, chặn số vô lý |
| `server/services/market.js` | **Mới** — lịch tự động, lưu database, giá nhập tay, bảng dự phòng |
| `web/js/market.js` | **Mới** — module giao diện `marketModule()` |
| `server/lib/db.js` | Thêm 4 bảng `market_*` + bảng `market_supplies` (giá vật tư bạn nhập); mở SQLite thất bại thì tự chuyển sang file JSON thay vì chết cả máy chủ |
| `server/routes/api.js` | Thêm nhóm API `/api/market/*` |
| `server/config.js` | Thêm mục `market` |
| `server/index.js` | Gọi `market.start()` sau khi web lên |
| `web/components/view_market.html` | Bảng giá + biểu đồ chạy bằng dữ liệu thật |
| `dashboard.html` | Nạp `web/js/market.js`, gộp `marketModule()`, gọi `initMarket()`, thêm modal nhập giá vật tư |

---

## 8. Ba điều cần biết trước

**Đã chạy được với trang thật.** Lần chạy gần nhất đọc về 7 mục (tôm thẻ size 20 và
60, tôm càng xanh size 15 và 20, và 3 loại giống), % tăng giảm khớp đúng chiều với
trang nguồn. Tuy nhiên máy chạy phiên làm việc này **thỉnh thoảng bị tepbac chặn
(HTTP 403)** do gọi nhiều lần liên tiếp khi test. Trên máy bạn ở Việt Nam, gọi
1 lần / 30 phút thì không gặp.

Nếu chạy `node market.js --once --debug` mà không ra giá, gửi mình file
`server/data/market_debug.html` — mình chỉnh lại bộ đọc theo đúng HTML thật.

**Lấy giá thất bại thì server vẫn chạy.** Bảng giá cũ trong database giữ nguyên,
giao diện hiện băng cảnh báo, `last_error` trong `/api/health` ghi rõ lý do. Server
không bao giờ tắt vì không lấy được giá.

**Parser có 2 lớp.** Lớp 1 đọc theo bảng `<tr>/<td>`, không bám vào class hay id
(những thứ dễ bị đổi nhất). Lớp 1 hụt thì tự chuyển sang lớp 2 đọc thẳng từ chữ
trên trang (`"Tôm thẻ (30 con/kg) … 190,000 đ/kg"`). Hai lớp đều đã test.

**Một điều về số liệu nguồn, không phải lỗi app:** có lúc bảng giá tepbac có chỗ
nghịch lý (tôm size nhỏ lại đắt hơn size lớn). Mình đã đối chiếu từng dòng với
trang thật — app đọc **đúng**, chỗ nghịch lý nằm ở dữ liệu nguồn. Vì việc này ảnh
hưởng tới giá bán thật nên hệ thống **tự dò và báo ra** (`nghi_ngo` trong
`/api/market/prices`), không im lặng.
