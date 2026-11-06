# Raqiblar foydalanuvchilari nimadan norozi — va Palantir nima qiladi (replica-entrepreneur)

Sana: 2026-11-06. Hamma iqtibos so'zma-so'z va havolali, `replica/reviews-*.csv` dan; mavzular `reviews.py --themes replica/themes.json` bilan.

**Namuna:**
- **Kommo / amoCRM** — 411 sharh, 4 manba (App Store 369, crmindex.ru 33, Trustpilot 8, Hacker News 1), 202 tasi so'nggi 18 oyda. Tillar: rus, portugal, ispan, ingliz.
- **Weave** — 508 sharh, 2 manba (App Store 500, Trustpilot 8). Faqat 29 tasi so'nggi 18 oyda va deyarli hammasi **mobil ilova** haqida — shuning uchun Weave mavzulari «thin» (bitta manba). Ishonchli xulosa emas, yo'nalish.
- Capterra, G2 (403), TrustRadius (Cloudflare), Reddit (403) — bloklangan, o'qilmadi.

## 1. Nimadan norozi

| # | muammo | sharhlar (manba) | iqtibos | Palantir'da |
| --- | --- | --- | --- | --- |
| 1 | Xatolar, qulash | Kommo 104 (3), Weave 40 (2) | «Вылетает.» — [App Store](https://apps.apple.com/kz/app/id1128315486?see-all=reviews#review-13208461528) | asosiy e2e 756 ta tekshiruv + jami 49 ta test fayli; yangilanish ishga tushmasa eskisiga qaytadi (`scripts/update.mjs:292–306`) |
| 2 | Yordam javob bermaydi | Kommo 92 (2), Weave 39 (1, thin) | «В поддержке тишина!!» — [App Store](https://apps.apple.com/ru/app/id1128315486?see-all=reviews#review-14658527839); «Customer support is non existent.» — [App Store](https://apps.apple.com/us/app/id1030476630?see-all=reviews#review-7030309359) | Jamoa kirishi bor (egasi roziligi bilan, `server/supportAsk.ts`), lekin **«Yordam so'rash» tugmasi yo'q** → F3 |
| 3 | Yangilanish buzdi | Kommo 44 (2), Weave 7 (1) | «Откатите обновление.» — [App Store](https://apps.apple.com/ru/app/id1128315486?see-all=reviews#review-9489788056) | Server ishga tushmasa — qaytaradi ✅. Ishga tushib, lekin bitta funksiya buzilsa — qaytarmaydi (faqat `/api/health`) |
| 4 | Bildirishnoma kelmaydi | Kommo 24 (2), Weave 21 (1) | «уведомления приходят через раз.» — [crmindex](https://crmindex.ru/products/amo_crm/reviews#1957); «Calls never actually ring and show notification on the app.» — [App Store](https://apps.apple.com/us/app/id1030476630?see-all=reviews#review-8753634944) | Hamma ogohlantirish Telegram'da — o'z ilovasining push'iga bog'liq emas ✅ |
| 5 | Narx va qo'shimcha to'lov | Kommo 21 (2) | «Весь интерес в автоматизации, но самые хорошие виджеты стоят дополнительных денег.» — [crmindex](https://crmindex.ru/products/amo_crm/reviews#1035) | Kommo recon: AI agent faqat Advanced'dan, chatda qabul va ovozli xabar — faqat Pro'da; amoCRM Про 259 000 so'm/xodim/oy, AI tokenlar alohida |
| 6 | Chatlar yo'qoladi, kanal uziladi | Kommo 8 (1, thin) + qo'lda o'qilganlar | «Проблема с чатами. Почему не отображаются все беседы с клиентом…» — [App Store](https://apps.apple.com/ru/app/id1128315486?see-all=reviews#review-13527056304) | Kanallar nazorati: uzilsa egasiga bir marta (`server/monitor.ts`, test:dashboard) ✅ |
| 7 | Boshqa xodim ko'targanda ham jiringlayveradi | Weave (thin) | «Phone doesn’t stop ringing on your phone when another employee answers from theirs.» — [App Store](https://apps.apple.com/us/app/id1030476630?see-all=reviews#review-10125112453) | Jurnal to'g'ri: ko'targan kompyuterniki (`phone/stations.ts`). Jiringlashni to'xtatish — SIP liniyaning ishi |
| 8 | **AI noto'g'ri ma'lumot berdi — pul begona hisobga ketdi** | Kommo 1 (thin, lekin eng og'ir oqibat) | «The AI agent started giving wrong information. Clients paid to accounts that I don’t know and Ive never used before. It gave wrong prices and wrong address.» — [App Store](https://apps.apple.com/pe/app/id6443626329?see-all=reviews#review-13525130782) | Narx/chegirma filtri bor edi; **telefon, karta, hisob raqami filtri qo'shildi** (dd727b0) ✅ |

## 2. Nima yetishmaydi (parity + so'rovlar)

Parity: Kommo'ga nisbatan **60.4**, Weave'ga **57.6** (`replica/kommo/parity.md`, `replica/weave/parity.md`). Ikkalasida ham must, Palantir'da yo'q yoki yarim:

| funksiya | Kommo | Weave | o'lcham | izoh |
| --- | --- | --- | --- | --- |
| Tayyor javob shablonlari | must, yo'q | must, yo'q | S | xodim tez javob berishi uchun |
| Qidiruv: suhbat, qo'ng'iroq, mijoz | partial | partial | S | hozir faqat turi bo'yicha filtr |
| Qo'ng'iroqda bemor kartasi (ism, keyingi qabul, qarz) | must, partial | must, partial | M | panelda «jiringlayapti» bor, alohida oyna yo'q |
| Javobga rasm/fayl | must, yo'q | should, yo'q | S–M | narx ro'yxati, yo'l xaritasi |
| Mijozning ovozli xabari | should, yo'q | — | S–M | Kommo'da faqat Pro tarifda |
| O'tkazib yuborilgan qo'ng'iroqqa avtomatik xabar | — | must, partial | M | SMS yo'q; Telegram'i ulangan bemorga yozish mumkin |
| Kanban pipeline | must, yo'q | — | L | **qurmaslik tavsiya**: voronka DentaCRM'da, Palantir AI-first |
| Kalendar ko'rinishi | must, yo'q | should, partial | M | jadval DentaCRM'da — takrorlash shartmi, egasi hal qiladi |

So'rovlardan (o'z so'zlari bilan): qorong'i mavzu (Kommo'da 4 ta sharhda, masalan «Добавьте, пожалуйста, темную тему») — Palantir AI ekrani qorong'i, ish yuzasi och; planshet/iPad versiyasi (16, thin) — Palantir veb, planshetda ishlaydi ✅; «La app no tiene nada que ver con la versión web.» — [App Store](https://apps.apple.com/ar/app/id1128315486?see-all=reviews#review-14386417862) — Palantir'da telefon uchun alohida ilova yo'q, panelning o'zi (Mini App) ✅.

## 3. Nima hal qilinmagan — pozitsiya uchun

- **Telegram va o'zbek tili.** Kommo: Telegram — faqat bot, bitta pipeline'ga bitta Telegram (`kommo/features.csv`, 4-qator). Weave: faqat AQSh SMS va ingliz/ispan. O'zbekistondagi klinika uchun asosiy kanal ikkalasida ham ikkinchi darajali.
- **Mahalliy stomatologiya CRM'i.** Weave Dentrix/Eaglesoft bilan, Kommo umumiy. DentaCRM'ga qabul va pul yozadigan, undan hisobot oladigan hech biri yo'q.
- **AI'ga ishonch.** Raqiblarda AI «24/7 javob beradi» deb sotiladi; nima o'ylab topsa — mijozga ketadi (8-qator).

## 4. Tuzatishlar rejasi

| # | nima | o'lcham | skill | dalil | holat |
| --- | --- | --- | --- | --- | --- |
| F1 | Bilimda yo'q telefon / karta / hisob raqami — mijozga o'zi ketmaydi | S | replica-backend | 1-jadval, 8-qator | ✅ dd727b0 + kod ko'rigi tuzatishi (ajratgichlar, oraliqlar, aniq moslik) |
| F2 | Kiritish maydonlari chegarasi 3:1 (WCAG) | S | replica-design | `contrast.py`: 1.67:1 edi | ✅ 54d8385 |
| F3 | «Yordam so'rash» tugmasi: panel va botdan → Palantir jamoasiga (Hub `/admin`), javob egasining Telegramiga | S–M | replica-build | Kommo 92 + Weave 39 sharh | taklif |
| F4 | Mijozning ovozli xabari → matn → Qabulxona. Telefon raqami ovozdan olinmaydi (STT xato eshitsa — begona karta): qabul uchun «Raqamni yuborish» tugmasi | S–M | replica-build | Kommo matritsasi (Pro'da) | taklif — **egasi qarori**: har ovoz Gemini kalitidan pul |
| F5 | Tayyor javob shablonlari + suhbat, qo'ng'iroq, mijoz qidiruvi | S | replica-build | ikkala matritsada must | taklif |
| F6 | Qo'ng'iroqda bemor kartasi: ism, keyingi qabul, qarz (DentaCRM'dan) — paneldagi oyna va kompyuter bildirishnomasi | M | replica-build | ikkala matritsada must; Weave «Calls never actually ring…» | taklif |
| F7 | UI testlarda 5xx yiqitadi; «faqat klaviatura bilan qabulga yozish» stsenariysi | S | replica-test | `replica/test-plan.md` T1, T2 | taklif |

## 5. Pozitsiya

A. Klinika egasi uchun, amoCRM'da har xodimga alohida to'lab, AI'ga yana token sotib olishdan charchaganlar uchun: Palantir — klinikaga bitta narx, AI qabulxona ichida, Telegram'da o'zbek tilida.
Dalil: narx 21 sharh, 2 manba + Kommo/amoCRM tarif sahifalari (recon).

**B (tavsiya).** AI'ga mijozni ishonib topshirishdan qo'rqadigan klinika egasi uchun: Palantir faqat siz tasdiqlagan bilimdan javob beradi. Narx, chegirma, telefon yoki karta raqami bilimda bo'lmasa — mijozga ketmaydi, sizga keladi; qabul DentaCRM'ga yozilmaguncha «yozdik» deyilmaydi.
Dalil: 8-qator (1 sharh — thin, lekin raqib AI'sining eng og'ir xatosi) + Palantir'ning kodda tekshiriladigan qoidalari (README «Qoidalar»). Bu raqiblar osongina takrorlay olmaydigan farq.

C. Yordam kutib qolganlar uchun: Palantir'ni o'rnatgan odam Telegram'da javob beradi; panelga kirish — faqat sizning ruxsatingiz bilan.
Dalil: yordam 92 + 39 sharh. F3 qurilgandan keyin.

Raqiblar nomi Palantir reklamasida va tavsifida ishlatilmaydi (replica-launch qoidasi); solishtirish sahifasi — yurist bilan.
