@echo off
chcp 65001 >nul
title TradeMetrix Tanitim - exe derleme
rem Deney sonuclarini guncellemek icin sonuclar.js dosyasini silip bu betigi yeniden calistirin.
cd /d "%~dp0"

echo [1/3] Python paketleri kontrol ediliyor...
python -m pip install -q pywebview pyinstaller || (echo Paket kurulumu basarisiz. & pause & exit /b 1)

echo [2/3] Kaynak kodlar toplaniyor...
python "%~dp0kod_topla.py" || (echo Kod toplama basarisiz. & pause & exit /b 1)

if not exist "%~dp0sonuclar.js" (
  echo Deney sonuclari uretiliyor (internet gerekir, 1-2 dakika surer^)...
  python "%~dp0sonuc_uret.py" || echo Uyari: deney sonuclari uretilemedi, sunumda bu bolum bos kalacak.
)
if not exist "%~dp0sonuclar.js" echo window.SONUC = null;> "%~dp0sonuclar.js"

echo [3/3] TradeMetrix_Tanitim.exe olusturuluyor...
set "BUILD=%TEMP%\trademetrix-tanitim-build"
python -m PyInstaller --noconfirm --onefile --windowed --name TradeMetrix_Tanitim --icon "%~dp0..\backend\trademetrix.ico" ^
  --add-data "%~dp0tanitim.html;." --add-data "%~dp0ekler.js;." --add-data "%~dp0kod.js;." --add-data "%~dp0sonuclar.js;." --add-data "%~dp0ekran;ekran" ^
  --exclude-module numpy --exclude-module pandas --exclude-module matplotlib --exclude-module IPython --exclude-module torch ^
  --distpath "%~dp0" --workpath "%BUILD%\work" --specpath "%BUILD%" "%~dp0tanitim_app.py" || (echo Derleme basarisiz. & pause & exit /b 1)

echo.
copy /Y "%~dp0TradeMetrix_Tanitim.exe" "%USERPROFILE%\OneDrive\Desktop\" >nul 2>&1 || copy /Y "%~dp0TradeMetrix_Tanitim.exe" "%USERPROFILE%\Desktop\" >nul
echo Tamamlandi: tanitim\TradeMetrix_Tanitim.exe (masaustune de kopyalandi)
pause
