/**
 * Murakkab ishlarda ikki modelni solishtirish — HAQIQIY model bilan (pul ketadi). Holatlar: scripts/eval/hard-cases.ts.
 * 1) Javob yozish (Palantir'ning o'z ko'rsatmalari bilan: brend-buk, video ssenariysi, Instagram posti, egasining yordamchisi):
 *      npm run eval:hard -- --yes [--repeat 2]                                     (.env dagi Claude modeli)
 *      npm run eval:gemini -- gemini-3.8-flash --script scripts/eval-hard.ts --yes [--repeat 2]
 * 2) Hakam: ikki natija faylini ko'r-ko'rona solishtiradi (A/B tartibi tasodifiy, hakam qaysi model ekanini bilmaydi):
 *      npm run eval:hard -- --judge <a.json> <b.json> --yes                        (hakam — Claude)
 *      npm run eval:gemini -- gemini-3.8-flash --script scripts/eval-hard.ts --judge <a.json> <b.json> --yes   (hakam — Gemini)
 * Vaqtinchalik baza (haqiqiysiga tegilmaydi). Natija: eval-natijalar/ (gitga kirmaydi).
 */
process.env.TZ = 'Asia/Tashkent';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import type { BusinessRow } from '../server/db';
import type { HardCase } from './eval/hard-cases';

const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: { yes: { type: 'boolean' }, model: { type: 'string' }, only: { type: 'string' }, repeat: { type: 'string', default: '1' }, judge: { type: 'boolean' }, parallel: { type: 'string', default: '3' } },
});
const repeat = Math.max(1, Number(a.repeat) || 1), parallel = Math.max(1, Number(a.parallel) || 3);

if (existsSync('.env')) {
  for (const [k, v] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) {
    if (/^(ANTHROPIC_|AI_MODEL$)/.test(k) && process.env[k] === undefined) process.env[k] = v;
  }
}
const dataDir = mkdtempSync(join(tmpdir(), 'palantir-eval-'));
process.on('exit', () => {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows: baza hali band */ }
});
// Internet o'chiq: strategiya berilgan raqamlardan tuziladi, ikki model bir xil sharoitda bo'lsin (Gemini ko'prigida qidiruv ham yo'q)
Object.assign(process.env, { DOTENV: '0', DATA_DIR: dataDir, BOT_TOKEN: '', WEB_SEARCH: '0' });
process.env.SESSION_SECRET ||= 'eval';
if (a.model) process.env.AI_MODEL = a.model;

const { HARD_CASES } = await import('./eval/hard-cases');
const { env } = await import('../server/env');

interface Output { id: string; run: number; text: string; checks: string[]; cost: number; ms: number }
interface OutputFile { model: string; startedAt: string; outputs: Output[] }

const only = a.only?.split(',').map(s => s.trim()).filter(Boolean);
const cases = only ? HARD_CASES.filter(c => only.includes(c.id) || only.includes(c.kind)) : HARD_CASES;
if (!cases.length) { console.error(`--only ${a.only}: holat topilmadi`); process.exit(1); }

const files = a.judge ? positionals.slice(0, 2) : [];
if (a.judge && (files.length < 2 || files.some(f => !existsSync(f)))) { console.error('--judge <a.json> <b.json>: ikkala fayl kerak'); process.exit(1); }

console.log(a.judge ? `Hakam: ${env.aiModel} · ${files.map(f => basename(f)).join(' vs ')}` : `${cases.length} holat × ${repeat} · ${env.aiModel}`);
if (!a.yes) { console.log("Haqiqiy modelga so'rov ketadi (pul): boshlash uchun --yes qo'shing"); process.exit(0); }
if (!env.aiEnabled) { console.error("ANTHROPIC_API_KEY yo'q (.env yoki muhitda) — ishlab bo'lmaydi"); process.exit(1); }

const { businesses } = await import('../server/db');
const { aiUsage } = await import('../server/serviceStore');
const { costUsd, think } = await import('../server/claude');
const { emptyBusiness } = await import('../server/validate');
const { iso } = await import('../src/lib/week');

const startDay = iso(new Date());
const spent = (bizId: string) => aiUsage.since(startDay).filter(u => u.businessId === bizId).reduce((s, u) => s + costUsd(u, env.aiModel), 0);
const profile = {
  ...emptyBusiness('Shifo Dent', 'stomatologiya'), ownerName: 'Aziz', phone: '+998 71 200 00 00', address: 'Toshkent, Chilonzor 5',
  description: "Oilaviy stomatologiya, Chilonzorda 8 yildan beri. Bolalar va kattalar. Narxni davolashdan oldin aytamiz.",
  offerings: [
    { id: 'o1', name: 'Implant', price: 5_000_000 }, { id: 'o2', name: 'Tish tozalash', price: 250_000 }, { id: 'o3', name: 'Plomba', price: 400_000 },
    { id: 'o4', name: 'Breket', price: 9_000_000 }, { id: 'o5', name: 'Tish oqartirish', price: 1_200_000 },
  ],
};
let seq = 0;
const newBiz = (): BusinessRow => businesses.create(`eval-hard-${++seq}`, 'x', profile);
const CYRILLIC_WORD = /[а-яёўқғҳ]{3,}/i;
const pad = (s: string, n: number) => s.padEnd(n);

/** Videolar uchun bir xil brend-buk (ikki model ham bir xil sharoitda yozsin) */
const VIDEO_BOOK = {
  name: 'Shifo Dent', essence: 'Shoshilmasdan, halol davolash', positioning: "Tish shifokoridan qo'rqadigan oilalarni narxni oldindan aytib, shoshilmasdan davolaymiz",
  tagline: 'Shoshilmasdan, oldindan aytib', promise: "Har qadamni va narxni oldindan bilasiz",
  values: ['Halollik', 'Sabr', "Bolalarga e'tibor"], voice: ["Qisqa gaplar", "«Siz» bilan", "Raqam faqat haqiqiy bo'lsa"],
  banned: ["eng yaxshi", "og'riqsiz kafolat", 'revolyutsion'], traits: [{ trait: 'Iliq', is: "do'stona", isNot: 'shirinsuxan' }],
  examples: [{ bad: "Biz eng zamonaviy klinikamiz!", good: "Davolashdan oldin har qadamni ko'rsatib beramiz." }],
  hooks: ["Tish shifokoriga borishni kechiktiryapsizmi?", "Narxni oldindan bilsangiz, qo'rquv yarimta bo'ladi"],
  ctas: ["Direct'ga «ko'rik» deb yozing", "Qo'ng'iroq qiling: +998 71 200 00 00"],
  colors: { bg: '#F4EFE6', deep: '#DCD3C3', surface: '#FFFFFF', ink: '#2B2A28', accent: '#D9822B', muted: '#7A7468' },
};

async function produce(c: HardCase): Promise<Pick<Output, 'text' | 'checks'> & { bizId: string }> {
  const biz = newBiz(), checks: string[] = [];
  if (c.kind === 'brend') {
    const { buildBrandPrompt, cleanBook, cleanAnswers } = await import('../server/content/brand');
    const { askText, jsonIn } = await import('../server/content/writer');
    const p = buildBrandPrompt(biz, cleanAnswers(JSON.parse(c.input)), 'uz');
    const text = await askText(biz, p.system, p.user, 16_000);
    const book = cleanBook(jsonIn(text), profile.name);
    if (!book) checks.push("brend-buk o'qilmadi (JSON yaroqsiz)");
    else {
      const share = book.pillars.reduce((s, x) => s + x.share, 0);
      if (Math.abs(share - 100) > 2) checks.push(`ustunlar ulushi ${share}%`);
      if (book.hooks.length < 6) checks.push(`ilgaklar ${book.hooks.length} ta`);
    }
    return { bizId: biz.id, text, checks };
  }
  if (c.kind === 'video') {
    const { buildScriptPrompt, cleanScenes } = await import('../server/content/video');
    const { cleanBook } = await import('../server/content/brand');
    const { askText, jsonIn } = await import('../server/content/writer');
    const { companyContext } = await import('../server/company');
    const book = cleanBook(VIDEO_BOOK, profile.name)!;
    const p = buildScriptPrompt(book, c.input, 'uz', companyContext(biz, 'content', { withBrand: false }));
    const text = await askText(biz, p.system, p.user);
    const scenes = cleanScenes(jsonIn(text), book);
    if (!scenes.length) checks.push("ssenariy o'qilmadi");
    const long = scenes.filter(s => s.text.split(/\s+/).length > 6);
    if (long.length) checks.push(`ekrandagi yozuv 6 so'zdan uzun: ${long.length} sahna`);
    const words = scenes.reduce((n, s) => n + s.voice.split(/\s+/).length, 0);
    if (words > 85) checks.push(`diktor matni ${words} so'z (35 soniyadan uzun)`);
    if (scenes.some(s => CYRILLIC_WORD.test(s.text + s.voice))) checks.push('kirill bor');
    return { bizId: biz.id, text, checks };
  }
  if (c.kind === 'post') {
    const { writeInstagram } = await import('../server/content/writer');
    const r = await writeInstagram(biz, c.input, { picture: true });
    if (!r.picture) checks.push("rasm tavsifi yo'q");
    if (!/960/.test(r.caption)) checks.push("aksiya narxi (960 000) yo'q");
    if (CYRILLIC_WORD.test(r.caption)) checks.push('kirill bor');
    return { bizId: biz.id, text: `${r.caption}\n\n[Rasm] ${r.picture ?? ''}`, checks };
  }
  const { ask } = await import('../server/agent');
  const r = await ask(biz.id, 'telegram', c.input);
  if (r.failed) throw new Error(r.text);
  if (CYRILLIC_WORD.test(r.text)) checks.push('kirill bor');
  return { bizId: biz.id, text: r.text, checks };
}

async function pool<T>(items: T[], work: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

function save(kind: string, data: unknown): string {
  mkdirSync('eval-natijalar', { recursive: true });
  const stamp = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${kind}-${env.aiModel}`;
  let file = join('eval-natijalar', `${stamp}.json`);
  for (let i = 2; existsSync(file); i++) file = join('eval-natijalar', `${stamp}-${i}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

// ─── 1) Javob yozish ─────────────────────────────────────────────────────────

async function generate(): Promise<void> {
  const startedAt = new Date().toISOString(), outputs: Output[] = [];
  const jobs = cases.flatMap(c => Array.from({ length: repeat }, (_, run) => ({ c, run: run + 1 })));
  await pool(jobs, async ({ c, run }) => {
    const t0 = Date.now();
    let o: Output;
    try {
      const r = await produce(c);
      o = { id: c.id, run, text: r.text, checks: r.checks, cost: spent(r.bizId), ms: Date.now() - t0 };
    } catch (e) {
      o = { id: c.id, run, text: '', checks: [`xato: ${(e as Error).message}`], cost: 0, ms: Date.now() - t0 };
    }
    outputs.push(o);
    console.log(`${o.checks.length ? '  !' : '  ✓'} ${c.id} #${run} — ${(o.ms / 1000).toFixed(1)} s, ${o.text.length} belgi${o.checks.map(x => `\n      ${x}`).join('')}`);
  });
  outputs.sort((x, y) => x.id.localeCompare(y.id) || x.run - y.run);
  console.log(`\nNatija: ${save('hard', { model: env.aiModel, startedAt, outputs } satisfies OutputFile)}`);
}

// ─── 2) Hakam ────────────────────────────────────────────────────────────────

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['a', 'b', 'winner', 'reason'],
  properties: {
    a: { type: 'object', additionalProperties: false, required: ['score', 'problems'], properties: { score: { type: 'integer' }, problems: { type: 'array', items: { type: 'string' } } } },
    b: { type: 'object', additionalProperties: false, required: ['score', 'problems'], properties: { score: { type: 'integer' }, problems: { type: 'array', items: { type: 'string' } } } },
    winner: { type: 'string', enum: ['A', 'B', 'tie'] },
    reason: { type: 'string' },
  },
} as const;

const JUDGE = `You are a strict, fair expert reviewer. Two AI systems answered the same request from a dental clinic owner in Uzbekistan. You do not know which system wrote which answer, and their order is random — judge only the content.
Score each answer 1-10 against the criteria (10 = you would use it as is, 7 = good with small edits, 5 = needs real rework, 3 = mostly unusable). Check every number you can against the reference. List each answer's concrete problems (max 5, most important first; empty if none). Length is not quality: a longer answer wins only if the extra content is useful.
Pick the winner, or "tie" when the difference is too small to matter to the owner. Write problems and reason in Russian, short and plain.`;

interface Verdict { a: { score: number; problems: string[] }; b: { score: number; problems: string[] }; winner: 'A' | 'B' | 'tie'; reason: string }

async function verdictFor(c: HardCase, first: string, second: string): Promise<Verdict> {
  const biz = newBiz();
  const res = await think(biz.id, 'owner', {
    model: env.aiModel, max_tokens: 6000, system: JUDGE,
    messages: [{ role: 'user', content: `<request>\n${c.brief}\n\nWhat the owner wrote:\n${c.input}\n</request>\n\n<criteria>\n${c.rubric}\n</criteria>\n\n<answer_a>\n${first}\n</answer_a>\n\n<answer_b>\n${second}\n</answer_b>` }],
    thinking: { type: 'adaptive', display: 'omitted' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
  });
  return JSON.parse(res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('')) as Verdict;
}

async function judgeFiles(): Promise<void> {
  const [x, y] = files.map(f => JSON.parse(readFileSync(f, 'utf8')) as OutputFile);
  const pairs = cases.flatMap(c => x.outputs.filter(o => o.id === c.id && o.text).flatMap(ox => {
    const oy = y.outputs.find(o => o.id === c.id && o.run === ox.run && o.text);
    return oy ? [{ c, ox, oy }] : [];
  }));
  if (!pairs.length) { console.error('Solishtiradigan juftlik topilmadi'); process.exit(1); }
  const rows: { id: string; run: number; scoreX: number; scoreY: number; winner: string; reason: string; problemsX: string[]; problemsY: string[] }[] = [];
  await pool(pairs, async ({ c, ox, oy }) => {
    const swap = Math.random() < 0.5;
    try {
      const v = await verdictFor(c, swap ? oy.text : ox.text, swap ? ox.text : oy.text);
      const [vx, vy] = swap ? [v.b, v.a] : [v.a, v.b];
      const winner = v.winner === 'tie' ? 'durang' : (v.winner === 'A') !== swap ? x.model : y.model;
      rows.push({ id: c.id, run: ox.run, scoreX: vx.score, scoreY: vy.score, winner, reason: v.reason, problemsX: vx.problems, problemsY: vy.problems });
      console.log(`  ${c.id} #${ox.run}: ${x.model} ${vx.score} — ${y.model} ${vy.score} → ${winner}\n      ${v.reason}`);
    } catch (e) {
      console.log(`  ✗ ${c.id} #${ox.run}: hakam xatosi — ${(e as Error).message}`);
    }
  });
  rows.sort((p, q) => p.id.localeCompare(q.id) || p.run - q.run);
  console.log(`\n${pad('Ish', 22)}${pad(x.model, 22)}${pad(y.model, 22)}g'olib`);
  for (const c of cases) {
    const rs = rows.filter(r => r.id === c.id);
    if (!rs.length) continue;
    const avg = (k: 'scoreX' | 'scoreY') => (rs.reduce((s, r) => s + r[k], 0) / rs.length).toFixed(1);
    const wins = (m: string) => rs.filter(r => r.winner === m).length;
    console.log(`${pad(c.id, 22)}${pad(avg('scoreX'), 22)}${pad(avg('scoreY'), 22)}${x.model} ${wins(x.model)} · ${y.model} ${wins(y.model)} · durang ${wins('durang')}`);
  }
  console.log(`\nHakam natijasi: ${save('judge', { judge: env.aiModel, x: x.model, y: y.model, files, rows })}`);
}

if (a.judge) await judgeFiles();
else await generate();
process.exit(0);
