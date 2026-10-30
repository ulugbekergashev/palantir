# Marketolog — Meta AI orqali SMM tahlil va Instagram postlari

Beshinchi AI xodim. Egasining **o'z meta.ai akkaunti** orqali ishlaydi. Meta ilovasi, App Review va API kalit kerak emas.
Meta AI Instagram va Facebook'ni ichidan ko'radi. Shuning uchun Marketolog undan so'raydi va postlar tayyorlaydi:

- «Instagram'dagi asosiy raqobatchilarimizni tahlil qil»
- «@shifo_dent akkauntimizni tahlil qil: nima yaxshi, nimani o'zgartirish kerak»
- «Shu Reels nimani aytadi va nega ko'p ko'rilgan: https://www.instagram.com/reel/…»
- «Keyingi haftaga 7 kunlik kontent-reja tuz»
- «Ertangi kun uchun implant haqida post tayyorla» — matnni Marketolog yozadi, rasmni Meta AI chizadi

Panel → **Marketolog** yoki Telegram'da yordamchiga shu gapni yozing. Javob bir necha daqiqada keladi:
Telegram'ga va panel → Marketolog → «Hisobotlar»ga (to'liq).

Jadval bilan ham bo'ladi: «Topshiriqlar» → «Har dushanba 10:00 da raqobatchilar tahlilini yubor».

## Ulash (bir marta)

Panel → Marketolog → **Ulash** → «Meta AI'ga kirish».

1. Palantir o'rnatilgan kompyuterda alohida Chrome (yoki Edge) oynasi ochiladi.
2. «Войти» ni bosing va Facebook yoki Instagram akkaunt bilan kiring. Parol Palantir'ga berilmaydi.
3. Kirgach oyna o'zi yopiladi, egasiga Telegram'da «Meta AI ulandi» keladi.

Keyin brauzer ko'rinmas ishlaydi va faqat savol bo'lganda ochiladi.

**Postlarni Instagram'ga joylash uchun** egasining Instagram'i ham brauzer orqali ulanadi: Sozlamalar → Instagram → «Instagram'ga kirish».
Buning uchun `.env` da `IG_VIA_BROWSER=1` bo'lishi kerak.

## Savollar qanday ishlaydi

- **Fonda ishlaydi.** Yordamchi darhol «so'radim» deydi. Meta AI javobi yordamchini va jonli qo'ng'iroqni ushlab turmaydi.
- **Har savol — yangi suhbat.** Javob tugaguncha kutiladi (ko'pi bilan 4 daqiqa).
- **Javob «Nusxa olish» tugmasidan olinadi.** Kompyuterdagi clipboard'ga tegilmaydi.
- **Meta AI aytgan @akkauntlar tekshiriladi**, egasining Instagram'i brauzer orqali ulangan bo'lsa. Sekin va 8 tagacha tekshiriladi.
  Yo'g'i hisobotda «yo'q» deb belgilanadi. Instagram ulanmagan bo'lsa — «tekshirilmadi» deyiladi.
- **Meta AI javobi begona matn.** U yordamchining suhbatiga qaytmaydi va bilimga yozilmaydi.
- **Akkaunt xavfsizligi:**
  - kuniga `META_AI_DAILY_LIMIT` ta savol (standart 30; rasm chizish ham shundan);
  - navbatda 3 tagacha savol;
  - sayt xatosida hisob qaytariladi.
- **«Qayta kiring» faqat meta.ai «Войти»ni ko'rsatganda.** Shunda Marketolog to'xtaydi, egasiga Telegram'da aytadi, panelda «Qayta kirish» chiqadi.
  Sekin internet yoki sayt nosozligi oddiy xato bo'lib qoladi.

## Postlar

Panel → Marketolog → **Postlar** → «Yangi post»:

- **Rasm** — o'z suratingiz yoki «Meta AI chizsin» (rasmda nima bo'lishini yozasiz).
  - Rasm Instagram o'lchamiga o'zi keltiriladi: JPEG, eni 1080 gacha, nisbat 4:5 dan 1.91:1 gacha.
  - Telefondagi 3:4 surat o'rtasidan kesiladi.
  - Buning uchun ffmpeg kerak (IP kameralar bilan bir xil).
- **Matn** — o'zingiz yozasiz yoki «Marketolog yozsin».
  - Heshteglar 30 tagacha, matn 2200 belgigacha.
  - Klinikada reklama filtri ogohlantiradi («kafolat», «og'riqsiz», «100%»).

**Qoralama** Telegram'ga rasm bilan keladi: «📤 Instagram'ga joylash» / «✖️ Bekor».
**Siz bosmaguncha Instagram'ga hech narsa chiqmaydi.**

Joylash egasining Instagram'i (brauzer) orqali, instagram.com veb-ilovasi o'zi ishlatadigan yo'l bilan bo'ladi.
Kuniga 5 tagacha post. Joylangani jurnalda va Telegram'da havolasi bilan.

- **Karta o'sha matnga bog'langan.** Panelda matnni o'zgartirsangiz, eski kartadagi tugma joylamaydi va yangi karta keladi.
- **Natija noma'lum bo'lsa** — post holati «Natija noma'lum». Bu Instagram post yaratishni boshlagan, lekin javob bermagan
  yoki server shu payt to'xtagan holat. Avtomatik qayta joylanmaydi: Instagram'ni ochib tekshiring. Post chiqmagan bo'lsa —
  «Chiqmagan — qayta joylash» (tasdiq so'raladi), chiqqan bo'lsa — «Bekor». Shunday qilib ikki nusxa chiqmaydi.
- **Matnni o'zgartirish va joylash — faqat egasi.** Palantir jamoasi kirishi bilan bo'lmaydi.

Hozircha faqat **rasmli post**. Reels (video) va karusel — keyingi qadam.

## Sozlama (.env, ixtiyoriy)

```
META_AI_DAILY_LIMIT=30     # kuniga Meta AI savollari (rasm chizish ham)
META_AI_SHOW_BROWSER=1     # savollar ko'rinadigan oynada (tekshirish uchun)
IG_VIA_BROWSER=1           # Instagram brauzer orqali (postlarni joylash va akkauntlarni tekshirish uchun)
IG_BROWSER=C:\...\chrome.exe   # brauzer yo'li, o'zi topmasa
```

## Nima sinalgan, nima yo'q

**Avtotest** — `npm run test:marketolog`, 44 tekshiruv. **Soxta** meta.ai va soxta Instagram bilan sinaladi:
- ulash;
- savol fonda, javob jurnal va Telegram'ga;
- akkauntlar tekshiruvi (bor / yo'q / tekshirilmadi);
- navbat va kunlik chegaralar, sayt xatosida hisob qaytishi;
- jadvalli topshiriq;
- postlar: o'z suratidan va Meta AI rasmidan qoralama, o'lcham, reklama filtri, 30 heshteg, «Marketolog yozsin»,
  panel va Telegram'dan joylash, ikki marta joylanmasligi, matn o'zgarganda eski karta ishlamasligi, «natija noma'lum» va tasdiq;
- «qayta kiring» holati, uzish.

**Haqiqiy meta.ai va instagram.com'da hali sinalmagan.**
- meta.ai sahifasi kirmasdan o'rganilgan: savol maydoni (`aria-label` «Спросите Meta AI»), «Войти» tugmasi (`data-testid="login-button"`).
- Kirgandan keyingi javob va rasm ko'rinishi taxmin bilan yozilgan.
- Instagram'ga post joylash yo'li (`rupload_igphoto` + `media/configure`) instagram.com veb-ilovasi bo'yicha yozilgan.

Birinchi jonli sinov:
1. `META_AI_SHOW_BROWSER=1` va `IG_SHOW_BROWSER=1` bilan ulang.
2. Bitta savol bering va bitta postni joylang.
3. Xato bo'lsa, matni panelda, jurnalda va Telegram'da chiqadi.

Bu Meta'ning rasmiy yo'li emas: meta.ai yoki instagram.com o'zgarsa tuzatish kerak bo'ladi.
