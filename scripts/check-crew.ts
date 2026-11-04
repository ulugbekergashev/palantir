/**
 * AI jamoa tarkibi (src/lib/crew.ts, server/crew.ts) — brauzer va AI'siz:
 *   standart jamoa Direktor va Yordamchi; ishi ulangan xodim o'zi qo'shiladi, egasi olib tashlagani qaytib qo'shilmaydi;
 *   eski baza (tarkib hali hisoblanmagan) — hamma xodim avvalgidek ishlaydi; olib tashlangan Qabulxona javob tayyorlamaydi;
 *   Direktor jamoada yo'q xodimga taklif bermaydi; API: ishga olish, asosiy xodimni olib tashlab bo'lmaydi.
 * Ishga tushirish: npm run test:crew
 */
import './isolate';
import assert from 'node:assert/strict';

const { CORE, crewHas, crewList, crewWorks, hiredIn, inUse, parseCrew, setHired, withInUse, works } = await import('../src/lib/crew');
const { businesses } = await import('../server/db');
const { emptyBusiness } = await import('../server/validate');
const { replySettings } = await import('../server/inbox/core');
const { cleanPlan } = await import('../server/director/logic');
const { moveMembersOf } = await import('../server/director/index');

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

const none = { customers: false, crm: false, cameras: 0, metaAi: false, marketingPosts: 0, content: false, ads: false };

console.log('\n# Qoida');
check('yangi biznes: jamoada faqat Direktor va Yordamchi', () => {
  assert.deepEqual(crewList(withInUse(null, inUse(none))), ['direktor', 'yordamchi']);
  assert.deepEqual([...CORE], ['direktor', 'yordamchi']);
});
check("Instagram ulandi — Qabulxona va Tahlilchi o'zi qo'shiladi; kamera — Kuzatuvchi", () => {
  const s = withInUse(null, inUse({ ...none, customers: true, cameras: 2 }));
  assert.deepEqual(crewList(s), ['direktor', 'qabulxona', 'yordamchi', 'kuzatuvchi', 'tahlilchi']);
});
check("egasi olib tashlagan xodim ishi ulangan bo'lsa ham qaytib qo'shilmaydi; «Ishga olish» bilan qaytadi", () => {
  const hired = withInUse(null, inUse({ ...none, cameras: 1 }));
  const out = setHired(hired, 'kuzatuvchi', false);
  assert.equal(works(out, 'kuzatuvchi'), false);
  assert.equal(works(withInUse(out, inUse({ ...none, cameras: 1 })), 'kuzatuvchi'), false);
  const back = setHired(out, 'kuzatuvchi', true);
  assert.equal(works(back, 'kuzatuvchi'), true);
  assert.deepEqual(back.dismissed, []);
});
check("asosiy xodimni olib tashlab bo'lmaydi; noma'lum nom va buzuq JSON — e'tiborsiz", () => {
  assert.equal(works(setHired(null, 'direktor', false), 'direktor'), true);
  assert.deepEqual(parseCrew('{"hired":["kontent","boshqa","direktor"],"dismissed":"x"}'), { hired: ['kontent'], dismissed: [] });
  assert.equal(parseCrew('{buzuq'), null);
});
check('tarkib hali hisoblanmagan (eski baza) — hamma xodim fonda avvalgidek ishlaydi va jamoada', () => {
  assert.equal(works(null, 'qabulxona'), true);
  assert.equal(crewWorks({ crew: null }, 'kontent'), true);
  assert.equal(crewHas({ crew: null }, 'kontent'), true);
});
check("hali ishga olinmagan, lekin olib tashlanmagan — fonda ishlaydi (panel ochilmasdan kelgan mijoz javobsiz qolmaydi), jamoada esa yo'q", () => {
  const fresh = JSON.stringify({ hired: [], dismissed: [] });
  assert.equal(crewWorks({ crew: fresh }, 'qabulxona'), true);
  assert.equal(crewHas({ crew: fresh }, 'qabulxona'), false);
  assert.equal(hiredIn(null, 'qabulxona'), true);
});
check("o'zgarish bo'lmasa — o'sha holat (bazaga qayta yozilmaydi)", () => {
  const s = withInUse(null, inUse({ ...none, ads: true }));
  assert.equal(withInUse(s, inUse({ ...none, ads: true })), s);
});

console.log('\n# Server');
const biz = businesses.create('crew-sinov', 'x', emptyBusiness('Sinov klinika', 'stomatologiya'));
check("Qabulxona jamoada yo'q — javob rejimi «o'chiq» (sozlamasi saqlanadi)", () => {
  businesses.update(biz.id, { crew: JSON.stringify({ hired: [], dismissed: ['qabulxona'] }) });
  const row = businesses.byId(biz.id)!;
  assert.equal(replySettings(row).mode, 'off');
  assert.equal(row.profile.autoReply?.mode, 'draft');
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['qabulxona'], dismissed: [] }) });
  assert.equal(replySettings(businesses.byId(biz.id)!).mode, 'draft');
});
check("Direktor faqat jamoadagi xodimga va egasiga taklif beradi", () => {
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['qabulxona'], dismissed: [] }) });
  const members = moveMembersOf(businesses.byId(biz.id)!);
  assert.deepEqual(members, ['qabulxona', 'yordamchi', 'egasi']);
  const numbers = { inquiries: { now: 4, prev: 6 } };
  const plan = cleanPlan({ summary: 's', problem: null, moves: [
    { member: 'marketolog', task: "Post yoz", why: 'x', metric: 'inquiries', check_days: 5 },
    { member: 'qabulxona', task: 'Tezroq javob ber', why: 'x', metric: 'inquiries', check_days: 5 },
  ] }, numbers, members);
  assert.deepEqual(plan.moves.map(m => m.member), ['qabulxona']);
});

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
