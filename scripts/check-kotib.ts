/**
 * Kotib — ish bo'yicha yozishmalar (server/inbox/workChats.ts), AI'siz va Telegram'siz:
 *   belgilash, keyingi xabarlar (birinchi javobsiz vaqt saqlanadi), egasi javob berdi, 3 soatdan keyin bitta eslatma (bir marta),
 *   kechasi kelgani kunduzgacha kutadi (soat tekshiruvi scheduler'da), kechki xabar qismi, internet yo'q — belgilanmaydi.
 * Ishga tushirish: npm run test:kotib
 */
import './isolate';
import assert from 'node:assert/strict';

const { REMIND_AFTER_MS, reminderMessage, workChats, workEveningHtml, workTick } = await import('../server/inbox/workChats');

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}

const BIZ = 'kotib-biz', T0 = Date.parse('2026-11-16T09:00:00Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
const biz = { id: BIZ, active: true, ownerChatId: '555' };
const sent: { chat: string; html: string; buttons: { text: string; data: string }[][] }[] = [];
const send = async (chat: string, html: string, buttons: { text: string; data: string }[][]) => { sent.push({ chat, html, buttons }); };
const never = () => false;

await check("belgilangan xabardan kuzatuv boshlanadi; begona kontakt — ro'yxatda yo'q", () => {
  workChats.add(BIZ, '901', 'Aziz laboratoriya', { text: 'Kronkalar tayyor, qachon olib ketasiz?', at: at(0) });
  assert.ok(workChats.has(BIZ, '901'));
  assert.ok(!workChats.has(BIZ, '902'));
  assert.equal(workChats.waiting(BIZ).length, 1);
});

await check("yana yozdi — matn oxirgisi, vaqt birinchi javobsiz xabarniki, soni oshadi", () => {
  workChats.incoming(BIZ, '901', null, 'Javob bering iltimos', at(3600_000));
  const w = workChats.get(BIZ, '901')!.waiting!;
  assert.equal(w.text, 'Javob bering iltimos');
  assert.equal(w.at, at(0));
  assert.equal(w.count, 2);
  assert.equal(workChats.get(BIZ, '901')!.name, 'Aziz laboratoriya');
});

await check("3 soat o'tmagan — eslatma yo'q", async () => {
  await workTick(send, [biz], never, T0 + REMIND_AFTER_MS - 60_000);
  assert.equal(sent.length, 0);
});

await check("3 soatdan keyin — bitta eslatma, «javob shart emas» tugmasi bilan; ikkinchi marta kelmaydi", async () => {
  await workTick(send, [biz], never, T0 + REMIND_AFTER_MS + 60_000);
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /Aziz laboratoriya/);
  assert.match(sent[0].html, /\+1 xabar/);
  assert.deepEqual(sent[0].buttons[0].map(b => b.data), ['wd|901']);
  await workTick(send, [biz], never, T0 + REMIND_AFTER_MS + 600_000);
  assert.equal(sent.length, 1);
});

await check("kechki xabarda — hali kutayotganlar", () => {
  assert.match(workEveningHtml(BIZ, T0 + 10 * 3600_000) ?? '', /Javob kutayotganlar[\s\S]*Aziz laboratoriya[\s\S]*10 soat kutyapti/);
});

await check("egasi javob berdi — ro'yxatdan chiqdi, kechki qism bo'sh; keyingi xabari — yangi kuzatuv", async () => {
  workChats.answered(BIZ, '901');
  assert.equal(workChats.waiting(BIZ).length, 0);
  assert.equal(workEveningHtml(BIZ), null);
  workChats.incoming(BIZ, '901', 'Aziz lab', 'Ertaga keling', at(5 * 3600_000));
  const w = workChats.get(BIZ, '901')!.waiting!;
  assert.equal(w.count, 1);
  assert.equal(w.reminded, false);
  assert.equal(w.at, at(5 * 3600_000));
});

await check("internet yo'q — eslatma belgilanmaydi, keyingi tekshiruvda yana uriniladi", async () => {
  const before = sent.length;
  const failing = async () => { throw new Error('ETIMEDOUT'); };
  await workTick(failing, [biz], () => true, T0 + 9 * 3600_000);
  assert.equal(workChats.get(BIZ, '901')!.waiting!.reminded, false);
  await workTick(send, [biz], never, T0 + 9 * 3600_000);
  assert.equal(sent.length, before + 1);
  assert.equal(workChats.get(BIZ, '901')!.waiting!.reminded, true);
});

await check("Telegram'siz biznes va o'chiq biznes — eslatma yo'q", async () => {
  workChats.add('kotib-2', '7', 'Ijara', { text: "To'lov qachon?", at: at(0) });
  const before = sent.length;
  await workTick(send, [{ id: 'kotib-2', active: true, ownerChatId: null }, { id: 'kotib-2', active: false, ownerChatId: '1' }], never, T0 + 5 * 3600_000);
  assert.equal(sent.length, before);
});

await check("HTML qochiriladi, uzun ro'yxat qisqartiriladi", () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ id: String(i), name: `<b>${i}</b>`, waiting: { text: 'a<b', at: at(0), count: 1, reminded: false } }));
  const m = reminderMessage(many, T0 + 4 * 3600_000);
  assert.ok(!m.html.includes('<b>0</b>'));
  assert.match(m.html, /a&lt;b/);
  assert.match(m.html, /yana 4 kishi/);
  assert.equal(m.buttons.length, 10);
});

await check("qaytarish — kontakt o'chadi", () => {
  workChats.remove(BIZ, '901');
  assert.ok(!workChats.has(BIZ, '901'));
});

console.log(failed ? `\n${failed} ta sinov yiqildi` : '\nKotib: hammasi o\'tdi');
process.exit(failed ? 1 : 0);
