/**
 * Bazadagi ish yozuvlarining Obsidian'dagi ko'rinishi — egasi ham, AI ham hammasini bitta papkada ko'radi.
 *
 *   Vazifalar.md        ikki tomonlama: katakcha [x] — bajarildi, [-] — bekor; nom yoki vaqtni (📅) o'zgartirish — bazada ham;
 *                       kalitsiz (^id siz) yangi qator — yangi vazifa
 *   Qo'ng'iroqlar/*.md  har telefon suhbati: nima qilindi va suhbat matni (bilim emas — mijozlarga javobda ishlatilmaydi)
 *
 * Asosiy nusxa bazada qoladi: eslatma aniq vaqtda ishlashi va telefon, bot, panel bir vaqtda yozishi xavfsiz bo'lishi uchun.
 * Kim nimani o'zgartirganini bilish uchun oxirgi yozilgan holat papka yonidagi faylda saqlanadi: faylda undan farq qilgan
 * maydon — egasining o'zgartirishi (bazaga o'tadi), qolgani — bazadan yoziladi.
 * Qator o'chirilsa vazifa o'chmaydi (keyingi yozuvda qaytadi): adashib bo'shatilgan fayl hamma vazifani bekor qilib yubormasin.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task, TaskStatus } from '../../src/types';
import { tasks } from '../db';
import { inert } from './logic';
import { CALLS, COMMENT, PHONE_FILE, TASKS_FILE, put, refresh, vaultDir } from './vault';

/** «Bajarildi» bo'limida shuncha oxirgisi ko'rinadi */
const DONE_SHOWN = 20;
const MAX_TITLE = 200;
const LINE = /^\s*[-*]\s+\[([ xX-])\]\s+(.*?)\s*$/;
const ID = /\s\^([A-Za-z0-9]{4,16})$/;
/** Cerebro yozgan vaqt: «📅 2026-10-18 09:00» */
const DUE = /\s*📅\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/;
/** Egasi qo'shgan yangi qatorda belgisiz vaqt ham qabul qilinadi: «- [ ] Akmalga qo'ng'iroq 2026-10-20 15:00» */
const PLAIN_DUE = /\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/;
const HELP = "> Cerebro yozadi va o'qiydi. Katakchani belgilasangiz — bajarildi; `[-]` — bekor; nom yoki 📅 vaqtni o'zgartirsangiz — Cerebro'da ham o'zgaradi. "
  + "Yangi vazifa: `- [ ] Nima qilish 2026-10-20 15:00` (vaqt ixtiyoriy). Oxiridagi ^kod — vazifa raqami, o'zgartirmang.";

interface Seen { status: TaskStatus; title: string; dueAt: string | null }
type State = Record<string, Seen>;
interface Line extends Seen { id: string | null; /** Vaqt yozilgan, lekin noto'g'ri (2026-13-40) — muddatga tegilmaydi */ badDue: boolean }

const load = (full: string): string => { const t = readFileSync(full, 'utf8'); return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t; };
const stateFile = (dir: string) => `${dir}.vazifalar.json`;
function loadState(dir: string): State | null {
  try { return JSON.parse(readFileSync(stateFile(dir), 'utf8')) as State; } catch { return null; }
}

/** Haqiqiy sana-vaqt (2026-02-31 25:99 emas) */
function validDue(day: string, time: string): string | null {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day && h < 24 && m < 60 ? `${day}T${time}` : null;
}

function parse(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    let rest = m[2];
    const id = ID.exec(rest);
    if (id) rest = rest.slice(0, id.index);
    const due = DUE.exec(rest) ?? (id ? null : PLAIN_DUE.exec(rest));
    if (due) rest = rest.slice(0, due.index);
    const title = rest.replace(/\s+—\s*$/, '').trim().slice(0, MAX_TITLE);
    if (!title) continue;
    const dueAt = due ? validDue(due[1], due[2]) : null;
    out.push({ id: id?.[1] ?? null, status: m[1] === ' ' ? 'open' : m[1] === '-' ? 'cancelled' : 'done', title, dueAt, badDue: !!due && !dueAt });
  }
  return out;
}

/** Fayldagi o'zgartirishlar bazaga: oxirgi yozilgan holatdan farq qilgan maydonlar (holat bo'lmasa — bazadan farqlisi) */
function apply(bizId: string, lines: Line[], state: State | null): void {
  for (const l of lines) {
    if (!l.id) {
      const t = tasks.create(bizId, l.title, l.dueAt, null);
      if (l.status !== 'open') tasks.update(bizId, t.id, { status: l.status });
      continue;
    }
    const cur = tasks.get(bizId, l.id);
    if (!cur) continue;
    const was = state?.[l.id];
    const changed = <K extends keyof Seen>(k: K) => (was ? l[k] !== was[k] : true) && l[k] !== cur[k];
    const patch: Partial<Seen> = {};
    if (changed('status')) patch.status = l.status;
    if (changed('title')) patch.title = l.title;
    // Noto'g'ri yozilgan vaqt muddatni o'chirib yubormaydi
    if (changed('dueAt') && !l.badDue) patch.dueAt = l.dueAt;
    if (Object.keys(patch).length) tasks.update(bizId, l.id, patch);
  }
}

const clean = (title: string): string => inert(title.replace(/[\r\n]+/g, ' ').replace(/[\^📅]/gu, ' ').replace(/\s+/g, ' ').trim());
const row = (t: Task): string => `- [${t.status === 'done' ? 'x' : ' '}] ${clean(t.title)}${t.dueAt ? ` 📅 ${t.dueAt.replace('T', ' ')}` : ''} ^${t.id}`;

function write(bizId: string, dir: string): void {
  const open = tasks.list(bizId, 'open', 300);
  const done = tasks.list(bizId, 'done', DONE_SHOWN);
  put(dir, TASKS_FILE, [
    '# Vazifalar', '', HELP, '',
    `## Ochiq (${open.length})`, ...(open.length ? open.map(row) : ["Hozircha yo'q."]), '',
    ...(done.length ? [`## Bajarildi (oxirgi ${done.length})`, ...done.map(row), ''] : []),
  ].join('\n'));
  // Yozilgan qator qayta o'qilganda qanday chiqsa, holat ham shunday saqlanadi (aks holda tozalangan nom «o'zgardi» deb ko'rinadi)
  const seen = parse([...open, ...done].map(row).join('\n'));
  const state = JSON.stringify(Object.fromEntries(seen.map(l => [l.id, { status: l.status, title: l.title, dueAt: l.dueAt }])));
  // Har tekshiruvda (30 soniyada) diskka yozilmasin — faqat o'zgarganda
  if (!existsSync(stateFile(dir)) || readFileSync(stateFile(dir), 'utf8') !== state) writeFileSync(stateFile(dir), state);
}

/** Vazifalar.md ↔ baza. Yozib/o'qib bo'lmasa (fayl band) — asosiy ish to'xtamaydi, keyingi safar yana uriniladi */
export function syncTasks(bizId: string): void {
  try {
    const dir = vaultDir(bizId);
    const full = join(dir, TASKS_FILE);
    const hadFile = existsSync(full);
    if (hadFile) apply(bizId, parse(load(full)), loadState(dir));
    write(bizId, dir);
    if (!hadFile) refresh(bizId); // mundarijaga havola
  } catch (err) {
    console.error('[miya] vazifalar:', (err as Error).message);
  }
}

// ─── Telefondagi AI ──────────────────────────────────────────────────────────

/** Telefon.md dan bunchasi beriladi (adashib tashlangan uzun matn ko'rsatmani to'ldirib yubormasin) */
const MAX_GUIDE = 4000;
const VOICE = /^ovoz:\s*([A-Za-z]{2,20})\s*$/im;

/**
 * Telefondagi AI ko'rsatmasi (egasi Obsidian'da yozadi): izohlarsiz matn va tanlangan ovoz. Sahifa yo'q — bo'sh.
 * {ism} — egasining hozirgi ismi bilan almashadi (sahifa ism ma'lum bo'lmasdan oldin yaratilgan bo'lishi mumkin)
 */
export function phoneGuide(bizId: string, ownerName: string): { text: string; voice: string | null } {
  try {
    const full = join(vaultDir(bizId), PHONE_FILE);
    if (!existsSync(full)) return { text: '', voice: null };
    const raw = load(full).replace(COMMENT, '');
    const voice = VOICE.exec(raw)?.[1] ?? null;
    const name = ownerName.replace(/[{}]/g, '').trim();
    const text = raw.replace(VOICE, '').replace(/\{ism\}/g, name).replace(/,\s*(?=[!.?])/g, '').replace(/:\s*\.$/gm, '.');
    return { text: text.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_GUIDE), voice };
  } catch (err) {
    console.error('[miya] telefon sahifasi:', (err as Error).message);
    return { text: '', voice: null };
  }
}

// ─── Telefon suhbatlari ──────────────────────────────────────────────────────

export interface CallLine { at: string; who: 'Siz' | 'Cerebro' | 'Amal'; text: string }
export interface CallRecord { startedAt: string; seconds: number; withWhom: string; lines: CallLine[] }

const one = (s: string): string => inert(s.replace(/\s+/g, ' ').trim());

/** Suhbat sahifasi: «Qo'ng'iroqlar/2026-10-17 20-37.md». Qaytadi: papka ichidagi yo'l */
export function saveCall(bizId: string, c: CallRecord): string {
  const dir = vaultDir(bizId);
  const base = `${CALLS}/${c.startedAt.slice(0, 16).replace('T', ' ').replace(':', '-')}`;
  let rel = `${base}.md`;
  for (let n = 2; existsSync(join(dir, rel)); n++) rel = `${base} (${n}).md`;
  const actions = c.lines.filter(l => l.who === 'Amal');
  const talk = c.lines.filter(l => l.who !== 'Amal');
  const mins = `${Math.floor(c.seconds / 60)}:${String(Math.round(c.seconds) % 60).padStart(2, '0')}`;
  put(dir, rel, [
    '---', 'tur: qongiroq', `sana: ${JSON.stringify(c.startedAt)}`, `davomiyligi: "${mins}"`, `kim: ${JSON.stringify(one(c.withWhom))}`, '---',
    `# Qo'ng'iroq — ${c.startedAt.slice(0, 16).replace('T', ' ')}`, '',
    '## Nima qilindi', ...(actions.length ? actions.map(a => `- ${one(a.text)}`) : ['- (faqat suhbat)']), '',
    '## Suhbat', ...talk.map(l => `**${l.who}** (${one(l.at)}): ${one(l.text)}`), '',
  ].join('\n'));
  refresh(bizId);
  return rel;
}
