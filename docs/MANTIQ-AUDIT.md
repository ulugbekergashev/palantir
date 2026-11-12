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
| A1 ✔ | AI bemorni qabulga yozadi, ertasi kuni u «💤 Unutilgan» ro'yxatiga tushadi va unga «qayta yozish» xabari tayyorlanadi | `server/inbox/core.ts:304-306` faqat `setPatient`, bosqich o'zgarmaydi; `server/db.ts:449-451` `active` = new/contacted; `server/plan.ts:65-66` faqat `nextAt` ga qaraydi; `src/data/industries.ts:67` klinikada `followDays: 1` | — |
| A2 ✔ | Telegram ulanmagan va xodim yo'q bo'lsa, uzatilgan bemor xabari haqida hech kimga xabar bormaydi, «Sizni kutyapti»ga ham tushmaydi (xabarning o'zi Yozishmalar'da qoladi) | `server/requests/index.ts:132` `if (!outlet \|\| !to.length) return []`; `server/inbox/core.ts:503-510` navbatga faqat xato bo'lganda | — |
| A3 ✔ | Qabulxona jamoadan olib tashlansa ham telefondagi AI javob beradi va DentaCRM'ga qabul yozadi (ekranda «javob bermaydi» deyiladi) | `server/voice/*` da `crewWorks` yo'q (`voice/routes.ts:97-101`, qabul `:167`); `src/pages/CrewPage.tsx:52` | — |
| A4 ✔ | Miya → Brend'da brend-buk to'ldirilsa, Kontent-meyker o'zi jamoaga qo'shiladi; brend-buk asbobi hamon Kontent-meykerda — u olinmagan bo'lsa Yordamchi brend-buk yozmaydi | `server/crew.ts:39-40` `has('content_brand')`; `server/content/tools.ts:70`; `server/agent.ts:111` | — |
| A5 | Qabulxona kartasi telefon liniyasini bilmaydi — liniya ishlasa ham «Kanal ulanmagan»; aksincha bot tokeni bo'lsa «Navbatchilikda», hatto «tasdiqlayman» rejimida | `src/components/team.tsx:118,152`; `src/types.ts:329-357` (LiveStatus'da telefon yo'q) | — |
| A6 | Shikoyat qabulxonadagi hamma xodimga, shikoyat qilingan xodimning o'ziga ham boradi; «So'rovlar nusxasi menga ham» o'chirilsa egasi shikoyatni Telegram'da ko'rmaydi | `server/requests/index.ts:49-52`; `src/pages/RequestsPage.tsx:182` | — |
| A7 | Qabulxona xodimi (reception login) jamoa jurnalini (kamera ogohlantirishlari, Direktor topshiriqlari) va egasining vazifalarini ko'radi | `server/access.ts:19`, `server/teamDay.ts:131` (`/api/team/day`); `server/http.ts:579-582` (`/api/tasks`) | — |
| A8 | Claude obunasidan chiqib ketish yoki limit tugashi kanallar nazoratida yo'q — AI jim qoladi, egasi ham, Hub ham bilmaydi | `server/monitor.ts:33-50`; faqat kartaga izoh `server/inbox/core.ts:217-218` | — |
| A9 | Direktor tasdiqlangan taklifni Kontent-meyker, Targetolog, Tahlilchi, Marketologga «topshiradi», lekin ularning fon ishlari topshiriqni o'qimaydi; natija baribir o'lchanadi | `server/director/index.ts:71,207`; o'qiydiganlar faqat `agent.ts:125,146`, `brain/index.ts:104,252`, `orders/look.ts:31` | — |
| A10 | Kuzatuvchi olinmagan bo'lsa ham Yordamchi kamera nomuvofiqliklarini aytadi; Sozlamalar → Kameralar izohsiz «AI xodimlar»ga qaytaradi | `server/crm/tools.ts:71`; `src/LiveApp.tsx:91-93`; `src/pages/settings/SettingsHub.tsx:66` | — |
| A11 | «Qabulxonaga ayting / Qabulxona qo'ng'iroq qilsin» deyiladi, lekin xabar faqat egasiga boradi | `server/orders/run.ts:107`; `server/botButtons.ts:239-246` | — |
| A12 | Javob qoralamalari hech qachon eskirmaydi — ertalab bir necha kunlik eskilari ham «N ta javob» deb sanaladi | `server/db.ts:567`; `server/plan.ts:92` | — |
| A13 | Ertalabki xabar qayta yuborilganda Direktor qismi tushib qoladi; ustadagi namuna Direktorsiz (haqiqiysidan farq qiladi) | `server/director/telegram.ts:16`; `server/setup/routes.ts:150` | — |
| A14 | Kanallar nazoratida tungi sukut yo'q (tunda o'chiriladigan kamera — har kecha ogohlantirish); Telegram'i ulanmagan biznes umuman tekshirilmaydi | `server/monitor.ts:57-84`, `:61` | — |

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
| C4 | Obunaga kirishdan oldin «Claude kaliti — majburiy, sk-ant-…» ko'rinadi (standart dvigatel — API) | `server/env.ts:106`; `src/pages/setup/secrets.ts:16`; `StepKeys.tsx:24,134` | — |
| C5 | Yakuniy tekshiruv bemorni emas, egasining yordamchisini sinaydi («Bugun nechta qabul bor?») | `src/pages/setup/StepFinish.tsx:100` | — |
| C6 | O'rnatgich matnlari eskirgan: «ULANISH KODINI qo'ying» (birinchi ekran — litsenziya), «Bloknotda oching» | `install/ornatish.ps1:190,336` | — |
| C7 | Klinika xodimiga texnik so'zlar: BOT_TOKEN, Server/Port, Zoiper, `http://192.168.1.20:3001`, Hub kodi, port ochish, «Server kompyuterida» | `TelegramPage.tsx:100,271,320`; `PhoneLine.tsx:137-141,223`; `DentaCrmSection.tsx:73`; `ClaudeObuna.tsx:77`; `SettingsHub.tsx:69` | — |
| C8 | O'rnatuvchi ustasi topshirgandan keyin ham egasiga ochiq: «Klinikada o'tgan vaqt», 9 kalit jadvali (SpeechLab ham) | `SettingsHub.tsx:68`; `SetupWizard.tsx:108-111`; `secrets.ts:16-23` | — |
| C9 | Bir narsa bir necha joyda: DentaCRM shaklasi 2 ta (biri manzilni o'zi topadi, biri yo'q), «tayyormi» ro'yxati 3 ta, klinika ma'lumoti 2 shakl, narxlar 3 joyda | `DentaCrmSection.tsx:23-30` / `StepConnections.tsx:58`; `lib/setup.ts`; `StepProfile.tsx:280` / `TelegramPage.tsx` | — |
| C10 | Instagram «Ulash»dan keyin Meta tester taklifi kerak — ustada aytilmaydi | `docs/INSTAGRAM.md:33-36`; `StepConnections.tsx:129` | — |

## D. Kichik qoldiqlar

- Bosh ekrandagi «bugungi jurnal» olinmagan xodimlar yozuvlarini ham ko'rsatadi — `server/teamDay.ts:135`.
- Marketolog va Tahlilchi topshiriqlari ular olinmagan bo'lsa ham Yordamchi ko'rsatmasiga qo'shiladi — `server/agent.ts:148`.
- Faqat Targetolog olingan bo'lsa ham telefondagi tugma «SMM» — `src/components/Rail.tsx:18`.
- Eski «To'liq hisobot» sahifasi eski manzillar bilan; «Xodim qo'shish» So'rovlarga olib boradi — `Dashboard.tsx:148,163`.
- Bot o'zini «biznesingiz uchun AI yordamchi» deb tanishtiradi, «AI administrator» emas — `server/botKit.ts:123`.
- Panel va Telegram har xil: kamera xabarida «Ko'rdim» yo'q (band 24 soat turadi), panelda «Bajarildi» natija so'ramaydi, taklif tugmalari har xil nomda — `attention.ts`, `botButtons.ts:302`, `director/logic.ts:91`.
- Xodim yozgan javob egasiga «Javobingiz» deb eslab qolishga taklif qilinadi — `server/brain/learn.ts:49`.
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
