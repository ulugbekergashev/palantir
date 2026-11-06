## Parity: 57.6 / 100

features 57.6  (70 counted, must-haves 19 of 33 done)

Not shippable yet: 14 must-have features are not done.

## By area, weakest first
- reviews                        0.0  (1 features)
- forms                          0.0  (3 features)
- payments                       0.0  (2 features)
- reminders                     14.3  (3 features)
- mobile                        25.0  (2 features)
- texting                       50.0  (6 features)
- recall                        50.0  (3 features)
- phones                        55.8  (11 features)
- ai                            69.0  (26 features)
- scheduling                    70.6  (7 features)
- team                          75.0  (2 features)
- analytics                     77.3  (4 features)

## Missing, in build order
- [must] phones: Missed call SMS spam himoyasi, no  (bir bemorga kuniga 1 martadan ko'p emas; qabulni tasdiqlayotgan bemorga yuborilmaydi; eski MTT va AI SMS birga yoqilsa ikki marta boradi)
- [must] reminders: Har qanday ijobiy javob bilan tasdiqlash, no  (faqat C emas; sentiment tasdiq va bekor qilishni ajratadi (faqat SMS))
- [must] texting: Shablonlar va dinamik maydonlar, no  (ism, sana va h.k.; Individual / Family shablon; inglizcha va ispancha)
- [must] ai: AI ovozli qabulxona 24/7, partial  (telefon qo'ng'irog'iga javob beradi; ism Sam — o'zgartirib bo'lmaydi; Palantir uchun eng qimmat funksiya)
- [must] ai: Availability qoidalari: kabinet + shifokor + xizmat, partial  (har operatory uchun provider, ruxsat etilgan services, booking rule chastotasi; Rule Exceptions: tushlik, bayram, yopilish)
- [must] ai: Daromad imkoniyati: band qilindi / qilinmadi / qaytarildi, partial  (Scheduled On Call, Unscheduled, Recovered Opportunity (7 kun ichida yozilsa avtomatik), No Opportunity)
- [must] ai: Rejim: faqat yopiq vaqtda yoki 24/7, partial  (Phone Hours Open / Closed tarmoqlariga AI Voice Receptionist qadami qo'yiladi)
- [must] analytics: AI qabulxona analitikasi va taxminiy daromad, partial  (javob berilgan qo'ng'iroqlar, engagement rate, band qilingan qabullar, estimated production value; Voice / Message tablari)
- [must] phones: O'tkazib yuborilgan qo'ng'iroqqa avtomatik SMS, partial  (abandoned qo'ng'iroqda ham ishlaydi; filtr: call type / office status; dynamic fields; Weave da'vosi: kuniga 2 soat tejaladi)
- [must] phones: Qo'ng'iroqda bemor kartasi chiqadi (Call Pop), partial  (ism, keyingi qabul, recall muddati, qarz, vazifalar, eslatmalar; Answer / Ignore / View; Palantir: MicroSIP qo'ng'irog'ida DentaCRM kartasi)
- [must] phones: Qo'ng'iroqlar tarixi jadvali, partial  (qidiruv (ism/raqam), saqlanadigan filtrlar (xodim yoki AI, raqam, natija, yo'nalish), ustun tanlash, spreadsheet eksport)
- [must] recall: Recall eslatmasi muddat bo'yicha, partial  (allaqachon yozilganni bezovta qilmaydi; filtr: recall type, patient status, location; scheduling havolasi biriktiriladi)
- [must] recall: Recall javobida AI bo'sh vaqt taklif qiladi, partial  (AI xizmat turini aniqlaydi va jonli jadvaldan slot taklif qiladi; AI shu raqamga biriktirilgan bo'lishi kerak)
- [must] texting: Ofis raqamidan ikki tomonlama yozishma, partial  (shaxsiy raqam yashirin qoladi; Palantir: Telegram / Instagram / SMS bitta joyda)
- [should] ai: Draft → Publish (Last Published vaqti), no  (Publish bosilmasa AI eski qoidalar bilan ishlayveradi)
- [should] ai: Qo'ng'iroq xulosasini PMS kartasiga yozish, no  (faqat ayrim PMS'larda; Palantir: DentaCRM bemor kartasiga)
- [should] ai: Shoshilinch so'rov belgisi (Urgent), no  (Schedule Pulse kartasida qizil Urgent tegi)
- [should] ai: Transkriptlar bo'yicha qidiruv, no  (kalit so'z, ibora yoki tabiiy til bilan)
- [should] forms: Raqamli anketa: shablon / builder / paket, no  (bepul versiyada 4 shablon (karta, ACH, sug'urta, hujjat rasmi); to'liq versiyada builder va paketlar; kiosk rejimi)
- [should] mobile: Yangi ovozli pochta push-bildirishnomasi, no  (qo'ng'iroqchi, pochta qutisi, vaqt va transkript parchasi (7.0.0))
- [should] payments: SMS orqali to'lov havolasi (Text to Pay), no  (Payments → Requests → Collect Payment → Text to Pay; 160 belgidan uzun SMS havolani buzishi mumkin; Palantir: Click / Payme havolasi)
- [should] payments: To'lov sahifasi va to'landi bildirishnomasi, no  (klinika nomi va summa; Apple / Google Pay, karta; ilovada pop-up + email; invoice Completed)
- [should] phones: Ovozli pochta matnga aylantiriladi, no  (visual voicemail, tag, forward; Call History qatorida Handled belgisi)
- [should] reminders: Avto-xabarlar ro'yxati boshqaruvi, no  (toggle on/off, Edit, Duplicate, Delete, tahrir tarixi)
- [should] reviews: Tashrifdan keyin avtomatik sharh so'rovi, no  (30 kunda 1 martadan ko'p emas; bekor qilingan qabulga yuborilmaydi; 3–4 kun kutish tavsiyasi)
- [should] scheduling: Kutish ro'yxati (ASAP / Waitlist), no  (bekor qilingan joyni to'ldirish; marketingda AI ham backfilling cancellations qiladi)
- [should] scheduling: Online yozilish sahifasi va havolasi, no  (klinika sayti yoki Google Business profiliga qo'yiladi; bemor sahifasining o'zi ko'rilmadi (guess))
- [should] texting: Rasm / video / PDF yuborish, no  (bir xabarda 3 tagacha rasm (6.6.0); MMS video va PDF (7.1.0))
- [should] ai: Bemor kayfiyati (sentiment) va qo'ng'iroq toifalari, partial  (so'z tanlovi va kontekstdan; bir qo'ng'iroqda bir nechta toifa)
- [should] ai: Bemor turi: yangi / mavjud / bemor emas, partial  (0 ta tugagan qabul = yangi; bemor emas: sug'urta agenti, IT, ish izlovchi, sotuvchi va h.k.)
- [should] ai: O'z salomlashuvi va ovozni oldindan eshitish, partial  (~10 soniyadan qisqa; AI ekanini aytish tavsiya qilinadi (ba'zi shtatlarda qonun); Generate Greeting / Play)
- [should] analytics: Call Intelligence paneli, partial  (Scheduled / Unscheduled ulushi, Calls to Review, Spotlighted, Follow-up Tasks by Reason; lokatsiya bo'yicha solishtirish)
- [should] mobile: Mobil ilova: ofis raqamidan qo'ng'iroq va SMS, partial  (shaxsiy raqam yashirin; yozuvlarni tinglash, call history; reyting 4.4 (1.2K))
- [should] recall: Uzoq kelmaganlarni qaytarish (reactivation), partial  (idle patients'ni qaytarish; alohida Reactivation Messages turi bor)
- [should] reminders: Boshqa avto-xabar turlari, partial  (tug'ilgan kun, follow-up, save the date, reschedule, to'lov eslatmasi, reaktivatsiya — bitta builder)
- [should] scheduling: Mobil'da kalendar va qabul yaratish, partial  (7.5.0: yangi kalendar, pinch-to-zoom, qabul yaratish va tahrirlash)
- [should] texting: Ommaviy xabar (bulk) oylik limit bilan, partial  (tarif bo'yicha 1 500 / 3 000 / 15 000 xabar; sharhda: qor bo'roni kuni butun jadvalga xabar)
- [could] ai: AI'ni o'chirish 30 kunlik pauza beradi, no  (pauzada AI hech narsaga javob bermaydi; qayta yoqilsa faqat qoidalar ruxsat bergan vaqtda ishlaydi)
- [could] ai: Sharhlarga AI javob (Response Assistant), no  (yaxshi sharhni ko'tarish, salbiyga javob berish)
- [could] forms: Anketa ma'lumotini PMS'ga yozish, no  (faqat to'liq versiyada; Palantir: DentaCRM kartasiga)
- [could] forms: Anketani eslatmaga biriktirish, no  (reminder va recall SMS'iga Digital Form qo'shiladi)
- [could] phones: Vizual qo'ng'iroq marshruti (canvas), no  (Phone Hours (Open/Closed), Call Group, Call Queue, Phone Tree, Voicemail; + Add step va drag)
- [could] phones: Yopilish yoki bayram uchun override, no  (Phone Tree Override va Voicemail Override mobil ilovadan; ish vaqtini har safar o'zgartirmaslik uchun banner)
- [could] team: Jamoa chati, no  (guruhlar, PDF / DOCX; sharhlarda o'qilmagan belgisi muammosi; Palantir klinikalari Telegram guruhidan foydalanadi)
- [could] ai: AI qo'ng'iroq krediti va limit, partial  (lokatsiyaga 100 lik paketlar, har oy 1-sanada yangilanadi; >=20 soniyalik suhbat = 1 kredit; limit tugasa fallback'ga)

## Left out on purpose (not scored)
- Ko'p kanalli qabul eslatmasi: SMS + email + ovozli qo'ng'iroq (625 belgigacha); soat/kun/hafta oldin, start time, delivery days, logika preview; tavsiya: 7 / 3 / 1–2 kun oldin
- Eslatma auditoriyasi filtrlari: status, appointment type (oxirgi 12 oy), practitioner, operatory, patient status; scope: barcha raqamlar yoki asosiy mobil
- AQSh telefon tarmog'i va raqamlari (10-DLC): operator tarmog'i va SMS brend ro'yxati — Weave'ning hamkorlik infratuzilmasi; Palantir mahalliy SIP / MicroSIP va Telegram'dan foydalanadi
- Yealink apparat telefonlari: apparat va yetkazib berish — qayta quriladigan mahsulot emas
- Dentrix / Eaglesoft / Open Dental rasmiy integratsiyasi: PMS vendorlari ekotizimi va ruxsatli integratsiyalar (authorized integrations); Palantir'da o'rnini DentaCRM bosadi
- To'lovlarni qayta ishlash (Stripe / ACH / Tap to Pay): to'lov litsenziyasi va Stripe / Apple hamkorligi; faqat AQSh
- Bo'lib to'lash (Affirm / CareCredit): AQSh moliya hamkorlari
- Sug'urtani tekshirish (Insurance Verification): AQSh sug'urta tarmog'i; faqat dental tarifda
- Milliardlab qo'ng'iroqlarda o'qitilgan model: Weave'ning o'z ma'lumotlari (o'n yillik bemor suhbatlari); klon o'z ma'lumotini o'zi yig'adi

## Yours, not in the original (not scored)
- Instagram va Telegram'da AI qabulxona (O'zbekistonda asosiy kanal)
- Pul yozuvlari: «350 ming to'ladi» → tekshirilgan karta → tasdiq → DentaCRM
- Kamera: kelgan bemor to'lovsiz ketsa ogohlantirish
- Egasi Telegram'da ovoz bilan buyruq beradi
- Reklama filtri: tibbiy va'dalar mijozga o'zi ketmaydi
- Internetsiz klinika tarmog'i
- Yordam so'rash: egasi muammoni yozadi (panel yoki /yordam) → Palantir jamoasi javobi Telegram'iga
