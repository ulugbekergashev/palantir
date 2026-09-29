# Cerebro

Stomatologiya klinikalari uchun AI marketolog va dizayner. Har dushanba klinika egasining Telegramiga haftalik paket keladi: 3 ta post va 2 ta storis, klinika brendida tayyor rasm va matn bilan. Egasi tugma bosib tasdiqlaydi — post belgilangan vaqtda Telegram kanalga chiqadi. Postdagi yozilish havolasi orqali kelgan bemorlar (raqami bilan) egasiga yuboriladi va panelda sanaladi.

DentaCRM'dan alohida mahsulot.

## Nima bor

| Qism | Nima qiladi |
|---|---|
| **Panel** (klinika kabineti) | Haftalik paket (ko'rish, tasdiqlash, boshqa variant, tahrirlash, PNG), Telegram va kanalni ulash, murojaatlar, natijalar, klinika va brend (onboarding) |
| **Telegram bot** (hamma klinikalar uchun bitta) | Egasiga paket; tugmalar: ✅ Joylash · 🔄 Boshqa variant · ✏️ Tahrirlash · ❌ Kerak emas; savollarga javob («Nechta odam yozildi?»); bemordan raqam olib egasiga yuborish |
| **Jadval** | Dushanba 09:00 — paket; vaqti kelgan tasdiqlangan post — kanalga, rasm va matn — egasiga (Instagram uchun) |
| **AI** (Claude) | Haftaning matnlarini klinika faktlaridan yozadi; har matn tekshiriladi, o'tmasa — tayyor namuna |
| **Admin** (`#/admin`) | Klinika qo'shish (login/parol), bloklash, parolni tiklash |
| **Demo** (`#/demo`) | Sotuv uchun: serversiz, namuna klinika bilan |

### Qoidalar (kodda)
- **Klinika aytmagan narsa yozilmaydi.** AI faqat kiritilgan faktlardan yozadi; aksiya, shifokor va bayram postlarida AI yozgan matndagi har bir raqam faktlarda bo'lishi shart, aks holda matn rad etiladi.
- **Tibbiy reklama filtri** (`src/lib/compliance.ts`): «kafolat», «100%», «og'riqsiz», «eng yaxshi», «гарантия»… AI matni ham, egasining tahriri ham tekshiriladi. Ro'yxat dastlabki — yurist bilan tasdiqlanadi.
- **Egasi tasdiqlamaguncha hech narsa chiqmaydi.** Kanalga chiqqan postni panel ham, bot ham o'zgartirmaydi.
- Klinikalar bir-birining ma'lumotini ko'rmaydi (har so'rov tokendagi klinikaga bog'langan).

## Ishga tushirish (kompyuterda)

Node.js 24+ kerak.

```bash
npm install
cp .env.example .env      # ADMIN_PASSWORD, keyin BOT_TOKEN va ANTHROPIC_API_KEY ni yozing
npm run dev               # panel: http://localhost:3100, server: 3200
```

1. `http://localhost:3100/#/admin` → admin paroli → klinika qo'shing (login va parol).
2. `http://localhost:3100` → shu login bilan kiring → «Klinika va brend»ni to'ldiring.
3. «Telegram bot» → «Telegramni ulash» → botda «Start». Shu zahoti shu haftaning paketi keladi.
4. Kanal: botni kanalga admin qiling («xabar joylash» ruxsati) → panelda kanal manzilini kiriting.

Kalitlarsiz ham ishlaydi: `BOT_TOKEN` bo'lmasa — bot o'chiq, `ANTHROPIC_API_KEY` bo'lmasa — matn tayyor namunalardan.

## Serverga qo'yish (masalan, Railway)

- Build: `npm install && npm run build` · Start: `npm start` (panel va API bitta portda).
- O'zgaruvchilar: `.env.example` dagilar. `DATA_DIR` — **doimiy disk** (Railway volume, masalan `/data`): baza (`cerebro.db`) va sessiya kaliti shu yerda. Diskdan muntazam zaxira nusxa oling.
- Bitta nusxa (instance) ishlasin — bot `getUpdates` bilan ishlaydi, ikkita nusxa bir-biriga xalaqit beradi.

## Sinovlar

```bash
npm run typecheck
npm test            # to'liq oqim: soxta Telegram va Claude bilan
npm run build && npm run test:ui   # brauzerda panel (Chrome va playwright-core kerak)
```

Sinovlar haqiqiy Telegram yoki Claude'ga so'rov yubormaydi va pul sarflamaydi.

## Tuzilma

```
server/
  index.ts        kirish nuqtasi (bot + API + jadval)
  http.ts         API: kirish, profil, haftalik paket, amallar, murojaatlar, kanal, admin
  bot.ts          Telegram bot: egasi, bemor (lid), kanalga joylash
  scheduler.ts    har daqiqa: paket yuborish va joylash
  content.ts      haftalik paket = generator rejasi + bazadagi holat/variant/tahrir/AI matni
  ai.ts           Claude: matn yozish (JSON sxema) va savolga javob; tekshiruvlar
  render.ts       SVG shablon → PNG (resvg, server/fonts dagi Manrope)
  db.ts           SQLite (node:sqlite): klinikalar, postlar, murojaatlar
  actions.ts qa.ts auth.ts validate.ts env.ts
src/
  lib/generator.ts   haftaning 5 o'rni: nima, qachon, kim haqida; tayyor post
  lib/content.ts     namuna matnlar banki (uz/ru) — AI bo'lmaganda va rad etilganda
  lib/compliance.ts  tibbiy reklama filtri
  templates/         rasm shablonlari (SVG) — panelda, PNG'da va Telegramda bir xil
  LiveApp.tsx        klinika kabineti · DemoApp.tsx — sotuv demosi · pages/AdminPage.tsx
scripts/
  e2e.ts ui-live.ts fakes.ts   sinovlar
```

## Cheklovlar va keyingi qadamlar

- **Instagram'ga avtomatik joylash** — Meta ruxsatidan keyin. Hozir: post chiqqan zahoti rasm (asl sifat) va matn egasining Telegramiga keladi.
- **Storislar** Telegram kanalga chiqmaydi (Bot API ruxsat bermaydi) — vaqti kelganda rasm egasiga yuboriladi.
- **Ko'rishlar soni** Bot API orqali berilmaydi — «Natijalar» haqiqiy bosish va raqam qoldirganlarni ko'rsatadi.
- Keyin: to'lov va obuna, reaktivatsiya (bemorlar ro'yxati yoki DentaCRM API orqali), klinikaning o'z boti.

Manrope shrifti — SIL Open Font License (`server/fonts/OFL.txt`).
