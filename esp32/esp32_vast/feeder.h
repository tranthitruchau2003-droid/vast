// ================================================================================
// feeder.h - MAY CHO AN TU DONG 2 MOTOR, DIEU KHIEN BANG DRV8833
//
// Them vao esp32_vast.ino, KHONG sua logic cu (guong oxy / may bom van y nguyen).
//
// ================================================================================
// SO DO DAU DAY (theo dung mach ban da noi)
// --------------------------------------------------------------------------------
//   DRV8833            ESP32 / NGUON
//   VCC   -----------  +5V adapter
//   GND   -----------  GND CHUNG (bat buoc noi chung voi GND cua ESP32)
//   IN1   -----------  GPIO25  \__ MOTOR 1 - N20 CAP CAM (vit tai)
//   IN2   -----------  GPIO33  /
//   IN3   -----------  GPIO18  \__ MOTOR 2 - MOTOR 130 QUAY DIA
//   IN4   -----------  GPIO19  /
//   EEP   -----------  (xem phan CANH BAO ben duoi)
//   ULT   -----------  bo trong duoc (chan bao loi, khong bat buoc)
//
//   OUT1/OUT2  ------  2 day motor N20
//   OUT3/OUT4  ------  2 day motor 130
//
// ================================================================================
// CANH BAO QUAN TRONG VE CHAN EEP
// --------------------------------------------------------------------------------
// Chu tren mach in bi cat doi: "SL|EEP" va "FA|ULT".
//   EEP = nSLEEP (ngu)     ULT = nFAULT (bao loi)
//
// nSLEEP PHAI O MUC CAO thi DRV8833 moi lam viec. De trong thi:
//   - Mach nao co dien tro keo len san  -> chay binh thuong
//   - Mach nao KHONG co                 -> chip ngu, MOTOR KHONG QUAY GI CA
//
// >>> NEU NAP CODE XONG MA CA HAI MOTOR DEU DUNG IM, DAY LA THU PHAM. <<<
// Cach xu ly: noi EEP vao 3V3 cua ESP32 (khong phai 5V - chan logic 3.3V).
//
// TOT HON NUA: noi EEP vao mot chan GPIO roi dat FEED_PIN_SLEEP ben duoi.
// Luc do ESP32 chu dong bat/tat chip. Loi ich that su:
// khi ESP32 reset hoac treo, chan GPIO ve trang thai tha noi -> neu co dien
// tro keo XUONG o chan EEP thi chip tu ngu -> MOTOR TU TAT.
// Khong lam vay thi ESP32 treo giua cu an = vit tai quay mai, do sach thung
// cam xuong ao.
//
// ================================================================================
// CAU H (H-BRIDGE) HOAT DONG THE NAO
// --------------------------------------------------------------------------------
// Khac relay (1 chan bat/tat), DRV8833 dung 2 chan cho moi motor:
//
//   IN1   IN2   Ket qua
//   ---   ---   ------------------------------------------
//    L     L    Tha troi  (motor quay tu do cho den khi dung)
//    H     L    Quay THUAN
//    L     H    Quay NGHICH
//    H     H    HAM      (motor dung ngay lap tuc)
//
// Vi sao dung HAM chu khong tha troi khi tat vit tai:
// tha troi thi vit tai con quay theo quan tinh them nua vong, tuc la
// ra them mot it cam ngoai luong da tinh. Ham lam no dung ngay -> lieu luong
// chinh xac hon. Day chinh la loi the cua DRV8833 so voi relay.
// ================================================================================

#ifndef VAST_FEEDER_H
#define VAST_FEEDER_H

#include <Preferences.h>   // luu he so hieu chuan vao bo nho trong ESP32

// ================================================================================
// PHAN CAU HINH - SUA O DAY CHO KHOP VOI MAY CUA BAN
// ================================================================================

/* ---- 1) CHAN GPIO (dung so cua ban) ---------------------------------------- */
#define FEED_VIT_IN1      25    // DRV8833 IN1 - motor 1 (N20 cap cam)
#define FEED_VIT_IN2      33    // DRV8833 IN2
#define FEED_DIA_IN1      18    // DRV8833 IN3 - motor 2 (130 quay dia)
#define FEED_DIA_IN2      19    // DRV8833 IN4

/* Chan EEP (nSLEEP).
     -1  = khong noi vao GPIO (dua vao dien tro keo len co san tren mach)
     >=0 = so chan GPIO dang dieu khien EEP  <-- KHUYEN DUNG, vi du 32
   Doi sang so chan neu ban noi day EEP. */
#define FEED_PIN_SLEEP    -1

/* ---- 2) CHIEU QUAY ---------------------------------------------------------
   Nap code xong ma motor quay NGUOC chieu mong muon thi KHONG can thao day.
   Chi doi 0 thanh 1 o dong tuong ung.
   (Go 'TEST' trong Serial Monitor de chay thu tung motor mot.) */
#define FEED_VIT_REVERSE  0
#define FEED_DIA_REVERSE  0

/* ---- 3) TOC DO (0-255) -----------------------------------------------------
   Vit tai: cham vua phai thi cam ra deu, de lieu luong chinh xac.
            Qua cham thi motor N20 khong du luc, bi ket -> khong nen duoi 120.
   Dia vang: chay het toc do de hat cam ra xa. */
#define FEED_SPEED_VIT    200
#define FEED_SPEED_DIA    255

#define FEED_PWM_FREQ     20000   // 20 kHz - tren nguong tai nghe, motor chay em
#define FEED_PWM_BITS     8       // 0-255

/* ---- 4) HIEU CHUAN: MOT GIAY VIT TAI RA BAO NHIEU GAM CAM? -----------------

   DAY LA CON SO QUAN TRONG NHAT CUA CA MAY CHO AN.
   Sai con so nay thi server tinh khau phan dung bao nhieu cung vo nghia,
   vi may van xa sai luong.

   CACH DO (lam 1 lan sau khi lap xong, lam lai khi doi loai cam):
     1. Do cam day thung
     2. Hung mot cai xo duoi mieng ra cam
     3. Mo Serial Monitor, go:   CALIB 10
        -> vit tai quay dung 10 giay
     4. Can cho cam trong xo
     5. FEED_GRAMS_PER_SEC = so gam can duoc / 10

   Vi du: quay 10 giay ra 210 g  ->  dat 21.0

   LUU Y: motor N20 nho, luong ra thuong chi vai chuc gam moi giay - khac han
   may cong nghiep. Cu do that roi dien vao, dung doan.
   Do lai khi doi so cam: cam so 2 va cam so 4 hat to nho khac nhau nen
   chay ra khong bang nhau.
*/
#define FEED_GRAMS_PER_SEC   25.0

/* Gia tri tren chi la MAC DINH luc chua hieu chuan lan nao.
   Sau khi ban hieu chuan tu trang web, con so that duoc luu vao bo nho
   trong cua ESP32 (NVS) va dung lai moi lan khoi dong - KHONG phai nap
   lai code. Muon quay ve mac dinh thi go 'RESETCALIB' o Serial Monitor. */

/* ---- 5) THOI GIAN TRINH TU ------------------------------------------------- */
#define FEED_SPINUP_MS    1500   // dia vang chay truoc bao lau roi moi tha cam
#define FEED_FLUSH_MS     3000   // <<< dia vang chay THEM 3 GIAY sau khi N20 tat
                                 //     (dung yeu cau cua ban: hat het cam con
                                 //      dinh tren dia, tranh cam dong lai o mieng)

/* Giu HAM bao lau truoc khi tha troi han.
   Phai co khoang nay that su, khong the ham roi tha ngay dong sau -
   nhu vay phanh chi ton tai vai nano giay, motor van quay theo quan tinh. */
#define FEED_BRAKE_MS     250

/* ---- 6) CHONG KET CAM (tuy chon) -------------------------------------------
   Vit tai bi cam nen chat co the ket. Bat cai nay thi truoc moi cu an,
   vit tai quay NGUOC mot nhip ngan de lam toi cam roi moi quay thuan.
   Nho DRV8833 la cau H nen lam duoc; relay thi khong.
     0 = tat    1 = bat */
#define FEED_ANTIJAM      0
#define FEED_ANTIJAM_MS   400

/* ---- 7) CHAN AN TOAN -------------------------------------------------------
   Vit tai quay lien tuc qua lau = ket cam, chay motor, hoac do sach ca thung
   xuong ao. Cac nguong nay chan truong hop server gui nham so qua lon
   hoac ban go nham khi thu. */
#define FEED_MAX_RUN_SEC     180     // vit tai khong bao gio quay qua 3 phut/cu
#define FEED_MAX_GRAMS       15000   // tu choi lenh xa qua 15 kg mot cu
#define FEED_MIN_GAP_MS      30000   // 2 cu phai cach nhau it nhat 30 giay

// ================================================================================
// TUONG THICH ESP32 CORE 2.x VA 3.x
// --------------------------------------------------------------------------------
// Core 3.x doi ham LEDC: ledcAttach(chan, tanSo, doPhanGiai) roi ledcWrite(chan,...)
// Core 2.x van dung kenh:  ledcSetup(kenh,...) + ledcAttachPin(chan, kenh)
// Macro duoi day tu chon dung kieu theo phien ban ban dang cai - giong cach
// file .ino da lam voi ArduinoJson v6/v7.
// ================================================================================
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  #define FEED_PWM_SETUP(pin, ch)        ledcAttach((pin), FEED_PWM_FREQ, FEED_PWM_BITS)
  #define FEED_PWM_SET(pin, ch, duty)    ledcWrite((pin), (duty))
#else
  #define FEED_PWM_SETUP(pin, ch)        do { ledcSetup((ch), FEED_PWM_FREQ, FEED_PWM_BITS); \
                                              ledcAttachPin((pin), (ch)); } while (0)
  #define FEED_PWM_SET(pin, ch, duty)    ledcWrite((ch), (duty))
#endif

// Kenh LEDC danh cho may cho an (sketch nay chua dung LEDC o cho nao khac)
#define FEED_CH_VIT_IN1   0
#define FEED_CH_VIT_IN2   1
#define FEED_CH_DIA_IN1   2
#define FEED_CH_DIA_IN2   3

#define FEED_DUTY_MAX     255

// ================================================================================
// TRANG THAI
// ================================================================================

enum FeedState {
  FEED_IDLE = 0,      // khong lam gi
  FEED_ANTIJAM_STEP,  // dang quay nguoc lam toi cam
  FEED_SPINUP,        // dia vang dang len toc do
  FEED_RUNNING,       // vit tai dang xa cam
  FEED_FLUSH,         // dia vang chay them cho ra het cam
  FEED_STOPPING,      // dang HAM ca hai motor truoc khi tha troi
  FEED_CALIB,         // dang chay hieu chuan
  FEED_TEST_VIT,      // thu rieng motor vit tai
  FEED_TEST_DIA       // thu rieng motor dia vang
};

/* He so hieu chuan DANG DUNG. Doc tu bo nho trong luc khoi dong,
   hoac nhan tu web qua lenh FEED_SET_CALIB. */
float feedGramsPerSec    = FEED_GRAMS_PER_SEC;
Preferences feedPrefs;

FeedState feedState      = FEED_IDLE;
unsigned long feedT0     = 0;        // moc thoi gian cua buoc hien tai
unsigned long feedRunMs  = 0;        // vit tai phai quay bao lau (mili giay)
unsigned long feedLastAt = 0;        // luc ket thuc cu gan nhat
float feedTargetG        = 0;        // luong dat ra cua cu nay (gam)
float feedDoneG          = 0;        // luong da xa cua cu gan nhat (gam)
long  feedPendingG       = -1;       // luong server gui qua FEED_AMOUNT, cho FEED_NOW
int   feedTotalMeals     = 0;        // dem so cu da xa tu luc bat may
float feedTotalG         = 0;        // tong so gam da xa tu luc bat may
const char* feedLastErr  = "";

/* Ham xong thi in cau gi. Dat truoc khi chuyen sang FEED_STOPPING. */
bool feedFinishReport = false;

// ================================================================================
// DIEU KHIEN CAU H
// ================================================================================

enum MotorMode {
  MT_COAST = 0,   // tha troi - motor quay tu do den khi dung
  MT_FWD,         // quay thuan
  MT_REV,         // quay nghich
  MT_BRAKE        // ham - dung ngay
};

/**
 * Dat trang thai mot kenh cau H.
 * Ca 2 chan deu gan PWM, nen bieu dien duoc het 4 trang thai chi bang
 * gia tri duty: 0 = muc thap, 255 = muc cao, o giua = bam xung.
 */
void motorSet(int pinA, int chA, int pinB, int chB, MotorMode mode, int speed) {
  if (speed < 0) speed = 0;
  if (speed > FEED_DUTY_MAX) speed = FEED_DUTY_MAX;

  switch (mode) {
    case MT_FWD:
      FEED_PWM_SET(pinA, chA, speed);
      FEED_PWM_SET(pinB, chB, 0);
      break;
    case MT_REV:
      FEED_PWM_SET(pinA, chA, 0);
      FEED_PWM_SET(pinB, chB, speed);
      break;
    case MT_BRAKE:
      // Ca hai chan len cao = ngan mach 2 dau motor qua cau duoi -> ham lai
      FEED_PWM_SET(pinA, chA, FEED_DUTY_MAX);
      FEED_PWM_SET(pinB, chB, FEED_DUTY_MAX);
      break;
    case MT_COAST:
    default:
      FEED_PWM_SET(pinA, chA, 0);
      FEED_PWM_SET(pinB, chB, 0);
      break;
  }
}

/** Motor 1 - vit tai N20. Tu doi chieu neu FEED_VIT_REVERSE = 1. */
void feedVit(MotorMode mode) {
#if FEED_VIT_REVERSE
  if (mode == MT_FWD) mode = MT_REV;
  else if (mode == MT_REV) mode = MT_FWD;
#endif
  motorSet(FEED_VIT_IN1, FEED_CH_VIT_IN1, FEED_VIT_IN2, FEED_CH_VIT_IN2, mode, FEED_SPEED_VIT);
}

/** Motor 2 - dia vang 130. */
void feedDia(MotorMode mode) {
#if FEED_DIA_REVERSE
  if (mode == MT_FWD) mode = MT_REV;
  else if (mode == MT_REV) mode = MT_FWD;
#endif
  motorSet(FEED_DIA_IN1, FEED_CH_DIA_IN1, FEED_DIA_IN2, FEED_CH_DIA_IN2, mode, FEED_SPEED_DIA);
}

/**
 * HAM ca hai motor va GIU nguyen trang thai ham.
 *
 * KHONG duoc ham roi tha troi ngay dong sau: hai lenh cach nhau vai
 * micro giay thi phanh chua kip an, motor van quay theo quan tinh - dung
 * cai ma minh muon tranh. Muon ham that thi phai GIU mot khoang thoi gian,
 * viec do do FEED_STOPPING trong feederLoop() lo.
 */
void feedBrakeAll() {
  feedVit(MT_BRAKE);
  feedDia(MT_BRAKE);
}

/** Tha troi han ca hai motor (chi goi sau khi da ham du lau). */
void feedCoastAll() {
  feedVit(MT_COAST);
  feedDia(MT_COAST);
}

/** Dung khan: ham ngay. Viec tha troi de FEED_STOPPING lam. */
void feedStopAll() {
  feedBrakeAll();
}

/** Bat/tat chip DRV8833 qua chan nSLEEP (neu co noi day). */
void feedSleep(bool ngu) {
#if FEED_PIN_SLEEP >= 0
  digitalWrite(FEED_PIN_SLEEP, ngu ? LOW : HIGH);
#else
  (void)ngu;
#endif
}

// ================================================================================
// HE SO HIEU CHUAN - LUU VAO BO NHO TRONG ESP32
// --------------------------------------------------------------------------------
// Truoc day muon doi he so phai sua feeder.h roi nap lai code. Ra ao ma
// khong mang laptop la chiu. Gio hieu chuan ngay tren web: bam chay 10 giay,
// can cam, nhap so gam - ESP32 tu tinh va GHI VAO BO NHO TRONG.
// Mat dien, khoi dong lai van con.
// ================================================================================

void feedLoadCalib() {
  feedPrefs.begin("vast-feed", true);          // true = chi doc
  float luu = feedPrefs.getFloat("gps", 0.0);
  feedPrefs.end();

  if (luu > 0.1 && luu < 100000.0) {
    feedGramsPerSec = luu;
    Serial.print(F("[CHO AN] He so hieu chuan da luu: "));
    Serial.print(feedGramsPerSec, 2);
    Serial.println(F(" g/giay"));
  } else {
    feedGramsPerSec = FEED_GRAMS_PER_SEC;
    Serial.print(F("[CHO AN] Chua hieu chuan lan nao, dung mac dinh: "));
    Serial.print(feedGramsPerSec, 2);
    Serial.println(F(" g/giay"));
  }
}

bool feedSaveCalib(float gps) {
  // Chan so vo ly: hieu chuan sai la moi cu an sau deu sai theo
  if (!(gps > 0.1) || gps > 100000.0) {
    Serial.println(F("[CHO AN] He so hieu chuan khong hop le, da bo qua"));
    return false;
  }

  feedGramsPerSec = gps;
  feedPrefs.begin("vast-feed", false);         // false = ghi duoc
  feedPrefs.putFloat("gps", gps);
  feedPrefs.end();

  Serial.print(F("[CHO AN] DA LUU he so hieu chuan: "));
  Serial.print(gps, 2);
  Serial.println(F(" g/giay (giu nguyen ke ca khi mat dien)"));
  return true;
}

void feedResetCalib() {
  feedPrefs.begin("vast-feed", false);
  feedPrefs.remove("gps");
  feedPrefs.end();
  feedGramsPerSec = FEED_GRAMS_PER_SEC;
  Serial.print(F("[CHO AN] Da xoa hieu chuan, ve mac dinh "));
  Serial.print(feedGramsPerSec, 2);
  Serial.println(F(" g/giay"));
}

// ================================================================================
// KHOI DONG
// ================================================================================
void feederSetup() {
  FEED_PWM_SETUP(FEED_VIT_IN1, FEED_CH_VIT_IN1);
  FEED_PWM_SETUP(FEED_VIT_IN2, FEED_CH_VIT_IN2);
  FEED_PWM_SETUP(FEED_DIA_IN1, FEED_CH_DIA_IN1);
  FEED_PWM_SETUP(FEED_DIA_IN2, FEED_CH_DIA_IN2);

#if FEED_PIN_SLEEP >= 0
  pinMode(FEED_PIN_SLEEP, OUTPUT);
  digitalWrite(FEED_PIN_SLEEP, HIGH);     // danh thuc DRV8833
#endif

  // TAT NGAY tu dau. ESP32 vua cap dien, chan GPIO o trang thai bat dinh -
  // khong keo ve muc thap truoc thi may co the tu xa cam luc khoi dong.
  // O day tha troi luon duoc, vi motor chua he quay nen khong co quan tinh.
  feedCoastAll();
  feedState = FEED_IDLE;

  Serial.println(F("[CHO AN] DRV8833 san sang."));
  Serial.print(F("         VIT TAI (N20) : IN1=GPIO")); Serial.print(FEED_VIT_IN1);
  Serial.print(F(" IN2=GPIO")); Serial.println(FEED_VIT_IN2);
  Serial.print(F("         DIA VANG (130): IN3=GPIO")); Serial.print(FEED_DIA_IN1);
  Serial.print(F(" IN4=GPIO")); Serial.println(FEED_DIA_IN2);
  feedLoadCalib();
  Serial.println(F("         (go 'CALIB 10' de do lai, hoac hieu chuan tu trang web)"));
  Serial.print(F("         Dia vang chay them ")); Serial.print(FEED_FLUSH_MS / 1000.0, 1);
  Serial.println(F(" giay sau khi vit tai tat"));

#if FEED_PIN_SLEEP < 0
  Serial.println(F("         LUU Y: chan EEP dang de trong. Neu ca 2 motor"));
  Serial.println(F("                khong quay gi, hay noi EEP vao 3V3."));
#endif
}

// ================================================================================
// BAT DAU MOT CU AN
// ================================================================================
bool feedStart(float gam) {
  if (feedState != FEED_IDLE) {
    feedLastErr = "Dang xa cu truoc, chua xong";
    Serial.println(F("    -> TU CHOI: dang xa cu truoc"));
    return false;
  }

  if (!(gam > 0)) {
    feedLastErr = "Luong cam khong hop le";
    Serial.println(F("    -> TU CHOI: luong cam khong hop le"));
    return false;
  }

  if (gam > FEED_MAX_GRAMS) {
    feedLastErr = "Luong cam vuot nguong an toan";
    Serial.print(F("    -> TU CHOI: ")); Serial.print(gam);
    Serial.print(F(" g vuot nguong ")); Serial.print(FEED_MAX_GRAMS);
    Serial.println(F(" g"));
    return false;
  }

  // Chan bam lien tuc: server da co co che nay nhung ESP32 phai tu bao ve
  // minh, phong khi mat mang roi lenh cu bi gui lai don dap.
  if (feedLastAt != 0 && millis() - feedLastAt < FEED_MIN_GAP_MS) {
    feedLastErr = "Hai cu qua gan nhau";
    Serial.println(F("    -> TU CHOI: cu truoc vua xong, doi them"));
    return false;
  }

  unsigned long ms = (unsigned long)((gam / feedGramsPerSec) * 1000.0);
  if (ms > (unsigned long)FEED_MAX_RUN_SEC * 1000UL) {
    ms = (unsigned long)FEED_MAX_RUN_SEC * 1000UL;
    Serial.println(F("    -> Da cat bot: vuot thoi gian quay toi da"));
  }

  feedTargetG = gam;
  feedRunMs   = ms;
  feedT0      = millis();
  feedLastErr = "";

  feedSleep(false);            // danh thuc chip neu dang ngu

#if FEED_ANTIJAM
  // Quay nguoc mot nhip ngan de lam toi cam truoc khi day ra
  feedState = FEED_ANTIJAM_STEP;
  feedVit(MT_REV);
  Serial.println(F("    -> Quay nguoc lam toi cam..."));
#else
  feedState = FEED_SPINUP;
  feedDia(MT_FWD);             // dia vang chay truoc
#endif

  Serial.print(F("    -> XA CU: ")); Serial.print(gam, 0);
  Serial.print(F(" g, vit tai quay ")); Serial.print(ms / 1000.0, 1);
  Serial.println(F(" giay"));
  return true;
}

/** Dung khan cap giua chung. */
void feedAbort(const char* lyDo) {
  if (feedState == FEED_IDLE) return;

  // Tinh phan da xa duoc truoc khi dung - de server tru kho cho dung
  if (feedState == FEED_RUNNING) {
    float daChay = (millis() - feedT0) / 1000.0;
    feedDoneG = daChay * feedGramsPerSec;
  }

  feedBrakeAll();
  feedFinishReport = false;
  feedState = FEED_STOPPING;      // giu ham FEED_BRAKE_MS roi moi tha troi
  feedT0 = millis();
  feedLastAt = millis();
  feedLastErr = lyDo;

  Serial.print(F("[CHO AN] DUNG GIUA CHUNG: ")); Serial.println(lyDo);
}

// ================================================================================
// HIEU CHUAN: quay vit tai dung N giay de can luong cam ra
// ================================================================================
void feedCalibrate(float giay) {
  if (feedState != FEED_IDLE) {
    Serial.println(F("[CHO AN] Dang ban, khong hieu chuan duoc"));
    return;
  }
  if (giay <= 0 || giay > FEED_MAX_RUN_SEC) {
    Serial.println(F("[CHO AN] So giay khong hop le"));
    return;
  }

  feedRunMs = (unsigned long)(giay * 1000.0);
  feedState = FEED_CALIB;
  feedT0    = millis();
  feedSleep(false);
  feedVit(MT_FWD);        // CHI quay vit tai, KHONG bat dia vang, de cam roi
                          // thang xuong xo hung cho de can

  Serial.print(F("[CHO AN] HIEU CHUAN: vit tai quay "));
  Serial.print(giay, 1);
  Serial.println(F(" giay. Hung xo va can cam sau khi xong."));
}

// ================================================================================
// CHAY THU TUNG MOTOR - de kiem dau day va chieu quay luc moi lap
// ================================================================================
/**
 * Chay thu 1 motor.
 * @param soMotor  1 = vit tai N20, 2 = dia vang 130
 * @param giay     chay bao lau. Mac dinh 3 giay du de nghe motor quay.
 *                 De 15-30 giay khi can CAM DONG HO DO dien ap ra OUT -
 *                 3 giay khong kip dat que do.
 */
void feedTest(int soMotor, float giay = 3.0) {
  if (feedState != FEED_IDLE) {
    Serial.println(F("[CHO AN] Dang ban, khong thu duoc"));
    return;
  }
  if (giay <= 0 || giay > 60) giay = 3.0;

  feedSleep(false);
  feedT0 = millis();
  feedRunMs = (unsigned long)(giay * 1000.0);

  if (soMotor == 1) {
    feedState = FEED_TEST_VIT;
    feedVit(MT_FWD);
    Serial.print(F("[CHO AN] THU MOTOR 1 (N20 vit tai) - "));
    Serial.print(giay, 0); Serial.println(F(" giay."));
    Serial.println(F("         Do dien ap giua OUT1 va OUT2: phai co ~4-5V."));
    Serial.println(F("         Co dien ma motor khong quay -> motor hong hoac ket."));
    Serial.println(F("         KHONG co dien -> chan EEP chua noi, hoac VCC chua co nguon."));
    Serial.println(F("         Quay sai chieu? Doi FEED_VIT_REVERSE thanh 1."));
  } else {
    feedState = FEED_TEST_DIA;
    feedDia(MT_FWD);
    Serial.print(F("[CHO AN] THU MOTOR 2 (130 dia vang) - "));
    Serial.print(giay, 0); Serial.println(F(" giay."));
    Serial.println(F("         Do dien ap giua OUT3 va OUT4: phai co ~4-5V."));
    Serial.println(F("         Quay sai chieu? Doi FEED_DIA_REVERSE thanh 1."));
  }
}

// ================================================================================
// VONG CHAY - goi tu loop(), khong bao gio chan chuong trinh
// ================================================================================
void feederLoop() {
  if (feedState == FEED_IDLE) return;

  unsigned long troi = millis() - feedT0;

  switch (feedState) {

    case FEED_ANTIJAM_STEP:
      if (troi >= FEED_ANTIJAM_MS) {
        // Ham vit tai va GIU ham suot giai doan dia vang khoi dong.
        // Giai doan do dai 1,5 giay - thua du de phanh an hoan toan truoc
        // khi doi sang quay thuan.
        feedVit(MT_BRAKE);
        feedState = FEED_SPINUP;
        feedT0 = millis();
        feedDia(MT_FWD);           // gio moi cho dia vang chay
      }
      break;

    case FEED_SPINUP:
      // Dia vang da du toc do -> tha cam xuong
      if (troi >= FEED_SPINUP_MS) {
        feedVit(MT_FWD);
        feedState = FEED_RUNNING;
        feedT0 = millis();
      }
      break;

    case FEED_RUNNING:
      if (troi >= feedRunMs) {
        // HAM vit tai va GIU ham suot 3 giay dia vang chay them.
        // Tha troi thi truc vit con quay theo quan tinh, ra them cam
        // ngoai luong da tinh -> lieu luong sai.
        feedVit(MT_BRAKE);

        feedDoneG = feedTargetG;
        feedState = FEED_FLUSH;
        feedT0 = millis();

        Serial.print(F("[CHO AN] Vit tai tat. Dia vang chay them "));
        Serial.print(FEED_FLUSH_MS / 1000.0, 1);
        Serial.println(F(" giay cho ra het cam."));
      }
      break;

    case FEED_FLUSH:
      // DIA VANG chay them 3 giay sau khi N20 da tat.
      // Muc dich: hat het cam con dinh tren dia va con nam o mieng ra,
      // khong de dong lai gay ket cho cu sau.
      if (troi >= FEED_FLUSH_MS) {
        feedDia(MT_BRAKE);         // ham dia vang, vit tai van dang ham
        feedFinishReport = true;   // bao cao ket qua sau khi ham xong
        feedState = FEED_STOPPING;
        feedT0 = millis();
      }
      break;

    case FEED_STOPPING:
      // Da ham du lau -> gio moi tha troi han va cho chip ngu.
      if (troi >= FEED_BRAKE_MS) {
        feedCoastAll();
        feedSleep(true);           // chip ngu -> khong ton dien, khong nong
        feedState  = FEED_IDLE;
        feedLastAt = millis();

        if (feedFinishReport) {
          feedFinishReport = false;
          feedTotalMeals++;
          feedTotalG += feedDoneG;

          Serial.print(F("[CHO AN] XONG: ")); Serial.print(feedDoneG, 0);
          Serial.print(F(" g | tong tu luc bat may: ")); Serial.print(feedTotalG / 1000.0, 2);
          Serial.print(F(" kg / ")); Serial.print(feedTotalMeals);
          Serial.println(F(" cu"));
        }
      }
      break;

    case FEED_CALIB:
      if (troi >= feedRunMs) {
        feedVit(MT_BRAKE);
        feedFinishReport = false;
        feedState = FEED_STOPPING;   // ham roi moi tha, giong luc xa cam
        feedT0 = millis();

        float giay = feedRunMs / 1000.0;
        Serial.println();
        Serial.println(F("========================================"));
        Serial.print(F("HIEU CHUAN XONG - da quay "));
        Serial.print(giay, 1); Serial.println(F(" giay"));
        Serial.println(F("Can so cam vua ra, roi tinh:"));
        Serial.print(F("   FEED_GRAMS_PER_SEC = so_gam / "));
        Serial.println(giay, 1);
        Serial.print(F("Gia tri dang dung: "));
        Serial.print(feedGramsPerSec, 2); Serial.println(F(" g/giay"));
        Serial.println(F("Nhap so gam vua can vao trang web -> tu luu,"));
        Serial.println(F("hoac go:  SETCALIB <so_g_moi_giay>"));
        Serial.println(F("========================================"));
      }
      break;

    case FEED_TEST_VIT:
    case FEED_TEST_DIA:
      if (troi >= feedRunMs) {
        feedBrakeAll();
        feedFinishReport = false;
        feedState = FEED_STOPPING;
        feedT0 = millis();
        Serial.println(F("[CHO AN] Thu xong."));
      }
      break;

    default:
      break;
  }
}

// ================================================================================
// XU LY LENH TU SERVER
// --------------------------------------------------------------------------------
// Server gui 2 lenh lien tiep:
//     FEED_AMOUNT = "28688"   (so GAM)
//     FEED_NOW    = "true"
// Nho so gam truoc, gap FEED_NOW moi xa. Neu vi ly do nao do chi nhan duoc
// FEED_NOW ma khong co FEED_AMOUNT -> KHONG doan bua, tu choi va bao loi.
// Doan bua o day nghia la do sai luong cam xuong ao that.
// @return true neu lenh nay thuoc ve may cho an
// ================================================================================
bool feederHandleCommand(const char* cmd, const char* val) {

  if (strcmp(cmd, "FEED_AMOUNT") == 0) {
    long g = atol(val);
    if (g > 0 && g <= FEED_MAX_GRAMS) {
      feedPendingG = g;
      Serial.print(F("    -> Ghi nho luong cu toi: ")); Serial.print(g);
      Serial.println(F(" g"));
    } else {
      feedPendingG = -1;
      Serial.println(F("    -> Luong cam khong hop le, da bo qua"));
    }
    return true;
  }

  if (strcmp(cmd, "FEED_NOW") == 0) {
    if (feedPendingG <= 0) {
      Serial.println(F("    -> TU CHOI: chua biet phai xa bao nhieu gam"));
      feedLastErr = "Thieu FEED_AMOUNT";
      return true;
    }
    feedStart((float)feedPendingG);
    feedPendingG = -1;          // dung 1 lan roi quen, khong xa lai lan nua
    return true;
  }

  if (strcmp(cmd, "FEED_STOP") == 0) {
    feedAbort("Lenh dung tu website");
    return true;
  }

  if (strcmp(cmd, "FEED_CALIBRATE") == 0) {
    float giay = atof(val);
    feedCalibrate(giay > 0 ? giay : 10.0);
    return true;
  }

  // Chay thu rieng tung motor - bam tu trang web, khong can Serial Monitor.
  // Gia tri: "1" hoac "2"  (chay 3 giay)
  //          "1:15"        (chay 15 giay - du lau de cam dong ho do)
  if (strcmp(cmd, "FEED_TEST") == 0) {
    int soMotor = atoi(val) == 2 ? 2 : 1;
    float giay = 3.0;
    const char* haiCham = strchr(val, ':');
    if (haiCham) giay = atof(haiCham + 1);
    feedTest(soMotor, giay);
    return true;
  }

  // Web gui he so hieu chuan da tinh san -> ghi vao bo nho trong.
  // Nho vay hieu chuan xong khong phai nap lai code.
  if (strcmp(cmd, "FEED_SET_CALIB") == 0) {
    feedSaveCalib(atof(val));
    return true;
  }

  return false;   // khong phai lenh cua may cho an
}

// ================================================================================
// LENH GO TAY QUA SERIAL MONITOR (de thu may luc lap dat)
//     TEST1        -> chay rieng motor 1 (N20 vit tai) 3 giay
//     TEST2        -> chay rieng motor 2 (130 dia vang) 3 giay
//     FEED 500     -> xa 500 gam (chay ca trinh tu day du)
//     CALIB 10     -> quay vit tai 10 giay de hieu chuan
//     STOP         -> dung ngay
// ================================================================================
void feederSerial() {
  if (!Serial.available()) return;

  String s = Serial.readStringUntil('\n');
  s.trim();
  s.toUpperCase();

  if (s.startsWith("TEST1")) {
    // "TEST1" = 3 giay,  "TEST1 15" = 15 giay (du lau de cam dong ho do)
    feedTest(1, s.length() > 6 ? s.substring(6).toFloat() : 3.0);
  } else if (s.startsWith("TEST2")) {
    feedTest(2, s.length() > 6 ? s.substring(6).toFloat() : 3.0);
  } else if (s == "TEST") {
    Serial.println(F("[CHO AN] Go TEST1 / TEST2  (3 giay)"));
    Serial.println(F("         hoac TEST1 15     (giu 15 giay de cam dong ho do)"));
  } else if (s.startsWith("FEED ")) {
    feedStart(s.substring(5).toFloat());
  } else if (s.startsWith("CALIB")) {
    float giay = s.length() > 6 ? s.substring(6).toFloat() : 10.0;
    feedCalibrate(giay > 0 ? giay : 10.0);
  } else if (s == "STOP") {
    feedAbort("Lenh STOP tu Serial");
  } else if (s.startsWith("SETCALIB")) {
    feedSaveCalib(s.length() > 9 ? s.substring(9).toFloat() : 0);
  } else if (s == "RESETCALIB") {
    feedResetCalib();
  }
}

/** Ten trang thai de in ra bang trang thai / gui len server. */
const char* feedStateName() {
  switch (feedState) {
    case FEED_ANTIJAM_STEP: return "dang lam toi cam";
    case FEED_SPINUP:       return "dang khoi dong dia";
    case FEED_RUNNING:      return "dang xa cam";
    case FEED_FLUSH:        return "dia dang hat not";
    case FEED_STOPPING:     return "dang ham motor";
    case FEED_CALIB:        return "dang hieu chuan";
    case FEED_TEST_VIT:     return "dang thu vit tai";
    case FEED_TEST_DIA:     return "dang thu dia vang";
    default:                return "nghi";
  }
}

#endif  // VAST_FEEDER_H
