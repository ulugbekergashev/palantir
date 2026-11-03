/**
 * Litsenziya holati (kalit ko'rinishi — hub/licenseKey.ts). DentaLocal kabi: yangi o'rnatish kalitsiz ishlamaydi — panel birinchi
 * ochilishdanoq faqat aktivlashtirish oynasini ko'rsatadi (http.ts, asBiz). Sotuvchi kompyuter kodiga kalit beradi: telefondagi kalit
 * sahifasi (npm run kalit-sahifa), npm run kalit yoki Hub'dagi «Aktivlashtirish».
 * Litsenziya qo'shilishidan oldin ham ishlab turgan klinika (biznesi hisob boshlanishidan oldin yaratilgan) — EXISTING_GRACE_DAYS:
 * yangilanish kechasi o'zi keladi, sotuvchi hammasini bir vaqtda aktivlashtirib ulgurmasligi mumkin. Muddat tugagach bot, kamera va
 * qo'ng'iroqlar to'xtamaydi (klinikaning mijozlari javobsiz qolmasin), faqat panel yopiladi; tugashiga yaqin egasiga Telegram'da
 * aytiladi (scheduler.ts).
 * Kompyuter kodi: Windows MachineGuid'ining xeshi — Windows qayta o'rnatilsa almashadi (yangi kalit kerak). LICENSE_MACHINE_ID — sinov.
 * Saqlanadi: <DATA_DIR>/litsenziya.json va bazadagi nusxasi (settings) — kalit, har kompyuterning birinchi ishga tushgan payti va
 * o'rnatish turi (yangi / eski, bir marta aniqlanadi). Ikkalasidan eng eski payt olinadi: faylni o'chirib muddatni qaytadan boshlab
 * bo'lmaydi (bazani o'chirsa — klinikaning hamma ma'lumoti ketadi). Zaxira boshqa kompyuterga tiklansa, o'sha kompyuter alohida.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { checkLicense, normalizeMachineId } from '../hub/licenseKey';
import { businesses } from './db';
import { env } from './env';
import { settings } from './serviceStore';

const DAY_MS = 86_400_000;
/** Yangi o'rnatish: kalitsiz bir kun ham ishlamaydi */
const NEW_GRACE_DAYS = 0;
/** Litsenziyadan oldin ishlab turgan o'rnatish uchun kalitsiz muddat (kun) */
const EXISTING_GRACE_DAYS = 30;
/** 14 kunlik sinov muddati bilan o'rnatilgan (0.3.x), hali kalitsiz klinika: yangilanish uni darhol yopmaydi — o'sha muddat tugaguncha */
const TRIAL_GRACE_DAYS = 14;
/** Sinovdagi muddat shundan kam bo'lmasa, eski o'rnatishga EXISTING_GRACE_DAYS (haqiqiydagi kabi) */
const TEST_DEFAULT_GRACE = 14;
/** Bazadagi nusxa (settings jadvali; keys.ts faqat o'z nomlarini o'qiydi) */
const DB_KEY = 'license.key', DB_FIRST = 'license.firstRun', DB_INSTALL = 'license.install';

let cachedId: string | null = null;
/** Shu kompyuterning kodi (XXXX-XXXX-XXXX-XXXX) */
export function machineId(): string {
  if (cachedId) return cachedId;
  const given = env.licenseMachineId ? normalizeMachineId(env.licenseMachineId) : null;
  if (given) return (cachedId = given);
  let source = '';
  try {
    source = process.platform === 'win32'
      ? /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true }))?.[1] ?? ''
      : readFileSync('/etc/machine-id', 'utf8').trim();
  } catch { /* quyida: kompyuter nomi */ }
  const hex = createHash('sha256').update(`palantir-kompyuter\n${source || hostname()}`).digest('hex').slice(0, 16);
  return (cachedId = normalizeMachineId(hex)!);
}

type Install = 'new' | 'existing' | 'trial';
/** keys — fayldagi va bazadagi kalit (buzug'i to'g'risini bosib ketmasin: tekshiruvdan o'tgani olinadi) */
interface Stored { keys: string[]; firstRun: Record<string, string>; install: Install | null }
const INSTALLS: readonly Install[] = ['new', 'existing', 'trial'];
const file = () => join(env.dataDir, 'litsenziya.json');
let stored: Stored | null = null;

interface Copy { key: string | null; firstRun: Record<string, string>; install?: Install | null }
function fromFile(): Partial<Copy> {
  try {
    const j = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Copy>;
    return { key: typeof j.key === 'string' ? j.key : null, firstRun: j.firstRun && typeof j.firstRun === 'object' ? j.firstRun : {} };
  } catch {
    return {};
  }
}
function fromDb(): Partial<Copy> {
  try {
    const rows = new Map(settings.all().map(r => [r.name, r.value]));
    const first = rows.get(DB_FIRST);
    const install = rows.get(DB_INSTALL);
    return {
      key: rows.get(DB_KEY) || null,
      firstRun: first ? JSON.parse(first) as Record<string, string> : {},
      install: INSTALLS.find(k => k === install) ?? null,
    };
  } catch {
    return {};
  }
}

const valid = (t: number, now: number) => Number.isFinite(t) && t <= now;
/** Ikki nusxadagi har kompyuter uchun eng eski (kelajakdagisi emas) payt */
function earliest(a: Record<string, string> = {}, b: Record<string, string> = {}, now = Date.now()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const best = [a[id], b[id]].map(v => Date.parse(String(v ?? ''))).filter(t => valid(t, now)).sort((x, y) => x - y)[0];
    if (best !== undefined) out[id] = new Date(best).toISOString();
  }
  return out;
}

function load(): Stored {
  if (stored) return stored;
  const f = fromFile(), d = fromDb();
  const keys = [...new Set([f.key, d.key].filter((k): k is string => !!k))];
  stored = { keys, firstRun: earliest(f.firstRun, d.firstRun), install: d.install ?? null };
  return stored;
}
/** Yozib bo'lmasa (disk to'la, papka yopiq) — xotirada qoladi: litsenziya tufayli panel so'rovlari yiqilmasin */
function save(s: Stored): void {
  stored = s;
  try {
    writeFileSync(`${file()}.tmp`, JSON.stringify({ key: s.keys[0] ?? null, firstRun: s.firstRun }, null, 2));
    renameSync(`${file()}.tmp`, file());
  } catch (e) {
    console.error('[litsenziya] faylga saqlanmadi:', (e as Error).message);
  }
  try {
    if (s.keys[0]) settings.set(DB_KEY, s.keys[0]);
    settings.set(DB_FIRST, JSON.stringify(s.firstRun));
    if (s.install) settings.set(DB_INSTALL, s.install);
  } catch (e) {
    console.error('[litsenziya] bazaga saqlanmadi:', (e as Error).message);
  }
}

/** Shu kompyuterning birinchi ishga tushgan payti; yo'q, buzuq yoki kelajakdagi (soat adashgan) qiymat — hozirgi payt bilan almashadi */
function firstRun(id: string, now: number): number {
  const s = load(), t = Date.parse(String(s.firstRun[id] ?? ''));
  if (valid(t, now)) return t;
  save({ ...s, firstRun: { ...s.firstRun, [id]: new Date(now).toISOString() } });
  return now;
}

/**
 * O'rnatish turi — bir marta, kompyuterning birinchi ishga tushgan payti yozilishidan OLDIN aniqlanib saqlanadi (keyin ro'yxatdan o'tgan
 * biznes uni «eski» qilib qo'ymaydi; main.ts uni profil yaratilishidan oldin chaqiradi):
 *   existing — biznes hisob boshlanishidan kamida bir kun oldin yaratilgan: litsenziyasiz versiyadan yangilangan klinika;
 *   trial    — litsenziya hisobi oldin ham yuritilgan (0.3.x, 14 kun sinov), lekin eski klinika emas;
 *   new      — hech qanday iz yo'q: yangi o'rnatish.
 */
function install(id: string, now: number): Install {
  const s = load();
  if (s.install) return s.install;
  const prior = Date.parse(String(s.firstRun[id] ?? ''));
  const started = valid(prior, now) ? prior : now;
  const oldest = Math.min(...businesses.all().map(b => Date.parse(b.createdAt)).filter(Number.isFinite));
  const kind: Install = Number.isFinite(oldest) && oldest < started - DAY_MS ? 'existing' : valid(prior, now) ? 'trial' : 'new';
  save({ ...s, install: kind });
  return kind;
}

function graceDays(kind: Install): number {
  const test = env.licenseGraceDays;
  if (test === null) return kind === 'existing' ? EXISTING_GRACE_DAYS : kind === 'trial' ? TRIAL_GRACE_DAYS : NEW_GRACE_DAYS;
  return test >= TEST_DEFAULT_GRACE && kind === 'existing' ? EXISTING_GRACE_DAYS : test;
}

/** Muddat hisobi boshlangan payt: yangi bo'lmagan o'rnatishda — har qanday kompyuterdagi eng eski (Windows qayta o'rnatilsa yoki zaxira
 * boshqa kompyuterga tiklansa, kalitsiz muddat qaytadan boshlanmasin) */
function startedAt(kind: Install, id: string, now: number): number {
  const own = firstRun(id, now);
  if (kind === 'new') return own;
  return Math.min(own, ...Object.values(load().firstRun).map(v => Date.parse(v)).filter(t => valid(t, now)));
}

export interface LicenseView {
  activated: boolean;
  machineId: string;
  /** Kalit berilgan kun (YYYY-MM-DD) */
  issuedAt: string | null;
  /** Kalitsiz ishlash uchun qolgan kunlar (aktivlashtirilgan bo'lsa — 0) */
  daysLeft: number;
  /** Kalit yo'q va kalitsiz muddat yo'q yoki tugagan — panel yopiq */
  blocked: boolean;
}

export function licenseStatus(now = Date.now()): LicenseView {
  const id = machineId(), kind = install(id, now), started = startedAt(kind, id, now);
  const ok = load().keys.map(k => checkLicense(k, id, env.licensePublicKey || undefined)).find(Boolean) ?? null;
  const left = Math.max(0, graceDays(kind) - Math.floor((now - started) / DAY_MS));
  return { activated: !!ok, machineId: id, issuedAt: ok?.issuedAt ?? null, daysLeft: ok ? 0 : left, blocked: !ok && left <= 0 };
}

/** Kalit to'g'ri bo'lsa saqlanadi va yangi holat qaytadi; aks holda null */
export function activate(key: string): LicenseView | null {
  if (!checkLicense(key, machineId(), env.licensePublicKey || undefined)) return null;
  save({ ...load(), keys: [key.replace(/\s+/g, '')] });
  return licenseStatus();
}
