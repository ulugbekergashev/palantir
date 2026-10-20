@echo off
rem UTF-8: o'zbekcha matn buzilmasin
chcp 65001 >nul
rem Palantir'ni shu kompyuterga o'rnatadi: ikki marta bosing.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ornatish.ps1" %*
echo.
pause
