# Telefon xizmatini MASOFADAN o'rnatish uchun Windows vazifasi "PalantirTelefon" (Palantir Hub -> mijoz kartasi -> "Telefon xizmatini o'rnatish").
#   install\telefon-vazifa.ps1           - vazifani yaratadi (yoki yangilaydi)
#   install\telefon-vazifa.ps1 -Remove   - olib tashlaydi
# Nega kerak: telefon xizmati (WSL, brandmauer) administrator huquqini talab qiladi, Palantir esa oddiy huquq bilan ishlaydi va o'ziga
#   bu huquqni bera olmaydi (Windows ekranda "Ha / Yo'q" deb so'raydi - klinikada uni bosadigan odam kerak bo'lardi). Bu vazifa o'rnatish
#   paytida (administrator huquqi bor payt) bir marta yaratiladi: "eng yuqori huquq bilan", shu foydalanuvchi nomidan, Windows'ga
#   kirmasdan (S4U - parol saqlanmaydi). Vaqti (triggeri) yo'q: uni faqat Palantir serveri so'rov bilan ishga tushiradi
#   (server\voice\phoneInstall.ts: schtasks /run) - ekranda hech narsa ochilmaydi, hech kim hech narsa bosmaydi.
# Vazifa faqat bitta ishni qiladi: install\telefon.ps1 -Remote. Unga tashqaridan hech qanday parametr berilmaydi.
# Chaqiradi: install\ornatish.ps1 (yangi o'rnatish) va install\telefon.ps1 (telefon xizmati shu kompyuterda qo'lda o'rnatilganda).
# Bu faylda faqat ASCII belgilar: PowerShell 5.1 boshqa belgilarni buzib o'qiydi (scripts/check-install.ts tekshiradi).
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$TaskName = 'PalantirTelefon'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host '   ! Administrator huquqi kerak - vazifa yaratilmadi' -ForegroundColor Yellow; exit 1 }

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
  exit 0
}

$me = "$($env:USERDOMAIN)\$($env:USERNAME)"
$powershell = Join-Path $env:windir 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script = Join-Path $PSScriptRoot 'telefon.ps1'
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`" -Remote" -WorkingDirectory $Root
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType S4U -RunLevel Highest
# Ikki marta bosilsa ikkinchi nusxa yonmaydi; qotib qolsa 2 soatda to'xtatiladi (o'rnatish odatda 5-15 daqiqa)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings `
  -Description 'Palantir: telefon xizmatini masofadan ornatish (install\telefon-vazifa.ps1). Faqat Palantir sorovi bilan ishlaydi.' -Force | Out-Null
exit 0
