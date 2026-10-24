@echo off
title OrderSender - Server Locale di Test
cd /d "%~dp0"
cls
echo ======================================================================
echo           ORDER SENDER - AMBIENTE DI TEST LOCALE
echo ======================================================================
echo.
echo Avvio del server locale in corso...
echo.
timeout /t 2 /nobreak >nul
start http://localhost:8080/gestione-ordini.html
python scripts\dev-server.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Impossibile avviare con Python. Provo con server alternativo...
    cd site
    python -m http.server 8080
)
pause
