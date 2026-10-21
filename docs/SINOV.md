# Palantir'ni sinab ko'rish — tartib bilan

Kod tayyor, avtomatik sinovlar o'tadi (Windows va Ubuntu CI). Bu ro'yxat — **haqiqiy hisoblar va uskunalar bilan** qo'lda tekshiriladiganlar. Har bandda: nima qilasiz → nima bo'lishi kerak. Bo'lmasa — `/diagnostika` (botda) va qaysi band ekanini yozing.

## 0. Bir martalik tayyorgarlik (sizning hisoblaringiz)

| # | Qilish | Natija |
|---|---|---|
| 0.1 | Ikkita kalitni (`~/.cerebro/reliz-imzo-kaliti.pem`, `~/.cerebro/zaxira-kaliti.pem`) internetsiz joyga nusxalang (fleshka) | Ularsiz yangilanish chiqarib bo'lmaydi va tashqi zaxirani ochib bo'lmaydi |
| 0.2 | Terminalda: `railway login` (brauzerda tasdiqlang), keyin `HUB_CONTACT_EMAIL=siz@domen.uz HUB_OPERATOR="Kompaniya MChJ" npm run hub:deploy` | Oxirida `Tayyor: https://….up.railway.app` va Meta uchun manzillar. Sirlar — `~/.palantir/hub.env` |
| 0.3 | `https://<hub>/privacy` ni oching | Uch tilda siyosat, kompaniya nomi va e-mail bilan |
| 0.4 | Meta ilovasi: [docs/INSTAGRAM.md](INSTAGRAM.md) 2-qadam — 0.2 chiqargan manzillarni qo'ying; `IG_APP_ID`, `IG_APP_SECRET` bilan `npm run hub:deploy` ni qayta ishga tushiring | `https://<hub>/health` → `"instagram":true,"legal":true` |
| 0.5 | Klinika kodi: 0.2 oxirida chiqqan `curl …/admin/clinics` buyrug'i | `phub.…` kod — klinika kompyuterida ulash ustasiga kiritiladi |

## 1. Klinika kompyuteri

| # | Qilish | Natija |
|---|---|---|
| 1.1 | `install\Ornatish.cmd` ([ORNATISH.md](ORNATISH.md)) — avtokirishga «ha» | Kompyuter qayta yonganda ekran qulflangan, Palantir esa ishlayapti |
| 1.2 | `install\Tekshirish.cmd` | `[XATO]` yo'q |
| 1.3 | Ulash ustasi → kalitlar: Hub kodi (0.5) | Panel → Sozlamalar → Telegram → «Masofadan kirish»da havola |
| 1.4 | Kompyuterni o'chirib-yoqing | 15 daqiqada sizga (`HUB_ALERT_CHAT`) «aloqa yo'q», yongach «yana aloqada» |

## 2. Egasi (Telegram bot)

| # | Qilish | Natija |
|---|---|---|
| 2.1 | Botga: «Ertaga 10 da bankka borishni eslat» (yozib ham, ovoz bilan ham) | Ertaga 10:00 da eslatma tugmalar bilan |
| 2.2 | Botda pastdagi **«Panel»** tugmasi (yoki `/panel`) | Panel Telegram ichida ochiladi, parol so'ralmaydi |
| 2.3 | Panel → Sozlamalar → «Kirish va xavfsizlik» → parolni almashtiring | Boshqa brauzerdagi kirish chiqib ketadi; shu yerda ishlayveradi |
| 2.4 | `/diagnostika` | Hub bo'lsa — «hubga yuborildi»; sotuvchi `/admin/diag` dan o'qiydi |

## 3. Mijozlar (bot, Instagram, Telegram Business)

| # | Qilish | Natija |
|---|---|---|
| 3.1 | Boshqa telefondan mijoz havolasini oching, «Raqamni yuborish» | Egasiga «Yangi mijoz», raqam bilan |
| 3.2 | O'sha mijoz: «Ertangi qabulim qachon?» (DentaCRM'da bu raqamli bemorning qabuli bo'lsin) | Javobda qabul vaqti; «ko'chiring» desa — kartada «Ko'chirish va yuborish» |
| 3.3 | Raqamini **yozib** yuborgan boshqa akkaunt xuddi shuni so'rasin | Qabulni ko'rsatmaydi, `/raqam` ni bosishni so'raydi |
| 3.4 | Instagram'dan klinikaga DM: «Implant qancha?» | Egasiga javob taklifi; «Yuborish» → mijozga Instagram'da javob |
| 3.5 | Instagram'dan: «Qabulimni ko'chiring» | Javob xodimga o'tadi (Instagram'da raqam tasdiqlanmaydi) |
| 3.6 | Telegram Premium akkauntingizda: Sozlamalar → Telegram Business → Chat-botlar → botni qo'shing, «javob berish» ruxsati bilan | Botdan «Telegram Business ulandi»; boshqa odam shaxsiy chatingizga yozsa — javob taklifi keladi |
| 3.7 | Panel → mijoz kartasi → «Mijozni o'chirish» | Karta, yozishmalar va qo'ng'iroqlar yo'qoladi |

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
| 7.2 | Ertasi kuni: `GET /admin/backups` (admin kaliti bilan) | Klinikaning shifrlangan zaxirasi; `npm run restore-backup -- <fayl>` ochadi |
