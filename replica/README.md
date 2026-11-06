# replica/ — raqiblar tahlili (Replica skill to'plami)

Skill'lar: `.claude/skills/replica-*` ([Jakeschincariol/replica-skill](https://github.com/Jakeschincariol/replica-skill), MIT).
Bu papka **hech qaysi relizga tushmaydi** (`scripts/archive.ts` → `shipsInRelease`, `npm run test:archive`).

Palantir — tayyor mahsulot, shuning uchun skill raqibni «klonlash» uchun emas, **solishtirish** uchun ishlatildi:
o'rganish (recon) → solishtirish (diff) → foydalanuvchilar nimadan norozi (entrepreneur) → tuzatish.

## Natija (2026-11-06)

| | Kommo / amoCRM | Weave |
| --- | --- | --- |
| nima | messenjer CRM, AI agent — O'zbekistonda standart | AQSh stomatologiya klinikalari: telefon, SMS, AI qabulxona |
| funksiyalar | 78 + 6 ta Palantir'niki | 79 + 6 ta Palantir'niki |
| parity | **60.4** (must 22/35) | **57.6** (must 19/33) |
| sharhlar | 411, 4 manba | 508, 2 manba (thin) |

Asosiy topilmalar va reja — [fixes.md](fixes.md). Qilinganlari:
- **dd727b0** — bilimda yo'q telefon, karta yoki hisob raqami bor javob mijozga o'zi ketmaydi (Kommo AI agenti shunday xato qilgan)
- **54d8385** — kiritish maydonlari chegarasi 1.67:1 → 3.47:1 (qorong'ida 3.80:1)

## Fayllar

| fayl | skill | nima |
| --- | --- | --- |
| `kommo/recon.md`, `weave/recon.md` | replica-recon | ekranlar, oqimlar, ma'lumot modeli, manbalar (hammasi havolali) |
| `kommo/features.csv`, `weave/features.csv` | recon + diff | funksiyalar; `clone` — Palantir'da bormi, `palantir` — koddagi dalil |
| `kommo/parity.md`, `weave/parity.md` | replica-diff | ball, eng zaif bo'limlar, yetishmaydiganlar tartibi bilan |
| `reviews-kommo.csv`, `reviews-weave.csv` | replica-entrepreneur | so'zma-so'z sharhlar, har biri havolali |
| `kommo/feedback.md`, `weave/feedback.md` | replica-entrepreneur | mavzular bo'yicha reyting |
| `themes.json` | replica-entrepreneur | mavzular: en + ru + pt + es, soha (kanallar, telefon, AI) |
| `fixes.md` | replica-entrepreneur | 3 ro'yxat, tuzatishlar rejasi, pozitsiya |
| `design/tokens.json`, `design/tokens-night.json` | replica-design | Palantir ranglari — kontrast tekshiruvi uchun |
| `test-plan.md` | replica-test | asosiy oqimlar va testlar qamrovi, bo'shliqlar |

## Qayta ishga tushirish

Python — `py` (3.14). `-X utf8` shart: Windows konsoli cp1251.

```bash
py -I -X utf8 .claude/skills/replica-diff/parity.py replica/kommo/features.csv --markdown > replica/kommo/parity.md
py -I -X utf8 .claude/skills/replica-entrepreneur/reviews.py replica/reviews-kommo.csv --themes replica/themes.json --out replica/kommo/feedback.md
py -I -X utf8 .claude/skills/replica-design/contrast.py replica/design/tokens.json        # yangi rang qo'shilganda
```

Funksiya qurilgach — `features.csv` dagi `clone` ni `yes` qiling va `parity.py` ni qayta ishga tushiring.
`replica-brand`, `replica-launch`, `replica-deploy` ishlatilmadi: Palantir'ning o'z nomi, brendi va o'rnatish yo'li bor.
