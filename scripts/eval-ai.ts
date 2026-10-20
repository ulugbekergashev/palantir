/**
 * AI sifati va narxini baholash — HAQIQIY Claude bilan (pul ketadi). scripts/eval/cases.ts dagi holatlar egasining yordamchisi
 * (ask) va mijozga javob (decide) orqali o'tkaziladi, har biri tekshiriladi va xarajati sanaladi.
 * Model yoki fikrlash darajasini almashtirishdan oldin shu bilan solishtiring — qaror egasiniki, raqamlar bilan:
 *   npm run eval:ai                       — nechta holat va taxminiy narx (so'rov yuborilmaydi)
 *   npm run eval:ai -- --yes              — hammasi, .env dagi model bilan
 *   npm run eval:ai -- --yes --model claude-sonnet-5-5 --compare eval-natijalar/<oldingi>.json
 *   --only vazifa,m-narx-uz (toifa yoki holat) · --repeat 3 (barqarorlik) · --parallel 4 · --web (internet qidiruvi)
 *   --effort-owner low|medium|high · --effort-customer low|medium|high
 * .env dan faqat ANTHROPIC_*, AI_MODEL va AI_EFFORT_* o'qiladi: bot, hub, telefon ulanmaydi. Vaqtinchalik baza (haqiqiysiga
 * tegilmaydi), soxta DentaCRM shu jarayonda. Natija: eval-natijalar/ (gitga kirmaydi).
 */
process.env.TZ = 'Asia/Tashkent';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import type { Case, Result } from './eval/cases';
import type { BusinessRow, LeadRow } from '../server/db';
import type { LeadChannel } from '../src/types';

const { values: a } = parseArgs({
  options: {
    yes: { type: 'boolean' }, web: { type: 'boolean' }, model: { type: 'string' }, only: { type: 'string' }, compare: { type: 'string' },
    repeat: { type: 'string', default: '1' }, parallel: { type: 'string', default: '4' },
    'effort-owner': { type: 'string' }, 'effort-customer': { type: 'string' },
  },
});
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
for (const k of ['effort-owner', 'effort-customer'] as const) {
  if (a[k] && !EFFORTS.includes(a[k])) { console.error(`--${k}: ${EFFORTS.join(' | ')} bo'lishi kerak`); process.exit(1); }
}
const repeat = Math.max(1, Number(a.repeat) || 1), parallel = Math.max(1, Number(a.parallel) || 4);

// .env dan faqat Claude sozlamalari: boshqa kalitlar (bot, hub, telefon) baholashga aralashmasin
if (existsSync('.env')) {
  for (const [k, v] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) {
    if (/^(ANTHROPIC_|AI_MODEL$|AI_EFFORT_)/.test(k) && process.env[k] === undefined) process.env[k] = v;
  }
}
const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-eval-'));
process.on('exit', () => {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows: baza hali band */ }
});
Object.assign(process.env, { DOTENV: '0', DATA_DIR: dataDir, BOT_TOKEN: '', WEB_SEARCH: a.web ? '1' : '0' });
process.env.SESSION_SECRET ||= 'eval';
if (a.model) process.env.AI_MODEL = a.model;
if (a['effort-owner']) process.env.AI_EFFORT_OWNER = a['effort-owner'];
if (a['effort-customer']) process.env.AI_EFFORT_CUSTOMER = a['effort-customer'];

const { CASES } = await import('./eval/cases');
const { env } = await import('../server/env');
const { costUsd } = await import('../server/claude');

// Holatlar to'plamining o'zi to'g'rimi (pulsiz, CI ham tekshiradi): asbob nomi o'zgarsa yoki tekshiruv noto'g'ri turdagi holatga yozilsa —
// holat jim «o'tib» ketmasin
const { toolDefinitions } = await import('../server/tools');
const known = new Set(toolDefinitions(false, true).flatMap(t => 'name' in t ? [t.name] : []));
const broken = CASES.flatMap(c => {
  const e = c.expect, problems: string[] = [];
  const named = [...e.tools ?? [], ...e.anyTool ?? [], ...e.forbid ?? [], ...Object.keys(e.input ?? {})];
  problems.push(...named.filter(t => !known.has(t)).map(t => `noma'lum asbob ${t}`));
  if (c.kind === 'owner' && (!c.text || c.thread || c.patient || e.action || e.request !== undefined || e.phoneEndsWith || e.booking !== undefined || e.change !== undefined)) {
    problems.push("egasi holati: text kerak, mijoz tekshiruvlari bo'lmaydi");
  }
  if (c.patient && !c.clinic) problems.push('bemor holati klinikada bo\'ladi (clinic: true)');
  if (c.kind === 'customer' && (!c.thread?.length || c.text || named.length || e.noTools)) problems.push("mijoz holati: thread kerak, asbob tekshiruvlari bo'lmaydi");
  if (CASES.filter(x => x.id === c.id).length > 1) problems.push('id takrorlangan');
  return problems.map(p => `${c.id}: ${p}`);
});
if (broken.length) { console.error(`Holatlar to'plamida xato:\n  ${broken.join('\n  ')}`); process.exit(1); }

const only = a.only?.split(',').map(s => s.trim()).filter(Boolean);
const cases = only ? CASES.filter(c => only.includes(c.id) || only.includes(c.group)) : CASES;
if (!cases.length) { console.error(`--only ${a.only}: holat topilmadi`); process.exit(1); }

// Bir holatga taxminiy tokenlar (asboblar va ko'rsatma keshdan; egasida 2–4 so'rov) — haqiqiy xarajat oxirida sanaladi
const GUESS = { owner: { input: 2000, cacheWrite: 6000, cacheRead: 30_000, output: 1200 }, customer: { input: 1500, cacheWrite: 3000, cacheRead: 3000, output: 400 } };
const guess = cases.reduce((s, c) => s + costUsd(GUESS[c.kind], env.aiModel), 0) * repeat;
console.log(`${cases.length} holat × ${repeat} · ${env.aiModel} · fikrlash: egasi ${env.aiEffortOwner}, mijoz ${env.aiEffortCustomer} · internet ${env.webSearch ? 'yoqiq' : "o'chiq"}`);
console.log(`Taxminiy narx: ~$${guess.toFixed(2)} (ikki baravargacha farq qilishi mumkin)`);
if (!a.yes) { console.log("Haqiqiy Claude'ga so'rov ketadi (pul): boshlash uchun --yes qo'shing"); process.exit(0); }
if (!env.aiEnabled) { console.error("ANTHROPIC_API_KEY yo'q (.env yoki muhitda) — baholab bo'lmaydi"); process.exit(1); }

const { aiUsage, businesses, conversations, inbox, leads } = await import('../server/db');
const { emptyBusiness } = await import('../server/validate');
const { updateAbout } = await import('../server/setup/about');
const { ask } = await import('../server/agent');
const { decide } = await import('../server/inbox/replier');
const { connectCrm } = await import('../server/crm/index');
const { crm, crmServer, CRM_LOGIN } = await import('./fakeCrm');
const { listen } = await import('./fakes');
const { addDays, iso } = await import('../src/lib/week');
const { proofFor } = await import('../server/personRules');

const startDay = iso(new Date());
const crmUrl = `http://127.0.0.1:${await listen(crmServer)}`;
const tomorrow = iso(addDays(new Date(), 1));
crm.seed(startDay, tomorrow);
crm.seedHistory(n => iso(addDays(new Date(), -n)));
// Bemor holatlari (Case.patient) uchun: Dilnoza Karimovaning ertangi qabuli
crm.appointments.push({ id: 'up1', patientId: 'p4', patientName: 'Dilnoza Karimova', doctorId: 'd1', doctorName: 'Rustam Rustamov', type: "Ko'rik", date: tomorrow, time: '11:00', duration: 30, status: 'Pending', notes: null, clinicId: 'c1', reminderSent: false });

const profile = {
  ...emptyBusiness('Shifo Dent', 'stomatologiya'), ownerName: 'Aziz', phone: '+998 71 200 00 00', address: 'Toshkent, Chilonzor 5',
  offerings: [{ id: 'o1', name: 'Implant', price: 5_000_000 }, { id: 'o2', name: 'Tish tozalash', price: 250_000 }],
};
const ABOUT: [string, string][] = [['Telefon', profile.phone], ['Manzil', profile.address], ['Ish vaqti', 'Du–Sh 9:00–20:00']];

interface Run { pass: boolean; why: string[]; cost: number; ms: number; result: Result | null; toolErrors: string[] }
type Block = { type: string; name?: string; input?: Record<string, unknown>; is_error?: boolean; content?: unknown };

/** Suhbatdagi asbob chaqiruvlari va xato bilan qaytgan natijalar (har holat — yangi biznes, suhbatda faqat shu holat) */
function toolTrace(bizId: string) {
  const blocks = ((conversations.get(bizId)?.messages ?? []) as { content: unknown }[]).flatMap(m => Array.isArray(m.content) ? m.content as Block[] : []);
  return {
    calls: blocks.filter(b => b.type === 'tool_use').map(b => ({ name: b.name!, input: b.input ?? {} })),
    errors: blocks.filter(b => b.type === 'tool_result' && b.is_error).map(b => (typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).slice(0, 200)),
  };
}

function same(v: unknown, want: string | number | boolean | RegExp): boolean {
  return want instanceof RegExp ? want.test(String(v ?? '')) : v === want;
}

function judge(c: Case, r: Result): string[] {
  const e = c.expect, why: string[] = [];
  if (r.kind === 'owner') {
    const names = r.calls.map(x => x.name);
    for (const t of e.tools ?? []) if (!names.includes(t)) why.push(`${t} chaqirilmadi`);
    if (e.anyTool && !e.anyTool.some(t => names.includes(t))) why.push(`${e.anyTool.join(' / ')} — birortasi ham chaqirilmadi`);
    if (e.noTools && names.length) why.push(`asbob kerak emas edi: ${names.join(', ')}`);
    for (const t of e.forbid ?? []) if (names.includes(t)) why.push(`${t} chaqirilmasligi kerak edi`);
    for (const [tool, fields] of Object.entries(e.input ?? {})) {
      const calls = r.calls.filter(x => x.name === tool);
      if (calls.length && !calls.some(x => Object.entries(fields).every(([k, want]) => same(x.input[k], want)))) {
        why.push(`${tool} kiritmasi mos emas: ${JSON.stringify(calls.map(x => x.input))}`);
      }
    }
  } else {
    if (e.action && !e.action.includes(r.action)) why.push(`javob turi ${r.action}, kutilgan: ${e.action.join(' / ')}`);
    if (e.request !== undefined && (r.request?.kind ?? null) !== e.request) why.push(`so'rov: ${r.request?.kind ?? "yo'q"}, kutilgan: ${e.request ?? "yo'q"}`);
    if (e.phoneEndsWith && !r.request?.phone.replace(/\D/g, '').endsWith(e.phoneEndsWith)) why.push(`raqam «${r.request?.phone ?? ''}», kutilgan …${e.phoneEndsWith}`);
    if (e.booking !== undefined && JSON.stringify(r.booking) !== JSON.stringify(e.booking)) why.push(`qabul: ${JSON.stringify(r.booking)}, kutilgan: ${JSON.stringify(e.booking)}`);
    const changeOk = e.change === null ? !r.change : !!r.change && Object.entries(e.change ?? {}).every(([k, v]) => r.change![k as keyof typeof r.change] === v);
    if (e.change !== undefined && !changeOk) why.push(`o'zgarish: ${JSON.stringify(r.change)}, kutilgan: ${JSON.stringify(e.change)}`);
  }
  for (const re of e.replyHas ?? []) if (!re.test(r.reply)) why.push(`javobda yo'q: ${re}`);
  for (const re of e.replyNot ?? []) if (re.test(r.reply)) why.push(`javobda bo'lmasligi kerak edi: «${r.reply.match(re)?.[0]}»`);
  const extra = e.check?.(r);
  if (typeof extra === 'string') why.push(extra);
  return why;
}

/** Yozayotgan mijoz: noma'lum odam Instagram'dan yoki bemor Dilnoza Karimova (Case.patient) */
function customer(biz: BusinessRow, as: Case['patient']): { lead: LeadRow; channel: LeadChannel } {
  if (!as) return { lead: leads.add(biz.id, { name: null, phone: null, note: null, source: 'Instagram' }), channel: 'instagram' };
  const phone = '+998944445566';
  if (as === 'patient-instagram') {
    const lead = leads.add(biz.id, { name: 'Dilnoza Karimova', phone, note: null, source: 'Instagram' });
    leads.setPatient(biz.id, lead.id, 'p4');
    return { lead, channel: 'instagram' };
  }
  const tg = String(9000 + seq);
  const lead = leads.fromTelegram(biz.id, tg, 'Dilnoza Karimova', null, 'Telegram havola', null);
  leads.update(biz.id, lead.id, { phone, phoneProof: as === 'patient' ? proofFor(tg, phone) : null });
  leads.setPatient(biz.id, lead.id, 'p4');
  return { lead, channel: 'bot' };
}

let seq = 0;
async function runCase(c: Case): Promise<Run> {
  const biz = businesses.create(`eval-${++seq}`, 'x', profile);
  updateAbout(biz.id, ABOUT);
  const t0 = Date.now();
  let result: Result | null = null, toolErrors: string[] = [];
  try {
    if (c.clinic) await connectCrm(biz, { url: crmUrl, ...CRM_LOGIN });
    if (c.kind === 'owner') {
      const r = await ask(biz.id, 'telegram', c.text!, { voice: c.voice });
      if (r.failed) throw new Error(r.text);
      const trace = toolTrace(biz.id);
      toolErrors = trace.errors;
      result = { kind: 'owner', reply: r.text, calls: trace.calls };
    } else {
      const { lead, channel } = customer(biz, c.patient);
      const lines = c.thread!, t = Date.now() - lines.length * 60_000;
      lines.forEach(([dir, text], i) => inbox.add(biz.id, { leadId: lead.id, channel, direction: dir, by: dir === 'in' ? 'customer' : 'cerebro', text, at: new Date(t + i * 60_000).toISOString() }));
      const d = await decide(biz, leads.get(biz.id, lead.id)!, inbox.thread(biz.id, lead.id, 30));
      const { request: q, booking: b, change: ch } = d;
      result = {
        kind: 'customer', action: d.action, reply: d.reply,
        request: q && { kind: q.kind, phone: q.phone, dueAt: q.dueAt, summary: q.summary }, booking: b && { doctorId: b.doctorId, date: b.date, time: b.time },
        change: ch && { kind: ch.kind, appointmentId: ch.appointmentId, date: ch.date, time: ch.time },
      };
    }
  } catch (e) {
    return { pass: false, why: [`xato: ${(e as Error).message}`], cost: spent(biz.id), ms: Date.now() - t0, result, toolErrors };
  }
  const why = judge(c, result);
  return { pass: !why.length, why, cost: spent(biz.id), ms: Date.now() - t0, result, toolErrors };
}

const spent = (bizId: string) => aiUsage.since(startDay).filter(u => u.businessId === bizId).reduce((s, u) => s + costUsd(u, env.aiModel), 0);

/** O'tmagan holatda nima bo'lgani: javob va asboblar (egasi) yoki javob turi, so'rov va qabul (mijoz) */
function shown(r: Result): string[] {
  const lines = [`javob: «${r.reply.replace(/\s+/g, ' ').slice(0, 220)}»`];
  if (r.kind === 'owner') return [...lines, `asboblar: ${r.calls.map(x => x.name).join(', ') || "yo'q"}`];
  const { request: q, booking: b } = r;
  const ch = r.change;
  return [...lines, `tur: ${r.action} · so'rov: ${q ? `${q.kind} ${q.phone}` : "yo'q"}${b ? ` · qabul: ${b.doctorId} ${b.date} ${b.time}` : ''}${ch ? ` · o'zgarish: ${ch.kind} ${ch.appointmentId} ${ch.date} ${ch.time}` : ''}`];
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
    const details = [...r.why, ...(r.result && !r.pass ? shown(r.result) : []), ...r.toolErrors.map(t => `asbob xatosi: ${t}`)];
    console.log(`${r.pass ? '  ✓' : '  ✗'} ${c.id} — $${r.cost.toFixed(3)}, ${(r.ms / 1000).toFixed(1)} s${details.map(d => `\n      ${d}`).join('')}`);
  }
}));

// ─── Hisobot ──────────────────────────────────────────────────────────────────
const all = [...runs.values()].flat();
const passed = all.filter(r => r.pass).length, cost = all.reduce((s, r) => s + r.cost, 0);
const pad = (s: string, n: number) => s.padEnd(n);
console.log(`\n${pad('Toifa', 20)}${pad("o'tdi", 10)}${pad('narx', 10)}o'rtacha vaqt`);
for (const group of [...new Set(cases.map(c => c.group))]) {
  const rs = cases.filter(c => c.group === group).flatMap(c => runs.get(c.id)!);
  console.log(`${pad(group, 20)}${pad(`${rs.filter(r => r.pass).length}/${rs.length}`, 10)}${pad(`$${rs.reduce((s, r) => s + r.cost, 0).toFixed(2)}`, 10)}${(rs.reduce((s, r) => s + r.ms, 0) / rs.length / 1000).toFixed(1)} s`);
}
console.log(`${pad('Jami', 20)}${pad(`${passed}/${all.length}`, 10)}$${cost.toFixed(2)} · bir holat o'rtacha $${(cost / all.length).toFixed(3)}`);

interface Report {
  model: string; effort: { owner: string; customer: string }; web: boolean; repeat: number; startedAt: string; finishedAt: string;
  totals: { runs: number; passed: number; cost: number };
  cases: { id: string; group: string; kind: string; runs: Run[] }[];
}
const report: Report = {
  model: env.aiModel, effort: { owner: env.aiEffortOwner, customer: env.aiEffortCustomer }, web: env.webSearch, repeat, startedAt, finishedAt: new Date().toISOString(),
  totals: { runs: all.length, passed, cost },
  cases: cases.map(c => ({ id: c.id, group: c.group, kind: c.kind, runs: runs.get(c.id)! })),
};
mkdirSync('eval-natijalar', { recursive: true });
const stamp = `${startedAt.slice(0, 19).replace(/[:T]/g, '-')}-${env.aiModel}-${env.aiEffortOwner}-${env.aiEffortCustomer}`;
// Oldingi natija ustidan yozilmaydi (--compare uni o'qiydi)
let file = join('eval-natijalar', `${stamp}.json`);
for (let i = 2; existsSync(file); i++) file = join('eval-natijalar', `${stamp}-${i}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`\nNatija: ${file}`);

if (a.compare) {
  const old = JSON.parse(readFileSync(a.compare, 'utf8')) as Report;
  const rate = (rs: Run[]) => `${rs.filter(r => r.pass).length}/${rs.length}`;
  console.log(`\n# Solishtirish: ${old.model} (${old.effort.owner}/${old.effort.customer}) → ${report.model} (${report.effort.owner}/${report.effort.customer})`);
  let changed = 0;
  for (const c of report.cases) {
    const before = old.cases.find(o => o.id === c.id);
    if (!before) continue;
    const share = (rs: Run[]) => rs.filter(r => r.pass).length / rs.length;
    if (share(before.runs) !== share(c.runs)) { changed++; console.log(`  ${share(c.runs) > share(before.runs) ? '↑' : '↓'} ${c.id}: ${rate(before.runs)} → ${rate(c.runs)}`); }
  }
  if (!changed) console.log('  holatlar natijasi o\'zgarmadi');
  const perCase = (r: Report) => r.totals.cost / r.totals.runs;
  console.log(`  o'tdi: ${old.totals.passed}/${old.totals.runs} → ${passed}/${all.length} · bir holat: $${perCase(old).toFixed(3)} → $${perCase(report).toFixed(3)}`);
}

process.exit(passed === all.length ? 0 : 1);
