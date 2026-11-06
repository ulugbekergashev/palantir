# Test rejasi: Palantir (replica-test)

Sana: 2026-11-06 · Build: 54d8385 · Muhit: mahalliy, soxta xizmatlar (DentaCRM, Meta, Telegram, MicroSIP)

Bu reja Palantir'ning **o'z** oqimlari uchun. Raqobatchilarning serverlari sinalmaydi (skill qoidasi).
Mavjud testlar: 49 ta `scripts/e2e-*`, `check-*`, `ui-*` fayl, ~1777 ta `ok(...)` tekshiruvi.

## Asosiy oqimlar va qamrov

| oqim | nima | asosiy test | chekka holatlar — bor | chekka holatlar — yo'q / tekshirish kerak |
| --- | --- | --- | --- | --- |
| F01 | Bemor botga yozadi → Qabulxona bo'sh vaqtni topadi → DentaCRM'ga yozadi | `test:crm`, `test:requests` | ikki marta bosish → bitta qabul (e2e-crm:277); ikki bemor bir vaqt → bittasi; kunlik chegaralar; CRM javob bermasa «natijasi noma'lum» | emoji/kirill ism bilan qabul; telefon kengligida panel kartasi |
| F02 | Instagram Direct → javob taklifi → egasi tasdiqlaydi / o'zi ketadi | `test:instagram` | Meta bir xabarni 2 marta yuborsa → bitta (e2e-instagram:170); emoji | 24 soat oynasidan keyin javob (Meta qoidasi) — alohida tekshiruv |
| F03 | Kiruvchi qo'ng'iroq → MicroSIP yozuvi → tahlil → so'rov kartasi | `test:phone`, `test:stations` | bir qo'ng'iroq bir nechta kompyuterda jiringlasa (routeStation) | yozuv fayli yarim yozilgan (kompyuter o'chdi) |
| F04 | «Ali 350 ming to'ladi» → karta → tasdiq → DentaCRM | `test:crm` | ikki marta tasdiq → 409 (e2e-crm:479); bir vaqtda ikki tasdiq → bitta yozuv (e2e-crm:518) | — |
| F05 | Egasining buyrug'i / ovozi → vazifa, eslatma, ertalabki reja | `test:work`, `test` | takroriy eslatma yo'q | vaqt mintaqasi: server UTC'da, klinika Toshkentda (25 faylda tz bor — F05 uchun alohida sinov yo'qligini tekshirish) |
| F06 | Bosh sahifa: KPI, grafik, voronka | `test:dashboard` | telefon kengligi (viewport); CRM uzilsa egasiga bir marta ogohlantirish | — |
| F07 | Kamera: kirdi-chiqdi → to'lovsiz qabul ogohlantirishi | `test:camera`, `test:camwork` | ikki marta o'tish ≠ uzun o'tirish; bitta qabul ikki marta bog'lanmaydi | — |
| F08 | Telefondan panel Hub orqali | `test:hub` | klinika aloqada emas → sahifa; ogohlantirish takrorlanmaydi | — |
| F09 | Bizneslar bir-birini ko'rmaydi | 30 ta faylda «boshqa biznes» | ikkinchi biznes ma'lumoti ko'rinmaydi | — |

## Skill talab qiladigan, lekin bizda yo'q narsalar

| # | talab (replica-test, Step 2) | bizda | og'irlik |
| --- | --- | --- | --- |
| T1 | Har UI testda server **5xx** javobi testni yiqitsin | yo'q — `ui-*.ts` faqat `pageerror` va `console.error` ni ushlaydi | S3: 500 qaytgan, lekin sahifa «bo'sh» ko'rsatgan holat sezilmaydi |
| T2 | Klaviatura bilan oqimni oxirigacha o'tish (Tab, Enter) | yo'q — hech bir `ui-*` testda `press('Tab')` yo'q | S3: qabulxona xodimi sichqonchasiz ishlay oladimi — noma'lum |
| T3 | Har ekranda axe accessibility skani | yo'q — `@axe-core/playwright` o'rnatilmagan | S4 |
| T4 | Kontrast (replica-design) | ✅ 54d8385: 24 juft, 0 xato, ikkala mavzu | — |

## Keyingi qadam

T1 — arzon: har `ui-*.ts` da `page.on('response', r => r.status() >= 500 && errors.push(...))`. T2 — `ui-live` ga bitta
«faqat klaviatura bilan qabulga yozish» stsenariysi. T3 — yangi dev-kutubxona kerak, egasi bilan kelishib.
