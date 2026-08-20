@echo off
REM ================================================================
REM  VAST - Gia lap ESP32 (dung khi CHUA cam mach that)
REM
REM  DUNG DE:  test giao dien web, tap demo truoc khi thi,
REM            hoac khi khong mang theo phan cung.
REM
REM  LUU Y:    PHAI chay CHAY_SERVER.bat truoc.
REM            KHONG chay file nay khi ESP32 that dang cam,
REM            hai ben se tranh nhau gui du lieu.
REM ================================================================

title VAST - Gia lap ESP32
color 0B

set "THUMUC=%~dp0server"

echo.
echo  ==============================================================
echo    VAST - GIA LAP ESP32
echo  ==============================================================
echo.

if not exist "%THUMUC%\simulate_esp32.js" (
    color 0C
    echo   [LOI] Khong tim thay simulate_esp32.js
    echo   Dang tim o: %THUMUC%
    echo.
    pause
    exit /b 1
)

cd /d "%THUMUC%"

where node >nul 2>&1
if errorlevel 1 (
    color 0C
    echo   [LOI] May chua cai Node.js. Vao nodejs.org tai ban LTS.
    echo.
    pause
    exit /b 1
)

if not exist "data\vast.db" (
    if not exist "data\vast.json" (
        color 0C
        echo   [LOI] Chua co database.
        echo   Hay chay CHAY_SERVER.bat truoc it nhat mot lan.
        echo.
        pause
        exit /b 1
    )
)

echo   Dang gia lap thiet bi ESP32_POND_01
echo.
echo   PHIM DIEU KHIEN:
echo      q  =  giam DO        ^(thu canh bao DO thap, bat guong oxy^)
echo      a  =  tang DO
echo      w  =  giam nhiet do
echo      s  =  tang nhiet do  ^(thu canh bao nhiet cao, bat may bom^)
echo.
echo      Ctrl + C  =  thoat
echo.
echo  ==============================================================
echo.

node simulate_esp32.js

echo.
color 0E
echo  ==============================================================
echo    DA DUNG GIA LAP.
echo  ==============================================================
echo.
pause
