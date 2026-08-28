# Máy cho ăn 2 motor — DRV8833

## 1. Đấu dây (đúng mạch bạn đã nối)

```
DRV8833          ESP32 / NGUỒN
VCC   ────────   +5V adapter
GND   ────────   GND CHUNG          ← bắt buộc nối chung với GND của ESP32
IN1   ────────   GPIO25  ┐
IN2   ────────   GPIO33  ┘ MOTOR 1 — N20 cấp cám (vít tải)
IN3   ────────   GPIO18  ┐
IN4   ────────   GPIO19  ┘ MOTOR 2 — motor 130 quay đĩa
EEP   ────────   ⚠ xem mục 2
ULT   ────────   bỏ trống được (chân báo lỗi, không bắt buộc)

OUT1/OUT2  ───   2 dây motor N20
OUT3/OUT4  ───   2 dây motor 130
```

Chân 18, 19, 25, 33 đều trống trong sketch cũ và không dính vai trò khởi động — không đụng gì tới guồng oxy (26), bơm (27), DS18B20 (4), DO (35), I2C (21/22).

---

## 2. ⚠ Chân EEP — kiểm cái này trước tiên

Chữ trên mạch in bị cắt đôi: **`SL|EEP`** và **`FA|ULT`**. Nên:

- **EEP = nSLEEP** (chân ngủ)
- **ULT = nFAULT** (chân báo lỗi)

**nSLEEP phải ở mức CAO thì DRV8833 mới làm việc.** Để trống thì:

- Mạch nào có điện trở kéo lên sẵn → chạy bình thường
- Mạch nào không có → **chip ngủ, cả hai motor đứng im**

> **Nạp code xong mà không motor nào quay → gần như chắc chắn là chân này.** Nối `EEP` vào **3V3** của ESP32 (không phải 5V — chân logic 3,3V).

**Tốt hơn nữa:** nối EEP vào một GPIO (ví dụ 32) rồi đặt trong `feeder.h`:

```c
#define FEED_PIN_SLEEP    32
```

Khi đó ESP32 chủ động bật/tắt chip. Lợi ích thật sự: ESP32 treo giữa cữ ăn thì chân GPIO thả nổi → chip tự ngủ → **motor tự tắt**. Không làm vậy thì ESP32 treo = vít tải quay mãi, đổ sạch thùng cám xuống ao.

---

## 3. Trình tự một cữ ăn

```
1. Bật ĐĨA VĂNG          → chờ 1,5 giây cho đĩa đạt tốc độ
2. Bật N20 T giây        → T = số gam ÷ FEED_GRAMS_PER_SEC
3. PHANH N20             → giữ phanh, không thả trôi
4. ĐĨA chạy thêm 3 giây  ← đúng yêu cầu của bạn
5. Phanh đĩa 0,25 giây rồi thả trôi cả hai
```

**Vì sao phanh N20 chứ không thả trôi:** thả trôi thì trục vít còn quay theo quán tính thêm gần nửa vòng — ra thêm cám ngoài lượng đã tính. Phanh làm nó dừng ngay, liều lượng chính xác hơn. Đây chính là lợi thế của DRV8833 so với relay, relay không làm được.

**Đĩa chạy thêm 3 giây** đúng như bạn yêu cầu — hất hết cám còn dính trên đĩa và nằm ở miệng ra, không để đóng lại gây kẹt cho cữ sau.

---

## 4. Cầu H hoạt động thế nào

| IN1 | IN2 | Kết quả |
|---|---|---|
| L | L | Thả trôi |
| H | L | Quay thuận |
| L | H | Quay nghịch |
| H | H | **Phanh** — dừng ngay |

Vì có cầu H nên bạn được thêm hai thứ relay không có:

**Đổi chiều bằng phần mềm.** Motor quay ngược chiều mong muốn thì **không cần tháo dây**, chỉ đổi:

```c
#define FEED_VIT_REVERSE  1     // hoặc FEED_DIA_REVERSE
```

**Chống kẹt cám.** Bật `FEED_ANTIJAM 1` thì trước mỗi cữ, vít tải quay ngược một nhịp ngắn làm tơi cám rồi mới quay thuận. Mặc định tắt — bật khi thấy hay bị kẹt.

---

## 5. Hiệu chuẩn — việc quan trọng nhất

```c
#define FEED_GRAMS_PER_SEC   25.0
```

Server tính khẩu phần chính xác đến đâu cũng vô nghĩa nếu con số này sai, vì máy vẫn xả sai lượng.

**Cách đo:**

1. Đổ cám đầy thùng
2. Hứng một cái xô dưới miệng ra cám
3. Serial Monitor gõ: `CALIB 10` → N20 quay đúng 10 giây (đĩa **không** chạy, để cám rơi thẳng xuống xô)
4. Cân chỗ cám trong xô
5. `FEED_GRAMS_PER_SEC = số gam ÷ 10`

Ví dụ: quay 10 giây ra 210 g → đặt `21.0`

`25.0` chỉ là số mình đặt tạm. **Motor N20 nhỏ, lượng ra thường chỉ vài chục gam mỗi giây** — khác hẳn máy công nghiệp. Cứ đo thật rồi điền, đừng đoán.

Đo lại khi đổi số cám — cám số 2 và số 4 hạt to nhỏ khác nhau nên chảy ra không bằng nhau.

---

## 6. Lệnh gõ tay qua Serial Monitor

| Lệnh | Việc |
|---|---|
| `TEST1` | Chạy riêng N20 ba giây — kiểm dây và chiều quay |
| `TEST2` | Chạy riêng motor 130 ba giây |
| `CALIB 10` | Quay N20 mười giây để hiệu chuẩn |
| `FEED 500` | Xả 500 gam (chạy đủ trình tự) |
| `STOP` | Dừng ngay |

**Thứ tự nạp lần đầu:**

1. **Tháo cám ra khỏi thùng**
2. `TEST1` → nghe N20 quay, xem đúng chiều đẩy cám ra chưa
3. `TEST2` → xem đĩa quay đúng chiều hất ra ngoài chưa
4. Sai chiều → đổi `FEED_VIT_REVERSE` / `FEED_DIA_REVERSE`
5. `FEED 500` → nghe đủ trình tự: đĩa chạy trước → N20 chạy → N20 dừng → **đĩa chạy thêm 3 giây**
6. Đổ cám vào, `CALIB 10`, cân, điền `FEED_GRAMS_PER_SEC`

---

## 7. Nguồn điện — chỗ hay hỏng nhất

**Motor phải có nguồn riêng, đừng lấy từ chân 5V của ESP32.** Motor 130 lúc khởi động có thể kéo cả ampe, sụt áp là ESP32 reset giữa cữ. Adapter 5V riêng cho DRV8833, **nối chung GND** với ESP32 — bạn đã làm đúng chỗ này.

DRV8833 chịu 1,5A liên tục mỗi kênh, đỉnh 2A. Motor 130 lúc kẹt có thể vượt ngưỡng đó và chip tự ngắt bảo vệ. Nếu thấy đĩa hay dừng đột ngột khi gặp cám ướt, đó là lý do — cần motor khoẻ hơn hoặc driver lớn hơn.

Nên gắn thêm **tụ 100–470 µF** ngang VCC–GND sát DRV8833 để đỡ sụt áp lúc motor khởi động.

---

## 8. Các chốt an toàn

| Chốt | Giá trị | Chặn chuyện gì |
|---|---|---|
| `FEED_MAX_RUN_SEC` | 180 giây | Vít tải quay mãi, đổ sạch thùng xuống ao |
| `FEED_MAX_GRAMS` | 15 kg/cữ | Server gửi nhầm số quá lớn |
| `FEED_MIN_GAP_MS` | 30 giây | Bấm liên tục, hoặc lệnh cũ bị gửi lặp khi mạng chập chờn |
| Thả trôi trong `setup()` | | ESP32 vừa cấp điện, GPIO bất định → máy tự xả cám lúc khởi động |
| `FEED_NOW` thiếu `FEED_AMOUNT` | | Từ chối, **không đoán bừa** — đoán bừa ở đây là đổ sai lượng cám xuống ao thật |
| Server chặn DO < 3,0 | | Không cho ăn khi tôm đang thiếu oxy |
| Server chặn thiếu cám | | Không xả hụt khi thùng không đủ |

**Không dùng `delay()` ở bất kỳ chỗ nào.** Vòng `loop()` chạy logic an toàn ao mỗi 250ms — đọc DO, bật guồng oxy khi thiếu oxy. Dùng `delay(10000)` để đợi vít tải quay thì suốt 10 giây đó ESP32 đứng im, không đọc DO, không bật guồng được. Tôm có thể chết trong 10 giây thiếu oxy. Vì vậy `feederLoop()` chỉ xem đồng hồ rồi thoát ngay.

---

## 9. Đã kiểm thử

Biên dịch bằng g++ với bộ giả lập Arduino, theo dõi mức điện áp ra **cả 4 chân** DRV8833, tua đồng hồ để chạy hết máy trạng thái. **31/31 đạt:**

```
Trình tự một cữ (250 g, 25 g/giây → 10 giây)
  lúc nghỉ           ca 2 tha troi                    ✓
  bắt đầu            dia QUAY, N20 chua chay          ✓
  sau 1,5s           ca 2 cung quay                   ✓
  N20 hết giờ        N20 PHANH (khong tha troi)       ✓
  1s sau             N20 van phanh, dia van quay      ✓
  2,9s sau           dia VAN quay (chua du 3s)        ✓
  3,1s sau           dia chuyen sang phanh            ✓
  phanh xong         ca 2 tha troi, ve trang thai nghi ✓
  N20 giữ phanh 3200 ms — đúng suốt lúc đĩa hất nốt   ✓

Hiệu chuẩn: N20 quay, đĩa đứng im                     ✓
TEST1/TEST2: chạy đúng riêng từng motor               ✓
Chặn: xả liên tiếp / 99 kg / 0 g / số âm              ✓
FEED_NOW thiếu FEED_AMOUNT → từ chối                  ✓
FEED_NOW lần 2 không có AMOUNT mới → từ chối          ✓
Dừng khẩn: phanh ngay rồi mới thả, tính đúng 100 g    ✓
```

**Một lỗi thật bắt được trong lúc viết:** bản đầu gọi `feedVit(MT_BRAKE)` rồi `feedVit(MT_COAST)` ngay dòng sau. Hai lệnh cách nhau vài micro giây nên **phanh chưa kịp ăn** — motor vẫn quay theo quán tính, đúng cái mình định tránh. Đã sửa: thêm trạng thái `FEED_STOPPING` giữ phanh 250 ms, và N20 giữ phanh suốt 3 giây đĩa hất nốt.

**Chưa nạp lên ESP32 thật** — máy chạy phiên này không có phần cứng. Logic thời gian, mức logic 4 chân và các chốt an toàn đã kiểm bằng mô phỏng; phần đấu dây, chiều quay và hiệu chuẩn phải làm trên máy thật.
