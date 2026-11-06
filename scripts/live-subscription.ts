/**
 * Jonli tekshiruv: shu kompyuterdagi Claude obunasi orqali (AI_ENGINE=subscription, API kalitsiz — klinika o'z obunasida kabi) —
 * yordamchi asbob bilan vazifa yaratadimi, suhbatni davom ettiradimi, asbobsiz matn (post matni) yozadimi, mijozga javob (JSON)
 * tayyorlaydimi va rasmni ko'radimi. Vaqtinchalik bazada (haqiqiy ma'lumotga tegmaydi).
 * Kompyuterda `claude` ga /login qilingan bo'lishi kerak. Obuna limitidan bir necha so'rov sarflanadi.
 * Ishga tushirish: npx tsx scripts/live-subscription.ts
 */
import './isolate';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

process.env.AI_ENGINE = 'subscription';
process.env.AI_EFFORT_OWNER = 'low';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const { ask } = await import('../server/agent');
const { businesses, leads, tasks } = await import('../server/db');
const { writeCaption } = await import('../server/marketing/posts');
const { decide } = await import('../server/inbox/replier');
const { describePhoto } = await import('../server/vision');

const biz = businesses.create(`jonli${Date.now()}`, 'x', { name: 'Palantir', ownerName: "Ulug'bek", industry: 'dasturiy taʼminot', phone: '', address: 'Toshkent', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);

const t0 = Date.now();
const first = await ask(biz.id, 'web', "Ertaga soat 10:00 da Akmalga qo'ng'iroq qilishni eslatib qo'y");
console.log(`\n1) ${((Date.now() - t0) / 1000).toFixed(1)} s → ${first.failed ? 'XATO: ' : ''}${first.text}`);
assert.equal(first.failed, undefined, first.text);
const made = tasks.list(biz.id);
console.log(`   vazifalar: ${made.map(t => `${t.title} @ ${t.dueAt}`).join(' | ')}`);
assert.ok(made.length >= 1, 'vazifa yaratilmadi');

const t1 = Date.now();
const second = await ask(biz.id, 'web', 'Hozir qanday vazifalarim bor?');
console.log(`\n2) ${((Date.now() - t1) / 1000).toFixed(1)} s → ${second.failed ? 'XATO: ' : ''}${second.text}`);
assert.equal(second.failed, undefined, second.text);
assert.match(second.text, /Akmal/i, 'suhbat yoki asbob natijasi javobda yo\'q');

const t2 = Date.now();
const caption = await writeCaption(biz, "Palantir — klinika uchun AI yordamchi: qo'ng'iroqlarni yozadi, bemorlarga eslatadi");
console.log(`\n3) ${((Date.now() - t2) / 1000).toFixed(1)} s → post matni:\n${caption}`);
assert.ok(caption.length > 40);

// Mijozga javob (JSON shakli) — klinika faqat o'z obunasi bilan (API kalitsiz)
const lead = leads.add(biz.id, { name: null, phone: null, note: null, source: 'Instagram' });
const thread = [{ id: 'm1', leadId: lead.id, channel: 'instagram' as const, direction: 'in' as const, by: 'customer' as const, text: 'Assalomu alaykum, ish vaqtingiz qanday?', createdAt: new Date().toISOString() }];
const t3 = Date.now();
const d = await decide(biz, lead, thread);
console.log(`\n4) ${((Date.now() - t3) / 1000).toFixed(1)} s → mijozga javob: ${d.action} — ${d.reply || d.question || d.noteForOwner}`);
assert.ok(['reply', 'ask_owner', 'ignore'].includes(d.action), `kutilmagan qaror: ${d.action}`);

// Rasmni ko'rish (rasm bloki) — ffmpeg bilan qizil sinov rasmi
const jpeg = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120', '-frames:v', '1', '-f', 'mjpeg', 'pipe:1']).stdout;
if (jpeg?.length) {
  const t4 = Date.now();
  const seen = await describePhoto(biz.id, jpeg, 'Bu qanday rang?');
  console.log(`\n5) ${((Date.now() - t4) / 1000).toFixed(1)} s → rasm: ${seen}`);
  assert.match(seen, /qizil|red|красн/i, "rasm ko'rilmadi");
} else console.log("\n5) ffmpeg yo'q — rasm tekshiruvi o'tkazib yuborildi");

console.log('\nJonli tekshiruv o\'tdi');
process.exit(0);
