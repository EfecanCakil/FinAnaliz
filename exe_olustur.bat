@echo off
chcp 65001 >nul
title FinAnaliz - exe derleme
cd /d "%~dp0"

tasklist /FI "IMAGENAME eq FinAnaliz.exe" | find /I "FinAnaliz.exe" >nul && (echo Once acik olan FinAnaliz uygulamasini kapatin. & pause & exit /b 1)

echo [1/3] Python paketleri kontrol ediliyor...
python -m pip install -q -r backend\requirements.txt pyinstaller || (echo Paket kurulumu basarisiz. & pause & exit /b 1)

echo [2/3] Arayuz derleniyor...
pushd frontend
if not exist node_modules call npm install
call npm run build || (popd & echo Arayuz derlenemedi. & pause & exit /b 1)
popd

echo [3/3] FinAnaliz.exe olusturuluyor...
set "BUILD=%TEMP%\finanaliz-build"
pushd backend
python -m PyInstaller --noconfirm --windowed --name FinAnaliz --icon "%~dp0backend\finanaliz.ico" ^
  --add-data "%~dp0frontend\dist;frontend\dist" --add-data "%~dp0backend\app\data;app\data" ^
  --collect-submodules uvicorn --collect-all curl_cffi --collect-data yfinance --hidden-import app.main ^
  --hidden-import pystray._win32 --collect-all windows_toasts --collect-all winrt --exclude-module torch --exclude-module matplotlib --exclude-module IPython ^
  --distpath "%BUILD%\dist" --workpath "%BUILD%\work" --specpath "%BUILD%" "%~dp0backend\desktop_app.py" || (popd & echo Derleme basarisiz. & pause & exit /b 1)
popd

robocopy "%BUILD%\dist\FinAnaliz" "Uygulama" /MIR /NFL /NDL /NJH /NJS >nul
echo.
echo Tamamlandi: Uygulama\FinAnaliz.exe
pause
