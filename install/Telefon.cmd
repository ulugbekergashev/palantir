@echo off
rem UTF-8: o'zbekcha matn buzilmasin
chcp 65001 >nul
rem Ovoz xizmati (panel ovozi, "Quloq", AI qabulxona) va telefon liniyasini (WSL ichida Asterisk) o'rnatadi.
rem -OnlyVoice - faqat ovoz xizmati.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0telefon.ps1" %*
echo.
pause
