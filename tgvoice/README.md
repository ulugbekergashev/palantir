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

Har biznesning papkasida `Telefon.md`: salomlashish, murojaat («Ulug'bek aka»), ohang, qoidalar va ovoz (`ovoz: standart`
yoki Gemini ovozi nomi). O'zgartirish keyingi qo'ng'iroqdan kuchga kiradi. Suhbatlar `Qo'ng'iroqlar/` ga yoziladi.

## Fayllar

| Fayl | Nima |
|---|---|
| `call_live.py` | Asosiy: Telegram ↔ Gemini Live, vazifa asboblari, eslatma rejimi (`--remind <id>`) |
| `login.py` | Akkauntga bir marta kirish |
| `common.py` | Kalitlar `.env` dan (Cerebro bergan muhit o'zgaruvchilari ustun) |
| `call.py` | Eski zanjir: VoiceLab ovozi bilan (VoiceLab varianti uchun asos) |
| `check_live.py`, `check_player.py` | Qo'ng'iroqsiz tekshiruvlar |
| `latency.py` | Javob tezligini o'lchash |
| `voices_live.py` | Ovoz namunalarini egasining Telegramiga yuborish |

Qo'lda sinov qo'ng'irog'i: `tgvoice\.venv\Scripts\python.exe tgvoice\call_live.py <username>`.
Cerebro'dagi avtomatik sinov (telefon jiringlamaydi): `npm run test:tgcall`.
