@echo off
chcp 65001 >nul
title TradeMetrix - exe derleme
cd /d "%~dp0"

tasklist /FI "IMAGENAME eq TradeMetrix.exe" | find /I "TradeMetrix.exe" >nul && (echo Once acik olan TradeMetrix uygulamasini kapatin. & pause & exit /b 1)
tasklist /FI "IMAGENAME eq FinAnaliz.exe" | find /I "FinAnaliz.exe" >nul && (echo Once eski FinAnaliz uygulamasini kapatin. & pause & exit /b 1)

echo [1/3] Python paketleri kontrol ediliyor...
python -m pip install -q -r backend\requirements.txt pyinstaller || (echo Paket kurulumu basarisiz. & pause & exit /b 1)

echo [2/3] Arayuz derleniyor...
pushd frontend
if not exist node_modules call npm install
call npm run build || (popd & echo Arayuz derlenemedi. & pause & exit /b 1)
popd

echo [3/3] TradeMetrix.exe olusturuluyor...
set "BUILD=%TEMP%\finanaliz-build"
pushd backend
python -m PyInstaller --noconfirm --windowed --name TradeMetrix --icon "%~dp0backend\trademetrix.ico" ^
  --add-data "%~dp0frontend\dist;frontend\dist" --add-data "%~dp0backend\app\data;app\data" ^
  --collect-submodules uvicorn --collect-all curl_cffi --collect-data yfinance --hidden-import app.main ^
  --hidden-import pystray._win32 --collect-all windows_toasts --collect-all winrt --hidden-import pypdf --hidden-import scipy.stats --hidden-import segno --exclude-module torch --exclude-module pytest --exclude-module matplotlib --exclude-module IPython ^
  --distpath "%BUILD%\dist" --workpath "%BUILD%\work" --specpath "%BUILD%" "%~dp0backend\desktop_app.py" || (popd & echo Derleme basarisiz. & pause & exit /b 1)
popd

robocopy "%BUILD%\dist\TradeMetrix" "Uygulama" /MIR /NFL /NDL /NJH /NJS >nul
echo.
echo Tamamlandi: Uygulama\TradeMetrix.exe
pause
