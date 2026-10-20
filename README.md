# Palantir

Har qanday biznes uchun AI yordamchi — Telegram'da yashaydigan shaxsiy "Jarvis". Biznes egasi yozadi yoki ovozli xabar yuboradi, Palantir bajaradi: eslatma qo'yadi, mijozni yozib oladi, mijozlarga xabar tayyorlaydi, shartnoma va tijorat taklifini Word faylda beradi, internetdan kerakli ma'lumotni topadi. Tashqariga chiqadigan hamma narsa (mijozga xabar, CRM'ga pul yozuvi) faqat egasi tugmani bosgandan keyin ketadi.

DentaCRM'dan alohida mahsulot.

## Nima qila oladi

| Imkoniyat | Qanday ishlaydi |
|---|---|
| **Ovozli buyruq** | Telegram'da ovozli xabar yoki paneldagi mikrofon → matn (Gemini, zaxira — Groq Whisper) → yordamchi. Javob boshida nima eshitilgani ko'rsatiladi |
| **Eslatma va vazifalar** | «Ertaga 10 da bankka borishni eslat» → vazifa; vaqti kelganda Telegram'ga eslatma: ✅ Bajarildi · ⏰ 1 soatdan keyin · 📅 Ertaga. Har kuni ertalab qisqa xulosa: bugungi va kechikkan vazifalar, yangi mijozlar, yaqin bayramlar |
| **Hujjat tayyorlash** | Shartnoma, tijorat taklifi, hisob, narxlar ro'yxati, xat, reja — Word (.docx) fayl Telegram'ga keladi; panelda «Ikkinchi miya» → Hujjatlar'da turadi, matn nusxasi miya papkasining `Hujjatlar/` bo'limiga ham tushadi (bilim emas — modelga o'qib berilmaydi). Noma'lum joylar «________» bo'lib qoladi, o'ylab topilmaydi |
| **Mijozlar va follow-up** | Egasi aytgan mijozlar yoziladi; havolani bosganlar o'zi tushadi (raqam yoki savol qoldiradi). «Kecha yozganlarga rahmat xabarini tayyorla» → qoralama + «Yuborish» tugmasi |
| **Mijozlarga javob (Telegram, Instagram)** | Mijoz botga yoki **Instagram Direct**'ga (rasmiy yo'l — Meta ilovasi, Palantir Hub orqali) yozsa, Palantir javob tayyorlaydi. Egasining **shaxsiy Telegrami** keyinga qoldirilgan (`TG_PERSONAL=1` bilan yoqiladi). Rejim: «Men tasdiqlayman» (egasiga karta + «Yuborish»), «O'zi javob bersin» (egasi N daqiqa ichida yozmasa, Palantir yuboradi; bilmaganini — narx yo'q, chegirma, buyurtma — baribir egasidan so'raydi) yoki «O'chiq». Egasi o'zi yozsa, taklif bekor bo'ladi. Hamma yozishma — panelda «Suhbatlar»da |
| **Internetdan qidirish** | Kurs, narx, qonun, yetkazib beruvchi — manbasi bilan |
| **Klinika: DentaCRM** | Klinika DentaCRM'da ishlasa (bulut yoki klinikadagi kompyuter), «Ulanishlar»da manzil, login va parol kiritiladi. Shundan keyin: «bugun nechta bemor keldi?», «tushum qancha?», «Aliyevni ertaga 15:00 ga Rustamovga yoz» — yordamchi CRM'dan o'qiydi va qabulni CRM'ga yozadi. Ertalabki xulosada bugungi qabullar soni chiqadi |
| **Klinika: davr hisoboti** | «Bu hafta qanday o'tdi?», «O'tgan oy qaysi shifokor ko'p ishladi?» — DentaCRM'dan: qabullar (keldi, kelmadi, bekor), tushum usullar va kunlar bo'yicha, qarzlar, shifokorlar jadvali, eng yaxshi kun, oldingi shunday davr bilan solishtirish. Hafta, oy, oxirgi 7/30 kun yoki aniq sanalar (31 kungacha) |
| **Klinika: nazorat** | Har ertalabki xulosada va so'ralganda: kecha tushum shu hafta kuni uchun odatdagidan ikki baravar kam bo'lsa, ko'p bemor kelmagan yoki ko'p qabul bekor qilingan bo'lsa, kechagi qabullarning holati belgilanmay qolgan bo'lsa, to'lovlar qarzga qolgan bo'lsa, bugungi jadval odatdagidan bo'sh bo'lsa — aytadi. Hammasi joyida bo'lsa jim turadi |
| **Rasmni ko'radi** | Egasi botga surat yuboradi: chek yoki hisob-faktura («shuni xarajatga yoz»), hujjat, narxnoma, qo'lyozma, kabinet yoki ish joyi («toza-mi?»). Palantir rasmdagi yozuv va raqamlarni o'qiydi, xona bo'lsa tozalik va tartibni baholaydi, keyin odatdagidek javob beradi yoki ishni bajaradi |
| **Klinika: pul yozuvlari** | «Ali Valiyev 350 ming to'ladi, karta», «ijaraga 2 million ketdi», «Rustamovga 3 million ulush berdim» — Palantir tekshirilgan kartani ko'rsatadi (bemor, xizmat, shifokor, summa, usul, sana). Egasi «Tasdiqlash»ni bosgandagina DentaCRM'ga yoziladi; shu kuni «Ortga qaytarish» bilan o'chirsa bo'ladi |
| **Klinika: resepshn** | Bemor botga, egasining Telegramiga yoki Instagram'ga oddiy gap bilan yozadi: «ertaga tushdan keyin bo'sh vaqt bormi?». Palantir bo'sh vaqtlarni DentaCRM'dan ko'radi (shifokor jadvali va dam olish kunlari bilan), bemor vaqtni tanlab ism va telefonini bergach — qabulga yozadi. «Men tasdiqlayman» rejimida egasi «Yozish va yuborish»ni bosadi; «O'zi javob bersin»da Palantir o'zi yozadi va egasiga aytadi |
| **Ikkinchi miya** | Bilim bazada emas, oddiy Markdown fayllar papkasida turadi (`DATA_DIR/miya/<biznes>/`) — uni Obsidian'da «Open folder as vault» bilan ochib, havolalari va grafi bilan ko'rish, qo'lda tahrirlash mumkin; `Kutyapti/` dagi faylni `Bilim/Savollar/` ga ko'chirish — tasdiqlash. Panelda ham bitta sahifada ko'rinadi. *Tayyor savollar*: mijozlar eng ko'p so'raydigan narsalar (klinikada 13 ta: to'lov, bo'lib to'lash, bolalar, rentgen…) — egasi bir marta javob yozadi. *O'rganish*: Palantir bilmagan savolni egasidan so'raydi; egasi mijozga javob bergach «Eslab qolaymi?» deydi — ha desa, keyingi mijozga o'zi shunday javob beradi. *Tuzatishlar*: egasi tayyor javob o'rniga boshqacha yozsa, farqi saqlanadi; panelda «O'rgan» desa, keyingi javoblarda hisobga olinadi. *Narxlar*: ro'yxatni Excel yoki Telegram'dan tashlasa bo'ladi («Plomba — 350 000», «Implant 4,5 mln») yoki yordamchiga aytadi. *Uslub* va *hujjat namunalari*. Faktlar: «Eslab qol: 500 mingdan yuqori buyurtmaga yetkazish bepul» |

### Qoidalar (kodda)
- **Aytilmagan narsa yozilmaydi.** Yordamchi faqat profil, eslab qolingan faktlar va egasining gapidan foydalanadi; narx, chegirma, raqam o'ylab topilmaydi.
- **Reklama filtri** (`src/lib/compliance.ts`): «eng yaxshi», «100%», «№1», «abadiy»… Tibbiyot sohasida qo'shimcha: natija kafolati, «og'riqsiz». Mijozlarga xabar filtrdan o'tmasa, yordamchi qayta yozadi; mijozga javob filtrga tushsa — o'zi ketmaydi, egasiga tasdiqqa boradi. Bilimdagi javobda shunday so'z bo'lsa, panel va Telegram egasini ogohlantiradi, ovozli agentga esa bu javob berilmaydi (telefonda tasdiqlatib bo'lmaydi).
- **Tashqariga faqat egasi xohlagani chiqadi.** Ommaviy xabar — faqat tugma bilan. Mijozga javob — egasi tanlagan rejimda; «O'zi javob bersin»da ham faqat faktlardan yoziladi, reklama filtriga tushsa yoki qaror kerak bo'lsa — egasiga. Ikki marta bosilsa ham bir marta ketadi.
- **Keyinga qoldirilgan kanallar** — standart o'chiq va panelda ko'rinmaydi, kod va sinovlari turibdi: shaxsiy Telegram (`TG_PERSONAL=1`), Instagram brauzer orqali (`IG_VIA_BROWSER=1`), Telegram orqali AI qo'ng'iroq (`TG_CALL=1`). Quyidagi ikki band ular yoqilganda amal qiladi.
- **Shaxsiy Telegram**: Palantir egasining akkauntiga kod bilan kiradi («Faol seanslar»da «Palantir»). Kontaktlardagi tanishlarga tegmaydi (sozlamada yoqilmasa), guruh va kanallarga yozmaydi. Sessiya bazada AES-256-GCM bilan shifrlangan. Notanish ro'yxatga ommaviy yozish yo'q — Telegram buning uchun akkauntni bloklaydi.
- **Instagram brauzer orqali** (zaxira yo'l; asosiysi — rasmiy, [docs/INSTAGRAM.md](docs/INSTAGRAM.md)) — Meta ilovasisiz: Palantir shu kompyuterdagi Chrome (yoki Edge)ni alohida profil bilan ochadi, egasi ko'rinadigan oynada o'zi kiradi (parol Palantir'ga berilmaydi), keyin brauzer fonda ishlaydi. Direct'ni (asosiy, «Umumiy», «So'rovlar») ~40 soniyada tekshiradi, javobni suhbatni ochib yozadi. Bu rasmiy yo'l emas — shuning uchun: faqat yozgan odamga javob (birinchi bo'lib yozmaydi), egasi kuzatadigan tanishlarga tegmaydi, kuniga `IG_DAILY_LIMIT` (120) tadan ko'p yozmaydi, kechikishlar tasodifiy. Instagram qayta kirishni so'rasa yoki cheklov qo'ysa — to'xtaydi va egasiga Telegram'da aytadi.
- **DentaCRM**: parol bazada shifrlangan, token faqat xotirada. Yordamchi CRM'dan faqat kerakli maydonlarni oladi (parol xeshi, bot tokeni kabi narsalar tashlanadi), ismlar tozalanib qisqartiriladi. Qabulga yozish — egasining aniq buyrug'i bilan darhol (tugmasiz): band vaqt, ish soati va bemorning shu kundagi yozuvi oldindan tekshiriladi; bir javobda 3 ta, kuniga `CRM_DAILY_BOOKINGS` (40) tadan ko'p yozilmaydi. Summa yoki qabul qatori o'qilmasa, yordamchi taxminiy raqam aytmaydi — xato deydi. Eslatma, 6 oylik chaqiruv va kunlik hisobotni DentaCRM o'zi qiladi — Palantir ularni takrorlamaydi.
- **Pul yozuvlari (to'lov, xarajat, shifokorga to'lov)**: yordamchi CRM'ga o'zi yozmaydi — faqat taklif tayyorlaydi; yozish faqat egasining tugmasi bilan (Telegramdagi shaxsiy chat yoki panel). Kartadagi ism va summalar model matnidan emas, CRM'dan tekshirilgan ma'lumotdan. DentaCRM takroriy so'rovdan himoyalanmagani uchun: yozishdan oldin shu kunda aynan shunday yozuv bor-yo'qligi tekshiriladi; CRM javob bermasa «natijasi noma'lum» deyiladi va qayta urinilmaydi; ikki marta bosilsa bir marta yoziladi; taklif 30 daqiqada eskiradi. Bir javobda 3 ta, kuniga `CRM_DAILY_MONEY` (30) tadan ko'p emas; bitta yozuv `CRM_MAX_AMOUNT` (100 mln), kuniga jami `CRM_DAILY_SUM` (500 mln) so'mgacha; sana — bugundan 31 kun orqagacha. Bir xil taklif ikki marta tayyorlansa — bitta yozuv. Kartada bemorning telefoni oxirgi raqamlari ko'rsatiladi (ismdoshlar adashmasin). Qarzni yopish, avans va bemor hisobidan to'lash yo'q (ular bemor balansini o'zgartiradi) — DentaCRM'da qo'lda. Aralash maoshli shifokorga (oylik + foiz) to'lov ham CRM'da ikkiga bo'lib kiritiladi.
- **Rasm**: faqat egasining shaxsiy chatidan qabul qilinadi (mijoz yuborgan rasm egasiga nusxa bo'lib boradi, o'qilmaydi). Rasm alohida so'rov bilan matnga aylantiriladi; suhbat tarixida va jurnalda rasmning o'zi saqlanmaydi. Rasm ichidagi yozuv yordamchi uchun ma'lumot, ko'rsatma emas. 5 MB gacha.
- **Resepshn (qabulga yozish)**: model faqat taklif qiladi — har bir qabul kodda qayta tekshiriladi: faol shifokor, yaqin 7 kun, jadvaldagi bo'sh vaqt (har 30 daqiqada, kamida 60 daqiqa oldin), ism-familiya va to'liq telefon. Avval CRM'ga yoziladi, keyin bemorga «yozdik» deyiladi; yozib bo'lmasa — aytilmaydi, qaror sababi bilan egasiga o'tadi. Tasdiqdagi kun, vaqt va shifokor model matnidan emas, yozilgan qabuldan olinadi. Model qabul yozmasdan «yozib qo'ydik», «kutamiz» desa (lotin, kirill, ruscha) — javob o'zi ketmaydi.
  - *Bemor kim*: bazadagi bemorga faqat telefon ham, ism-familiya ham mos kelsa yoziladi. Telefon bazada boshqa ism bilan tursa (oila a'zosi yoki xato) — o'zi yozmaydi; egasi tasdiqlasa, shu telefon bilan yangi bemor ochiladi (begona kartaga yozilmaydi).
  - *«O'zi javob bersin» chegaralari*: bir suhbatdan kuniga 2 ta, bir telefonga haftasiga 2 ta, 10 daqiqada 6 ta, kuniga `CRM_PUBLIC_DAILY_BOOKINGS` (15) ta. Oshsa — qabul yo'qolmaydi, egasiga «Yozish va yuborish» tugmasi bilan boradi. Egasi tasdiqlagan qabulga chegara yo'q.
  - Ikki bemor bir vaqtni tanlasa — bittasi yoziladi. Qabul yozilayotgan paytda bemor yana yozsa — xabar egasiga yetkaziladi. Qabul yozilib, xabar bemorga yetmasa — egasiga aytiladi (qabul ikkinchi marta yozilmaydi). Kompyuter qabul yozilayotgan paytda o'chib qolsa — qayta yonganda egasiga «CRM'da tekshiring» deyiladi. Shifokor jadvalidagi ichki izohlar bemorga ko'rsatilmaydi.
  - *O'z qabulini ko'rish, ko'chirish, bekor qilish* — faqat botda va raqam tasdiqlangan bo'lsa: bemor raqamini Telegram'ning «Raqamni yuborish» tugmasi bilan yuborgan (`/raqam` tugmani qayta chiqaradi) va u DentaCRM'dagi bemor raqami bilan bir xil. Yozishmada aytilgan ism va raqam yetmaydi — begona odam boshqaning qabulini ko'chira olmasin. Instagram'da (tasdiqlab bo'lmaydi) qabul haqidagi savol xodimga o'tadi.
  - *Bilib qo'ying*: yozishmadagi telefon tasdiqlanmagan — kimdir boshqa odamning ismi va raqami bilan yozilishi mumkin (telefon orqali yozilgandagi kabi). Shuning uchun klinikada «Men tasdiqlayman» rejimi tavsiya etiladi; «O'zi javob bersin» — yuqoridagi chegaralar bilan.
- **Profil formasi yo'q.** Manzil, ish vaqti, telefon va jamoa — papkadagi `Bilim/Biznes haqida.md` sahifasida (eski profil maydonlari birinchi marta shu sahifaga ko'chiriladi); egasi uni Obsidian'da yoki yordamchiga aytib o'zgartiradi (`write_page`). Panelda faqat «Ulanishlar → Sozlamalar» qoldi: biznes nomi, egasining ismi, soha, til, ertalabki xulosa. Narxlar — aniq jadval, «Ikkinchi miya» sahifasida.
- **Fayl tashlash** (`server/intake/`): egasi suhbatga (paneldagi skrepka yoki Telegram'ga hujjat) PDF, Word (.docx), Excel (.xlsx) yoki matn faylini tashlaydi. Matni o'qiladi (`unpdf`, `mammoth`, `read-excel-file`), asli papkaning `Manbalar/` bo'limiga, matni `Kutyapti/`ga sahifa taklifi bo'lib tushadi. Egasi bir tugma bilan hal qiladi: «Bilimga qo'sh», «Narxlar jadvaliga (N)», «Hujjat namunasi» yoki «Kerak emas» (asli ham o'chadi). Bu yo'lda model yo'q — narxlar matndan qoida bilan o'qiladi, shuning uchun fayl ichidagi gap ko'rsatma bo'la olmaydi. Javobda egasi nimani tasdiqlayotganini ko'radi: matnning boshi, nechta yangi xizmat va qaysi narx o'zgarishi («Plomba: 350 000 → 400 000»). Shu nomli sahifa bor bo'lsa ustidan yozilmaydi — fayl «… (2)» nomi bilan alohida sahifa bo'ladi. Xavfsizlik: fayl alohida ishchi oqimda o'qiladi (`sandbox.ts`) va 20 soniya yoki 1 GB xotiradan oshsa majburan to'xtatiladi; Word/Excel arxivi avval chegara bilan ochilib, halol hajmlar bilan qayta yig'iladi (hajmi haqida yolg'on aytadigan «zip-bomba»ga qarshi); PDF'ning faqat birinchi 60 sahifasi o'qiladi; papkaga tushadigan matn va sarlavhada rasm havolasi va HTML zararsizlantiriladi; fayl nomi va matni tasdiqlanmaguncha hech qaysi modelga berilmaydi (suhbat tarixidan ham). Chegaralar: 10 MB, kuniga 40 ta fayl, `Manbalar/` jami 300 MB; tur kengaytmadan emas, mazmundan aniqlanadi; skan qilingan PDF o'qilmaydi (sahifalari rasm qilib yuboriladi).
- **Birinchi kun suhbati** (`server/brain/interview.ts`): egasi «savollar» deb yozsa (Telegram'da `/savollar`, panelda «Ikkinchi miya» → «Suhbatda so'rab chiq»), Palantir javobi yo'q tayyor savollarni birma-bir o'zi so'raydi. Yozilgan yoki ovoz bilan aytilgan gap javob deb olinadi va darhol bilimga yoziladi (egasining o'z so'zi — tasdiq so'ralmaydi); «keyingi» — o'tkazib yuborish, «to'xta» — tugatish. Savol bilan tugagan gap javob deb yozilmaydi. Suhbat holati bazada turadi — server o'chib yonsa ham joyidan davom etadi. Bu yo'lda ham model chaqirilmaydi.
- **Ikkinchi miya papkasi** (`server/brain/vault.ts`): `Bilim/` — tasdiqlangan (savollar, faktlar, uslub, tuzatishlar, namunalar, egasining o'z sahifalari), `Kutyapti/` — tasdiqni kutayotganlar, `INDEKS.md` va `Narxlar.md` ni Palantir o'zi yozadi. Fayl boshidagi xossalardan faqat `id`, `tur`, `manba`, `sana` o'qiladi, egasi qo'shgan teglar saqlanadi. Narxlar, qabullar va to'lovlar papkada emas — bazada va CRM'da. Eski jadvallardagi bilim birinchi murojaatda fayllarga ko'chiriladi (jadvaldagisi o'chirilmaydi). Nuqtali papkalar (`.obsidian`) va havolalar o'qilmaydi; 200 KB dan katta fayl o'qilmaydi.
- **Ikkinchi miya**: mijozlarga javobda faqat egasi tasdiqlagan bilim ishlatiladi. Egasining bir mijozga bergan javobi («sizga 20% qilaman») u «Eslab qol»ni bosmaguncha boshqa mijozga aytilmaydi; javob berilmagan taklif 14 kunda o'chadi. Savolni model shaxsiy ma'lumotsiz qayta yozadi («Bo'lib to'lash bormi?»), matn bir qatorga va tegsiz holga keltiriladi. Telefonda yozilgan oddiy xabar «tuzatish» emas — faqat aniq bir taklif o'rniga yozilgani, va u ham egasi «O'rgan» demaguncha modelga berilmaydi. «Biznes profili» eski nusxa bilan saqlanmaydi: narxlar shu orada boshqa joyda o'zgargan bo'lsa, server rad etadi. Bilim hajmi chegaralangan (har so'rovda ~12 ming belgi savol-javob, 6 ta tuzatish). Narx ro'yxatidan tushunilmagan qator taxmin qilinmaydi; «bepul» — narx emas, fakt; oraliq («800–900 ming») «boshlang'ich narx» deb yoziladi. Ovozli agent xuddi shu bilimni `GET /api/voice/knowledge` orqali oladi.
- **Mijoz ma'lumotini o'chirish** (`server/forget.ts`): mijoz so'rasa — panelda mijoz kartasi → «Mijozni o'chirish» (ikki bosqichli tasdiq): karta, yozishmalar, javob takliflari, vazifalar, so'rovlar, qo'ng'iroqlar va ularning audio yozuvi o'chadi, yordamchi suhbati yangidan boshlanadi. Instagram akkaunti egasi Meta orqali o'chirishni so'rasa — Hub buyrug'i bilan Instagram'dan kelgan hamma narsa o'chadi ([docs/INSTAGRAM.md](docs/INSTAGRAM.md)). Qoladi: DentaCRM'dagi bemor kartasi, Telegram chatlaridagi eski xabarlar, kunlik zaxiralar (`BACKUP_KEEP` kunda almashadi).
- Bizneslar bir-birining ma'lumotini ko'rmaydi (har so'rov tokendagi biznesga bog'langan).

## Ishga tushirish (kompyuterda)

Node.js 24+ kerak.

```bash
npm install
cp .env.example .env      # ADMIN_PASSWORD, BOT_TOKEN, ANTHROPIC_API_KEY, GEMINI_API_KEY
npm run dev               # panel: http://localhost:3100, server: 3200
```

1. `http://localhost:3100/#/admin` → admin paroli → biznes qo'shing (nomi, sohasi, login, parol).
2. `http://localhost:3100` → shu login bilan kiring → «Ikkinchi miya»da narxlarni tashlang va tayyor savollarga javob yozing (manzil va ish vaqti — papkadagi «Biznes haqida» sahifasida).
3. «Telegram» → «Telegram'da ochish» → botda «Start». Shundan keyin yozing yoki ovozli xabar yuboring.
4. «Sozlamalar»: Instagram (rasmiy ulash — Hub kodi kerak), javob rejimi.

### Instagram uchun bir martalik sozlash (sotuvchi)
- **Rasmiy (asosiy)**: Meta ilovasi va Palantir Hub — qadamlar [docs/INSTAGRAM.md](docs/INSTAGRAM.md) da. Har klinikaga Hub kodi beriladi, u ulash ustasining «Kalitlar» qadamida kiritiladi.
- **Brauzer orqali (zaxira, `IG_VIA_BROWSER=1`)**: kompyuterda Google Chrome yoki Microsoft Edge bo'lsa yetadi (boshqa joyda bo'lsa — `IG_BROWSER`). Oyna Palantir ishlayotgan kompyuterning ekranida ochiladi. Brauzer profili — `DATA_DIR/instagram/`. Muammo bo'lsa `IG_SHOW_BROWSER=1` — brauzer ko'rinib ishlaydi.
- **Shaxsiy Telegram (`TG_PERSONAL=1`)**: my.telegram.org → API development tools → `TG_API_ID`, `TG_API_HASH`. Bitta ilova hamma bizneslar uchun.

## Klinika kompyuteriga o'rnatish (Windows)

`install\Ornatish.cmd` ni ikki marta bosing — to'liq qo'llanma: [docs/ORNATISH.md](docs/ORNATISH.md). O'rnatgich Node.js va ffmpeg'ni tekshiradi, panelni yig'adi,
kalitlarni so'rab `.env` ga yozadi, **har bir kalitni haqiqiy xizmatda tekshiradi** (`npm run check`), papkalarni boshqa Windows foydalanuvchilaridan yopadi va Palantir'ni avtoyuklashga qo'shadi.

Qarovsiz ishlash uchun nima bor:
- **Nazoratchi** (`npm run serve` / `npm run stop` / `npm run status`): server to'xtab qolsa qayta yoqadi; `DATA_DIR/logs/supervisor.log`.
- **Internetsiz yonish**: panel darhol ochiladi, bot va shaxsiy Telegram fonda o'zi ulanadi; uzilish paytidagi eslatma va egasiga aytiladigan xabarlar bazadagi navbatda turadi va aloqa tiklangach ketadi.
- **Bitta papka — bitta nusxa**: shu `DATA_DIR` bilan ikkinchi nusxa ishga tushmaydi (bazani ochmasdan chiqadi).
- **Baza nashri** (`server/migrate.ts`): tuzilmaning qo'shimcha bo'lmagan o'zgarishi raqamli migratsiya bilan bir marta bajariladi, undan oldin bazaning to'liq nusxasi `BACKUP_DIR/oldin-v<N>-….db` ga olinadi. Baza dasturdan yangiroq bo'lsa (dastur eski nashrga qaytarilgan) server ochilmaydi.
- **Jurnal**: `DATA_DIR/logs/KUN.log`, 14 kun; kalitga o'xshagan narsa yozilmaydi. **Zaxira**: har kuni `BACKUP_DIR/KUN/` (baza, ikkinchi miya, maxfiy kalit), 14 kun. Hub kodi bo'lsa — nusxa sotuvchining ochiq kaliti bilan shifrlanib hubga ham yuboriladi (`server/offsite.ts`; ochish — `npm run restore-backup`).
  Tiklash: serverni to'xtating, `DATA_DIR` dagi `cerebro.db-wal` va `cerebro.db-shm` ni o'chiring, zaxiradagi uchta narsani ko'chiring.
- **AI xarajati**: har so'rov biznes hisobiga yoziladi (admin sahifasida 7 kun), kunlik chegaralar — `AI_DAILY_OWNER`, `AI_DAILY_CUSTOMER`, bitta suhbatga kuniga 40 ta javob.
- **IP kameralar (RTSP)**: kamera manzili panelda kiritiladi; alohida jarayon (ffmpeg + odam topuvchi model) kadrlarni kechayu kunduz sanaydi — sahifa ochiq turishi shart emas.

## Serverga qo'yish (masalan, Railway)

- Build: `npm install && npm run build` · Start: `npm start` (panel va API bitta portda).
- `LISTEN_HOST=0.0.0.0` (standart — 127.0.0.1, faqat shu kompyuter) va proksi ortida `TRUST_PROXY=1` (aks holda hamma mijoz bitta manzildan ko'rinadi va kirish chegarasi hammani birga to'sadi).
- O'zgaruvchilar: `.env.example` dagilar. `DATA_DIR` — **doimiy disk** (Railway volume, masalan `/data`): baza (`cerebro.db`) va sessiya kaliti shu yerda. Diskdan muntazam zaxira nusxa oling.
- Bitta nusxa (instance) ishlasin — bot `getUpdates` bilan ishlaydi, ikkita nusxa bir-biriga xalaqit beradi.
- Rasmiy Instagram ekransiz serverda ham ishlaydi (Hub orqali). Brauzer orqali yo'l (`IG_VIA_BROWSER=1`) esa ekranli kompyuter talab qiladi — ulashda oyna ochiladi.

## Sinovlar

```bash
npm run typecheck
npm test                           # to'liq oqim: soxta Telegram, Claude va ovoz xizmati bilan
npm run test:resilience            # chidamlilik: internetsiz yonish, uzilishdagi eslatma, ikkinchi nusxa, jurnal, zaxira
npm run test:ipcam                 # IP kamera zanjiri: ffmpeg → dvigatel → server (ffmpeg kerak; kamera o'rniga sinov tasviri)
npm run test:ui                    # brauzerda panel (Chrome yoki Edge o'zi topiladi, boshqa joyda bo'lsa — CHROME=<yo'l>; avval panelni o'zi yig'adi)
npm run check                      # HAQIQIY kalitlarni tekshiradi (Telegram, Claude — bir necha sent, ovoz); --no-ai bilan Claude'siz
npm run scenarios                  # 22 ta chuqur ssenariy: haqiqiy server + haqiqiy Obsidian (D:\Obsidian; yo'q bo'lsa — to'g'ridan-to'g'ri fayl), model — taqlid
npm run eval:ai                    # AI sifati va narxi: ~60 holat HAQIQIY Claude bilan (avval taxminiy narxni aytadi; --yes — boshlash)
```

**AI baholash** ([scripts/eval-ai.ts](scripts/eval-ai.ts), holatlar — [scripts/eval/cases.ts](scripts/eval/cases.ts)): egasining gaplari
(vazifa, mijoz, narx, hujjat, klinika, pul — o'zbekcha lotin va kirill, ruscha, ovozdan) va mijoz yozishmalari (narx, so'rov, qabul,
inyeksiya, tibbiy maslahat, kafolat, spam). Har holatda chaqirilgan asbob, uning kiritmasi va javob matni tekshiriladi, xarajat dollarda
sanaladi; natija `eval-natijalar/` ga yoziladi. Model yoki fikrlash darajasini almashtirishdan oldin:

```bash
npm run eval:ai -- --yes                                     # hozirgi sozlama (.env dagi AI_MODEL, AI_EFFORT_*)
npm run eval:ai -- --yes --model claude-sonnet-5-5 --compare eval-natijalar/<oldingi>.json
npm run eval:ai -- --yes --only klinika,m-narx-uz --repeat 3 # bir toifa yoki holat, barqarorlikni ko'rish uchun 3 marta
```

Har push va PR'da GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) Windows'da tiplarni va hamma sinov to'plamlarini, Ubuntu'da tiplar va asosiy oqimni ishga tushiradi.
Sinov server modullarini o'z jarayonida import qilsa, birinchi import — `import './isolate'` (`scripts/isolate.ts`): aks holda u haqiqiy `.env` va `data/` dagi bazani ochadi.

### Stend (hamma narsani qo'lda sinab ko'rish — haqiqiy kalitlarsiz)

```bash
npm run build && npm run stend
# tashqi dunyo (siz boshqarasiz):  http://127.0.0.1:3221
# panel (egasining kabineti):      http://127.0.0.1:3220 · login: stend · parol: stend-parol-1
```

Simulyatsiyadan farqi: bu yerda hech narsa ssenariy bo'yicha o'zi bo'lmaydi. «Tashqi dunyo» sahifasida siz mijoz bo'lib botga, egasining shaxsiy Telegramiga yoki Instagram'ga yozasiz; egasi bo'lib yordamchiga buyruq berasiz, kartaga «Reply» qilasiz, tugma bosasiz; CRM'ga qabul qo'shasiz; kreslodagi odamni yoqib-o'chirasiz. Javobni har safar haqiqiy server kodi beradi, natijasi panelda va soxta CRM ichida ko'rinadi. «Tarmoq jurnali» bo'limida server tashqariga yuborgan har bir so'rov turadi (Telegram'ga nima ketdi, CRM'ga nima yozildi, modelga nima berildi).

| | |
|---|---|
| **Haqiqiy** | server, baza, bot mantiqi, yozishma va tasdiqlash, bilim papkasi (Obsidian'da ochsa bo'ladi), eslatmalar va ertalabki xulosa, DentaCRM mijozi, pul yozuvlari va ortga qaytarish, kamera seanslari va CRM bilan solishtirish, ovozli agent darvozasi, panel |
| **Soxta** | Telegram, shaxsiy Telegram, Instagram, DentaCRM (`scripts/fakes.ts`, `scripts/fakeCrm.ts`), ovoz → matn (aytilgan gapni matn bilan yozasiz) |
| **Kamera** | stendda uchta kamera tugma bilan boshqariladi; **haqiqiy** veb-kamerani ham sinasa bo'ladi: panel → «Kameralar» → yangi kamera — odamni brauzerning o'zi taniydi |
| **Model** | `.env`da `ANTHROPIC_API_KEY` bo'lsa — haqiqiy Claude. Bo'lmasa — **taqlid miya** (`scripts/stendBrain.ts`) |

**Taqlid miya nimani ko'rsatmaydi.** U tayyor qoidalar bo'yicha ishlaydi: egasining eng ko'p uchraydigan gaplaridan («Ertaga soat 10 da bankka borishni eslat», «Ali Valiyev 350 ming to'ladi, karta, Rustamov») asbob chaqiruvini yasaydi, mijozga esa faqat modelga berilgan bilimdan javob topadi. Asbobni, kartani, CRM'ga yozishni haqiqiy server bajaradi — shuning uchun tizim *qanday* ishlashi haqiqiy ko'rinadi. Lekin gapni *qanchalik yaxshi* tushunishi, javob matnining sifati, noaniq vaziyatdagi qaror, hujjat yozish, rasmni ko'rish — bular haqiqiy modelning ishi va faqat kalit bilan baholanadi. Taqlid miya yozgan har bir javob 🧪 belgisi bilan boshlanadi; tushunmagan gapini taxmin qilmaydi — ochiq aytadi.

Vaqt: «Sizni kutadi» sozlamasidagi 1 daqiqa — 10 soniya, kamera seansi 3 soniyada boshlanadi; qolgani haqiqiy vaqtda (eslatma aytilgan daqiqada keladi). Ma'lumot `.stend-data` papkasida, har ishga tushganda yangidan boshlanadi; `data/` ga tegilmaydi. Sinovi: `npm run test:stend` (taqlid miya mantiqi + stendning butun yo'li).

Xavfsizligi: ikkala sahifa faqat shu kompyuterdan ochiladi. «Tashqi dunyo» faqat o'z sahifasidan kelgan so'rovni bajaradi — brauzerda ochiq boshqa sayt unga buyruq bera olmaydi va uni ramkaga qo'ya olmaydi; soxta xizmatlar faqat serverning o'zidan so'rov oladi. Haqiqiy kalit bilan ishlaganda panel paroli har safar tasodifiy bo'ladi (terminalda va sahifa tepasida ko'rinadi) — model pul turadi.

### Simulyatsiya (kamerasiz, telefonsiz ko'rish)

```bash
npm run build && npm run demo      # http://127.0.0.1:3210 · login: demo · parol: demo-parol-1
```

Haqiqiy server va panel soxta klinika bilan ishlaydi: kresloga bemor o'tiradi, kassada to'laydi, CRM'da yo'q odam Kabinet 2 da o'tiradi (farq chiqadi), uchta qo'ng'iroq ustma-ust keladi. «Ikkinchi miya» yarim to'ldirilgan: narxlar, bir necha javob, bitta «Eslab qolaymi?» taklifi va egasi yozgan sahifa; papkasi `.demo-data/miya/` ichida (manzili terminalda chiqadi). Vaqt siqilgan — bitta qabul bir daqiqacha. Ma'lumot `.demo-data` papkasida, har ishga tushganda yangidan boshlanadi; asosiy `data/` ga va botga tegilmaydi, server faqat shu kompyuterdan ochiladi.

Sinovlar haqiqiy Telegram, Claude yoki Gemini'ga so'rov yubormaydi va pul sarflamaydi. Soxta Claude har so'rovda suhbat tarixini ham tekshiradi: faqat oxiriga qo'shilganmi, har asbob chaqiruvining natijasi joyidami.

## Tuzilma

```
server/
  index.ts       kirish nuqtasi: jurnal va «bitta nusxa» qulfi, keyin main.ts
  main.ts        tiklash → port → bot va kanallar (fonda), tinch to'xtash
  guard.ts log.ts backup.ts   qulf va ushlanmagan xatolar · fayl jurnali · kunlik zaxira nusxa
  claude.ts      Claude mijozi: har so'rov sanaladi (kunlik chegara, tokenlar, taxminiy xarajat)
  camera/        kameralar: seanslar (sessions.ts), CRM bilan solishtirish (reconcile.ts), IP kamera dvigateli (engine.ts — alohida jarayon, stream.ts — boshqaruv)
  agent.ts       yordamchi: Claude bilan suhbat, asboblarni chaqirish sikli, sessiyalar
  tools.ts       asboblar: vazifa, mijoz, xabar qoralamasi, hujjat, eslab qolish, xulosa
  bot.ts         Telegram: egasi (matn, ovoz, tugmalar), mijozlar, kanal
  scheduler.ts   eslatmalar, ertalabki xulosa, navbatdagi javoblar, Instagram tekshiruvi
  inbox/core.ts          mijozlar bilan yozishma: kanallardan kelgan xabar → javob taklifi → tasdiq yoki o'zi
  inbox/replier.ts       mijozga javob (Claude, qat'iy JSON: reply / ask_owner / ignore)
  inbox/telegramUser.ts  egasining shaxsiy Telegrami (GramJS; sinovda — soxta haydovchi)
  inbox/instagram.ts     egasining Instagrami brauzer orqali (Playwright; sinovda — soxta haydovchi)
  crm/dentacrm.ts        DentaCRM mijozi: kirish, qayta kirish, javoblarni tekshirish, qabulga yozish
  crm/logic.ts           sof qoidalar: bo'sh vaqt, band vaqt, kun hisoboti, bemor qidirish, manzilni tekshirish
  crm/tools.ts           klinika asboblari: clinic_day, find_patient, free_slots, book_appointment
  crm/money.ts           pul yozuvlari: nima yoziladi, takror tekshiruvi, CRM'ga yozish va o'chirish
  crm/actions.ts         pul yozuvining yo'li: taklif → tasdiq → yozildi / ortga qaytarildi
  crm/moneyTools.ts      yordamchining pul asboblari (faqat taklif tayyorlaydi)
  crm/report.ts          davr hisoboti va ogohlantirish qoidalari (sof hisob)
  crm/history.ts         kunlarni CRM'dan yig'ish (DentaCRM faqat kunma-kun beradi)
  crm/reception.ts       resepshn: model uchun bo'sh vaqtlar matni, bemorni topish/yaratish va qabulga yozish
  crm/index.ts routes.ts ulanishni saqlash, panel yo'llari
  secret.ts      maxfiy qiymatlarni shifrlash (Telegram sessiyasi, Instagram tokeni)
  http.ts        panel API
  stt.ts         ovoz → matn (Gemini, zaxira Groq)
  docx.ts        Markdown → Word
  intake/        suhbatga tashlangan fayl: matnini olish (extract.ts), alohida oqimda va chegara bilan (sandbox.ts, extractWorker.ts), bilimga taklif qilish (index.ts)
  db.ts          SQLite (node:sqlite)
  auth.ts validate.ts env.ts tz.ts
src/
  LiveApp.tsx    kabinet: Yordamchi, Jurnal (vazifalar shu yerda), Mijozlar (yozishmalar bilan), Qo'ng'iroqlar, Kameralar, Ikkinchi miya (hujjatlar shu yerda), Ulanishlar
  lib/compliance.ts  reklama filtri · lib/occasions.ts  bayramlar · lib/recorder.ts  mikrofon → WAV
scripts/
  e2e.ts ui-live.ts fakes.ts   sinovlar
  e2e-resilience.ts e2e-ipcam.ts  chidamlilik va IP kamera sinovlari
  supervise.mjs                nazoratchi: serverni yoqadi, to'xtasa qayta yoqadi (npm run serve / stop / status)
  preflight.ts                 o'rnatishdan keyingi tekshiruv — haqiqiy xizmatlarda (npm run check)
  eval-ai.ts eval/cases.ts      AI sifati va narxini baholash — haqiqiy Claude bilan (npm run eval:ai)
install/                       Windows o'rnatgich (Ornatish.cmd), ishga tushirish / to'xtatish / tekshirish yorliqlari
docs/ORNATISH.md               klinikaga o'rnatish qo'llanmasi
  stend.ts stend.html          stend: haqiqiy server + qo'lda boshqariladigan soxta dunyo (npm run stend)
  stendBrain.ts stendParse.ts  taqlid miya (kalit bo'lmaganda model o'rnida) va uning matn o'qishi
  e2e-stend.ts                 stend sinovi
```

## Cheklovlar va keyingi qadamlar
- Post yasash va Telegram kanalga joylash olib tashlangan (Palantir — dizayn dasturi emas); eski bazalardagi postlar jadvali migratsiya v2 bilan o'chiriladi.
- Shaxsiy Telegram keyinga qoldirilgan: mijozga faqat botga yozgan odamga yozish mumkin (Telegram qoidasi). `TG_PERSONAL=1` bilan ulangan bo'lsa — username yoki telefon orqali ham (telefon bo'yicha topilgan odam egasining kontaktlariga qo'shiladi).
- Instagram'da Palantir faqat Direct'ga yozganlarga javob beradi; birinchi bo'lib yozish ataylab yo'q. Rasmiy yo'lda Instagram mijozning oxirgi xabaridan 24 soat ichida (Human Agent bilan — 7 kun) javobga ruxsat beradi. Ovozli xabar va rasm matnga aylantirilmaydi — «[ovozli xabar]» bo'lib keladi.
- Brauzer orqali yo'lda (`IG_VIA_BROWSER=1`) Instagram sayti o'zgarsa, yozish qismi (suhbat oynasi) tuzatishni talab qilishi mumkin.
- DentaCRM: lokal nashr (dentalocal) bilan sinalgan (`npm run crm:probe`, `npm run crm:live`), bulut nashri bilan hali yo'q. Resepshn faqat 30 daqiqalik «Konsultatsiya»ga va faqat yaqin 7 kunga yozadi; qabulni bekor qilish va ko'chirish — CRM'da qo'lda (bemor so'rasa, savol egasiga o'tadi). Bemor telefonini Telegram orqali tasdiqlash hali yo'q. Filial bo'yicha ajratish yo'q. Resepshn haqiqiy model (Claude) bilan hali sinalmagan — sinovlarda soxta model ishlaydi.
- Kameralar: odam topuvchi model odamni tanimaydi (kim ekanini bilmaydi) va kichik yoki qisman to'silgan odamni o'tkazib yuborishi mumkin; haqiqiy IP kamerada hali sinalmagan (zanjir sinov tasviri va surat bilan tekshirilgan). Yengil oqim (substream) tavsiya etiladi.
- Rasmiy Instagram haqiqiy Meta bilan, shaxsiy Telegram haqiqiy akkaunt bilan hali sinalmagan (sinovlarda soxta Meta va soxta haydovchilar).
- Google Calendar, SMS va to'lov tizimlari bilan bog'lanish — keyingi bosqich.
