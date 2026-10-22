# Palantir'ni klinika kompyuteriga o'rnatadi (Windows 10/11, PowerShell 5.1).
#   Ornatish.cmd                  - o'rnatish (yoki yangilangan dasturni qayta yig'ish). Bitta savol beradi, qolgani o'zi
#   Ornatish.cmd -Klinika         - savolsiz: kompyuter klinikada kecha-kunduz yoqiq (avtomatik kirish, uyqusiz)
#   Ornatish.cmd -Shaxsiy         - savolsiz: oddiy kompyuter (avtomatik kirish va quvvat sozlamalariga tegilmaydi)
#   Ornatish.cmd -Papka D:\Baza   - ma'lumotlar papkasi (standart C:\PalantirData; faqat birinchi o'rnatishda)
#   Ornatish.cmd -Uninstall       - avtoyuklashdan olib tashlash va to'xtatish (ma'lumotlar o'chmaydi; avtomatik kirish o'chiriladi)
# Qadamlar: Node.js va ffmpeg -> kutubxonalar -> panelni yig'ish -> .env -> ovoz xizmati -> tekshiruv -> avtoyuklash -> ishga tushirish.
# Telefon liniyasi (AI qabulxona shahar raqamida) bu yerda o'rnatilmaydi: Uztelecom SIP ma'lumotlari kelganda - install\Telefon.cmd
# Bu faylda faqat ASCII belgilar: PowerShell 5.1 boshqa belgilarni buzib o'qiydi.
param([switch]$Uninstall, [switch]$Klinika, [switch]$Shaxsiy, [string]$Papka = '')

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$MinNode = 24
$DefaultData = 'C:\PalantirData'
$DefaultPort = 3200
$Startup = [Environment]::GetFolderPath('Startup')
$Desktop = [Environment]::GetFolderPath('Desktop')
$StartupLink = Join-Path $Startup 'Palantir.lnk'
# Dastur avval Cerebro deb atalgan (eski nom): o'sha nomdagi yorliqlar qolsa, ikkita yorliq turadi
$OldStartupLink = Join-Path $Startup 'Cerebro.lnk' # eski nom
$OldPanelLinks = @('Cerebro AI.lnk', 'Cerebro.url') # eski nom
$Launcher = Join-Path $PSScriptRoot 'palantir-fon.vbs'
$AutoLogon = Join-Path $PSScriptRoot 'avtokirish.ps1'
$Winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$Me = "$($env:USERDOMAIN)\$($env:USERNAME)"

# Windows shu foydalanuvchi bilan o'zi kiradimi (install\avtokirish.ps1 yoqgan)
function AutoLogon-Mine {
  $w = Get-ItemProperty -Path $Winlogon -ErrorAction SilentlyContinue
  return ($w.AutoAdminLogon -eq '1' -and $w.DefaultUserName -eq $env:USERNAME)
}

function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Note([string]$text) { Write-Host "   $text" }
function Warn([string]$text) { Write-Host "   ! $text" -ForegroundColor Yellow }
function Fail([string]$text) { Write-Host "   X $text" -ForegroundColor Red; exit 1 }

# npm va node xato kodi bilan tugasa - to'xtaymiz (PowerShell 5.1 buni o'zi sezmaydi)
function Run([string]$what, [scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { Fail "$what bajarilmadi (kod $LASTEXITCODE). Yuqoridagi xabarni o'qing va qayta urining." }
}

function New-Password([int]$length) {
  # O'qishda adashtiradigan belgilarsiz (0/O, 1/l/I)
  $alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] $length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

# Papka yoki faylni faqat shu Windows foydalanuvchisi (hamda tizim va administratorlar) ocha oladigan qiladi.
# C:\ ostida yaratilgan papkani odatda kompyuterdagi HAMMA foydalanuvchi o'qiy va o'zgartira oladi - u yerda baza, maxfiy kalit va jurnal turadi.
function Protect-Path([string]$path, [bool]$isFolder) {
  $me = "$($env:USERDOMAIN)\$($env:USERNAME)"
  $right = 'F'
  if ($isFolder) { $right = '(OI)(CI)F' }
  # S-1-5-18 - tizim, S-1-5-32-544 - administratorlar (nomi Windows tiliga bog'liq, shuning uchun raqami bilan)
  icacls $path /inheritance:r /grant:r "${me}:$right" "*S-1-5-18:$right" "*S-1-5-32-544:$right" | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Node-Major {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
  return [int]((node -v) -replace '^v(\d+)\..*$', '$1')
}

function Read-EnvValue([string]$name) {
  if (-not (Test-Path '.env')) { return '' }
  $line = Get-Content '.env' | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if (-not $line) { return '' }
  return ($line -replace "^\s*$name\s*=", '').Trim()
}

# --- Olib tashlash -----------------------------------------------------------
if ($Uninstall) {
  Step "Palantir'ni to'xtatish va avtoyuklashdan olib tashlash"
  if (Get-Command node -ErrorAction SilentlyContinue) { node scripts\supervise.mjs stop }
  foreach ($startupFile in $StartupLink, $OldStartupLink) {
    if (Test-Path $startupFile) { Remove-Item $startupFile -Force -Confirm:$false; Note "Avtoyuklash yorlig'i o'chirildi" }
  }
  if (AutoLogon-Mine) {
    Note "Avtomatik kirish o'chirilmoqda (administrator huquqi so'raladi)..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File $AutoLogon -Off
    if ($LASTEXITCODE -ne 0) { Warn "Avtomatik kirish o'chirilmadi. Keyinroq: install\Avtokirish.cmd -Off" }
  }
  foreach ($name in @('Palantir AI.lnk') + $OldPanelLinks) {
    $panelLink = Join-Path $Desktop $name
    if (Test-Path $panelLink) { Remove-Item $panelLink -Force -Confirm:$false }
  }
  Note "Tayyor. Ma'lumotlar (baza, ikkinchi miya, zaxira nusxalar) joyida qoldi: $(Read-EnvValue 'DATA_DIR')"
  exit 0
}

# --- Yagona savol ------------------------------------------------------------
# Klinikadagi kompyuter kecha-kunduz yoqiq turadi: svet o'chib-yonganda Windows o'zi kiradi (ekran qulflanadi) va kompyuter uxlamaydi.
# Oddiy (shaxsiy) kompyuterda bularga tegilmaydi. Qolgan hamma narsa savolsiz: o'rnatuvchi oynani qoldirib keta oladi.
if ($Klinika -and $Shaxsiy) { Fail '-Klinika va -Shaxsiy dan bittasini bering' }
$alwaysOn = [bool]$Klinika
if (-not $Klinika -and -not $Shaxsiy) {
  Write-Host ''
  $answer = Read-Host "Bu kompyuter klinikada kecha-kunduz yoqiq turadimi? Unda svet o'chib-yonganda ham Palantir o'zi ishga tushadi va kompyuter uxlamaydi; Windows parolingiz bir marta so'raladi (h/y) [h]"
  $alwaysOn = $answer -notmatch '^[yY]'
}
Note "Qolgani savolsiz o'rnatiladi (internetga qarab 5-15 daqiqa). Oynani yopmang."

# --- 1. Node.js --------------------------------------------------------------
Step '1/7  Node.js va ffmpeg'
if ((Node-Major) -lt $MinNode) {
  if (Get-Command node -ErrorAction SilentlyContinue) { Warn "Node.js $(node -v) o'rnatilgan, $MinNode yoki yangirog'i kerak" } else { Warn "Node.js o'rnatilmagan" }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail "Node.js $MinNode+ ni o'rnating: https://nodejs.org (LTS), keyin Ornatish.cmd ni qayta ishga tushiring." }
  Note "Node.js o'rnatilmoqda (Windows ruxsat so'rashi mumkin)..."
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  # Yangi o'rnatilgan dastur bu oynaning PATH'ida hali yo'q: tizimdagi PATH qayta o'qiladi
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if ((Node-Major) -lt $MinNode) { Fail "Node.js o'rnatildi, lekin bu oyna uni hali ko'rmayapti. Oynani yoping va Ornatish.cmd ni QAYTA ishga tushiring." }
}
Note "Node.js $(node -v)"

# ffmpeg - IP kameralar (RTSP) uchun. O'rnatib bo'lmasa ham qolgan hamma narsa ishlaydi.
# Yangi o'rnatilgan ffmpeg bu oynaning PATH'ida hali ko'rinmaydi, shuning uchun to'liq yo'li .env ga yoziladi.
$ffmpegPath = ''
$wingetFfmpeg = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  if (-not (Test-Path $wingetFfmpeg) -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    Note "ffmpeg o'rnatilmoqda (IP kameralar uchun)..."
    winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
  }
  if (Test-Path $wingetFfmpeg) { $ffmpegPath = $wingetFfmpeg; Note "ffmpeg: $ffmpegPath" }
  else { Warn "ffmpeg yo'q - IP kameralar ishlamaydi (kompyuterning o'z kamerasi ishlaydi). Keyinroq: winget install Gyan.FFmpeg" }
} else { Note 'ffmpeg bor' }

# Yangilashda: ishlab turgan nusxa to'xtatiladi (fayllar band bo'lmasin), oxirida qayta yoqiladi
node scripts\supervise.mjs status | Out-Null
if ($LASTEXITCODE -eq 0) { Note "Ishlab turgan Palantir to'xtatilmoqda..."; node scripts\supervise.mjs stop }

# --- 2-3. Kutubxonalar, kamera modeli va panel -------------------------------
# Reliz arxivi (files.json bor): kutubxonalar Windows uchun yig'ilgan, panel va kamera modeli tayyor - internetsiz ham o'rnatiladi.
# Dasturchi nusxasi: hammasi shu yerda yuklanadi va yig'iladi.
if ((Test-Path 'files.json') -and (Test-Path 'node_modules') -and (Test-Path 'dist\index.html')) {
  Step '2-3/7  Reliz arxivi: kutubxonalar, kamera modeli va panel tayyor'
  Note "Nashr: $((Get-Content 'files.json' -Raw | ConvertFrom-Json).version). Keyingi nashrlar har kecha o'zi o'rnatiladi (scripts\update.mjs)"
} else {
  Step '2/7  Kutubxonalar (bir necha daqiqa, internet kerak)'
  Run 'npm ci' { npm ci --no-audit --no-fund }
  Step '3/7  Kamera modeli va panel'
  npm run --silent camera:model
  if ($LASTEXITCODE -ne 0) { Warn "Kamera modeli yuklanmadi - kamera nazorati ishlamaydi. Keyinroq: npm run camera:model, so'ng npm run build" }
  Run 'npm run build' { npm run --silent build }
}

# --- 4. Sozlamalar (.env) ----------------------------------------------------
Step '4/7  Sozlamalar (.env)'
$adminPassword = ''
$fresh = -not (Test-Path '.env')
if (-not $fresh) {
  Note ".env bor - o'zgartirilmadi. Kalitlarni almashtirish: faylni Bloknotda oching (install papkasi yonida)."
  if ($ffmpegPath -and -not (Read-EnvValue 'FFMPEG_PATH')) {
    [IO.File]::AppendAllText((Join-Path $Root '.env'), "`r`nFFMPEG_PATH=$ffmpegPath`r`n", (New-Object Text.UTF8Encoding($false)))
    Note 'FFMPEG_PATH .env ga qoshildi'
  }
} else {
  $data = $DefaultData
  if ($Papka) { $data = $Papka }
  Note "Ma'lumotlar papkasi: $data"
  New-Item -ItemType Directory -Force $data | Out-Null
  Note "Bot tokeni va AI kalitlari bu yerda so'ralmaydi: o'rnatish oxirida ulash ustasi ochiladi - kalitlarni o'sha yerga qo'yasiz, u har birini darhol tekshiradi."
  $adminPassword = New-Password 16
  $lines = @(
    "# Palantir sozlamalari ($(Get-Date -Format 'yyyy-MM-dd') da o'rnatildi). Hamma imkoniyatlar: .env.example",
    "ADMIN_PASSWORD=$adminPassword",
    '# Bot tokeni, Claude, Gemini, Telegram API kalitlari - panelda: http://localhost:3200/#/ulash (shifrlanib bazada turadi).',
    '# Shu yerga yozilsa ham ishlaydi, lekin paneldagisi ustun.',
    "PORT=$DefaultPort",
    '# Faqat shu kompyuterdan ochiladi. Tarmoqdagi boshqa qurilmalarga ochish: 0.0.0.0 (panel shifrsiz - parol ochiq ketadi)',
    'LISTEN_HOST=127.0.0.1',
    "DATA_DIR=$data",
    "FFMPEG_PATH=$ffmpegPath",
    '# Zaxira nusxalar papkasi: boshqa disk yoki fleshka bolgani yaxshi (masalan D:\PalantirZaxira)',
    "# BACKUP_DIR=$data\backups"
  )
  # BOM'siz UTF-8: Node .env ni shunday o'qiydi
  [IO.File]::WriteAllLines((Join-Path $Root '.env'), $lines, (New-Object Text.UTF8Encoding($false)))
  Note '.env yozildi'
}

# Maxfiy narsalar boshqa Windows foydalanuvchilaridan yopiladi (har o'rnatishda va yangilashda)
$dataDir = Read-EnvValue 'DATA_DIR'
if (-not $dataDir) { $dataDir = 'data' }
if (-not [IO.Path]::IsPathRooted($dataDir)) { $dataDir = [IO.Path]::GetFullPath((Join-Path $Root $dataDir)) }
New-Item -ItemType Directory -Force $dataDir | Out-Null
$closed = (Protect-Path $dataDir $true) -and (Protect-Path (Join-Path $Root '.env') $false)
# Dastur papkasi ham: uni o'zgartira olgan odam keyingi yonishda sizning nomingizdan istalgan narsani ishga tushira oladi
$closed = (Protect-Path $Root $true) -and $closed
if ($closed) { Note "Ma'lumotlar va dastur papkasi faqat shu foydalanuvchiga ochiq qilindi" }
else { Warn "Papkalarni yopib bo'lmadi (disk buni qo'llamasligi mumkin). Boshqa Windows foydalanuvchilari kalitlar va bazani o'qiy oladi - papkalarni o'z profilingiz ichiga ko'chiring." }

# --- 4b. Ovoz xizmati --------------------------------------------------------
# Panel ovozi va "Quloq" - tgvoice (Python), administrator huquqisiz. Telefon liniyasi (WSL + Asterisk) bu yerda o'rnatilmaydi:
# u Uztelecom SIP ma'lumotlari kelganda alohida qo'shiladi (install\Telefon.cmd), oldin o'rnatilgan bo'lsa - tegilmaydi.
Step '4b/7  Ovoz xizmati (panel ovozi va "Quloq")'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'telefon.ps1') -OnlyVoice
if ($LASTEXITCODE -ne 0) { Warn "Ovoz xizmati o'rnatilmadi - panel ovozsiz ishlaydi, qolgani ishlaydi. Keyinroq: install\Telefon.cmd -OnlyVoice" }

# --- 5. Tekshiruv ------------------------------------------------------------
Step '5/7  Tekshiruv (Telegram, Claude, ovoz, papka, port)'
$checkFailed = $false
if ($fresh) {
  Note "Yangi o'rnatish: kalitlar hali yo'q - ular ulash ustasida kiritilib, o'sha zahoti tekshiriladi. To'liq tekshiruv keyin: install\Tekshirish.cmd"
} else {
  npm run --silent check
  $checkFailed = $LASTEXITCODE -ne 0
}
if ($checkFailed) { Warn "Tekshiruvda xato bor. O'rnatish davom etadi, lekin xatoni tuzatmaguningizcha o'sha qism ishlamaydi (kalitni ulash ustasida almashtiring: http://localhost:3200/#/ulash, keyin install\Tekshirish.cmd)." }

# --- 6. Avtoyuklash va yorliqlar ---------------------------------------------
Step '6/7  Avtoyuklash va yorliqlar'
$shell = New-Object -ComObject WScript.Shell
if (Test-Path $OldStartupLink) { Remove-Item $OldStartupLink -Force -Confirm:$false }
$link = $shell.CreateShortcut($StartupLink)
$link.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$link.Arguments = "`"$Launcher`""
$link.WorkingDirectory = $Root
$link.Description = 'Palantir (fonda)'
$link.Save()
Note "Kompyuter yonib, foydalanuvchi kirganda Palantir o'zi ishga tushadi"
# Svet o'chib-yonganda hech kim kirmasa ham ishga tushsin: Windows o'zi kiradi, Palantir ekranni darhol qulflaydi (palantir-fon.vbs)
if (AutoLogon-Mine) {
  Note "Avtomatik kirish yoqilgan ($Me): svet o'chib-yonganda Palantir o'zi ishga tushadi"
} elseif ($alwaysOn) {
  Note "Avtomatik kirish yoqilmoqda: Windows '$Me' bilan o'zi kiradi va ekranni darhol qulflaydi. Windows parolingiz va ruxsat so'raladi"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $AutoLogon -User $Me
  if ($LASTEXITCODE -eq 0) { Note "Avtomatik kirish yoqildi" }
  else { Warn "Avtomatik kirish yoqilmadi: svet o'chib-yonganda kimdir Windows'ga kirmaguncha Palantir ishlamaydi. Keyinroq: install\Avtokirish.cmd" }
} else { Note "Oddiy kompyuter: Palantir Windows'ga kirganingizda ishga tushadi. Klinikada doim yoqiq tursa: install\Avtokirish.cmd" }
$port = Read-EnvValue 'PORT'
if (-not $port) { $port = $DefaultPort }
# Yorliq Palantir'ni (o'chiq bo'lsa) yoqadi va panelni ochadi; eski nomdagi yorliqlar ($OldPanelLinks) olib tashlanadi
foreach ($name in $OldPanelLinks) {
  $oldPanelLink = Join-Path $Desktop $name
  if (Test-Path $oldPanelLink) { Remove-Item $oldPanelLink -Force -Confirm:$false }
}
$panel = $shell.CreateShortcut((Join-Path $Desktop 'Palantir AI.lnk'))
$panel.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$panel.Arguments = "`"$(Join-Path $PSScriptRoot 'palantir-ochish.vbs')`""
$panel.WorkingDirectory = $Root
$panel.IconLocation = Join-Path $Root 'Palantir-logo\favicon\favicon.ico'
$panel.Description = 'Palantir: yoqish va panelni ochish'
$panel.Save()
Note "Ish stolida 'Palantir AI' yorlig'i - Palantir'ni yoqadi va panelni ochadi"

# Kecha-kunduz ishlaydigan kompyuter tarmoqqa ulangan paytda uxlamaydi: bot tunda ham javob beradi
if ($alwaysOn) {
  powercfg /change standby-timeout-ac 0
  $sleepOff = $LASTEXITCODE -eq 0
  powercfg /change hibernate-timeout-ac 0
  if ($sleepOff -and $LASTEXITCODE -eq 0) { Note "Uyqu rejimi o'chirildi (ekran o'chishi mumkin - bu xalaqit bermaydi)" }
  else { Warn "Uyqu rejimini o'zgartirib bo'lmadi - Sozlamalar > Quvvat bo'limida qo'lda o'chiring" }
}

# --- 7. Ishga tushirish ------------------------------------------------------
Step '7/7  Ishga tushirish'
Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList "`"$Launcher`""
$up = $false
for ($i = 0; $i -lt 60 -and -not $up; $i++) {
  Start-Sleep -Seconds 1
  try { $up = (Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2).ok } catch { $up = $false }
}
if (-not $up) {
  Fail "Server 60 soniyada javob bermadi. Jurnal: $(Read-EnvValue 'DATA_DIR')\logs  (oxirgi fayl). Qo'lda ko'rish: npm start"
}
Note "Palantir ishlayapti: http://localhost:$port"

Write-Host ''
Write-Host '== Tayyor. Keyingi qadamlar (docs\ORNATISH.md da batafsil):' -ForegroundColor Green
Note "Brauzerda ulash ustasi ochiladi: http://localhost:$port/#/ulash - admin paroli bilan kiring va qadamlarni tartib bilan bajaring:"
Note "   klinika va anketa -> kalitlar -> egasining Telegrami -> DentaCRM -> kameralar -> Instagram -> bo'shliqlar"
if ($adminPassword) {
  Write-Host ''
  Write-Host "   ADMIN PAROLI: $adminPassword" -ForegroundColor Yellow
  Note "Uni hozir yozib oling (u .env faylida ham turadi). Bu parol klinikaga berilmaydi - u sizniki."
}
if ($checkFailed) { Warn "Eslatma: tekshiruvdagi xatolarni tuzating (install\Tekshirish.cmd)." }
Note "Telefon liniyasi (AI qabulxona shahar raqamida) - Uztelecom SIP ma'lumotlari kelganda: install\Telefon.cmd"
Start-Process "http://localhost:$port/#/ulash"
