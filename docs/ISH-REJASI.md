# Ish rejasi — 2026-11-13

Yo'nalish (egasi qarori, 2026-11-12): Palantir klinika kompyuterida qoladi, bitta mahsulot — **AI administrator**
(Telegram, Instagram va telefonda bemorga javob beradi, DentaCRM'ga yozadi). Asos: `docs/MANTIQ-AUDIT.md` (34 band),
2026-11-13 da hamma bandi kod bilan qayta solishtirildi (natija — o'sha hujjat oxirida).
Telefoniya: ko'pchilik klinika **Uztelecom** xohlaydi, **Zadarma** ham qoladi.

Hajm: K — kichik (bir joy), O' — o'rta (bir necha fayl + yangi sinov), Kt — katta (dizayn yoki ekran + server).
Har band: avval yiqiladigan sinov, keyin tuzatish, keyin commit; tuzatilgach MANTIQ-AUDIT.md dagi «holat» yangilanadi.

## 1-bosqich. Birinchi bemorga to'g'ri javob (egasi qarori kerak emas)

Maqsad: kelasi hafta o'rnatilgan klinika birinchi bemoriga to'g'ri javob bersin va hech kim «yo'qolib» qolmasin.

| tartib | band | nima qilinadi | hajm |
| --- | --- | --- | --- |
| 1 | A1 + yangi | Qabulga yozilgan bemor «Mijoz bo'ldi» bosqichiga o'tadi (`inbox/core.ts` linkBooked). Telefonda yozilgani ham (`phone/index.ts:302` — audit o'tkazib yuborgan) | K |
| 2 | A2 | Telegram ulanmagan bo'lsa bemor xabari navbatga (notices) va panelda «Sizni kutyapti»ga tushadi | O' |
| 3 | A8 | Claude obunasidan chiqib ketish / limit — kanallar nazoratida bitta ogohlantirish, Hub ham ko'radi | O' |
| 4 | A7 | Qabulxona xodimi: `team/day` va `tasks` yopiladi (2026-11-07 dagi tuzatishdan keyin ham ochiq qolgan) | K |
| 5 | A12 | Eski javob qoralamalari eskiradi (48 soat) — ertalabki sanoq to'g'ri | K |
| 6 | A6 | Shikoyat har doim egasiga boradi, nusxa o'chirilgan bo'lsa ham | K |
| 7 | A3 | Qabulxona olib tashlangan bo'lsa telefon AI qabul yozmaydi (server qismi; to'liq to'xtatish — telefon bosqichida) | K |
| 8 | A4 | Brend-buk Kontent-meykerni o'zi yollamaydi; brend-buk asbobi Yordamchida | K–O' |
| 9 | A10, D1, D2 | Olinmagan xodimlar: kamera gapi, jurnal va ko'rsatmada ko'rinmaydi | K |
| 10 | A13, A14 | Ertalabki xabar qayta yuborilganda Direktor qismi; nazoratda tungi sukut va Telegramsiz biznes | K–O' |
| 11 | A9 | Direktor faqat topshiriqni o'qiydigan xodimlarga topshiradi (Qabulxona, Yordamchi, Kuzatuvchi, egasi) | K |
| 12 | A11, D7 | «Qabulxonaga ayting» matni; xodim yozgan javob «Javobingiz» deb so'ralmaydi | K |
| 13 | C4 | Ustada avval Claude obunasi, kalit — ikkinchi yo'l (kaliti bor eski o'rnatish o'zgarmaydi) | K–O' |
| 14 | A5 | Qabulxona kartasi telefon liniyasini va javob rejimini ko'rsatadi | O' |

### 1b. Chuqur auditdan qo'shilganlar (2026-11-13, `MANTIQ-AUDIT.md` E–I) — klinikaga borishdan oldin

| tartib | band | nima qilinadi | hajm |
| --- | --- | --- | --- |
| 15 | F1 | Ta'tildagi shifokorga yozmaslik: `status === 'Active'` | K |
| 16 | F3 | Bekor qilingan kunga qayta yozish: `existed` faqat bekor qilinmagan qatorlar bo'yicha | K |
| 17 | F5 | Shifokor tushligi bo'sh vaqtdan chiqariladi | K |
| 18 | G1 | So'rov qabul yozilganda / qo'ng'iroq ko'tarilganda o'zi yopiladi; «Sizni kutyapti»da yangisi birinchi | O' |
| 19 | G3 | Bosqichlar: CRM'da kelgan → «mijoz bo'ldi»; yopilgan bemor yana yozsa → qaytadi (A1 bilan birga) | O' |
| 20 | E1 | «O'zi javob bersin»da AI javob bermasa — bemorga bir marta «xodim javob beradi»; shoshilinch holatda 103 qatori | K–O' |
| 21 | E2, E3 | Havolasiz kelgan bemor — shu klinika mijozi; rasm/video/stiker/lokatsiya/ovoz — jim tashlanmaydi | O' |
| 22 | E12 | Rejim «o'chiq» bo'lsa ham Telegram Business xabari saqlanadi | K |
| 23 | H2 | O'tkazib yuborilgan yangilanish — kompyuter yonganda | K |
| 24 | H1 | `/api/health` bot va AI holatini ham bildiradi; yangilovchi shunga qaraydi | K–O' |
| 25 | G2 | Direktor voronkasi: ikkala davrga bir xil «yetilish» muddati | K |
| 26 | G4 | Doimiy ko'rsatmalar chegarasi: yangisi tashlanmaydi, tekshirilgan Direktor qarori o'chadi | K |
| 27 | I3 | Xodimga boshqa xodimlarning Telegram havolalari berilmaydi | K |
| 28 | F2 | **DentaCRM oynasi yopilsa server o'chadi** — dentalocal tomonida fon xizmati (alohida loyiha, egasi bilan) | O', dentalocal |

Telefon bosqichiga qo'shiladi: F4 (Gemini ishlamasa — T1 bilan bir xil), F6–F8, F10. Egasi qarori kerak: H3 (o'z domeni), H6 (to'lanmagan
qo'llab-quvvatlash nimani to'xtatadi), H1 (avval 2–3 pilot klinikaga reliz).

## 2-bosqich. Telefon (Uztelecom + Zadarma)

Hozirgi holat (kodda tekshirilgan): exe telefon xizmatini (WSL + Asterisk) o'rnatmaydi — joyda `Telefon.cmd`, qayta yuklash, yana
ishga tushirish kerak; tarmoq rejimi faqat Windows 11 da bor, skript buni tekshirmaydi; AI yoki Gemini ishlamasa qo'ng'iroq
ko'tarilib, uziladi; Uztelecom shakli ustada yo'q; haqiqiy operator bilan hech narsa sinalmagan.

| tartib | nima qilinadi | hajm |
| --- | --- | --- |
| T1 | **Qo'ng'iroq yo'qolmaydi:** AI tayyor bo'lmasa — administrator telefoni jiringlaydi, ko'tarilmasa «o'tkazib yuborilgan qo'ng'iroq» so'rovi ochiladi | K · ✅ haqiqiy Asterisk 20.6 da sinaldi (2026-11-15, `npm run test:dialplan` 24/24 — WSL ichida vaqtinchalik nusxa, o'rnatilganiga tegilmaydi; Palantir, AI va administrator telefoni soxta): AI ulanmasa / band / Palantir javob bermasa / 401 / ish vaqti (administrator ko'tardi — «gaplashdi» soniyasi bilan Palantir'ga; ko'tarmadi — AI) / AI jamoada yo'q (A3) / AI suhbat o'rtasida administratorga o'tkazdi (sip_live.py `channel redirect` — haqiqiy kod): ko'tardi — tugadi, ko'tarmadi — AI'ga 3-rejimda qaytdi. Topildi va tuzatildi: (1) Asterisk 20.6 AI ulanishi go'shaksiz uzilganini sezmaydi — sip_live.py yiqilsa yoki yangilanishda o'chirilsa mijoz jimlikda qolardi, so'rov ochilmasdi: endi sip_live.py ishga tushganda AI'siz qolgan qo'ng'iroqlarni topib administratorga buradi ([yordam]: ko'tarilmasa uzr va so'rov), egasinikini uzadi; (2) jurnalda ochilgan so'rov ham «ochilmadi» deb yozilardi (JSON qo'shtirnog'i ifodani buzardi) — REGEX; (3) Palantir xato qaytarsa yo'l tanlash ifodasi buzilardi (tasodifan AI'ga ketardi) — REGEX. Haqiqiy SIP liniya va administrator telefoni (ko'tarish) bilan — T5 |
| T2 | **Bir qadamli o'rnatish:** oldindan tekshiruv (Windows versiyasi, virtualizatsiya, disk, foydalanuvchi), qayta yuklashdan keyin o'zi davom etadi, oxirida o'zini sinaydi va xizmatni qayta yoqadi | O' · 🟡 (2026-11-15, `install/telefon.ps1`): hammasi yozildi — Windows 11 22H2+, virtualizatsiya, disk, administrator boshqa akkauntdan bo'lsa to'xtaydi; qayta yoqilgach RunOnce bilan o'zi davom etadi; administrator oynasi yozgani asosiy oynada ko'rinadi; oxirida Asterisk/telefonlar/Palantir'ga yetish tekshiruvi va Palantir qayta yoqiladi. `npm run test:install` — o'rnatgich fayllari ASCII va PowerShell'da xatosiz o'qiladi. Qoldi: toza Windows kompyuterda (WSL'siz) boshidan oxirigacha sinash — bu kompyuterda WSL bor |
| T3 | **Operator shakli:** Uztelecom / Zadarma / boshqa; ulanish tirikligini tekshirish (keepalive), NAT sozlamalari, parolsiz (IP bo'yicha) rejim, «Tekshirish» tugmasi — ro'yxatdan o'tdimi; Asterisk jurnali diagnostikaga | O' · 🟡 qisman (2026-11-15): Sozlamalar → Telefon liniyasi'da «Uztelecom» yorlig'i (birinchi; login — raqamning o'zi, «faqat Uztelecom internetida» eslatmasi), «Parolsiz — IP bo'yicha» (ro'yxatdan o'tmaydi, operator IP bilan taniladi); ro'yxatdan o'tish endi to'xtamaydi (avval internet ~10 daqiqa uzilsa yoki bir marta rad etilsa butunlay to'xtardi — shu kompyuter jurnalida 2026-10-28 da bo'lgan), har 30 s «tirikmisan» (qualify); «Unregistered» holati «ulangan» deb ko'rinardi — tuzatildi; «Raqamni tekshirish» tugmasi va ulanmaslik sababi odam tilida (403 — parol, 404 — login, javob yo'q — manzil/port/internet), sabab nazorat xabarida va server jurnalida (diagnostika). Qoldi: NAT ortida ovoz bir tomonlama bo'lsa — tashqi IP sozlamasi (haqiqiy liniyada, T5) |
| T4 | **Usta:** Telefon qadamida Uztelecom shakli ham; Gemini kaliti «telefon uchun shart» deb; matnlar bir xil (C1) | K–O' · ✅ (2026-11-15): ustaning Telefon qadamida «Uztelecom» (birinchi; softswitch, raqam, parol yoki parolsiz) va «Zadarma» yorliqlari, raqam holati va ulanmaslik sababi; Gemini kaliti yo'q bo'lsa ustada ham, Sozlamalar → Telefon liniyasida ham ogohlantirish, nazorat egasiga asl sababni aytadi («AI to'xtagan» emas), qadam belgisi «!»; Kalitlar ro'yxatida Gemini — «telefonda AI ovozi uchun shart» |
| T5 | **Haqiqiy Uztelecom raqamida sinov** — bitta klinika yoki egasining liniyasi. Operatordan: raqam formati, softswitch manzili, ajratilgan IP va shlyuz, VLAN, AON (raqam aniqlagich) ulanganmi | egasi bilan |
| T6 | Sinov natijasiga qarab: klinikada Uztelecom interneti yo'q bo'lsa — **Uztelecom VPS ko'prigi** (bitta VPS, bir necha klinika) | Kt, T5 dan keyin |
| T7 | AI liniyasi qo'ng'irog'i mijoz kartasiga bog'lanadi; MicroSIP bilan takror yozuv yo'q; administrator o'zi ko'targan qo'ng'iroq ham yoziladi | O' · ✅ (2026-11-15): kartaga bog'lash — F8, administrator ko'targani — F12; takror: Asterisk qo'ng'iroq boshida raqamni aytadi (`/api/voice/route?phone=`), qabulxonadagi MicroSIP administrator telefoni bo'lsa — uning «ko'tarilmadi» yozuvi (AI javob bergan qo'ng'iroq) olib tashlanadi va soxta «qayta qo'ng'iroq qiling» so'rovi ochilmaydi; ko'targanda Asterisk'ning «ko'tardi» xabari ikkinchi qator ochmaydi (MicroSIP'niki yozuvi bilan qoladi) |

Zadarma yo'li (kalit kiritiladi — o'zi sozlanadi) o'zgarmaydi; T1–T4 unga ham foyda.

## 3-bosqich. Egasi qaroridan keyin (B bandlari)

| band | qaror | eslatma |
| --- | --- | --- |
| B2 | Ustada javob rejimi so'ralsin («o'zi javob bersin» / «tasdiqlayman») | ✅ 2026-11-16 (d1d6657): «Javob rejimi» qadami, hech biri oldindan tanlanmagan; eski o'rnatishlarda rejim o'zgarmaydi |
| C2 | Ustada bemorlar yozadigan Telegram (Business + havola/QR) | K–O', qaror shart emas — B2 bilan birga |
| B1 | Qabulxona — asosiy xodim; Direktor — qo'shimcha (Palantir — asosiy) | ✅ 2026-11-16: baza v3 migratsiyasi — olib tashlagan klinikada javob «o'chiq», telefon yangi «Faqat administrator» rejimida; **alohida reliz** |
| B3 | Bitta nom («Palantir» yoki «Yordamchi») | nom — K–O'; bitta miya — Kt |
| B5, B6 | Qo'shimchalar obunani sarflamasin; «ertalabki xulosa» belgisi uchga ajralsin | K–O', B1 dan keyin |
| B7 | «O'zi javob bersin»da egasiga har javob uchun xabar emas — jim yoki yig'ma | O' |
| Bosh ekran | AI administrator: 3 kanal holati, rejim, bugungi sonlar, «Sizni kutyapti», yozishmalar | Kt, B1 dan keyin. Ko'pi Qabulxona sahifasida bor |
| D8 | Sinov muddati | Egasi qarori (2026-11-15): sinov muddati yo'q — kalit bilan, hozirgidek |

## 4-bosqich. Usta tartibi, matnlar, dublikatlar

C3 (kameralar ustadan chiqadi), C5 (yakuniy tekshiruv — «bemor bo'lib yozib ko'ring»: matnli sinov yangi), C6–C8 (matnlar, texnik
so'zlar, usta egasidan yashiriladi), C9 (ikki DentaCRM shakli → bitta), C10 (Instagram tester izohi), B4, B8, B9, B10, D3–D6.

## Egasidan kerak

1. ~~**B2**~~ — ha, aniq tanlov (bajarildi).
2. ~~**B1**~~ — ha, AI administrator asosiy; Direktor qo'shimcha (bajarildi).
3. ~~**B3**~~ — «Palantir» (bajarildi, 2026-11-15).
4. **Telefon:** egasi qarori — Windows 10 ni ham qo'llash. Ish: WSL NAT rejimida Asterisk (UDP SIP/RTP ichkariga yo'naltirilmaydi — yechim izlanadi); sinash uchun Windows 10 kompyuter kerak.
5. **T5:** haqiqiy Uztelecom raqami — qaysi klinikada va qachon sinaymiz?
6. ~~**D8**~~ — sinov muddati yo'q, kalit bilan.

## Qoldiq (rejadan tashqari, eslatma)

- 2026-11-07 dagi xavfsizlik tuzatishlari va Hub himoyasi (`7d8e07e`) — `main` da, push qilinmagan; Hub'ga joylangani tekshirilmagan.
- Klinikalarga yetishi uchun reliz kerak (kutubxonalar o'zgargan — `--modules`). 0.4.1 dagi klinika eski yangilovchida.
