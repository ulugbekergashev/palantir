# Ovoz xizmati va telefon liniyasini o'rnatadi (Windows 10/11, PowerShell 5.1). ornatish.ps1 chaqiradi; alohida ham ishlaydi:
#   install\Telefon.cmd               - ovoz xizmati (Python) va telefon liniyasi (WSL ichida Asterisk)
#   install\Telefon.cmd -OnlyVoice    - faqat ovoz xizmati (panel ovozi, "Quloq"); telefon liniyasisiz
# Qadamlar: Python -> ovoz xizmati kutubxonalari -> "Quloq" modeli -> .env ->
#   (administrator huquqi bilan) WSL -> Ubuntu 24.04 -> Asterisk -> mirrored tarmoq -> brandmauer -> Asterisk sozlamalari.
# Har qadam qayta ishga tushirilganda tekshiradi: bor narsa qayta o'rnatilmaydi.
# Bu faylda faqat ASCII belgilar: PowerShell 5.1 boshqa belgilarni buzib o'qiydi.
param([switch]$OnlyVoice, [switch]$AsteriskPart, [string]$Distro = '', [string]$WslDir = '')

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Voice = Join-Path $Root 'tgvoice'
$VenvPython = Join-Path $Voice '.venv\Scripts\python.exe'
# O'rnatuvchi exe ichidagi Python (runtime\python, kutubxonalari bilan - scripts\setup-exe.ts): bo'lsa venv o'rniga shu, internetsiz
$BundledPython = Join-Path $Root 'runtime\python\python.exe'
if (Test-Path $BundledPython) { $VenvPython = $BundledPython }
$WakeModel = 'vosk-model-small-ru-0.22'
$WakeUrl = "https://alphacephei.com/vosk/models/$WakeModel.zip"
$RootfsUrl = 'https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz'
$RootfsSums = 'https://cloud-images.ubuntu.com/wsl/releases/24.04/current/SHA256SUMS'
# WSL (Hyper-V) virtual mashinalarining brandmauer identifikatori
$WslVm = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'
if (-not $WslDir) { $WslDir = Join-Path (Split-Path -Parent $Root) 'palantir-wsl' }

function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Note([string]$text) { Write-Host "   $text" }
function Warn([string]$text) { Write-Host "   ! $text" -ForegroundColor Yellow }
function Fail([string]$text) { Write-Host "   X $text" -ForegroundColor Red; exit 1 }
function Run([string]$what, [scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { Fail "$what bajarilmadi (kod $LASTEXITCODE). Yuqoridagi xabarni o'qing va qayta urining." }
}
function Read-EnvValue([string]$name) {
  if (-not (Test-Path '.env')) { return '' }
  $line = Get-Content '.env' | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if (-not $line) { return '' }
  return ($line -replace "^\s*$name\s*=", '').Trim()
}
function Add-EnvValue([string]$name, [string]$value) {
  if (Read-EnvValue $name) { return }
  [IO.File]::AppendAllText((Join-Path $Root '.env'), "`r`n$name=$value`r`n", (New-Object Text.UTF8Encoding($false)))
  Note "$name .env ga qo'shildi"
}
function New-Password([int]$length) {
  $alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] $length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}
# wsl.exe UTF-16 da yozadi - PowerShell 5.1 orasiga nol belgilar qo'yib o'qiydi
function Wsl([string[]]$arguments) { (& wsl.exe @arguments 2>&1 | Out-String) -replace "`0", '' }
function WslRoot([string]$command) { & wsl.exe -d $Distro -u root -- bash -lc $command; return $LASTEXITCODE }
function Is-Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
# D:\Projects\palantir -> /mnt/d/Projects/palantir
function To-WslPath([string]$path) { '/mnt/' + $path.Substring(0, 1).ToLower() + ($path.Substring(2) -replace '\\', '/') }
# Distributiv nomi. Dastur avval Cerebro deb atalgan (eski nom): o'sha nomli Ubuntu bor bo'lsa - o'sha ishlatiladi
# (ikkinchisi o'rnatilsa, ikki Asterisk bitta 5060 portni talashadi). server/voice/line.ts ham shunday tanlaydi
if (-not $Distro -and -not $OnlyVoice) {
  $have = @()
  try { $have = (Wsl @('-l', '-q')) -split "`r?`n" | ForEach-Object { $_.Trim() } } catch { }
  if (($have -notcontains 'Palantir') -and ($have -contains 'Cerebro')) { $Distro = 'Cerebro' } else { $Distro = 'Palantir' } # eski nom
}

# --- Telefon liniyasi: administrator huquqi bilan ishlaydigan qism ----------
if ($AsteriskPart) {
  Step 'WSL (Windows ichidagi Linux)'
  $version = Wsl @('--version')
  if ($LASTEXITCODE -ne 0 -or $version -notmatch 'WSL') {
    Note "WSL o'rnatilmagan - o'rnatilmoqda (internet kerak)..."
    & wsl.exe --install --no-distribution
    if ($LASTEXITCODE -ne 0) { Fail "WSL o'rnatilmadi. Kompyuter BIOS'ida virtualizatsiya (VT-x / AMD-V, SVM) yoqilganini tekshiring." }
    Write-Host ''
    Write-Host '   WSL o''rnatildi. KOMPYUTERNI QAYTA YOQING, keyin install\Telefon.cmd ni yana ishga tushiring.' -ForegroundColor Yellow
    exit 3010
  }
  Note 'WSL bor'

  Step "Ubuntu 24.04 ($Distro)"
  $distros = Wsl @('-l', '-q')
  if (($distros -split "`r?`n" | ForEach-Object { $_.Trim() }) -contains $Distro) {
    Note "$Distro bor"
  } else {
    $tar = Join-Path $env:TEMP 'palantir-ubuntu-24.04.rootfs.tar.gz'
    if (-not (Test-Path $tar)) {
      Note 'Ubuntu yuklanmoqda (~340 MB)...'
      $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest -Uri $RootfsUrl -OutFile $tar -UseBasicParsing
    }
    $name = Split-Path -Leaf $RootfsUrl
    # PowerShell 5.1 matn bo'lmagan javobni baytlar qilib beradi
    $content = (Invoke-WebRequest -Uri $RootfsSums -UseBasicParsing).Content
    if ($content -is [byte[]]) { $content = [Text.Encoding]::ASCII.GetString($content) }
    $sums = $content -split "`n" | Where-Object { $_.Trim() -match ([regex]::Escape($name) + '$') }
    $expected = ($sums -split '\s+' | Select-Object -First 1)
    $got = (Get-FileHash $tar -Algorithm SHA256).Hash.ToLower()
    if (-not $expected -or $got -ne $expected.ToLower()) { Remove-Item $tar -Force; Fail "Ubuntu fayli buzilgan (SHA256 mos emas) - qayta ishga tushiring." }
    New-Item -ItemType Directory -Force $WslDir | Out-Null
    Run 'Ubuntu import' { & wsl.exe --import $Distro $WslDir $tar --version 2 }
    Remove-Item $tar -Force
    Note "Ubuntu o'rnatildi: $WslDir"
  }
  # systemd - Asterisk xizmat sifatida o'zi yonsin
  $null = WslRoot "grep -q '^systemd=true' /etc/wsl.conf 2>/dev/null || printf '[boot]\nsystemd=true\n' > /etc/wsl.conf"
  & wsl.exe --terminate $Distro | Out-Null

  Step 'Asterisk'
  if ((WslRoot 'command -v asterisk >/dev/null') -ne 0) {
    Note "Asterisk o'rnatilmoqda (internet kerak, bir necha daqiqa)..."
    if ((WslRoot 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq asterisk >/tmp/apt.log 2>&1 || { tail -5 /tmp/apt.log; exit 1; }') -ne 0) { Fail "Asterisk o'rnatilmadi" }
  }
  Note "Asterisk bor: $((Wsl @('-d', $Distro, '-u', 'root', '--', 'asterisk', '-V')).Trim())"

  Step 'Tarmoq (mirrored) va brandmauer'
  # Asterisk kompyuterning o'z IP manzilida ko'rinsin (telefonlar va Uztelecom shu manzilga ulanadi)
  $cfg = Join-Path $env:USERPROFILE '.wslconfig'
  $text = ''
  if (Test-Path $cfg) { $text = Get-Content $cfg -Raw }
  if ($text -notmatch '(?m)^\s*networkingMode\s*=\s*mirrored') {
    if ($text -match '(?m)^\s*\[wsl2\]') { $text = $text -replace '(?m)^(\s*\[wsl2\]\s*)$', "`$1`r`nnetworkingMode=mirrored" }
    else { $text = $text.TrimEnd() + "`r`n[wsl2]`r`nnetworkingMode=mirrored`r`n" }
    [IO.File]::WriteAllText($cfg, $text.TrimStart(), (New-Object Text.UTF8Encoding($false)))
    Note '.wslconfig: networkingMode=mirrored (WSL qayta yonadi)'
    & wsl.exe --shutdown | Out-Null
  } else { Note 'mirrored tarmoq bor' }
  # Faqat ichki tarmoqdan: SIP (5060 UDP/TCP) va ovoz (10000-10100 UDP)
  $rules = @(@('Palantir-SIP', 'UDP', '5060'), @('Palantir-SIP-TCP', 'TCP', '5060'), @('Palantir-RTP', 'UDP', '10000-10100'))
  # Eski nomdagi (Cerebro - eski nom) qoidalar olib tashlanadi: o'rniga shu qoidalar qo'yiladi
  foreach ($old in @('Cerebro-SIP', 'Cerebro-SIP-TCP', 'Cerebro-RTP')) { # eski nom
    Remove-NetFirewallRule -Name $old -ErrorAction SilentlyContinue
    if (Get-Command Remove-NetFirewallHyperVRule -ErrorAction SilentlyContinue) { Remove-NetFirewallHyperVRule -Name $old -ErrorAction SilentlyContinue }
  }
  foreach ($r in $rules) {
    if (-not (Get-NetFirewallRule -Name $r[0] -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -Name $r[0] -DisplayName "Palantir $($r[0])" -Direction Inbound -Protocol $r[1] -LocalPort ($r[2] -split ',') -RemoteAddress LocalSubnet -Action Allow | Out-Null
    }
    if (Get-Command New-NetFirewallHyperVRule -ErrorAction SilentlyContinue) {
      if (-not (Get-NetFirewallHyperVRule -Name $r[0] -ErrorAction SilentlyContinue)) {
        try { New-NetFirewallHyperVRule -Name $r[0] -DisplayName "Palantir $($r[0]) (WSL)" -Direction Inbound -VMCreatorId $WslVm -Protocol $r[1] -LocalPorts $r[2] -Action Allow | Out-Null }
        catch { Warn "Hyper-V brandmauer qoidasi qo'shilmadi: $($_.Exception.Message)" }
      }
    }
  }
  Note "Brandmauer: 5060 va 10000-10100 portlari faqat ichki tarmoq uchun ochiq"

  Step 'Asterisk sozlamalari'
  Run 'install.sh' { & wsl.exe -d $Distro -u root -- bash (To-WslPath (Join-Path $Voice 'asterisk\install.sh')) }
  exit 0
}

# --- 1. Python ---------------------------------------------------------------
Step 'Ovoz xizmati: Python'
function Find-Python {
  # 3.11+ kerak; Microsoft Store "python" yorlig'i (WindowsApps) haqiqiy Python emas
  $candidates = @()
  if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($v in '-3.13', '-3.12', '-3.11', '-3') { $candidates += ,@('py', $v) }
  }
  if (Get-Command python -ErrorAction SilentlyContinue) { $candidates += ,@('python') }
  $candidates += ,@((Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'))
  foreach ($c in $candidates) {
    try {
      $exe = $c[0]; $rest = @(); if ($c.Count -gt 1) { $rest = $c[1..($c.Count - 1)] }
      $out = & $exe @rest -c "import sys; print(sys.version_info >= (3, 11), sys.executable)" 2>$null
      if ($LASTEXITCODE -eq 0 -and $out -match '^True (.+)$' -and $Matches[1] -notmatch 'WindowsApps') { return $Matches[1].Trim() }
    } catch { }
  }
  return ''
}
if (Test-Path $VenvPython) {
  Note "Ovoz xizmati muhiti bor: $VenvPython"
} else {
  $python = Find-Python
  if (-not $python) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail "Python 3.11+ topilmadi. O'rnating: https://www.python.org/downloads/ (Add to PATH), keyin qayta ishga tushiring." }
    Note "Python o'rnatilmoqda..."
    winget install -e --id Python.Python.3.12 --scope user --accept-source-agreements --accept-package-agreements
    $python = Find-Python
    if (-not $python) { Fail "Python o'rnatildi, lekin topilmadi. Bu oynani yoping va qayta ishga tushiring." }
  }
  Note "Python: $python"
  Run 'Ovoz xizmati muhiti (venv)' { & $python -m venv (Join-Path $Voice '.venv') }
}

if ($VenvPython -eq $BundledPython) {
  Step 'Ovoz xizmati: kutubxonalar (dastur ichida)'
  Run 'Kutubxonalar tekshiruvi' { & $VenvPython -c 'import vosk, ntgcalls, pytgcalls, telethon, google.genai, httpx, websockets' }
} else {
  Step "Ovoz xizmati: kutubxonalar (bir necha daqiqa)"
  Run 'pip' { & $VenvPython -m pip install --disable-pip-version-check -q -r (Join-Path $Voice 'requirements.txt') }
}
Note 'Kutubxonalar tayyor'

Step "'Quloq' modeli (Palantir / Jarvis deb chaqirish)"
$models = Join-Path $Voice 'models'
if (Test-Path (Join-Path $models $WakeModel)) { Note 'Model bor' } else {
  New-Item -ItemType Directory -Force $models | Out-Null
  $zip = Join-Path $env:TEMP "$WakeModel.zip"
  $ProgressPreference = 'SilentlyContinue'
  try {
    Invoke-WebRequest -Uri $WakeUrl -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $models -Force
    Remove-Item $zip -Force
    Note "Model yuklandi (~45 MB)"
  } catch { Warn "Model yuklanmadi - 'Quloq' ishlamaydi, qolgani ishlaydi. Keyinroq Telefon.cmd ni qayta ishga tushiring. ($($_.Exception.Message))" }
}

Step 'Ovoz xizmati: sozlamalar (.env)'
if (-not (Test-Path '.env')) { Fail ".env yo'q - avval Ornatish.cmd ni ishga tushiring (dastur papkasida)" }
Add-EnvValue 'TG_CALL_PYTHON' $VenvPython
Add-EnvValue 'TG_CALL_SCRIPT' (Join-Path $Voice 'call_live.py')
# Egasining SIP ilovasi uchun parol (telefon liniyasi); ovozli agent kalitini Palantir o'zi yaratadi (DATA_DIR\ovoz.env)
Add-EnvValue 'SIP_OWNER_PASSWORD' (New-Password 20)
Note 'Gemini kaliti panelda kiritiladi (ulash ustasi) - ovoz xizmati uni o''zi oladi'

if ($OnlyVoice) { Write-Host ''; Write-Host '== Ovoz xizmati tayyor (telefon liniyasisiz).' -ForegroundColor Green; exit 0 }

# --- Telefon liniyasi (administrator huquqi kerak) ---------------------------
Step 'Telefon liniyasi (WSL + Asterisk) - administrator huquqi so''raladi'
# Start-Process argumentlarni bitta satrga qo'shadi - bo'shliqli yo'llar qo'shtirnoqda; to'g'ridan-to'g'ri chaqiriqda esa qo'shtirnoqsiz
$elevated = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-AsteriskPart', '-Distro', $Distro, '-WslDir', "`"$WslDir`"")
if (Is-Admin) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -AsteriskPart -Distro $Distro -WslDir $WslDir
  $code = $LASTEXITCODE
} else {
  $p = Start-Process powershell -Verb RunAs -ArgumentList $elevated -Wait -PassThru
  $code = $p.ExitCode
}
if ($code -eq 3010) { exit 3010 }
if ($code -ne 0) {
  Warn "Telefon liniyasi o'rnatilmadi (kod $code). Panel ovozi va 'Quloq' baribir ishlaydi. Keyinroq: install\Telefon.cmd"
  exit 2
}
Write-Host ''
Write-Host '== Ovoz xizmati va telefon liniyasi tayyor.' -ForegroundColor Green
Note 'Shahar raqami (Uztelecom) va administrator telefoni: panel -> Sozlamalar -> Telefon liniyasi'
