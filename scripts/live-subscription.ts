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

// Obuna limiti: haqiqiy javoblardan ulush va yangilanish vaqti o'qildimi (subscription/pressure.ts)
const { busiestShare, laneOpen, notePressure, resetPressure } = await import('../server/subscription/pressure');
const share = busiestShare();
console.log(`\n6) obuna limiti: eng band oyna ${share === null ? "noma'lum" : `${Math.round(share * 100)}%`} · fondagi ishlar ${laneOpen('background') ? 'ishlaydi' : 'kutyapti'}`);
assert.notEqual(share, null, "obuna javobidan limit ulushi o'qilmadi");

// Limit tugaganda bemorga javob Gemini zaxirasida (kalit .env da bo'lsa; faqat GEMINI_API_KEY o'qiladi)
const { existsSync, readFileSync } = await import('node:fs');
const { parseEnv } = await import('node:util');
const { env } = await import('../server/env');
env.geminiKey ||= (existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')).GEMINI_API_KEY : '') ?? '';
if (env.geminiKey) {
  notePressure({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: Math.floor(Date.now() / 1000) + 3600 });
  const t5 = Date.now();
  const g = await decide(biz, lead, thread);
  console.log(`\n7) ${((Date.now() - t5) / 1000).toFixed(1)} s → limit tugagan, Gemini (${env.geminiTextModel}) javobi: ${g.action} — ${g.reply || g.question || g.noteForOwner}`);
  assert.ok(['reply', 'ask_owner', 'ignore'].includes(g.action), `kutilmagan qaror: ${g.action}`);
  resetPressure();
} else console.log("\n7) GEMINI_API_KEY yo'q — Gemini zaxirasi tekshiruvi o'tkazib yuborildi");

// Limit tufayli keyinga qolgan gap: navbat ochilganda Palantir o'zi bajaradi (scheduler.ts runDeferred)
const { deferred } = await import('../server/subscription/deferred');
const { runDeferred } = await import('../server/scheduler');
const { chatLog } = await import('../server/db');
deferred.add({ businessId: biz.id, channel: 'web', text: "Qaysi vazifalarim bor? Bir gapda ayting.", display: '⏰ Kechiktirilgan savol', lane: 'live', until: Date.now() - 1000, own: true });
const t6 = Date.now();
const ran = await runDeferred({ enabled: false } as never);
const last = chatLog.recent(biz.id, 2).at(-1);
console.log(`\n8) ${((Date.now() - t6) / 1000).toFixed(1)} s → kechiktirilgan ish bajarildi: ${ran} ta; javob: ${last?.text ?? "yo'q"}`);
assert.equal(ran, 1, 'kechiktirilgan ish bajarilmadi');
assert.equal(deferred.list(biz.id).length, 0, 'navbatdan olinmadi');
assert.match(String(last?.text), /Akmal/i);

console.log('\nJonli tekshiruv o\'tdi');
// process.exit emas: Windows'da fetch ulanishi yopilayotganda chiqilsa Node yiqiladi (UV_HANDLE_CLOSING) — jarayon o'zi tugaydi
process.exitCode = 0;
