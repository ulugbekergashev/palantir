Klinikalar shu kechasi o'zi yangilanadi. Yangilanishdan keyin biror narsa ishlamasa — Palantir o'zi oldingi nashrga qaytadi.

## 0.4.17 da yangi (tayyorlanmoqda)

- **Tarif:** AI xodimlar va telefondagi AI tarifingizga qarab yoqiladi. Tarifda yo'q xodim «AI xodimlar» sahifasida qulf bilan ko'rinadi — qo'shish uchun sotuvchiga murojaat qilasiz. Tarif kengaysa, avval olgan xodimlaringiz o'z joyiga qaytadi, ma'lumotlari saqlanib qoladi.
- **Telefonda AI tarifda bo'lmasa:** qo'ng'iroqlarni administrator oladi, telefon sahifasida shu haqda yozib qo'yilgan.

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
