# Qabulxonadagi boshqa kompyuterni (stansiya) Palantir'ga ulaydi: shu kompyuterdagi MicroSIP qo'ng'iroqlari va yozuvlari
# serverga boradi, paneldagi "Kompyuterdan qo'ng'iroq" shu yerdagi MicroSIP'da teriladi. Palantir server bu yerga O'RNATILMAYDI.
#   install\Stansiya.cmd                                   - server manzili va kodni so'raydi
#   install\Stansiya.cmd -Server http://192.168.1.10:3200 -Code ABCD2345
#   install\Stansiya.cmd -Overwrite                        - MicroSIP boshqa dasturga (DentaCRM) ulangan bo'lsa ham
#   install\Stansiya.cmd -Uninstall                        - MicroSIP avvalgi holiga, yordamchi o'chadi
# Kod: panel -> Sozlamalar -> Telefon -> "Kompyuter qo'shish" (30 daqiqa amal qiladi, bir marta).
# Qadamlar: yordamchi papkasi (%ProgramData%, faqat shu foydalanuvchi va administratorlar) -> yordamchini yig'ish (Windows'dagi
# csc.exe) -> kodni kalitga almashtirish -> MicroSIP'ni sozlash (yopib, sozlab, qayta ochadi) -> avtoyuklash va fondagi yordamchi.
# MicroSIP'ni ishlatadigan foydalanuvchi nomidan (administrator emas) ishga tushiring: sozlama uning papkasida.
# Bu faylda faqat ASCII belgilar: PowerShell 5.1 boshqa belgilarni buzib o'qiydi.
param([string]$Server = '', [string]$Code = '', [switch]$Overwrite, [switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $Root 'server\phone\hook\PalantirCall.cs'
$Dir = Join-Path $env:ProgramData 'Palantir-stansiya'
$Exe = Join-Path $Dir 'palantir-call.exe'
$LogFile = Join-Path $Dir 'stansiya.log'

function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Note([string]$text) { Write-Host "   $text" }
function Fail([string]$text) { Write-Host "   X $text" -ForegroundColor Red; exit 1 }

# Yordamchining o'zi oynasiz dastur: natija kodi va jurnalning oxirgi satri
function Invoke-Helper([string[]]$arguments) {
  $before = if (Test-Path $LogFile) { (Get-Content $LogFile).Count } else { 0 }
  $p = Start-Process -FilePath $Exe -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  $lines = if (Test-Path $LogFile) { @(Get-Content $LogFile -Encoding UTF8 | Select-Object -Skip $before) } else { @() }
  foreach ($l in $lines) { Note ($l -replace '^\S+ \S+ ', '') }
  return $p.ExitCode
}

if ($Uninstall) {
  Step 'Yordamchini olib tashlash'
  if (-not (Test-Path $Exe)) { Note "Yordamchi o'rnatilmagan"; exit 0 }
  if ((Invoke-Helper @('remove')) -ne 0) { Fail "MicroSIP qaytarilmadi - jurnal: $LogFile" }
  Note "Papka qoldi (jurnal va yuborilmagan yozuvlar): $Dir"
  exit 0
}

Step 'Yordamchi papkasi'
if (-not (Test-Path $Source)) { Fail "Yordamchi manbasi topilmadi: $Source (Palantir papkasidan ishga tushiring)" }
if ($Dir -match '\s') { Fail "Papka yo'lida bo'sh joy bor - MicroSIP uni ishga tushirmaydi: $Dir" }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
# Meros ruxsatlar olib tashlanadi: boshqa foydalanuvchilar bu yerga o'z dasturini qo'ya olmasin (MicroSIP uni ishga tushirardi)
$user = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
& (Join-Path $env:SystemRoot 'System32\icacls.exe') $Dir /inheritance:r /grant:r "*S-1-3-4:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*${user}:(OI)(CI)F" /Q | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Papka ruxsatlarini o'rnatib bo'lmadi: $Dir" }
Note $Dir

Step "Yordamchini yig'ish"
$csc = @(
  (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { Fail '.NET Framework 4 kompilyatori (csc.exe) topilmadi' }
# Ishlab turgan eski nusxa almashtirilishi uchun to'xtatiladi
Get-Process palantir-call -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$tmp = "$Exe.tmp.exe"
& $csc /nologo /target:winexe /optimize+ /platform:anycpu "/out:$tmp" $Source | Out-Host
if ($LASTEXITCODE -ne 0) { Fail "Yordamchi yig'ilmadi" }
Move-Item -Force $tmp $Exe
Note $Exe

Step 'Palantir serveriga ulash'
$config = Join-Path $Dir 'palantir-stansiya.ini'
$paired = (Test-Path $config) -and (Select-String -Path $config -Pattern '^token=' -Quiet)
if (-not $paired -or $Code) {
  if (-not $Server) { $Server = Read-Host '   Server manzili (masalan http://192.168.1.10:3200 yoki https://hub.../c/...)' }
  if (-not $Code) { $Code = Read-Host "   Paneldagi kod (Sozlamalar -> Telefon -> Kompyuter qo'shish)" }
  if ((Invoke-Helper @('pair', $Server.Trim(), $Code.Trim())) -ne 0) { Fail "Ulanmadi - kod va manzilni tekshiring (kod 30 daqiqa amal qiladi)" }
} else {
  Note 'Avval ulangan - kalit joyida'
}

Step "MicroSIP'ni sozlash"
Note "MicroSIP qisqa vaqtga yopilib, qayta ochiladi"
$setupArgs = @('setup')
if ($Overwrite) { $setupArgs += '--overwrite' }
if ((Invoke-Helper $setupArgs) -ne 0) { Fail "MicroSIP sozlanmadi - yuqoridagi sababni o'qing" }

Write-Host ''
Write-Host "Tayyor. Panelda (Sozlamalar -> Telefon) bu kompyuter 'aloqada' bo'lib ko'rinadi." -ForegroundColor Green
