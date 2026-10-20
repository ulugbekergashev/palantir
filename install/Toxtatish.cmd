@echo off
rem UTF-8: o'zbekcha matn buzilmasin
chcp 65001 >nul
rem Palantir'ni tinch to'xtatadi (yozilayotgan narsa oxiriga yetadi).
cd /d "%~dp0.."
node scripts\supervise.mjs stop
timeout /t 4 >nul
