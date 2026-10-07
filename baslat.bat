@echo off
chcp 65001 >nul
title FinAnaliz - Finansal Analiz Platformu
cd /d "%~dp0"

where python >nul 2>nul || (echo Python bulunamadi. https://www.python.org adresinden Python 3.11+ kurun. & pause & exit /b 1)

if not exist "backend\data\.kurulum-tamam" (
    echo [1/2] Python paketleri kuruluyor...
    python -m pip install -r backend\requirements.txt || (echo Paket kurulumu basarisiz. & pause & exit /b 1)
    if not exist "backend\data" mkdir "backend\data"
    echo ok> "backend\data\.kurulum-tamam"
)

if not exist "frontend\dist\index.html" (
    where npm >nul 2>nul || (echo Arayuz derlenmemis ve Node.js bulunamadi. https://nodejs.org adresinden Node.js kurun. & pause & exit /b 1)
    echo [2/2] Arayuz derleniyor...
    pushd frontend
    call npm install || (popd & echo npm install basarisiz. & pause & exit /b 1)
    call npm run build || (popd & echo Derleme basarisiz. & pause & exit /b 1)
    popd
)

echo FinAnaliz baslatiliyor...
python backend\run_desktop.py
pause
