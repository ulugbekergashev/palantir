# Cerebro

Har qanday biznes uchun AI yordamchi — Telegram'da yashaydigan shaxsiy "Jarvis". Biznes egasi yozadi yoki ovozli xabar yuboradi, Cerebro bajaradi: eslatma qo'yadi, mijozni yozib oladi, mijozlarga xabar tayyorlaydi, shartnoma va tijorat taklifini Word faylda beradi, brend rangida post chizadi, internetdan kerakli ma'lumotni topadi. Tashqariga chiqadigan hamma narsa (kanalga post, mijozga xabar) faqat egasi tugmani bosgandan keyin ketadi.

DentaCRM'dan alohida mahsulot.

## Nima qila oladi

| Imkoniyat | Qanday ishlaydi |
|---|---|
| **Ovozli buyruq** | Telegram'da ovozli xabar yoki paneldagi mikrofon → matn (Gemini, zaxira — Groq Whisper) → yordamchi. Javob boshida nima eshitilgani ko'rsatiladi |
| **Eslatma va vazifalar** | «Ertaga 10 da bankka borishni eslat» → vazifa; vaqti kelganda Telegram'ga eslatma: ✅ Bajarildi · ⏰ 1 soatdan keyin · 📅 Ertaga. Har kuni ertalab qisqa xulosa: bugungi va kechikkan vazifalar, yangi mijozlar, yaqin bayramlar |
| **Hujjat tayyorlash** | Shartnoma, tijorat taklifi, hisob, narxlar ro'yxati, xat, reja — Word (.docx) fayl Telegram'ga keladi va panelda saqlanadi. Noma'lum joylar «________» bo'lib qoladi, o'ylab topilmaydi |
| **Mijozlar va follow-up** | Egasi aytgan mijozlar yoziladi; havolani bosganlar o'zi tushadi (raqam yoki savol qoldiradi). «Kecha yozganlarga rahmat xabarini tayyorla» → qoralama + «Yuborish» tugmasi |
| **Mijozlarga javob (Telegram, Instagram)** | Mijoz botga, egasining **shaxsiy Telegramiga** yoki **Instagram Direct**'ga yozsa, Cerebro javob tayyorlaydi. Rejim: «Men tasdiqlayman» (egasiga karta + «Yuborish»), «O'zi javob bersin» (egasi N daqiqa ichida yozmasa, Cerebro yuboradi; bilmaganini — narx yo'q, chegirma, buyurtma — baribir egasidan so'raydi) yoki «O'chiq». Egasi o'zi yozsa, taklif bekor bo'ladi. Hamma yozishma — panelda «Suhbatlar»da |
| **Postlar** | Brend rangi va logosi bilan rasm (6 shablon) va matn → «Kanalga joylash». Post ostiga mijozlar havolasi qo'shiladi — kim qaysi postdan kelgani ko'rinadi |
| **Internetdan qidirish** | Kurs, narx, qonun, yetkazib beruvchi — manbasi bilan |
| **Eslab qolish** | «Eslab qol: 500 mingdan yuqori buyurtmaga yetkazish bepul» — hujjat va javoblarda ishlatiladi |

### Qoidalar (kodda)
- **Aytilmagan narsa yozilmaydi.** Yordamchi faqat profil, eslab qolingan faktlar va egasining gapidan foydalanadi; narx, chegirma, raqam o'ylab topilmaydi.
- **Reklama filtri** (`src/lib/compliance.ts`): «eng yaxshi», «100%», «№1», «abadiy»… Tibbiyot sohasida qo'shimcha: natija kafolati, «og'riqsiz». Post va mijozlarga xabar filtrdan o'tmasa, yordamchi qayta yozadi.
- **Tashqariga faqat egasi xohlagani chiqadi.** Kanalga post va ommaviy xabar — faqat tugma bilan. Mijozga javob — egasi tanlagan rejimda; «O'zi javob bersin»da ham faqat faktlardan yoziladi, reklama filtriga tushsa yoki qaror kerak bo'lsa — egasiga. Ikki marta bosilsa ham bir marta ketadi.
- **Shaxsiy Telegram**: Cerebro egasining akkauntiga kod bilan kiradi («Faol seanslar»da «Cerebro»). Kontaktlardagi tanishlarga tegmaydi (sozlamada yoqilmasa), guruh va kanallarga yozmaydi. Sessiya bazada AES-256-GCM bilan shifrlangan. Notanish ro'yxatga ommaviy yozish yo'q — Telegram buning uchun akkauntni bloklaydi.
- **Instagram** — faqat rasmiy yo'l (Instagram Login): parol saqlanmaydi; mijoz yozgandan keyin 24 soat ichida javob beriladi (Instagram qoidasi).
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
4. «Ulanishlar»: shaxsiy Telegram (raqam → kod → bo'lsa parol), Instagram («Instagram bilan kirish»), javob rejimi.
5. Kanal (ixtiyoriy): botni kanalga admin qiling («xabar joylash» ruxsati) — o'zi ulanadi.

### Shaxsiy Telegram va Instagram uchun bir martalik sozlash (sotuvchi)
- **Telegram**: my.telegram.org → API development tools → `TG_API_ID`, `TG_API_HASH`. Bitta ilova hamma bizneslar uchun.
- **Instagram**: developers.facebook.com → ilova → Instagram → «API setup with Instagram login». `IG_APP_ID`, `IG_APP_SECRET`; OAuth redirect: `PUBLIC_URL/api/instagram/callback`; webhook: `PUBLIC_URL/api/instagram/webhook` (`messages` maydoni, verify token — `IG_WEBHOOK_VERIFY_TOKEN`). Meta tekshiruvigacha ilova faqat unga qo'shilgan (tester) akkauntlar bilan ishlaydi va webhook kelmaydi — Cerebro o'shanda xabarlarni har 30 soniyada o'zi tekshiradi. Boshqa bizneslarga sotish uchun: biznes tasdiqlash + `instagram_business_manage_messages` uchun Advanced Access (App Review).

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
  scheduler.ts   eslatmalar, ertalabki xulosa, navbatdagi javoblar, Instagram tekshiruvi
  inbox/core.ts          mijozlar bilan yozishma: kanallardan kelgan xabar → javob taklifi → tasdiq yoki o'zi
  inbox/replier.ts       mijozga javob (Claude, qat'iy JSON: reply / ask_owner / ignore)
  inbox/telegramUser.ts  egasining shaxsiy Telegrami (GramJS; sinovda — soxta haydovchi)
  inbox/instagram.ts     Instagram Login, webhook, suhbatlarni tekshirish, Direct'ga yuborish
  secret.ts      maxfiy qiymatlarni shifrlash (Telegram sessiyasi, Instagram tokeni)
  http.ts        panel API
  stt.ts         ovoz → matn (Gemini, zaxira Groq)
  docx.ts        Markdown → Word
  render.ts      post shabloni (SVG) → PNG
  db.ts          SQLite (node:sqlite)
  auth.ts validate.ts env.ts tz.ts
src/
  LiveApp.tsx    kabinet: Yordamchi, Suhbatlar, Vazifalar, Mijozlar, Hujjatlar, Postlar, Biznes profili, Ulanishlar
  templates/     post shablonlari — panelda, PNG'da va Telegramda bir xil
  lib/compliance.ts  reklama filtri · lib/occasions.ts  bayramlar · lib/recorder.ts  mikrofon → WAV
scripts/
  e2e.ts ui-live.ts fakes.ts   sinovlar
```

## Cheklovlar va keyingi qadamlar
- Shaxsiy Telegram ulanmagan bo'lsa, mijozga faqat botga yozgan odamga yozish mumkin (Telegram qoidasi). Ulangan bo'lsa — username yoki telefon orqali ham (telefon bo'yicha topilgan odam egasining kontaktlariga qo'shiladi).
- Instagram'da birinchi bo'lib yozib bo'lmaydi va 24 soatdan keyin javob berib bo'lmaydi (Meta qoidasi).
- Instagram'ga avtomatik joylash yo'q (Meta ruxsati kerak) — PNG va matnni yuklab olib joylanadi.
- Google Calendar, SMS va to'lov tizimlari bilan bog'lanish — keyingi bosqich.
