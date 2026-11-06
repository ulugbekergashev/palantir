@echo off
rem UTF-8: o'zbekcha matn buzilmasin
chcp 65001 >nul
rem Panelni klinika ichidagi tarmoqqa ochadi: qabulxonadagi boshqa kompyuterlar uni shu kompyuterning ichki manzili bilan ochadi.
rem Administrator sifatida ishga tushiring. -Off - yana faqat shu kompyuterdan.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tarmoq.ps1" %*
echo.
pause
