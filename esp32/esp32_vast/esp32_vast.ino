/* ================================================================================
   VAST - HE THONG QUAN LY AO NUOI TOM THONG MINH IoT + AI
   Firmware ESP32 (DevKit / ESP32-D0WD-V3)
   --------------------------------------------------------------------------------
   PHAT TRIEN TU code phan cung da TEST THANH CONG (sketch_aug17a.ino):
   giu nguyen 100% so chan GPIO, kieu relay HIGH TRIGGER va logic hysteresis.

   THEM MOI:
     - Ket noi Wi-Fi + tu dong reconnect (khong block chuong trinh)
     - Gui telemetry len server moi 4 giay
     - Lay lenh dieu khien tu website moi 2 giay
     - 2 che do: AUTO (tu chay tai thiet bi) / MANUAL (nguoi dung dieu khien)
     - Fail-safe: mat server qua lau khi dang MANUAL -> tu ve AUTO
     - Xu ly loi DS18B20 / INA219 / mat server
     - Toan bo dung millis(), KHONG dung delay() dai

   --------------------------------------------------------------------------------
   SO DO CHAN (DA DAU VA TEST - KHONG DOI)
     DS18B20  DATA -> GPIO4        VCC -> 3V3   GND -> GND
     B10K (mo phong DO)            ngoai1 -> 3V3, giua -> GPIO35, ngoai2 -> GND
     Relay 1  IN1  -> GPIO26   ->  MOTOR GUONG OXY
     Relay 2  IN2  -> GPIO27   ->  MAY BOM
     Relay VCC -> 5V, GND chung
     INA219   SDA -> GPIO21   SCL -> GPIO22   VCC -> 3V3   GND -> GND
              Adapter +5V -> VIN+ ; VIN- -> COM1 + COM2 Relay
     Cam bien pH: du kien GPIO34 - CHUA TICH HOP (xem config.h)

   RELAY HIGH TRIGGER:  HIGH = BAT,  LOW = TAT

   --------------------------------------------------------------------------------
   THU VIEN CAN CAI (Arduino IDE -> Library Manager):
     - OneWire                 (Paul Stoffregen)
     - DallasTemperature       (Miles Burton)
     - Adafruit INA219         (Adafruit)
     - ArduinoJson             (Benoit Blanchon)  <-- THEM MOI so voi code cu
   Board: "ESP32 Dev Module"   |   Serial Monitor: 115200
   ================================================================================ */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>
#include <Adafruit_INA219.h>

#include "config.h"

// ================================================================================
// TUONG THICH ArduinoJson v6 VA v7
// --------------------------------------------------------------------------------
// ArduinoJson 7 da BO "StaticJsonDocument", thay bang "JsonDocument".
// Macro duoi day tu chon dung kieu theo phien ban thu vien ban dang cai,
// nen code chay duoc ca v6 lan v7 ma khong phai sua gi.
// ================================================================================
#if ARDUINOJSON_VERSION_MAJOR >= 7
  #define VAST_JSON_DOC(ten, kichThuoc)  JsonDocument ten
#else
  #define VAST_JSON_DOC(ten, kichThuoc)  StaticJsonDocument<kichThuoc> ten
#endif

// ================================================================================
// KHAI BAO TRUOC CAC HAM
// (Arduino IDE tu sinh phan nay, nhung khai bao ro rang thi an toan hon
//  va giup code van bien dich duoc neu doi duoi file thanh .cpp)
// ================================================================================
void docCamBien();
void docNhietDo();
bool khoiTaoINA219(int soLanThu);
bool coThayDoiDangKe();
void kiemTraFailSafe();
void dieuKhienRelay();
void ketNoiWifi();
void kiemTraWifi();
void guiTelemetry();
void layLenhTuServer();
void guiAck(int commandId);
void inTrangThai();

// ================================================================================
// DOI TUONG CAM BIEN
// ================================================================================
OneWire oneWire(TEMP_PIN);
DallasTemperature camBienNhietDo(&oneWire);
Adafruit_INA219 ina219;

// ================================================================================
// BIEN TRANG THAI
// ================================================================================

// --- Cam bien ---
float nhietDo   = NAN;    // NAN = chua doc duoc / cam bien loi
float giaTriDO  = NAN;
float giaTriPH  = NAN;    // luon NAN khi ENABLE_PH_SENSOR = 0

float dienAp    = NAN;
float dongDien  = NAN;    // mA
float congSuat  = NAN;    // W

bool ina219OK   = false;
bool ds18b20OK  = false;

// --- Relay (bien nay la SU THAT ve trang thai chan ra) ---
bool guongDangBat = false;   // GPIO26
bool bomDangBat   = false;   // GPIO27

// --- Che do dieu khien ---
enum CheDo { CHE_DO_AUTO, CHE_DO_MANUAL };
CheDo cheDo = CHE_DO_AUTO;   // Khoi dong LUON o AUTO (an toan nhat)

// Trang thai nguoi dung yeu cau khi o MANUAL
bool manualGuong = false;
bool manualBom   = false;

// --- Mang / server ---
bool wifiDaKetNoi     = false;
bool serverPhanHoi    = false;
unsigned long lanCuoiServerOK = 0;   // millis() luc cuoi cung lien lac duoc server

// --- Bo dem thoi gian (millis) ---
unsigned long tSensor = 0, tTemp = 0, tTelemetry = 0, tCommand = 0, tPrint = 0, tWifi = 0;

// --- Gia tri cua LAN GUI GAN NHAT (de biet co gi thay doi khong) ---
float doGuiLanCuoi     = NAN;
float nhietDoGuiLanCuoi = NAN;
bool  guongGuiLanCuoi  = false;
bool  bomGuiLanCuoi    = false;
CheDo cheDoGuiLanCuoi  = CHE_DO_AUTO;

// --- Thong ke ---
unsigned long soLanGuiOK = 0, soLanGuiLoi = 0;


// ================================================================================
// SETUP
// ================================================================================
void setup() {
  Serial.begin(115200);
  delay(300);                       // delay ngan duy nhat, chi de Serial on dinh

  // ------------------------------------------------------------------
  // BUOC 1 (QUAN TRONG NHAT): TAT RELAY NGAY LAP TUC
  // Phai lam TRUOC MOI THU khac de bom/guong khong bat sai luc khoi dong.
  // ------------------------------------------------------------------
  pinMode(RELAY_GUONG, OUTPUT);
  pinMode(RELAY_BOM,   OUTPUT);
  digitalWrite(RELAY_GUONG, RELAY_OFF);   // GPIO26 = LOW
  digitalWrite(RELAY_BOM,   RELAY_OFF);   // GPIO27 = LOW
  guongDangBat = false;
  bomDangBat   = false;

  Serial.println();
  Serial.println(F("================================================"));
  Serial.println(F("  VAST - HE THONG AO TOM IoT"));
  Serial.println(F("  Relay da TAT an toan luc khoi dong"));
  Serial.println(F("================================================"));

  // ------------------------------------------------------------------
  // BUOC 2: CAM BIEN
  // ------------------------------------------------------------------
  camBienNhietDo.begin();
  camBienNhietDo.setWaitForConversion(false);   // KHONG chan chuong trinh khi doc
  ds18b20OK = (camBienNhietDo.getDeviceCount() > 0);
  Serial.print(F("DS18B20 : "));
  Serial.println(ds18b20OK ? F("OK") : F("KHONG TIM THAY (kiem tra dien tro 4.7k)"));

  analogReadResolution(12);          // ADC 12 bit -> 0..4095
  analogSetPinAttenuation(DO_PIN, ADC_11db);
#if ENABLE_PH_SENSOR
  analogSetPinAttenuation(PH_PIN, ADC_11db);
#endif

  // INA219: thu vai lan, module can chut thoi gian on dinh sau khi cap dien
  ina219OK = khoiTaoINA219(5);
  Serial.print(F("INA219  : "));
  if (ina219OK) {
    Serial.print(F("OK (dia chi 0x40) - dien ap doc thu = "));
    Serial.print(ina219.getBusVoltage_V(), 2);
    Serial.println(F(" V"));
  } else {
    Serial.println(F("KHONG TIM THAY (kiem tra SDA=21 SCL=22, GND chung, moi han)"));
    Serial.println(F("          -> he thong VAN CHAY, chi thieu so lieu dien nang"));
    Serial.println(F("          -> ESP32 se tu thu ket noi lai moi 10 giay"));
  }

  Serial.print(F("Cam bien pH: "));
#if ENABLE_PH_SENSOR
  Serial.println(F("DA BAT (GPIO34)"));
#else
  Serial.println(F("CHUA TICH HOP - gui gia tri null len server"));
#endif

  // ------------------------------------------------------------------
  // BUOC 3: WI-FI (khong block - neu that bai van chay AUTO binh thuong)
  // ------------------------------------------------------------------
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);              // giam tre khi polling
  ketNoiWifi();

  Serial.println(F("------------------------------------------------"));
  Serial.print(F("Thiet bi : ")); Serial.println(DEVICE_ID);
  Serial.print(F("Server   : ")); Serial.println(SERVER_URL);
  Serial.print(F("Che do   : AUTO (DO<")); Serial.print(DO_ON);
  Serial.print(F(" bat guong | Nhiet>")); Serial.print(TEMP_PUMP_ON);
  Serial.println(F(" bat bom)"));
  Serial.println(F("================================================"));
  Serial.println();

  lanCuoiServerOK = millis();
}


// ================================================================================
// LOOP - hoan toan khong block, moi viec chay theo lich rieng
// ================================================================================
void loop() {
  unsigned long now = millis();

  // 1) DOC DO + INA219 + DIEU KHIEN RELAY  (uu tien cao nhat - an toan ao)
  //    Chay 250ms/lan nen van bien tro la thay so doi gan nhu tuc thi.
  if (now - tSensor >= SENSOR_INTERVAL_MS) {
    tSensor = now;
    docCamBien();
    kiemTraFailSafe();     // xet truoc: co the doi cheDo ve AUTO
    dieuKhienRelay();      // ap dung ra chan GPIO
  }

  // 2) DOC NHIET DO DS18B20 (tach rieng vi chip nay can ~750ms moi do xong)
  if (now - tTemp >= TEMP_INTERVAL_MS) {
    tTemp = now;
    docNhietDo();
  }

  // 3) KIEM TRA / KET NOI LAI WI-FI
  if (now - tWifi >= WIFI_RETRY_MS) {
    tWifi = now;
    kiemTraWifi();
  }

  // 4) LAY LENH TU WEBSITE
  if (wifiDaKetNoi && now - tCommand >= COMMAND_INTERVAL_MS) {
    tCommand = now;
    layLenhTuServer();
  }

  // 5) GUI DU LIEU LEN SERVER
  //    a) Gui NGAY khi so lieu thay doi dang ke (van bien tro, relay bat/tat...)
  //    b) Hoac gui theo nhip dinh ky de bao "toi con song"
  if (wifiDaKetNoi) {
    bool guiNgay = coThayDoiDangKe() && (now - tTelemetry >= TELEMETRY_MIN_GAP_MS);
    bool guiDinhKy = (now - tTelemetry >= TELEMETRY_INTERVAL_MS);

    if (guiNgay || guiDinhKy) {
      tTelemetry = now;
      guiTelemetry();
    }
  }

  // 5) IN BANG TRANG THAI
  if (now - tPrint >= PRINT_INTERVAL_MS) {
    tPrint = now;
    inTrangThai();
  }
}


// ================================================================================
// DOC CAM BIEN
// ================================================================================
void docNhietDo() {
  // setWaitForConversion(false) -> lenh nay khong chan chuong trinh.
  // Gia tri lay ve la cua lan yeu cau TRUOC (tre 1 chu ky = 1 giay, chap nhan duoc).
  float t = camBienNhietDo.getTempCByIndex(0);
  camBienNhietDo.requestTemperatures();

  // -127 = mat ket noi cam bien, 85 = gia tri mac dinh chua do xong
  if (t <= -100.0 || t >= 84.9 || isnan(t)) {
    nhietDo = NAN;
    ds18b20OK = false;
  } else {
    nhietDo = t;
    ds18b20OK = true;
  }
}


void docCamBien() {

  // ---------- B10K MO PHONG DO ----------
  // Lay trung binh 8 lan cho on dinh (ADC ESP32 hoi nhieu)
  uint32_t tong = 0;
  for (int i = 0; i < 8; i++) tong += analogRead(DO_PIN);
  int adcDO = tong / 8;
  giaTriDO = adcDO * DO_VALUE_MAX / DO_ADC_MAX;

  // ---------- CAM BIEN pH (CHUA TICH HOP) ----------
#if ENABLE_PH_SENSOR
  // ==== KHI NAO GAN CAM BIEN pH THAT THI CHI CAN BAT ENABLE_PH_SENSOR = 1 ====
  uint32_t tongPH = 0;
  for (int i = 0; i < 8; i++) tongPH += analogRead(PH_PIN);
  float vPH = (tongPH / 8) * 3.3 / 4095.0;
  // Noi suy tuyen tinh qua 2 diem hieu chinh trong config.h
  float doDoc = (PH_CAL_PH2 - PH_CAL_PH1) / (PH_CAL_V2 - PH_CAL_V1);
  giaTriPH = PH_CAL_PH1 + doDoc * (vPH - PH_CAL_V1);
  if (giaTriPH < 0 || giaTriPH > 14) giaTriPH = NAN;
#else
  // Chua co cam bien -> KHONG bia so gia. Gui null len server,
  // website se hien "Chua ket noi cam bien".
  giaTriPH = NAN;
#endif

  // ---------- INA219 ----------
  if (ina219OK) {
    float v = ina219.getBusVoltage_V();
    float i = ina219.getCurrent_mA();
    float p = ina219.getPower_mW();

    if (isnan(v) || v < -1 || v > 60) {      // so vo ly -> coi nhu mat cam bien
      ina219OK = false;
      dienAp = dongDien = congSuat = NAN;
    } else {
      dienAp   = v;
      dongDien = i;
      congSuat = p / 1000.0;
    }
  } else {
    // Mat INA219 (thuong do day tiep xuc chap chon) -> tu thu ket noi lai
    // moi 10 giay. Khong lam nghen chuong trinh, relay van chay binh thuong.
    static unsigned long tThuLai = 0;
    if (millis() - tThuLai > 10000) {
      tThuLai = millis();
      if (khoiTaoINA219(1)) {
        ina219OK = true;
        Serial.println(F("\nINA219: DA KET NOI LAI DUOC\n"));
      }
    }
    dienAp = dongDien = congSuat = NAN;
  }
}


// ================================================================================
// KHOI TAO INA219
// --------------------------------------------------------------------------------
// Thu nhieu lan thay vi mot lan. Ly do:
//   - Module can vai chuc mili giay de on dinh sau khi cap dien
//   - Day breadboard tiep xuc chap chon rat hay gap tren mach thu nghiem
// Moi lan thu deu dung lai bus I2C tu dau, nen neu bus bi treo cung go duoc.
// ================================================================================
bool khoiTaoINA219(int soLanThu) {
  for (int i = 0; i < soLanThu; i++) {

    Wire.end();                       // dong bus cu (neu dang treo thi nha ra)
    delay(20);
    Wire.begin(SDA_PIN, SCL_PIN);
    Wire.setClock(100000);            // 100kHz - cham va chac, hop voi day breadboard dai
    delay(30);

    if (ina219.begin()) {
      // Doc thu mot gia tri de chac chan la noi chuyen duoc that,
      // khong phai chi "co thiet bi tra loi dia chi".
      float v = ina219.getBusVoltage_V();
      if (!isnan(v) && v >= -1 && v <= 60) return true;
    }

    delay(60);
  }
  return false;
}


// ================================================================================
// CO GI THAY DOI DANG KE KHONG?
// --------------------------------------------------------------------------------
// Tra ve true khi so lieu khac dang ke so voi LAN GUI GAN NHAT.
// Dung de gui telemetry NGAY LAP TUC thay vi doi het chu ky dinh ky
// -> nguoi dung van bien tro la thay so tren web doi gan nhu tuc thi.
// ================================================================================
bool coThayDoiDangKe() {

  // Relay vua bat/tat -> bao ngay cho web biet
  if (guongDangBat != guongGuiLanCuoi) return true;
  if (bomDangBat   != bomGuiLanCuoi)   return true;

  // Vua doi che do AUTO <-> MANUAL
  if (cheDo != cheDoGuiLanCuoi) return true;

  // Lan dau tien (chua gui bao gio)
  if (isnan(doGuiLanCuoi)) return true;

  // DO thay doi du nhieu (dang van bien tro)
  if (!isnan(giaTriDO) && fabs(giaTriDO - doGuiLanCuoi) >= DO_CHANGE_TRIGGER) return true;

  // Nhiet do thay doi du nhieu
  if (!isnan(nhietDo) && !isnan(nhietDoGuiLanCuoi) &&
      fabs(nhietDo - nhietDoGuiLanCuoi) >= TEMP_CHANGE_TRIGGER) return true;

  return false;
}


// ================================================================================
// FAIL-SAFE - yeu cau muc 3
// --------------------------------------------------------------------------------
// Neu dang MANUAL ma mat lien lac server qua MANUAL_TIMEOUT_SEC giay
// -> TU DONG QUAY VE AUTO.
//
// LY DO CHON PHUONG AN NAY:
//   MANUAL nghia la "co nguoi dang truc tiep dieu khien". Khi mat mang thi
//   khong con ai dieu khien nua. Neu giu nguyen MANUAL, vi du dang TAT guong
//   oxy de ve sinh ma mat mang, DO tut xuong 3 mg/L va KHONG AI bat lai
//   -> tom chet. Quay ve AUTO thi ESP32 tu bao ve ao theo nguong DO/nhiet do,
//   hoan toan khong phu thuoc Internet. Day la trang thai an toan nhat.
// ================================================================================
void kiemTraFailSafe() {
  if (MANUAL_TIMEOUT_SEC <= 0) return;                 // da tat tinh nang
  if (cheDo != CHE_DO_MANUAL) return;

  unsigned long troi = (millis() - lanCuoiServerOK) / 1000UL;
  if (troi >= (unsigned long)MANUAL_TIMEOUT_SEC) {
    cheDo = CHE_DO_AUTO;
    Serial.println();
    Serial.println(F("!!! FAIL-SAFE !!!"));
    Serial.print  (F("Mat lien lac server "));
    Serial.print  (troi);
    Serial.println(F("s khi dang MANUAL"));
    Serial.println(F(">>> TU DONG QUAY VE CHE DO AUTO de bao ve ao"));
    Serial.println();
  }
}


// ================================================================================
// DIEU KHIEN RELAY
// --------------------------------------------------------------------------------
// AUTO   : logic hysteresis chay NGAY TAI ESP32, khong can Internet (muc 11)
// MANUAL : theo dung lenh nguoi dung gui tu website
// ================================================================================
void dieuKhienRelay() {

  if (cheDo == CHE_DO_AUTO) {

    // ---------- GUONG OXY theo DO (hysteresis 5.0 / 5.5) ----------
    if (!isnan(giaTriDO)) {
      if (giaTriDO < DO_ON)        guongDangBat = true;    // DO thap -> BAT
      else if (giaTriDO >= DO_OFF) guongDangBat = false;   // DO du -> TAT
      // Khoang 5.0 - 5.5 : GIU NGUYEN trang thai cu
      // -> relay khong bat/tat lien tuc quanh nguong
    }

    // ---------- MAY BOM theo nhiet do (hysteresis 32.0 / 31.5) ----------
    if (!isnan(nhietDo)) {
      if (nhietDo > TEMP_PUMP_ON)        bomDangBat = true;
      else if (nhietDo <= TEMP_PUMP_OFF) bomDangBat = false;
    }
    // Neu DS18B20 hong (nhietDo = NAN): GIU NGUYEN trang thai bom hien tai,
    // khong tu y bat/tat theo so lieu rac.

  } else {
    // ---------- MANUAL ----------
    guongDangBat = manualGuong;
    bomDangBat   = manualBom;
  }

  // ---------- XUAT RA CHAN (RELAY HIGH TRIGGER) ----------
  digitalWrite(RELAY_GUONG, guongDangBat ? RELAY_ON : RELAY_OFF);
  digitalWrite(RELAY_BOM,   bomDangBat   ? RELAY_ON : RELAY_OFF);
}


// ================================================================================
// WI-FI
// ================================================================================
void ketNoiWifi() {
  Serial.print(F("Wi-Fi: dang ket noi toi \""));
  Serial.print(WIFI_SSID);
  Serial.print(F("\" "));

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Cho toi da 10 giay, van cho relay chay dung trong luc cho
  unsigned long batDau = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - batDau < 10000) {
    delay(250);                 // delay NGAN, chi trong ham nay luc khoi dong
    Serial.print('.');
  }
  Serial.println();

  wifiDaKetNoi = (WiFi.status() == WL_CONNECTED);

  if (wifiDaKetNoi) {
    Serial.print(F("Wi-Fi: DA KET NOI | IP = "));
    Serial.print(WiFi.localIP());
    Serial.print(F(" | RSSI = "));
    Serial.print(WiFi.RSSI());
    Serial.println(F(" dBm"));
  } else {
    Serial.println(F("Wi-Fi: KHONG KET NOI DUOC"));
    Serial.println(F("       -> CHE DO AUTO VAN CHAY BINH THUONG TAI THIET BI"));
    Serial.println(F("       -> Kiem tra: dung Wi-Fi 2.4GHz? dung mat khau?"));
  }
}

void kiemTraWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiDaKetNoi) {
      wifiDaKetNoi = true;
      Serial.print(F("\nWi-Fi: DA KET NOI LAI | IP = "));
      Serial.println(WiFi.localIP());
    }
    return;
  }

  if (wifiDaKetNoi) {
    wifiDaKetNoi = false;
    Serial.println(F("\nWi-Fi: MAT KET NOI - AUTO van chay tai thiet bi"));
  }

  // Thu lai (khong block lau)
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}


// ================================================================================
// GUI TELEMETRY LEN SERVER
// ================================================================================
void guiTelemetry() {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/iot/telemetry";

  if (!http.begin(url)) {
    Serial.println(F("[HTTP] URL server khong hop le - kiem tra SERVER_URL trong config.h"));
    return;
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(true);                              // giu ket noi TCP -> gui nhanh hon nhieu
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", DEVICE_TOKEN);   // token nam o HEADER, khong nam tren URL

  // ---------- Tao JSON ----------
  VAST_JSON_DOC(doc, 448);
  doc["device_id"] = DEVICE_ID;
  doc["pond_id"]   = POND_ID;

  // Gia tri NAN -> gui null (server hieu la "khong co du lieu")
  if (isnan(nhietDo))  doc["temperature"] = nullptr; else doc["temperature"] = roundf(nhietDo * 100) / 100.0;
  if (isnan(giaTriDO)) doc["do"]          = nullptr; else doc["do"]          = roundf(giaTriDO * 100) / 100.0;
  if (isnan(giaTriPH)) doc["ph"]          = nullptr; else doc["ph"]          = roundf(giaTriPH * 100) / 100.0;

  doc["pump"]    = bomDangBat;      // trang thai THAT cua GPIO27
  doc["aerator"] = guongDangBat;    // trang thai THAT cua GPIO26
  doc["mode"]    = (cheDo == CHE_DO_AUTO) ? "AUTO" : "MANUAL";

  if (isnan(dienAp))   doc["voltage"] = nullptr; else doc["voltage"] = roundf(dienAp * 100) / 100.0;
  if (isnan(dongDien)) doc["current"] = nullptr; else doc["current"] = roundf(dongDien);
  if (isnan(congSuat)) doc["power"]   = nullptr; else doc["power"]   = roundf(congSuat * 100) / 100.0;

  doc["rssi"] = WiFi.RSSI();

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);

  if (code == 200) {
    serverPhanHoi = true;
    lanCuoiServerOK = millis();
    soLanGuiOK++;

    // Ghi nho gia tri vua gui -> lan sau biet co gi thay doi khong
    doGuiLanCuoi      = giaTriDO;
    nhietDoGuiLanCuoi = nhietDo;
    guongGuiLanCuoi   = guongDangBat;
    bomGuiLanCuoi     = bomDangBat;
    cheDoGuiLanCuoi   = cheDo;
  } else {
    serverPhanHoi = false;
    soLanGuiLoi++;
    Serial.print(F("\n[HTTP] Gui telemetry loi, ma = "));
    Serial.print(code);
    if (code == 401) Serial.print(F("  -> DEVICE_TOKEN sai (chay lai: node seed.js)"));
    if (code == 404) Serial.print(F("  -> device_id chua dang ky tren server"));
    if (code < 0)    Serial.print(F("  -> khong noi duoc toi server (sai IP? khac mang? tuong lua?)"));
    Serial.println();
  }

  http.end();
}


// ================================================================================
// LAY LENH DIEU KHIEN TU WEBSITE
// ================================================================================
void layLenhTuServer() {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/iot/command?device_id=" + DEVICE_ID;

  if (!http.begin(url)) return;

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("X-Device-Token", DEVICE_TOKEN);

  int code = http.GET();
  if (code != 200) {
    http.end();
    return;                 // Mat server -> im lang, AUTO van chay
  }

  lanCuoiServerOK = millis();
  serverPhanHoi = true;

  String payload = http.getString();
  http.end();

  VAST_JSON_DOC(doc, 768);
  if (deserializeJson(doc, payload)) return;      // JSON hong -> bo qua

  JsonArray commands = doc["commands"];
  if (commands.isNull() || commands.size() == 0) return;

  for (JsonObject c : commands) {
    int         id  = c["id"] | -1;
    const char* cmd = c["command"] | "";
    const char* val = c["value"]   | "";
    if (id < 0) continue;

    Serial.println();
    Serial.print(F(">>> NHAN LENH #")); Serial.print(id);
    Serial.print(F(" : ")); Serial.print(cmd);
    Serial.print(F(" = "));  Serial.println(val);

    // ---------------- SET_MODE ----------------
    if (strcmp(cmd, "SET_MODE") == 0) {
      if (strcmp(val, "MANUAL") == 0) {
        cheDo = CHE_DO_MANUAL;
        // Vao MANUAL thi GIU NGUYEN trang thai relay dang chay,
        // khong dot ngot tat het -> tranh soc cho ao.
        manualGuong = guongDangBat;
        manualBom   = bomDangBat;
        Serial.println(F("    -> Chuyen sang MANUAL (giu nguyen trang thai hien tai)"));
      } else {
        cheDo = CHE_DO_AUTO;
        Serial.println(F("    -> Chuyen sang AUTO (ESP32 tu dieu khien)"));
      }
    }

    // ---------------- SET_PUMP (GPIO27) ----------------
    else if (strcmp(cmd, "SET_PUMP") == 0) {
      manualBom = (strcmp(val, "true") == 0);
      if (cheDo != CHE_DO_MANUAL) {
        Serial.println(F("    -> Dang o AUTO nen BO QUA lenh tay (ghi nho de dung khi vao MANUAL)"));
      } else {
        Serial.print(F("    -> MAY BOM (GPIO27) = "));
        Serial.println(manualBom ? F("BAT") : F("TAT"));
      }
    }

    // ---------------- SET_AERATOR (GPIO26) ----------------
    else if (strcmp(cmd, "SET_AERATOR") == 0) {
      manualGuong = (strcmp(val, "true") == 0);
      if (cheDo != CHE_DO_MANUAL) {
        Serial.println(F("    -> Dang o AUTO nen BO QUA lenh tay (ghi nho de dung khi vao MANUAL)"));
      } else {
        Serial.print(F("    -> GUONG OXY (GPIO26) = "));
        Serial.println(manualGuong ? F("BAT") : F("TAT"));
      }
    }

    // ---------------- CHUA HO TRO ----------------
    // Cho giai doan may cho an tu dong sau nay:
    //   FEED_NOW / FEED_AMOUNT / FEED_SCHEDULE
    // Server da chap nhan san cac lenh nay, chi can them xu ly o day.
    else {
      Serial.println(F("    -> Lenh chua duoc ho tro o firmware nay"));
    }

    // Ap dung ngay ra chan roi moi bao cho server
    dieuKhienRelay();
    guiAck(id);
  }
}


// ================================================================================
// BAO CHO SERVER: DA THUC HIEN XONG LENH
// ================================================================================
void guiAck(int commandId) {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/iot/ack";
  if (!http.begin(url)) return;

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", DEVICE_TOKEN);

  VAST_JSON_DOC(doc, 192);
  doc["device_id"]  = DEVICE_ID;
  doc["command_id"] = commandId;
  doc["result"]     = "ok";

  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();

  // Gui telemetry NGAY de website thay trang thai that lien,
  // khong phai cho het chu ky 4 giay.
  guiTelemetry();
}


// ================================================================================
// IN BANG TRANG THAI RA SERIAL MONITOR (115200)
// ================================================================================
void inTrangThai() {
  Serial.println();
  Serial.println(F("=============================================="));

  // ---- Che do ----
  Serial.print(F("CHE DO        : "));
  Serial.println(cheDo == CHE_DO_AUTO ? F("AUTO (ESP32 tu dieu khien)")
                                      : F("MANUAL (theo lenh tu website)"));

  // ---- Nhiet do ----
  Serial.print(F("NHIET DO NUOC : "));
  if (isnan(nhietDo)) Serial.println(F("LOI CAM BIEN DS18B20"));
  else { Serial.print(nhietDo, 2); Serial.println(F(" C")); }

  // ---- DO ----
  Serial.print(F("DO (B10K)     : "));
  Serial.print(giaTriDO, 2);
  Serial.println(F(" mg/L"));

  // ---- pH ----
  Serial.print(F("pH            : "));
#if ENABLE_PH_SENSOR
  if (isnan(giaTriPH)) Serial.println(F("LOI CAM BIEN"));
  else Serial.println(giaTriPH, 2);
#else
  Serial.println(F("CHUA KET NOI CAM BIEN"));
#endif

  Serial.println(F("----------------------------------------------"));

  // ---- Danh gia ----
  if (giaTriDO < DO_ON) {
    Serial.println(F("CANH BAO: DO THAP -> DANG BAT GUONG OXY"));
  } else if (giaTriDO < DO_OFF) {
    Serial.println(F("DO DANG HOI PHUC"));
  } else {
    Serial.println(F("DO BINH THUONG"));
  }

  if (!isnan(nhietDo)) {
    if (nhietDo > TEMP_PUMP_ON) Serial.println(F("CANH BAO: NHIET DO CAO -> DANG BAT MAY BOM"));
    else                        Serial.println(F("NHIET DO BINH THUONG"));
  }

  Serial.println(F("----------------------------------------------"));

  // ---- Relay ----
  Serial.print(F("GUONG OXY (26): "));
  Serial.println(guongDangBat ? F("DANG BAT") : F("DANG TAT"));
  Serial.print(F("MAY BOM   (27): "));
  Serial.println(bomDangBat ? F("DANG BAT") : F("DANG TAT"));

  // ---- INA219 ----
  Serial.println(F("----------------------------------------------"));
  if (ina219OK && !isnan(dienAp)) {
    Serial.print(F("DIEN AP       : ")); Serial.print(dienAp, 2);   Serial.println(F(" V"));
    Serial.print(F("DONG DIEN     : ")); Serial.print(dongDien, 0); Serial.println(F(" mA"));
    Serial.print(F("CONG SUAT     : ")); Serial.print(congSuat, 2); Serial.println(F(" W"));
  } else {
    Serial.println(F("INA219        : KHONG DOC DUOC"));
  }

  // ---- Mang ----
  Serial.println(F("----------------------------------------------"));
  Serial.print(F("WI-FI         : "));
  if (wifiDaKetNoi) {
    Serial.print(WiFi.localIP());
    Serial.print(F("  ("));
    Serial.print(WiFi.RSSI());
    Serial.println(F(" dBm)"));
  } else {
    Serial.println(F("MAT KET NOI"));
  }

  Serial.print(F("SERVER        : "));
  if (serverPhanHoi) {
    Serial.print(F("OK  ("));
    Serial.print(soLanGuiOK);
    Serial.print(F(" thanh cong / "));
    Serial.print(soLanGuiLoi);
    Serial.println(F(" loi)"));
  } else {
    Serial.print(F("MAT KET NOI - "));
    Serial.print((millis() - lanCuoiServerOK) / 1000);
    Serial.println(F("s truoc"));
  }

  // Canh bao sap fail-safe
  if (cheDo == CHE_DO_MANUAL && MANUAL_TIMEOUT_SEC > 0) {
    unsigned long troi = (millis() - lanCuoiServerOK) / 1000UL;
    if (troi > 5) {
      Serial.print(F("FAIL-SAFE     : ve AUTO sau "));
      Serial.print(MANUAL_TIMEOUT_SEC - (long)troi);
      Serial.println(F("s neu van mat server"));
    }
  }

  Serial.println(F("=============================================="));
}
