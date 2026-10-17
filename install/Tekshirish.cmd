@echo off
rem UTF-8: o'zbekcha matn buzilmasin
chcp 65001 >nul
rem Kalitlar va sozlamalarni haqiqiy xizmatlarda tekshiradi (Telegram, Claude, ovoz, papka, port).
cd /d "%~dp0.."
call npm run --silent check
echo.
pause
