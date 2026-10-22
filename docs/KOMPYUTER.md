# Kompyuterda ishlash — yordamchi brauzerda va ekranda o'zi ishlaydi

Yordamchiga Telegram'da topshiriq berasiz — u kompyuterda o'zi bajaradi va natijani (fayllar bilan) Telegram'ga yuboradi:

- «soliq.uz dan oxirgi chorak dalolatnomasini yuklab ol»
- «OLX'da 3 million so'mgacha stomatologik kreslolarni top, eng arzon 5 tasini havolasi bilan yoz»
- «bank kabinetidan oktyabr ko'chirmasini Excel'da yuklab ol»
- «Yetkazib beruvchining saytida buyurtma formasini to'ldir: qo'lqop 10 quti» (yuborishdan oldin sizdan so'raydi)
- butun ekranda: «1C dagi bugungi sotuvlar hisobotini PDF qilib saqla» (brauzerdan tashqari dasturlar)

Ish fonda boradi: yordamchi darhol «boshladim» deydi, siz boshqa ish bilan bandsiz. Telegram'da bitta holat xabari yangilanib turadi
(«Brauzerda ishlayapman · 7-qadam … Ochyapman: soliq.uz») va unda **⏹ To'xtatish** tugmasi bor.

## Yoqish

`.env` (yoki klinika kompyuterida `C:\Palantir\.env`):

```
COMPUTER_USE=all          # browser — faqat brauzer; desktop — faqat butun ekran; all — ikkalasi
```

Serverni qayta ishga tushiring. Botda `/brauzer` va `/toxta` buyruqlari paydo bo'ladi.

**Brauzer rejimi** shu kompyuterdagi Chrome (yoki Edge)ni alohida profil bilan ochadi — sizning odatdagi brauzeringizga, parollaringizga tegmaydi.
Odatda ko'rinmas ishlaydi; kuzatib turish uchun `COMPUTER_SHOW_BROWSER=1`.

**Butun ekran rejimi:**
- **Windows** — qo'shimcha o'rnatish kerak emas: yordamchi dastur (`server/computer/helper/PalantirDesk.cs`) birinchi ishda Windows'ning o'z
  kompilyatori bilan yig'iladi. Ekran qulflangan bo'lsa ishlamaydi (avtokirish yoqilgan klinika kompyuterida ekran ochiq bo'lishi kerak).
- **macOS** — Tizim sozlamalari → Maxfiylik va xavfsizlik: **Ekranni yozib olish** va **Maxsus imkoniyatlar** (Accessibility) ro'yxatiga
  Palantir'ni ishga tushiradigan dasturni (Terminal yoki `node`) qo'shing. Ruxsatsiz ekran rasmi bo'sh chiqadi, sichqoncha qimirlamaydi.
- Linux'da butun ekran rejimi yo'q (brauzer rejimi ishlaydi).

## Saytlarga kirish (login, parol)

Yordamchi **parol, karta raqami va SMS kodni hech qachon yozmaydi**. Kirish kerak bo'lgan saytga o'zingiz bir marta kirasiz:

1. Botga `/brauzer soliq.uz` (yoki shunchaki `/brauzer`) — kompyuterda ko'rinadigan brauzer oynasi ochiladi.
2. O'sha oynada saytga o'zingiz kiring (login, parol, SMS). Kerak bo'lsa boshqa saytlarga ham.
3. Botda **✅ Kirdim, yopish** — oyna yopiladi, kirish saqlanadi (15 daqiqadan keyin o'zi ham yopiladi).

Keyingi topshiriqlarda yordamchi o'sha saytlarda kirgan holda ishlaydi. Sayt sizni chiqarib yuborsa — yordamchi «/brauzer bilan kiring» deydi.

## Siz nazoratda

| Nima | Qanday |
|---|---|
| **Xavfli amal oldidan ruxsat** | Brauzerda yuborish, to'lash, o'chirish, tasdiqlash, saqlash, buyurtma (o'zbek, rus, ingliz tilida) tugmalari, formani yuboradigan har qanday tugma va formadagi Enter — bosishdan oldin Telegram'da **✅ Ruxsat / ✖️ Yo'q**. Buni yordamchining o'zi emas, Palantir kodi tekshiradi: AI «so'ramay» bosa olmaydi. Javob bermasangiz (`COMPUTER_APPROVE_MINUTES`, 10 daqiqa) — bajarilmaydi |
| **Butun ekranda** | Ish boshlanishidan oldin «Kompyuteringizda shu ishni boshlaymi?» — ruxsatsiz boshlanmaydi. Ekrandagi tugmani kod taniy olmaydi, shuning uchun yordamchi har muhim qadam oldidan o'zi so'raydi (yuborish, to'lash, o'chirish, sozlama, dastur o'rnatish). Ctrl+Alt+Del, ekranni qulflash kabi tugmalar bosilmaydi |
| **To'xtatish** | Holat xabaridagi ⏹ yoki `/toxta` — darhol |
| **Chegaralar** | Bitta ish: 80 AI qadam, 30 daqiqa, taxminan $5 (`COMPUTER_MAX_STEPS`, `COMPUTER_MAX_MINUTES`, `COMPUTER_MAX_USD`); kuniga 400 AI so'rov (`AI_DAILY_COMPUTER`). Bir vaqtda bitta ish |
| **Qayerga kira oladi** | Shu kompyuter va ichki tarmoq (router, kamera, CRM serveri, `localhost`) — yopiq; har so'rov (yo'naltirish, rasm, skript) tekshiriladi. Faqat ma'lum saytlar kerak bo'lsa: `COMPUTER_ALLOWED_SITES=soliq.uz,my.gov.uz` |
| **Begona matn** | Sahifa va ekrandagi yozuv — ma'lumot, buyruq emas. Ish alohida AI suhbatida boradi: unda mijozlarga yozish, eslab qolish kabi Palantir asboblari yo'q. Topshiriq sizning gapingiz bo'lmasa (rasmdagi yozuv, mijoz xabari, internet qidiruvi, jadvaldagi topshiriq) — boshlashdan oldin sizdan so'raladi |
| **Fayllar** | Yuklab olinganlar `DATA_DIR/kompyuter/<ish>/` ga tushadi va Telegram'ga hujjat bo'lib keladi (45 MB gacha; kattasi — kompyuterdagi yo'li) |

Holat va oxirgi ishlar: yordamchidan «kompyuterdagi ish qalay?» deb so'rang.

## Narx

Har qadam — bitta AI so'rovi (ekran rasmi yoki sahifa matni bilan). Oddiy brauzer ishi (10–20 qadam) taxminan $0.2–1, butun ekranda —
ko'proq (har qadamda rasm). Eski rasm va sahifalar suhbatdan avtomatik tozalanadi. Xarajat panelda AI hisobiga «computer» bo'lib qo'shiladi.

## Bilib qo'ying

- AI xato qilishi mumkin: noto'g'ri tugmani bosishi, sahifani noto'g'ri o'qishi. Shuning uchun natijani (ayniqsa raqamlarni) tekshiring;
  muhim amallar baribir sizning ruxsatingiz bilan.
- Butun ekranda ishlayotganda kompyuterga tegmang — sichqoncha ikki kishida bo'lib qoladi.
- Captcha («men robot emasman»)ni yordamchi yechmaydi — sizga aytadi.
