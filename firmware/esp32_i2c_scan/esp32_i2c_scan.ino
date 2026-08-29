/* ================================================================
   CHAN DOAN INA219 - BAN 2 (do sau hon)
   ----------------------------------------------------------------
   Sketch nay lam 3 viec, chi ra CHINH XAC dang hong o dau:

     BUOC 1: Do xem 2 chan SDA/SCL co dien tro keo len khong
             -> biet duoc module DA CAM va CO DIEN chua
     BUOC 2: Quet bus I2C voi SDA=21, SCL=22 (dung so do)
     BUOC 3: Quet lai voi SDA/SCL DAO NGUOC
             -> neu tim thay o buoc nay thi ban cam nguoc 2 day

   CACH DUNG:
     1. Nap sketch nay
     2. Mo Serial Monitor 115200
     3. Doc dong KET LUAN o cuoi, gui lai cho Claude
     4. Xong nap lai esp32_vast.ino nhu cu

   AN TOAN: dat GPIO26 va GPIO27 ve LOW ngay khi khoi dong,
   bom va guong luon TAT trong suot qua trinh chan doan.
   ================================================================ */

#include <Wire.h>

#define SDA_PIN 21
#define SCL_PIN 22

#define RELAY_GUONG 26
#define RELAY_BOM   27

// Ket qua cua tung buoc
bool coPullupSDA = false;
bool coPullupSCL = false;
int  soThietBiThuong = 0;
int  soThietBiDao = 0;
byte diaChiTimDuoc = 0;


/* ----------------------------------------------------------------
   Kiem tra chan co dien tro keo len tu ben ngoai khong.

   Cach lam: bat dien tro KEO XUONG ben trong ESP32 (khoang 45k).
   - Neu module INA219 dang cam va co dien, no co dien tro keo len
     10k noi len VCC -> keo len 10k thang keo xuong 45k -> doc ra MUC CAO
   - Neu khong cam gi, hoac module khong co dien -> doc ra MUC THAP
   ---------------------------------------------------------------- */
bool kiemTraPullup(int chan) {
  pinMode(chan, INPUT_PULLDOWN);
  delay(20);
  bool cao = digitalRead(chan);
  pinMode(chan, INPUT);
  return cao;
}


/* ----------------------------------------------------------------
   Quet bus I2C, tra ve so thiet bi tim duoc
   ---------------------------------------------------------------- */
int quetBus(int chanSDA, int chanSCL, const char* nhan) {
  Serial.println();
  Serial.print(F("  Quet voi SDA=GPIO"));
  Serial.print(chanSDA);
  Serial.print(F(", SCL=GPIO"));
  Serial.print(chanSCL);
  Serial.print(F("  "));
  Serial.println(nhan);

  Wire.end();
  delay(50);
  Wire.begin(chanSDA, chanSCL);
  Wire.setClock(100000);      // 100kHz - toc do cham, de bat nhat
  delay(50);

  int dem = 0;
  for (byte diaChi = 1; diaChi < 127; diaChi++) {
    Wire.beginTransmission(diaChi);
    if (Wire.endTransmission() == 0) {
      dem++;
      if (diaChiTimDuoc == 0) diaChiTimDuoc = diaChi;

      Serial.print(F("     >>> TIM THAY tai dia chi 0x"));
      if (diaChi < 16) Serial.print('0');
      Serial.print(diaChi, HEX);

      if (diaChi >= 0x40 && diaChi <= 0x4F) {
        Serial.print(F("   <-- DUNG LA INA219"));
        if (diaChi != 0x40) Serial.print(F(" (dia chi KHONG mac dinh!)"));
      }
      Serial.println();
    }
    delay(2);
  }

  if (dem == 0) Serial.println(F("     (khong thay gi)"));
  return dem;
}


void setup() {
  Serial.begin(115200);
  delay(800);

  // An toan truoc tien
  pinMode(RELAY_GUONG, OUTPUT);
  pinMode(RELAY_BOM, OUTPUT);
  digitalWrite(RELAY_GUONG, LOW);
  digitalWrite(RELAY_BOM, LOW);

  Serial.println();
  Serial.println(F("=================================================="));
  Serial.println(F("   CHAN DOAN INA219 - BAN 2"));
  Serial.println(F("=================================================="));

  // ---------------- BUOC 1 ----------------
  Serial.println();
  Serial.println(F("BUOC 1: Do dien tro keo len tren 2 chan"));
  Serial.println(F("--------------------------------------------------"));

  coPullupSDA = kiemTraPullup(SDA_PIN);
  coPullupSCL = kiemTraPullup(SCL_PIN);

  Serial.print(F("  GPIO21 (SDA): "));
  Serial.println(coPullupSDA ? F("CO dien tro keo len  -> co thiet bi cam vao")
                             : F("KHONG co               -> trong khong!"));
  Serial.print(F("  GPIO22 (SCL): "));
  Serial.println(coPullupSCL ? F("CO dien tro keo len  -> co thiet bi cam vao")
                             : F("KHONG co               -> trong khong!"));

  // ---------------- BUOC 2 & 3 ----------------
  Serial.println();
  Serial.println(F("BUOC 2 & 3: Quet bus I2C"));
  Serial.println(F("--------------------------------------------------"));

  soThietBiThuong = quetBus(SDA_PIN, SCL_PIN, "(dung so do)");
  soThietBiDao    = quetBus(SCL_PIN, SDA_PIN, "(thu dao nguoc)");

  // ---------------- KET LUAN ----------------
  Serial.println();
  Serial.println(F("=================================================="));
  Serial.println(F("   KET LUAN"));
  Serial.println(F("=================================================="));

  if (soThietBiThuong > 0) {
    Serial.println(F("  PHAN CUNG OK! Da tim thay INA219 dung so do."));
    Serial.print  (F("  Dia chi: 0x"));
    Serial.println(diaChiTimDuoc, HEX);
    if (diaChiTimDuoc != 0x40) {
      Serial.println(F("  LUU Y: dia chi khac 0x40 -> bao Claude sua firmware."));
    } else {
      Serial.println(F("  Dia chi mac dinh, firmware khong can sua."));
    }
  }
  else if (soThietBiDao > 0) {
    Serial.println(F("  >>> BAN CAM NGUOC SDA VA SCL <<<"));
    Serial.println(F("  Hay doi cho 2 day nay:"));
    Serial.println(F("     day dang o GPIO21  ->  chuyen sang GPIO22"));
    Serial.println(F("     day dang o GPIO22  ->  chuyen sang GPIO21"));
    Serial.println(F("  Doi xong bam nut EN de chay lai, khong can nap lai."));
  }
  else if (!coPullupSDA && !coPullupSCL) {
    Serial.println(F("  >>> CA 2 CHAN DEU TRONG KHONG <<<"));
    Serial.println(F("  ESP32 khong he thay gi cam vao GPIO21/GPIO22."));
    Serial.println();
    Serial.println(F("  Kiem tra theo thu tu nay:"));
    Serial.println(F("   1. Module INA219 CO DIEN chua?"));
    Serial.println(F("      Dung dong ho do giua chan VCC va GND cua module,"));
    Serial.println(F("      phai ra khoang 3.3V. Neu 0V -> day nguon chua toi."));
    Serial.println(F("   2. VCC cua module da noi vao chan 3V3 cua ESP32 chua?"));
    Serial.println(F("   3. GND cua module da noi GND CHUNG chua?"));
    Serial.println(F("   4. Chan header cua module DA HAN THIEC chua?"));
    Serial.println(F("      Module ban ve thuong chua han san - chi cam khong thi"));
    Serial.println(F("      KHONG AN DIEN. Day la loi pho bien nhat."));
    Serial.println(F("   5. Thu doi day jumper khac (day dut ngam rat hay gap)."));
  }
  else {
    Serial.println(F("  >>> CO DIEN NHUNG KHONG TRA LOI <<<"));
    Serial.print  (F("  GPIO21: "));
    Serial.print  (coPullupSDA ? F("co keo len") : F("TRONG KHONG"));
    Serial.print  (F("   |   GPIO22: "));
    Serial.println(coPullupSCL ? F("co keo len") : F("TRONG KHONG"));
    Serial.println();
    Serial.println(F("  Mot trong hai day dang bi ho, hoac chip da hong."));
    Serial.println(F("  Kiem tra lai moi han cua chan bi TRONG KHONG o tren."));
  }

  Serial.println(F("=================================================="));
  Serial.println();
  Serial.println(F("Chup man hinh nay gui cho Claude."));
  Serial.println(F("Bam nut EN tren ESP32 de chan doan lai sau khi sua day."));
}


void loop() {
  // Khong lam gi - ket qua da in xong o tren.
  // Muon chan doan lai: bam nut EN (RST) tren board.
  delay(1000);
}
