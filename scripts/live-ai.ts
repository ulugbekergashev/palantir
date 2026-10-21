/**
 * Jonli tekshiruv — HAQIQIY Claude bilan (.env dagi ANTHROPIC_API_KEY; bir necha so'rov, oz pul):
 *   1. Mijoz yozishmasidan so'rov chiqadimi: «qo'ng'iroq qiling, raqamim …, oltidan keyin» (o'zbekcha va ruscha), raqamsiz,
 *      shikoyat, qabulni surish, oddiy narx savoli (so'rov bo'lmasligi kerak), «rahmat» (yangi so'rov yo'q).
 *   2. Qo'ng'iroq matnining tahlili (yozuvsiz, tayyor matn bilan).
 * Vaqtinchalik baza (DATA_DIR) — haqiqiy bazaga tegilmaydi. Telegram'ga hech narsa yuborilmaydi.
 * Ishga tushirish: npx tsx scripts/live-ai.ts
 */
process.env.TZ = 'Asia/Tashkent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'palantir-live-'));
process.env.DATA_DIR = dataDir;
process.env.BOT_TOKEN = '';
const { businesses, inbox, leads } = await import('../server/db');
const { emptyBusiness } = await import('../server/validate');
const { decide } = await import('../server/inbox/replier');
const { analyseTranscript } = await import('../server/phone/analysis');
const { cleanDue } = await import('../server/requests/timing');
const { env } = await import('../server/env');

if (!env.aiEnabled) { console.log('ANTHROPIC_API_KEY yo\'q — jonli tekshiruv o\'tkazib yuborildi'); process.exit(0); }
const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? `\n      ${info}` : ''}`); };

const profile = {
  ...emptyBusiness('Shifo Dent', 'stomatologiya'), ownerName: 'Aziz', phone: '+998 71 200 00 00', address: 'Toshkent, Chilonzor 5', hours: 'Du–Sh 9:00–20:00',
  offerings: [{ id: 'o1', name: 'Implant', price: 5_000_000 }, { id: 'o2', name: 'Tish tozalash', price: 250_000 }],
} as ReturnType<typeof emptyBusiness>;
const biz = businesses.create('live', 'x', profile);

async function chat(name: string, lines: [('in' | 'out'), string][]) {
  const lead = leads.add(biz.id, { name: null, phone: null, note: null, source: 'Instagram' });
  const t0 = Date.now() - lines.length * 60_000;
  lines.forEach(([dir, text], i) => inbox.add(biz.id, { leadId: lead.id, channel: 'instagram', direction: dir, by: dir === 'in' ? 'customer' : 'palantir', text, at: new Date(t0 + i * 60_000).toISOString() }));
  const d = await decide(biz, leads.get(biz.id, lead.id)!, inbox.thread(biz.id, lead.id, 30));
  const req = d.request ? `${d.request.kind} | tel «${d.request.phone}» | vaqt «${d.request.whenText}» ${d.request.dueAt} | ${d.request.summary}` : 'so\'rov yo\'q';
  return { d, info: `${name}: ${d.action} — «${d.reply.slice(0, 140)}»\n      so'rov: ${req}` };
}

console.log('\n# Yozishmadan so\'rov (haqiqiy Claude)');
let r = await chat('uz', [['in', "Assalomu alaykum, implant qancha turadi? Menga qo'ng'iroq qiling iltimos, 90 123 45 67, soat oltidan keyin"]]);
ok("o'zbekcha «qo'ng'iroq qiling + raqam + oltidan keyin» → callback, raqam, 18:00", r.d.request?.kind === 'callback' && r.d.request.phone.replace(/\D/g, '').endsWith('901234567') && r.d.request.dueAt.endsWith('T18:00') && !!cleanDue(r.d.request.dueAt), r.info);
r = await chat('ru', [['in', 'Здравствуйте! Перезвоните мне на этот номер +998 93 555 66 77, хочу записаться на чистку']]);
ok('ruscha «перезвоните на этот номер» → callback, raqam', r.d.request?.kind === 'callback' && r.d.request.phone.replace(/\D/g, '').endsWith('935556677'), r.info);
r = await chat('raqamsiz', [['in', "Qo'ng'iroq qilsangiz bo'ladimi? Gaplashib olaylik"]]);
ok("raqamsiz «qo'ng'iroq qiling» → callback (raqam bo'sh), javobda raqam so'raladi", r.d.request?.kind === 'callback' && !r.d.request.phone, r.info);
r = await chat('narx', [['in', 'Tish tozalash qancha turadi?']]);
ok('oddiy narx savoli → so\'rov yo\'q, narx profildan (250 000)', !r.d.request && r.d.reply.replace(/\s/g, '').includes('250000'), r.info);
r = await chat('shikoyat', [['in', "Kecha plomba qo'ydirdim, bugun juda og'riyapti, shifokoringiz yaxshi qilmadi"]]);
ok('shikoyat / og\'riq → complaint (yoki egasidan so\'rash), tashxis yo\'q', r.d.request?.kind === 'complaint' && r.d.action === 'ask_owner', r.info);
r = await chat('surish', [['in', "Ertaga 15:00 ga yozilgan edim, payshanbaga o'tkazsa bo'ladimi?"]]);
ok('qabulni surish → change', r.d.request?.kind === 'change', r.info);
r = await chat('rahmat', [['in', "Qo'ng'iroq qiling: 90 123 45 67"], ['out', "Albatta, administratorimiz sizga qo'ng'iroq qiladi."], ['in', 'Rahmat']]);
ok("«rahmat» (so'rov oldin qilingan) → yangi so'rov yo'q", !r.d.request, r.info);

console.log('\n# Qo\'ng\'iroq matni tahlili (haqiqiy Claude)');
const transcript = [
  '[0:01] 1-ovoz: Assalomu alaykum, Shifo Dent klinikasi, Aziza eshitaman.',
  "[0:04] 2-ovoz: Assalomu alaykum, men Instagram'da yozgan edim, implant narxini bilmoqchiman.",
  "[0:09] 1-ovoz: Implant 5 million so'mdan boshlanadi, avval ko'rik kerak. Ismingiz nima?",
  "[0:14] 2-ovoz: Malika. Ko'rikka qachon borsam bo'ladi?",
  "[0:17] 1-ovoz: Ertaga soat 11:00 da Rustam Rustamovda bo'sh joy bor. Yozib qo'yaymi?",
  "[0:21] 2-ovoz: Ha, yozib qo'ying. Lekin bo'lib to'lash bormi?",
  "[0:24] 1-ovoz: Buni aniqlab, sizga bugun kechqurun qayta qo'ng'iroq qilaman.",
  '[0:28] 2-ovoz: Yaxshi, rahmat.',
].join('\n');
const f = await analyseTranscript(biz, transcript, true, { direction: 'in', startedAt: Date.now() - 60_000, durationSec: 32, phone: '+998901234567' });
ok("tahlil: ismi Malika, natija — kelishildi (ertaga 11:00), keyingi qadam — bo'lib to'lash bo'yicha qayta qo'ng'iroq", f.analysis.customerName.includes('Malika') && f.analysis.outcome === 'booked' && /11/.test(f.analysis.agreed) && f.request?.kind === 'callback',
  `${f.analysis.summary}\n      natija: ${f.analysis.outcome} — ${f.analysis.agreed}\n      keyingi: ${f.analysis.nextStep}\n      so'rov: ${f.request ? `${f.request.kind} — ${f.request.summary} ${f.request.dueAt}` : "yo'q"}\n      xodim: ${f.analysis.score}/10 — ${f.analysis.staffNote}`);

console.log('\n# Mavjud qabulni ko\'chirish va bekor qilish (haqiqiy Claude + soxta DentaCRM)');
const { crm, crmServer, CRM_LOGIN } = await import('./fakeCrm');
const { listen } = await import('./fakes');
const { connectCrm } = await import('../server/crm/index');
const { proofFor } = await import('../server/personRules');
const { iso } = await import('../src/lib/week');
const crmPort = await listen(crmServer);
const tomorrow = iso(new Date(Date.now() + 86_400_000));
crm.seed(iso(new Date()), tomorrow);
crm.appointments.push({ id: 'up1', patientId: 'p4', patientName: 'Dilnoza Karimova', doctorId: 'd1', doctorName: 'Rustam Rustamov', type: "Ko'rik", date: tomorrow, time: '11:00', duration: 30, status: 'Pending', notes: null, clinicId: 'c1', reminderSent: false });
const clinic = businesses.create('live-clinic', 'x', profile);
await connectCrm(clinic, { url: `http://127.0.0.1:${crmPort}`, ...CRM_LOGIN });
// Bemor botda o'z raqamini tugma bilan yuborgan (Telegram tasdiqlagan): faqat shunda qabullarini ko'radi va o'zgartira oladi
let patientTg = 9000;
async function patientChat(text: string) {
  const tg = String(++patientTg), phone = '+998944445566';
  const lead = leads.fromTelegram(clinic.id, tg, 'Dilnoza Karimova', null, 'Telegram havola', null);
  leads.update(clinic.id, lead.id, { phone, phoneProof: proofFor(tg, phone) });
  leads.setPatient(clinic.id, lead.id, 'p4');
  inbox.add(clinic.id, { leadId: lead.id, channel: 'bot', direction: 'in', by: 'customer', text });
  const d = await decide(clinic, leads.get(clinic.id, lead.id)!, inbox.thread(clinic.id, lead.id, 30));
  return { d, info: `${d.action} — «${d.reply.slice(0, 160)}» · o'zgarish: ${d.change ? `${d.change.kind} ${d.change.appointmentId} ${d.change.date} ${d.change.time}` : "yo'q"}` };
}
let v = await patientChat("Assalomu alaykum, ertangi qabulimni soat 15:00 ga o'tkazsa bo'ladimi?");
ok("«ertangi qabulni 15:00 ga o'tkazing» → reschedule: o'sha qabul (up1), ertaga 15:00", v.d.action === 'reschedule' && v.d.change?.appointmentId === 'up1' && v.d.change.date === tomorrow && v.d.change.time === '15:00', v.info);
v = await patientChat('Ertangi qabulni bekor qilmoqchiman, kela olmayman');
ok("«bekor qiling» → cancel_visit: up1", v.d.action === 'cancel_visit' && v.d.change?.appointmentId === 'up1', v.info);
v = await patientChat('Qabulim qachon edi? Eslolmayapman');
ok("«qabulim qachon?» → javob qabuldan (11:00), hech narsa o'zgartirilmaydi", !v.d.change && v.d.reply.includes('11:00'), v.info);

try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* band */ }
const failed = results.filter(x => !x).length;
console.log(`\n${failed ? `✗ ${failed} ta tekshiruv o'tmadi` : `✓ hammasi o'tdi (${results.length})`} — haqiqiy Claude (${env.aiModel})`);
process.exit(failed ? 1 : 0);
