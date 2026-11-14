/**
 * Mijoz bosqichi o'zi o'zgaradigan joylar (server/stages.ts, G3) — AI'siz:
 *   «Yo'qotildi»dagi mijoz yana o'zi bog'lansa — faol ro'yxatga qaytadi; «Mijoz bo'ldi» o'zgarmaydi;
 *   DentaCRM'da kelgan (Completed / Checked-In) yoki to'lagan bemor — «Mijoz bo'ldi»; kelmagan, bekor qilgan — yo'q; boshqa biznes — tegilmaydi;
 *   uch marta yozildi, javob yo'q — «Yo'qotildi» (avtomatik «yetkazildi» xabari sanalmaydi; egasi keyingi qadam qo'ygan, yaqinda gaplashilgan — yo'q).
 * Ishga tushirish: npm run test:stages
 */
import './isolate';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { businesses, inbox, leads } = await import('../server/db');
const { emptyBusiness } = await import('../server/validate');
const { hashPassword } = await import('../server/auth');
const { env } = await import('../server/env');
const { revive, markVisited, giveUpSilent, customerWrote, wantsNoMessages } = await import('../server/stages');
const { optOuts } = await import('../server/serviceStore');
const { planText, SILENT_LIMIT } = await import('../server/plan');
const { holdLine } = await import('../server/inbox/hold');

let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}

const biz = businesses.create('bosqich', hashPassword('sinov-parol-1'), emptyBusiness('Tabassum', 'Stomatologiya'));
const other = businesses.create('boshqa', hashPassword('sinov-parol-2'), emptyBusiness('Boshqa', 'Stomatologiya'));
const lead = (stage: 'new' | 'contacted' | 'won' | 'lost', patientId: string | null = null, b = biz) => {
  const l = leads.add(b.id, { name: `Mijoz ${stage}`, phone: null, note: null, source: 'bot' });
  leads.update(b.id, l.id, { stage });
  if (patientId) leads.setPatient(b.id, l.id, patientId);
  return leads.get(b.id, l.id)!;
};
const stageOf = (id: string, b = biz) => leads.get(b.id, id)?.stage;
/** Ikkinchi ulanish: kartani «N kun oldin» qilish (inbox.add biz yozganda updated_at ni hozirga qo'yadi) */
const raw = new DatabaseSync(env.dbFile);
raw.exec('PRAGMA busy_timeout = 5000');
const age = (id: string, days: number) => raw.prepare('UPDATE leads SET updated_at = ?, last_inbound_at = NULL WHERE id = ?').run(new Date(Date.now() - days * 86_400_000).toISOString(), id);
const says = (id: string, direction: 'in' | 'out', text = direction === 'in' ? 'salom' : 'qalaysiz?') =>
  inbox.add(biz.id, { leadId: id, channel: 'bot', direction, by: direction === 'in' ? 'customer' : 'palantir', text });

console.log("\n# Yo'qotilgan mijoz yana bog'landi");
check("«Yo'qotildi» → «Gaplashildi» (faol ro'yxatga qaytdi)", () => {
  const l = lead('lost');
  assert.equal(revive(biz, l).stage, 'contacted');
  assert.equal(stageOf(l.id), 'contacted');
});
check("«Mijoz bo'ldi», «Yangi», «Gaplashildi» — o'zgarmaydi", () => {
  for (const s of ['won', 'new', 'contacted'] as const) {
    const l = lead(s);
    assert.equal(revive(biz, l).stage, s);
    assert.equal(stageOf(l.id), s);
  }
});

console.log("\n# DentaCRM: kelgan yoki to'lagan bemor");
const appt = (patientId: string, status: string) => ({ id: `a-${patientId}-${status}`, patientId, patientName: 'Bemor', doctorId: 'd1', doctorName: 'Rustam', type: "Ko'rik", date: '2026-11-13', time: '10:00', duration: 30, status, notes: null });
check("kelgan (Completed, Checked-In) — «Mijoz bo'ldi»; kelmagan, bekor qilgan, kutilayotgan — yo'q", () => {
  const came = lead('contacted', 'p1'), checkedIn = lead('lost', 'p2'), noShow = lead('contacted', 'p3'), cancelled = lead('new', 'p4'), pending = lead('contacted', 'p5');
  const n = markVisited(biz, { appointments: [appt('p1', 'Completed'), appt('p2', 'Checked-In'), appt('p3', 'No-Show'), appt('p4', 'Cancelled'), appt('p5', 'Pending')] });
  assert.equal(n, 2);
  assert.deepEqual([came, checkedIn, noShow, cancelled, pending].map(l => stageOf(l.id)), ['won', 'won', 'contacted', 'new', 'contacted']);
});
check("to'lagan bemor (Paid) — «Mijoz bo'ldi»; to'lanmagani yo'q", () => {
  const paid = lead('contacted', 'p6'), unpaid = lead('contacted', 'p7');
  const tx = (patientId: string, status: string) => ({ id: `t-${patientId}`, patientName: 'Bemor', patientId, amount: 100_000, type: 'Cash', service: null, status, doctorId: null, doctorName: null });
  markVisited(biz, { appointments: [], transactions: [tx('p6', 'Paid'), tx('p7', 'Pending')] });
  assert.deepEqual([stageOf(paid.id), stageOf(unpaid.id)], ['won', 'contacted']);
});
check("allaqachon «Mijoz bo'ldi» — qayta sanalmaydi; boshqa biznesning shu id'li bemori — tegilmaydi", () => {
  const mine = lead('won', 'p8'), theirs = lead('contacted', 'p8', other);
  assert.equal(markVisited(biz, { appointments: [appt('p8', 'Completed')] }), 0);
  assert.equal(stageOf(mine.id), 'won');
  assert.equal(stageOf(theirs.id, other), 'contacted');
});

console.log('\n# Javob bermayotgan mijoz');
const NOW = new Date();
check(`${SILENT_LIMIT} marta yozildi, javob yo'q, jim — «Yo'qotildi»`, () => {
  const l = lead('contacted');
  says(l.id, 'in');
  for (let i = 0; i < SILENT_LIMIT; i++) says(l.id, 'out');
  age(l.id, 3);
  assert.deepEqual(giveUpSilent(biz, NOW, 1).map(x => x.id), [l.id]);
  assert.equal(stageOf(l.id), 'lost');
});
check(`${SILENT_LIMIT - 1} marta — hali yo'q; oxirida mijoz yozgan — yo'q`, () => {
  const fewer = lead('contacted'), answered = lead('contacted');
  for (let i = 0; i < SILENT_LIMIT - 1; i++) says(fewer.id, 'out');
  for (let i = 0; i < SILENT_LIMIT; i++) says(answered.id, 'out');
  says(answered.id, 'in');
  age(fewer.id, 3);
  age(answered.id, 3);
  assert.deepEqual(giveUpSilent(biz, NOW, 1), []);
  assert.deepEqual([stageOf(fewer.id), stageOf(answered.id)], ['contacted', 'contacted']);
});
check("avtomatik «xodimiga yetkazildi» xabari javob kutayotgan uchtalikka kirmaydi", () => {
  const l = lead('contacted');
  says(l.id, 'in');
  says(l.id, 'out', holdLine('Tabassum'));
  for (let i = 0; i < SILENT_LIMIT - 1; i++) says(l.id, 'out');
  age(l.id, 3);
  assert.deepEqual(giveUpSilent(biz, NOW, 1), []);
  assert.equal(stageOf(l.id), 'contacted');
});
check("egasi keyingi qadam qo'ygan yoki hali jim emas (bugun yozilgan) — tegilmaydi; «Yangi» ham", () => {
  const planned = lead('contacted'), recent = lead('contacted'), fresh = lead('new');
  for (const l of [planned, recent, fresh]) for (let i = 0; i < SILENT_LIMIT; i++) says(l.id, 'out');
  leads.update(biz.id, planned.id, { nextStep: "qo'ng'iroq", nextAt: '2026-12-01T10:00' });
  age(planned.id, 3);
  age(fresh.id, 3);
  assert.deepEqual(giveUpSilent(biz, NOW, 1), []);
  assert.deepEqual([stageOf(planned.id), stageOf(recent.id), stageOf(fresh.id)], ['contacted', 'contacted', 'new']);
});
check("ertalabki rejada aytiladi: nechta mijoz «Yo'qotildi»ga o'tdi va qaytishi", () => {
  const plan = planText({ now: NOW, ownerName: '', profile: { kind: 'clinic', customer: { one: 'bemor', many: 'bemorlar' }, followDays: 1 } as never, tasks: [], leads: [],
    repliesPending: 0, outboundDrafts: 0, crmLines: [], holidays: [], week: null, recall: 0, autoPrep: true, gaveUp: 2 });
  assert.ok(plan?.html.includes(`2 ta bemor</b> ${SILENT_LIMIT} marta yozganimizga javob bermadi`), plan?.html ?? 'reja yo\'q');
  assert.ok(plan?.html.includes("ro'yxatga qaytadi"));
});

console.log('\n# «Boshqa yozmang» (E10)');
check("iboralar: yozmang / bezovta qilmang / не пишите — ha; «qo'ng'iroq qilmang», «yozing» — yo'q", () => {
  for (const t of ['Boshqa yozmang', "Iltimos bezovta qilmang", 'xabar yubormanglar', 'Не пишите мне больше', 'не беспокойте', 'Ёзманг илтимос'])
    assert.ok(wantsNoMessages(t), t);
  for (const t of ["Qo'ng'iroq qilmang, yozing", 'Ertaga yozing', 'Напишите завтра', 'yozmoqchi edim'])
    assert.ok(!wantsNoMessages(t), t);
});
check("«yozmang» — belgi va «Yo'qotildi»; keyin o'zi yozsa — belgi olinadi, «Gaplashildi»", () => {
  const l = lead('contacted');
  assert.equal(customerWrote(biz, l, 'Boshqa yozmang').stage, 'lost');
  assert.ok(optOuts.has(biz.id, l.id));
  assert.equal(customerWrote(biz, leads.get(biz.id, l.id)!, 'Salom, narxi qancha?').stage, 'contacted');
  assert.ok(!optOuts.has(biz.id, l.id));
});

raw.close();
console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
