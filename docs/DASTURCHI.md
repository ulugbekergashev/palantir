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
