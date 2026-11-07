/**
 * Jonli tekshiruv (PILOT 16): bilimda yo'q savol → Palantir o'ylab topmaydi, egasidan so'raydi → egasi javob beradi va «Eslab qol»
 * bosadi → keyingi bemorga (boshqa so'zlar bilan, boshqa tilda ham) o'zi javob beradi. Haqiqiy model, vaqtinchalik baza.
 * Egasining javobi Telegram'dan emas, o'sha zanjirning o'zi bilan beriladi: suggestAnswer (taklif) → settleSuggestion («Eslab qol»).
 * Obunada (AI_ENGINE=subscription, klinika kabi) — 3 so'rov. API kalit bilan: AI_ENGINE=api npx tsx scripts/live-learn.ts
 * Ishga tushirish: npx tsx scripts/live-learn.ts
 */
import './isolate';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Tashkent';
process.env.AI_ENGINE ||= 'subscription';
if (process.env.AI_ENGINE === 'subscription') {
  // Obunada pullik API'ga hech narsa ketmasin: kalit bo'lmasa, API kerak bo'lgan yo'l jim pul sarflamay xato beradi
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
}

const { businesses, inbox, leads } = await import('../server/db');
const { emptyBusiness } = await import('../server/validate');
const { updateAbout } = await import('../server/setup/about');
const { decide } = await import('../server/inbox/replier');
const { suggestAnswer } = await import('../server/brain/index');
const { settleSuggestion } = await import('../server/brain/learn');

const profile = {
  ...emptyBusiness('Shifo Dent', 'stomatologiya'), ownerName: 'Aziz', phone: '+998 71 200 00 00', address: 'Toshkent, Chilonzor 5',
  offerings: [{ id: 'o1', name: 'Implant', price: 5_000_000 }, { id: 'o2', name: 'Tish tozalash', price: 250_000 }],
};
const biz = businesses.create(`bilim${Date.now()}`, 'x', profile);
updateAbout(biz.id, [['Telefon', profile.phone], ['Manzil', profile.address], ['Ish vaqti', 'Du–Sh 9:00–20:00']]);

/** Yangi bemor (Instagram) bitta xabar yozadi — Palantir qarori */
async function patientAsks(text: string) {
  const lead = leads.add(biz.id, { name: null, phone: null, note: null, source: 'Instagram' });
  inbox.add(biz.id, { leadId: lead.id, channel: 'instagram', direction: 'in', by: 'customer', text, at: new Date().toISOString() });
  const t0 = Date.now();
  const d = await decide(businesses.byId(biz.id)!, leads.get(biz.id, lead.id)!, inbox.thread(biz.id, lead.id, 30));
  console.log(`\n«${text}»\n  ${((Date.now() - t0) / 1000).toFixed(1)} s → ${d.action}: ${d.reply}${d.question ? `\n  egasiga savol: «${d.question}»` : ''}${d.noteForOwner ? `\n  izoh: ${d.noteForOwner}` : ''}`);
  return d;
}

const ANSWER = "Ha, bolalar uchun umumiy narkoz bor: anesteziolog bilan, narxi 1 500 000 so'm, oldindan yoziladi.";
const PRICE = /1[\s  ,.]?500[\s  ,.]?000|1[,.]5 ?(mln|млн)/i;

// 1. Bilimda yo'q — o'ylab topmaydi, egasidan umumiy savol bo'lib so'raydi
const first = await patientAsks('Sizda bolalar uchun narkoz bormi?');
assert.equal(first.action, 'ask_owner', `bilimda yo'q savolga o'zi javob berdi: «${first.reply}»`);
assert.doesNotMatch(first.reply, PRICE, 'narx o\'ylab topildi');
assert.ok(first.question.trim().length >= 5, "egasiga umumiy savol bo'lib bormadi — javobi bilimga yozilmaydi");

// 2. Egasi javob beradi va «Eslab qol» bosadi
const suggestion = suggestAnswer(businesses.byId(biz.id)!, first.question, ANSWER);
assert.ok(suggestion, "egasining javobi taklif bo'lib saqlanmadi");
const settled = settleSuggestion(businesses.byId(biz.id)!, suggestion.id, true);
console.log(`\nEgasi: «${ANSWER}» → ${settled?.split('\n')[0]}`);
assert.ok(settled?.startsWith('🧠'), 'bilimga yozilmadi');

// 3. Keyingi bemor boshqa so'zlar bilan — endi o'zi javob beradi, egasi aytgan narx bilan
const second = await patientAsks("Bolalarni narkoz bilan davolaysizlarmi? Qancha turadi?");
assert.equal(second.action, 'reply', `bilimdagi savolga o'zi javob bermadi (${second.action}): ${second.noteForOwner}`);
assert.match(second.reply, PRICE, "egasi aytgan narx javobda yo'q");

// 4. Ruscha so'rasa ham — o'sha bilimdan, ruscha javob
const third = await patientAsks('Детям делаете лечение под общим наркозом? Сколько стоит?');
assert.equal(third.action, 'reply', `ruscha savolga bilimdan javob bermadi (${third.action}): ${third.noteForOwner}`);
assert.match(third.reply, PRICE, "egasi aytgan narx ruscha javobda yo'q");
assert.match(third.reply, /[а-яё]{4,}/i, 'javob ruscha emas');

console.log("\nBilim zanjiri o'tdi: so'radi → egasi javob berdi → keyingi bemorlarga o'zi javob berdi");
process.exit(0);
