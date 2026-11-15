/**
 * Qo'ng'iroq tahlili va kamera kadrini baholash — HAQIQIY model bilan (pul ketadi). eval-ai.ts ning davomi: u yerda egasining
 * yordamchisi va mijozga javob, bu yerda qolgan ikki ish. Holatlar: scripts/eval/task-cases.ts, kadrlar: scripts/eval/frames/.
 *   npm run eval:tasks                                  — nechta holat (so'rov yuborilmaydi)
 *   npm run eval:tasks -- --yes [--model claude-sonnet-5-5] [--only qongiroq,kamera,k-nechta] [--repeat 3]
 *   npm run eval:gemini -- gemini-3.8-flash --script scripts/eval-tasks.ts --yes        (Gemini'da, ko'prik orqali)
 * .env dan faqat ANTHROPIC_* va AI_MODEL o'qiladi. Vaqtinchalik baza (haqiqiysiga tegilmaydi). Natija: eval-natijalar/ (gitga kirmaydi).
 */
process.env.TZ = 'Asia/Tashkent';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import type { BusinessRow } from '../server/db';
import type { Camera } from '../src/types';
import type { CallCase, FrameCase, TaskCase } from './eval/task-cases';

const { values: a } = parseArgs({
  options: { yes: { type: 'boolean' }, model: { type: 'string' }, only: { type: 'string' }, repeat: { type: 'string', default: '1' }, parallel: { type: 'string', default: '4' } },
});
const repeat = Math.max(1, Number(a.repeat) || 1), parallel = Math.max(1, Number(a.parallel) || 4);

if (existsSync('.env')) {
  for (const [k, v] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) {
    if (/^(ANTHROPIC_|AI_MODEL$)/.test(k) && process.env[k] === undefined) process.env[k] = v;
  }
}
const dataDir = mkdtempSync(join(tmpdir(), 'palantir-eval-'));
process.on('exit', () => {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows: baza hali band */ }
});
Object.assign(process.env, { DOTENV: '0', DATA_DIR: dataDir, BOT_TOKEN: '' });
process.env.SESSION_SECRET ||= 'eval';
if (a.model) process.env.AI_MODEL = a.model;

const { TASK_CASES } = await import('./eval/task-cases');
const { env } = await import('../server/env');
const { costUsd } = await import('../server/claude');

const FRAMES_DIR = join('scripts', 'eval', 'frames');
const only = a.only?.split(',').map(s => s.trim()).filter(Boolean);
const cases = only ? TASK_CASES.filter(c => only.includes(c.id) || only.includes(c.group)) : TASK_CASES;
if (!cases.length) { console.error(`--only ${a.only}: holat topilmadi`); process.exit(1); }
const missing = cases.flatMap(c => (c.group === 'kamera' && !existsSync(join(FRAMES_DIR, `${c.frame}.jpg`)) ? [c.frame] : []));
if (missing.length) { console.error(`Kadr topilmadi (${FRAMES_DIR}): ${[...new Set(missing)].join(', ')}`); process.exit(1); }

console.log(`${cases.length} holat × ${repeat} · ${env.aiModel}`);
if (!a.yes) { console.log("Haqiqiy modelga so'rov ketadi (pul): boshlash uchun --yes qo'shing"); process.exit(0); }
if (!env.aiEnabled) { console.error("ANTHROPIC_API_KEY yo'q (.env yoki muhitda) — baholab bo'lmaydi"); process.exit(1); }

const { businesses } = await import('../server/db');
const { aiUsage } = await import('../server/serviceStore');
const { emptyBusiness } = await import('../server/validate');
const { analyseTranscript } = await import('../server/phone/analysis');
const { askFrame, checkFrame } = await import('../server/orders/look');
const { addDays, iso } = await import('../src/lib/week');

const startDay = iso(new Date());
const profile = {
  ...emptyBusiness('Shifo Dent', 'stomatologiya'), ownerName: 'Aziz', phone: '+998 71 200 00 00', address: 'Toshkent, Chilonzor 5',
  offerings: [{ id: 'o1', name: 'Implant', price: 5_000_000 }, { id: 'o2', name: 'Tish tozalash', price: 250_000 }],
};

interface Run { pass: boolean; why: string[]; cost: number; ms: number; shown: string }
const CYRILLIC_WORD = /[а-яёўқғҳ]{3,}/i;

async function runCall(biz: BusinessRow, c: CallCase): Promise<Pick<Run, 'why' | 'shown'>> {
  // «Ertaga» modelga ham, tekshiruvga ham shu paytdan sanaladi (yarim tunda bir kunga adashmasin)
  const startedAt = Date.now() - 60_000;
  const f = await analyseTranscript(biz, c.lines.join('\n'), !c.unlabelled, { direction: c.direction, startedAt, durationSec: 30, phone: '+998901234567' });
  const { analysis: n, request: q } = f, e = c.expect, why: string[] = [];
  const fields = [n.summary, n.wants, n.agreed, n.nextStep, n.staffNote, q?.summary ?? ''];
  if (!e.outcome.includes(n.outcome)) why.push(`natija ${n.outcome}, kutilgan: ${e.outcome.join(' / ')}`);
  if (!e.request.includes(q?.kind ?? null)) why.push(`so'rov: ${q?.kind ?? "yo'q"}, kutilgan: ${e.request.map(k => k ?? "yo'q").join(' / ')}`);
  if (e.name && !e.name.test(n.customerName)) why.push(`ism «${n.customerName}», kutilgan: ${e.name}`);
  if (e.minScore !== undefined && n.score < e.minScore) why.push(`baho ${n.score}, kamida ${e.minScore} kutilgan`);
  if (e.maxScore !== undefined && n.score > e.maxScore) why.push(`baho ${n.score}, ko'pi bilan ${e.maxScore} kutilgan`);
  const due = e.dueTomorrowAt ? `${iso(addDays(new Date(startedAt), 1))}T${e.dueTomorrowAt}` : null;
  if (due && q?.dueAt !== due) why.push(`so'rov vaqti «${q?.dueAt ?? ''}», kutilgan ${due}`);
  if (e.noteHas && !e.noteHas.test(n.staffNote)) why.push(`xodimga izohda yo'q: ${e.noteHas}`);
  if (e.textNot && fields.some(t => e.textNot!.test(t))) why.push(`matnda bo'lmasligi kerak edi: ${e.textNot}`);
  if (fields.some(t => CYRILLIC_WORD.test(t))) why.push("maydonlar o'zbekcha lotinda bo'lishi kerak edi (kirill bor)");
  return { why, shown: `${n.outcome} · so'rov: ${q ? `${q.kind} ${q.dueAt}` : "yo'q"} · ${n.score}/10 · «${n.summary.slice(0, 200)}» · xodim: «${n.staffNote.slice(0, 160)}»` };
}

async function runFrame(bizId: string, c: FrameCase): Promise<Pick<Run, 'why' | 'shown'>> {
  const cam: Camera = { id: 'cam1', name: c.camera.name, zones: [], createdAt: new Date().toISOString(), lastSeenAt: null, seenFrom: null, ip: '192.168.1.10', feed: null, profile: c.camera.profile };
  const jpeg = readFileSync(join(FRAMES_DIR, `${c.frame}.jpg`));
  const r = c.kind === 'check' ? await checkFrame(bizId, cam, c.question, jpeg) : { alert: undefined, answer: await askFrame(bizId, cam, c.question, jpeg) };
  const e = c.expect, why: string[] = [];
  if (e.alert !== undefined && r.alert !== e.alert) why.push(`ogohlantirish ${r.alert ? 'berildi' : 'berilmadi'}, kutilgan: ${e.alert ? 'berilsin' : 'berilmasin'}`);
  if (e.answerHas && !e.answerHas.test(r.answer)) why.push(`javobda yo'q: ${e.answerHas}`);
  if (e.answerNot && e.answerNot.test(r.answer)) why.push(`javobda bo'lmasligi kerak edi: «${r.answer.match(e.answerNot)?.[0]}»`);
  return { why, shown: `${r.alert === undefined ? '' : `ogohlantirish: ${r.alert ? 'ha' : "yo'q"} · `}«${r.answer.slice(0, 240)}»` };
}

let seq = 0;
const spent = (bizId: string) => aiUsage.since(startDay).filter(u => u.businessId === bizId).reduce((s, u) => s + costUsd(u, env.aiModel), 0);

async function runCase(c: TaskCase): Promise<Run> {
  const biz = businesses.create(`eval-task-${++seq}`, 'x', profile);
  const t0 = Date.now();
  try {
    const r = c.group === 'qongiroq' ? await runCall(biz, c) : await runFrame(biz.id, c);
    return { pass: !r.why.length, ...r, cost: spent(biz.id), ms: Date.now() - t0 };
  } catch (e) {
    return { pass: false, why: [`xato: ${(e as Error).message}`], shown: '', cost: spent(biz.id), ms: Date.now() - t0 };
  }
}

const runs = new Map<string, Run[]>(cases.map(c => [c.id, []]));
const jobs = cases.flatMap(c => Array.from({ length: repeat }, () => c));
let next = 0;
const startedAt = new Date().toISOString();
console.log('');
await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, async () => {
  while (next < jobs.length) {
    const c = jobs[next++];
    const r = await runCase(c);
    runs.get(c.id)!.push(r);
    console.log(`${r.pass ? '  ✓' : '  ✗'} ${c.id} — $${r.cost.toFixed(4)}, ${(r.ms / 1000).toFixed(1)} s${[...r.why, ...(r.pass || !r.shown ? [] : [r.shown])].map(d => `\n      ${d}`).join('')}`);
  }
}));

const all = [...runs.values()].flat();
const passed = all.filter(r => r.pass).length, cost = all.reduce((s, r) => s + r.cost, 0);
const pad = (s: string, n: number) => s.padEnd(n);
console.log(`\n${pad('Toifa', 20)}${pad("o'tdi", 10)}${pad('narx', 10)}o'rtacha vaqt`);
for (const group of [...new Set(cases.map(c => c.group))]) {
  const rs = cases.filter(c => c.group === group).flatMap(c => runs.get(c.id)!);
  const groupCost = rs.reduce((s, r) => s + r.cost, 0);
  console.log(`${pad(group, 20)}${pad(`${rs.filter(r => r.pass).length}/${rs.length}`, 10)}${pad(`$${groupCost.toFixed(3)}`, 10)}${(rs.reduce((s, r) => s + r.ms, 0) / rs.length / 1000).toFixed(1)} s · bir holat $${(groupCost / rs.length).toFixed(4)}`);
}
console.log(`${pad('Jami', 20)}${pad(`${passed}/${all.length}`, 10)}$${cost.toFixed(3)}`);

mkdirSync('eval-natijalar', { recursive: true });
const report = {
  model: env.aiModel, repeat, startedAt, finishedAt: new Date().toISOString(), totals: { runs: all.length, passed, cost },
  cases: cases.map(c => ({ id: c.id, group: c.group, runs: runs.get(c.id)! })),
};
const stamp = `${startedAt.slice(0, 19).replace(/[:T]/g, '-')}-tasks-${env.aiModel}`;
let file = join('eval-natijalar', `${stamp}.json`);
for (let i = 2; existsSync(file); i++) file = join('eval-natijalar', `${stamp}-${i}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`\nNatija: ${file}`);
process.exit(passed === all.length ? 0 : 1);
