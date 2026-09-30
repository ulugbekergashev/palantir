# Cerebro

Har qanday biznes uchun AI yordamchi — Telegram'da yashaydigan shaxsiy "Jarvis". Biznes egasi yozadi yoki ovozli xabar yuboradi, Cerebro bajaradi: eslatma qo'yadi, mijozni yozib oladi, mijozlarga xabar tayyorlaydi, shartnoma va tijorat taklifini Word faylda beradi, brend rangida post chizadi, internetdan kerakli ma'lumotni topadi. Tashqariga chiqadigan hamma narsa (kanalga post, mijozga xabar) faqat egasi tugmani bosgandan keyin ketadi.

DentaCRM'dan alohida mahsulot.

## Nima qila oladi

| Imkoniyat | Qanday ishlaydi |
|---|---|
| **Ovozli buyruq** | Telegram'da ovozli xabar yoki paneldagi mikrofon → matn (Gemini, zaxira — Groq Whisper) → yordamchi. Javob boshida nima eshitilgani ko'rsatiladi |
| **Eslatma va vazifalar** | «Ertaga 10 da bankka borishni eslat» → vazifa; vaqti kelganda Telegram'ga eslatma: ✅ Bajarildi · ⏰ 1 soatdan keyin · 📅 Ertaga. Har kuni ertalab qisqa xulosa: bugungi va kechikkan vazifalar, yangi mijozlar, yaqin bayramlar |
| **Hujjat tayyorlash** | Shartnoma, tijorat taklifi, hisob, narxlar ro'yxati, xat, reja — Word (.docx) fayl Telegram'ga keladi va panelda saqlanadi. Noma'lum joylar «________» bo'lib qoladi, o'ylab topilmaydi |
| **Mijozlar va follow-up** | Egasi aytgan mijozlar yoziladi; havolani bosganlar o'zi tushadi (raqam yoki savol qoldiradi). Mijoz yozsa — egasiga keladi, egasi «Reply» qilsa — javob mijozga ketadi. «Kecha yozganlarga rahmat xabarini tayyorla» → qoralama + «Yuborish» tugmasi |
| **Postlar** | Brend rangi va logosi bilan rasm (6 shablon) va matn → «Kanalga joylash». Post ostiga mijozlar havolasi qo'shiladi — kim qaysi postdan kelgani ko'rinadi |
| **Internetdan qidirish** | Kurs, narx, qonun, yetkazib beruvchi — manbasi bilan |
| **Eslab qolish** | «Eslab qol: 500 mingdan yuqori buyurtmaga yetkazish bepul» — hujjat va javoblarda ishlatiladi |

### Qoidalar (kodda)
- **Aytilmagan narsa yozilmaydi.** Yordamchi faqat profil, eslab qolingan faktlar va egasining gapidan foydalanadi; narx, chegirma, raqam o'ylab topilmaydi.
- **Reklama filtri** (`src/lib/compliance.ts`): «eng yaxshi», «100%», «№1», «abadiy»… Tibbiyot sohasida qo'shimcha: natija kafolati, «og'riqsiz». Post va mijozlarga xabar filtrdan o'tmasa, yordamchi qayta yozadi.
- **Egasi tasdiqlamaguncha hech narsa tashqariga chiqmaydi** (kanal, mijozlar). Ikki marta bosilsa ham bir marta ketadi.
- Bizneslar bir-birining ma'lumotini ko'rmaydi (har so'rov tokendagi biznesga bog'langan).

## Ishga tushirish (kompyuterda)

Node.js 24+ kerak.

```bash
npm install
cp .env.example .env      # ADMIN_PASSWORD, BOT_TOKEN, ANTHROPIC_API_KEY, GEMINI_API_KEY
npm run dev               # panel: http://localhost:3100, server: 3200
```

1. `http://localhost:3100/#/admin` → admin paroli → biznes qo'shing (nomi, sohasi, login, parol).
2. `http://localhost:3100` → shu login bilan kiring → «Biznes profili»ni to'ldiring.
3. «Telegram» → «Telegram'da ochish» → botda «Start». Shundan keyin yozing yoki ovozli xabar yuboring.
4. Kanal (ixtiyoriy): botni kanalga admin qiling («xabar joylash» ruxsati) — o'zi ulanadi.

## Serverga qo'yish (masalan, Railway)

- Build: `npm install && npm run build` · Start: `npm start` (panel va API bitta portda).
- O'zgaruvchilar: `.env.example` dagilar. `DATA_DIR` — **doimiy disk** (Railway volume, masalan `/data`): baza (`cerebro.db`) va sessiya kaliti shu yerda. Diskdan muntazam zaxira nusxa oling.
- Bitta nusxa (instance) ishlasin — bot `getUpdates` bilan ishlaydi, ikkita nusxa bir-biriga xalaqit beradi.

## Sinovlar

```bash
npm run typecheck
npm test                           # to'liq oqim: soxta Telegram, Claude va ovoz xizmati bilan
npm run build && npm run test:ui   # brauzerda panel (Chrome va playwright-core kerak)
```

Sinovlar haqiqiy Telegram, Claude yoki Gemini'ga so'rov yubormaydi va pul sarflamaydi. Soxta Claude har so'rovda suhbat tarixini ham tekshiradi: faqat oxiriga qo'shilganmi, har asbob chaqiruvining natijasi joyidami.

## Tuzilma

```
server/
  index.ts       kirish nuqtasi (bot + API + jadval)
  agent.ts       yordamchi: Claude bilan suhbat, asboblarni chaqirish sikli, sessiyalar
  tools.ts       asboblar: vazifa, mijoz, xabar qoralamasi, hujjat, post, eslab qolish, xulosa
  bot.ts         Telegram: egasi (matn, ovoz, tugmalar), mijozlar, kanal
  scheduler.ts   eslatmalar va ertalabki xulosa
  http.ts        panel API
  stt.ts         ovoz → matn (Gemini, zaxira Groq)
  docx.ts        Markdown → Word
  render.ts      post shabloni (SVG) → PNG
  db.ts          SQLite (node:sqlite)
  auth.ts validate.ts env.ts tz.ts
src/
  LiveApp.tsx    kabinet: Yordamchi, Vazifalar, Mijozlar, Hujjatlar, Postlar, Biznes profili, Telegram
  templates/     post shablonlari — panelda, PNG'da va Telegramda bir xil
  lib/compliance.ts  reklama filtri · lib/occasions.ts  bayramlar · lib/recorder.ts  mikrofon → WAV
scripts/
  e2e.ts ui-live.ts fakes.ts   sinovlar
```

## Cheklovlar va keyingi qadamlar
- Mijozga Telegram orqali faqat botga yozgan (havolani bosgan) odamga xabar yuborish mumkin — bu Telegram qoidasi. Qolganlari uchun yordamchi qo'ng'iroq ro'yxatini beradi.
- Instagram'ga avtomatik joylash yo'q (Meta ruxsati kerak) — PNG va matnni yuklab olib joylanadi.
- Google Calendar, SMS va to'lov tizimlari bilan bog'lanish — keyingi bosqich.
