@echo off
REM ================================================================
REM  VAST - Khoi dong server IoT va mo dashboard
REM  Chi can NHAY DUP vao file nay la xong.
REM ================================================================

title VAST IoT Server
color 0A

set "THUMUC=%~dp0server"

echo.
echo  ==============================================================
echo    VAST - HE THONG QUAN LY AO NUOI TOM THONG MINH
echo  ==============================================================
echo.

REM ---------------------------------------------------------------
REM  1) Kiem tra thu muc server co dung khong
REM ---------------------------------------------------------------
if not exist "%THUMUC%\index.js" (
    color 0C
    echo   [LOI] Khong tim thay file index.js
    echo.
    echo   Dang tim o: %THUMUC%
    echo.
    echo   File CHAY_SERVER.bat phai nam CUNG CAP voi thu muc
    echo   "vietnamaismart-main". Hay chep no ve dung cho.
    echo.
    pause
    exit /b 1
)

cd /d "%THUMUC%"

REM ---------------------------------------------------------------
REM  2) Kiem tra Node.js
REM ---------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    color 0C
    echo   [LOI] May chua cai Node.js
    echo.
    echo   Vao trang  nodejs.org  tai ban LTS ve cai,
    echo   cai xong DONG file nay lai roi mo lai.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set "NODEVER=%%v"
echo   Node.js       : %NODEVER%

REM ---------------------------------------------------------------
REM  3) Lan dau chay thi tu dang ky thiet bi
REM ---------------------------------------------------------------
if not exist "data\vast.db" (
    if not exist "data\vast.json" (
        echo   Database      : chua co, dang tao moi...
        echo.
        echo  --------------------------------------------------------------
        node tools\seed.js
        echo  --------------------------------------------------------------
        echo.
        echo   ^>^> NHO copy device_token o tren vao file:
        echo      esp32_vast\config.h
        echo.
        pause
    )
) else (
    echo   Database      : da co san
)

REM ---------------------------------------------------------------
REM  4) In cac dia chi IP de tien dien vao config.h cua ESP32
REM ---------------------------------------------------------------
echo.
echo   Dia chi IP cua may nay:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    echo      %%a
)
echo.
echo   ^>^> Neu ESP32 bao loi ket noi, hay lay so IP cua card Wi-Fi
echo      o tren dien vao  esp32_vast\config.h  ^(dong SERVER_URL^)
echo      roi nap lai ESP32.
echo.

REM ---------------------------------------------------------------
REM  5) Hen gio mo trinh duyet sau 3 giay
REM ---------------------------------------------------------------
start "" cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:3000/dashboard.html"

echo  ==============================================================
echo    Dang khoi dong server... Trinh duyet se tu mo sau 3 giay.
echo.
echo    Muon DUNG server: bam Ctrl + C, hoac dong cua so nay.
echo    KHONG duoc dong cua so nay khi dang demo!
echo  ==============================================================
echo.

REM ---------------------------------------------------------------
REM  6) Chay server
REM ---------------------------------------------------------------
node index.js

REM ---------------------------------------------------------------
REM  7) Neu server thoat (loi hoac bam Ctrl+C) thi giu cua so lai
REM ---------------------------------------------------------------
echo.
color 0E
echo  ==============================================================
echo    SERVER DA DUNG.
echo.
echo    Neu la do LOI, hay doc thong bao mau o tren.
echo    Loi hay gap nhat: cong 3000 dang bi chuong trinh khac dung
echo    ^(co the ban da mo san mot cua so server khac roi^).
echo  ==============================================================
echo.
pause
