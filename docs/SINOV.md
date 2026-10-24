# Palantir'ni sinab ko'rish — tartib bilan

Kod tayyor, avtomatik sinovlar o'tadi (Windows va Ubuntu CI). Bu ro'yxat — **haqiqiy hisoblar va uskunalar bilan** qo'lda tekshiriladiganlar. Har bandda: nima qilasiz → nima bo'lishi kerak. Bo'lmasa — `/diagnostika` (botda) va qaysi band ekanini yozing.

1–7-bo'limlar uchun **server (Palantir Hub) kerak emas**: hammasi klinika kompyuterining o'zida ishlaydi. Hub faqat Instagram, telefondan panel, jamoa kirishi va tashqi zaxira uchun — ular oxirgi bo'limda («Keyin»).

## 0. Bir martalik tayyorgarlik

| # | Qilish | Natija |
|---|---|---|
| 0.1 | Ikkita kalitni (`reliz-imzo-kaliti.pem`, `zaxira-kaliti.pem` — `~/.palantir/` da; shu kompyuterda hozircha `~/.cerebro/` da, eski nom) internetsiz joyga nusxalang (fleshka) | Ularsiz yangilanish chiqarib bo'lmaydi va tashqi zaxirani ochib bo'lmaydi |

## 1. Klinika kompyuteri

| # | Qilish | Natija |
|---|---|---|
| 1.1 | `Ornatish.cmd` ([ORNATISH.md](ORNATISH.md)) — «klinikada kecha-kunduz yoqiqmi?» savoliga «ha» | Kompyuter qayta yonganda ekran qulflangan, Palantir esa ishlayapti |
| 1.2 | `install\Tekshirish.cmd` | `[XATO]` yo'q |

## 2. Egasi (Telegram bot)

| # | Qilish | Natija |
|---|---|---|
| 2.1 | Botga: «Ertaga 10 da bankka borishni eslat» (yozib ham, ovoz bilan ham) | Ertaga 10:00 da eslatma tugmalar bilan |
| 2.2 | Panel → Sozlamalar → «Kirish va xavfsizlik» → parolni almashtiring | Boshqa brauzerdagi kirish chiqib ketadi; shu yerda ishlayveradi |
| 2.3 | `/diagnostika` | Bot diagnostika faylini shu chatga yuboradi — muammo bo'lsa, shu faylni sotuvchiga yuborasiz |

## 3. Mijozlar (bot, Telegram Business)

| # | Qilish | Natija |
|---|---|---|
| 3.1 | Boshqa telefondan mijoz havolasini oching, «Raqamni yuborish» | Egasiga «Yangi mijoz», raqam bilan |
| 3.2 | O'sha mijoz: «Ertangi qabulim qachon?» (DentaCRM'da bu raqamli bemorning qabuli bo'lsin) | Javobda qabul vaqti; «ko'chiring» desa — kartada «Ko'chirish va yuborish» |
| 3.3 | Raqamini **yozib** yuborgan boshqa akkaunt xuddi shuni so'rasin | Qabulni ko'rsatmaydi, `/raqam` ni bosishni so'raydi |
| 3.4 | Telegram Premium akkauntingizda: Sozlamalar → Telegram Business → Chat-botlar → botni qo'shing, «javob berish» ruxsati bilan | Botdan «Telegram Business ulandi»; boshqa odam shaxsiy chatingizga yozsa — javob taklifi keladi |
| 3.5 | Panel → mijoz kartasi → «Mijozni o'chirish» | Karta, yozishmalar va qo'ng'iroqlar yo'qoladi |

## 4. Telefon

| # | Qilish | Natija |
|---|---|---|
| 4.1 | Server kompyuterida MicroSIP → Panel → Qo'ng'iroqlar → «Ulash», keyin klinikaga qo'ng'iroq qilib, ko'tarmang | Qabulxonaga «qayta qo'ng'iroq qiling» so'rovi |
| 4.2 | Ko'tarib 15+ soniya gaplashing | Bir necha soniyada egasiga qo'ng'iroq tahlili, panelda yozuv |
| 4.3 | Ikkinchi administrator kompyuteri: Panel → «Kompyuter qo'shish» → o'sha kompyuterda `install\Stansiya.cmd -Server … -Code …` | Panelda «aloqada» |
| 4.4 | Qo'ng'iroq ikkala kompyuterda jiringlasin, ikkinchisida ko'taring | Bitta yozuv «gaplashildi», **so'rov ochilmaydi**; yozuv va tahlil keladi |
| 4.5 | Xodimni kompyuterga biriktiring; so'rov kartasida u «📞 Kompyuterdan» bossin | Raqam aynan uning kompyuterida teriladi |
| 4.6 | AI qabulxona (telefon liniyasi): qo'ng'iroq qiling | Salomlashuvda «Suhbat sifat uchun yozib olinadi» |

## 5. Kameralar (pilot o'lchovi)

| # | Qilish | Natija |
|---|---|---|
| 5.1 | Kamera (yoki «IP Webcam» telefon) ulang, kreslo zonasini shifokorga bog'lang | Kuzatuvchi → «Kompyuter yuklamasi»da kamera ~30 kadr/daq |
| 5.2 | 2–3 kun ishlasin | «Kamera aniqligi — 7 kun»: topildi ≥ 90%, «to'lovsiz» kuniga ≤ 1. Yetmasa — zonani aniqroq chizing |
| 5.3 | Kamerani qo'l bilan yoping 2+ daqiqa | Egasiga «ko'rmay qoldi», ochilgach «yana odatdagidek» |

## 6. AI sifati va narxi

| # | Qilish | Natija |
|---|---|---|
| 6.1 | `npm run eval:ai` (narxni aytadi, ~$3), keyin `npm run eval:ai -- --yes` | `eval-natijalar/` da hisobot; o'tmagan holatlar sababi bilan |
| 6.2 | Arzonroq model bilan solishtirish: `npm run eval:ai -- --yes --model claude-sonnet-5-5 --compare eval-natijalar/<oldingi>.json` | Qaysi holatlar yomonlashgani va narx farqi — modelni almashtirish qarori sizniki |

## 7. Yangilanish va zaxira

| # | Qilish | Natija |
|---|---|---|
| 7.1 | `package.json` dagi versiyani oshiring, `git tag v<versiya> && git push --tags` | GitHub'da imzolangan reliz; klinika kompyuteri kechasi 3:00 da o'zi yangilanadi (`logs\yangilash.log`) |
| 7.2 | Ertasi kuni klinika kompyuterida `C:\PalantirData\backups\` ni oching | Bugungi sana nomli papka: `palantir.db`, `miya`, `session.secret`. Hub'siz zaxira faqat shu kompyuterda — disk buzilsa yo'qoladi, vaqti-vaqti bilan fleshkaga oling ([ORNATISH.md](ORNATISH.md), «Zaxira nusxa») |

## Keyin: Instagram, telefondan panel, jamoa kirishi, tashqi zaxira (Palantir Hub kerak)

Instagram xabarlarni o'zi internetdagi doimiy HTTPS manzilga yuboradi (webhook), klinika kompyuteri esa router ortida — tashqaridan unga kirib bo'lmaydi. Shu manzil — Hub: Meta xabarni hubga beradi, klinika kompyuteri o'zi borib oladi. Hub o'z serverimizda — Oracle Cloud Always Free (Frankfurt, oylik to'lovsiz): `https://92-5-56-138.sslip.io`. `npm run hub:deploy` uni SSH orqali yangilaydi.

| # | Qilish | Natija |
|---|---|---|
| H.1 | Hub'ni joylang yoki yangilang: `HUB_CONTACT_EMAIL=siz@domen.uz HUB_OPERATOR="Kompaniya MChJ" npm run hub:deploy` (server manzili va SSH kaliti — `~/.palantir/`) | Oxirida `Tayyor: https://…` va Meta uchun manzillar. Sirlar — `~/.palantir/hub.env` |
| H.2 | `https://<hub>/privacy` ni oching | Uch tilda siyosat, kompaniya nomi va e-mail bilan |
| H.3 | Meta ilovasi: [docs/INSTAGRAM.md](INSTAGRAM.md) 2-qadam — H.1 chiqargan manzillarni qo'ying; `IG_APP_ID`, `IG_APP_SECRET` bilan `npm run hub:deploy` ni qayta ishga tushiring | `https://<hub>/health` → `"instagram":true,"legal":true` |
| H.4 | Klinika kodi: H.1 oxirida chiqqan `curl …/admin/clinics` buyrug'i → klinika kompyuterida ulash ustasi → kalitlar: Hub kodi | Panel → Sozlamalar → Telegram → «Masofadan kirish»da havola |
| H.5 | Botda pastdagi **«Panel»** tugmasi (yoki `/panel`) | Panel Telegram ichida ochiladi, parol so'ralmaydi |
| H.6 | Instagram'dan klinikaga DM: «Implant qancha?» | Egasiga javob taklifi; «Yuborish» → mijozga Instagram'da javob |
| H.7 | Instagram'dan: «Qabulimni ko'chiring» | Javob xodimga o'tadi (Instagram'da raqam tasdiqlanmaydi) |
| H.8 | Ertasi kuni: `GET /admin/backups` (admin kaliti bilan) | Klinikaning shifrlangan zaxirasi; `npm run restore-backup -- <fayl>` ochadi |
| H.9 | Kompyuterni o'chirib-yoqing | 15 daqiqada sizga (`HUB_ALERT_CHAT`) «aloqa yo'q», yongach «yana aloqada» |
| H.10 | O'z kompyuteringizda `https://<hub>/admin` → admin kaliti (`~/.palantir/hub.env` dagi `HUB_ADMIN_KEY`) → klinika yonida **«Panelni ochish»** | Yangi oynada klinika paneli, parolsiz: bosh sahifa, kameralar (kadr, hozir nechta odam), «Tarmoqdan qidirish» — klinika tarmog'ini klinikadagi kompyuter qidiradi; ulash ustasi ham ochiq |
| H.11 | Klinikada egasi: Sozlamalar → Telegram → «Masofadan kirish» → «Palantir jamoasi» | H.10 dagi kirish vaqti bilan yozilgan; «O'chirish» → H.10 dagi oyna «qayta kiring», tugma «egasi o'chirgan» deydi |
