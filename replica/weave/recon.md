# Recon map: Weave (getweave.com) — web/desktop app + mobil ilova (iOS, Android)

Scope: stomatologiya klinikasining front desk qismi — telefonlar (VoIP, qo'ng'iroq yozuvi, missed call text, call analytics, Call Pop), ikki tomonlama SMS, AI Receptionist va boshqa Weave AI funksiyalari, online scheduling, eslatma va tasdiqlar, recall/reactivation, review so'rovlari, digital forms, Text to Pay, team chat, analytics, PMS integratsiyalari (Dentrix, Eaglesoft, Open Dental).
For: Palantir — O'zbekistondagi stomatologiya klinikalari uchun AI yordamchi (Instagram/Telegram'da AI qabulxona, DentaCRM'ga yozish, MicroSIP orqali qo'ng'iroq yozuvi, egasining Telegram boti, dashboard, kameralar). Priority = kichik klinika egasi shu funksiya uchun qancha pul to'lashga tayyorligi.
Date: 2026-11-06

Usul: faqat ochiq manbalar — getweave.com marketing sahifalari, weavehelp.com yordam markazi va App Store sahifasi. Hech qanday hisobga kirilmadi, JS bundle va yopiq API o'qilmadi, crawl qilinmadi; 20 ta sahifa bittalab o'qildi. Weave hisobi ishlatilmagani uchun "raqobatchi mahsulot qurish taqiqi" kabi shartlar bu ishga taalluqli emas. Screenshot olinmadi (vazifada kerak emas edi).

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | pricing page | https://www.getweave.com/pricing/ | Pro / Elite / Ultimate, "$199/oy dan"; tarif bo'yicha funksiyalar ro'yxati; bulk SMS 1 500 / 3 000 / 15 000; Call Intelligence "NEW"; Insurance Verification, Practice Analytics — faqat dental |
| 2 | marketing: Phones | https://www.getweave.com/weave-phones/ | Call Pop maydonlari, Private Communications, Phone Analytics, Missed Call Text, Softphones, Voicemail Transcription, Fax, vizual marshrut, Yealink apparatlari |
| 3 | marketing: AI | https://www.getweave.com/ai/ | AI Receptionist (voice + text), Call Intelligence dashboard demo raqamlari, Response Assistant, Email Assistant, sentiment bilan tasdiqlash, Smart Drafts; "35 000+ lokatsiya" |
| 4 | marketing: Call Intelligence | https://www.getweave.com/call-intelligence/ | AI follow-up vazifalari, transkript qidiruvi, PMS'ga xulosa writeback, Scheduled/Unscheduled Opportunity, multi-location |
| 5 | help: AI Receptionist Overview | https://www.weavehelp.com/weavehelp/article/how-to-use-the-weave-ai-receptionist | eng boy manba: sozlash yo'llari, "Sam", Open/Closed rejimlari, AI SMS auto-message, 30 kunlik pauza, Task Center, AI analytics, kredit modeli |
| 6 | help: AI Scheduling & Services | https://www.weavehelp.com/weavehelp/article/ai-receptionist-scheduling-services-setup | direct booking faqat ayrim PMS'larda; Services, Availability, Rule Exceptions, Publish; nosozliklar jadvali |
| 7 | help: AI-captured requests | https://www.weavehelp.com/weavehelp/article/ai-receptionist-managing-ai-captured-schedule-requests | Schedule Pulse, so'rov kartasi maydonlari, Pending/Contacted/Dismissed, Urgent |
| 8 | help: Call History Dashboard | https://www.weavehelp.com/weavehelp/article/navigate-your-call-dashboard | jadval ustunlari, audio pleyer, AI outcomes, Call Insights, contact types, scheduling outcomes |
| 9 | help: Call Pop | https://www.weavehelp.com/weavehelp/article/call-pop | sozlash, Answer/Ignore/View, Multiple Contacts, multi-location (Unify) |
| 10 | help: Missed Call Texts | https://www.weavehelp.com/weavehelp/article/create-and-manage-missed-call-texts | builder qadamlari, spam himoyasi, AI SMS usuli; boshqa auto-message turlari ro'yxati (related articles) |
| 11 | help: Appointment Reminders | https://www.weavehelp.com/weavehelp/article/create-and-manage-appointment-reminders | timing, filtrlar, SMS/email/voice, 7/3/1–2 kun tavsiyasi |
| 12 | help: Recall Reminders | https://www.weavehelp.com/weavehelp/article/create-and-manage-recall-reminders | recall sozlash, AI orqali avtomatik recall scheduling |
| 13 | help: Review Requests | https://www.weavehelp.com/weavehelp/article/create-and-manage-review-requests | 30 kunlik chastota cheklovi, bekor qilinganda yubormaslik |
| 14 | help: Set Up Online Scheduling | https://www.weavehelp.com/weavehelp/article/set-up-online-scheduling | har so'rovni xodim tasdiqlaydi; providers, hours, appointment types, custom fields |
| 15 | help: PMS compatibility (Online Scheduling) | https://www.weavehelp.com/weavehelp/article/practice-management-system-compatibility-with-weave-online-scheduling | Calendar Sync ~15–20 daqiqa, writeback, mos PMS ro'yxati |
| 16 | help: Digital Forms Overview | https://www.weavehelp.com/weavehelp/article/navigate-the-digital-forms-dashboard-and-see-form-submissions | bepul vs to'liq versiya, 4 shablon, kiosk, writeback |
| 17 | help: Text to Pay | https://www.weavehelp.com/weavehelp/article/send-a-text-to-pay-request | qadamlar, bemor to'lov sahifasi, Stripe Link / Affirm / ACH, faqat AQSh |
| 18 | help: Messages Overview | https://www.weavehelp.com/weavehelp/article/messages-overview | manual vs auto-messages, 10-DLC ro'yxatdan o'tish, shablonlar |
| 19 | help: Analytics Overview | https://www.weavehelp.com/weavehelp/article/analytics-in-the-weave-app | overview vidjetlari va analytics bo'limlari |
| 20 | App Store listing + version history | https://apps.apple.com/us/app/weave-text-call-schedule/id1030476630 | mobil funksiyalar, 4.4 (1.2K baho), 2026 yil versiyalari 6.5.0–7.5.1 (changelog o'rnida), real foydalanuvchi sharhlari |

O'qilmagan yoki o'qib bo'lmagan manbalar (halol qayd):
- Google Play sahifasi — faqat qidiruv natijasidagi parchada ko'rindi, o'zi o'qilmadi.
- Ochiq API / developer hujjatlari — 20 sahifalik limit ichida qidirilmadi; data model faqat help matnlaridan chiqarildi.
- YouTube walkthrough'lar va help ichidagi Wistia videolar — ko'rilmadi (video).
- getweave.com blog/changelog — o'qilmadi; o'rniga App Store "Version History" ishlatildi.
- Barcha weavehelp.com sahifalarida "www.getweave.com is blocked" degan buzilgan ichki iframe bor; asosiy matn to'liq o'qildi, ta'siri yo'q.
- Bemor tomonidagi sahifalar (online booking sahifasi, anketa sahifasi, to'lov sahifasi) ko'rilmadi — faqat help'dagi tavsifdan.

## Core loop

Bemorning har bir qo'ng'irog'i va xabari — odam yoki AI javob bersin — PMS'dagi qabulga aylanadi, so'ng avtomatik eslatma, tasdiq va recall stulni bo'sh qoldirmaydi; egasi esa har bir qo'ng'iroqning natijasini (yozuv, xulosa, "band qilindi / qilinmadi") ko'rib turadi.

Palantir uchun o'qish: Weave'da kanal — telefon + SMS, Palantir'da — Telegram/Instagram + MicroSIP qo'ng'irog'i; PMS o'rnida DentaCRM. Weave pul oladigan asosiy joylar: AI Receptionist (alohida obuna + kredit), Call Intelligence (eng qimmat tarifda "NEW"), missed call qaytarish va eslatmalar.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Messages Inbox (Unified Inbox) | chap menyu → Messages | barcha suhbatlar va qo'ng'iroq kartalari bitta ro'yxatda | thread list, AI Receptionist filtri, location filtri, qidiruv | filled, filtered (AI); empty — ko'rilmagan |
| S02 | Suhbat oynasi (thread) | S01 → bitta suhbat | bemor bilan yozishma va AI harakatlari | message bubbles, call card accordion (Added to Schedule / Canceled / Completed Call), composer (shablon, dynamic fields, 3 tagacha rasm, video/PDF, forma, to'lov havolasi, Schedule Send), Smart Draft, raqam almashtirgich | filled, AI yuritgan suhbat, guruh suhbat (mobil 7.4.0) |
| S03 | Call History | Calls → Call History | barcha qo'ng'iroqlar jadvali | data table (Contact, Number, Type, Time, Office Number, Sentiment, User/AI, Recording, Service Issues, AI Outcomes, Scheduling Outcome, Result, Device, Category, Tasks, Tags, Phone Tree, Network), qidiruv, saqlanadigan filtrlar, ustun tanlash, eksport, audio pleyer, qator ⋯ menyusi | filled, filtered, voicemail ikonasi, "Deleted", AI outcome belgilari; empty/loading — ko'rilmagan |
| S04 | Call Insights panel | S03 → Call Insights ikonasi | bitta qo'ng'iroq tahlili | slide-out, summary, transcript, audio, tasks, sentiment, categories, Call Path, MOS/jitter, ⋯ (Create Contact / View Profile / Download / Delete Recording) | filled; tahlil hali tayyor emas holati — ko'rilmagan (guess) |
| S05 | Voicemail | Calls → Voicemail | ovozli pochta qutisi | ro'yxat, transkript, tag, forward, "Handled" | unread, handled, forwarded ("Deleted" bo'lib ko'rinadi) |
| S06 | Call Pop | kiruvchi qo'ng'iroq paytida ekranda | bemorni javob berishdan oldin tanish | toast: ism, raqam, qaysi lokatsiyaga qo'ng'iroq, View / Answer / Ignore, Multiple Contacts | bitta kontakt, bir nechta kontakt, sinxron yo'q (chiqmaydi), boshqa filial bemori |
| S07 | Contact / Patient profile | S06 → View, yoki S04 → View Profile | bemor haqida hammasi bir joyda | keyingi qabul, recall muddati, qarz, vazifalar, eslatmalar, teglar | filled; yangi kontakt yaratish |
| S08 | Schedule (kalendar) | chap menyu → Schedule; mobil → Schedule | kunlik qabullar | calendar day view, appointment card, provider filtri | integrated va non-integrated (Weave Core) — ikki xil ekran; mobil: pinch-to-zoom (7.5.0) |
| S09 | Schedule Pulse | Schedule → Schedule Pulse yoki o'ng menyu ikonasi | AI va online so'rovlarni qabulga aylantirish | tabs Requests / Request History, request card (AI sparkle, Urgent), Message / Call / Done / Dismiss, View Call Insights havolasi | Pending, Contacted, Dismissed, Urgent |
| S10 | Online booking site (bemor uchun) | klinika sayti yoki Google Business Profile'dagi havola | bemor o'zi vaqt so'raydi | appointment type, provider, slot tanlash, custom fields (guess) | ko'rilmagan — faqat sozlamalar o'qildi (guess) |
| S11 | Settings → Schedule | Settings → Schedule | online scheduling sozlash | Manage Providers, Appointment Hours, Appointment Types (+payment types), Calendar Exceptions, Custom Fields, Booking Site Setup | integrated / non-integrated; free trial taklifi |
| S12 | Manage Auto-Messages | Settings → Messaging → Manage Auto-Messages | barcha avtomatik xabarlar ro'yxati | kartalar, toggle, ⋯ (Edit / Duplicate / Delete / History), Create Auto-Message | on, off |
| S13 | Auto-Message builder | S12 → Create Auto-Message | bitta avto-xabar yaratish | wizard: Title, Location Access, type dropdown, timing (offset + unit + start time + delivery days + logic preview, View All), filtrlar, kanallar (Text / Email / Voice), scope, SMS editor (Individual / Family, dynamic fields, forma biriktirish), email drag&drop + Weave Assistant + test email, voice matni (625 belgi) + Preview, sending method (Text / AI Receptionist SMS) | draft, saved; validatsiya xatolari — ko'rilmagan |
| S14 | Call Routes canvas | Settings → Phone → Call Routes → Create / ✎ | qo'ng'iroq yo'nalishini chizish | vizual canvas, tugunlar (Phone Hours Open/Closed, Call Group, Call Queue, Phone Tree, Voicemail, AI Voice Receptionist), "+ Add step", o'ng drawer (Receptionist Greeting, Generate Greeting / Play), Save Changes | open/closed tarmoqlari; override faol banneri (mobil 7.0.0) |
| S15 | AI Receptionist settings | Settings → AI Settings → AI Receptionist | AI qoidalari | tabs Services / Availability / Rule Exceptions, Workflow Instructions → Scheduling Instruction (direct booking yoki Enable Appointment Requests), business preferences / knowledge base, Publish + Last Published | draft, published |
| S16 | Task Center | Task Center (desktop), mobil (6.6.0 / 6.9.0) | follow-up vazifalar | ro'yxat, AI Receptionist filtri, egasi, ustuvorlik, holat, suhbatga deep link | open, in progress, completed |
| S17 | Analytics Overview | chap menyu → Analytics | asosiy raqamlar | vidjetlar (Missed Call Text Conversion, Bulk Texting Conversion, Appointment Reminders, Incoming Phone Calls, No-Show Rate, Top Message Categories), "Last 30 Days", Show More, chap menyu (Practice, Call Intelligence, Auto Recall, Phone, Messaging, Appointment, Reviews), Submit Feedback | filled |
| S18 | Analytics → AI Receptionist | Analytics → AI Receptionist | AI qancha foyda keltirdi | Voice / Message tablari, answered calls, engagement rate, booked appointments, estimated production value, vaqt bo'yicha grafik, conversation breakdown jadvali | filled |
| S19 | Call Intelligence dashboard | Analytics → Call Intelligence | imkoniyatlar va xizmat sifati | KPI: Scheduled 479/564 (85%), Unscheduled 85/564 (15%), Service Quality (24 Calls to Review, 96 Spotlighted), 637 Calls Analyzed; Follow-up Tasks by Reason (Scheduling, Waitlist, Patient Care); location / time / contact type filtrlari | filled (marketing demo raqamlari) |
| S20 | Digital Forms | chap menyu → Forms | anketalar va topshirilganlar | forms list, shablonlar, Form Builder, paketlar, submissions (approve / reject / archive), kiosk mode, location filtri | bepul (4 shablon) vs to'liq; archived |
| S21 | Bemor anketa sahifasi | SMS havolasi (unique / public link) yoki kiosk | bemor anketani to'ldiradi | maydonlar, "For Office Use Only" yozuvlari (read-only) | ko'rilmagan (guess) |
| S22 | Payments → Requests | chap menyu → Payments → Requests | to'lov so'rovlari | jadval, ⋯ → Collect Payment, Text to Pay oynasi (matn, raqam tanlash, Send Now / Schedule Send) | pending, completed |
| S23 | Bemor to'lov sahifasi | Text to Pay havolasi | bemor to'laydi | klinika nomi, summa, Apple Pay / Google Pay / Stripe Link, karta formasi, ilova uchun DOB tekshiruvi | faqat help tavsifidan |
| S24 | Team Chat | desktop menyu; mobil | xodimlar o'rtasida chat | guruhlar, o'qilmagan hisoblagich, PDF/DOCX ilovalar | o'qilmagan belgisi muammosi (App Store sharhlari) |
| S25 | Settings → Subscriptions → AI Receptionist | Settings → Subscriptions | AI kredit holati | lokatsiya bo'yicha sarf, Manage Subscription, kredit sotib olish | limitga yaqin, limit tugagan (in-app ogohlantirish) |
| S26 | Personal Settings | Settings → Personal Settings | shaxsiy bildirishnomalar | Call Pop toggle, AI Receptionist alertlari (Completed / Incomplete), ovoz tanlash | on, off |
| S27 | Notification Center + toastlar | har qanday ekranda | voqealar haqida xabar | toast (AI completed / incomplete, payment completed, yangi so'rov), bildirishnomalar ro'yxati | unread, read |
| S28 | Mobil ilova (iOS / Android) | App Store / Google Play | ofisni masofadan boshqarish | bosh sahifa qidiruvi, schedule, messages, calls, voicemail (push + transkript parchasi), payments (Text to Pay, Tap to Pay), review taklifi, team chat, ish/tanaffus vaqti, call forwarding, Voicemail Override, Phone Tree Override, tasks, outbound caller ID | faqat vertikal (sharhlarda shikoyat), push |

## Flows

```
F01 Xodim qo'ng'iroqni Call Pop bilan qabul qiladi
    S06 Call Pop -> S07 bemor profili -> S08 Schedule (qabul qo'yish)
    happy path clicks: 2 (Answer, View); qabulni qo'yish PMS ichida — sanalmadi
    edge: bir raqamda bir nechta kontakt (Multiple Contacts tanlovi); noma'lum raqam (Create Contact);
          telefon va dastur sinxron emas — pop chiqmaydi (qayta pair qilish); boshqa filial bemori
          (lokatsiyani almashtirish; ikkala filialda user bo'lish sharti)

F02 O'tkazib yuborilgan qo'ng'iroqqa avtomatik SMS sozlash
    S12 -> S13 (type: Missed Call) -> S12 (toggle on)
    happy path clicks: ~12 (Settings, Messaging, Manage Auto-Messages, Create, Location Access, type dropdown,
                       Missed Call, Filters, Sending Method, Dynamic Field, Save Template, Create Auto-Message) + matn yozish
    ishlashda: 0 klik — missed yoki abandoned qo'ng'iroqdan keyin SMS o'zi ketadi, javob S01/S02'ga tushadi
    edge: bir bemorga kuniga 1 martadan ko'p emas; bemor qabulni tasdiqlayotgan bo'lsa yuborilmaydi;
          eski MTT va AI SMS bir vaqtda yoqilsa ikki marta boradi; office status filtri (faqat yopiq vaqtda)

F03 AI Receptionist qo'ng'iroqqa javob berib, PMS'ga qabul yozadi
    sozlash: S15 Services -> S15 Availability -> S15 Rule Exceptions -> Publish
             -> S14 Call Routes (Closed tarmog'iga AI Voice Receptionist + fallback) -> Save Changes
    ishlash: kiruvchi qo'ng'iroq -> "Sam" salomlashadi -> xizmatni aniqlaydi -> bo'sh slot taklif qiladi
             -> PMS'ga yozadi -> S02 call card "Added to Schedule" -> S27 toast
    happy path clicks: sozlash ~20–25 (bir martalik); bemor uchun 0 (ovozli suhbat); xodim uchun 0
    edge: PMS mos emas -> F04 (so'rov rejimi); kredit tugadi -> fallback; bemor odam so'raydi -> transfer,
          xodim olmasa "Transfer Missed"; sozlash chala -> "Error"; PMS'da bloklanmagan yopiq vaqt -> AI noto'g'ri
          vaqt taklif qiladi (Rule Exception kerak); Publish bosilmagan -> eski qoidalar; AI o'chirilgan -> 30 kun pauza

F04 AI yig'gan so'rovni xodim qabulga aylantiradi
    S27 bildirishnoma -> S09 Requests -> request card -> S04 (View Call Insights, ixtiyoriy)
    -> S02 (Message: 1–2 vaqt taklifi) -> [bemor tasdiqlaydi] -> PMS'da qabul -> S09 Done
    happy path clicks: 5 (bildirishnoma, card, Message, Send, Done) + PMS ichidagi ish
    edge: Urgent so'rov (birinchi navbatda); bemor javob bermaydi — Contacted'da qoladi, keyingi qadam
          ko'rinmadi (guess); Dismiss -> Request History

F05 Ko'p kanalli qabul eslatmasini sozlash
    S12 -> S13 (type: Appointment Reminder; timing; filtrlar; kanallar; SMS / email / voice matni) -> S12
    happy path clicks: ~20
    edge: appointment type filtri faqat oxirgi 12 oyda sinxron bo'lgan turlar; 160 belgidan uzun SMS bo'linadi;
          Family shablon; ovozli matn 625 belgigacha; App Store sharhida Open Dental'da appointment type
          sinxron bo'lmagani aytilgan

F06 Bemor SMS bilan qabulni tasdiqlaydi
    eslatma SMS -> bemor erkin matnda "ha" deydi -> sentiment "confirmed" -> qabul holati yangilanadi
    happy path clicks: bemor 1 (javob), xodim 0
    edge: noaniq javob; bekor qilish javobi (sentiment ajratadi); email/voice kanalda sentiment yo'q (faqat SMS)

F07 Recall: muddati kelgan bemorni qayta yozish
    S13 (Recall Reminder) -> SMS -> bemor javobi -> AI (S02) jonli jadvaldan slot taklif qiladi -> qabul
    happy path clicks: sozlash ~15; ishlashda xodim 0, bemor 2–3 xabar
    edge: allaqachon yozilganlar o'tkazib yuboriladi; AI shu raqamga biriktirilmagan bo'lsa suhbatni odam yuritadi

F08 Tashrifdan keyin sharh so'rovi
    S12 -> S13 (Review Request; soat/kun/hafta keyin; filtrlar; SMS yoki email) -> avtomatik
    happy path clicks: ~12; ishlashda 0
    edge: bir bemorga 30 kunda 1 martadan ko'p emas; bekor qilingan qabulga yuborilmaydi; tarifda bo'lmasa — qo'lda taklif

F09 Egasi qo'ng'iroqni tekshiradi va follow-up'ni yopadi
    S03 Call History -> filtr (xodim yoki AI) -> S04 Call Insights (summary, transcript, audio) -> S16 Task Center
    happy path clicks: 6 (Calls, Call History, filtr, Call Insights, Play, vazifa holati)
    edge: yozuv o'chirilgan; voicemail forward qilingan ("Deleted" ko'rinadi); Unscheduled -> 7 kun ichida
          yozilsa avtomatik "Recovered Opportunity"

F10 Bemor online yoziladi
    S10 booking site -> [so'rov] -> S27 / S09 -> xodim tasdiqlaydi -> PMS writeback
    happy path clicks: bemor ~4 (tur, vaqt, ma'lumot, yuborish) — guess, sahifa ko'rilmadi; xodim 2 (ochish, tasdiqlash)
    edge: integratsiyasiz klinika — ish vaqti va turlarni Weave'da qo'lda kiritadi; sinxron 15–20 daqiqa
          kechikadi (slot band bo'lib qolishi mumkin); Dolphin shablonida shifokor yo'q bo'lsa slot chiqmaydi

F11 SMS orqali to'lov olish
    S22 Requests -> Collect Payment -> Text to Pay -> Send Now -> S23 bemor to'laydi -> S27 toast + email
    happy path clicks: xodim 6 (Payments, Requests, ⋯, Collect Payment, Text to Pay, Send Now); bemor 2–3 (havola, Apple Pay, tasdiq)
    edge: uzun SMS havolani buzadi; ilovani ochish uchun DOB so'raladi; faqat AQSh; avval Payments akkaunti ochilishi kerak

F12 Qabuldan oldin anketa yuborish
    S20 -> forma yoki paket -> yuborish (SMS / kiosk) -> S21 bemor to'ldiradi -> S20 submissions (approve / reject)
    happy path clicks: ~4 (guess — yuborish sahifasi o'qilmadi)
    edge: bepul versiyada faqat 4 shablon, builder va writeback yo'q; kiosk rejimi; ko'p filialda bu tier hali beta emas

F13 Egasi ofisni telefondan boshqaradi (masalan, qor bo'roni kuni)
    S28: bulk SMS -> Voicemail Override yoki Phone Tree Override -> kunlik kalendar
    happy path clicks: ~6 (guess; App Store tavsifi va sharhlaridan)
    edge: override o'rniga ish vaqtini o'zgartirish (ilova banner bilan ogohlantiradi); ofis interneti uzilsa ham mobil ishlaydi

F14 Egasi AI foydasini o'lchaydi
    S17 -> S18 (Voice / Message) -> conversation breakdown
    happy path clicks: 3
    edge: davrni o'zgartirish; filiallar bo'yicha
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Left nav rail | desktop rail, mobil tab bar | active, badge (o'qilmagan) | hammasi |
| Data table | call history, payment requests, conversation breakdown | filled, filtered; loading/empty — ko'rilmagan | S03, S18, S22 |
| Table toolbar | qidiruv, saqlanadigan filtrlar, ustun tanlash, eksport | saved, cleared | S03 |
| Period picker | Last 30 Days, custom | — | S03, S17, S18, S19 |
| Slide-out panel / drawer | Call Insights, routing node drawer | open, closed | S04, S14 |
| Toast / pop-up | Call Pop, AI completed, AI incomplete, payment completed, yangi so'rov | shown, dismissed | S06, S27 |
| Audio player | qator ichida, panel ichida | playing, paused, tezlik 0.7–2x, ±15 s | S03, S04, S05, S28 |
| Status badge / tag | AI outcome, scheduling outcome, sentiment, Urgent, AI sparkle, contact type | rang bo'yicha | S03, S04, S09 |
| Accordion call card | AI harakatlari timeline | collapsed, expanded | S02 |
| Message composer | SMS, MMS, guruh | empty, typing, ilova bilan (≤3 rasm), scheduled | S02, S09, S28 |
| Template + dynamic field picker | Individual, Family; EN / ES | — | S02, S13 |
| Multi-step wizard | auto-message builder | step n, draft, saved | S13 |
| Timing picker | before/after; hours/days/weeks; start time; delivery days + logic preview | — | S13 |
| Filter builder | status, type, practitioner, operatory, patient status, recall type, location, office status, call type | — | S13 |
| Channel selector + scope | Text, Email, Voice; all numbers / preferred mobile | — | S13 |
| Email editor | drag&drop logo/rasm/tugma, Weave Assistant (AI), desktop/mobil preview, test email | — | S13 |
| Voice script editor | 625 belgi, Preview (TTS) | — | S13, S14 |
| Toggle switch | auto-message, AI on/off, shaxsiy alertlar | on, off, cool-down | S12, S15, S26 |
| Kebab (⋯) menu | Edit / Duplicate / Delete / History; Create Contact / Download / Delete Recording; Collect Payment | — | S03, S04, S12, S22 |
| Routing canvas | Phone Hours, Call Group, Queue, Phone Tree, Voicemail, AI Receptionist tugunlari | edit, saved, override banner | S14 |
| Publish bar | Publish + Last Published | draft, published | S15 |
| Tabs | Requests / History; Services / Availability / Exceptions; Voice / Message | — | S09, S15, S18 |
| Request card | AI, online | Pending, Contacted, Dismissed, Urgent | S09 |
| KPI tile + chart | son, %, pul (estimated production value) | filled | S17, S18, S19 |
| Location filter / switcher | multi-location | — | S01, S06, S19, S20 |
| Modal | Text to Pay, user access | — | S22 |
| Task item | egasi, ustuvorlik, holat, deep link | open, in progress, completed | S02, S16 |
| Calendar | day view, mobil pinch-zoom | — | S08, S28 |
| Form builder + kiosk | bepul / to'liq | — | S20, S21 |
| Pay page | Apple Pay, Google Pay, Link, karta formasi, DOB gate | — | S23 |

## Inferred data model

```
Location      id, name, timezone, office_hours, pms_type, integration_status
              evidence: Location Access har auto-message'da (S13), Unify (help: Call Pop), Calendar Sync (help: PMS compatibility)
              confidence: high

User          id, name, role, permissions, location_ids[], assigned_number_ids[],
              settings {call_pop_on, ai_alert_completed, ai_alert_incomplete, alert_sound}
              evidence: Private Communications (Phones sahifasi), S26
              confidence: medium

PhoneNumber   id, e164, name, location_id, restricted_user_ids[], is_ai_number, missed_text_active
              evidence: "Phone Number Name" ustuni (S03), "Missed Text Active Numbers", "AI Receptionist Number" (help: AI overview)
              confidence: medium

Contact       id, first_name, last_name, phones[], preferred_mobile, email, birth_date, language (en|es),
              default_location_id, family_id, tags[], notes, balance_due, recall_due_at,
              contact_type (new|existing|non_patient), non_patient_kind (insurance_rep|it|job_applicant|vendor|...)
              evidence: Call Pop maydonlari, Contact Types (S03 help), DOB so'rov kartasida (S09), Family shablon, Spanish til sozlamasi
              confidence: high (asosiy maydonlar); medium (family_id, language)

Provider      id, name, active, location_id
              evidence: Manage Providers (S11, S15)
              confidence: high

Operatory     id, name, location_id
              evidence: Availability tab (S15), eslatma filtri
              confidence: high

Service       id, location_id, patient_friendly_name, procedure_codes[], duration_min, online_bookable, payment_type
              evidence: Services tab (S15), Appointment and Payment Types (S11)
              confidence: high; duration va payment_type — medium

AvailabilityRule  id, operatory_id, provider_id, service_ids[], booking_rule (chastota), exceptions[] {from, to, reason};
              config {status draft|published, last_published_at}
              evidence: help: AI Scheduling & Services
              confidence: high

Appointment   id, pms_id, contact_id, provider_id, operatory_id, service_id, start_at, end_at,
              status (scheduled|confirmed|cancelled|rescheduled|completed|no_show), source (pms|online|ai|staff), synced_at
              evidence: eslatma filtrlari, AI outcomes, writeback, No-Show analytics
              confidence: high; status ro'yxati — medium

AppointmentRequest  id, source (voice|sms|online), contact_id?, name, phone, birth_date, reason, preferences (matn),
              urgent, status (pending|contacted|dismissed), call_id, created_at
              evidence: help: AI-captured requests, S09
              confidence: high

Call          id, direction (in|out), from_number, office_number_id, contact_id, location_id, started_at, duration_s,
              result (answered|missed|abandoned|voicemail), handled_by (user_id | ai), device_name, recording_url,
              call_path[], tags[], mos, jitter
              evidence: S03 ustunlar ro'yxati, legacy rang kodlari
              confidence: high

CallInsight   call_id, summary, transcript[] {speaker, text, t}, sentiment, categories[],
              scheduling_outcome (scheduled_on_call|unscheduled|recovered|no_opportunity),
              ai_outcome (transfer_missed|transferred|added|cancelled|confirmed|rescheduled|error),
              service_issues[], pms_writeback_at
              evidence: S03/S04 help, Call Intelligence sahifasi
              confidence: high

Voicemail     id, call_id, box_id, audio_url, transcription, status (unread|handled|deleted), tags[], forwarded_to_box_id
              evidence: S03 help (Handled, Forward and Delete), Phones sahifasi, mobil 7.0.0
              confidence: medium

Thread        id, location_id, number_id, contact_ids[] (guruh suhbat), last_message_at
              evidence: Messages Overview, mobil guruh texting (7.4.0)
              confidence: medium

Message       id, thread_id, direction, channel (sms|mms|email), body, attachments[], author (user|ai|auto_message),
              auto_message_id, scheduled_at, status (queued|sent|delivered|failed)
              evidence: Messages Overview, Schedule Send (Text to Pay), "Message Queue" maqolasi nomi
              confidence: medium; status — guess

AutoMessage   id, title, type (appointment_reminder|confirmation|recall|reactivation|missed_call|missed_text|
              review_request|birthday|payment_reminder|follow_up|save_the_date|reschedule),
              location_ids[], timing {offset, unit, relation before|after, start_time, delivery_days[]},
              filters {appointment_status, appointment_type, practitioner, operatory, patient_status, recall_type,
              office_status, call_type}, channels[], scope (all|preferred_mobile),
              templates {sms_individual, sms_family, email_html, voice_text<=625}, sending_method (text|ai_sms),
              attached_form_id, enabled, history[]
              evidence: help: Missed Call / Reminders / Recall / Review Requests
              confidence: high
              qoidalar (alohida jadval emas): missed_call — 1/kun/bemor, tasdiqlayotganga skip; review — 1/30 kun, bekor qilinganga yo'q

AIReceptionistConfig  location_id, greeting_text, agent_name ("Sam", o'zgarmaydi), knowledge_base {address, hours,
              parking, insurance, payment_options}, scheduling_mode (direct|requests), enabled, cool_down_until
              evidence: help: AI overview, AI Scheduling, AI requests
              confidence: high

AICredit      location_id, month, credits_total (100 lik paketlar), credits_used; qoida: AI suhbati >=20 s = 1 kredit
              evidence: help: AI overview (Call Credit Tracking)
              confidence: high

CallRoute     id, location_id, graph {nodes[], edges[]}, overrides[] {kind phone_tree|voicemail, from, to}
              evidence: S14 (help: AI overview), Phones sahifasi, mobil 6.9.0 / 7.0.0
              confidence: medium

Task          id, source (call_intelligence|ai_receptionist|message|manual), reason (scheduling|waitlist|patient_care|...),
              contact_id, call_id | thread_id, owner_user_id, priority, status (open|in_progress|completed), citations[]
              evidence: Call Intelligence sahifasi, S03 help, AI overview, mobil 6.9.0
              confidence: high; reason ro'yxati — medium

Form          id, location_id, name, fields[], is_template
Packet        id, form_ids[]
FormSubmission  id, contact_id, form_id | packet_id, data, office_use_notes, pdf_url, status (pending|approved|rejected|archived), writeback_at
              evidence: help: Digital Forms Overview, "Approve or Reject" maqolasi nomi
              confidence: medium

PaymentRequest  id, contact_id, amount, description, attachments[] (DOB bilan himoyalangan), status (pending|completed|refunded),
              link_url, sent_at, paid_at, method
              evidence: help: Text to Pay, App Store sharhi (refund)
              confidence: medium

ReviewInvite  id, contact_id, appointment_id, channel, sent_at
              evidence: help: Review Requests
              confidence: medium

TeamChatGroup   id, name, member_ids[]
TeamChatMessage id, group_id, author_id, body, attachments[] (pdf, docx), created_at
              evidence: Pricing, App Store
              confidence: medium

Notification  id, user_id, kind (ai_completed|ai_incomplete|payment_completed|new_request|voicemail), ref_id, read_at
              evidence: AI overview, Text to Pay, AI requests, mobil 7.0.0
              confidence: medium
```

Relationships: Location 1-n PhoneNumber, Provider, Operatory, Service, AutoMessage, CallRoute; Location 1-1 AIReceptionistConfig; Location 1-n AICredit (oy bo'yicha). Contact 1-n Appointment, Call, PaymentRequest, FormSubmission, ReviewInvite, Task, AppointmentRequest; Contact n-n Thread. Call 1-1 CallInsight, 0-1 Voicemail, 0-n Task, 0-1 AppointmentRequest. Operatory 1-n AvailabilityRule, Provider 1-n AvailabilityRule, AvailabilityRule n-n Service. Thread 1-n Message; AutoMessage 1-n Message. Appointment 0-1 ReviewInvite. Form n-n Packet.

## Muhim mahsulot qoidalari (keyingi qadamlar uchun)

- AI darajama-daraja ishlaydi: PMS mos bo'lsa — to'g'ridan-to'g'ri qabul, mos bo'lmasa — so'rov (request) + bemorga darhol "qabul qilindi" SMS, xodim tasdiqlaydi. Hech qachon "jim" qolmaydi.
- AI qadamidan keyin fallback (Call Group yoki Voicemail) majburiy: kredit tugasa yoki AI ishlamasa qo'ng'iroq yo'qolmaydi.
- Chastota cheklovlari: missed call SMS — bemorga kuniga 1 marta; review — 30 kunda 1 marta; tasdiqlayotgan bemorga missed call SMS ketmaydi.
- AI qoidalari draft holatda saqlanadi va faqat "Publish"dan keyin kuchga kiradi ("Last Published" vaqti ko'rinadi).
- AI'ni o'chirish 30 kunlik pauza beradi — tasodifan o'chirib qo'yishning narxi yuqori; qayta yoqish darhol.
- "Recovered Opportunity": band qilinmagan qo'ng'iroqdan keyin 7 kun ichida qabul paydo bo'lsa, natija avtomatik yangilanadi — egasiga "AI/xodim qancha pulni qaytardi" raqami beriladi.
- Tasdiqlash erkin matn bilan (faqat "C" emas), sentiment orqali — bemor uchun qulay, Palantir'da o'zbek/rus javoblar uchun ayniqsa kerak.
- Ism: help'da AI doim "Sam" va o'zgartirib bo'lmaydi, marketing demosida esa "Mia" — marketing va mahsulot farq qiladi.
- Taxmin (guess): help kategoriyasi URL'i "WeaveTrueLark" va "AI Receptionist Security: NexHealth Trust Center" maqolasi nomi AI Receptionist qismi tashqi komponentlarga tayanishini ko'rsatadi.

## Feature matrix

See `features.csv`. Must: 34, should: 30, could: 8, skip: 7 (jami 79 qator).

## Out of scope (cannot or should not be cloned)

- AQSh telefon operatori tarmog'i, raqamlar va 10-DLC SMS brend ro'yxati — Weave'ning operator hamkorligi; Palantir o'rnida mahalliy SIP/MicroSIP va Telegram/Instagram.
- Yealink apparat telefonlari (T87W, AX83H) — apparat, mahsulot emas.
- PMS vendorlari ekotizimi: Dentrix, Eaglesoft, Open Dental va boshqalar bilan "authorized integrations" — vendor kelishuvlari; Palantir'da o'rnini DentaCRM bosadi.
- To'lovlarni qayta ishlash (Stripe, ACH, Tap to Pay, terminal) — to'lov litsenziyasi va hamkorlik, faqat AQSh.
- Bo'lib to'lash hamkorlari (Affirm, CareCredit) va Insurance Verification — AQSh moliya va sug'urta tarmoqlari.
- Weave'ning "o'n yillik, milliardlab qo'ng'iroq" ma'lumotlari va ular ustida o'qitilgan modellar — ilovaga tegishli ma'lumot.
- HIPAA infratuzilmasi va sertifikatlari — regulyator talab, AQSh uchun.
- Optometriya/veterinariya funksiyalari (Eyewear Ready, Vaccine Reminders), faks — bu slice va O'zbekiston uchun kerak emas.
- Weave'ning odamlar bajaradigan xizmatlari: onboarding, 1:1 trening, qog'oz anketalarni raqamlashtirish.

## Size

Screens 28, flows 14, entities 28 (ba'zilari kichik). Hard parts: (1) real vaqtli ovozli AI — past kechikish, o'zbek/rus nutqi, operatory + provider + service + exceptions qoidalari bo'yicha slot topish, xavfsiz fallback va kredit hisobi; (2) telefon qatlami — MicroSIP/SIP'dan qo'ng'iroq voqealarini (answered / missed / abandoned) olish, yozuvni saqlash, Call Pop uchun raqamni bemorga real vaqtda moslash, marshrut va override; (3) DentaCRM bilan ikki tomonlama sinxron va writeback (bo'sh slotlarni o'qish, qabul yozish, kechikish va to'qnashuvlar) hamda uning ustidagi Call Intelligence (transkript, sentiment, imkoniyat toifasi, 7 kunlik Recovered tekshiruvi) va auto-message dvigateli (jadval, filtrlar, chastota cheklovlari, ko'p kanal). Size: L (chorak) — butun slice noldan; Palantir'da allaqachon bor qismlar (AI qabulxona, MicroSIP yozuv, DentaCRM, dashboard) hisobga olinsa M–L (guess). Mukammal nusxa va'da qilinmaydi.

Keyingi qadam: `/replica-architect`.
