/**
 * Murakkab ishlar — sifatni solishtirish uchun (scripts/eval-hard.ts): brend-buk, video ssenariysi, Instagram posti va egasining
 * yordamchisidan strategiya. Bu yerda «o'tdi/o'tmadi» yo'q — ikki modelning javobini hakam ko'r-ko'rona solishtiradi.
 * brief — hakamga: nima so'ralgan; rubric — nimaga qarab baholash (strategiyada — to'g'ri hisob, hakam raqamlarni shu bilan tekshiradi).
 * Raqamlar o'ylab topilgan «Shifo Dent» klinikasiniki.
 */

export type HardKind = 'brend' | 'video' | 'post' | 'strategiya';
export interface HardCase { id: string; kind: HardKind; title: string; input: string; brief: string; rubric: string }

const CONTENT_RUBRIC = `Judge as the clinic owner's marketing lead would: would you publish this as is?
- Language: natural, correct Uzbek in Latin script (no Cyrillic, no awkward machine translation, no Russian/English words where Uzbek is normal).
- Specific to this clinic and topic, not generic filler that fits any business.
- Honest: no invented statistics, prices, results or guarantees ("painless", "best in the city"); facts only from the given profile.
- Follows the format and limits that were asked for.`;

const VIDEO_RUBRIC = `${CONTENT_RUBRIC}
- Video craft: the hook grabs attention in the first 2 seconds; one idea per scene; on-screen text (max 6 words) makes sense with the sound off; narration sounds natural when spoken aloud; the scenes build to one clear takeaway; background picture descriptions are concrete and filmable; total narration fits 25-35 seconds.`;

export const HARD_CASES: HardCase[] = [
  {
    id: 'brend', kind: 'brend', title: 'Brend-buk',
    input: JSON.stringify({
      whose: 'company',
      what: "Oilaviy stomatologiya: bolalar va kattalar, implant, tish tozalash, plomba, breket. Chilonzorda 8 yildan beri.",
      audience: "Chilonzor va Yunusobodda yashovchi 25-55 yoshli oilalar, ko'pchiligi tish shifokoridan qo'rqadi",
      values: "Halollik: narxni oldindan aytamiz. Shoshilmaymiz. Bolalarga alohida e'tibor.",
      tone: "Iliq, sodda, «siz» bilan, ortiqcha reklama so'zlarisiz",
      avoid: "«eng yaxshi», «og'riqsiz kafolat», chet el so'zlari",
      look: "Toza, yorug', ko'k emas — boshqacha bo'lsin",
    }),
    brief: "A complete brand book (JSON) for a family dental clinic from the owner's questionnaire, for the content maker to follow daily: positioning, personas, voice rules, hooks, colors, visual rules.",
    rubric: `${CONTENT_RUBRIC}
- Strategy: positioning is one plain sentence a patient understands; personas are real segments with pains in their own words; hooks are usable first lines; the brand avoids what the owner asked to avoid (blue look, "eng yaxshi", painless guarantees, foreign words).
- Colors: 6 hex colors that work together, text readable on its surface; the visual motif comes from something real about this clinic, not generic tech.`,
  },
  {
    id: 'video-implant', kind: 'video', title: 'Video: implantdan qo\'rqish',
    input: "Implant qo'yishdan qo'rqadiganlar uchun: jarayon qanday o'tadi, nimadan qo'rqmaslik kerak",
    brief: 'A script (JSON scenes) for a 20-35 second vertical explainer video with a narrator, on: fear of dental implants — how the procedure goes.',
    rubric: VIDEO_RUBRIC,
  },
  {
    id: 'video-bola', kind: 'video', title: 'Video: bolani birinchi marta olib borish',
    input: "Bolani stomatologga birinchi marta qanday olib borish kerak — ota-onalar uchun maslahat",
    brief: "A script (JSON scenes) for a 20-35 second vertical explainer video with a narrator, on: how to bring a child to the dentist for the first time — tips for parents.",
    rubric: VIDEO_RUBRIC,
  },
  {
    id: 'post-oqartirish', kind: 'post', title: 'Instagram posti: oqartirish aksiyasi',
    input: "Noyabr oxirigacha tish oqartirishga 20% chegirma (1 200 000 o'rniga 960 000 so'm). Oldin bepul ko'rik qilamiz — hammaga ham mos emas.",
    brief: 'An Instagram caption plus a picture description for a teeth-whitening promotion (20% off until the end of November, a free check-up first because whitening does not suit everyone).',
    rubric: `${CONTENT_RUBRIC}
- Selling without lying: the price and the deadline are exact; the "not for everyone, check-up first" caveat is kept; a clear call to action.`,
  },
  {
    id: 'strategiya-foyda', kind: 'strategiya', title: 'Strategiya: foydani oshirish',
    input: `Oktyabr oyi raqamlarimiz:
Xizmatlar (soni, narxi, bitta xizmatning materiali/tannarxi):
- Implant: 14 ta, 5 000 000 so'm, tannarx 2 600 000
- Tish tozalash: 120 ta, 250 000, tannarx 60 000
- Plomba: 210 ta, 400 000, tannarx 90 000
- Breket: 6 ta, 9 000 000, tannarx 4 500 000
- Oqartirish: 25 ta, 1 200 000, tannarx 350 000
Shifokorlar tushumning 30% ini oladi.
Doimiy xarajat: ijara 18 mln, 2 administrator 5 mln dan, reklama 12 mln, kommunal 3 mln, boshqa 4 mln.
Reklamadan 180 murojaat keldi, 72 tasi qabulga yozildi, 51 tasi keldi.
Tozalashga kelganlarning 8% i keyingi 3 oyda plomba yoki implantga qaytgan.
3 ta kreslo, bandligi 58%.
Noyabr–yanvar uchun foydani oshirish strategiyasini tuz: qaysi xizmat eng foydali, nimaga pul sarflash kerak, nimani to'xtatish yoki o'zgartirish kerak. Raqamlar bilan.`,
    brief: "The clinic owner gave October's numbers and asked the AI assistant for a November–January strategy to raise profit: which service is most profitable, what to spend on, what to stop or change — with numbers.",
    rubric: `Judge as a sharp financial advisor to a small clinic would.
Reference calculation (verify the answer's numbers against it):
- Revenue 268.0 mln: implant 70.0, cleaning 30.0, filling 84.0, braces 54.0, whitening 30.0.
- Contribution after materials and the doctors' 30%: implant 12.6 mln (18% of its revenue, 0.9 mln per case), cleaning 13.8 (46%), filling 39.9 (47.5%), braces 10.8 (20%), whitening 12.25 (41%). Total 89.35 mln.
- Fixed costs 47 mln (rent 18, admins 10, ads 12, utilities 3, other 4). Profit ≈ 42.35 mln (~16% of revenue).
- Funnel: 180 inquiries → 72 booked (40%) → 51 came; 21 of 72 (29%) did not show up. Ads cost ≈ 67 thousand per inquiry, ≈ 235 thousand per patient who came.
- Chairs are 58% busy: ~42% free capacity, so extra patients add contribution without new fixed costs.
- Cleaning → follow-up treatment is only 8%.
Strong answers: correct numbers; see that filling is the main profit source and implant/braces have thin margins despite big prices (check prices/material costs, do not just push implants); attack the 29% no-shows and the 60% of inquiries that never book (reminders, faster replies) before spending more on ads; use free chair time; raise cleaning → treatment conversion; concrete targets and how to measure them; honest about what the data cannot show. Penalise wrong arithmetic, invented data, generic advice that ignores the numbers, and answers that are too long to act on.`,
  },
  {
    id: 'strategiya-reklama', kind: 'strategiya', title: 'Strategiya: reklama byudjeti',
    input: `Reklamaga oyiga 12 mln so'm sarflayapmiz.
Instagram: 8 mln → 120 murojaat → 30 kishi qabulga keldi.
Telegram: 4 mln → 60 murojaat → 21 kishi keldi.
Keyingi oy ham 12 mln. Qanday taqsimlaymiz va yana nima qilish kerak?`,
    brief: 'The owner gave ad spend and results for Instagram and Telegram and asked how to split the same 12 mln next month and what else to do.',
    rubric: `Judge as a sharp performance-marketing advisor would.
Reference calculation:
- Cost per inquiry is the SAME on both: 8 mln / 120 = 4 mln / 60 ≈ 66.7 thousand.
- Inquiry → visit: Instagram 25% (30/120), Telegram 35% (21/60).
- Cost per patient who came: Instagram ≈ 267 thousand, Telegram ≈ 190 thousand.
Strong answers: notice the cost per inquiry is equal and the difference is in conversion — so the problem may be how Instagram inquiries are handled (reply speed, who answers), not the channel itself; shift budget toward Telegram gradually and test, warning that Telegram may not scale at the same price (diminishing returns); track per-channel numbers weekly; optionally look at revenue per patient by channel, which is missing. Penalise wrong arithmetic, moving the whole budget at once with no test, invented numbers, generic advice.`,
  },
];
