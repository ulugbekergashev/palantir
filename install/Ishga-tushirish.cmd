@echo off
rem UTF-8: o'zbekcha matn buzilmasin
chcp 65001 >nul
rem Cerebro'ni fonda ishga tushiradi (allaqachon ishlayotgan bo'lsa - hech narsa qilmaydi).
wscript.exe "%~dp0cerebro-fon.vbs"
echo Cerebro ishga tushirildi. Panel - ish stolidagi "Cerebro" yorlig'i.
timeout /t 4 >nul
