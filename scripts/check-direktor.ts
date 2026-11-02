/**
 * Direktor sof mantig'i (server/director/logic.ts): model javobini tekshirish, natija bahosi, xabar.
 * Ishga tushirish: npx tsx scripts/check-direktor.ts
 */
import { cleanPlan, moveButtons, reportHtml, verdict, type Numbers } from '../server/director/logic';
import { goalsText, progress } from '../server/director/logic';

let failed = 0;
function ok(name: string, cond: boolean, info = ''): void {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${!cond && info ? ` — ${info}` : ''}`);
}

const numbers: Numbers = { inquiries: { now: 40, prev: 50 }, answered_pct: { now: 60, prev: 80 }, booked: { now: 8, prev: 12 }, came: null };

const plan = cleanPlan({
  summary: 'Javob ulushi tushdi',
  problem: { title: 'Javobsiz <b>murojaatlar</b>', evidence: '80% → 60%' },
  moves: [
    { member: 'qabulxona', task: 'Narx so\'raganga darhol javob ber', why: '60%', metric: 'answered_pct', check_days: 1 },
    { member: 'hacker', task: 'X', why: '', metric: 'booked', check_days: 5 },
    { member: 'egasi', task: 'Chegirma berish kerakmi — hal qiling', why: '', metric: 'booked', check_days: 40 },
    { member: 'yordamchi', task: 'Y', why: '', metric: 'came', check_days: 5 },
    { member: 'tahlilchi', task: 'Z', why: '', metric: 'nomalum', check_days: 5 },
    { member: 'marketolog', task: 'A', why: '', metric: 'inquiries', check_days: 7 },
    { member: 'yordamchi', task: 'B', why: '', metric: 'inquiries', check_days: 7 },
  ],
}, numbers);
ok("noma'lum xodim, noma'lum yoki ma'lumoti yo'q ko'rsatkich — tashlanadi; 3 tadan oshmaydi", plan.moves.map(m => m.member).join() === 'qabulxona,egasi,marketolog', JSON.stringify(plan.moves));
ok('muddat 3–14 kunga keltiriladi', plan.moves[0].checkDays === 3 && plan.moves[1].checkDays === 14);
ok('matndan HTML belgilari olinadi', !!plan.problem && !/[<>]/.test(plan.problem.title), plan.problem?.title);
ok("bo'sh yoki buzuq javob — bo'sh reja", cleanPlan(null, numbers).moves.length === 0 && cleanPlan({ moves: 'x' }, numbers).problem === null);

ok('natija: «ko\'paysa yaxshi» — ko\'paydi', verdict('booked', 8, 12).verdict === 'yaxshi');
ok('natija: «kamaysa yaxshi» — ko\'paydi → yomon', verdict('unanswered', 5, 9).verdict === 'yomon' && verdict('response_min', 30, 12).verdict === 'yaxshi');
ok("natija: 5% dan kichik o'zgarish — o'zgarmadi; 0 → 0 ham", verdict('inquiries', 100, 103).verdict === 'ozgarmadi' && verdict('booked', 0, 0).verdict === 'ozgarmadi' && verdict('booked', 0, 2).verdict === 'yaxshi');

ok("aytadigan narsa yo'q — xabar yo'q", reportHtml({ numbers, plan: { summary: '', problem: null, moves: [] }, moves: [], checked: [] }) === null);
const html = reportHtml({
  numbers, plan,
  moves: [{ n: 1, id: 'm1', member: 'qabulxona', task: 'Narxga <javob>', why: 'ulush 60%', metric: 'answered_pct', checkAt: '2026-11-06' }],
  checked: [{ task: 'Eslatma', member: 'yordamchi', metric: 'booked', before: 8, after: 12, verdict: 'yaxshi', pct: 50 }],
})!;
ok('xabar: raqamlar, natija, muammo, taklif va tekshirish sanasi; begona matn HTML\'ni buzmaydi', html.includes('Murojaatlar: <b>40</b> ↓') && html.includes('8 → 12 ✅') && html.includes('Eng katta muammo')
  && html.includes('<b>Qabulxona</b>: Narxga &lt;javob&gt;') && html.includes('tekshiraman 6-noyabr'), html);
const kb = moveButtons([{ n: 1, id: 'm1' }, { n: 2, id: 'm2' }]);
ok('tugmalar: har taklifga topshirish va kerak emas', kb.length === 2 && kb[0][0].data === 'dv|m1' && kb[1][1].data === 'dn|m2');

const g = (metric: Parameters<typeof progress>[0]['metric'], target: number) => ({ id: 'g', metric, target, createdAt: '' });
const nums: Numbers = { answered_pct: { now: 72, prev: 60 }, response_min: { now: 30, prev: 40 }, booked: { now: 25, prev: 10 }, came: null };
ok("maqsad «ko'paysa yaxshi»: 72 / 90 → 80%", progress(g('answered_pct', 90), nums).pct === 80 && !progress(g('answered_pct', 90), nums).reached);
ok("maqsad «kamaysa yaxshi»: javob vaqti 30 daq, maqsad 15 → 50%; 30 dan past maqsad — bajarilgan", progress(g('response_min', 15), nums).pct === 50 && progress(g('response_min', 45), nums).reached);
ok('maqsaddan oshib ketdi — 100%, bajarildi', progress(g('booked', 20), nums).pct === 100 && progress(g('booked', 20), nums).reached);
ok("ma'lumot yo'q (CRM ulanmagan) — foiz yo'q", progress(g('came', 50), nums).pct === null && progress(g('came', 50), nums).now === null);
ok('modelga: maqsad, joriy va foiz', goalsText([progress(g('answered_pct', 90), nums)]) === '- answered_pct: target 90%, now 72 (80% of target)', goalsText([progress(g('answered_pct', 90), nums)]));

if (failed) {
  console.error(`\n${failed} ta sinov yiqildi`);
  process.exit(1);
}
console.log("\nHammasi o'tdi");
