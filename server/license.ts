/**
 * Litsenziya holati (kalit ko'rinishi — hub/licenseKey.ts). Kalitsiz ham ishlaydi: shu kompyuterda birinchi ishga tushgandan
 * LICENSE_GRACE_DAYS (14) kun — panelda eslatma; keyin panel faqat aktivlashtirish oynasini ko'rsatadi (http.ts, asBiz). Bot, kamera,
 * qo'ng'iroqlar va boshqa xizmatlar to'xtamaydi — klinikaning mijozlari javobsiz qolmasin.
 * Kompyuter kodi: Windows MachineGuid'ining xeshi — Windows qayta o'rnatilsa almashadi (yangi kalit kerak). LICENSE_MACHINE_ID — sinov.
 * Saqlanadi: <DATA_DIR>/litsenziya.json — kalit va har kompyuterning birinchi ishga tushgan payti (zaxira boshqa kompyuterga tiklansa,
 * o'sha kompyuterning muddati alohida boshlanadi).
 * Litsenziya qo'shilishidan oldin ham ishlab turgan klinika (biznesi hisob boshlanishidan oldin yaratilgan) — muddat uzunroq
 * (EXISTING_GRACE_DAYS): yangilanish kechasi o'zi keladi, sotuvchi hammasini bir vaqtda aktivlashtirib ulgurmasligi mumkin.
 * Muddat tugashiga yaqin egasiga Telegram'da aytiladi (scheduler.ts) — faqat Telegram ishlatadigan egasi panel yopilganini bilmay qolmasin.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { checkLicense, normalizeMachineId } from '../hub/licenseKey';
import { businesses } from './db';
import { env } from './env';

const DAY_MS = 86_400_000;
/** Oldindan ishlab turgan o'rnatish uchun kalitsiz muddat (kun); .env muddatni qisqartirgan bo'lsa (sinov) — qisqartirilgani */
const EXISTING_GRACE_DAYS = 30;

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

interface Stored { key: string | null; firstRun: Record<string, string> }
const file = () => join(env.dataDir, 'litsenziya.json');
let stored: Stored | null = null;
function load(): Stored {
  if (stored) return stored;
  try {
    const j = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Stored>;
    stored = { key: typeof j.key === 'string' ? j.key : null, firstRun: j.firstRun && typeof j.firstRun === 'object' ? j.firstRun : {} };
  } catch {
    stored = { key: null, firstRun: {} };
  }
  return stored;
}
/** Yozib bo'lmasa (disk to'la, papka yopiq) — xotirada qoladi: litsenziya tufayli panel so'rovlari yiqilmasin */
function save(s: Stored): void {
  stored = s;
  try {
    writeFileSync(`${file()}.tmp`, JSON.stringify(s, null, 2));
    renameSync(`${file()}.tmp`, file());
  } catch (e) {
    console.error('[litsenziya] saqlanmadi:', (e as Error).message);
  }
}

/** Shu kompyuterning birinchi ishga tushgan payti; yo'q, buzuq yoki kelajakdagi (soat adashgan) qiymat — hozirgi payt bilan almashadi */
function firstRun(id: string, now: number): number {
  const s = load(), t = Date.parse(String(s.firstRun[id] ?? ''));
  if (Number.isFinite(t) && t <= now) return t;
  save({ ...s, firstRun: { ...s.firstRun, [id]: new Date(now).toISOString() } });
  return now;
}

export interface LicenseView {
  activated: boolean;
  machineId: string;
  /** Kalit berilgan kun (YYYY-MM-DD) */
  issuedAt: string | null;
  /** Kalitsiz ishlash uchun qolgan kunlar (aktivlashtirilgan bo'lsa — 0) */
  daysLeft: number;
  /** Muddat tugadi va kalit yo'q — panel yopiq */
  blocked: boolean;
}

let existing: boolean | null = null;
/** Biznes hisob boshlanishidan kamida bir kun oldin yaratilgan — bu yangilanish, yangi o'rnatish emas (bir marta aniqlanadi) */
function existingInstall(started: number): boolean {
  if (existing !== null) return existing;
  const oldest = Math.min(...businesses.all().map(b => Date.parse(b.createdAt)).filter(Number.isFinite));
  existing = Number.isFinite(oldest) && oldest < started - DAY_MS;
  return existing;
}
const graceDays = (started: number) => (env.licenseGraceDays >= 14 && existingInstall(started) ? EXISTING_GRACE_DAYS : env.licenseGraceDays);

export function licenseStatus(now = Date.now()): LicenseView {
  const id = machineId(), started = firstRun(id, now), key = load().key;
  const ok = key ? checkLicense(key, id, env.licensePublicKey || undefined) : null;
  const left = Math.max(0, graceDays(started) - Math.floor((now - started) / DAY_MS));
  return { activated: !!ok, machineId: id, issuedAt: ok?.issuedAt ?? null, daysLeft: ok ? 0 : left, blocked: !ok && left <= 0 };
}

/** Kalit to'g'ri bo'lsa saqlanadi va yangi holat qaytadi; aks holda null */
export function activate(key: string): LicenseView | null {
  if (!checkLicense(key, machineId(), env.licensePublicKey || undefined)) return null;
  save({ ...load(), key: key.replace(/\s+/g, '') });
  return licenseStatus();
}
