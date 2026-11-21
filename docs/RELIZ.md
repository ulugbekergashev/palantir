Klinikalar shu kechasi o'zi yangilanadi. Yangilanishdan keyin biror narsa ishlamasa — Palantir o'zi oldingi nashrga qaytadi.

## 0.4.41 da yangi

- **Reklama kabinetini Pipeboard orqali ulash:** o'z Meta ilovangiz bo'lmasa ham bo'ladi. pipeboard.co'da Facebook bilan kiring, kabinetingizni ulang, u yerdagi tokenni Targetolog → Kabinet'ga qo'ying. Targetolog kabinetni o'qiydi, tahlil qiladi, kampaniyani pauzada yig'adi; yoqish va byudjet — faqat sizning Telegram tugmangiz bilan, limitlar ichida.
- **«Facebook orqali ulash» tugmasi (Palantir Hub):** token va ID kiritmasdan — Facebook oynasida ruxsat berasiz, qolganini Palantir o'zi topadi. Palantir Hub'da Meta ilovasi sozlangandan keyin ishlaydi.

## 0.4.40 da yangi

- **SMM-menejer (sobiq Kontent-meyker):** kunlar bo'yicha kontent kalendari — post, karusel va storis, vaqti va kanali bilan. Har biriga matn yozadi va brendingiz shablonida rasm tayyorlaydi (yozuvlar tiniq, shriftingiz va ranglaringizda). Siz Telegram'da tasdiqlagan post vaqti kelganda o'zi chiqadi. Panel → Marketing → SMM-menejer → Kalendar.
- **Targetolog Meta'ning rasmiy reklama asboblari bilan:** reklama kabinetingizni o'qiydi, natijalarni tahlil qiladi, kampaniyani o'zi yig'adi (2–3 xil reklama bilan) va pul behuda ketayotganini to'xtatadi. Pul faqat siz Telegram'dagi tugmani bosganingizda sarflanadi, limitlaringiz ichida. Buning uchun kabinet tokenida `ads_mcp_management` ruxsati bo'lishi kerak.
- **Ruxsatlar:** Sozlamalarda har ish uchun tanlaysiz — AI o'zi qilsinmi, sizdan so'rasinmi yoki hech qachon qilmasinmi.

## 0.4.39 da yangi

- **Hub'dan to'g'ri sozlamaga:** jamoa Palantir Hub'da «Telefon liniyasi», «Claude va kalitlar», «Telegram» kabi tugmani bossa (egangizning ruxsati bilan), panel bosh sahifada emas — darhol o'sha sozlama sahifasida ochiladi.

## 0.4.38 da yangi

- **Saytdagi «OK / Bekor» oynalari:** sayt kichik oyna chiqarsa (savol, tasdiqlash, ism so'rash) Palantir endi uni ko'radi va javob beradi — ilgari ish shu yerda to'xtab qolardi. To'lovni tasdiqlash so'ralsa OK bosmaydi, o'chirish so'ralsa sizdan so'raydi.
- **Sahifa ichidagi bo'limlar ham ko'rinadi:** matn muharrirlari va vidjetlar ichidagi tugma va maydonlar (iframe, Shadow DOM).
- **Fayl yuklash:** sayt fayl so'rasa ekraningizda Windows oynasi ochilmaydi. Palantir faqat shu ishda o'zi yuklab olgan faylni, sizning ruxsatingiz bilan qo'yadi.

## 0.4.37 da yangi

- **«Orqaga» tez ishlaydi:** Palantir Google'da qidirib, orqaga qaytganda 30 soniya kutib qolmaydi.

## 0.4.36 da yangi

- **Ketma-ket topshiriqda «Boshlaymi?» yo'q:** o'zingiz yozgan topshiriq darhol boshlanadi. Topshiriq internetdan yoki mijoz xabaridan kelgan bo'lsa — avvalgidek so'raladi.
- **Akkauntdagi muhim tugmalar oldidan so'raydi:** uzish, obunadan chiqish, bloklash, hisobdan chiqish.
- **«Boshlaymi?» ga javob bermasangiz** — «rad etdi» emas, «javob bermadi» deb yoziladi.

## 0.4.35 da yangi

- **Yuklab olingan fayl Telegram'ga keladi:** Palantir Chrome'ingizda biror faylni (masalan, lex.uz dan kodeksni) yuklab olsa — u sizga Telegram'da yuboriladi.
- **Bir nechta sayt bir vaqtda:** Palantir saytlarni alohida vkladkalarda ochganda ish to'xtab qolmaydi.

## 0.4.34 da yangi

- **Chrome yig'ilgan bo'lsa ham kutib qolmaydi:** Palantir rasm ololmasa, 15 soniya kutmasdan sahifani matn bilan o'qishga o'tadi.
- **Formadagi belgilar yorliq orqali ham qo'yiladi** (masalan, «Bacon» yozuvini bossa).

## 0.4.33 da yangi

- **Facebook va Meta Business'da Palantir sahifani ko'radi:** ilgari bunday murakkab saytlarda tugmalar unga ko'rinmasdi va u ko'r-ko'rona bosardi.
- **Ekran masshtabi 125–150% bo'lsa ham to'g'ri bosadi:** ko'p noutbuklarda Windows masshtabi kattalashtirilgan — endi Palantir tugmaning o'zini bosadi, yonini emas.

## 0.4.32 da yangi

- **Do'kon saytlarida qidiruv ishlaydi:** sahifada «hududingizni tanlang» oynasi chiqsa ham Palantir qidiruvni to'xtatmaydi.
- **Formadagi belgilar va yopiq bo'limlar:** Palantir belgi (✓) qo'yishda va yashirin bo'limga aylantirishda 15 soniya osilib qolmaydi.
- **«Javob bermadingiz» — «rad etdingiz» emas:** ruxsat so'roviga javob bermasangiz, hisobotda shunday yoziladi.
- **Eski «qila olmayman»ni takrorlamaydi:** avval bloklangan ish tuzatilgan bo'lsa, Palantir yana urinib ko'radi.

## 0.4.31 da yangi

- **Narx va kursni o'qish endi bloklanmaydi:** «olcha.uz da narxini top», «Markaziy bank kursini ayt», sinov formasini to'ldirish — Palantir «bu xarid» deb rad etmaydi. To'lash, pul o'tkazish, sotib olish va bank saytlari avvalgidek yopiq.
- **Uzun ro'yxatni aylantiradi:** Google Xaritalar kabi ro'yxatlar Palantir'ning vkladkasi orqa fonda bo'lsa ham pastga aylanadi.

## 0.4.30 da yangi

- **Katta fayl ham Telegram'ga keladi:** Palantir sizga 50 MB dan katta fayl yuborishi kerak bo'lsa (masalan, yig'ilgan o'rnatuvchi), endi u ham keladi — 2 GB gacha.

## 0.4.29 da yangi

- **Palantir kengaytmasi Chrome uchun:** bir marta o'rnatasiz (Sozlamalar → «Kompyuterda ishlash» → «O'rnatishni boshlash») — shundan keyin Palantir Chrome'ingizda hech narsa so'ramasdan ishlaydi: «Allow» yo'q, Chrome'ni qayta ochganda ham. Faqat o'z vkladkalarida ishlaydi — sizning vkladkalaringiz va cookie'laringiz unga ko'rinmaydi.
- **Javob bermaganingiz «rad etdi» deb yozilmaydi:** Palantir sizni kompyuterga chaqirib, javob bo'lmasa — hisobotda «javob bo'lmadi» deb yozadi.

## 0.4.28 da yangi

- **Xato yo'qolmaydi:** Palantir to'satdan to'xtab qolsa, sababi jurnalga yoziladi (logs/server-xato.log) — tuzatish tezlashadi.

## 0.4.27 da yangi

- **«Qo'shiq qo'y» — darhol:** Palantir'ga «Minor'ning qo'shig'ini qo'y» yoki «YouTube'da … ni och» deng — u YouTube'dan topib, kompyuteringizdagi brauzerda shu zahoti ochadi. Hech qanday ruxsat, «Boshlaymi?» yoki «Allow» so'ralmaydi. Boshqasini xohlasangiz — «boshqasini qo'y» deng.

## 0.4.26 da yangi

- **Halol javob:** Palantir yashirin (alohida) brauzerda ishlayotgan bo'lsa, «qo'shiq qo'y» yoki «videoni ko'rsat» kabi ishlarda «qo'ydim» demaydi — bu oynani hech kim ko'rmaydi va eshitmaydi. U halol aytadi va «Mening Chrome'im» rejimini taklif qiladi.

## 0.4.25 da yangi

- **Chrome'dagi «Allow» uchun ko'proq vaqt:** Palantir 5 daqiqa kutadi. Ulgurmasangiz ish yo'qolmaydi — Telegram'da «▶️ Qayta boshlash» tugmasi keladi.

## 0.4.24 da yangi

- **Sayt tasdiq so'rasa — ish to'xtamaydi:** Facebook yoki boshqa sayt «ключ доступа», PIN, barmoq izi yoki captcha so'rasa, Palantir tugmani o'zi bosadi, Telegram'da «Kompyuterda siz kerak» deb yozadi. Siz PIN kiritib «✅ Bajardim» ni bosasiz — ish o'sha joydan davom etadi.
- **Vkladka yopilmaydi:** «Mening Chrome'im» rejimida ish tugagach Palantir'ning vkladkasi ochiq qoladi — natijani ko'rasiz, o'zingiz davom etasiz, qo'yilgan musiqa o'chmaydi.

## 0.4.22 da yangi

- **Panel o'zi yangilanadi:** Palantir yangilansa, ochiq panel bir daqiqa ichida o'zi yangi ko'rinishga o'tadi — F5 bosish shart emas (biror narsa yozayotgan bo'lsangiz, tugashini kutadi).

## 0.4.21 da yangi

- **Halol natija:** Palantir brauzerdagi ishni bajara olmasa (kirish kerak, sayt to'sdi), Telegram'da «⚠️ Bajarilmadi» deb yozadi — avval har doim «Ish tugadi» derdi.
- **Ortiqcha raqam yo'q:** ish xabarlarida dollardagi narx ko'rsatilmaydi; ish nomidagi harflar to'g'ri chiqadi.

## 0.4.20 da yangi

- **«▶️ Qayta boshlash» tugmasi:** Palantir brauzerdagi ishni boshlashdan oldin so'raganda javob bermay qolsangiz, ish yo'qolmaydi — Telegram'dagi tugmani bossangiz, o'sha ish darhol boshlanadi.
- **Qisqa xabarlar:** Telegram'da avval ishning qisqa nomi («Boshlaymi: …?»), tafsiloti pastda.

## 0.4.19 da yangi

- **Palantir sizning Chrome'ingizda ishlaydi:** Sozlamalar → «Kompyuterda ishlash» → «Mening Chrome'im». Facebook, Google va boshqa saytlarga qayta kirish shart emas — siz allaqachon kirgansiz. Bir marta Chrome'da ulanishni yoqasiz (tugma sahifani o'zi ochadi). Palantir o'z vkladkasida ishlaydi, sizning vkladkalaringizga tegmaydi.
- **Telefon liniyasi barqarorroq:** telefon xizmatining yashirin qismi o'chib qolsa, o'zi qayta yonadi — qo'ng'iroqlar uzilmaydi.
- **Yangilanish to'xtab qolmaydi:** boshqa dastur (kod muharriri, antivirus) Palantir papkasini band qilib tursa ham yangilanish o'tadi.

## 0.4.18 da yangi

- **Brauzerda ishlashni o'zingiz yoqasiz:** Sozlamalar → «Kompyuterda ishlash». Yoqsangiz, Palantir saytlardagi ishni o'zi bajaradi (masalan, Meta Business'da nom o'zgartirish, soliq.uz dan hujjat yuklab olish). Saqlash yoki yuborishdan oldin Telegram'da sizdan so'raydi; bank va to'lov yopiq. Saytlarga kirish oynasi ham shu yerda.
- **Ovozli suhbat javobni yo'qotmaydi:** Palantir javobi kechiksa, ovoz «xabar beraman» deb jim qolmaydi — javob kelishi bilan o'zi aytib beradi.
- **Ovozda begona belgilar yo'q:** ekranga «<no speech>» kabi xizmat yozuvlari chiqmaydi, o'zbek va rus nutqi to'g'riroq taniladi.
- **Palantir jamoasi masofadan yordam beradi:** kelmasdan turib dastur holatini tekshiradi, Palantir'ni qayta ishga tushiradi yoki kechani kutmay yangilaydi. Har bir bunday ish haqida Telegram'ingizga xabar keladi. Telefonda suhbat ketayotgan bo'lsa, qayta ishga tushirish u tugashini kutadi.
- **Jamoadan xabar:** muhim gap bo'lsa (o'rnatuvchi keladi, kompyuterni o'chirmang…), Telegram'ingizga va panel jurnaliga keladi.

## 0.4.17 da yangi

- **Tarif:** AI xodimlar va telefondagi AI tarifingizga qarab yoqiladi. Tarifda yo'q xodim «AI xodimlar» sahifasida qulf bilan ko'rinadi — qo'shish uchun sotuvchiga murojaat qilasiz. Tarif kengaysa, avval olgan xodimlaringiz o'z joyiga qaytadi, ma'lumotlari saqlanib qoladi.
- **Telefonda AI tarifda bo'lmasa:** qo'ng'iroqlarni administrator oladi, telefon sahifasida shu haqda yozib qo'yilgan.
- **Telefondagi AI ovozi yangilandi:** yangi ayol ovozi va Toshkent shahar talaffuzi.

## 0.4.16 da yangi

- **Sotuvchidan eslatma:** to'lov muddati yoki boshqa muhim gap bo'lsa, panel tepasida va Telegram'ingizda sotuvchining xabari ko'rinadi.
- **Hisob to'xtatilsa:** panel va AI xodimlar to'xtaydi, lekin qo'ng'iroqlarni administrator telefoni oladi va bemorlarning xabarlari xodimlarga keladi — mijozlar javobsiz qolmaydi. Sotuvchi ochishi bilan hammasi bir necha daqiqada o'zi tiklanadi.
- **Internet uzoq vaqt yo'q bo'lsa:** Palantir serveri bilan 23 kun aloqa bo'lmasa — eslatma, 30 kun — to'xtaydi; aloqa tiklanishi bilan o'zi ochiladi.
- **Telefondagi AI ulanmasa — darrov bilasiz:** Google ovozli AI'si ishlamay qolsa (qo'ng'iroqlar administratorga o'tib ketayotgan bo'lsa), Telegram'ingizga va panelga xabar keladi.
- **Sotuvchi Hub'da ko'radi:** biznes turi (klinika, o'quv markazi, xizmat…) endi o'zi keladi.

## 0.4.15 da yangi

- **Telefondagi AI va paneldagi ovozli suhbat yana ishlaydi:** Google ovozli modelini o'zgartirgani va ba'zi internet tarmoqlaridagi (IPv6) muammo tufayli AI ulanmay, qo'ng'iroqlar administratorga o'tib ketayotgan edi.
- **HR bo'limi:** Rekruter — vakansiya matni va savollar, nomzodlar botda javob beradi, AI baho va xulosa beradi, chaqirish yoki rad etish — faqat sizning tugmangiz bilan. Murabbiy — xodimga klinikangizning o'z bilimidan darslar va test, natijasi sizga keladi.

## 0.4.14 da yangi

- **AI ish vaqtini o'ylab topmaydi:** ish vaqti saqlanmagan bo'lsa, AI aytgan soatlar bemorga o'zi ketmaydi — avval sizga keladi (oldin DentaCRM jadvalidagi sanalar tufayli ba'zan o'tib ketardi).
- **Ish bo'yicha yozishmalar:** shaxsiy Telegram'ingizga yozgan yetkazib beruvchi, laboratoriya yoki hamkor — kartada «🤝 Ish bo'yicha». AI ularga javob bermaydi; 3 soat javob bermasangiz bitta eslatma, kechki xabarda kutayotganlar ro'yxati.
- **Pul — faqat sizda:** AI bank, to'lov, pul o'tkazish va xaridga kirmaydi — bu kodda yopilgan, tugma bilan ham ochilmaydi. Pul haqida faqat ma'lumot va hisobot beradi.

## Bemorlar uchun

- **Hech bir bemor javobsiz qolmaydi.** Kechasi ham, rasm, ovoz yoki lokatsiya yuborsa ham — javob yoki «yetkazildi» boradi. AI javob bera olmagan bemor panelda «javob kutyapti»da turadi.
- **Telefonda qo'ng'iroq yo'qolmaydi.** AI ishlamay qolsa yoki band bo'lsa — administrator telefoni jiringlaydi, u ham ko'tarmasa mijozga uzr aytiladi va «qayta qo'ng'iroq qiling» so'rovi ochiladi.
- **Telefondagi AI bemorni taniydi:** qabulini o'zi ko'chiradi yoki bekor qiladi, javobi yozishmadagidek to'liq (narxi kiritilmagan xizmatlar, shifokorlar).
- **Qabul to'g'ri yoziladi:** ta'tildagi shifokorga, tushlik vaqtiga yozilmaydi; jadval javob bermasa ikki qabul yozilmaydi.
- **Bir telefondagi oila a'zolari** (masalan, Zarina va Vali Valiyev) bitta kartaga qo'shilib ketmaydi.

## Egasi uchun

- **AI administrator — asosiy xodim.** U jamoadan chiqmaydi. Bemorlarga javob bermasin desangiz — Sozlamalar → «Mijozlarga javob» → «O'chiq»; telefonda — Sozlamalar → Telefon liniyasi → «Faqat administrator».
  AI administratorni oldin jamoadan olib tashlagan bo'lsangiz — o'sha holat saqlanadi: javob «o'chiq», telefon «faqat administrator».
- **AI'ga ishonch o'lchanadi.** «Men tasdiqlayman» rejimida so'nggi 20 ta javob taklifidan 16 tasini o'zgartirmasdan yuborsangiz, Palantir Telegram'da «AI o'zi javob bersinmi?» deb so'raydi. Rejimni faqat siz o'zgartirasiz.
- **Kamroq xabar:** darhol faqat muhimi (qabulga yozilish, AI bilmagan savol); qolgani kechqurun bitta xabarda. Kechasi — faqat shoshilinchi.
- **Bosh ekranda «Bugun klinikada»:** tushum, to'lovlar, kelganlar va qarz (DentaCRM'dan); «Bugungi jurnal» — AI jamoa nima qilgani.
- **Bitta voqea — bitta karta:** so'rov, javob taklifi va qo'ng'iroq xulosasi bitta Telegram kartasida.
- **Shaxsiy Telegram'dagi do'st yoki qarindosh** — «Bemor emas» tugmasi bilan mijozlar ro'yxatidan chiqadi.
- **Obuna limiti:** bemorlarga javob har doim birinchi; limitga yaqinlashsa Direktor, kontent va boshqa qo'shimchalar kutib turadi va keyin o'zi bajariladi.
- **Kirishni yo'qotsangiz** (Telegram va parol) — Palantir jamoasi shaxsingizni tekshirib tiklaydi.

## O'rnatuvchi uchun

- **Ulash ustasi:** yangi qadamlar — «Bemorlar Telegram'i» va «Javob rejimi» (egasi bilan aniq tanlanadi); kameralar — ixtiyoriy oxirgi qadam.
- **Telefon liniyasi:** ustada va Sozlamalarda «Telefon xizmatini o'rnatish» tugmasi (klinika kompyuterining o'zida). **Windows 10 da ham ishlaydi.** Uztelecom shakli (raqam, softswitch, parol yoki parolsiz — IP bo'yicha), «Raqamni tekshirish» va ulanmaslik sababi oddiy tilda.
- **Yangilanish ishonchliroq:** o'chirib qo'yiladigan kompyuter yonganda yangilanadi; yangi nashrda Telegram bot, AI yoki telefon AI ishlamasa — eskisiga qaytadi; papka band bo'lsa yarim yo'lda qolmaydi.
- **Zaxira:** kalitning parolli nusxasi (`npm run zaxira-kalit-nusxa`), zaxiraga sozlamalar va telefon fayllari ham kiradi.
- **Hub:** o'rnatuvchi o'zi o'rnatgan kompyuterni kod bilan o'ziga biriktiradi (tasdiq — asoschida); klinika muammolari ro'yxati.
