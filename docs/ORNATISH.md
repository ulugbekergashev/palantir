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
| TG_API_ID va TG_API_HASH (ixtiyoriy) | my.telegram.org → API development tools (bir marta, hamma klinikalarga bitta) | Egasining **shaxsiy** Telegramiga yozgan mijozlarga javob. Bo'lmasa bu imkoniyat o'chiq |
| DentaCRM manzili, login, parol | Klinikadan | Qabullar, bemorlar, tushum |
| Instagram login-paroli | Klinikadan (egasi o'zi kiritadi) | Direct'ga javob |
| Kameralarning RTSP manzili | Kamerani o'rnatgan usta yoki videoregistrator sozlamalari | Kamera nazorati |

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
6. **Shaxsiy Telegram** (Telegram API ID va hash kiritilgan bo'lsa): raqam anketadan yoki kalitlar maydonidan → kod → (bo'lsa) ikki bosqichli parol.
7. **Instagram**: «Instagram oynasini ochish» — egasi login-parolini ochilgan oynada o'zi kiritadi. Pastdagi «Chegaralar»ni o'qing.
8. **Bo'shliqlar**: usta hamma ma'lumotni tekshirib, yetishmagan va zid joylarni ko'rsatadi — bitta xizmatga ikki xil narx, yozilmagan kunlar, manzil, telefon. «Egasidan Telegram'da so'rash» — bot egasiga bittalab so'raydi (narx savolida tugmalar bilan), javob o'z joyiga yoziladi: narx — jadvalga, manzil va ish vaqti — «Biznes haqida» sahifasiga. Keyin ko'p so'raladigan savollar keladi. Ro'yxat egasi javob bergan sari ekranda qisqaradi.
9. **Tayyor**: hamma qadam holati va o'tgan vaqt. «Kabinetga o'tish» — klinika kabineti qayta kirishsiz ochiladi.

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

Kunlik chegaralar (`.env` da o'zgartiriladi): egasining yordamchisi — 600 so'rov (`AI_DAILY_OWNER`), mijozlarga javob — 400 (`AI_DAILY_CUSTOMER`), rasm — 50 (`AI_DAILY_PHOTOS`). Chegara tugasa Cerebro buni egasiga aytadi va pul sarflamaydi.

## 6. Muammo chiqsa

| Belgisi | Sababi va yechimi |
|---|---|
| Bot javob bermayapti | Kompyuter yoniqmi, internet bormi? `Tekshirish.cmd`. Jurnalda `409` — shu token boshqa joyda ham ishlayapti: u yerda to'xtating |
| «AI hisobida mablag' tugagan» | platform.claude.com da hisobni to'ldiring |
| «AI kaliti ishlamayapti» | Kalit o'chirilgan yoki noto'g'ri: yangisini `/#/ulash` → «Kalitlar»ga qo'ying |
| «Bugungi AI chegarasi tugadi» | Kunlik chegara: ertaga o'zi ochiladi yoki `.env` da oshiring |
| «Shaxsiy Telegram uzildi» | Egasi telefonida «Faol seanslar»dan Cerebro'ni tugatgan: panelda qayta ulang |
| Kamera: «kadr kelmayapti» | Kamera yoki registrator o'chgan, IP o'zgargan, parol almashgan. Manzilni qayta kiriting |
| Panel ochilmayapti | `Ishga-tushirish.cmd`. Bo'lmasa `logs\supervisor.log` ning oxirini o'qing |
| Instagram javob bermay qoldi | Instagram qayta kirishni so'ragan: panelda Instagram'ni qayta ulang |

## 7. Chegaralar — klinikaga oldindan ayting

- **Instagram** rasmiy yo'l bilan emas, egasining akkaunti orqali brauzerda ishlaydi. Instagram buni avtomatlashtirish deb topib, akkauntni vaqtincha cheklashi mumkin. Shuning uchun: kuniga 120 tadan ko'p xabar yuborilmaydi, birinchi hafta faqat «Tasdiq bilan» rejimi. Haqiqiy Instagram'da hali sinalmagan — birinchi klinikada o'zingiz kuzating.
- **Kameralar** odamni tanimaydi va pulni ko'rmaydi: faqat «kresloda shuncha vaqt odam o'tirdi», «kassa oldida odam turdi» deb sanaydi va CRM bilan solishtiradi. Farqlar — tekshirish uchun sabab, ayb emas. Tasvir hech qayerga saqlanmaydi va kompyuterdan chiqmaydi.
- **Shaxsiy Telegram** uzilgan paytda (internet yo'q) kelgan xabarlarni Cerebro ko'rmay qolishi mumkin — egasi telefonida o'zi ko'radi.
- **Qo'ng'iroqlarga javob beradigan ovozli agent** bu dasturda yo'q (faqat ulash joyi bor).
- Panel faqat shu kompyuterda ochiladi. Egasi hamma narsani telefonidagi Telegram botdan boshqaradi.
- Yordamchi tibbiy maslahat bermaydi va tashxis qo'ymaydi: og'riq, shish, shikoyat bo'lsa — javobni egasiga oshiradi.
