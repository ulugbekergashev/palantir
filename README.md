# DentaGrow

Stomatologiya klinikalari uchun AI marketolog va dizayner. Har dushanba klinika egasining Telegramiga haftalik paket keladi: 3 ta post va 2 ta storis, klinika brendida tayyor rasm va matn bilan. Egasi bitta tugma bilan tasdiqlaydi, material belgilangan vaqtda kanal va Instagram'ga chiqadi.

DentaCRM'dan alohida mahsulot. Unga ulanish ixtiyoriy.

> **Hozirgi holat — sotuv demosi.** Hammasi brauzerda ishlaydi: server, AI va Telegram yo'q. Matnlar tayyor namunalardan olinadi, natijalar namunaviy raqamlar. Ma'lumot faqat shu brauzerda saqlanadi.

## Ishga tushirish

```bash
npm install
npm run dev        # http://localhost:3100
npm run build      # tip tekshiruvi + production build (dist/)
```

## Demoda nima bor

| Bo'lim | Nima ko'rsatadi |
|---|---|
| Haftalik paket | 3 post + 2 storis, hafta kalendari, har biri uchun: Joylash, Boshqa variant, Tahrirlash, PNG yuklab olish, Kerak emas. Yonida — egasining Telegram maketi |
| Telegram bot | Egasi paketni tugmalar bilan tasdiqlaydi va botdan so'raydi: «Nechta lid keldi?», «Qaysi post yaxshi ishladi?» |
| Natijalar | Qaysi post nechta odamga yetdi va nechtasi botga yozdi (demo: namunaviy raqamlar) |
| Klinika va brend | Bir martalik onboarding: aloqa, logo va ranglar, xizmatlar va narxlar, shifokorlar, haftalik maqsad (aksiya, bo'sh vaqtlar) |

Paket qanday tuziladi (`src/lib/generator.ts`):

1. Post — egasi tanlagan xizmat yoki aksiya.
2. Post — haftaga to'g'ri kelgan bayram (Tabassum kuni, Ustozlar kuni…) yoki foydali maslahat.
3. Post — shifokor bilan tanishuv (har hafta boshqasi).
4. Storis — bu haftaning bo'sh vaqtlari.
5. Storis — ikkinchi bayram yoki so'rovnoma.

## Qoidalar

- **Klinika aytmagan narsa yozilmaydi.** Chegirma, uskuna yoki natija faqat onboarding'da kiritilganidan olinadi.
- **Tibbiy reklama filtri** (`src/lib/compliance.ts`) har matnni tekshiradi: «kafolat», «100%», «og'riqsiz», «eng yaxshi», «гарантия» va hokazo. Ro'yxat dastlabki, yurist bilan tasdiqlanadi.
- **Egasi tasdiqlamaguncha hech narsa chiqmaydi.**
- Aksiya postida «Muolaja oldidan shifokor ko'rigi zarur» degan ogohlantirish bor.

## Tuzilma

```
src/
  lib/generator.ts     haftalik paket (qaysi kun, qaysi mavzu, matn)
  lib/content.ts       matnlar banki (maslahat, so'rovnoma, xizmat tavsiflari) — uz/ru
  lib/occasions.ts     bayram va muhim sanalar
  lib/compliance.ts    tibbiy reklama filtri
  lib/exportPng.ts     SVG → PNG (Manrope shrifti ichiga joylanadi)
  lib/report.ts        namunaviy natijalar
  templates/           rasm shablonlari (SVG): aksiya, maslahat, shifokor, bayram, bo'sh vaqtlar, so'rovnoma
  components/          kartochka, Telegram maketi, tahrirlash oynasi, hafta qatori
  pages/               Haftalik paket, Natijalar, Klinika va brend
  data/sampleClinic.ts namuna klinika (o'ylab topilgan; telefon «+998 00» — mavjud bo'lmagan kod)
```

Rasm uchun ham ekrandagi ko'rinish, ham PNG uchun bitta SVG shablon ishlatiladi, shuning uchun yuklab olingan rasm ekrandagidan farq qilmaydi.

## Keyingi bosqich: haqiqiy versiya

1. **Server va baza** (Node + Postgres): klinikalar, brend to'plami, postlar, holatlar.
2. **AI matn.** Hozirgi bank o'rniga Gemini yoki Groq klinika ma'lumotidan yozadi, filtr va qoidalar o'zgarmaydi.
3. **Telegram bot.**
   - Har dushanba 09:00 da paket yuboriladi (cron, Toshkent vaqti).
   - Tugmalar bosilishi qabul qilinadi.
   - Tasdiqlangan post Telegram kanalga joylanadi.
4. **PNG serverda.** Shu SVG shablonlardan `@resvg/resvg-js` bilan.
5. **Lid bot.** Postdagi havola bo'yicha kelganlarni sanaydi va administratorga uzatadi.
6. **Instagram'ga avtomatik joylash.** Meta ruxsatidan keyin; ungacha rasm va matn yuklab olinadi.
7. **Reaktivatsiya.** Bemorlar ro'yxati (Excel yoki DentaCRM API) bo'yicha qaytish xabarlari, faqat egasi tasdiqlagach yuboriladi.
