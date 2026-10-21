@echo off
rem UTF-8: o'zbekcha matn buzilmasin
chcp 65001 >nul
rem Qabulxonadagi boshqa kompyuterni Palantir'ga ulaydi (MicroSIP qo'ng'iroqlari va yozuvlari serverga, "Kompyuterdan qo'ng'iroq").
rem Parametrlar: -Server <manzil> -Code <kod> | -Overwrite | -Uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stansiya.ps1" %*
echo.
pause
