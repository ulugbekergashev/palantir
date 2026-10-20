# Cerebro'ni klinikaga o'rnatish

Bu qo'llanma o'rnatuvchi uchun: klinikaga borishdan oldin nima tayyorlash, joyida nima qilish va ketishdan oldin nimani tekshirish.
Bir klinika — bitta kompyuter — bitta bot. O'rnatish 30–40 daqiqa oladi (internet tezligiga qarab).

## 1. Borishdan oldin tayyorlang

**Anketa (2–3 kun oldin).** O'zingizning Cerebro serveringizda (internetdan ochiladigan, masalan cloudflared orqali): `/#/admin` → «Anketalar» → klinika nomi → «Anketa yaratish». Havola va kod nusxalanadi — egasiga Telegram'da yuboring.
Egasi telefonidan 10–15 daqiqada to'ldiradi: manzil, ish vaqti, narxlar, ko'p so'raladigan savollar, nimalari bor (Instagram, Telegram raqami, DentaCRM, kameralar). Parol va token anketaga **yozilmaydi** — yozsa, anketa saqlanmaydi.
Admin sahifasidagi ro'yxatda holati ko'rinadi: «ochilmagan», «to'ldirilmoqda», «yuborilgan». Anketa 60 kundan keyin o'zi o'chadi.
Anketa serveri tunnel yoki proksi ortida tursa (cloudflared, nginx), uning `.env` ida `TRUST_PROXY=1` qiling: aks holda noto'g'ri kod urinishlari hamma egalar uchun bitta deb sanaladi va 8 ta xato kod hammaning anketasini 15 daqiqaga yopib qo'yadi. Bir nechta biznesga xizmat qiladigan umumiy serverda `CRM_ALLOW_PRIVATE=0` ham qiling — anketa, DentaCRM va kameralar ichki tarmoq manzillariga ulanmaydi.

| Nima | Qayerdan | Nima uchun |
|---|---|---|
| **Telegram bot tokeni** | @BotFather → `/newbot` (har klinikaga alohida bot) | Egasi yordamchi bilan shu botda gaplashadi; bemorlar ham shu botga yozadi |
| **Claude API kaliti** | platform.claude.com → API keys. Hisobda mablag' bo'lsin | Yordamchining «miyasi». Kalitda oylik chegara (spend limit) qo'ying |
| Gemini kaliti (ixtiyoriy, bepul) | aistudio.google.com | Ovozli xabarlarni matnga aylantiradi. Bo'lmasa ovoz o'chiq |
| DentaCRM manzili, login, parol | Klinikadan | Qabullar, bemorlar, tushum |
| Cerebro Hub kodi (`chub.…`) va klinikaning **professional** Instagram akkaunti | Hub kodi — sizdan ([INSTAGRAM.md](INSTAGRAM.md), 4-qadam); akkaunt Meta ilovasida tester bo'lishi kerak | Direct'ga rasmiy yo'l bilan javob. Login-parol Cerebro'ga berilmaydi |
| Kameralarning RTSP manzili (yoki HTTP/MJPEG manzili) | Kamerani o'rnatgan usta yoki videoregistrator sozlamalari. Kamera yo'q kabinetga — eski Android telefon («IP Webcam» ilovasi) | Kamera nazorati |

| Uztelecom SIP: server manzili, login, parol, raqam (ixtiyoriy) | Klinika Uztelecom'dan oladi (yuridik shaxs) | Shahar raqamiga AI qabulxona javob beradi |

Klinikadagi kompyuter: Windows 10 yoki 11 (64-bit), 8 GB xotira, doim yoniq va internetga ulangan, Google Chrome yoki Edge o'rnatilgan.
Telefon liniyasi uchun yana: BIOS'da virtualizatsiya (VT-x / AMD-V) yoqilgan va o'rnatuvchida administrator huquqi bo'lsin.
**Kompyuter o'chiq yoki uyquda bo'lsa — Cerebro ishlamaydi** (kechasi AI qabulxona ham javob bermaydi): BIOS'da «svet kelganda yoqilsin»
(Restore on AC power loss → Power On) sozlamasini qo'ying, iloji bo'lsa kichik UPS qo'ying.

## 2. O'rnatish

1. `cerebro` papkasini kompyuterga ko'chiring, masalan `C:\Cerebro` (ichida `install`, `server`, `src` papkalari bo'ladi).
2. `install\Ornatish.cmd` ni ikki marta bosing. U o'zi:
   - Node.js va (IP kameralar uchun) ffmpeg'ni tekshiradi, yo'q bo'lsa o'rnatishni taklif qiladi. Node.js o'rnatilgach oynani yopib, `Ornatish.cmd` ni **qayta** bosing;
   - kutubxonalarni yuklaydi va panelni yig'adi;
   - `.env` faylini yozadi: admin paroli, port, ma'lumotlar papkasi (`C:\CerebroData`). **Kalitlar bu yerda so'ralmaydi** — ular ulash ustasida kiritiladi;
   - dastur va ma'lumotlar papkasini kompyuterning boshqa Windows foydalanuvchilaridan yopadi;
   - **ovoz xizmati va telefon liniyasini** o'rnatishni taklif qiladi (`install\telefon.ps1`, alohida — `install\Telefon.cmd`):
     Python va ovoz kutubxonalari, «Quloq» modeli (≈45 MB), keyin administrator huquqi bilan WSL, Ubuntu 24.04 (≈340 MB, SHA256 tekshiriladi),
     Asterisk, `.wslconfig` da mirrored tarmoq va brandmauer qoidalari (5060, 10000–10100 — faqat ichki tarmoq).
     WSL birinchi marta o'rnatilsa — kompyuterni qayta yoqib, `Telefon.cmd` ni yana bosing. Har qadam qayta bosilganda bor narsani o'tkazib yuboradi.
     Ovozli agent kalitini Cerebro o'zi yaratadi (`DATA_DIR\ovoz.env`), Gemini kaliti — ulash ustasida;
   - Cerebro'ni avtoyuklashga qo'shadi, ish stoliga «Cerebro» yorlig'ini qo'yadi, ishga tushiradi va brauzerda **ulash ustasini** (`/#/ulash`) ochadi.
3. Oxirida ekranda **admin paroli** chiqadi — yozib oling. U sizniki, klinikaga berilmaydi.

**Qaysi Windows foydalanuvchisi ostida o'rnatish kerak.** Cerebro shu foydalanuvchi kirganda ishlaydi va kalitlar, baza, bemorlar yozishmasi faqat unga ochiq bo'ladi.
Eng yaxshisi — egasining (yoki faqat Cerebro uchun ochilgan) alohida parolli foydalanuvchisi. Hamma xodim bitta umumiy foydalanuvchi bilan ishlasa, ular `.env` va bazani ocha oladi — buni egasiga ayting.
Zaxira nusxani fleshkaga olsangiz: unda baza va uni ochadigan kalit yonma-yon turadi — fleshka yo'qolsa hammasi ochiq.

## 3. Klinikani sozlash — ulash ustasi

Panel: ish stolidagi «Cerebro» yorlig'i. Usta: `http://localhost:3200/#/ulash` (admin paroli bilan). Chapda qadamlar va «klinikada o'tgan vaqt», har qadam tayyor bo'lsa yashil belgi oladi; qadamlarni istalgan tartibda bosish mumkin.

1. **Klinika**: «Yangi klinika» → nomi (login va parol o'zi yaratiladi — nusxalab egasiga bering). Keyin **anketa kodi** va o'z serveringiz manzili → «Yuklash»: manzil, ish vaqti, narxlar, javoblar shu kompyuterga tushadi. Internet bo'lmasa — anketa sahifasidan yuklab olingan `.json` faylni tanlang.
2. **Kalitlar**: bot tokeni, Claude va Gemini kalitlari, kamera `rtsp://` manzili, DentaCRM havolasi, Telegram raqami — **hammasini bitta maydonga** qo'ying. Usta har qatorning turini o'zi taniydi (AI'siz, qolip bo'yicha), kalitni haqiqiy xizmatda tekshiradi va shifrlab saqlaydi; qolganini o'z qadamiga o'tkazadi. Tanimagan qatorni (masalan, DentaCRM paroli) bir tugma bilan belgilaysiz. Server to'xtamaydi: bot shu zahoti yangi token bilan ulanadi.
3. **Egasining Telegram'i**: havolani egasi **o'z telefonida** ochadi va «Start» bosadi — sahifa o'zi yangilanadi.
4. **DentaCRM**: manzil va parol kalitlar maydonidan o'tgan bo'ladi, loginni yozasiz → «Ulash va tekshirish».
5. **Kameralar**: «Tarmoqdan qidirish» — kameralar o'zi topiladi (ONVIF va 554-port), markasi va modeli bilan. Login-parolni bir marta kiritasiz, har kameraga joyini yozasiz («Qabulxona», «1-kabinet») → «Ulash». RTSP manzili kameradan so'raladi (yengil oqim), bo'lmasa markaning odatiy yo'llari sinab ko'riladi; ulangach kadri ko'rinadi. Kreslo va kassa zonalarini kabinetdagi «Kameralar» bo'limida kadr ustida chizasiz. Topilmagan kamerani `rtsp://` manzili bilan «Kalitlar» qadamiga qo'yish mumkin:
   - Hikvision: `rtsp://admin:PAROL@192.168.1.64:554/Streaming/Channels/102` (`102` — 1-kamera, yengil oqim; 2-kamera — `202`)
   - Dahua: `rtsp://admin:PAROL@192.168.1.108:554/cam/realmonitor?channel=1&subtype=1`
   - RTSP'siz kamera: HTTP manzili — MJPEG oqim yoki surat (`http://admin:PAROL@192.168.1.70/snapshot.jpg`)
   - **Telefon kamera sifatida**: Android'ga «IP Webcam» ilovasi → «Start server» → `http://TELEFON-IP:8080/video`. Telefonni zaryadga ulab, devorga mahkamlang; ilova sozlamasida ekran o'chib qolmasin.

   **Zonalar** (Kuzatuvchi → Ulash → kamera → kadr ustida to'rtburchak torting yoki **«AI belgilasin»** — AI kadrga qarab taklif qiladi, siz joyini tuzatib «Zonalarni saqlash»ni bosasiz):
   | Zona turi | Nima beradi |
   |---|---|
   | Kreslo (shifokor id'si bilan) | Kim kresloda qancha o'tirdi, kreslo necha foiz band, DentaCRM bilan solishtirish: qabulsiz o'tirish, «keldi» deb belgilangan-u ko'rinmagan bemor, **to'lovsiz qabul** |
   | Kassa stoli | Kassa oldida turganlar va CRM'dagi to'lovlar |
   | Kutish joyi | Har bemor qancha kutgani; 20 daqiqadan ko'p kutsa — egasiga xabar |
   | Xodim joyi (masalan, «Administrator») | Qachon keldi, qachon ketdi, eng uzoq yo'qligi |
   | Maxfiy joy | Kameradan chiqadigan **har rasmda** qora bilan yopiladi (AI, Telegram, jurnal, panel) — pul qutisi, kompyuter ekrani, kiyinish joyi |

   Keyin Kuzatuvchi → «Topshiriqlar» → **«Tayyor qoidalar»**dan kerakligini bir bosishda yoqing: kechasi odam ko'rinsa, kassa bo'sh qolsa, ko'p odam yig'ilsa, ertalab tartib, yopilgandan keyin.
   Kreslo bandligi va «kechasi chiroq o'chdi» qaysi soatlar ish vaqti ekaniga qarab hisoblanadi: anketadagi (yoki «Biznes haqida»dagi) **ish vaqti** to'g'ri yozilganini tekshiring («Du–Sh 9:00–20:00»). Yozilmagan bo'lsa — 08:00–21:00.
6. **Instagram** (rasmiy): «Kalitlar»da Hub kodi bo'lsa — «Instagram'ni rasmiy ulash» → egasi ochilgan Instagram oynasida kiradi va ruxsat beradi. Hub kodi hali yo'q bo'lsa — bu qadamni keyin qiling. Pastdagi «Chegaralar»ni o'qing.
7. **Bo'shliqlar**: usta hamma ma'lumotni tekshirib, yetishmagan va zid joylarni ko'rsatadi — bitta xizmatga ikki xil narx, yozilmagan kunlar, manzil, telefon. «Egasidan Telegram'da so'rash» — bot egasiga bittalab so'raydi (narx savolida tugmalar bilan), javob o'z joyiga yoziladi: narx — jadvalga, manzil va ish vaqti — «Biznes haqida» sahifasiga. Keyin ko'p so'raladigan savollar keladi. Ro'yxat egasi javob bergan sari ekranda qisqaradi.
8. **Tayyor**: hamma qadam holati va o'tgan vaqt. «Kabinetga o'tish» — klinika kabineti qayta kirishsiz ochiladi.

Egasining shaxsiy Telegrami, Instagram'ni brauzer orqali ulash va Telegram orqali AI qo'ng'iroq keyinga qoldirilgan: standart o'chiq va ustada ko'rinmaydi (`.env`: `TG_PERSONAL`, `IG_VIA_BROWSER`, `TG_CALL`).

**Mijozlarga javob** rejimi: birinchi hafta **«Tasdiq bilan»** qoldiring — Cerebro javobni tayyorlaydi, egasi Telegramda «Yuborish» bosadi. Javoblar yoqsa, keyin «O'zi javob bersin»ga o'tkazing.

Egasi tokenni yoki kalitni adashib botga (yoki panel suhbatiga) yozib yuborsa: bot xabarni chatdan o'chiradi, hech qayerga saqlamaydi va panelga yo'naltiradi.

**Telefon liniyasi** (panel → Sozlamalar → Telefon liniyasi):
- Uztelecom ma'lumotlarini kiriting → «Saqlash va ulash»: holatda «Shahar raqami — ulangan» chiqishi kerak.
- «Kim javob beradi»: har doim AI yoki «ish vaqtida — administrator, qolgan paytda — AI».
- Administrator telefoni: qabulxona telefoniga Zoiper (yoki stol IP telefoni) → «Akkaunt yaratish» → server, login `admin`, parol.
  Shu telefondan «2» ni tering — qabulxona mijozdek javob beradi (sinov: jadvalga yozilmaydi).

## 4. Ketishdan oldin tekshiring

- [ ] `install\Tekshirish.cmd` — `[XATO]` yo'q.
- [ ] Egasi botga «Bugun nechta qabul bor?» deb yozdi — CRM'dagi son bilan to'g'ri javob keldi.
- [ ] Egasi «Ertaga 10 da laboratoriyaga qo'ng'iroq qilishni eslat» dedi — vazifa panelda ko'rindi.
- [ ] Boshqa telefondan botga bemor sifatida yozildi («narxlar qancha?») — egasiga javob taklifi keldi, «Yuborish» ishladi.
- [ ] Bemor sifatida qabulga yozilib ko'rildi — qabul DentaCRM'da paydo bo'ldi (keyin o'chirib tashlang).
- [ ] Kameralar sahifasida har kamera holati «kadr kelyapti».
- [ ] Egasi botga `/kamera` yozdi — har kameradan rasm keldi; «/kamera qabulxonada kim bor» — kadrga qarab javob keldi.
- [ ] Maxfiy joy belgilangan bo'lsa: `/kamera` rasmida o'sha joy qora.
- [ ] Kreslo zonalarida DentaCRM shifokor id'si yozilgan; «Tayyor qoidalar»dan kamida «Kechasi odam ko'rinsa» yoqilgan.
- [ ] Kamerani qo'l bilan 2–3 daqiqa yopib ko'ring — egasiga «kamera ko'rmay qoldi» keldi, ochgach «yana ko'ryapti» (birinchi 10 daqiqada kamera odatiy ko'rinishini o'rganadi — undan keyin sinang).
- [ ] Kompyuterni **o'chirib-yoqing**: 1–2 daqiqadan keyin bot o'zi javob beryaptimi?
- [ ] Kompyuter uxlamaydigan qilingan (Sozlamalar → Quvvat → «Hech qachon»).
- [ ] Egasiga aytildi: kompyuter o'chirilmaydi; shu Windows foydalanuvchisi bilan kirilgan bo'lishi kerak.

## 5. Keyin: kundalik ishlar

| Ish | Qanday |
|---|---|
| To'xtatish / ishga tushirish | `install\Toxtatish.cmd` / `install\Ishga-tushirish.cmd` |
| Nima bo'lganini ko'rish | `C:\CerebroData\logs\` — har kunga bitta fayl (`2026-10-14.log`), 14 kun saqlanadi. `supervisor.log` — qachon to'xtab, qachon qayta yongani |
| Zaxira nusxa | Har kuni o'zi olinadi: `C:\CerebroData\backups\KUN\` (baza, «ikkinchi miya», maxfiy kalit), 14 kun. Boshqa diskka olish: `.env` da `BACKUP_DIR=D:\CerebroZaxira` |
| Tiklash | Cerebro'ni to'xtating → `C:\CerebroData` dagi `cerebro.db-wal` va `cerebro.db-shm` fayllarini o'chiring → zaxira papkasidagi `cerebro.db`, `miya`, `session.secret` ni `C:\CerebroData` ga ko'chiring → ishga tushiring |
| Dasturni yangilash | Yangi `cerebro` papkasini eskisining ustiga ko'chiring (`.env` qoladi) → `install\Ornatish.cmd`. Ma'lumotlar `C:\CerebroData` da — tegilmaydi |
| AI xarajati | Admin sahifasida oxirgi 7 kun: so'rovlar soni va taxminiy dollar. Aniq hisob — platform.claude.com |
| Kalitni almashtirish | `/#/ulash` → «Kalitlar»: yangisini qo'ying — tekshiriladi va server to'xtamasdan kuchga kiradi. Kalitlar bazada shifrlangan (`session.secret` bilan); `.env` dagisi faqat panelda berilmagan bo'lsa ishlaydi |
| Olib tashlash | `install\Ornatish.cmd -Uninstall` (ma'lumotlar o'chmaydi) |

Kunlik chegaralar (`.env` da o'zgartiriladi): egasining yordamchisi — 600 so'rov (`AI_DAILY_OWNER`), mijozlarga javob — 400 (`AI_DAILY_CUSTOMER`), rasm — 50 (`AI_DAILY_PHOTOS`), kamera AI ko'zi — 150 (`AI_DAILY_CAMERA`). Chegara tugasa Cerebro buni egasiga aytadi va pul sarflamaydi.

Kamera sozlamalari (`.env`): kechki kamera hisoboti soati — `CAMERA_REPORT_HOUR=20` (99 — yuborilmaydi), uzoq kutish chegarasi — `CAMERA_WAIT_ALERT_MIN=20`, «to'lov yozilmagan» deyishdan oldin kutish — `CAMERA_PAY_GRACE_MIN=30`, «yopildi/burildi» qancha davom etsa xabar — `CAMERA_TAMPER_HOLD_SEC=120`.

## 6. Muammo chiqsa

| Belgisi | Sababi va yechimi |
|---|---|
| Bot javob bermayapti | Kompyuter yoniqmi, internet bormi? `Tekshirish.cmd`. Jurnalda `409` — shu token boshqa joyda ham ishlayapti: u yerda to'xtating |
| «AI hisobida mablag' tugagan» | platform.claude.com da hisobni to'ldiring |
| «AI kaliti ishlamayapti» | Kalit o'chirilgan yoki noto'g'ri: yangisini `/#/ulash` → «Kalitlar»ga qo'ying |
| «Bugungi AI chegarasi tugadi» | Kunlik chegara: ertaga o'zi ochiladi yoki `.env` da oshiring |
| Kamera: «kadr kelmayapti» | Kamera yoki registrator o'chgan, IP o'zgargan, parol almashgan. Manzilni qayta kiriting |
| «Kamera burilgan yoki joyi o'zgargan» | Kamerani joyiga qaytaring. Ataylab burilgan bo'lsa — zonalarni qayta chizing (kamera yangi ko'rinishni qaytadan o'rganadi) |
| Har kech «kamera ko'rmay qoldi» | Ish vaqti noto'g'ri yozilgan: ish vaqtidan tashqarida chiroq o'chishi xabar bermaydi. «Biznes haqida»da ish vaqtini tuzating |
| Telefon kamera uziladi | Telefon zaryadda, Wi-Fi'da, «IP Webcam» ochiq va ekran o'chib qolmasin (ilova sozlamasi) |
| Panel ochilmayapti | `Ishga-tushirish.cmd`. Bo'lmasa `logs\supervisor.log` ning oxirini o'qing |
| Instagram javob bermay qoldi | Panel → Sozlamalar → Instagram: muammo matnini o'qing (token, Hub aloqasi). Kerak bo'lsa rasmiy ulanishni qayta ulang. Mijozning oxirgi xabaridan 24 soat o'tgan bo'lsa — Instagram javobga ruxsat bermaydi |
| Kamera: «ffmpeg eski» | HTTP kamera faqat yangi ffmpeg bilan ulanadi: `winget upgrade Gyan.FFmpeg`, keyin Cerebro'ni qayta ishga tushiring (yoki kameraning `rtsp://` manzilini bering) |

## 7. Chegaralar — klinikaga oldindan ayting

- **Instagram** rasmiy yo'l bilan (Meta ilovasi, Cerebro Hub) ishlaydi: mijozning oxirgi xabaridan keyin 24 soat ichida javob berish mumkin (Meta «Human Agent» ruxsatini bersa — 7 kun). Meta ilovasi App Review'dan o'tmaguncha faqat ilovada tester qilib qo'shilgan akkauntlar ulanadi. Haqiqiy Meta bilan hali sinalmagan — birinchi klinikada o'zingiz kuzating; birinchi hafta faqat «Tasdiq bilan» rejimi.
- **Kameralar** odamni tanimaydi va pulni ko'rmaydi: faqat «kresloda shuncha vaqt odam o'tirdi», «kassa oldida odam turdi», «kutish joyida shuncha kutdi» deb sanaydi va CRM bilan solishtiradi. Farqlar — tekshirish uchun sabab, ayb emas.
  Odamlarni sanash shu kompyuterning o'zida bo'ladi, oqim hech qayerga yuborilmaydi. **Kadr kompyuterdan faqat shunda chiqadi**: egasi so'raganda (`/kamera`, «kameraga qara», «AI belgilasin») yoki uning topshirig'i bo'yicha — AI'ga (Claude) va egasining Telegram'iga; ogohlantirish kadrlari Kuzatuvchi jurnalida 14 kun saqlanadi. Maxfiy joylar har rasmda qora. Buni klinikaga ayting va kamerani bemorlar yechinadigan joyga qaratmang.
- **AI qabulxona (telefon liniyasi)** o'rnatiladi, lekin haqiqiy shahar raqamida hali sinalmagan: birinchi klinikada «ish vaqtida — administrator, qolgan paytda — AI» rejimidan boshlang va qo'ng'iroqlarni Qo'ng'iroqlar sahifasida kuzating.
- Panel faqat shu kompyuterda ochiladi. Egasi hamma narsani telefonidagi Telegram botdan boshqaradi.
- Yordamchi tibbiy maslahat bermaydi va tashxis qo'ymaydi: og'riq, shish, shikoyat bo'lsa — javobni egasiga oshiradi.
