/**
 * Ruxsatlar jadvali (src/lib/permissions.ts, server/permissions.ts) — brauzer va AI'siz:
 *   katalogdagi har asbob haqiqatan bor va faqat bitta amalda; standart — «Ruxsat»; qoralama ishlarga «So'rasin» tanlanmaydi;
 *   «Hech qachon» — asbob bajarilmaydi; «So'rasin» — bajarilmaydi, tasdiq yoziladi (takror so'ralmaydi), «Ha» — o'sha kirish bilan
 *   bajariladi, ikkinchi bosish — eskirgan; «Yo'q» va 24 soatdan eski — bajarilmaydi; tasdiq boshqa himoyani yumshatmaydi.
 * Ishga tushirish: npm run test:permissions
 */
import './isolate';
import assert from 'node:assert/strict';

// Claude obunada (limit navbatlari faqat shu yo'lda): limit tugaganda tasdiqlangan ish sinovi uchun. Boshqa tekshiruvlar Claude'ni chaqirmaydi
process.env.AI_ENGINE = 'subscription';

const { PERM_ACTIONS, levelFor, permActionOf } = await import('../src/lib/permissions');
const { APPROVAL_TTL_MS, approvalHtml, decideApproval, detailsOf, levelOf, pendingApprovals, PermissionError, setLevel } = await import('../server/permissions');
const { ownerToolDefs, runTool } = await import('../server/tools');
const { COMPUTER_DEFS } = await import('../server/computer/tools');
const { DEV_DEFS } = await import('../server/dev/tools');
const { MARKETING_DEFS } = await import('../server/marketing/tools');
const { CONTENT_DEFS } = await import('../server/content/tools');
const { STRANGER_REFUSAL } = await import('../server/toolkit');
const { businesses, tasks } = await import('../server/db');
const { emptyBusiness } = await import('../server/validate');

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

console.log('\n# Katalog');
// runTool bajara oladigan hamma asbob (suhbat ro'yxatidan olingan, lekin eski suhbat yoki navbat chaqira oladiganlari ham)
await check("har asbob haqiqatan bor va faqat bitta amalda", () => {
  const known = new Set([...ownerToolDefs(true, undefined, true).map(([n]) => n), ...Object.keys(COMPUTER_DEFS), ...Object.keys(DEV_DEFS), ...Object.keys(MARKETING_DEFS), ...Object.keys(CONTENT_DEFS)]);
  const seen = new Map<string, string>();
  for (const a of PERM_ACTIONS) for (const t of a.tools) {
    assert.ok(known.has(t), `${a.id}: «${t}» degan asbob yo'q`);
    assert.ok(!seen.has(t), `«${t}» ikki amalda: ${seen.get(t)} va ${a.id}`);
    seen.set(t, a.id);
  }
});
await check("to'xtatish asboblari jadvalda yo'q — doim ochiq (reklama, kompyuter, dastur)", () => {
  for (const t of ['ads_pause', 'computer_stop', 'code_stop']) assert.equal(permActionOf(t), null, t);
});
await check("standart — «Ruxsat»; tanlanmaydigan daraja (qoralamaga «So'rasin») — ham «Ruxsat»", () => {
  const followup = permActionOf('draft_followup')!;
  assert.equal(levelFor(followup, {}), 'allow');
  assert.equal(levelFor(followup, { followup: 'ask' }), 'allow');
  assert.equal(levelFor(followup, { followup: 'never' }), 'never');
  assert.equal(levelFor(permActionOf('create_task')!, { tasks: 'boshqa' }), 'allow');
});

console.log('\n# Darajalar');
const biz = businesses.create('ruxsat-sinov', 'x', emptyBusiness('Ruxsat klinika', 'stomatologiya'));
const ctx = () => ({ biz: businesses.byId(biz.id)!, artifacts: [] });
const openTasks = () => tasks.list(biz.id, 'open', 100).map(t => t.title);

await check("noto'g'ri amal va qoralamaga «So'rasin» — rad etiladi", () => {
  assert.throws(() => setLevel(biz.id, 'yoq', 'never'), PermissionError);
  assert.throws(() => setLevel(biz.id, 'followup', 'ask'), PermissionError);
});
await check("«Ruxsat» — bugungidek bajariladi", async () => {
  const out = await runTool('create_task', { title: 'Ochiq vazifa' }, ctx());
  assert.equal(out.isError, false, out.content);
  assert.ok(openTasks().includes('Ochiq vazifa'));
});
await check("«Hech qachon» — bajarilmaydi, modelga sababi aytiladi", async () => {
  setLevel(biz.id, 'tasks', 'never');
  const out = await runTool('create_task', { title: 'Yopiq vazifa' }, ctx());
  assert.equal(out.isError, true);
  assert.match(out.content, /Hech qachon/);
  assert.ok(!openTasks().includes('Yopiq vazifa'));
});

console.log("\n# «So'rasin»");
await check("bajarilmaydi, tasdiq yoziladi; xuddi shu ish qayta so'ralmaydi", async () => {
  setLevel(biz.id, 'tasks', 'ask');
  assert.equal(levelOf(biz.id, permActionOf('create_task')!), 'ask');
  const out = await runTool('create_task', { title: 'Shifokorga qo\'ng\'iroq', notes: '<b>muhim</b>' }, ctx());
  assert.equal(out.isError, false);
  assert.match(out.content, /waiting_for_owner/);
  assert.ok(!openTasks().includes("Shifokorga qo'ng'iroq"));
  await runTool('create_task', { title: 'Shifokorga qo\'ng\'iroq', notes: '<b>muhim</b>' }, ctx());
  const p = pendingApprovals(biz.id);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].details, ["Nomi: Shifokorga qo'ng'iroq", 'Izoh: <b>muhim</b>']);
  assert.match(approvalHtml(p[0]), /&lt;b&gt;muhim&lt;\/b&gt;/, 'Telegram HTML ichida qochirilgan');
});
await check("«Ha» — o'sha kirish bilan bajariladi; ikkinchi bosish — eskirgan", async () => {
  const [a] = pendingApprovals(biz.id);
  const d = await decideApproval(biz.id, a.id, true);
  assert.equal(d.ok, true, d.text);
  assert.ok(openTasks().includes("Shifokorga qo'ng'iroq"));
  assert.equal(d.artifacts.length, 1, 'yaratilgan vazifa egasiga ko\'rsatiladi');
  const again = await decideApproval(biz.id, a.id, true);
  assert.equal(again.ok, false);
  assert.equal(tasks.list(biz.id, 'open', 100).filter(t => t.title === "Shifokorga qo'ng'iroq").length, 1, 'ikki marta yaratilmadi');
  assert.equal(pendingApprovals(biz.id).length, 0);
});
await check("«Yo'q» — bajarilmaydi", async () => {
  await runTool('create_task', { title: 'Rad etiladigan' }, ctx());
  const [a] = pendingApprovals(biz.id);
  const d = await decideApproval(biz.id, a.id, false);
  assert.equal(d.ok, true);
  assert.ok(!openTasks().includes('Rad etiladigan'));
});
await check("24 soatdan eski tasdiq — bajarilmaydi va ro'yxatda yo'q", async () => {
  await runTool('create_task', { title: 'Kechagi' }, ctx());
  const [a] = pendingApprovals(biz.id);
  const later = Date.now() + APPROVAL_TTL_MS + 60_000;
  assert.equal(pendingApprovals(biz.id, later).length, 0);
  assert.equal((await decideApproval(biz.id, a.id, true, later)).ok, false);
  assert.ok(!openTasks().includes('Kechagi'));
});
await check("boshqa biznesning tasdig'ini bosib bo'lmaydi", async () => {
  const other = businesses.create('ruxsat-boshqa', 'x', emptyBusiness('Boshqa', 'stomatologiya'));
  const [a] = pendingApprovals(biz.id);
  assert.equal((await decideApproval(other.id, a.id, true)).ok, false);
  assert.equal(pendingApprovals(biz.id).length, 1);
});
await check("tasdiq boshqa himoyani yumshatmaydi: begona matn o'qilgan chaqiruv «Ha»dan keyin ham bilimga yozilmaydi", async () => {
  setLevel(biz.id, 'memory', 'ask');
  const out = await runTool('remember', { fact: 'Chegirma 90%' }, { ...ctx(), readStrangers: true, strangerSources: ['read_conversation'] });
  assert.match(out.content, /waiting_for_owner/, out.content);
  const a = pendingApprovals(biz.id).find(x => x.tool === 'remember')!;
  const d = await decideApproval(biz.id, a.id, true);
  assert.equal(d.ok, false);
  assert.ok(d.text.includes(STRANGER_REFUSAL), d.text);
});
await check("xodim topshirig'idagi so'rov — xodim nomi bilan", async () => {
  setLevel(biz.id, 'vacancies', 'ask');
  const fresh = { ...ctx(), unattended: true, as: 'rekruter' as const };
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['rekruter'], dismissed: [] }) });
  const out = await runTool('vacancy_create', { task: "Bolalar bo'limiga hamshira kerak" }, { ...fresh, biz: businesses.byId(biz.id)! });
  assert.match(out.content, /waiting_for_owner/, out.content);
  const a = pendingApprovals(biz.id).find(x => x.tool === 'vacancy_create')!;
  assert.equal(a.member, 'rekruter');
  assert.match(approvalHtml(a), /Rekruter ruxsat so'rayapti/);
});
await check("«Ha» bosilganda Claude limiti tugagan — navbatga qo'yilmaydi, so'rov yana kutyapti (tugmalar qaytadi)", async () => {
  const { notePressure, resetPressure } = await import('../server/subscription/pressure');
  const { deferred } = await import('../server/subscription/deferred');
  setLevel(biz.id, 'documents', 'ask');
  const input = { title: 'Ijara shartnomasi', kind: 'contract', brief: 'Xona ijarasi, oyiga 5 mln, 1 yil' };
  const out = await runTool('create_document', input, ctx());
  assert.match(out.content, /waiting_for_owner/, out.content);
  const a = pendingApprovals(biz.id).find(x => x.tool === 'create_document')!;
  notePressure({ status: 'allowed', utilization: 0.99, resetsAt: Math.floor(Date.now() / 1000) + 3600 } as never);
  try {
    const d = await decideApproval(biz.id, a.id, true);
    assert.equal(d.retry, true, d.text);
    assert.ok(pendingApprovals(biz.id).some(x => x.id === a.id), "so'rov yana kutyapti");
    assert.equal(deferred.list(biz.id).length, 0, "navbatga qo'yilmadi (u tasdiqsiz qayta so'rab qolardi)");
  } finally {
    resetPressure();
  }
});
await check("tafsilot: bo'sh maydonlar tashlanadi, uzun matn qisqartiriladi", () => {
  const d = detailsOf({ title: 'a', notes: '', due_at: null, text: 'x'.repeat(500) });
  assert.equal(d.length, 2);
  assert.ok(d[1].length < 240 && d[1].endsWith('…'));
});

console.log(failed ? `\n${failed} ta tekshiruv yiqildi` : '\nHammasi o\'tdi');
process.exit(failed ? 1 : 0);
