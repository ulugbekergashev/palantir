# tgvoice — Telegram orqali AI qo'ng'iroq

Telefon liniyasisiz qo'ng'iroq: Cerebro eslatma vaqtida egasiga **Telegram orqali** qo'ng'iroq qiladi. AI (Gemini Live)
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
TG_CALL_PYTHON=C:/Cerebro/tgvoice/.venv/Scripts/python.exe
TG_CALL_SCRIPT=C:/Cerebro/tgvoice/call_live.py
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

## Fayllar

| Fayl | Nima |
|---|---|
| `call_live.py` | Asosiy: Telegram ↔ Gemini Live, vazifa asboblari, eslatma rejimi (`--remind <id>`) |
| `login.py` | Akkauntga bir marta kirish |
| `common.py` | Kalitlar `.env` dan (Cerebro bergan muhit o'zgaruvchilari ustun) |
| `call.py` | Eski zanjir: VoiceLab ovozi bilan (VoiceLab varianti uchun asos) |
| `check_live.py`, `check_player.py`, `check_voicelab.py` | Qo'ng'iroqsiz tekshiruvlar (oxirgisi VoiceLab kreditini ishlatadi) |
| `latency.py` | Javob tezligini o'lchash |
| `voices_live.py` | Ovoz namunalarini egasining Telegramiga yuborish |

Qo'lda sinov qo'ng'irog'i: `tgvoice\.venv\Scripts\python.exe tgvoice\call_live.py <username>`.
Cerebro'dagi avtomatik sinov (telefon jiringlamaydi): `npm run test:tgcall`.
