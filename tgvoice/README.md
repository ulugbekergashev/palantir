# tgvoice — Telegram orqali AI qo'ng'iroq

Telefon liniyasisiz qo'ng'iroq: Palantir eslatma vaqtida egasiga **Telegram orqali** qo'ng'iroq qiladi. AI (Gemini Live)
o'zbekcha eslatadi, «bajarildi», «yarim soatga sur» desa — bajaradi. Qo'ng'iroq egasining telefonida oddiy Telegram
qo'ng'irog'idek jiringlaydi.

Qo'ng'iroq **alohida Telegram akkauntdan** ketadi (egasining o'z akkauntidan emas — Telegram o'z-o'ziga qo'ng'iroq qilmaydi).
Yangi ochilgan emas, oldindan ishlatilgan akkaunt yaxshi: yangilariga Telegram cheklov qo'yadi.

## O'rnatish (har kompyuterda bir marta)

Loyiha papkasida, PowerShell'da:

```
py -3 -m venv tgvoice\.venv
tgvoice\.venv\Scripts\python.exe -m pip install -r tgvoice\requirements.txt
```

`.env` ga:

```
TG_API_ID=...        # my.telegram.org → API development tools (qo'ng'iroq qiladigan akkaunt bilan)
TG_API_HASH=...
GEMINI_API_KEY=...   # klinikada — pullik tarif (bepulida Google ma'lumotdan foydalanishi mumkin)
TG_CALL_PYTHON=C:/Palantir/tgvoice/.venv/Scripts/python.exe
TG_CALL_SCRIPT=C:/Palantir/tgvoice/call_live.py
```

Akkauntga kirish (kod va parolni egasining o'zi kiritadi, hech qayerga yuborilmaydi):

```
tgvoice\.venv\Scripts\python.exe tgvoice\login.py
```

Sessiya `tgvoice\dentacrm.session` ga saqlanadi. **Bu fayl — akkauntga kirish kaliti:** git'ga tushmaydi, hech kimga berilmaydi.

Egasining Telegram akkaunti qo'ng'iroq qiladigan akkaunt bilan bir marta yozishgan bo'lishi kerak (yoki kontaktda bo'lsin) —
aks holda Telegram uni id bo'yicha topishga ruxsat bermaydi.

## Biznesga moslash — Obsidian'da

Har biznesning papkasida `Telefon.md`: salomlashish, murojaat («Ulug'bek aka»), ohang, qoidalar va ovoz.
O'zgartirish keyingi qo'ng'iroqdan kuchga kiradi. Suhbatlar `Qo'ng'iroqlar/` ga yoziladi.

| `ovoz:` | Kim gapiradi | Narx, tezlik |
|---|---|---|
| `standart` | Gemini, ovoz nomisiz + uz-UZ (o'zbekchani eng tabiiy aytadi) | ~150 so'm/daq, javob ~1,1 s |
| `Aoede`, `Puck`… | Gemini'ning shu nomli ovozi | xuddi shunday |
| `voicelab:Madina` | AI Gemini'da eshitadi va o'ylaydi, gapni VoiceLab o'qiydi (gap-gap) | + VoiceLab haqi, har javobga ~1 s |

VoiceLab v2 modeli (`VOICELAB_MODEL=lison-v2`) jonliroq, lekin gapga ~5 s — telefonda ishlatilmaydi. Jonli oqim
(VoiceLab realtime TTS, kalitda `tts:realtime` ruxsati) bilan tezlashishi mumkin — hali sinalmagan.

## Telefon liniyasi (SIP) — `sip_live.py`

Oddiy telefon raqami (Uztelecom va boshqalar) uchun. Asterisk WSL'da (Ubuntu, `D:\WSL\palantir`) qo'ng'iroqni ko'taradi va
AudioSocket orqali `sip_live.py` ga uzatadi. Har qo'ng'iroq o'z Gemini Live suhbatini oladi, shuning uchun bir vaqtda bir nechta
qo'ng'iroq ko'tariladi (`SIP_MAX_CALLS`, standart 4). Cheklov faqat liniyada: Uztelecom'da nechta kanal bo'lsa, shuncha.

Kim qo'ng'iroq qilganini liniya belgilaydi (`asterisk/extensions.conf`), suhbatdagi gap emas:

| Qayerdan | Rejim | AI nima qila oladi |
|---|---|---|
| Egasining SIP ilovasi (login `egasi`, parol `.env` dagi `SIP_OWNER_PASSWORD`, faqat Wi-Fi'dan) | egasi | xuddi Telegram qo'ng'irog'idagidek: vazifalar, Palantir |
| Shu ilovadan «2» raqami | mijoz (sinov) | mijoz nima eshitishini tekshirish |
| Shahar raqami (`pjsip_shahar.conf`) | mijoz | faqat biznes haqidagi bilim va `leave_request` — so'rov egasiga vazifa bo'lib tushadi, bir daqiqada Telegram'ga eslatma |

Mijozga egasining vazifalari, ismi va Telefon.md ko'rsatmasi berilmaydi (`/api/brain/phone?for=customer`).

O'rnatish (bir marta): WSL va Ubuntu → `apt install asterisk` → `%USERPROFILE%\.wslconfig` da `networkingMode=mirrored` →
brandmauerda UDP 5060 va 10000–10100 (faqat ichki tarmoq). Sozlamalarni o'zgartirgandan keyin:

```
wsl -d Palantir -u root -- bash /mnt/d/Projects/palantir/tgvoice/asterisk/install.sh
tgvoice\.venv\Scripts\python.exe tgvoice\sip_live.py
```

Uztelecom ma'lumotlari kelganda: panel → **Sozlamalar → Telefon liniyasi** (server, login, parol, raqam) — `pjsip_shahar.conf`
o'zi yoziladi va Asterisk qo'ng'iroqlarni uzmasdan qayta yuklanadi (`install.sh reload`). Qo'lda: `asterisk/pjsip_shahar.conf.namuna`.

Kim javob beradi (shu sahifada): «har doim AI» yoki «ish vaqtida avval administrator, ko'tarmasa yoki ish vaqtidan tashqari — AI».
Asterisk har qo'ng'iroqda Palantir'dan so'raydi (`[kiruvchi]` → `/api/voice/route`, ovozli agent kaliti bilan), shuning uchun ish vaqti
o'zgarsa qayta yuklash kerak emas; Palantir javob bermasa ham — AI. Administrator telefoni: Zoiper, login `admin`, parolni panel yaratadi
(`pjsip_admin.conf`, git'ga tushmaydi). Qaror `messages.log` da: `Palantir: <raqam> — kim javob beradi: …`.
Telefonsiz tekshiruv: `tgvoice\.venv\Scripts\python.exe tgvoice\check_sip.py` — Asterisk ichida «mijoz» savol beradi, yozuv `tmp/sinov.wav`.

## «Quloq» — panelda «Palantir» deb chaqirish (`wake.py`)

Panelning chap ustunidagi «Quloq» yoqilsa, brauzer mikrofoni `web_live.py` ga (mode `wake`) oqadi va shu kompyuterda tinglanadi —
internetga hech narsa ketmaydi. «Palantir» yoki «Jarvis» eshitilsa, shu ulanishning o'zida Gemini Live suhbati boshlanadi
(chaqiriqdan keyingi gap ham yo'qolmaydi), istalgan sahifada pastda suhbat oynasi chiqadi; tugagach yana tinglaydi.

Model (bir marta, ~45 MB, Apache-2.0), `tgvoice/models/` ga (git'ga tushmaydi):

```
curl -L -o m.zip https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip && tar -xf m.zip -C tgvoice/models && del m.zip
tgvoice\.venv\Scripts\python.exe -m pip install vosk
```

Sinov (Gemini TTS, 3 ovoz, o'zbekcha va ruscha): 12 oddiy gapdan 0 tasida yolg'on chaqiriq, 15 chaqiriqdan 13 tasi topildi.
Boshqa model: `WAKE_MODEL=<papka>`.

## Fayllar

| Fayl | Nima |
|---|---|
| `call_live.py` | Asosiy: Telegram ↔ Gemini Live, vazifa asboblari, eslatma rejimi (`--remind <id>`) |
| `sip_live.py` | Telefon liniyasi: Asterisk (AudioSocket) ↔ Gemini Live, egasi va mijoz rejimlari, bir vaqtda bir nechta qo'ng'iroq |
| `web_live.py` | Panel ovozi: egasi, qabulxona sinovi (mijoz) va «quloq» (chaqiriqni kutish) rejimlari |
| `wake.py` | «Palantir» / «Jarvis» chaqirig'ini topish (Vosk, internetsiz) |
| `asterisk/` | Asterisk sozlamalari va `install.sh` (WSL ichiga o'rnatadi) |
| `check_sip.py` | Telefonsiz tekshiruv: Asterisk ichida mijoz qo'ng'irog'i |
| `login.py` | Akkauntga bir marta kirish |
| `common.py` | Kalitlar `.env` dan (Palantir bergan muhit o'zgaruvchilari ustun) |
| `call.py` | Eski zanjir: VoiceLab ovozi bilan (VoiceLab varianti uchun asos) |
| `check_live.py`, `check_player.py`, `check_voicelab.py` | Qo'ng'iroqsiz tekshiruvlar (oxirgisi VoiceLab kreditini ishlatadi) |
| `latency.py` | Javob tezligini o'lchash |
| `voices_live.py` | Ovoz namunalarini egasining Telegramiga yuborish |

Qo'lda sinov qo'ng'irog'i: `tgvoice\.venv\Scripts\python.exe tgvoice\call_live.py <username>`.
Palantir'dagi avtomatik sinov (telefon jiringlamaydi): `npm run test:tgcall`.
