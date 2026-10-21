@echo off
rem UTF-8: o'zbekcha matn buzilmasin
chcp 65001 >nul
rem Palantir'ni fonda ishga tushiradi (allaqachon ishlayotgan bo'lsa - hech narsa qilmaydi).
wscript.exe "%~dp0palantir-fon.vbs"
echo Palantir ishga tushirildi. Panel - ish stolidagi "Palantir" yorlig'i.
timeout /t 4 >nul
