/* ================================================================
   config.h - CAU HINH ESP32 cho he thong VAST
   ----------------------------------------------------------------
   CHI CAN SUA FILE NAY. File esp32_vast.ino khong can dong toi.

   SAU KHI SUA XONG:  Ctrl+U de nap lai ESP32.
   ================================================================ */

#ifndef VAST_CONFIG_H
#define VAST_CONFIG_H

/* ================================================================
   DAY LA FILE MAU - KHONG PHAI FILE CHAY THAT

   CACH DUNG (moi nguoi trong nhom lam 1 lan):
     1. Chep file nay ra thanh  config.h  (cung thu muc)
     2. Dien Wi-Fi, IP may chu va token cua RIENG MINH vao
     3. File config.h da duoc .gitignore chan lai, khong bao gio
        bi day len GitHub -> mat khau cua ban an toan

   Tren Windows, mo Command Prompt tai thu muc nay va go:
        copy config.example.h config.h
   ================================================================ */

/* ================================================================
   1) WI-FI  <<<<<<<<<<<<<<<< SUA O DAY
   ================================================================ */
/* LUU Y: ESP32 chi bat duoc Wi-Fi 2.4GHz, KHONG bat duoc 5GHz.
   Neu phat hotspot tu dien thoai, nho vao cai dat chon bang tan 2.4GHz. */
#define WIFI_SSID       "TEN_WIFI_CUA_BAN"
#define WIFI_PASSWORD   "MAT_KHAU_WIFI"

/* LUU Y QUAN TRONG:
   ESP32 CHI bat duoc Wi-Fi 2.4GHz, KHONG bat duoc 5GHz.
   Neu router phat chung ten cho ca 2 bang tan, hay tach ten mang 2.4G ra.
   Neu phat Wi-Fi tu dien thoai: nho bat "Bang tan 2.4GHz" trong cai dat diem truy cap. */


/* ================================================================
   2) SERVER  <<<<<<<<<<<<<<<< SUA O DAY
   ================================================================ */
/* Dia chi may tinh dang chay backend (node server.js).
   KHONG dung "localhost" hay "127.0.0.1" - do la chinh con ESP32!
   Phai dung IP LAN cua may tinh, vi du: http://192.168.1.10:3000

   CACH XEM IP MAY TINH (Windows):
       Mo Command Prompt  ->  go:  ipconfig
       Tim dong "IPv4 Address" cua card Wi-Fi, vi du 192.168.1.10

   ESP32 va may tinh PHAI CUNG MOT MANG WI-FI. */

/* Lay bang lenh  ipconfig  -> muc "Wireless LAN adapter Wi-Fi" -> dong IPv4.

   CANH BAO: IP cua hotspot dien thoai THAY DOI moi lan tat/bat lai hotspot
   hoac doi sang mang Wi-Fi khac. Neu ESP32 bao loi "ma = -1", hay chay lai
   ipconfig, lay so IPv4 moi cua muc "Wireless LAN adapter Wi-Fi",
   sua dong duoi day roi nap lai ESP32. */
#define SERVER_URL      "http://192.168.1.10:3000"


/* ================================================================
   3) DINH DANH THIET BI  <<<<<<<<<<<<<<<< SUA TOKEN O DAY
   ================================================================ */
/* device_id phai TRUNG voi device_id trong server/seed.js */
#define DEVICE_ID       "ESP32_POND_01"

/* pond_id chi de tham khao/gui kem - server lay pond_id tu database */
#define POND_ID         "pond_01"

/* DEVICE_TOKEN: chay  node seed.js  trong thu muc server, copy chuoi in ra dan vao day. */
#define DEVICE_TOKEN    "DAN_TOKEN_TU_LENH_node_seed.js_VAO_DAY"


/* ================================================================
   4) CHAN GPIO - DA TEST THUC TE, KHONG DUOC DOI
   ================================================================ */
#define TEMP_PIN        4     // DS18B20 DATA
#define DO_PIN          35    // B10K mo phong cam bien DO (ADC1)
#define RELAY_GUONG     26    // Relay 1 -> MOTOR GUONG OXY
#define RELAY_BOM       27    // Relay 2 -> MAY BOM
#define SDA_PIN         21    // INA219 SDA
#define SCL_PIN         22    // INA219 SCL

/* Cam bien pH - CHUA SU DUNG trong giai doan nay.
   Sau nay chi can:
     1) Doi ENABLE_PH_SENSOR thanh 1
     2) Hieu chinh PH_CAL_* theo dung dich chuan pH 4.0 / 7.0
   Code doc pH da viet san trong .ino. */
#define PH_PIN          34    // Chan du kien cho cam biến pH (ADC1)
#define ENABLE_PH_SENSOR 0    // 0 = tat (gui ph = null), 1 = bat


/* ================================================================
   5) RELAY HIGH TRIGGER - DA TEST, KHONG DOI
   ================================================================ */
#define RELAY_ON        HIGH
#define RELAY_OFF       LOW


/* ================================================================
   6) NGUONG DIEU KHIEN TU DONG (hysteresis)
   ================================================================ */
#define DO_ON           5.0   // DO < 5.0 mg/L  -> BAT guong oxy
#define DO_OFF          5.5   // DO >= 5.5 mg/L -> TAT guong oxy

#define TEMP_PUMP_ON    32.0  // Nhiet do > 32.0 C  -> BAT may bom
#define TEMP_PUMP_OFF   31.5  // Nhiet do <= 31.5 C -> TAT may bom


/* ================================================================
   7) CHU KY THOI GIAN (mili giay)
   ================================================================ */
#define SENSOR_INTERVAL_MS    250    // doc DO (bien tro) + INA219 + chay logic AUTO
#define TEMP_INTERVAL_MS      1000   // doc DS18B20 (chip nay can ~750ms de do xong)
#define TELEMETRY_INTERVAL_MS 2000   // nhip gui dinh ky len server
#define COMMAND_INTERVAL_MS   1000   // hoi server co lenh moi khong
#define PRINT_INTERVAL_MS     3000   // in bang trang thai ra Serial Monitor
#define WIFI_RETRY_MS         10000  // thu ket noi lai Wi-Fi
#define HTTP_TIMEOUT_MS       3000   // timeout moi request HTTP


/* ================================================================
   7b) GUI NGAY KHI CO THAY DOI  (de web cap nhat gan nhu tuc thi)
   ================================================================
   Ngoai nhip dinh ky o tren, ESP32 con GUI NGAY LAP TUC khi phat hien
   so lieu thay doi dang ke - vi du ban dang van bien tro DO.
   Nho vay web doi so gan nhu ngay lap tuc thay vi doi het chu ky.

   TELEMETRY_MIN_GAP_MS chan khong cho gui qua day, tranh lam
   nghen Wi-Fi va tranh relay/server bi doi bom. */
#define TELEMETRY_MIN_GAP_MS  400    // 2 lan gui cach nhau it nhat 0.4 giay
#define DO_CHANGE_TRIGGER     0.08   // DO doi >= 0.08 mg/L  -> gui ngay
#define TEMP_CHANGE_TRIGGER   0.10   // Nhiet do doi >= 0.10 C -> gui ngay


/* ================================================================
   8) FAIL-SAFE (RAT QUAN TRONG - yeu cau muc 3)
   ================================================================
   Khi dang o MANUAL ma MAT LIEN LAC voi server qua lau, ESP32 se
   TU DONG QUAY VE AUTO.

   TAI SAO CHON PHUONG AN NAY (thay vi giu nguyen trang thai MANUAL)?
     - MANUAL nghia la "con nguoi dang truc tiep dieu khien".
       Neu mat mang, khong con ai dieu khien nua -> giu nguyen MANUAL
       la NGUY HIEM: vi du dang tat guong oxy de ve sinh, mat mang,
       DO tut xuong 3 mg/L ma khong ai bat lai -> TOM CHET.
     - Quay ve AUTO thi ESP32 tu bao ve ao theo nguong DO/nhiet do,
       hoan toan khong can Internet. Day la trang thai AN TOAN NHAT.

   Dat 0 de TAT tinh nang nay (khong khuyen khich). */
#define MANUAL_TIMEOUT_SEC    60


/* ================================================================
   9) HIEU CHINH CAM BIEN
   ================================================================ */
/* B10K mo phong DO: ADC 0-4095  ->  0-12 mg/L
   Sau nay thay bang cam bien DO that thi chi sua 2 dong nay. */
#define DO_ADC_MAX      4095.0
#define DO_VALUE_MAX    12.0

/* Bat mat cam bien DO (day tuot -> ADC nam yen o 0).
   Khi bat: gui null len server thay vi so doan, va BAT guong oxy cho an toan.

   MAC DINH TAT (0), va nen de nguyen chung nao GPIO35 con noi bien tro B10K.
   Ly do: cach demo binh thuong la van het co xuong day roi giu do cho moi
   nguoi xem guong tu bat. Voi phan mem, "ADC nam yen o 0 rat lau" khong khac
   gi "day tuot" - nen bat len thi thu de xay ra nhat lai la bao nham giua
   buoi demo, trong khi rui ro that bang khong vi khong co con tom nao.

   BAT LEN (1) khi gan cam bien DO THAT. Nho gan kem dien tro 100k tu GPIO35
   xuong GND: GPIO34-39 khong co dien tro keo noi bo, thieu no thi day tuot
   co the tha noi len MUC CAO -> DO doc ra cao -> AUTO tat guong, dung kieu
   hong nguy hiem nhat va phan mem khong the phan biet duoc. */
#define DO_BAT_MAT_DAY  0

/* Chi co tac dung khi DO_BAT_MAT_DAY = 1 */
#define DO_ADC_MAT_DAY     2     /* ADC <= muc nay la kha nghi           */
#define DO_SO_LAN_XAC_NHAN 240   /* kha nghi lien tuc 240 lan x 250ms = 60 giay */

/* Hieu chinh pH (chi dung khi ENABLE_PH_SENSOR = 1).
   Cach do: nhung dau do vao dung dich chuan, xem dien ap in tren Serial,
   roi dien vao 2 cap gia tri duoi day. */
#define PH_CAL_V1       2.50   // Dien ap (V) do duoc o dung dich pH 7.0
#define PH_CAL_PH1      7.00
#define PH_CAL_V2       3.05   // Dien ap (V) do duoc o dung dich pH 4.0
#define PH_CAL_PH2      4.00

#endif  // VAST_CONFIG_H
