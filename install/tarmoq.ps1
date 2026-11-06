# Palantir panelini klinika ichidagi tarmoqqa ochadi (DentaLocal kabi): qabulxonadagi boshqa kompyuterlar uni server kompyuterining
# ichki manzili bilan ochadi (http://192.168.1.10:3200) - internetsiz, Hub'siz, ma'lumot klinikadan chiqmaydi.
# ornatish.ps1 chaqiradi; avvalgi o'rnatishda bir marta alohida (administrator sifatida):
#   install\Tarmoq.cmd          - yoqish
#   install\Tarmoq.cmd -Off     - o'chirish: panel yana faqat shu kompyuterdan ochiladi
# Nima qiladi: .env da LISTEN_HOST=0.0.0.0 va Windows brandmauerida qoida - faqat Node.js, faqat panel porti, faqat ichki tarmoqdan
# (LocalSubnet). Server o'zi ham faqat ichki tarmoqdan qabul qiladi (server/lan.ts). Administrator huquqi bo'lmasa - hech narsa
# o'zgarmaydi (qoidasiz ochilgan port Windows so'rovini chiqarardi yoki boshqa kompyuterlar baribir ulanmasdi).
# Bu faylda faqat ASCII belgilar: PowerShell 5.1 boshqa belgilarni buzib o'qiydi.
param([switch]$Off, [switch]$NoRestart)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$RuleName = 'Palantir-Panel'
$TaskName = 'Palantir'
$EnvFile = Join-Path $Root '.env'
$Admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Note([string]$text) { Write-Host "   $text" }
function Warn([string]$text) { Write-Host "   ! $text" -ForegroundColor Yellow }
function Fail([string]$text) { Write-Host "   X $text" -ForegroundColor Red; exit 1 }
function Read-EnvValue([string]$name) {
  if (-not (Test-Path $EnvFile)) { return '' }
  $values = @(Get-Content $EnvFile | Where-Object { $_ -match "^\s*$name\s*=" } | ForEach-Object { ($_ -replace "^\s*$name\s*=", '').Trim() })
  if (-not $values.Count) { return '' }
  return $values[-1]
}
# LISTEN_HOST qatori (va uning ustidagi o'rnatgich izohi) yangisi bilan almashadi; yo'q bo'lsa - oxiriga qo'shiladi
function Set-ListenHost([string]$value, [string]$comment) {
  $lines = @()
  if (Test-Path $EnvFile) { $lines = @([IO.File]::ReadAllLines($EnvFile)) }
  $kept = @($lines | Where-Object { $_ -notmatch '^\s*LISTEN_HOST\s*=' -and $_ -notmatch '^\s*#\s*(Faqat shu kompyuterdan ochiladi|Klinika ichidagi tarmoq)' })
  $kept += @("# $comment", "LISTEN_HOST=$value")
  # BOM'siz UTF-8: Node .env ni shunday o'qiydi
  [IO.File]::WriteAllLines($EnvFile, [string[]]$kept, (New-Object Text.UTF8Encoding($false)))
}
function Restart-Palantir {
  if ($NoRestart -or -not (Get-Command node -ErrorAction SilentlyContinue)) { return }
  node scripts\supervise.mjs stop | Out-Null
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName $TaskName }
  else { Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList "`"$(Join-Path $PSScriptRoot 'palantir-fon.vbs')`"" }
  Note 'Palantir qayta ishga tushirildi'
}

if (-not (Test-Path $EnvFile)) { Fail ".env topilmadi ($EnvFile) - avval install\Ornatish.cmd" }
$port = Read-EnvValue 'PORT'
if (-not $port) { $port = '3200' }

if ($Off) {
  Step 'Panel faqat shu kompyuterdan'
  if ($Admin) { Remove-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue; Note "Brandmauer qoidasi olib tashlandi" }
  else { Warn "Brandmauer qoidasi qoldi (administrator huquqi kerak) - u faqat ichki tarmoqqa, zararsiz" }
  Set-ListenHost '127.0.0.1' 'Faqat shu kompyuterdan ochiladi. Klinika ichidagi tarmoqqa ochish: install\Tarmoq.cmd'
  Note '.env: LISTEN_HOST=127.0.0.1'
  Restart-Palantir
  exit 0
}

Step 'Panel klinika ichidagi tarmoqqa'
if (-not $Admin) {
  Warn "Administrator huquqi kerak (brandmauer qoidasi). Tarmoq.cmd ustida o'ng tugma -> 'Administrator sifatida ishga tushirish'."
  Warn 'Hozircha panel faqat shu kompyuterdan va Hub havolasi orqali ochiladi.'
  exit 2
}
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail 'Node.js topilmadi - avval install\Ornatish.cmd' }
# Qoida qayta yaratiladi: Node.js yangilangan yoki port o'zgargan bo'lsa ham to'g'ri bo'lsin
Remove-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue
New-NetFirewallRule -Name $RuleName -DisplayName "Palantir panel (klinika tarmog'i, TCP $port)" -Direction Inbound -Protocol TCP -LocalPort $port `
  -Program $node -RemoteAddress LocalSubnet -Profile Any -Action Allow | Out-Null
Note "Brandmauer: TCP $port faqat ichki tarmoqdan (Node.js uchun)"
Set-ListenHost '0.0.0.0' "Klinika ichidagi tarmoq: boshqa kompyuterlar panelni shu kompyuterning ichki manzili bilan ochadi. O'chirish: install\Tarmoq.cmd -Off"
Note '.env: LISTEN_HOST=0.0.0.0'
Restart-Palantir

# Ko'rsatiladigan manzillar: virtual (WSL, Hyper-V, VirtualBox) va avtomatik (169.254) manzillarsiz - server/lan.ts dagi kabi
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
  $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback'
} | ForEach-Object { $_.IPAddress })
if ($ips.Count) { foreach ($ip in $ips) { Note "Qabulxonadagi boshqa kompyuterda brauzerda oching: http://$($ip):$port" } }
else { Warn "Bu kompyuter hali tarmoqqa ulanmagan - manzil panelda: Sozlamalar -> Xodimlar kirishi" }
Note "Manzil o'zgarmasligi uchun routerda shu kompyuterga doimiy IP bering (DHCP rezervatsiya)."
