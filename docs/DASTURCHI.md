# Dasturchi — Palantir egasining o'z loyihalari kodida ishlaydi

Faqat egasining kompyuterida. Klinika o'rnatmalarida yo'q: `.env` da `DEV_PROJECTS` bo'lmasa asbob umuman ko'rinmaydi.

## Nima qiladi

Egasi Palantir'ga (Telegram yoki paneldagi suhbat) yozadi yoki aytadi:

> XClinic'da hisobotda sof foyda noto'g'ri chiqyapti — tuzat

Palantir ishni fonda boshlaydi, tugagach Telegram'ga hisobot keladi: nima o'zgardi, qanday tekshirildi, qaysi fayllar.
Hisobot ostida uchta tugma:

- **✅ Qabul qilish** — o'zgarish loyihaga qo'shiladi (`git merge`, push qilinmaydi);
- **✖️ Tashlab yuborish** — loyiha o'zgarmaydi;
- **📄 O'zgarishlarni ko'rish** — farq bitta fayl bo'lib keladi.

Tuzatish kerak bo'lsa — shunchaki yozing («tugmani ko'k qil»): o'sha ish davom etadi.
Savol ham bersa bo'ladi («nega X ishlamayapti?») — kod o'zgarmaydi, javob keladi.
To'xtatish: holat xabaridagi «⏹ To'xtatish» yoki `/toxta` — qilingani yo'qolmaydi.

## Yoqish

`.env`:

```
AI_ENGINE=subscription
# eski nom: dasturchi papkasi hali shunday ataladi
DEV_PROJECTS=palantir=D:\Projects\cerebro;xclinic=D:\Projects\xclinic;denta7=C:\Users\...\Desktop\denta7
```

Ixtiyoriy: `DEV_MAX_MINUTES` (45), `DEV_MAX_TURNS` (200), `DEV_MODEL` (bo'sh — `AI_MODEL`).

Loyiha papkasida **git bo'lishi shart** — busiz o'zgarishni ko'rib ham, qaytarib ham bo'lmaydi.

## Qanday ishlaydi

- Ish loyihaning o'zida emas, alohida nusxasida boradi (`data/dasturchi/<ish>`, shox `palantir/<ish>`). Loyihada ochiq turgan,
  saqlanmagan ish va boshqa sessiyalar bezovta qilinmaydi.
- Nusxadagi `node_modules` — asl loyihanikiga ulanma: tekshiruv (tsc, test) ishlaydi, lekin kutubxona o'rnatish va o'chirish yopiq.
- Dvigatel — Claude Code (Agent SDK), egasining obunasida. Egasining Claude Code sozlamalari va plaginlari yuklanmaydi.
- Bir vaqtda bitta ish; qabul kutayotganlar bir nechta bo'lishi mumkin.

## Yopiq (kodda, `server/dev/guard.ts`)

- push, deploy, release, publish, ssh/scp — mijozlarga chiqarishni egasi o'zi qiladi;
- `npm install/ci`, `node_modules` ni o'chirish;
- `.env`, kalitlar, baza fayllari;
- git'ning umumiy qismi: stash, boshqa shoxlarni o'chirish, sozlama (ish nusxasi va asl loyihada bitta);
- butun papkani yoki nusxadan tashqarini o'chirish (`rm -rf *`, `rm -rf ..`);
- jarayonlarni nomi bo'yicha o'ldirish, tizim sozlamalari;
- ish nusxasidan tashqariga yozish.

Bu — xatodan himoya, qamoq emas: ish egasining kompyuterida, egasining topshirig'i bilan boradi. Topshiriq egasining o'z gapi
bo'lmasa (rasm, mijoz xabari, jadval) — avval Telegram'da «Kodda ish boshlaymi?» so'raladi.

## Sinov

- `npm run test:dasturchi` — haqiqiy git, soxta Claude.
- `npx tsx scripts/live-dasturchi.ts` — haqiqiy Claude obunasi bilan, vaqtinchalik loyihada.

## Bilib qo'ying

- Palantir'ning o'z sozlamalari va sirlari (bot tokeni, baza papkasi, port, Hub kalitlari) Dasturchi muhitiga o'tmaydi: ish nusxasida
  `npm run dev` jonli baza va jonli bot bilan ishga tushib ketmaydi.
- Server ish paytida qayta ishga tushsa — qilingani yo'qolmaydi: ish «qaror kutyapti» holatiga o'tadi va egasiga tugmalar bilan xabar keladi.
- Commit bo'lmasa (loyihaning pre-commit hook'i yiqilsa) — «Qabul qilish» rad etiladi, ish joyida qoladi.
- Loyihada o'zingiz boshlagan, tugallanmagan merge bo'lsa — «Qabul qilish» unga tegmaydi, avval uni tugatishni so'raydi.
- Hisobot va tugmalar faqat Telegram'da: egasi Telegram'ni ulamagan bo'lsa ish boshlanmaydi.

## Yig'ish (exe)

«✅ Qabul qilish» dan keyin javob ostida **📦 Yig'ish (exe)** tugmasi chiqadi (yoki Palantir'ga «DentaLocal'ni yig'» deng). O'rnatuvchi
fonda yig'ilib, **ish stoliga** qo'yiladi — o'sha nomdagi eski fayl almashtiriladi — va **Telegram'ga ham** hujjat bo'lib keladi.
Mijozga yuborish — egasining ishi.

Buyruq modeldan emas, faqat Palantir `.env` dan olinadi (loyiha fayllaridan ham emas — ularni Dasturchi o'zgartira oladi):

```
DEV_BUILD_DENTALOCAL=cd backend && npm run bundle && cd .. && npm run electron:build
DEV_OUT_DENTALOCAL=dist-electron\*.exe
DEV_BUILD_XCLINIC=npm run electron:build
DEV_OUT_XCLINIC=dist-electron\*.exe
```

- Nom — loyiha nomi katta harfda, belgisiz (`X Clinic` → `XCLINIC`). `DEV_BUILD_…` yo'q loyihada tugma chiqmaydi.
- Yig'ish loyihaning o'z papkasida, papkaning **hozirgi holati** bilan boradi (ish nusxasida git'ga kirmaydigan resurslar yo'q).
- Bir vaqtda bitta yig'ish; to'xtatish — «⏹ To'xtatish» yoki `/toxta`. Chegara — `DEV_BUILD_MINUTES` (40).
- Yiqilsa — chiqishning oxirgi qatorlari va to'liq jurnal yo'li (`data/dasturchi/yigish-….log`) keladi.
- Boshqa joyga qo'yish: `DEV_DELIVER_DIR`.
- Telegram'ga yuborish: 50 MB gacha — oddiy bot orqali; kattasi (o'rnatuvchi odatda 130 MB+) — o'sha botning o'zi nomidan to'g'ridan-to'g'ri
  (`server/inbox/bigFile.ts`, 2 GB gacha). Buning uchun `.env` da `TG_API_ID` va `TG_API_HASH` bo'lishi kerak (qo'ng'iroqlar uchun kiritilgan
  bo'lsa — yetarli). Yuborilmasa sababi aytiladi, fayl baribir ish stolida. Jonli sinov: `tsx scripts/live-bigfile.ts <fayl>`.
