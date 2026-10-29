@echo off
rem UTF-8: o'zbekcha matn buzilmasin
chcp 65001 >nul
rem Palantir'ni shu kompyuterga o'rnatadi: ikki marta bosing. Bitta savol beradi, qolgani o'zi.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\ornatish.ps1" %*
echo.
pause
