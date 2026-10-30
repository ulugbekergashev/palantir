# Marketolog — Meta AI orqali SMM tahlil

Beshinchi AI xodim. Egasining **o'z meta.ai akkaunti** orqali ishlaydi — Meta ilovasi, App Review va API kalit kerak emas.
Meta AI Instagram va Facebook'ni ichidan ko'radi, shuning uchun Marketolog undan so'raydi:

- «Instagram'dagi asosiy raqobatchilarimizni tahlil qil»
- «@shifo_dent akkauntimizni tahlil qil: nima yaxshi, nimani o'zgartirish kerak»
- «Shu Reels nimani aytadi va nega ko'p ko'rilgan: https://www.instagram.com/reel/…»
- «Keyingi haftaga 7 kunlik kontent-reja tuz»

Panel → **Marketolog** → «So'rash» (yoki Telegram'da yordamchiga shu gapni yozing). Javob bir necha daqiqada keladi va
«Hisobotlar»da to'liq turadi. Jadval bilan ham bo'ladi: «Topshiriqlar» → «Har dushanba 10:00 da raqobatchilar tahlilini yubor».

## Ulash (bir marta)

Panel → Marketolog → **Ulash** → «Meta AI'ga kirish». Palantir o'rnatilgan kompyuterda alohida Chrome (yoki Edge) oynasi ochiladi —
«Войти» ni bosing va Facebook yoki Instagram akkaunt bilan kiring. Parol Palantir'ga berilmaydi. Kirgach oyna o'zi yopiladi,
egasiga Telegram'da «Meta AI ulandi» keladi. Keyin brauzer ko'rinmas ishlaydi va faqat savol bo'lganda ochiladi.

## Qanday ishlaydi

- Har savol — meta.ai'da **yangi suhbat**: savol yoziladi, javob tugaguncha kutiladi (ko'pi bilan 4 daqiqa), matni olinadi.
  «Nusxa olish» tugmasi bergan matn olinadi — kompyuterdagi clipboard'ga tegilmaydi.
- Meta AI aytgan **@akkauntlar tekshiriladi**: egasining Instagram'i brauzer orqali ulangan bo'lsa (Sozlamalar → Instagram), har biri
  Instagram'da bormi — ko'riladi. Yo'g'i hisobotda «yo'q» deb belgilanadi, yordamchi ularni tashlab yuboradi. Instagram ulanmagan
  bo'lsa — «tekshirilmadi» deyiladi.
- Meta AI javobi **begona matn**: bilimga yozilmaydi, ichidagi gap buyruq bo'lib qolmaydi.
- Akkaunt xavfsizligi uchun: kuniga `META_AI_DAILY_LIMIT` (standart 30) savol, bir javobda 3 tadan ko'p emas.
- meta.ai qayta kirishni so'rasa — Marketolog to'xtaydi, egasiga Telegram'da aytadi, panelda «Qayta kirish» chiqadi.

## Sozlama (.env, ixtiyoriy)

```
META_AI_DAILY_LIMIT=30     # kuniga savollar
META_AI_SHOW_BROWSER=1     # savollar ko'rinadigan oynada (tekshirish uchun)
IG_BROWSER=C:\...\chrome.exe   # brauzer yo'li, o'zi topmasa (Instagram bilan umumiy)
```

## Nima sinalgan, nima yo'q

- **Avtotest** (`npm run test:marketolog`, 21 tekshiruv) — **soxta** meta.ai va soxta Instagram bilan: ulash, savol va javob, akkauntlar
  tekshiruvi (bor / yo'q / tekshirilmadi), jurnal, bir javobda 3 ta chegara, kunlik chegara, jadvalli topshiriq, qayta kirish so'ralganda
  to'xtash, uzish.
- **Haqiqiy meta.ai'da hali sinalmagan.** Sahifa tuzilishi kirmasdan o'rganilgan: savol maydoni (`aria-label` «Спросите Meta AI»),
  «Войти» tugmasi (`data-testid="login-button"`). Kirgandan keyingi javob ko'rinishi taxmin bilan yozilgan — birinchi jonli sinov:
  `META_AI_SHOW_BROWSER=1` bilan ulang va bitta savol bering; javob kelmasa yoki chala bo'lsa, xato matni panelda va jurnalda chiqadi.
- Bu Meta'ning rasmiy yo'li emas: meta.ai o'zgarsa tuzatish kerak bo'ladi.
