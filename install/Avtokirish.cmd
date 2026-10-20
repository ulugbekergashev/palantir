@echo off
rem UTF-8: o'zbekcha matn buzilmasin
chcp 65001 >nul
rem Svet o'chib-yonganda Cerebro o'zi ishga tushsin: Windows shu foydalanuvchi bilan o'zi kiradi va ekranni qulflaydi.
rem O'chirish: Avtokirish.cmd -Off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0avtokirish.ps1" %*
