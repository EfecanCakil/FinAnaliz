@echo off
chcp 65001 >nul
title TradeMetrix - testler
cd /d "%~dp0backend"
python -m pip install -q pytest
python -m pytest tests -q -W ignore
pause
