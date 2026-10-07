@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem Gelistirme modu: backend ve frontend ayri pencerelerde baslar, tarayici acilir.
start "FinAnaliz Backend" cmd /k python backend\run_desktop.py --no-window
start "FinAnaliz Frontend" cmd /k "cd frontend && npm run dev"

timeout /t 5 /nobreak >nul
start http://localhost:5173
