# Mantiq auditi — 2026-11-12

Yo'nalish (egasi qarori, 2026-11-12): **Palantir klinika kompyuterida qoladi va bitta mahsulot bo'lib sotiladi** —
«AI administrator: bemorlarga Telegram, Instagram va telefonda kecha-kunduz javob beradi va DentaCRM'ga yozadi».
Qolgani (Direktor, Tahlilchi, kameralar, marketing, kontent, reklama) — qo'shimcha, standart bo'yicha o'chiq.

Usul: uch yo'nalish bo'yicha kod o'qildi — AI jamoa tuzilmasi, egasiga keladigan xabarlar, o'rnatishdan birinchi bemorgacha.
✔ — qo'lda qayta tekshirilgan. Qolganlari — kod o'quvchi topgan, qatorlari ko'rsatilgan; tuzatishdan oldin yana qarab chiqing.

Holat ustuni: «—» — tuzatilmagan.

## A. Aniq xatolar — noto'g'ri ishlaydi (egasi qarori shart emas)

| # | muammo | dalil | holat |
| --- | --- | --- | --- |
| A1 ✔ | AI bemorni qabulga yozadi, ertasi kuni u «💤 Unutilgan» ro'yxatiga tushadi va unga «qayta yozish» xabari tayyorlanadi | `server/inbox/core.ts:304-306` faqat `setPatient`, bosqich o'zgarmaydi; `server/db.ts:449-451` `active` = new/contacted; `server/plan.ts:65-66` faqat `nextAt` ga qaraydi; `src/data/industries.ts:67` klinikada `followDays: 1` | ✅ (keyingi commit) qabul yozilganda «Mijoz bo'ldi» — yozishma va MicroSIP qo'ng'irog'i; qayta yozgan bemor — G3 ✅ |
| A2 ✔ | Telegram ulanmagan va xodim yo'q bo'lsa, uzatilgan bemor xabari haqida hech kimga xabar bormaydi, «Sizni kutyapti»ga ham tushmaydi (xabarning o'zi Yozishmalar'da qoladi) | `server/requests/index.ts:132` `if (!outlet \|\| !to.length) return []`; `server/inbox/core.ts:503-510` navbatga faqat xato bo'lganda | ✅ (keyingi commit) AI javob bermay uzatgan suhbat — panelda «Sizni kutyapti» («javob kutyapti», «Javob kerak emas»); hech kimga yetmasa — navbatga, egasi ulanganda yetadi |
| A3 ✔ | Qabulxona jamoadan olib tashlansa ham telefondagi AI javob beradi va DentaCRM'ga qabul yozadi (ekranda «javob bermaydi» deyiladi) | `server/voice/*` da `crewWorks` yo'q (`voice/routes.ts:97-101`, qabul `:167`); `src/pages/CrewPage.tsx:52` | qisman (keyingi commit): Qabulxona olinmagan bo'lsa telefon AI jadval olmaydi va qabul yozmaydi (handoff); qo'ng'iroqni umuman ko'tarmaslik — telefon bosqichida (dialplan) |
| A4 ✔ | Miya → Brend'da brend-buk to'ldirilsa, Kontent-meyker o'zi jamoaga qo'shiladi; brend-buk asbobi hamon Kontent-meykerda — u olinmagan bo'lsa Yordamchi brend-buk yozmaydi | `server/crew.ts:39-40` `has('content_brand')`; `server/content/tools.ts:70`; `server/agent.ts:111` | ✅ (keyingi commit) brend-buk Kontent-meykerni yollamaydi; `content_brand_book` — hammaniki (Yordamchi ham, Kontent-meyker topshirig'i ham) |
| A5 | Qabulxona kartasi telefon liniyasini bilmaydi — liniya ishlasa ham «Kanal ulanmagan»; aksincha bot tokeni bo'lsa «Navbatchilikda», hatto «tasdiqlayman» rejimida | `src/components/team.tsx:118,152`; `src/types.ts:329-357` (LiveStatus'da telefon yo'q) | ✅ (keyingi commit) kartada telefon liniyasi (api.phoneLine) va javob rejimi: «Navbatchilikda» faqat «o'zi javob bersin»da yoki telefonda; aks holda «Javoblarni siz tasdiqlaysiz» + rejim havolasi |
| A6 | Shikoyat qabulxonadagi hamma xodimga, shikoyat qilingan xodimning o'ziga ham boradi; «So'rovlar nusxasi menga ham» o'chirilsa egasi shikoyatni Telegram'da ko'rmaydi | `server/requests/index.ts:49-52`; `src/pages/RequestsPage.tsx:182` | ✅ (keyingi commit) shikoyat — faqat egasiga (nusxa o'chiq bo'lsa ham), egasi ulanmagan bo'lsa — xodimlarga |
| A7 | Qabulxona xodimi (reception login) jamoa jurnalini (kamera ogohlantirishlari, Direktor topshiriqlari) va egasining vazifalarini ko'radi | `server/access.ts:19`, `server/teamDay.ts:131` (`/api/team/day`); `server/http.ts:579-582` (`/api/tasks`) | ✅ (keyingi commit) qabulxonaga `team/day` va `tasks` yopildi |
| A8 | Claude obunasidan chiqib ketish yoki limit tugashi kanallar nazoratida yo'q — AI jim qoladi, egasi ham, Hub ham bilmaydi | `server/monitor.ts:33-50`; faqat kartaga izoh `server/inbox/core.ts:217-218` | ✅ (keyingi commit) kanallar nazoratida «Claude (AI)»: obuna, kalit, mablag', bemorlarga javob chegarasi — egasiga bir marta, Hub ham ko'radi |
| A9 | Direktor tasdiqlangan taklifni Kontent-meyker, Targetolog, Tahlilchi, Marketologga «topshiradi», lekin ularning fon ishlari topshiriqni o'qimaydi; natija baribir o'lchanadi | `server/director/index.ts:71,207`; o'qiydiganlar faqat `agent.ts:125,146`, `brain/index.ts:104,252`, `orders/look.ts:31` | ✅ (keyingi commit) Direktor faqat topshiriqni o'qiydiganlarga (Qabulxona, Yordamchi, Kuzatuvchi, egasi); fon ishlariga topshiriqni ulash — keyinroq |
| A10 | Kuzatuvchi olinmagan bo'lsa ham Yordamchi kamera nomuvofiqliklarini aytadi; Sozlamalar → Kameralar izohsiz «AI xodimlar»ga qaytaradi | `server/crm/tools.ts:71`; `src/LiveApp.tsx:91-93`; `src/pages/settings/SettingsHub.tsx:66` | qisman (keyingi commit): `clinic_cameras` — Kuzatuvchiniki (olinmagan bo'lsa asbob ham, ko'rsatmadagi qator ham yo'q); Sozlamalar → Kameralar plitkasi — 4-bosqichda |
| A11 | «Qabulxonaga ayting / Qabulxona qo'ng'iroq qilsin» deyiladi, lekin xabar faqat egasiga boradi | `server/orders/run.ts:107`; `server/botButtons.ts:239-246` | ✅ (keyingi commit) odamga tegishli gaplar — «Administratorga ayting», «Administrator qo'ng'iroq qilib» |
| A12 | Javob qoralamalari hech qachon eskirmaydi — ertalab bir necha kunlik eskilari ham «N ta javob» deb sanaladi | `server/db.ts:567`; `server/plan.ts:92` | ✅ (keyingi commit) 48 soatdan eski taklif eskiradi (karta «⌛ Eskirdi»), bemor javobsiz bo'lsa — «javob kutyapti» |
| A13 | Ertalabki xabar qayta yuborilganda Direktor qismi tushib qoladi; ustadagi namuna Direktorsiz (haqiqiysidan farq qiladi) | `server/director/telegram.ts:16`; `server/setup/routes.ts:150` | ✅ (keyingi commit) qayta yuborilganda hisobot saqlangan tahlildan yig'iladi; ustadagi namuna — admin yo'li, klinika nashrida yopiq (tegilmadi) |
| A14 | Kanallar nazoratida tungi sukut yo'q (tunda o'chiriladigan kamera — har kecha ogohlantirish); Telegram'i ulanmagan biznes umuman tekshirilmaydi | `server/monitor.ts:57-84`, `:61` | ✅ Telegramsiz biznes ham tekshiriladi (015046c); tungi sukut — keyingi commit (REQUEST_HOURS dan tashqarida egasiga aytilmaydi, ertalab davom etsa — aytiladi) |

## B. Tuzilma — A yo'liga teskari (egasining qarori kerak)

| # | muammo | dalil | holat |
| --- | --- | --- | --- |
| B1 ✔ | Asosiy mahsulot — Qabulxona — standart jamoada yo'q, olib tashlash mumkin; Direktor va Yordamchi esa olib tashlanmaydi. DentaCRM ulansa Qabulxona emas, Tahlilchi qo'shiladi; Palantir boti, shaxsiy Telegram, telefon liniyasi «mijoz kanali» hisoblanmaydi | `src/lib/crew.ts:18,91`; `server/crew.ts:33-34`; `src/pages/AiPage.tsx:195-196`; `src/pages/CrewPage.tsx:164` | — |
| B2 ✔ | Standart javob rejimi — «tasdiqlayman»: kechasi bemor faqat «yetkazildi, tez orada javob beramiz» oladi. Ustada rejim so'ralmaydi. «24/7» standart holatda bajarilmaydi | `server/inbox/core.ts:67`; `server/bot.ts:266-270` | — |
| B3 | «Palantir» va «Yordamchi» — egasining bitta yordamchisiga ikki nom; ovoz esa alohida miya (Gemini Live, 5 ta asbob, qolganini Yordamchidan 9 s kutadi). Ovozli kirish 3 joyda. Panelda gapirilsa ham uzun javob Telegram'ga ketadi | `src/pages/AiPage.tsx:55-57`; `src/pages/ChatPage.tsx:226,315`; `tgvoice/call_live.py:43,85-106`; `server/http.ts:517-518` | — |
| B4 | Tahlilchining o'z ishi yo'q (Yordamchi asboblari; haftalik tahlil Direktor ichida). «Raqamlar», «To'liq hisobot» va Direktor sahifasi — bir xil raqamlar | `server/tools.ts:417`; `src/components/agent.tsx:156,180`; `src/pages/agents/Analyst.tsx:21`; `Dashboard.tsx:255-257`; `DirectorPage.tsx:116` | — |
| B5 | Qo'shimchalar bemorlarga javob beradigan obunani sarflaydi: Direktor har tong, ertalabki xulosa standart yoqiq — limit tugasa bemorlarga javob to'xtaydi | `server/scheduler.ts:65`; `morningBrief ?? true` | — |
| B6 | Bitta belgi («Har kuni ertalab xulosa») kechki savolni, kamera hisobotini va Direktorni ham o'chiradi. Kechqurun bog'lanmagan ikki xabar: 19:00 «Kun qanday o'tdi / kim bilan gaplashdingiz» (sotuvchi uchun savol) va 20:00 kamera hisoboti | `src/pages/TelegramPage.tsx:262`; `server/scheduler.ts:343,359`; `server/camera/report.ts:43`; `server/env.ts:144,270` | — |
| B7 | «O'zi javob bersin» rejimida egasiga har javob va har qabul uchun alohida ovozli xabar (kuniga 30–50), tunda ham; xodimga bormaydi | `server/inbox/core.ts:414,582`; `server/bot.ts:699-701` | — |
| B8 | Bitta voqea — ikki karta: bemor xabari (so'rov + javob kartasi), MicroSIP qo'ng'irog'i (so'rov + xulosa). Bitta eslatma — 3 xabar + qo'ng'iroq | `server/inbox/core.ts:262,301`; `server/phone/index.ts:308-310`; `server/scheduler.ts:283-296` | — |
| B9 | «Tez kunda»da 12 xodim; ba'zilari bor ishni takrorlaydi: Mijozlarni qaytaruvchi (ertalabki reja + Qabulxona), Kassa nazoratchisi (Kuzatuvchi), Sifat nazoratchisi (Tahlilchi «Jamoa») | `src/pages/CrewPage.tsx:22-47`; `server/plan.ts:117-118`; `src/pages/TeamPages.tsx:120-123` | — |
| B10 | «Qabulxona» — ham AI xodim, ham odam administrator (hisobot va ertalabki reja odamni shunday ataydi) | `server/analytics.ts:142`; `server/plan.ts:118` | — |

## C. O'rnatish yo'li

| # | muammo | dalil | holat |
| --- | --- | --- | --- |
| C1 ✔ | Telefon exe'dan keyin ishlamaydi: o'rnatgich telefon xizmatini (WSL + Asterisk) o'rnatmaydi, usta esa «o'zi ulanadi» deydi. Telefon AI Gemini'da, lekin Gemini «ixtiyoriy» deb yozilgan. Operator matnlari har xil (Zadarma / Uztelecom / MicroSIP) | `install/ornatish.ps1:253-254`; `src/pages/setup/StepPhone.tsx:52`; `src/pages/setup/secrets.ts:17`; `docs/ORNATISH.md:40` | — |
| C2 | Bemorlar yozadigan Telegram (Business + havola/QR) ustada yo'q — faqat Sozlamalarda | `src/pages/setup/wizard.ts:35`; `SettingsHub.tsx:98,112` | — |
| C3 | Qo'shimchalar asosiy yo'lga aralashgan: Kameralar — 5-qadam, Telegram/Instagram/telefondan oldin; yakunda «7/8 tayyor — chala qolganlarini tugating» | `src/pages/setup/wizard.ts:18-22,64`; `StepFinish.tsx:72-73` | — |
| C4 | Obunaga kirishdan oldin «Claude kaliti — majburiy, sk-ant-…» ko'rinadi (standart dvigatel — API) | `server/env.ts:106`; `src/pages/setup/secrets.ts:16`; `StepKeys.tsx:24,134` | ✅ (keyingi commit) obuna kartasi birinchi; obuna yo'li bor kompyuterda Claude kaliti majburiy emas («pullik; obuna o'rniga»); «Kalitlar» qadami AI ishlamasa tayyor emas |
| C5 | Yakuniy tekshiruv bemorni emas, egasining yordamchisini sinaydi («Bugun nechta qabul bor?») | `src/pages/setup/StepFinish.tsx:100` | — |
| C6 | O'rnatgich matnlari eskirgan: «ULANISH KODINI qo'ying» (birinchi ekran — litsenziya), «Bloknotda oching» | `install/ornatish.ps1:190,336` | — |
| C7 | Klinika xodimiga texnik so'zlar: BOT_TOKEN, Server/Port, Zoiper, `http://192.168.1.20:3001`, Hub kodi, port ochish, «Server kompyuterida» | `TelegramPage.tsx:100,271,320`; `PhoneLine.tsx:137-141,223`; `DentaCrmSection.tsx:73`; `ClaudeObuna.tsx:77`; `SettingsHub.tsx:69` | — |
| C8 | O'rnatuvchi ustasi topshirgandan keyin ham egasiga ochiq: «Klinikada o'tgan vaqt», 9 kalit jadvali (SpeechLab ham) | `SettingsHub.tsx:68`; `SetupWizard.tsx:108-111`; `secrets.ts:16-23` | — |
| C9 | Bir narsa bir necha joyda: DentaCRM shaklasi 2 ta (biri manzilni o'zi topadi, biri yo'q), «tayyormi» ro'yxati 3 ta, klinika ma'lumoti 2 shakl, narxlar 3 joyda | `DentaCrmSection.tsx:23-30` / `StepConnections.tsx:58`; `lib/setup.ts`; `StepProfile.tsx:280` / `TelegramPage.tsx` | — |
| C10 | Instagram «Ulash»dan keyin Meta tester taklifi kerak — ustada aytilmaydi | `docs/INSTAGRAM.md:33-36`; `StepConnections.tsx:129` | — |

## D. Kichik qoldiqlar

- ✅ (keyingi commit) Bosh ekrandagi «bugungi jurnal» olinmagan xodimlar yozuvlarini ham ko'rsatadi — `server/teamDay.ts:135`.
- ✅ (keyingi commit) Marketolog va Tahlilchi topshiriqlari ular olinmagan bo'lsa ham Yordamchi ko'rsatmasiga qo'shiladi — `server/agent.ts:148`.
- Faqat Targetolog olingan bo'lsa ham telefondagi tugma «SMM» — `src/components/Rail.tsx:18`.
- Eski «To'liq hisobot» sahifasi eski manzillar bilan; «Xodim qo'shish» So'rovlarga olib boradi — `Dashboard.tsx:148,163`.
- Bot o'zini «biznesingiz uchun AI yordamchi» deb tanishtiradi, «AI administrator» emas — `server/botKit.ts:123`.
- Panel va Telegram har xil: kamera xabarida «Ko'rdim» yo'q (band 24 soat turadi), panelda «Bajarildi» natija so'ramaydi, taklif tugmalari har xil nomda — `attention.ts`, `botButtons.ts:302`, `director/logic.ts:91`.
- ✅ (keyingi commit) Xodim yozgan javob egasiga «Javobingiz» deb eslab qolishga taklif qilinadi — `server/brain/learn.ts:49`. Endi «Aziza javobi», kartada «Aziza javob berdi», xodim tuzatishi «egasining tuzatishi» emas.
- Yangi o'rnatish kalitsiz bir kun ham ishlamaydi (`server/license.ts:26`, `NEW_GRACE_DAYS = 0`) — sotuvda «14 kun bepul» deb aytilmasin, yoki sinov muddati qo'shilsin (egasi qarori).

## Taklif: klinikaga standart ko'rinish

- **Bosh ekran = AI administrator:** 3 kanal holati (Telegram / Instagram / Telefon), javob rejimi, bugun: nechta javob, nechta qabul, nechtasi sizni kutyapti; «Bemor bo'lib sinash»; yozishmalar.
- **Menyu:** Qabulxona (yozishmalar, qo'ng'iroqlar, so'rovlar) · Bilim (narxlar va savollar) · Sozlamalar (kanallar, javob rejimi, xodimlar, yordam) · Qo'shimchalar (standart o'chiq: Direktor, Yordamchi va ovozli sfera, Kuzatuvchi, Tahlilchi, Marketing, to'liq Miya).
- **Usta tartibi:** Litsenziya → Klinika → Claude obunasi → Telegram (bot + Business + havola) → Instagram → Telefon (Gemini bilan) → DentaCRM → Bilim → Javob rejimi → Bemor bo'lib sinash → Egasiga topshirish.

## Tuzatish tartibi

1. Aniq xatolar: A1–A8, C1 (telefon xizmati o'rnatgichda), C4.
2. Egasi qaroridan keyin: B1 (Qabulxona asosiy), B2 (javob rejimi ustada), B3 (bitta nom), bosh ekran = AI administrator, B5–B7.
3. Usta tartibi (C2, C3, C5), matnlar (C6, C7, B10), dublikatlar (C9, B4, B8, B9), qolganlari.

## Qayta tekshiruv — 2026-11-13

Hamma band kod bilan qayta solishtirildi (uch o'quvchi + qo'lda: A1, A7, telefon dialplani, liniya sozlamasi). Hech biri hali tuzatilmagan.

- **To'liq tasdiqlandi:** A1–A7, A10–A12, A14, B1–B3, B6–B10, C1–C8, C10, D1–D8.
- **Qisman:** A8 — egasiga har xabarda aytiladi (Telegram ulangan bo'lsa), yo'g'i — bitta ogohlantirish va Hub'ga xabar. A9 — topshiriqni
  Yordamchi, javob beruvchi va kamera o'qiydi; kontent, reklama, tahlil, marketing — o'qimaydi. A13 — ikkinchi yarmi (ustadagi namuna)
  klinika nashrida tekshirilmadi. B4, C9 — ayrim qatorlar ochilmadi. B5 — Direktor kuniga bir marta va 14 kunda 3 tadan kam murojaatda
  modelni chaqirmaydi: sarf yozilganidan kichik, asl bo'shliq — ogohlantirish yo'qligi (A8).
- **Yangi (audit o'tkazib yuborgan):** `server/phone/index.ts:302` — telefonda qabulga yozilgan bemor ham faqat «bog'lanildi»ga o'tadi,
  A1 bilan birga tuzatiladi.
- **A7:** 2026-11-07 dagi `4016b49` dan keyin ham ochiq — `server/access.ts` da `team/day` va `tasks` qabulxonaga ruxsat etilgan.
- **Yo'l o'zgargan:** `src/pages/setup/secrets.ts` → `src/lib/secrets.ts`; `Dashboard.tsx` → `src/pages/dashboard/Dashboard.tsx`.
- **C1 kengaytmasi (telefon):** exe WSL/Asterisk'ni o'rnatmaydi; `Telefon.cmd` — joyda, qayta yuklash bilan, ikki marta; tarmoq rejimi
  (mirrored) faqat Windows 11 da, skript tekshirmaydi; `[ai]` konteksti avval ko'taradi, AI ulanmasa uzadi (`extensions.conf`);
  liniya shakli faqat login/parol + UDP, keepalive va NAT sozlamalarisiz (`server/voice/line.ts`); Uztelecom shakli ustada yo'q.

Ish tartibi — `docs/ISH-REJASI.md`.

## Chuqur audit — 2026-11-13 (ikkinchi to'lqin)

Olti yo'nalish: bemor suhbati (matn), DentaCRM va telefon, holatlar va raqamlar, sotuvchi ishi (Hub, litsenziya, yangilanish, zaxira),
yangi klinika kabi jonli ishga tushirish (headless, soxta xizmatlar, 139 surat — `D:\palantir-sinov-tmp\audit-ui\shots`), birinchi auditni
inkor qilishga urinish. ✔ — qo'lda kodda qayta tekshirilgan. Yuqoridagi bandlar takrorlanmagan.

**Birinchi auditga tuzatishlar (inkor qiluvchi tekshiruv):**
- D4 — **noto'g'ri:** eski manzillar ishlaydi, «Xodim qo'shish» to'g'ri joyga olib boradi. Olib tashlansin.
- A1 — bemor «ertasi» emas, odatda **ikkinchi tongda** «unutilgan»ga tushadi (`idleDays` to'liq 24 soat, reja 08:00 da).
- B1 — Qabulxona jamoada ko'rinmasa ham fonda **ishlaydi** (`works()` = «egasi olib tashlamagan»); muammo — ko'rinish va egalik, javob emas.
- A7 — xodim tokeni bilan egasining vazifalarini **o'zgartira ham oladi** (POST/PATCH `/api/tasks`), faqat o'qish emas.
- A8 — limit tugasa egasi har bemor kartasida sababini oladi; yo'q narsa — oldindan ogohlantirish, Hub, panel. «O'zi javob bersin»da bemor tunda hech narsa olmaydi (E1) — shuning uchun KATTA.

### E. Bemor suhbati (matn kanallari)

| # | muammo | dalil | jiddiylik |
| --- | --- | --- | --- |
| E1 | «O'zi javob bersin» rejimida AI javob bermasa (bilmaydi, shikoyat, shoshilinch og'riq/qon, limit, xodim yaqinda yozgan) — bemor **hech narsa olmaydi**, «yetkazildi» ham. Instagram va Telegram Business'da «yetkazildi» umuman yo'q | `server/bot.ts:266` ✔; `server/inbox/core.ts:292,300,232-235,252-255` | KATTA · ✅ (keyingi commit) AI javob bermasa bemorga soatiga bir marta «xodimga yetkazildi», shoshilinch belgida — 103; Instagram «so'rovlar»iga yozilmaydi (yozish so'rovni qabul qiladi) |
| E2 ✔ | Botni havolasiz topib Start bosgan bemorga «Bu Palantir — biznes uchun AI yordamchi. Biznes egasi bo'lsangiz…» — klinika bu odamni ko'rmaydi | `server/bot.ts:295-298`, `:522-524` | KATTA · ✅ (keyingi commit) o'rnatishda bitta faol biznes bo'lsa — o'sha klinikaning mijozi (manba «Telegram (havolasiz)»); bir nechta bo'lsa — eskicha |
| E3 ✔ | Botda matndan keyin rasm kelsa tayyor javob tashlanadi, karta chiqmaydi; video, dumaloq video, stiker, lokatsiya — ishlovchi yo'q, jim tashlanadi; bemor ovozi o'qilmaydi | `server/bot.ts:259-261,431-611`; `server/inbox/core.ts:258` | KATTA · ✅ qisman (keyingi commit): video, dumaloq video, GIF, stiker, lokatsiya — egasiga asl nusxasi, yozishmada turi bilan; bemor ovozi matnga aylanadi va AI javob beradi. ✅ (keyingi commit) rasmdan keyin tayyor javob tashlanmaydi: matnsiz xabar ham navbatdagi ishlovni boshlaydi, AI savol va «[rasm]» belgisini birga ko'radi; botda faqat rasm kelsa — AI javob yozmaydi (asl nusxasi egasida) |
| E4 | Kompyuter o'chiq paytda kelgan xabar ertalab «hozir» deb javoblanadi (23:50 «bugun bormi?» → ertangi kun); rejalashtirilgan va 2 kunlik kartadagi javob ham yoshi tekshirilmay ketadi | `server/bot.ts:254-258`; `inbox/telegramBusiness.ts:79`; `inbox/instagramApi.ts:136`; `core.ts:574-598` | O'RTA |
| E5 | Kechikkan avto-javob yangi savolni «javob berilgan» qilib yutadi (2 daqiqa kechikish ichida bemor yana yozsa) | `core.ts:183-193,209-212,227-228`; `env.ts:225` | O'RTA · ✅ (keyingi commit) javob tayyorlangandan keyin bemor yana yozgan bo'lsa — eski javob yuborilmaydi («eskirdi»), yangi ishlov hammasiga birga javob beradi (botdagi rasm bundan mustasno) |
| E6 | Yozishmada aytilgan, tasdiqlanmagan raqam ikki odamni bitta kartaga qaytarib bo'lmaydigan qilib qo'shadi; bir so'zli ism doim «mos»; javob oxirgi kanalga ketadi (boshqa odamga) | `core.ts:102,319,324,566`; `server/people.ts:37-58`; `server/personRules.ts:16` | O'RTA · 🟡 qisman (keyingi commit): yozishmada aytilgan (tasdiqlanmagan) raqam endi faqat messenjersiz va bemorsiz kartani (qo'ng'iroq, qo'lda) yig'adi — boshqa Telegram/Instagram odamining kartasi qo'shilmaydi, javob boshqa odamga ketmaydi. Qoldi: shu raqam bilan karta DentaCRM bemoriga bog'lanib, bemorning ismi kartaga yoziladi (egasi «Zarina»ni «Vali Valiyev» deb ko'radi; modelga bormaydi); ishonchli raqamda bir so'zli ism hamon «mos» |
| E7 | Narx himoyasi: bemor aytgan raqam «ma'lum» hisoblanadi («50% chegirma qilasizmi?» → o'tadi); «2 mln» da faqat «2» qidiriladi; «3,5 mln» va klinika raqami boshqa yozilsa — yolg'on ushlanadi | `inbox/replier.ts:196`; `inbox/offerGuard.ts:9,79`; `src/lib/compliance.ts:28,39` | O'RTA · ✅ (keyingi commit) narx va foiz qiymat bo'yicha solishtiriladi («3,5 mln» = «3 500 000 so'm», «2 mln» ≠ «2 yil»); «ma'lum» — faqat biznes ma'lumoti va bizdan chiqqan xabarlar, bemorning o'z gapi emas |
| E8 | Kod darajasida faqat narx/chegirma/raqam ushlanadi — ish vaqti, manzil, shifokor kabi faktlar tekshirilmaydi (jonli sinovda soxta model bo'sh ish vaqtini o'zi yubordi; haqiqiy Claude'da sinalmagan) | jonli: `audit-ui/texts-s5b.txt:153`, surat `55-qabulxona-ikkinchi-bemor.png` | O'RTA · ✅ (keyingi commit) yozishmada: ish vaqti oralig'i, ko'cha/mavze nomi va «doktor X» ma'lumotda (profil, faktlar, bilim, CRM jadvali, bizdan chiqqan xabarlar) bo'lmasa — javob o'zi ketmaydi, egasiga «saqlang» izohi bilan (`inbox/factGuard.ts`). Telefon AI'da — hali yo'q |
| E9 | Narx yangilansa eski «eslab qolingan» narx bilimda qoladi; «Eslab qolaymi?» 24 soat ichidagi istalgan javobni eski savolga juftlaydi | `server/brain/index.ts:43-52`; `brain/logic.ts:72`; `db.ts:581-586`; `brain/learn.ts:36-41` | O'RTA |
| E10 | «Yozmang» degan bemorga ham qayta yozish tayyorlanadi (rad etish belgisi yo'q) | `core.ts:321`; `plan.ts:103` | KICHIK |
| E11 | Tahrirlangan xabar o'qilmaydi; betaraf javob faqat o'zbekcha; «yetkazildi» xaritasi qayta yoqilganda takrorlanadi; rasmiy Instagram'da uzun javob bo'laklari «egasi yozdi» deb olinib AI 2 soat qoralamaga o'tadi | `bot.ts:221,770`; `core.ts:337`; `instagramApi.ts:65-69,129` | KICHIK |
| E12 ✔ | Javob rejimi «o'chiq» bo'lsa Telegram Business xabari **umuman saqlanmaydi** (izoh «xabarlar saqlanaveradi» deydi) | `inbox/telegramBusiness.ts:70`; `core.ts:68` | O'RTA · ✅ (keyingi commit) saqlanadi, AI javob tayyorlamaydi |
| E13 | Egasining shaxsiy Telegram'iga (Business) yozgan har kim «bemor» bo'ladi; egasi yoki xodim bemor havolasini bossa ham karta ochiladi | `telegramBusiness.ts:79`; `bot.ts:230` | O'RTA |

### F. DentaCRM va telefon

| # | muammo | dalil | jiddiylik |
| --- | --- | --- | --- |
| F1 ✔ | **Ta'tildagi shifokorga yozadi:** DentaCRM holati `'On Leave'`, Palantir mavjud bo'lmagan `'Inactive'` ni tekshiradi | `server/crm/reception.ts:35`; `dentalocal/types.ts:37` | KATTA · ✅ (keyingi commit) faqat «Active» (yoki holatsiz); egasining `free_slots` asbobi ham «CRM'da holati: On Leave» deydi |
| F2 ✔ | **DentaCRM oynasi yopilsa uning serveri ham o'chadi** → kechasi qabulga yozish to'xtaydi, har kech «⚠️ DentaCRM» | `dentalocal/electron/main.ts:692-695`; `server/crm/reception.ts:66-69` | KATTA |
| F3 ✔ | Bekor qilingan kunga qayta yozilsa: DentaCRM eski qatorni tiriltirib yozadi, Palantir «Yozilmadi» deydi — CRM'da qabul bor, bemor bilmaydi | `dentalocal/backend/server.ts:1331-1346`; `server/crm/dentacrm.ts:373-376` | KATTA · ✅ (keyingi commit) tiriltirilgan (avval bekor qilingan) qator — yangi qabul |
| F4 ✔ | Gemini ishlamasa (kvota, kalit) qo'ng'iroq ko'tarilib jim uziladi — so'rov yo'q, hech kim bilmaydi; nazorat faqat port ochiqligini ko'radi | `tgvoice/sip_live.py:375-376`; `call_live.py:533-542`; `server/voice/line.ts:98-102` | KATTA · ✅ (keyingi commit) AI ishga tushmasa, suhbatda uzilsa, ovoz xizmati o'chiq yoki hamma liniya band bo'lsa — qo'ng'iroq administratorga ([yordam], 20 s); ko'tarmasa uzr xabari va «qayta qo'ng'iroq qiling» so'rovi. Yangi qo'ng'iroq yo'llari yangilanishdan keyin Asterisk'ka o'zi o'rnatiladi. Haqiqiy Asterisk'da hali sinalmagan |
| F5 ✔ | Shifokor tushlik vaqti o'qilmaydi — bo'sh deb taklif qilinadi, DentaCRM 409 qaytaradi | `server/crm/logic.ts:158-181`; `dentalocal/backend/doctorSchedule.ts:37` | O'RTA · ✅ (keyingi commit) tushlik o'qiladi: taklif qilinmaydi, «tushlik 13:00–14:00» deb rad etiladi |
| F6 ✔ | Telefonda CRM javobi noma'lum bo'lsa AI boshqa vaqtga yana yozadi (ikki qabul); chatda to'g'ri | `server/voice/routes.ts:32,186-188`; chat — `core.ts:407-408` | O'RTA · ✅ (keyingi commit) AI'ga `code: unknown` — boshqa vaqtga yozmaydi, «administrator tekshirib tasdiqlaydi» deydi; shu raqamga bir soat yozish/o'zgartirish to'xtaydi; administratorga «CRM'da tekshiring» so'rovi darhol ochiladi (ko'chirish/bekor qilishda ham) |
| F7 | Telefon AI chat qoidalariga bo'ysunmaydi: javob rejimi, kod darajasidagi filtrlar, umumiy chegaralar, bilim (narxsiz xizmatlar, tuzatishlar), ko'chirish/bekor qilish — hammasi farq qiladi | `routes.ts:167-185`; `replier.ts:252-267`; `core.ts:345-348`; `brain/index.ts:239-262` | O'RTA |
| F8 ✔ | Telefondagi qabul va suhbat bemor kartasiga bog'lanmaydi (`lead_id` siz) | `voice/routes.ts:183,215`; `db.ts:767-771` | O'RTA · ✅ (keyingi commit) AI suhbati raqam bo'yicha mijoz kartasiga (kartada qo'ng'iroqlar tarixi); telefonda yozilgan qabul — karta DentaCRM bemoriga bog'lanadi, «yozildi» bosqichi, kutayotgan so'rovlari yopiladi (yozishmadagi kabi) |
| F9 | Qaytgan bemor ism yozilishi sababli topilmaydi (Valiyev/Valiev/Валиев) → dublikat bemor | `server/crm/logic.ts:250-256` | O'RTA |
| F10 ✔ | 4 daqiqada qo'ng'iroq ogohlantirishsiz uziladi, so'rov ochilmaydi | `sip_live.py:51`; `call_live.py:550-552` | O'RTA · ✅ (keyingi commit) mijozga 7 daqiqa; oxirgi daqiqada AI'ga «yakunla, kerak bo'lsa so'rov qoldir, xayrlash» aytiladi; baribir tugamasa — administratorga ([yordam]) |
| F11 | DentaCRM logini roli tekshirilmaydi (shifokor logini → faqat o'z bemorlari → dublikatlar); 403 «parol o'zgargan» deb ko'rsatiladi | `server/crm/index.ts:42-44`; `dentacrm.ts:245-250` | O'RTA |
| F12 | Yashirin raqamdan so'rov «So'rovlar»ga tushmaydi; administrator o'zi ko'targan qo'ng'iroq iz qoldirmaydi; MicroSIP bahosi xodimga bog'lanmaydi; umumiy telefon eng eski kartaga yoziladi; odam suhbatlari ogohlantirishsiz yoziladi | `reception.py:248`; `extensions.conf:81-85`; `phone/index.ts:301,315`; `people.ts:113-114` | KICHIK |

### G. Holatlar va raqamlar

| # | muammo | dalil | jiddiylik |
| --- | --- | --- | --- |
| G1 ✔ | **So'rovlar o'zi hech qachon yopilmaydi:** AI qabulga yozsa ham, xodim qo'ng'iroq qilsa ham — faqat tugma bilan. 3 eslatmadan keyin jim, abadiy «ochiq»; «Sizni kutyapti» eng **eski** 30 tasini oladi — yangisi ko'rinmay qoladi | `closeRequest` faqat tugmalardan; `phone/index.ts:218`; `requests/timing.ts:11`; `requests/store.ts:59-62`; `attention.ts:46` | KATTA · ✅ (keyingi commit) qabul yozilsa (yozishmada yoki qo'ng'iroq tahlilida) — shu bemorning «yozilish» va «qayta qo'ng'iroq» so'rovlari o'zi yopiladi (shikoyat — yo'q); «qayta qo'ng'iroq»ga bog'langan qo'ng'iroqda ≥5 s gaplashilsa — yopiladi; «Sizni kutyapti» — ochiq so'rovlarning eng yangi 30 tasi. 3 eslatmadan keyingi jimlik o'zgarmadi |
| G2 | **Direktor har kuni «kelganlar va tushum kamaydi» deydi:** oxirgi 7 kun bemorlari hali kelib ulgurmagan, oldingi 7 kunnikiga qo'shimcha 7 kun berilgan | `server/funnel.ts:93,98`; `director/index.ts:56` | KATTA · ✅ (keyingi commit) oldingi davr bir davr oldingi «bugun» bilan o'lchanadi — ikkalasi bir xil yetilgan. Panel voronkasi (Tahlilchi) hali eskicha |
| G3 | Bosqichdan avtomatik chiqish yo'q: kelgan/to'lagan bemor «unutilgan»; `lost` bemor yana yozsa qaytmaydi; follow-up soni chegarasiz (A1 ning umumiy holi) | `core.ts:109`; `phone/index.ts:302`; `db.ts:405-409` | KATTA · ✅ (keyingi commit) `server/stages.ts`: «Yo'qotildi»dagi mijoz o'zi yozsa yoki qo'ng'iroq qilsa — «Gaplashildi»ga qaytadi; DentaCRM'da kelgan (Completed / Checked-In) yoki to'lagan bemor — «Mijoz bo'ldi» (yarim soatda bir, bugun va kecha); 3 marta yozilib javob bo'lmasa — ertalab «Yo'qotildi», rejada aytiladi |
| G4 ✔ | Doimiy ko'rsatmalar jami 3000 belgidan oshsa **yangilari jim tashlanadi** (eskisi birinchi); Direktorning har tasdiqlangan taklifi ko'rsatma qo'shadi va o'chmaydi | `server/orders/store.ts:70-72` | O'RTA · ✅ (keyingi commit) sig'masa — yangilari ustun; to'lganda panel va Direktor tasdig'i rad etadi (sababi bilan); natija bermagan Direktor topshirig'i tekshiruvda o'chadi |
| G5 | Direktor qarori CRM uzilsa abadiy «topshirildi»; eski takliflar faqat yangi tahlilda yopiladi | `director/index.ts:152,182` | O'RTA |
| G6 | «Javobsiz» soni faqat kunning birinchi xabariga qaraydi; «Qabulga yozildi» KPI va voronkada ikki xil son; xodim panelda yopgan so'rov egasiga yoziladi | `analytics.ts:97,102,117,120,142`; `funnel.ts:45,92`; `requests/routes.ts:33` | O'RTA |
| G7 | «Bugun N qo'ng'iroq» UTC bo'yicha — 00:00–05:00 dagi tungi qo'ng'iroqlar sanalmaydi | `src/components/team.tsx:138`; `TeamPages.tsx:56` | O'RTA |
| G8 | «Sizni kutyapti» to'liq emas: mijozga xabar qoralamalari, kontent, reklama rejalari yo'q; chiqarilgan xodimning «Bajarilmadi» topshirig'i abadiy turadi | `attention.ts:60`; `plan.ts:79`; `db.ts:636` | O'RTA |
| G9 | Jonli sinov: Qabulxona «2 javob berildi», Tahlilchi o'sha payt «Murojaat 0» (7 kun). Sababi aniqlanmagan — ehtimol «7 kun» bugunni kiritmaydi; tuzatishdan oldin aniqlash kerak | surat `56-tahlilchi.png`, `55-qabulxona-ikkinchi-bemor.png` | O'RTA |
| G10 | Vaqt: reklama ogohlantirishi 05:00 da takrorlanadi (UTC kun); haftalik yakun faqat dushanba 08–12 (kompyuter o'chiq bo'lsa yo'qoladi); 09:00 topshirig'i 09:31 da yoqilsa o'tkaziladi; «7 kun» ikki xil | `ads/campaigns.ts:349`; `scheduler.ts:107`; `orders/logic.ts`; `lib/dashboard.ts:26` / `crm/report.ts:28` | KICHIK |

### H. Sotuvchi ishi (Hub, litsenziya, yangilanish, zaxira)

| # | muammo | dalil | jiddiylik |
| --- | --- | --- | --- |
| H1 ✔ | **Yomon reliz bir kechada hamma klinikaga boradi;** orqaga qaytish faqat «server yonmadi»ni ushlaydi — `/api/health` doim `ok: true`, bot/AI/telefon tekshirilmaydi. Python, `runtime\`, WSL/Asterisk yangilanmaydi | `scripts/update.mjs:39,121`; `server/http.ts:268` | KATTA · 🟡 qisman (keyingi commit): yangilashdan oldin Telegram bot ulangan bo'lsa — yangi nashrda ham ulanmasa eskisiga qaytariladi (`/api/health` → `botOnline`). AI/telefon tekshiruvi, Python/`runtime\`/Asterisk yangilanishi — hali yo'q |
| H2 ✔ | **Kechasi o'chiriladigan kompyuter hech qachon yangilanmaydi** — faqat soat 03:00 da tekshiradi, o'tkazilgan kun qayta urinilmaydi | `scripts/supervise.mjs:169` | KATTA · ✅ (keyingi commit) oxirgi tekshiruvdan 24,5 soat o'tgan bo'lsa — kompyuter yonganidan 5 daqiqa keyin |
| H3 | Hub — bitta bepul server, manzil IP ichida (`92-5-56-138.sslip.io`), har klinikaga yozilgan va masofadan almashtirib bo'lmaydi; IP o'zgarsa hamma klinikada Instagram, masofa, yordam, tashqi zaxira to'xtaydi; Hub o'chsa sizga xabar kelmaydi; `hub.db` nusxasi o'sha diskda | `server/env.ts:45`; `hub/server.ts:163`; `server/keys.ts:172-178`; `scripts/hub-watchdog.ts:8` | KATTA |
| H4 | Hub muammolarni yig'adi (zaxira rad etildi, disk, eski nashr), lekin ko'rsatmaydi; «aloqa yo'q» xabari kechqurun o'chiriladigan har klinikadan kuniga 2 ta — shovqin | `hub/server.ts:406,687,693`; `hub/admin.ts:211` | O'RTA |
| H5 | Ma'lumotni tiklash sizning kompyuteringizdagi bitta kalit faylga bog'liq (`~/.palantir/zaxira-kaliti.pem`); zaxirada Claude kirishi, `.env`, SIP yo'q | `server/offsiteCrypto.ts:2-3`; `scripts/restore-backup.ts:19`; `server/backup.ts:28-32` | O'RTA |
| H6 | Litsenziya muddatsiz — «oylik qo'llab-quvvatlash» kodda yo'q: to'lamagan klinikada yangilanish, Hub, yordam ishlayveradi; tasdiqlangan klinikani Hub'da to'xtatib bo'lmaydi (**egasi qarori**) | `hub/licenseKey.ts:4`; `server/license.ts:174`; `hub/server.ts:657` | O'RTA |
| H7 | Windows qayta o'rnatilsa yoki kompyuter almashsa — Hub'da «Aktivlashtirish» abadiy 409; yozuvni o'chirib/tuzatib bo'lmaydi | `hub/server.ts:619,643-644,657` | O'RTA |
| H8 | Har o'rnatish asoschini real vaqtda kutadi (tasdiq faqat asoschida, kalitsiz 0 kun); o'rnatuvchi o'zi ulangan klinikani ko'rmaydi; `ORNATISH.md` o'ziga zid | `hub/server.ts:516,605,634,673`; `docs/ORNATISH.md:9,109` | O'RTA |
| H9 | Egasi telefonini (Telegram) va parolini yo'qotsa yoki klinika sotilsa — chiqish yo'li yo'q | `server/passwordReset.ts:26-31`; `server/profile.ts:74` | O'RTA |
| H10 | Qo'lda yoqilgan Palantir Windows'dan chiqilganda o'chadi (foydalanuvchi seansida); kirmasdan yonganda telefon va Claude kirishi ishlashi sinalmagan | `install/palantir-fon.vbs:11`; `install/ornatish.ps1:44` | O'RTA |

### I. Jonli ishga tushirib ko'rilgan (yangi klinika ko'zi bilan)

| # | muammo | surat (`D:\palantir-sinov-tmp\audit-ui\shots\`) | jiddiylik |
| --- | --- | --- | --- |
| I1 | Bilimsiz holda ham «Egasiga topshirish» va «o'zi javob bersin» ochiq (narx 0, savollar 0/13, manzil va ish vaqti bo'sh) — ogohlantirishsiz | `19-tayyor.png`, `52-javob-rejimi-ozgartirish.png` | O'RTA |
| I2 | Tayyorlikning to'rt xil hisobi bir vaqtda: usta 4/8 (yonida 9 qadam), Sozlamalar 2/4, Miya 0/13, «4 bo'shliq, 13 javobsiz» | `19-tayyor.png` | O'RTA |
| I3 | Qabulxona xodimi boshqa xodimlarning Telegram ulash havolalarini ko'radi (`/api/staff` → `link`) — havolani ochgan odam bemor kartalarini olishi mumkin | `73-xodim-komp-qabulxona-sorovlar.png` | O'RTA (xavfsizlik) — ✅ (keyingi commit) havolalar faqat egasiga |
| I4 | Javob rejimini «o'zgartirish» havolasi Telegram sozlamalariga olib boradi; rejim ikki joyda, ikki xil ko'rinishda | `52-javob-rejimi-ozgartirish.png` | O'RTA |
| I5 | Xodimga egasining tugmalari ko'rinadi va jim ishlamaydi (javob rejimi — 403, Instagram ulash, ovoz kaliti, Nazorat bloki, «siz tasdiqlab yuborasiz»); «AI bilmagan savollar» bo'sh (403) | `80-xodim-javob-rejimini-bosdi.png` | O'RTA |
| I6 | Bosh ekran tasdiq kutayotgan javobni «hali javobsiz» deydi | `41-bosh-ekran-bemor-yozdi.png` | KICHIK |
| I7 | Usta: «!» birinchi soniyadan; saqlamasdan «Davom etish» jim o'tadi; «Yangi biznes», «o'quv markaz, IT, do'kon» — klinikaga begona | `05-usta-birinchi-qadam.png`, `10-klinika-saqlamasdan-davom.png` | KICHIK |
| I8 | Telefonda: varaqlar kesiladi (surish bildirilmaydi), Sozlamalar va Miya «Ko'proq» ichida; butun sahifa yonga surilmaydi ✅ | `60-tel-qabulxona-oyna.png`, `87-tel-koproq-oyna.png` | KICHIK |
| I9 | Xodim logini brauzerning `prompt()` oynasida; xodim `#/admin` ochsa «Admin paroli» shakli; telefon ulanmagan bo'lsa ham «Bugun 0 qo'ng'iroq» | `71-xodim-login-berildi.png` | KICHIK |

Jonli sinovda to'g'ri ishlagani: belgi va hisoblagichlar mos (bosh ekran, menyu, «Sizni kutyapti»); kutilmagan sahifa xatosi yo'q;
telefonda 17 sahifaning birortasi yonga surilmaydi. Tekshirilib to'g'ri chiqqanlar: boshqa bemorning qabulini ko'chirib/bekor qilib
bo'lmaydi; chat va telefon bir vaqtni ikki marta ololmaydi; CRM yozmaguncha «yozdik» ketmaydi; takror webhook ikki marta ishlanmaydi;
litsenziya oflayn tekshiriladi; yangilovchi imzo, sha256 va baza nusxasini tekshiradi.
