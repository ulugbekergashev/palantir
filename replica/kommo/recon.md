# Recon map: Kommo / amoCRM (web + iOS/Android)

Scope: kichik biznes (ayniqsa O'zbekistondagi tish klinikasi) Kommo/amoCRM'ga nima uchun pul to'laydi: yagona messenger inbox (Instagram, Telegram, WhatsApp va boshqalar), leads pipeline, Salesbot / AI agent / avto-javoblar, task va eslatmalar, telefoniya integratsiyasi va qo'ng'iroq yozuvlari, contact/company kartasi, analytics/reports/dashboard, mobil ilova, jamoa rollari va huquqlari. Integration marketplace va partner network — `skip`.
For: Palantir — kichik biznes uchun AI yordamchi, asosan O'zbekistondagi tish klinikalari uchun (Instagram/Telegram'ga javob beradigan va dental CRM'ga yozadigan AI qabulxona, qo'ng'iroq yozuvi, egasining Telegram boti, dashboard). Priority (must/should/could) = kichik klinika egasi shu xususiyat uchun qancha pul to'lashga tayyor.
Date: 2026-11-06

Usul: faqat ochiq manbalar (help center, narxlar sahifasi, App Store, public API docs, changelog), odam tezligida, jami 20 ta sahifa o'qildi. Hech qanday akkauntga kirilmadi, JS bundle yoki private API o'qilmadi, crawl qilinmadi, screenshot olinmadi (bu safar kerak emas deyilgan, shuning uchun `screens/` papkasi yo'q). Kommo'ning Terms of Use sahifasi o'qilmadi — akkaunt ishlatilmagani uchun "raqobatchi mahsulot qurish taqiqi" bandi bu ishga tegmaydi, lekin keyinroq kimdir o'z Kommo akkauntidan foydalanmoqchi bo'lsa, avval shartlarni tekshirish kerak.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | pricing (Kommo) | https://www.kommo.com/pricing/ | to'liq o'qildi (`/buy/tariff/` ga yo'naltiradi). Base $25 / Advanced $35 / Pro $45 har user/oy, kamida 6 oy oldindan; to'liq taqqoslash jadvali — eng boy manba |
| 2 | pricing (amoCRM, UZS) | https://new.amocrm.ru/buy/ | to'liq o'qildi. So'mdagi narxlar va "Микро-бизнес" paketi. Taqqoslash jadvalidagi "—" belgilari scrape'da ustundan ajralib qolgan: qaysi funksiya qaysi tarifda yopiqligini aniq bilib bo'lmadi |
| 3 | help: How Kommo works | https://support.kommo.com/docs/kommo-basics | to'liq. Core loop Kommo'ning o'z so'zlari bilan |
| 4 | help: AI agent overview | https://support.kommo.com/docs/kommo-ai-agent | to'liq. Sources / Actions (WHEN-DO-MORE) / Persona / Dashboard / Voice / limits / Test mode |
| 5 | help: AI agent bookings | https://support.kommo.com/docs/ai-agent-bookings | to'liq. Chatda qabulga yozish, ko'chirish, bekor qilish; edge case'lar |
| 6 | help: after-hours AI | https://support.kommo.com/docs/after-hours-conversations-ai | Firecrawl krediti tugadi, WebFetch bilan o'qildi (kichik model qisqa mazmuni — aniqligi pastroq) |
| 7 | help: Chat inbox | https://support.kommo.com/docs/manage-chat-inbox-in-kommo | to'liq. Javob, reaksiya, Summarize, Copilot, Accept/Decline/Link, filtr |
| 8 | help: Salesbot overview | https://support.kommo.com/docs/salesbot-overview | faqat qidiruv natijasidagi katta parcha (excerpt) o'qildi |
| 9 | help: Salesbot triggers | https://support.kommo.com/docs/configure-your-salesbot-triggers | qidiruv parchasi. Base'da botni ishga tushirib bo'lmaydi |
| 10 | help: Round Robin | https://support.kommo.com/docs/round-robin-in-salesbot-overview | qidiruv parchasi |
| 11 | help: Digital pipeline triggers | https://support.kommo.com/docs/set-up-digital-pipeline-triggers | to'liq. 12 xil trigger va ularning sozlamalari |
| 12 | help: Pipelines overview | https://support.kommo.com/docs/pipelines-overview | to'liq |
| 13 | help: Leads, contacts & companies | https://support.kommo.com/docs/lead-profiles | to'liq |
| 14 | help: Create and assign tasks | https://support.kommo.com/docs/create-assign-tasks | to'liq |
| 15 | help: Call report | https://support.kommo.com/docs/calling-activity | to'liq. Qo'ng'iroqlar Twilio, RingCentral, CloudTalk kabi integratsiyalar orqali keladi (xulosa: o'z telefoniyasi yo'q) |
| 16 | help (amoCRM): telefoniya | https://www.amocrm.ru/support/starting_work/phones | to'liq. Popup karta, Unsorted, yozuvlar, 200+ provayder |
| 17 | help (amoCRM): ilovadan qo'ng'iroq | https://www.amocrm.ru/support/mobile_apps/calls_from_the_app | qidiruv parchasi |
| 18 | help: permissions | https://support.kommo.com/docs/set-permissions | to'liq. 4 rangli huquq matritsasi |
| 19 | help: dashboard | https://support.kommo.com/docs/manage-your-dashboard | to'liq |
| 20 | help: mobile pipelines | https://support.kommo.com/docs/pipelines-mobile | to'liq |
| 21 | help: Telegram | https://support.kommo.com/docs/connect-telegram-to-kommo | to'liq |
| 22 | app store listing | https://apps.apple.com/us/app/kommo/id6443626329 | to'liq. Pitch, 4.0 (13 baho), versiyalar tarixi = mobil changelog |
| 23 | public API: leads | https://developers.kommo.com/reference/leads-list | to'liq. Lead modeli maydonlari |
| 24 | public API: note types | https://developers.kommo.com/reference/notes-types | qidiruv parchasi. call_in / call_out params |
| 25 | public API (amoCRM): calls | https://www.amocrm.ru/developers/content/crm_platform/calls-api | qidiruv parchasi. Qo'ng'iroq qo'shish parametrlari |
| 26 | changelog (amoCRM, bahor 2026) | https://new.amocrm.ru/new | Firecrawl krediti tugadi, WebFetch bilan o'qildi (qisqa mazmun) |
| 27 | amoCRM boshlang'ich qo'llanma (PDF) | https://www.amocrm.ru/static/assets/education/amocrm_2_instruction.pdf | faqat qidiruv parchasi; bosqich ustunida "11 сделок: 967 000 руб" |
| 28 | docs index | https://support.kommo.com/llms.txt | faqat maqola nomlarini topish uchun (qidiruv parchasi); funksiya dalili sifatida ishlatilmadi |
| 29 | help index (amoCRM) | https://www.amocrm.ru/support/hyperscript | qidiruv parchasi: maqola nomlari ("Настройка списка сделок", "Менеджер не видит сделку", "Множественные беседы") |

O'qilmagan / ishlamagan: Firecrawl krediti 18 ta sahifadan keyin tugadi (qolgan 2 ta sahifa WebFetch bilan o'qildi). Google Play sahifasi, YouTube walkthrough videolari, Kommo Terms of Use, developers'dagi contacts/tasks/events reference sahifalari o'qilmadi. `site:kommo.com/support` va telefoniya bo'yicha `support.kommo.com` qidiruvi bo'sh natija qaytardi.

## Core loop

Mijoz Instagram/Telegram/WhatsApp'ga yozadi yoki qo'ng'iroq qiladi → Kommo o'zi lead ochadi (pipeline'ning "Incoming leads" bosqichiga) → Salesbot yoki AI agent darhol javob beradi, savollar beradi, ma'lumot yig'adi va qabulga yozadi → kerak bo'lsa xodimga xulosa bilan o'tkazadi va task qo'yadi → xodim bitta inbox'dan (yoki telefondan) davom ettiradi va lead'ni bosqichlar bo'ylab won/lost'gacha suradi → egasi dashboard va call report'da natijani ko'radi.

### Narxlar nima deydi (nimaga pul to'lashadi)

- Kommo: Base $25, Advanced $35, Pro $45 (har user/oy, 6 oydan kam to'lab bo'lmaydi). AI agent — faqat Advanced'dan; **AI orqali qabulga yozish va ovozli xabarni tushunish — faqat Pro**. Salesbot'ni Base'da qurish mumkin, lekin ishga tushirib bo'lmaydi. Pro'ning reklamasi: "Booking workflows", "Multi-location businesses" — ya'ni klinika kabi yozilish bilan ishlaydigan biznes aynan eng qimmat tarifga itariladi.
- amoCRM (so'mda, QQS'siz): Базовый 79 000 → 59 250 so'm, Расширенный 179 000 → 134 250, Про 259 000 → 194 250 so'm (har user/oy; to'rt narx 6 oy / 9 oy / 1 yil / 2 yil davrlariga mos keladi — moslik taxmin). "Микро-бизнес": 2 user uchun 999 000 so'm/yil, lekin huquqlarni ajratish yo'q. AI tokenlar qo'shimcha: 100 000 token = 149 000 so'm/oy.
- Misol: 3 kishilik klinika amoCRM Про'da 1 yil ≈ 215 833 × 3 × 12 ≈ **7,77 mln so'm** (+ AI tokenlar + telefoniya provayderi + o'rnatgan hamkor xizmati). Kommo Pro'da: $45 × 3 × 12 = **$1 620/yil**.
- AI kreditlar o'rinlar soniga ko'paytiriladi va keyingi oyga o'tmaydi. Kredit tugasa AI agent javob berishni to'xtatadi — bu klinika uchun xavfli nuqta (kechasi bemor javobsiz qoladi).

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | App shell / chap menyu | login'dan keyin | bo'limlar orasida yurish: Leads, Communication, Lists, Calendar, Insights, AI agent, Settings | left nav, badge, global qidiruv (taxmin) | filled; yangi xabar badge |
| S02 | Pipeline board (Leads) | chap menyu → Leads → pipeline | lead'larni bosqichlar bo'yicha ko'rish va surish | kanban ustunlari, lead tile, pipeline switcher, "Incoming leads" ustuni, Setup tugmasi | empty pipeline, filled, incoming leads bor, won/lost |
| S03 | Leads ro'yxati + filtr | Leads → list view / filtr | jadval ko'rinishi, filtr, ommaviy amal | filter bar, jadval, checkbox, "Create dashboard widget" | filled, filtrlangan (medium confidence) |
| S04 | Lead card | S02/S08 dan lead'ni ochish | bitta sotuv imkoniyatining hammasi bir joyda | maydonlar paneli, activity feed, composer (Chat / Note / Task / Email), tag, mas'ul, Accept/Decline/Link | "No tasks planned, start by adding one", filled, incoming (qabul qilinmagan), permission denied ("Менеджер не видит сделку") |
| S05 | Contact card | S04 dagi contact / Lists → Contacts | odam: telefon, email, barcha lead'lari va tarixi | maydonlar, bog'langan lead'lar, feed, composer | filled, dublikat |
| S06 | Company card | Lists → Companies | biznes mijoz (B2B) | maydonlar, contact'lar, lead'lar | filled |
| S07 | Lists: Contacts / Companies | chap menyu → Lists | baza, import/export, business processes | filter, jadval, import/export, "Business processes" | empty, filled |
| S08 | Chat inbox | Communication → Chat inbox | barcha kanallar suhbatlari | suhbatlar ro'yxati (raqam, kanal ikonkasi), qidiruv, "Open conversations" filtri, suhbat lentasi, composer (ovoz, emoji, GIF, fayl, shortcuts, AI menu), Summarize, reaksiya | unread badge, filled, incoming lead, muted |
| S09 | Team chat | Communication → Team chat | xodimlar ichki yozishmasi, mention | xabar ro'yxati | filled |
| S10 | Copilot panel | S08/S04 → Copilot ikonkasi | lead summary, AI harakatlari (allow/deny) | yon panel, chat | filled; harakat tasdig'ini kutish (mobil 1.6.31) |
| S11 | Digital pipeline (Automate) | Leads → Automate | har bosqich ostiga trigger qo'yish | bosqich ustunlari, trigger kartalari, "+ Add trigger" | empty bosqich, triggerlar bor |
| S12 | Trigger modal | S11 → + → trigger turi | trigger sozlash | condition builder, execute rules, activity time, "apply to all leads in stage", Save | yangi, tahrir |
| S13 | Templates & Bots | Communication → Templates & Bots | chat shablonlari va Salesbot ro'yxati | ro'yxat, "Create a new bot", Salesbot templates | empty, filled |
| S14 | Salesbot builder | S13 yoki S12 → bot | vizual bot qurish | canvas, step tugunlari (Message, Condition, Validation, Go to step, Start bot, Code, Widget, Round Robin), minimap, "Back to..." | yangi, katta oqim (minimap bilan) |
| S15 | AI agents ro'yxati | chap menyu → AI agent | agentlar va qaysi pipeline/bosqichga biriktirilgani | agent kartalari, faol/nofaol, auto setup | bitta agent, ko'p agent |
| S16 | AI agent editor | S15 → agent | agentni sozlash | tabs: Sources, Actions (WHEN/DO/MORE), Persona, Integrations, Dashboard, Voice messages, Conversation limits | sozlanmagan, faol, kredit tugagan |
| S17 | AI agent Test mode | S16 → Test | jonli chatsiz sinash | test chat, ice breakers, activity details (intent, actions, sources used, knowledge gaps) | javob, knowledge gap |
| S18 | Calendar | chap menyu → Calendar | task va qabullar | kun/hafta ko'rinishi (taxmin), "New event", "… → Manage event types" | empty, filled, overdue |
| S19 | New task / event formasi | S18 → New event yoki S04 → Task | task qo'yish | lead/contact picker, deadline preset, mas'ul, task turi, izoh, Set | yangi, muddati o'tgan |
| S20 | Booking types & availability | Calendar → booking sozlamalari | xizmat (masalan "tish tozalash"), davomiylik, shifokorlar, ish kunlari/soatlari | forma, user multi-select, jadval | xizmat yo'q, filled |
| S21 | Public booking page | booking link (Pro) | mijoz o'zi vaqt tanlaydi | slot ro'yxati, forma | (medium confidence — sahifa o'qilmadi) |
| S22 | Dashboard | Insights → Dashboard | egasi uchun jonli raqamlar | widget tile'lar, Today/Yesterday/Week/Month/Time bar, user filter, Setup (nom, shrift, fon), "+" widget | default, yangi widget (taqqoslash ertaga), filtrlangan |
| S23 | Call report | Insights → Call report | qo'ng'iroq statistikasi va yozuvlar | per-user jadval, grafik, group dropdown, Quantity/Duration, Call log (play, download), All/In/Out | kamida 1 qo'ng'iroq bo'lmasa hisobot yo'q, filled |
| S24 | Boshqa hisobotlar | Insights → … | win-loss, team performance, goals, ROI, Salesbot analytics | jadval va grafiklar | (faqat nomlar va narx jadvalidan — medium) |
| S25 | Kiruvchi qo'ng'iroq popup | telefoniya widget'i, qo'ng'iroq kelganda | kim qo'ng'iroq qilayotganini darhol ko'rsatish | mijoz kartasi popup | tanilgan mijoz, noma'lum raqam |
| S26 | User management + permissions | Settings → User management | xodim qo'shish, rol, huquq | users ro'yxati, Administrator tab, Customize permissions matritsasi, advanced (stage, field, inbox, media), Save as a role | admin, own permission, guruh |
| S27 | Lead sources / kanal ulash | Leads → pipeline → Setup → + Add Source | kanalni pipeline'ga ulash | manbalar ro'yxati, kanal katalogi, Install, API key maydoni | ulanmagan, ulangan, allaqachon bor |
| S28 | AI settings va kreditlar | Settings → AI settings | Copilot, rewriter, reply suggestions'ni yoqish; kredit qoldig'i, sotib olish | toggle'lar, kredit hisoblagich | o'chiq, yoqilgan, kredit tugagan |
| S29 | Mobil: Home / Inbox / Leads | iOS/Android ilova, pastki nav | telefonda ishlash | bottom nav, Home (workspace overview), inbox presetlari, pipeline switcher (≡) | filled, unread, push |
| S30 | Mobil: lead card | S29 → lead | chat, izoh, qo'ng'iroq, qabul yaratish/ko'chirish | Edit/Save, Client chat / All users, note ikonkasi, AI menu (pause/resume/stop) | filled, AI pauzada |

## Flows

```
F01 Yangi bemor Instagram/Telegram'dan yozadi, xodim inbox'dan javob beradi
    (mijoz yozadi) -> lead "Incoming leads"ga tushadi -> S01 badge -> S08 suhbat -> Accept -> javob -> Send
    happy path clicks: 4 + matn yozish (hujjatdan)
    edge: spam -> Decline; eski bemor -> Link (mavjud contact'ga); bitta odam ikki kanaldan -> dublikat, merge;
          Telegram shaxsiy akkaunt ulab bo'lmaydi (faqat bot); bitta pipeline'ga bitta Telegram;
          bitta kanal turidan faqat bitta akkaunt ulanadi (inbox maqolasi)

F02 AI agent bemorni chatda qabulga yozadi
    (mijoz: "yozilmoqchiman") -> AI agent booking action (WHEN) -> xizmat -> shifokor -> sana/vaqt -> qayta tasdiq
    -> S18 Calendar'da qabul + suhbat xulosasi
    happy path clicks: xodim 0 klik; mijoz ~4-6 xabar
    edge: tanlangan vaqt band bo'lib qoldi -> boshqa vaqt taklifi; xizmat o'chirilgan -> "booking unavailable";
          shifokor tanlanmasa -> bo'sh shifokorlar ro'yxati, bittasi bo'lsa avtomatik; bir xil ismli shifokorlar;
          7 kundan uzoq -> mijoz sana beradi; bir vaqtda faqat bitta booking jarayoni;
          4 ta mavzudan tashqari xabar -> eslatma, 5-chisi -> booking tugaydi; 7 kun jim -> xotira o'chadi;
          AI kredit tugadi -> agent umuman javob bermaydi; ovozli xabar -> faqat Pro'da tushunadi

F03 Egasi AI agentni sozlaydi va ishga tushiradi
    S15 -> yangi agent (auto yoki manual) -> S16 Sources (narxlar, xizmatlar, qoidalar) -> Persona (til, ohang)
    -> Actions: + Add action -> WHEN -> DO "Create booking in Calendar" -> xizmatlar -> Save action
    -> S17 Test mode -> agentni pipeline bosqichiga biriktirish -> faollashtirish
    happy path clicks: ~15-18 (taxmin; har qadam alohida maqolada)
    edge: oldin S20 da xizmat turi yo'q bo'lsa booking action qurib bo'lmaydi; bosqichda allaqachon faol agent bor
          (bitta bosqich = bitta agent); tarif limiti (Advanced 3, Pro 50 faol agent); knowledge gap;
          trial'da 10 ta manba limiti

F04 Ish vaqtidan keyin kelgan xabar ertalab xodimga yetib boradi
    (mijoz kechasi yozadi) -> AI agent after-hours qoidasi: ism + telefon so'raydi, "after-hours" tag,
    Follow-up task -> ertalab S18/S04 da task -> S08 javob -> task'ni bajarish
    happy path clicks: ~4 (taxmin)
    edge: dam olish kunlari alohida qoida ("weekend", "monday-follow-up" tag); mijoz kontakt bermasa;
          ish vaqti qoidalari bir-birini qoplasa (taxmin)

F05 AI agent suhbatni odamga o'tkazadi (handover)
    (mijoz: "odam bilan gaplashmoqchiman") -> agent mijoz roziligini so'raydi -> suhbat xulosasi bilan o'tkazadi
    -> Follow-up task -> xodim S08 / S30 da ochadi -> javob
    happy path clicks: xodim 2-3 (badge -> suhbat -> send)
    edge: xabar/kredit limiti oshdi -> avtomatik o'tkazish + xodimga notification; xodim AI'ni pauza qiladi va
          keyin davom ettiradi (mobil AI menu); xodim javob bermasa — hujjatda ko'rsatilmagan

F06 Salesbot qurish va bosqichga ulash (masalan "salomlashib telefon so'rash")
    S11 Leads -> Automate -> bosqich ostida "+ Add trigger" -> Salesbot -> S12 condition, execute rules,
    activity time -> bot tanlash/yaratish -> S14 Message + Quick reply -> Validation (telefon) -> Save
    happy path clicks: ~12-15 (taxmin)
    edge: Base tarifda botni ishga tushirib bo'lmaydi; 3 tadan ko'p tugma ba'zi kanallarda bo'linadi;
          validatsiya o'tmasa "Go to step" bilan qayta so'rash; "Leave messages unanswered" toggle;
          Round Robin 30 kun ishlatilmasa navbat qaytadan boshlanadi

F07 Lead'ni bosqichlar bo'ylab surish va yopish
    S02 lead tile'ni sudrash -> keyingi bosqich ... -> won / lost (yo'qotish sababi)
    happy path clicks: har bosqichga 1 ta sudrash; yopishda +1-2 (sabab tanlash — taxmin)
    edge: bosqichda majburiy maydon to'ldirilmagan; lead'ni tahrirlash huquqi yo'q; bosqichga o'tganda
          trigger'lar (task, xabar) ishga tushadi; mobil: bosib turish -> bosqichni tanlash

F08 Lead kartasidan qo'lda task qo'yish ("ertaga qo'ng'iroq qilish")
    S04 -> composer "Chat" -> "Task" -> muddat (preset) -> mas'ul -> task turi -> izoh -> Set
    happy path clicks: 5 (hujjatdan; mas'ul/tur default bo'lsa)
    edge: task yo'q -> "No tasks planned, start by adding one"; muddati o'tgan task ajratib ko'rsatiladi;
          yangi task turini faqat Admin yaratadi

F09 Kiruvchi qo'ng'iroq: popup -> yozuv kartada -> egasi tinglaydi
    (telefon jiringlaydi) -> S25 popup mijoz kartasi -> suhbat -> S04 feed'da call_in (davomiylik, yozuv havolasi)
    -> egasi S22/S23 Insights -> Call report -> Play
    happy path clicks: xodim 0 (popup avtomatik); egasi 3
    edge: noma'lum raqam -> contact avtomatik ochiladi; o'tkazib yuborilgan qo'ng'iroq -> Unsorted'ga zayavka
          (raqam, vaqt, davomiylik); yozuv provayder tomonida saqlanadi (havola ishlamay qolishi mumkin — taxmin);
          davrda qo'ng'iroq yo'q -> hisobot chiqmaydi; telefoniya provayderi ulanmagan

F10 Egasi kun yakunini ko'radi
    S01 Insights -> S22 Dashboard -> Today / Week -> user filtri
    happy path clicks: 3-5
    edge: yangi widget'da taqqoslash (yashil/qizil) ertasi kuni chiqadi; dinamika 65 kun saqlanadi;
          binafsha raqamli standart widget'lar sana filtriga bo'ysunmaydi

F11 Xodim qo'shish va huquq berish (masalan "administrator faqat o'z bemorlarini ko'radi")
    S26 Settings -> User management -> xodim qo'shish -> profil -> Customize permissions -> ranglar
    -> Save as a role -> Save
    happy path clicks: ~8-10 (taxmin)
    edge: o'zgarish uchun xodim qayta login qilishi kerak; bepul user faqat ulashilgan kartani ko'radi;
          Микро-бизнес paketida huquq ajratish yo'q; mobil ilovada user/admin qo'shishda email kodi so'raladi

F12 Telegram botni kanal sifatida ulash
    (BotFather'da bot ochish, API key olish) -> S27 Leads -> pipeline -> Setup -> + Add Source -> Telegram
    -> + Install -> API key -> Save
    happy path clicks: 6 + Kommo tashqarisidagi BotFather qadamlari
    edge: shaxsiy akkaunt emas, faqat bot; bitta pipeline'ga bitta Telegram; API key oshkor bo'lsa xavf

F13 Telefonda lead bilan ishlash
    S29 Leads -> ≡ pipeline -> lead'ni bosib turish -> bosqich; yoki tap -> S30 -> chat / izoh / qo'ng'iroq
    happy path clicks: 4-5
    edge: ba'zi desktop funksiyalari (bulk, murakkab automations) mobilda yo'q; push qurilma sozlamasiga bog'liq;
          eski kanal orqali xabar ketib qolish xatosi (1.6.27 da tuzatilgan)

F14 Bemor chatda o'z qabulini ko'chiradi yoki bekor qiladi
    (mijoz: "qabulimni ko'chiring") -> AI agent 7 kun ichidagi qabullarni topadi -> bittasini tanlaydi
    -> yangi sana/vaqt -> tasdiq -> Calendar yangilanadi
    happy path clicks: xodim 0; mijoz ~3-4 xabar
    edge: 10 tadan ko'p qabul -> sanani toraytirishni so'raydi; shifokorni almashtirib bo'lmaydi
          (bekor qilib qaytadan yozish kerak); bekor qilishdan oldin sana/vaqtni takrorlab tasdiq so'raydi

F15 Qabul tasdig'i va eslatmasi avtomatik ketadi
    S18 da qabul yaratilgan -> Salesbot / trigger ("за X часов", "точное время") -> mijozga xabar
    happy path clicks: har qabulga 0; bir martalik sozlash ~10 (taxmin)
    edge: WhatsApp'da tasdiqlangan template kerak; mijoz javob bermasa; qabul ko'chirilganda eslatma vaqti
          (hujjatda ko'rilmadi — taxmin)
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Left nav menu | to'liq, yig'ilgan (taxmin) | default, active, badge (qizil) | hamma ekran |
| Kanban column (stage) | oddiy, Incoming leads, won, lost | empty, filled; sarlavhada soni + summasi | S02, S11 |
| Lead tile | kanal ikonkasi bilan (Telegram, Instagram...) | default, dragging, task bor/overdue (taxmin) | S02, S29 |
| Activity feed | xabar (in/out), izoh, task, qo'ng'iroq (player), tizim hodisasi, AI summary | loading, filled | S04, S05, S06, S08, S30 |
| Composer | Chat, Note, Task, Email rejimlari | bo'sh, yozilmoqda, fayl biriktirilgan, ovoz yozilmoqda, AI menu ochiq | S04, S08, S30 |
| Conversation list item | kanal ikonkasi, raqam, oxirgi xabar | unread, read, muted | S08, S29 |
| Filter / search bar | preset filtr, o'z filtri | bo'sh, qo'llangan, reset (X) | S03, S07, S08 |
| Incoming lead action bar | Accept, Decline, Link | default, bajarildi | S04, S08 |
| Task form | kalendardan, kartadan, triggerdan | deadline preset (bir soatda / bugun / ertaga / sana / sana+vaqt) | S12, S18, S19 |
| User picker | bitta, ko'p (shifokorlar) | default, qidiruv | S12, S19, S20, S26 |
| Tag chip | rangli | add, remove | S02, S04, S12 |
| Custom field input | matn, raqam, ro'yxat, sana, ... (taxmin) | bo'sh, to'ldirilgan, majburiy, ruxsat yo'q | S04, S05, S06 |
| Condition builder | lead maydoni, xabar matni, tag, mas'ul | bo'sh, bir nechta shart | S12, S14, S16 |
| Trigger card | Salesbot, Add task, Create lead, Send email, Send webhook, Change stage, Tags, Complete tasks, Generate form, Change user, Change field, Delete files | sozlanmagan, faol | S11 |
| Bot step node | Message (quick reply, URL button, synonyms), Condition, Validation, Go to step, Start bot, Code, Widget, Round Robin | yangi, ulangan, uzoq bog'lanish tugmasi | S14 |
| Canvas minimap | — | "Back to..." tugmasi bilan | S14 |
| AI action rule card | WHEN / DO / MORE | yangi, saqlangan | S16 |
| Persona form | rol, ohang, uzunlik, til, kechikish, guidelines | default, o'zgartirilgan | S16 |
| Source row | fayl / matn / integratsiya (taxmin) | on, off, unlinked | S16 |
| Test chat panel | ice breakers, activity details | javob, knowledge gap | S17 |
| Credit meter | qoldiq, yangilanish sanasi | yetarli, kam, tugagan | S16, S28 |
| Dashboard widget tile | raqam, grafik, ro'yxat, maxsus (URL) | dinamik taqqoslash yashil/qizil, gear menu | S22 |
| Date range bar | Today, Yesterday, Week, Month, Time (custom) | tanlangan | S22, S23 |
| Call log row + audio player | kiruvchi, chiquvchi | play, download, yozuv yo'q | S04, S23 |
| Permission matrix cell | qizil (yo'q), to'q sariq (o'ziniki), ko'k (guruh), yashil (hammasi) | per entity × action (view, create, edit, delete, export) | S26 |
| Incoming call popup | tanilgan, noma'lum | jiringlamoqda, tugadi | S25 |
| Modal / dialog | forma, tasdiq | open, saving | S12, S19, S20, S26, S27 |
| Empty state | "No tasks planned, start by adding one" | — | S04, S18 |
| Toast / push notification | xabar, task, AI hodisasi | ketma-ket ko'rsatish (mobil) | hamma, S29 |
| Mobile bottom nav + long-press stage picker | — | — | S29, S30 |

## Inferred data model

```
Account      id, name, subdomain, plan (base|advanced|pro|enterprise), seats, period_months (6|9|12|24),
             currency, ai_credits_monthly, ai_credits_left, renews_at
             evidence: pricing (1, 2) — seat × credits, 6 oydan kam emas
             confidence: medium

User         id, account_id, name, email, is_admin, role_id?, group_id, permissions (json), is_free
             evidence: S26, set-permissions, pricing FAQ (free users), leads API group_id
             confidence: high

UserGroup    id, name                                       evidence: set-permissions, leads API   confidence: high
Role         id, name, permissions (json: entity × action -> none|own|group|all, + stage/field/inbox/media)
             evidence: "Save as a role", 4 rang                                                  confidence: high

Pipeline     id, name, sort, sources[]                      evidence: leads API pipeline_id, 50/100 limit
             confidence: high
Stage        id, pipeline_id, name, color, sort, kind (incoming|regular|won|lost)
             evidence: pipelines-overview, Incoming leads, leads API status_id
             confidence: high (kind — medium)

Lead         id, name, price, status_id, pipeline_id, responsible_user_id, group_id, loss_reason_id,
             source_id, created_by, updated_by, created_at, updated_at, closed_at, closest_task_at,
             custom_fields_values (json), score, labor_cost, tags[], contacts[] (is_main), company (max 1),
             catalog_elements[]
             evidence: developers leads-list (to'liq ro'yxat)
             confidence: high

Contact      id, name, phones[], emails[], responsible_user_id, company_id, custom_fields_values, tags[]
             evidence: lead-profiles, S05; API sahifasi o'qilmadi
             confidence: medium
Company      id, name, custom_fields_values, contacts[], leads[]    evidence: lead-profiles   confidence: medium
Tag          id, name, color                                evidence: leads API _embedded[tags]   confidence: high
LossReason   id, name                                       evidence: leads API                   confidence: high
CustomField  id, entity (lead|contact|company), name, type, required_on_stage_ids[], visibility
             evidence: pricing (required fields, super fields), lead-profiles (faqat Admin)
             confidence: medium (required_on_stage_ids — guess)

Source       id, pipeline_id, channel (telegram|instagram|whatsapp|facebook|tiktok|email|form|phone|...),
             external_account_id, name
             evidence: leads API source_id/source, Telegram "Lead Sources" (bitta pipeline'ga bitta)
             confidence: medium
Conversation id, number, lead_id, contact_id, source_id, status (open|closed), is_read, ai_agent_id?, ai_paused?
             evidence: inbox (raqam, "Open conversations"), amoCRM trigger "после закрытия беседы",
                       mobil AI menu (pause/resume/stop)
             confidence: medium (ai_* — guess)
Message      id, conversation_id, direction (in|out), author_kind (client|user|salesbot|ai_agent),
             type (text|voice|image|file|sticker|template), text, attachments[], delivery (sent|delivered|read),
             reactions[], created_at
             evidence: inbox (ovoz, GIF, fayl, reaksiya), pricing (read status), Telegram (stickerlar)
             confidence: medium

Note         id, entity_type, entity_id, note_type (common|call_in|call_out|sms_in|sms_out|...), params (json),
             created_by, created_at
             evidence: developers notes-types
             confidence: high
Call (= Note params)  uniq, duration, source, link (yozuv URL), phone, call_result, responsible_user_id, created_at
             evidence: notes-types, amoCRM calls-api; yozuv provayder tomonida saqlanadi (phones)
             confidence: high

Task         id, entity_type, entity_id, responsible_user_id, task_type_id, text, complete_till,
             is_completed, result_text, created_by, created_at
             evidence: create-assign-tasks, amoCRM hodisa "результат по задаче", leads API closest_task_at
             confidence: medium (maydon nomlari taxmin)
TaskType     id, name (Follow-up, Meeting + custom)          evidence: create-assign-tasks       confidence: high

BookingType  id, name, duration_min, responsible_user_ids[], availability (kunlar, soatlar)
             evidence: ai-agent-bookings "Before you start"                                     confidence: high
Booking      id, booking_type_id, specialist_user_id, lead_id, contact_id, start_at, end_at,
             status (booked|rescheduled|cancelled), summary, created_via (ai_agent|user|booking_page)
             evidence: ai-agent-bookings (xulosa qo'shadi, ko'chirish, bekor qilish)
             confidence: medium (status/created_via — guess)

Salesbot     id, name, graph (json: steps + edges)           evidence: salesbot-overview          confidence: medium
StageTrigger id, stage_id, kind (salesbot|add_task|create_lead|send_email|send_webhook|change_stage|tags|
             complete_tasks|generate_form|change_user|change_field|delete_files), conditions (json),
             execute_rule (on_create|on_move|on_move_or_create|on_user_change|scheduled|on_message|...),
             activity_time, apply_to_existing, config (json)
             evidence: set-up-digital-pipeline-triggers, amoCRM "События триггеров"
             confidence: high

AIAgent      id, name, persona {role, tone, reply_length, language, reply_delay, guidelines},
             actions [{when, do[], more}], source_ids[], stage_ids[], voice_enabled,
             limits {message_limit, credits_limit, message_to_client, transfer_notifications}, is_active
             evidence: kommo-ai-agent, ai-agent-bookings, after-hours
             confidence: high
KnowledgeSource id, kind (file|text|integration — guess), title, content, is_enabled, agent_ids[]
             evidence: Sources bo'limi (update, edit, turn off, unlink)                         confidence: medium
AICreditUsage id, account_id, agent_id?, conversation_id?, credits, created_at
             evidence: AI agent Dashboard "credit usage per message"                            confidence: medium

Template     id, kind (chat|email|whatsapp), name, body (placeholder'lar bilan), channel
             evidence: pricing, dynamic-fields maqola nomi                                      confidence: medium
DashboardWidget id, owner_user_id, kind, name, view, filter (json), shared_for_all
             evidence: manage-your-dashboard                                                    confidence: medium
Event (audit) id, type (lead_added, status_changed, responsible_changed, price_changed, call_in, ...),
             entity_type, entity_id, before, after, created_by, created_at
             evidence: amoCRM narx sahifasidagi "Типы событий" ro'yxati, Kommo workspace history
             confidence: high
```

Relationships: Account 1-n User; UserGroup 1-n User; Role 1-n User; Pipeline 1-n Stage; Pipeline 1-n Source; Stage 1-n Lead; Lead n-n Contact (bittasi is_main); Lead n-1 Company; Contact n-1 Company; Lead 1-n Conversation; Conversation 1-n Message; Lead/Contact/Company 1-n Note, 1-n Task; Lead n-n Tag; Stage 1-n StageTrigger; StageTrigger n-1 Salesbot; AIAgent n-n Stage (bitta bosqichda bitta faol agent); AIAgent n-n KnowledgeSource; BookingType n-n User (shifokorlar); Booking n-1 BookingType, n-1 User, n-1 Lead; Account 1-n AICreditUsage.

## Feature matrix

See `features.csv` (78 qator). Must: 36, should: 25, could: 13, skip: 4.

## Out of scope (cannot or should not be cloned)

- **Integration marketplace** (Kommo 100+, amoCRM 500+ ilova) — uchinchi tomon ilovalari tarmog'i, mahsulotning o'zi emas (`skip`).
- **Partner network** (5000+ ekspert, amoCRM o'rnatuvchi hamkorlari) — odamlar tarmog'i va shartnomalar (`skip`). Palantir'da o'rnatuvchi rolini o'zi bajaradi.
- **200+ telefoniya provayderining tayyor widget'lari** — provayderlar bilan hamkorlik (`skip`); klonda o'z liniyasi bitta integratsiya orqali ulanadi.
- **AI agent uchun e-commerce integratsiyalari** (Shopify, WooCommerce, Nuvemshop, Lazada) — do'konlar uchun, klinikaga tegishli emas (`skip`).
- Meta / WhatsApp Business Platform bilan Kommo'ning rasmiy hamkor maqomi, TikTok/Meta tech-partner holati — klon buni nusxalay olmaydi; har kanal uchun o'z Meta ilovasi, app review va ruxsatlar kerak.
- Kommo/amoCRM brendi, "Амма" nomi, matnlar, ikonkalar, maqola matnlari — olinmaydi; faqat funksiya va oqim.
- Kommo'ning mijozlar bazasi va ularning ma'lumotlari.
- Apple Watch / Vision Pro ilovalari, Enterprise SSO, SLA, scheduled backups — kichik klinika uchun kerak emas (matritsaga kiritilmadi).
- amoCRM'ning "Покупатели" (retail CRM, sodiqlik kartasi, OFD/kassa integratsiyasi) — klinika slice'iga kirmaydi.

## Size

Screens 30, flows 15, entities 28 (Call alohida jadval emas — Note ichidagi params). Hard parts:

1. **Kanallarni ulash va realtime inbox**: Instagram (Meta app review, DM + izohlar, 24 soatlik oyna), Telegram bot, WhatsApp Cloud API; webhook qabul qilish, media, dublikatni birlashtirish, web va mobil o'rtasida darhol sinxronlash.
2. **AI agent + booking holat mashinasi**: WHEN/DO/MORE qoidalari, bilim manbalari, shifokor jadvali bo'yicha bo'sh vaqt, "vaqt band bo'lib qoldi" poygasi, ko'chirish/bekor qilish, handover xulosa bilan, ovozli xabarni tushunish, kredit/limit hisobi, test rejimi.
3. **Trigger va Salesbot dvigateli**: bosqich hodisalari + vaqtli trigger'lar (X soat oldin, aniq vaqt), takroriy ishga tushmaslik (idempotency), vizual bot konstruktori.
4. **Telefoniya**: popup karta, noma'lum raqamdan contact, o'tkazib yuborilgan qo'ng'iroq, yozuvni saqlash va tinglash.
5. **Huquqlar matritsasi** (own/group/all × har entity × har amal) va mobil ilova + push.

Size: **L** (bir chorak) — butun slice uchun. Klinika uchun yadro (F01, F02, F04, F05, F07, F09, F10, F14, F15 + must qatorlari) alohida olinsa — **M** (bir necha hafta). Palantir'da nimasi allaqachon borligi bu recon'da tekshirilmadi — buni `replica-diff` baholaydi. Keyingi qadam: `/replica-architect`.
