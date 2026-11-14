/**
 * Bemorga javob navbati (server/inbox/core.ts: flushDue) — AI'siz:
 *   «o'zi javob bersin» kechikib yuboradigan javob (scheduled) — vaqti kelganda yuboriladi;
 *   javob tayyorlangandan keyin bemor yana yozgan bo'lsa — eski javob yuborilmaydi (aks holda yangi savol «javob berilgan» bo'lib,
 *   javobsiz qolardi — E5), «eskirdi» bo'ladi; faqat rasm/stiker kelgan bo'lsa — yuboriladi (unga javob kerak emas).
 * Ishga tushirish: npm run test:inbox
 */
import './isolate';
import assert from 'node:assert/strict';

const { businesses, inbox, leads, replies } = await import('../server/db');
const { emptyBusiness } = await import('../server/validate');
const { hashPassword } = await import('../server/auth');
const { flushDue, registerSender, onIncoming } = await import('../server/inbox/core');
const { mediaLabel } = await import('../server/inbox/media');

let failed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}

const biz = businesses.create('navbat', hashPassword('sinov-parol-1'), emptyBusiness('Tabassum', 'Stomatologiya'));
const sentTo: { lead: string; text: string }[] = [];
const capture = { can: () => true, send: async (_b: unknown, lead: { id: string }, text: string) => { sentTo.push({ lead: lead.id, text }); return null; } };
registerSender('telegram', capture);
registerSender('bot', capture);
let seq = 0;
const tick = () => new Promise(r => setTimeout(r, 5));
/** Bemor yozdi, «o'zi javob bersin» javobi tayyorlandi (vaqti o'tgan), keyin — after (bemorning keyingi xabarlari) */
async function scenario(after: string[], channel: 'telegram' | 'bot' = 'telegram', overdueMs = 1000): Promise<{ leadId: string; replyId: string }> {
  const { lead } = leads.fromChannel(biz.id, channel, { tgUserId: `u${++seq}`, name: `Bemor ${seq}`, username: null }, 'Telegram');
  inbox.add(biz.id, { leadId: lead.id, channel, direction: 'in', by: 'customer', text: 'Ish vaqtingiz qanday?' });
  await tick();
  const r = replies.create(biz.id, { leadId: lead.id, channel, text: '9:00 dan 18:00 gacha', status: 'scheduled', note: null, dueAt: new Date(Date.now() - overdueMs).toISOString() });
  for (const text of after) { await tick(); inbox.add(biz.id, { leadId: lead.id, channel, direction: 'in', by: 'customer', text }); }
  return { leadId: lead.id, replyId: r.id };
}
const statusOf = (id: string) => replies.get(biz.id, id)?.status;

console.log("\n# «O'zi javob bersin»: kechikib yuboriladigan javob");
await check('bemor boshqa yozmadi — vaqti kelganda yuboriladi', async () => {
  const s = await scenario([]);
  await flushDue();
  assert.equal(statusOf(s.replyId), 'sent');
  assert.ok(sentTo.some(m => m.lead === s.leadId && m.text.includes('18:00')));
});
await check("bemor yana savol yozdi — eski javob yuborilmaydi («eskirdi»), yangi savol javobsiz «javob berilgan» bo'lib qolmaydi (E5)", async () => {
  const s = await scenario(['Manzilingiz qayerda?']);
  await flushDue();
  assert.equal(statusOf(s.replyId), 'obsolete');
  assert.ok(!sentTo.some(m => m.lead === s.leadId));
  assert.equal(inbox.last(biz.id, s.leadId)?.direction, 'in');
});
await check("botda faqat rasm yubordi — javob yuboriladi (rasm egasida, unga javob kerak emas)", async () => {
  const s = await scenario([mediaLabel('rasm')], 'bot');
  await flushDue();
  assert.equal(statusOf(s.replyId), 'sent');
  assert.ok(sentTo.some(m => m.lead === s.leadId));
});
await check("Telegram Business / Instagram'da rasm — yangi xabar (asl nusxasi egasiga bormagan): eski javob yuborilmaydi", async () => {
  const s = await scenario(['[rasm yoki fayl]']);
  await flushDue();
  assert.equal(statusOf(s.replyId), 'obsolete');
  assert.ok(!sentTo.some(m => m.lead === s.leadId));
});

await check("kompyuter o'chiq turgan — javob vaqtidan 2 soat o'tib o'zicha yuborilmaydi, egasiga taklif bo'ladi (E4)", async () => {
  const s = await scenario([], 'telegram', 2 * 3_600_000);
  await flushDue();
  assert.equal(statusOf(s.replyId), 'pending');
  assert.ok(!sentTo.some(m => m.lead === s.leadId));
});

console.log('\n# Xabarning asl vaqti (E4)');
await check("yangi xabar (Telegram vaqti soniyagacha) — hozirgi vaqt: yarim soniya oldingi javobimizdan keyin turadi", async () => {
  const { lead } = leads.fromChannel(biz.id, 'telegram', { tgUserId: 'vaqt1', name: 'Vaqt', username: null }, 'Telegram');
  inbox.add(biz.id, { leadId: lead.id, channel: 'telegram', direction: 'out', by: 'palantir', text: 'Yozdik ✅' });
  onIncoming(biz, { channel: 'telegram', person: { tgUserId: 'vaqt1', name: 'Vaqt', username: null }, text: 'Yana savol', extId: 'v1', source: 'Telegram', at: new Date(Math.floor(Date.now() / 1000) * 1000 - 900).toISOString() });
  assert.equal(inbox.last(biz.id, lead.id)?.text, 'Yana savol');
});
await check("kompyuter o'chiq paytda yozilgan xabar — asl vaqti bilan (3 soat oldin)", async () => {
  const at = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const l = onIncoming(biz, { channel: 'telegram', person: { tgUserId: 'vaqt2', name: 'Kecha', username: null }, text: 'Bugun ochiqmisiz?', extId: 'v2', source: 'Telegram', at });
  assert.equal(inbox.last(biz.id, l.id)?.createdAt, at);
});

console.log("\n# «Eslab qolaymi?» — egasining javobi qaysi savolga (E9)");
const since = () => new Date(Date.now() - 86_400_000).toISOString();
const asked = (leadId: string, question: string | null) =>
  replies.create(biz.id, { leadId, channel: 'telegram', text: 'Aniqlab aytamiz', status: 'pending', note: null, dueAt: null, question });
await check('savol — oxirgi taklif: egasining javobi shu savolga juftlanadi, bir marta', async () => {
  const { lead } = leads.fromChannel(biz.id, 'telegram', { tgUserId: 'savol1', name: 'Savol', username: null }, 'Telegram');
  asked(lead.id, "Bo'lib to'lash bormi?");
  assert.equal(replies.takeQuestion(biz.id, lead.id, since()), "Bo'lib to'lash bormi?");
  assert.equal(replies.takeQuestion(biz.id, lead.id, since()), null);
});
await check("savoldan keyin bemor boshqa narsa so'radi (yangi taklif) — egasining javobi eski savolga juftlanmaydi", async () => {
  const { lead } = leads.fromChannel(biz.id, 'telegram', { tgUserId: 'savol2', name: 'Savol', username: null }, 'Telegram');
  asked(lead.id, "Bo'lib to'lash bormi?");
  await tick();
  asked(lead.id, null);
  assert.equal(replies.takeQuestion(biz.id, lead.id, since()), null);
  // Eski savol ham yopildi: keyingi javob ham unga juftlanmaydi
  assert.equal(replies.takeQuestion(biz.id, lead.id, since()), null);
});

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
