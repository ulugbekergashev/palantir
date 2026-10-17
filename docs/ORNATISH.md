# Cerebro'ni klinikaga o'rnatish

Bu qo'llanma o'rnatuvchi uchun: klinikaga borishdan oldin nima tayyorlash, joyida nima qilish va ketishdan oldin nimani tekshirish.
Bir klinika — bitta kompyuter — bitta bot. O'rnatish 30–40 daqiqa oladi (internet tezligiga qarab).

## 1. Borishdan oldin tayyorlang

| Nima | Qayerdan | Nima uchun |
|---|---|---|
| **Telegram bot tokeni** | @BotFather → `/newbot` (har klinikaga alohida bot) | Egasi yordamchi bilan shu botda gaplashadi; bemorlar ham shu botga yozadi |
| **Claude API kaliti** | platform.claude.com → API keys. Hisobda mablag' bo'lsin | Yordamchining «miyasi». Kalitda oylik chegara (spend limit) qo'ying |
| Gemini kaliti (ixtiyoriy, bepul) | aistudio.google.com | Ovozli xabarlarni matnga aylantiradi. Bo'lmasa ovoz o'chiq |
| TG_API_ID va TG_API_HASH (ixtiyoriy) | my.telegram.org → API development tools (bir marta, hamma klinikalarga bitta) | Egasining **shaxsiy** Telegramiga yozgan mijozlarga javob. Bo'lmasa bu imkoniyat o'chiq |
| DentaCRM manzili, login, parol | Klinikadan | Qabullar, bemorlar, tushum |
| Instagram login-paroli | Klinikadan (egasi o'zi kiritadi) | Direct'ga javob |
| Kameralarning RTSP manzili | Kamerani o'rnatgan usta yoki videoregistrator sozlamalari | Kamera nazorati |

Klinikadagi kompyuter: Windows 10 yoki 11, doim yoniq va internetga ulangan, Google Chrome yoki Edge o'rnatilgan.
**Kompyuter o'chiq yoki uyquda bo'lsa — Cerebro ishlamaydi.**

## 2. O'rnatish

1. `cerebro` papkasini kompyuterga ko'chiring, masalan `C:\Cerebro` (ichida `install`, `server`, `src` papkalari bo'ladi).
2. `install\Ornatish.cmd` ni ikki marta bosing. U o'zi:
   - Node.js va (IP kameralar uchun) ffmpeg'ni tekshiradi, yo'q bo'lsa o'rnatishni taklif qiladi. Node.js o'rnatilgach oynani yopib, `Ornatish.cmd` ni **qayta** bosing;
   - kutubxonalarni yuklaydi va panelni yig'adi;
   - kalitlarni so'raydi va `.env` fayliga yozadi (ma'lumotlar papkasi — `C:\CerebroData`). Kalitlar yozilayotganda ekranda **ko'rinmaydi**: nusxalab, sichqonchaning o'ng tugmasi bilan qo'ying va Enter bosing;
   - **hamma kalitni haqiqiy xizmatda tekshiradi** (Telegram, Claude, ovoz);
   - dastur va ma'lumotlar papkasini kompyuterning boshqa Windows foydalanuvchilaridan yopadi;
   - Cerebro'ni avtoyuklashga qo'shadi, ish stoliga «Cerebro» yorlig'ini qo'yadi, ishga tushiradi.
3. Oxirida ekranda **admin paroli** chiqadi — yozib oling. U sizniki, klinikaga berilmaydi.

**Qaysi Windows foydalanuvchisi ostida o'rnatish kerak.** Cerebro shu foydalanuvchi kirganda ishlaydi va kalitlar, baza, bemorlar yozishmasi faqat unga ochiq bo'ladi.
Eng yaxshisi — egasining (yoki faqat Cerebro uchun ochilgan) alohida parolli foydalanuvchisi. Hamma xodim bitta umumiy foydalanuvchi bilan ishlasa, ular `.env` va bazani ocha oladi — buni egasiga ayting.
Zaxira nusxani fleshkaga olsangiz: unda baza va uni ochadigan kalit yonma-yon turadi — fleshka yo'qolsa hammasi ochiq.

Tekshiruvda `[XATO]` chiqsa — yonidagi izohni o'qing, `.env` ni Bloknotda tuzating va `install\Tekshirish.cmd` ni bosing.
Eng ko'p uchraydiganlari: token noto'g'ri ko'chirilgan; Claude hisobida mablag' yo'q; shu bot tokeni boshqa kompyuterda ham ishlab turibdi.

## 3. Klinikani sozlash (panelda)

Panel: ish stolidagi «Cerebro» yorlig'i (`http://localhost:3200`).

1. **Admin** (`/#/admin`): admin paroli bilan kiring → klinikani qo'shing: nomi, soha (`stomatologiya`), login, parol (kamida 8 belgi). Bu login-parol klinika egasiga beriladi.
2. Klinika logini bilan kiring.
3. **Telegram**: «Telegramni ulash» havolasini egasi **o'z telefonida** ochadi va «Start» bosadi. Bot «Ulandi» deb javob beradi.
4. **DentaCRM**: manzil, login, parolni kiriting. Ulangach bosh sahifada bugungi qabullar ko'rinadi.
5. **Mijozlarga javob** rejimi: birinchi hafta **«Tasdiq bilan»** qoldiring — Cerebro javobni tayyorlaydi, egasi Telegramda «Yuborish» bosadi. Javoblar yoqsa, keyin «O'zi javob bersin»ga o'tkazing.
6. **Shaxsiy Telegram** (TG_API_ID bo'lsa): egasining raqami → Telegramga kelgan kod → (bo'lsa) ikki bosqichli parol.
7. **Instagram**: egasi login-parolini ochilgan oynada o'zi kiritadi. Pastdagi «Chegaralar»ni o'qing.
8. **Kameralar**: kamera qo'shing → IP manzilini kiriting → kadr ustida kreslo va kassa zonalarini chizing → saqlang.
   - Hikvision: `rtsp://admin:PAROL@192.168.1.64:554/Streaming/Channels/102` (`102` — 1-kamera, yengil oqim; 2-kamera — `202`)
   - Dahua: `rtsp://admin:PAROL@192.168.1.108:554/cam/realmonitor?channel=1&subtype=1`
   - Har doim **yengil oqimni** (substream) oling: asosiy oqim kompyuterni bekorga yuklaydi.
   - Kresloga shifokor id'sini yozsangiz, kamera ko'rgani o'sha shifokorning CRM'dagi qabullari bilan solishtiriladi.
9. **Bilim**: egasi botga `/savollar` yozadi — Cerebro bemorlar ko'p so'raydigan savollarni birma-bir so'raydi. Narxnoma faylini (PDF, Word, Excel) botga tashlasa, o'qib oladi.

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
| Kalitni almashtirish | `.env` ni Bloknotda tuzating → to'xtatib, qayta ishga tushiring → `Tekshirish.cmd` |
| Olib tashlash | `install\Ornatish.cmd -Uninstall` (ma'lumotlar o'chmaydi) |

Kunlik chegaralar (`.env` da o'zgartiriladi): egasining yordamchisi — 600 so'rov (`AI_DAILY_OWNER`), mijozlarga javob — 400 (`AI_DAILY_CUSTOMER`), rasm — 50 (`AI_DAILY_PHOTOS`). Chegara tugasa Cerebro buni egasiga aytadi va pul sarflamaydi.

## 6. Muammo chiqsa

| Belgisi | Sababi va yechimi |
|---|---|
| Bot javob bermayapti | Kompyuter yoniqmi, internet bormi? `Tekshirish.cmd`. Jurnalda `409` — shu token boshqa joyda ham ishlayapti: u yerda to'xtating |
| «AI hisobida mablag' tugagan» | platform.claude.com da hisobni to'ldiring |
| «AI kaliti ishlamayapti» | Kalit o'chirilgan yoki noto'g'ri: yangisini `.env` ga yozing |
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
