# Haqiqiy klinikada sinov — 30 ta tekshiruv

Birinchi sinov klinikasi uchun (DentaCRM ishlatadigan, egasi bilan yaxshi munosabatdagi klinika). Bu ro'yxatdagi narsalar
hozirgacha faqat soxta xizmatlar bilan sinalgan: haqiqiy Telegram, Instagram, DentaCRM, Claude obunasi, MicroSIP, kamera,
toza Windows kompyuter. O'rnatishning o'zi — [ORNATISH.md](ORNATISH.md), umumiy tartib — [SINOV.md](SINOV.md).

Har bandda: **nima qilasiz** → **o'tdi, agar**. O'tmasa — nima bo'lganini, vaqtini va skrinshotni yozing, egasi botga
`/diagnostika` (yoki `/yordam`) yozsin. Bandlar tartib bilan: oldingisi o'tmasa, keyingisining natijasi ishonchsiz.

## Borishdan oldin

- [ ] Oxirgi nashr Hub'ga joylangan (`npm run hub:deploy`) va reliz chiqarilgan — klinika eng yangi kod bilan ishlasin.
- [ ] Sinov uchun **ikkinchi telefon** (bemor bo'lib yozish va qo'ng'iroq qilish uchun) va DentaCRM'da sinov bemori.
- [ ] Egasi bilan kelishilgan: birinchi 3 kun javob rejimi — **«Men tasdiqlayman»**, «O'zi javob bersin» — keyin.

## A. O'rnatish va ishga tushish

1. [ ] **Toza kompyuterga o'rnatish.** `Palantir-Ornatish-<nashr>.exe` → `install\Tekshirish.cmd`.
   O'tdi, agar: o'rnatgich savolsiz tugadi, tekshiruvda `[XATO]` yo'q, panel brauzerda ochildi.
2. [ ] **Hub va litsenziya.** Kompyuter Hub'ga o'zi yozildi → `/admin` da ekrandagi kompyuter kodi bilan «Tasdiqlash va
   aktivlashtirish». O'tdi, agar: sizga Telegram'da «Yangi kompyuter» keldi, klinika ekrani kalitsiz o'zi ochildi.
3. [ ] **Klinikaning Claude obunasi.** Ulash ustasi → Kalitlar → «Claude obunasiga kirish» (klinikaning o'z akkaunti, Pro yoki
   Max). O'tdi, agar: holatda «Kirilgan: Claude …», egasining birinchi savoliga javob keldi. Birinchi to'liq ish kunidan keyin:
   obuna limitiga yetmadi.
4. [ ] **Ovoz (Gemini kaliti).** Egasi botga o'zbekcha va ruscha ovozli xabar yuboradi. O'tdi, agar: to'g'ri tushundi va bajardi.
5. [ ] **Elektr o'chdi.** Kompyuterni o'chirib-yoqing, Windows'ga **kirmang**. O'tdi, agar: 2 daqiqa ichida bot javob beradi.
6. [ ] **Kompyuter tayyor.** Uxlash o'chirilgan, diskda 20 GB+ bo'sh joy, egasi botga `/diagnostika` yozdi.
   O'tdi, agar: diagnostika `/admin` ga keldi, unda xato qatorlari yo'q.

## B. Egasi bilan ishlash

7. [ ] **Egasini ulash.** Paneldagi havola bilan egasi botga kirdi, «Bugun nechta qabul bor?» deb so'radi.
   O'tdi, agar: son DentaCRM'dagi bilan bir xil.
8. [ ] **Ertalabki reja va kechki hisobot.** Belgilangan soatda keldi. O'tdi, agar: qabullar, xabarlar va pul raqamlari
   DentaCRM bilan mos, egasi «bu foydali» dedi.
9. [ ] **Eslatma.** «Ertaga soat 10 da laboratoriyaga qo'ng'iroq qilishni eslat». O'tdi, agar: vazifa panelda bor va ertaga
   10:00 da eslatdi.
10. [ ] **Pul yozuvi.** «<Haqiqiy bemor> 300 ming to'ladi» → kartadagi bemor va summani tekshirib tasdiqlash.
    O'tdi, agar: to'lov DentaCRM'da to'g'ri bemorda, to'g'ri summada paydo bo'ldi (sinovdan keyin o'chiring).

## C. Bemor yozishmalari

11. [ ] **Telegram bot.** Ikkinchi telefondan «narxlar qancha?». O'tdi, agar: egasiga javob taklifi keldi, narx bilimdagi
    narx, «Yuborish» dan keyin bemorga ketdi.
12. [ ] **Egasining shaxsiy Telegrami** (Telegram Business ulangan bo'lsa). Bemor egasining o'ziga yozdi.
    O'tdi, agar: javob taklifi keldi va egasining nomidan ketdi.
13. [ ] **Instagram Direct.** Begona akkauntdan klinika Instagramiga yozing. O'tdi, agar: javob taklifi keldi va Direct'ga
    ketdi. 24 soatdan eski yozishmaga javob yuborilmaydi — bu Meta qoidasi, xato emas.
14. [ ] **Qabulga yozish — to'liq.** Bemor: «Ertaga tish tozalashga yozilmoqchiman». O'tdi, agar: taklif qilingan bo'sh vaqtlar
    DentaCRM jadvali bilan bir xil, qabul DentaCRM'da to'g'ri shifokor va vaqtda paydo bo'ldi, «yozdik» degan javob qabul
    yozilgandan **keyin** ketdi.
15. [ ] **Ko'chirish va bekor qilish.** Bemor: «qabulimni payshanbaga ko'chiring», keyin «bekor qiling».
    O'tdi, agar: ikkalasi ham DentaCRM'da o'zgardi va bemorga to'g'ri vaqt aytildi.
16. [ ] **Bilimda yo'q savol.** Masalan: «Sizda bolalar uchun narkoz bormi?». O'tdi, agar: Palantir o'ylab topmadi, egasidan
    so'radi. Egasi javob bergach bemorga ketdi, keyingi safar xuddi shu savolga o'zi javob berdi.
17. [ ] **Xavfsizlik filtrlari.** Bemor chegirma, karta raqami yoki «qancha turadi, aniq ayting» deb so'raydi; «O'zi javob
    bersin» rejimida ham sinang. O'tdi, agar: bilimda yo'q narx, chegirma, telefon yoki karta raqami mijozga **o'zi ketmadi**,
    egasiga keldi.
18. [ ] **Tillar.** Bemor o'zbek lotin, o'zbek kirill, rus va aralash tilda yozadi. O'tdi, agar: javob bemorning tilida va
    tabiiy, egasi tuzatmadi.
19. [ ] **Kechasi va dam olish kuni.** Ish vaqtidan tashqari bemor bo'lib yozing. O'tdi, agar: javob kechikmadi, ertalabki
    hisobotda ko'rindi. 3 kun «Men tasdiqlayman»dan keyin egasi rozi bo'lsa — «O'zi javob bersin» yoqiladi.

## D. Telefon (MicroSIP)

20. [ ] **Kiruvchi qo'ng'iroq.** Ikkinchi telefondan klinika raqamiga qo'ng'iroq. O'tdi, agar: panelda «jiringlayapti» va
    mijoz kartasi chiqdi, suhbat yozuvi saqlandi.
21. [ ] **Ko'tarilmagan qo'ng'iroq.** Qo'ng'iroq qiling va ko'tarmang. O'tdi, agar: «qayta qo'ng'iroq» so'rovi ochildi,
    egasi yoki administrator xabar oldi.
22. [ ] **Qo'ng'iroq tahlili.** Haqiqiy suhbatdan keyin. O'tdi, agar: xulosa va baho suhbatga mos (o'zbek va rus nutqi
    to'g'ri eshitilgan).
23. [ ] **Ikkinchi qabulxona kompyuteri va xodim kirishi.** `install\Stansiya.cmd` / `Tarmoq.cmd`, administratorga Sozlamalar
    → Xodimlar'da login. O'tdi, agar: panel ichki tarmoqda ochildi, qo'ng'iroq ko'targan kompyuterga yozildi, administrator
    faqat Qabulxonani ko'radi.

## E. Kamera

24. [ ] **Haqiqiy IP kamera.** Kamera qidiruvi (ONVIF/RTSP) → zonalar → egasi botga `/kamera` yozadi.
    O'tdi, agar: kadr kelyapti, «/kamera qabulxonada kim bor» savoliga kadrga mos javob keldi.
25. [ ] **Kreslo va to'lov.** Kreslo zonasiga DentaCRM shifokori belgilangan, bir to'liq ish kuni.
    O'tdi, agar: «to'lovsiz ketdi» ogohlantirishlari haqiqatga mos; soxta ogohlantirishlar sonini yozing.

## F. Masofadan va xizmat

26. [ ] **Telefondan panel.** Egasi botdagi «Panel» tugmasini klinikadan tashqarida bosadi. O'tdi, agar: panel parolsiz ochildi.
27. [ ] **Palantir jamoasi kirishi.** `/admin` → «Panelni ochish». O'tdi, agar: egasiga Telegram'da «✅ Ruxsat / ✖️ Yo'q»
    keldi, ruxsatdan keyin kirdingiz, «🚫 Kirishni yopish» darhol chiqardi.
28. [ ] **Yordam so'rash.** Egasi botga `/yordam Sinov so'rovi` yozadi. O'tdi, agar: sizga Telegram'da keldi, `/admin` →
    «Yordam so'rovlari»dagi javobingiz egasining Telegramiga va paneliga keldi.
29. [ ] **Zaxira.** Ertasi kuni `/admin/backups` da klinika zaxirasi bor. O'tdi, agar: o'z kompyuteringizda
    `npm run restore-backup` bilan ochildi (baza ichida kechagi qabullar bor).
30. [ ] **Kechasi yangilanish.** Sinov davomida bitta yangi reliz chiqaring. O'tdi, agar: klinika kechasi o'zi yangilandi,
    ertalab hammasi ishlayapti, egasi hech narsa sezmadi.

## Sinov oxirida (7–14 kun)

Klinika egasiga raqamlar bilan ko'rsating: nechta xabar keldi, o'rtacha javob vaqti, nechta qabul yozildi, nechtasi kechasi yoki
dam olish kuni kelgan, nechta qo'ng'iroq qayta qilindi. To'lov shu raqamlar bilan so'raladi. O'tmagan bandlar — keyingi
klinikadan oldin tuzatiladi.
